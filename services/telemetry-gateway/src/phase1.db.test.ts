// End-to-end gateway test against a real migrated and seeded database (Phase 1 flow):
// sign-in, participant, session, PIN pairing, both sockets, dispatch, batches with a resend,
// block completion with the SHA-256 check, the LIVE relay, and abort.
// Runs only when TEST_DATABASE_URL (the ilt_app role) is set; the CI database job sets it.
import { createHash, randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import { PERFECT_ILT, synthBlock } from '@ilt/ilt-metrics';
import { controlMessage, type ControlEnvelope, type PenSample } from '@ilt/shared-types';
import { ILT_GRID_GEOMETRY, ILT_PROFILE_HE } from '@ilt/template-schemas';
import { buildApp } from './app.js';

const DB_URL = process.env.TEST_DATABASE_URL;

class Client {
  readonly messages: (ControlEnvelope | Uint8Array)[] = [];
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data: Buffer, binary: boolean) => {
      this.messages.push(binary ? new Uint8Array(data) : (JSON.parse(data.toString()) as ControlEnvelope));
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  static async open(url: string, auth: Record<string, string>): Promise<Client> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    const c = new Client(ws);
    ws.send(JSON.stringify(auth));
    return c;
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  /** Waits for (and removes) the first message matching the predicate. */
  async next<T = ControlEnvelope>(match: (m: ControlEnvelope | Uint8Array) => boolean, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.messages.findIndex(match);
      if (i >= 0) return this.messages.splice(i, 1)[0] as T;
      if (Date.now() > deadline) throw new Error('timed out waiting for a message');
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 100);
      });
    }
  }
}

const isEvent = (event: string) => (m: ControlEnvelope | Uint8Array) => !(m instanceof Uint8Array) && m.event === event;

describe.skipIf(!DB_URL)('Phase 1 flow against the database', () => {
  const pool = new pg.Pool({ connectionString: DB_URL });
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  let wsBase = '';
  let token = '';
  const run = randomUUID().slice(0, 8);
  const email = `phase1-test-${run}@ilt.local`;
  const password = `pw-${randomUUID()}`;

  const call = async <T>(path: string, init: { method?: string; body?: unknown; auth?: string } = {}) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { authorization: `Bearer ${init.auth}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as T };
  };

  beforeAll(async () => {
    app = await buildApp({ db: pool, checkS3: async () => true, jwtSecret: 'phase1-test', logLevel: 'silent' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, domain_id)
       VALUES ($1, $2, 'Phase 1 test evaluator', 'EVALUATOR', (SELECT id FROM domains WHERE code = 'GENERAL'))`,
      [email, await hash(password)],
    );
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('UPDATE users SET is_active = false WHERE email = $1', [email]);
    await pool.end();
  });

  it('signs in, refuses a wrong password', async () => {
    expect((await call('/auth/login', { method: 'POST', body: { email, password: 'wrong' } })).status).toBe(401);
    const ok = await call<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password } });
    expect(ok.status).toBe(200);
    token = ok.body.access_token;
    expect((await call('/sessions')).status).toBe(401);
  });

  it('runs a block from pairing to a verified, stored block', async () => {
    const domains = await call<{ id: number; code: string }[]>('/domains', { auth: token });
    const domainId = domains.body.find((d) => d.code === 'GENERAL')!.id;
    const participant = await call<{ id: string }>('/participants', {
      method: 'POST', auth: token,
      body: { study_code: `TEST-${run}`, domain_id: domainId, grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' },
    });
    expect(participant.status).toBe(201);

    const created = await call<{ id: string }>('/sessions', { method: 'POST', auth: token, body: { participant_id: participant.body.id, session_type: 'DAY_14', language_code: 'he' } });
    expect(created.status).toBe(201);
    const sessionId = created.body.id;
    const detail = await call<{ steps: { step_type: string; status: string }[]; status: string }>(`/sessions/${sessionId}`, { auth: token });
    expect(detail.body.steps.map((s) => s.step_type)).toEqual(['ILT_BLOCK', 'ILT_BLOCK']);
    expect(detail.body.status).toBe('PLANNED');

    // Pairing: a wrong PIN is refused, the right one returns a session-bound tablet token.
    const { body: room } = await call<{ pin: string }>(`/sessions/${sessionId}/pairing`, { method: 'POST', auth: token });
    expect(room.pin).toMatch(/^\d{6}$/);
    const pairBody = { css_px_per_mm: 5.195, device_pixel_ratio: 1.75, screen_w_mm: 242, screen_h_mm: 158 };
    const wrong = room.pin === '000000' ? '000001' : '000000';
    expect((await call('/sessions/pair', { method: 'POST', body: { ...pairBody, pin: wrong } })).status).toBe(401);
    const paired = await call<{ status: string; token: string; session_id: string; direction: string }>('/sessions/pair', { method: 'POST', body: { ...pairBody, pin: room.pin } });
    expect(paired.body).toMatchObject({ status: 'ACCEPTED', session_id: sessionId, direction: 'rtl' });

    const tablet = await Client.open(`${wsBase}/ws/tablet`, { auth: paired.body.token });
    const cockpit = await Client.open(`${wsBase}/ws/cockpit`, { auth: token, session_id: sessionId });
    await cockpit.next((m) => isEvent('PEER_STATUS')(m) && (m as ControlEnvelope).payload !== null && ((m as ControlEnvelope).payload as { tablet: boolean }).tablet);

    // The cockpit dispatches; the gateway adds the canvas, fill order, timers and attempt number.
    cockpit.send(controlMessage('DISPATCH_STEP', { step_index: 0, step_type: 'ILT_BLOCK', attempt_number: 1 }));
    const dispatch = await tablet.next(isEvent('DISPATCH_STEP'));
    const dp = dispatch.payload as { attempt_number: number; fill_order: number[]; timers: { in_transition_sec: number }; canvas: { boxes: unknown[] } };
    expect(dp.attempt_number).toBe(1);
    expect(dp.fill_order).toEqual(ILT_PROFILE_HE.fill_order);
    expect(dp.canvas.boxes).toHaveLength(15);
    expect(dp.timers.in_transition_sec).toBe(20);

    const started = controlMessage('STEP_STARTED', { step_index: 0, attempt_number: 1, block_started_at: new Date().toISOString() });
    tablet.send(started);
    await tablet.next((m) => isEvent('ACK')(m) && ((m as ControlEnvelope).payload as { ack_of: string }).ack_of === started.message_id);
    await cockpit.next(isEvent('STEP_STARTED'));

    // Three letters in the first three boxes of the Hebrew fill order.
    const boxes = ILT_PROFILE_HE.fill_order.slice(0, 3).map((id) => ILT_GRID_GEOMETRY.boxes.find((b) => b.id === id)!);
    const samples: PenSample[] = synthBlock(boxes.map((box) => ({ box, spec: PERFECT_ILT })));
    const header = { session_id: sessionId, step_index: 0, attempt_number: 1 };
    const half = Math.floor(samples.length / 2);
    const batches = [samples.slice(0, half), samples.slice(half)];
    for (const [sequence, part] of batches.entries()) {
      tablet.ws.send(encodePacket({ ...header, packet_type: PacketType.BATCH, sequence, samples: part }));
      await tablet.next((m) => isEvent('BATCH_ACK')(m) && ((m as ControlEnvelope).payload as { sequence: number }).sequence === sequence);
    }
    // A resent batch (e.g. after a reconnect) is acknowledged and stored once.
    tablet.ws.send(encodePacket({ ...header, packet_type: PacketType.BATCH, sequence: 0, samples: batches[0]! }));
    await tablet.next(isEvent('BATCH_ACK'));

    // LIVE packets reach the cockpit through the gateway when there is no direct channel.
    const live = encodePacket({ ...header, packet_type: PacketType.LIVE, sequence: 0, samples: samples.slice(0, 4) });
    tablet.ws.send(live);
    const relayed = await cockpit.next<Uint8Array>((m) => m instanceof Uint8Array);
    expect(Buffer.from(relayed).equals(Buffer.from(live))).toBe(true);

    tablet.send(controlMessage('BLOCK_COMPLETE', {
      step_index: 0, attempt_number: 1, end_reason: 'MANUAL', sample_count: samples.length,
      last_sample_seq: samples[samples.length - 1]!.sample_seq,
      sha256: createHash('sha256').update(encodeSampleRecords(samples)).digest('hex'),
    }));
    const stored = await cockpit.next(isEvent('BLOCK_STORED'));
    expect(stored.payload).toMatchObject({ step_index: 0, attempt_number: 1, sample_count: samples.length, integrity_ok: true });

    const after = await call<{ status: string; steps: { status: string }[]; attempts: { status: string; sample_count: number; integrity_ok: boolean }[] }>(`/sessions/${sessionId}`, { auth: token });
    expect(after.body.status).toBe('IN_PROGRESS');
    expect(after.body.steps[0]!.status).toBe('DONE');
    expect(after.body.attempts[0]).toMatchObject({ status: 'MANUAL_FINISH', sample_count: samples.length, integrity_ok: true });

    // Abort reaches the tablet and closes the session; the stored block stays.
    cockpit.send(controlMessage('ABORT_SESSION', { reason: 'TEST', save_partial: true }));
    await tablet.next(isEvent('ABORT_SESSION'));
    const aborted = await call<{ status: string }>(`/sessions/${sessionId}`, { auth: token });
    expect(aborted.body.status).toBe('ABORTED');

    await app.appLog.flush();
    const events = await pool.query<{ event_type: string }>('SELECT event_type FROM app_events WHERE session_id = $1', [sessionId]);
    expect(events.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining([
      'session.created', 'session.paired', 'session.step.dispatched', 'session.step.started',
      'session.block.manual_finish', 'session.aborted',
    ]));
    tablet.ws.close();
    cockpit.ws.close();
  });
});
