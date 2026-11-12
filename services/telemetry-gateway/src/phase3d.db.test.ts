// Gateway test against a real migrated and seeded database (Phase 3d): reference mode. A reference
// station pairs a tablet with a PIN; a true-size preview stores nothing; a sample block gives the
// fill order and pen lifts and a normal-speed row the Normal speed (FR-CAN-9/10), each accepted into
// a Draft's profile or, with the director's PIN, into a Domain's profile; [Clear] keeps the
// recording for audit. Runs only when TEST_DATABASE_URL (the ilt_app role) is set.
import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import { PERFECT_ILT, firstRows, synthBlock } from '@ilt/ilt-metrics';
import { controlMessage, type ControlPayload, type PenSample } from '@ilt/shared-types';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE, NOTEBOOK_GEOMETRY } from '@ilt/template-schemas';
import { buildApp } from './app.js';
import { Client, isEvent } from './ws-client.test-support.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const box = (id: number) => ILT_GRID_GEOMETRY.boxes.find((b) => b.id === id)!;
const sha = (samples: PenSample[]) => createHash('sha256').update(encodeSampleRecords(samples)).digest('hex');
type Dispatch = ControlPayload<'DISPATCH_STEP'>;
type Result = ControlPayload<'REFERENCE_RESULT'> & { derived: Record<string, unknown> };

describe.skipIf(!DB_URL)('Phase 3d reference mode against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  const run = randomUUID().slice(0, 8);
  const admin = { email: `phase3d-admin-${run}@ilt.local`, password: `pw-${randomUUID()}`, token: '' };
  const director = { email: `phase3d-dir-${run}@ilt.local`, pin: '864213' };
  const approval = { director_email: director.email, director_pin: director.pin };
  const code = `T3D_${run}`.toUpperCase();
  const nbCode = `T3DN_${run}`.toUpperCase();
  const domainCode = `T3DD_${run}`.toUpperCase();
  let domainId = 0;
  const clients: Client[] = [];

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  };
  const as = <T>(path: string, method = 'GET', body?: unknown) => call<T>(path, { method, body, auth: admin.token });
  const profileOf = async (id: string) =>
    (await as<{ default_scoring_profile: { fill_order: number[]; expected_pen_lifts_per_block: number; normal_speed_mm_s: number | null } }>(`/canvases/${id}/detail`)).body.default_scoring_profile;

  /** The tablet writes `samples` for the dispatched run and finishes it, as the kiosk does. */
  async function write(tablet: Client, stationId: string, d: Dispatch, samples: PenSample[]) {
    tablet.send(controlMessage('STEP_STARTED', { step_index: 0, attempt_number: d.attempt_number, block_started_at: new Date().toISOString() }));
    for (let i = 0, sequence = 0; i < samples.length; i += 200, sequence++) {
      tablet.ws.send(encodePacket({ packet_type: PacketType.BATCH, session_id: stationId, step_index: 0, attempt_number: d.attempt_number, sequence, samples: samples.slice(i, i + 200) }));
    }
    tablet.send(controlMessage('BLOCK_COMPLETE', {
      step_index: 0, attempt_number: d.attempt_number, end_reason: 'MANUAL', sample_count: samples.length,
      last_sample_seq: samples.length - 1, sha256: sha(samples),
    }));
  }

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase3d-test', schoolHmacKey: 'phase3d-school', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, domain_id) VALUES ($1, $2, 'Phase 3d admin', 'ADMIN', (SELECT id FROM domains WHERE code = 'GENERAL'))`,
      [admin.email, await hash(admin.password)],
    );
    admin.token = (await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email: admin.email, password: admin.password } })).body.access_token;
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, domain_id)
       VALUES ($1, $2, 'Phase 3d director', 'RESEARCHER', $3, (SELECT id FROM domains WHERE code = 'GENERAL'))`,
      [director.email, await hash(`pw-${randomUUID()}`), await hash(director.pin)],
    );
    domainId = (await as<{ id: number }>('/domains', 'POST', { code: domainCode, name_he: 'בדיקה', name_en: 'Reference test', description_he: '', description_en: '' })).body.id;
  });

  afterAll(async () => {
    clients.forEach((c) => c.ws.close());
    await app?.close();
    // Best effort: recordings are kept by design (ilt_app cannot delete them), so their canvases stay too.
    const tryQuery = (sql: string, params: unknown[]) => pool.query(sql, params).catch(() => undefined);
    await tryQuery('DELETE FROM canvas_scoring_overrides WHERE domain_id = $1', [domainId]);
    await pool.query('UPDATE users SET is_active = false WHERE email = ANY($1)', [[admin.email, director.email]]);
    await pool.end();
  });

  it('pairs a tablet, previews, records, accepts into a Draft and a Domain, and clears', async () => {
    const set = await as<{ id: string }>('/canvas-sets', 'POST', { language_code: 'he', set_type: 'ILT', name_he: 'בדיקה', name_en: `Reference set ${run}` });
    const draft = await as<{ id: string }>('/canvases', 'POST', {
      canvas_set_id: set.body.id, code, name_he: 'רשת', name_en: 'Grid', geometry: ILT_GRID_GEOMETRY, profile: { ...ILT_PROFILE_HE, fill_order: [], normal_speed_mm_s: null },
    });
    expect(draft.status).toBe(201);
    const nbSet = await as<{ id: string }>('/canvas-sets', 'POST', { language_code: 'he', set_type: 'NOTEBOOK', name_he: 'מחברת', name_en: `Reference notebook ${run}` });
    const nb = await as<{ id: string }>('/canvases', 'POST', { canvas_set_id: nbSet.body.id, code: nbCode, name_he: 'מחברת', name_en: 'Notebook', geometry: NOTEBOOK_GEOMETRY });

    // ---- Station and pairing: the tablet pairs with the station's PIN through the usual pairing route.
    const station = await as<{ id: string; pin: string }>('/reference/stations', 'POST', { language_code: 'he' });
    expect(station.status).toBe(201);
    const paired = await call<{ status: string; mode: string; session_id: string; token: string }>('/sessions/pair', {
      method: 'POST', body: { pin: station.body.pin, css_px_per_mm: 7.2, device_pixel_ratio: 1.5, screen_w_mm: 211, screen_h_mm: 132 },
    });
    expect(paired.body).toMatchObject({ status: 'ACCEPTED', mode: 'REFERENCE', session_id: station.body.id });
    expect((await as(`/reference/stations/${station.body.id}`)).body).toMatchObject({ paired: true, css_px_per_mm: 7.2 });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: admin.token, reference_id: station.body.id });
    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    clients.push(cockpit, tablet);
    await cockpit.next(isEvent('PEER_STATUS'));
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && (m as { payload: { tablet: boolean } }).payload.tablet);

    const start = (payload: ControlPayload<'REFERENCE_START'>) => cockpit.send(controlMessage('REFERENCE_START', payload));
    const dispatched = async () => ((await tablet.next(isEvent('DISPATCH_STEP'))) as { payload: Dispatch }).payload;

    // ---- True-size preview (FR-CAN-6): any canvas, a free page, nothing stored.
    start({ canvas_id: nb.body.id, kind: 'PREVIEW' });
    const preview = await dispatched();
    expect(preview).toMatchObject({ step_type: 'NOTEBOOK_PAGE', reference: { kind: 'PREVIEW', free_order: true }, immediate: true });
    // A second start while the page is on the tablet is refused.
    start({ canvas_id: draft.body.id, kind: 'PREVIEW' });
    expect(((await cockpit.next(isEvent('ERROR'))) as { payload: { code: string } }).payload.code).toBe('BLOCK_ACTIVE');
    cockpit.send(controlMessage('MANUAL_FINISH', { reason: 'preview seen' }));
    await tablet.next(isEvent('MANUAL_FINISH'));
    await write(tablet, station.body.id, preview, synthBlock([{ box: NOTEBOOK_GEOMETRY.boxes[0]!, spec: PERFECT_ILT }]));
    await cockpit.next(isEvent('BLOCK_COMPLETE'));
    await new Promise((r) => setTimeout(r, 200));
    expect((await pool.query('SELECT count(*)::int AS n FROM reference_recordings WHERE canvas_id = $1', [nb.body.id])).rows[0].n).toBe(0);

    // ---- Sample block (FR-CAN-9): drawn right to left in reverse, so the order differs from the language direction.
    const reversed = [...ILT_PROFILE_HE.fill_order].reverse();
    start({ canvas_id: draft.body.id, kind: 'SAMPLE_BLOCK_FILL' });
    const sample = await dispatched();
    expect(sample).toMatchObject({ step_type: 'ILT_BLOCK', reference: { kind: 'SAMPLE_BLOCK_FILL', free_order: true } });
    await write(tablet, station.body.id, sample, synthBlock(reversed.map((id) => ({ box: box(id), spec: PERFECT_ILT }))));
    const fill = ((await cockpit.next(isEvent('REFERENCE_RESULT'))) as { payload: Result }).payload;
    expect(fill.derived).toMatchObject({ fill_order: reversed, pen_lifts: 15, complete: true, direction_matches: false, integrity_ok: true });
    expect((await as(`/reference-recordings/${fill.recording_id}/accept`, 'POST', {})).body).toMatchObject({ accepted: true });
    expect(await profileOf(draft.body.id)).toMatchObject({ fill_order: reversed, expected_pen_lifts_per_block: 15 });
    expect((await as<{ error: { code: string } }>(`/reference-recordings/${fill.recording_id}/accept`, 'POST', {})).body.error.code).toBe('NOT_PENDING');

    // ---- Normal speed (FR-CAN-10): one row in the (now recorded) fill order.
    const row = firstRows(ILT_GRID_GEOMETRY, reversed, 1);
    start({ canvas_id: draft.body.id, kind: 'NORMAL_SPEED', rows: 1, writer_label: 'skilled adult writer' });
    const speedRun = await dispatched();
    expect(speedRun).toMatchObject({ fill_order: reversed, reference: { kind: 'NORMAL_SPEED', free_order: false, rows: 1 } });
    await write(tablet, station.body.id, speedRun, synthBlock(row.map((id) => ({ box: box(id), spec: { ...PERFECT_ILT, speed_mm_s: 30 } }))));
    const speed = ((await cockpit.next(isEvent('REFERENCE_RESULT'))) as { payload: Result }).payload;
    expect(speed.derived).toMatchObject({ complete: true, letters_written: row.length, rows: 1 });
    const measured = speed.derived.normal_speed_mm_s as number;
    expect(measured).toBeGreaterThan(27);
    expect(measured).toBeLessThan(33);
    await as(`/reference-recordings/${speed.recording_id}/accept`, 'POST', {});
    expect((await profileOf(draft.body.id))!.normal_speed_mm_s).toBe(measured);

    // ---- An incomplete row cannot be accepted; [Clear] keeps it for audit.
    start({ canvas_id: draft.body.id, kind: 'NORMAL_SPEED' });
    const partialRun = await dispatched();
    await write(tablet, station.body.id, partialRun, synthBlock([{ box: box(row[0]!), spec: PERFECT_ILT }]));
    const partial = ((await cockpit.next(isEvent('REFERENCE_RESULT'))) as { payload: Result }).payload;
    expect(partial.derived.complete).toBe(false);
    expect((await as<{ error: { code: string } }>(`/reference-recordings/${partial.recording_id}/accept`, 'POST', {})).body.error.code).toBe('INCOMPLETE');
    expect((await as(`/reference-recordings/${partial.recording_id}/clear`, 'POST')).body).toEqual({ cleared: true });

    // ---- Active canvas: its own profile is not recorded (a change is a new version); a Domain's profile is, with the director's PIN.
    expect((await as(`/canvases/${draft.body.id}/activate`, 'POST', approval)).status).toBe(200);
    start({ canvas_id: draft.body.id, kind: 'NORMAL_SPEED' });
    expect(((await cockpit.next(isEvent('ERROR'))) as { payload: { code: string } }).payload.code).toBe('NOT_DRAFT');
    start({ canvas_id: draft.body.id, kind: 'NORMAL_SPEED', domain_id: domainId });
    const domainRun = await dispatched();
    await write(tablet, station.body.id, domainRun, synthBlock(row.map((id) => ({ box: box(id), spec: { ...PERFECT_ILT, speed_mm_s: 15 } }))));
    const domainSpeed = ((await cockpit.next(isEvent('REFERENCE_RESULT'))) as { payload: Result }).payload;
    expect((await as<{ error: { code: string } }>(`/reference-recordings/${domainSpeed.recording_id}/accept`, 'POST', {})).body.error.code).toBe('DIRECTOR_PIN');
    expect((await as(`/reference-recordings/${domainSpeed.recording_id}/accept`, 'POST', approval)).status).toBe(200);
    const override = (await pool.query('SELECT profile_patch FROM canvas_scoring_overrides WHERE canvas_id = $1 AND domain_id = $2', [draft.body.id, domainId])).rows[0];
    expect(override.profile_patch).toEqual({ normal_speed_mm_s: domainSpeed.derived.normal_speed_mm_s });

    // ---- The canvas detail lists the recordings; a canvas with recordings keeps them (no delete).
    const recs = (await as<{ recordings: { kind: string; status: string; domain_code: string | null; writer_label: string | null }[] }>(`/canvases/${draft.body.id}/detail`)).body.recordings;
    expect(recs.map((r) => r.status)).toEqual(['ACCEPTED', 'CLEARED', 'ACCEPTED', 'ACCEPTED']);
    expect(recs[0]).toMatchObject({ kind: 'NORMAL_SPEED', domain_code: domainCode });
    expect(recs[2]).toMatchObject({ writer_label: 'skilled adult writer' });
    const v2 = await as<{ id: string }>(`/canvases/${draft.body.id}/versions`, 'POST');
    expect((await as(`/canvases/${v2.body.id}`, 'DELETE')).body).toEqual({ deleted: true });

    // ---- A sample block finished with nothing written: no recording, an error to the cockpit, a WARN in the log.
    start({ canvas_id: draft.body.id, kind: 'SAMPLE_BLOCK_FILL', domain_id: domainId });
    const emptyRun = await dispatched();
    await write(tablet, station.body.id, emptyRun, []);
    expect(((await cockpit.next(isEvent('ERROR'))) as { payload: { code: string } }).payload.code).toBe('EMPTY_RECORDING');

    // ---- Closing the station turns the tablet away.
    const closed = new Promise<number>((resolve) => tablet.ws.once('close', (c) => resolve(c)));
    expect((await as(`/reference/stations/${station.body.id}`, 'DELETE')).body).toEqual({ closed: true });
    expect(await closed).toBe(4401);
    expect((await call('/reference/stations', { method: 'POST', body: {} })).status).toBe(401);

    await app.appLog.flush();
    const logged = (await pool.query(
      `SELECT DISTINCT event_type FROM app_events WHERE event_type LIKE 'canvas.reference.%' AND actor_user_id = (SELECT id FROM users WHERE email = $1)`, [admin.email],
    )).rows.map((r) => r.event_type);
    expect(logged.sort()).toEqual(['canvas.reference.accepted', 'canvas.reference.cleared', 'canvas.reference.ended', 'canvas.reference.paired', 'canvas.reference.recorded', 'canvas.reference.started']);
  });
});
