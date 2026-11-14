// Phase 5f against the database: session video capture with a stand-in camera. The tablet shows a
// one-time QR code, the gateway finds it in the camera's picture and pairs that camera to the session,
// the evaluator positions it (framing guide, pan/tilt), each writing step is recorded as a clip linked
// to its attempt, and replay gets the clip. No real camera, relay or storage is used.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { hash } from '@node-rs/argon2';
import jpeg from 'jpeg-js';
import pg from 'pg';
import qrcode from 'qrcode-generator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { controlMessage, type ControlEnvelope } from '@ilt/shared-types';
import { buildApp } from './app.js';
import { parseProbeMatch, type Direction } from './camera/onvif.js';
import { readPairingCode } from './camera/qr.js';
import { secretBox } from './camera/secret.js';
import { Client, isEvent } from './ws-client.test-support.js';

const DB_URL = process.env.TEST_DATABASE_URL;

/** A camera picture showing `text` as a QR code (8 px per module, white quiet zone). */
function qrPicture(text: string): Buffer {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const scale = 8;
  const size = (n + 8) * scale;
  const data = Buffer.alloc(size * size * 4, 255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + 4) * scale + y) * size + (c + 4) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return Buffer.from(jpeg.encode({ data, width: size, height: size }, 90).data);
}

describe('camera helpers', () => {
  it('reads a discovery answer, keeps passwords sealed, and finds the pairing code in a picture', () => {
    const match = `<d:ProbeMatch><a:EndpointReference><a:Address>urn:uuid:3fa1</a:Address></a:EndpointReference>
      <d:Scopes>onvif://www.onvif.org/name/C211 onvif://www.onvif.org/hardware/C211 onvif://www.onvif.org/location/Hong%20Kong</d:Scopes>
      <d:XAddrs>http://10.0.0.23:2020/onvif/device_service</d:XAddrs></d:ProbeMatch>`;
    expect(parseProbeMatch(match)).toEqual({ urn: 'urn:uuid:3fa1', deviceUrl: 'http://10.0.0.23:2020/onvif/device_service', host: '10.0.0.23', model: 'C211' });
    expect(parseProbeMatch('<x/>')).toBeNull();
    const box = secretBox('k1');
    const sealed = box.seal('s3cret');
    expect(sealed).not.toContain('s3cret');
    expect(box.open(sealed)).toBe('s3cret');
    expect(() => secretBox('k2').open(sealed)).toThrow();
    expect(readPairingCode(qrPicture('ILT-CAM:abc123'))).toBe('abc123');
    // Another QR code, or none, is not a pairing code.
    expect(readPairingCode(qrPicture('https://example.org'))).toBeNull();
    expect(readPairingCode(Buffer.from('not a picture'))).toBeNull();
  });
});

describe.skipIf(!DB_URL)('Phase 5f session video against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  const run = randomUUID().slice(0, 8);
  const secrets = secretBox(`phase5f-${run}`);
  const urn = `urn:uuid:phase5f-${run}`;
  const users = {
    evaluator: { email: `phase5f-eval-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'EVALUATOR', token: '', id: '' },
    admin: { email: `phase5f-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, role: 'ADMIN', token: '', id: '' },
  };
  // The stand-in camera: what it shows, how it was turned, and the stored clips.
  let shown: string | null = null;
  const moves: Direction[] = [];
  const stored = new Map<string, Buffer>();

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const json = (res.headers.get('content-type') ?? '').includes('json') && buf.length ? JSON.parse(buf.toString('utf8')) : null;
    return { status: res.status, body: json as T, bytes: buf };
  };

  beforeAll(async () => {
    app = await buildApp({
      db: pool, checkS3: async () => true, jwtSecret: 'phase5f-test', schoolHmacKey: 'phase5f-school', logLevel: 'silent',
      cameras: {
        secrets,
        discover: async () => [{ urn, deviceUrl: 'http://192.0.2.10/onvif/device_service', host: '192.0.2.10', model: 'Test camera' }],
        onvif: () => ({
          inspect: async () => ({ rtspUrl: 'rtsp://192.0.2.10/main', rtspSubUrl: 'rtsp://192.0.2.10/sub', profileToken: 'p1', ptz: true, ptzUrl: 'http://192.0.2.10/ptz' }),
          move: async (_url, _token, direction) => {
            moves.push(direction);
          },
        }),
        relay: {
          setStream: async () => undefined,
          removeStream: async () => undefined,
          // Only the test camera's stream shows the tablet; any other camera in the database shows nothing.
          frame: async (name) => (shown && name.includes(urnCameraId) ? qrPicture(shown) : null),
          mp4: async (_name, signal) => Readable.from((async function* () {
            while (!signal.aborted) {
              yield Buffer.alloc(1024, 7);
              await new Promise((r) => setTimeout(r, 40));
            }
          })()),
          liveUrl: (name) => `ws://127.0.0.1:1/${name}`,
          ping: async () => true,
        },
        clips: {
          put: async (key, file) => {
            stored.set(key, await readFile(file));
          },
          get: async (key) => (stored.has(key) ? { stream: Readable.from([stored.get(key)!]), size: stored.get(key)!.length } : null),
        },
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    for (const u of Object.values(users)) {
      u.id = (await pool.query(
        `INSERT INTO users (email, password_hash, full_name, role, domain_id) VALUES ($1, $2, $3, $4, (SELECT id FROM domains WHERE code = 'GENERAL')) RETURNING id`,
        [u.email, await hash(u.password), `Phase 5f test ${u.role}`, u.role],
      )).rows[0].id;
      u.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).body.access_token;
    }
    // The test camera, with its own account (the site camera account of the dev database is left alone).
    urnCameraId = (await pool.query(
      `INSERT INTO cameras (device_urn, model, host, device_url, username, password_enc, last_seen_at) VALUES ($1, 'Test camera', '192.0.2.10', 'http://192.0.2.10/onvif/device_service', 'tester', $2, now()) RETURNING id`,
      [urn, secrets.seal('camera-pw')],
    )).rows[0].id.replace(/-/g, '');
  });
  let urnCameraId = '';

  afterAll(async () => {
    await app?.close();
    await pool.query("UPDATE camera_pairings SET status = 'ENDED', ended_at = now() WHERE status IN ('PENDING', 'PAIRED') AND camera_id IN (SELECT id FROM cameras WHERE device_urn = $1)", [urn]);
    await pool.query('UPDATE cameras SET retired = true WHERE device_urn = $1', [urn]);
    await pool.query('UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])', [Object.values(users).map((u) => u.id)]);
    await pool.end();
  });

  it('pairs a camera by the QR code, positions it, records a clip per step and replays it', async () => {
    const token = users.evaluator.token;
    const domainId = (await pool.query("SELECT id FROM domains WHERE code = 'GENERAL'")).rows[0].id as number;
    const pid = (await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `T5F-${run}`, domain_id: domainId, school: 'Phase 5f school', birth_year_month: '2019-01', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    })).body.id;
    const sessionId = (await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: pid, session_type: 'DAY_1', language_code: 'he' } })).body.id;
    type CameraInfo = { video_enabled: boolean; available: boolean; state: { state: string } | null };
    expect((await call<CameraInfo>(`/sessions/${sessionId}/camera`, { auth: token })).body).toMatchObject({ video_enabled: false, available: true });
    expect((await call<{ error: { code: string } }>(`/sessions/${sessionId}/camera/pair`, { method: 'POST', auth: token, body: {} })).body.error.code).toBe('VIDEO_OFF');
    // Video allowed for this session (the setting and the consent are covered by Phase 3f).
    await pool.query('UPDATE sessions SET video_enabled = true WHERE id = $1', [sessionId]);
    expect((await call<{ error: { code: string } }>(`/sessions/${sessionId}/camera/pair`, { method: 'POST', auth: token, body: {} })).body.error.code).toBe('TABLET_OFFLINE');

    const { body: room } = await call<{ pin: string }>(`/sessions/${sessionId}/pairing`, { method: 'POST', auth: token });
    const paired = await call<{ token: string }>('/sessions/pair', { method: 'POST', body: { pin: room.pin, css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 } });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: sessionId });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);
    type Status = { state: string; camera: { id: string; ptz: boolean } | null; recording: boolean; watching: number };
    const status = async (match: (s: Status) => boolean) => (await cockpit.next((m) => isEvent('CAMERA_STATUS')(m) && match((m as ControlEnvelope).payload as Status), 10_000)).payload as Status;
    expect(await status(() => true)).toMatchObject({ state: 'NONE', recording: false });

    // ---- Pairing: the tablet shows the code; the camera that sees it is paired, and the tablet shows the frame.
    expect((await call(`/sessions/${sessionId}/camera/pair`, { method: 'POST', auth: token, body: {} })).status).toBe(200);
    const screen = (await tablet.next(isEvent('CAMERA_SCREEN'))).payload as { screen: string; code: string };
    expect(screen.screen).toBe('CODE');
    expect(screen.code).toMatch(/^[\w-]{20}$/);
    await status((s) => s.state === 'SEARCHING');
    shown = `ILT-CAM:${screen.code}`;
    expect(((await tablet.next(isEvent('CAMERA_SCREEN'), 10_000)).payload as { screen: string }).screen).toBe('FRAME');
    shown = null;
    const pairedStatus = await status((s) => s.state === 'PAIRED');
    expect(pairedStatus.camera).toMatchObject({ ptz: true });
    const pairing = (await pool.query("SELECT status, camera_id FROM camera_pairings WHERE session_id = $1 AND status = 'PAIRED'", [sessionId])).rows[0];
    expect(pairing.camera_id.replace(/-/g, '')).toBe(urnCameraId);

    // ---- Positioning: pan/tilt, then the tablet leaves the frame.
    expect((await call(`/sessions/${sessionId}/camera/move`, { method: 'POST', auth: token, body: { direction: 'LEFT' } })).status).toBe(200);
    expect(moves).toEqual(['LEFT']);
    expect((await call(`/sessions/${sessionId}/camera/positioned`, { method: 'POST', auth: token, body: {} })).status).toBe(200);
    expect(((await tablet.next(isEvent('CAMERA_SCREEN'))).payload as { screen: string }).screen).toBe('NONE');

    // The administrator sees the camera, but never its password.
    const listing = await call<{ cameras: Record<string, unknown>[] }>('/cameras', { auth: users.admin.token });
    const cam = listing.body.cameras.find((c) => c.id === pairing.camera_id)!;
    expect(cam).toMatchObject({ model: 'Test camera', status: 'OK', ptz: true, own_account: true, own_username: 'tester', has_sub_stream: true });
    expect(JSON.stringify(listing.body)).not.toMatch(/password_enc|camera-pw|rtsp:/);
    expect((await call('/cameras', { auth: token })).status).toBe(403);

    // ---- A writing step is recorded: the clip starts at dispatch and is stored with its attempt.
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 1, step_type: 'WARMUP_BLOCK', attempt_number: 1 }));
    const d = (await tablet.next(isEvent('DISPATCH_STEP'))).payload as { attempt_number: number };
    await status((s) => s.recording);
    await new Promise((r) => setTimeout(r, 300));
    tablet.send(controlMessage('STEP_STARTED', { step_index: 1, attempt_number: d.attempt_number, block_started_at: new Date().toISOString() }));
    await new Promise((r) => setTimeout(r, 300));
    // The camera cannot be let go while it records.
    expect((await call<{ error: { code: string } }>(`/sessions/${sessionId}/camera/release`, { method: 'POST', auth: token, body: {} })).body.error.code).toBe('STEP_RUNNING');
    tablet.send(controlMessage('BLOCK_COMPLETE', { step_index: 1, attempt_number: d.attempt_number, end_reason: 'MANUAL', sample_count: 0, last_sample_seq: -1, sha256: createHash('sha256').update(new Uint8Array()).digest('hex') }));
    await status((s) => !s.recording && s.state === 'PAIRED');
    let record: { id: string; block_attempt_id: string; sync_offset_ms: number; size_bytes: string; object_key: string } | undefined;
    for (let i = 0; i < 50 && !record; i++) {
      record = (await pool.query('SELECT id, block_attempt_id, sync_offset_ms, size_bytes, object_key FROM session_video_records WHERE session_id = $1', [sessionId])).rows[0];
      if (!record) await new Promise((r) => setTimeout(r, 100));
    }
    expect(record).toBeDefined();
    // The clip began before the child's start (it starts at dispatch).
    expect(record!.sync_offset_ms).toBeLessThan(0);
    expect(Number(record!.size_bytes)).toBeGreaterThan(0);
    expect(record!.object_key).toBe(`clips/${sessionId}/${record!.block_attempt_id}.mp4`);

    // ---- Replay: the attempt's clip, fetched with the evaluator's sign-in.
    const replay = await call<{ video: { id: string; sync_offset_ms: number } | null }>(`/attempts/${record!.block_attempt_id}/replay`, { auth: token });
    expect(replay.body.video).toMatchObject({ id: record!.id, sync_offset_ms: record!.sync_offset_ms });
    const clip = await call(`/media/clips/${record!.id}`, { auth: token });
    expect(clip.status).toBe(200);
    expect(clip.bytes.equals(stored.get(record!.object_key)!)).toBe(true);
    expect((await call(`/media/clips/${record!.id}`)).status).toBe(401);

    // ---- Releasing the camera ends the pairing; the camera is free for another session.
    expect((await call(`/sessions/${sessionId}/camera/release`, { method: 'POST', auth: token, body: {} })).status).toBe(200);
    await status((s) => s.state === 'NONE');
    expect((await pool.query('SELECT status, end_reason FROM camera_pairings WHERE session_id = $1 AND camera_id IS NOT NULL', [sessionId])).rows[0]).toEqual({ status: 'ENDED', end_reason: 'BY_EVALUATOR' });
    tablet.ws.close();
    cockpit.ws.close();
  });
});
