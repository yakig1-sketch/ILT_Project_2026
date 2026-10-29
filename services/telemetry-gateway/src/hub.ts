// Real-time hub (DDD §5.1, §11). One room per session with the paired tablet and the evaluator's
// cockpit(s). The gateway is the relay for control events and WebRTC signalling, persists every
// BATCH packet before acknowledging it, and verifies each completed block.
//
// Socket protocol: the first text message authenticates ({ auth: token }, plus session_id for a
// cockpit). After that, text messages are control-event envelopes or { signal } relays, and binary
// messages are emr-protocol packets (BATCH for persistence, LIVE as the mirror fallback).
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { decodePacket, PacketError, PacketType } from '@ilt/emr-protocol';
import {
  ControlEnvelope,
  ControlPayloads,
  SignalMessage,
  UNACKED_EVENTS,
  controlMessage,
  parseControlMessage,
  type ControlEventName,
  type ControlPayload,
} from '@ilt/shared-types';
import { mirrorCanvas } from '@ilt/template-schemas';
import type { TokenClaims } from './auth.js';
import { loadSession, loadSteps, timersFrom, type StepRow } from './routes/sessions.js';
import type { SettingsSnapshot } from './settings-store.js';
import { findAttempt, finishAttempt, insertSamples, startAttempt, storedSampleCount, type AttemptRef } from './telemetry-store.js';

const WRITING_STEPS = new Set(['WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE']);
const AUTH_TIMEOUT_MS = 5000;

type BlockComplete = ControlPayload<'BLOCK_COMPLETE'>;

interface Room {
  tablet?: WebSocket;
  cockpits: Set<WebSocket>;
  attempts: Map<string, AttemptRef>;
  /** BLOCK_COMPLETE received, waiting for the remaining batches. */
  pending: Map<string, BlockComplete>;
  linkLost: boolean;
  /** The block in progress, replayed to a cockpit that (re)connects mid-block. */
  activeBlock?: { dispatch: ControlEnvelope; started?: ControlEnvelope };
}

const attemptKey = (step: number, attempt: number) => `${step}:${attempt}`;

/** DISPATCH_STEP as the tablet receives it: resolved canvas (with mirroring), fill order and timers. */
function dispatchPayload(step: StepRow, attemptNumber: number, snapshot: SettingsSnapshot): ControlPayload<'DISPATCH_STEP'> {
  return ControlPayloads.DISPATCH_STEP.parse({
    step_index: step.step_index,
    step_type: step.step_type,
    attempt_number: attemptNumber,
    canvas: step.mirrored ? mirrorCanvas(step.geometry!) : step.geometry,
    fill_order: step.fill_order,
    timers: timersFrom(snapshot),
  });
}

export class Hub {
  private rooms = new Map<string, Room>();

  constructor(private readonly app: FastifyInstance) {}

  private room(sessionId: string): Room {
    let r = this.rooms.get(sessionId);
    if (!r) {
      r = { cockpits: new Set(), attempts: new Map(), pending: new Map(), linkLost: false };
      this.rooms.set(sessionId, r);
    }
    return r;
  }

  private get db() {
    return this.app.deps.db;
  }

  private log(event: Parameters<FastifyInstance['appLog']['write']>[0]) {
    this.app.appLog.write(event);
  }

  // ---- connection handling -------------------------------------------------------------------

  /** Accepts a socket, waits for its auth message, then routes messages in arrival order. */
  accept(socket: WebSocket, kind: 'tablet' | 'cockpit', clientIp: string): void {
    let sessionId: string | undefined;
    let queue = Promise.resolve();
    const timer = setTimeout(() => socket.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      queue = queue
        .then(async () => {
          if (!sessionId) {
            sessionId = await this.authenticate(socket, kind, isBinary ? null : data.toString('utf8'), clientIp);
            if (sessionId) clearTimeout(timer);
            return;
          }
          if (isBinary) {
            if (kind === 'tablet') await this.onTabletPacket(sessionId, socket, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
          } else {
            await this.onText(sessionId, kind, socket, data.toString('utf8'));
          }
        })
        .catch((err: unknown) => {
          this.app.log.error({ err, kind, sessionId }, 'hub message failed');
          this.log({ severity: 'ERROR', event_type: 'system.error', session_id: sessionId ?? null, message: `Hub ${kind} message failed: ${(err as Error).message}` });
        });
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (!sessionId) return;
      const r = this.room(sessionId);
      if (kind === 'tablet' && r.tablet === socket) {
        r.tablet = undefined;
        void this.onTabletLost(sessionId);
      }
      if (kind === 'cockpit') r.cockpits.delete(socket);
      this.notifyPeers(sessionId);
    });
  }

  private async authenticate(socket: WebSocket, kind: 'tablet' | 'cockpit', text: string | null, clientIp: string): Promise<string | undefined> {
    const reject = (reason: string) => {
      socket.close(4401, reason);
      return undefined;
    };
    if (!text) return reject('auth expected');
    let msg: { auth?: unknown; session_id?: unknown };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return reject('bad auth');
    }
    let claims: TokenClaims;
    try {
      claims = this.app.jwt.verify<TokenClaims>(String(msg.auth));
    } catch {
      return reject('bad token');
    }

    if (kind === 'tablet') {
      if (claims.typ !== 'tablet') return reject('wrong token');
      const r = this.room(claims.session_id);
      if (r.tablet && r.tablet !== socket) r.tablet.close(4409, 'replaced');
      r.tablet = socket;
      if (r.linkLost) {
        r.linkLost = false;
        this.log({ severity: 'INFO', event_type: 'session.link.restored', session_id: claims.session_id, client_ip: clientIp, message: 'Tablet link restored' });
      }
      this.notifyPeers(claims.session_id);
      return claims.session_id;
    }

    if (claims.typ !== 'access' || !['EVALUATOR', 'RESEARCHER', 'ADMIN'].includes(claims.role)) return reject('wrong token');
    const sessionId = String(msg.session_id ?? '');
    const s = /^[0-9a-f-]{36}$/i.test(sessionId) ? await loadSession(this.db, sessionId) : undefined;
    if (!s || (claims.role === 'EVALUATOR' && s.evaluator_id !== claims.sub)) return reject('no such session');
    const r = this.room(sessionId);
    r.cockpits.add(socket);
    this.notifyPeers(sessionId);
    r.activeBlock ??= await this.activeBlockFromDb(sessionId);
    if (r.activeBlock) {
      this.sendTo(socket, r.activeBlock.dispatch);
      if (r.activeBlock.started) this.sendTo(socket, r.activeBlock.started);
    }
    return sessionId;
  }

  /** After a gateway restart: the block still active in the database, so a cockpit can follow and finish it. */
  private async activeBlockFromDb(sessionId: string): Promise<Room['activeBlock']> {
    const session = await loadSession(this.db, sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'ABORTED') return undefined;
    const active = await this.db.query(
      `SELECT st.step_index, ba.attempt_number, ba.started_at FROM block_attempts ba
         JOIN session_steps st ON st.id = ba.session_step_id
        WHERE st.session_id = $1 AND st.status = 'ACTIVE' AND ba.status = 'ACTIVE'
        ORDER BY ba.started_at DESC LIMIT 1`,
      [sessionId],
    ) as { rows: { step_index: number; attempt_number: number; started_at: Date }[] };
    const a = active.rows[0];
    const step = a && (await loadSteps(this.db, sessionId)).find((s) => s.step_index === a.step_index);
    if (!a || !step) return undefined;
    return {
      dispatch: controlMessage('DISPATCH_STEP', dispatchPayload(step, a.attempt_number, session.settings_snapshot)),
      started: controlMessage('STEP_STARTED', { step_index: a.step_index, attempt_number: a.attempt_number, block_started_at: new Date(a.started_at).toISOString() }),
    };
  }

  private async onTabletLost(sessionId: string) {
    const s = await loadSession(this.db, sessionId);
    if (!s || s.status === 'COMPLETED' || s.status === 'ABORTED') return;
    this.room(sessionId).linkLost = true;
    this.log({ severity: 'WARN', event_type: 'session.link.lost', session_id: sessionId, message: 'Tablet link lost; the tablet keeps buffering' });
  }

  /** Tells every connected end which ends are present. */
  notifyPeers(sessionId: string): void {
    const r = this.room(sessionId);
    const msg = controlMessage('PEER_STATUS', { tablet: !!r.tablet, cockpit: r.cockpits.size > 0 });
    this.sendTo(r.tablet, msg);
    for (const c of r.cockpits) this.sendTo(c, msg);
  }

  private sendTo(socket: WebSocket | undefined, msg: unknown): boolean {
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }

  private toCockpits(sessionId: string, msg: unknown): void {
    for (const c of this.room(sessionId).cockpits) this.sendTo(c, msg);
  }

  private ack(socket: WebSocket, envelope: ControlEnvelope) {
    if (!UNACKED_EVENTS.has(envelope.event)) this.sendTo(socket, controlMessage('ACK', { ack_of: envelope.message_id }));
  }

  private error(socket: WebSocket, ref: string | undefined, code: string, message: string) {
    this.sendTo(socket, controlMessage('ERROR', { ref, code, message }));
  }

  // ---- text messages ---------------------------------------------------------------------------

  private async onText(sessionId: string, kind: 'tablet' | 'cockpit', socket: WebSocket, text: string) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.error(socket, undefined, 'BAD_JSON', 'Message is not JSON');
    }
    const signal = SignalMessage.safeParse(raw);
    if (signal.success) {
      const r = this.room(sessionId);
      if (kind === 'cockpit') this.sendTo(r.tablet, signal.data);
      else this.toCockpits(sessionId, signal.data);
      return;
    }
    let parsed: ReturnType<typeof parseControlMessage>;
    try {
      parsed = parseControlMessage(raw);
    } catch (err) {
      const ref = (raw as { message_id?: string } | null)?.message_id;
      return this.error(socket, typeof ref === 'string' ? ref : undefined, 'BAD_MESSAGE', (err as Error).message.slice(0, 300));
    }
    if (kind === 'tablet') await this.onTabletEvent(sessionId, socket, parsed.envelope, parsed.payload);
    else await this.onCockpitEvent(sessionId, socket, parsed.envelope, parsed.payload);
  }

  private async onTabletEvent(sessionId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const r = this.room(sessionId);
    switch (env.event) {
      case 'STEP_STARTED': {
        const p = payload as ControlPayload<'STEP_STARTED'>;
        const attempt = await startAttempt(this.db, sessionId, p.step_index, p.attempt_number, p.block_started_at);
        if (!attempt) return this.error(socket, env.message_id, 'NO_STEP', `No step ${p.step_index}`);
        r.attempts.set(attemptKey(p.step_index, p.attempt_number), attempt);
        if (r.activeBlock) r.activeBlock.started = env;
        await this.db.query("UPDATE session_steps SET started_at = coalesce(started_at, $3) WHERE session_id = $1 AND step_index = $2", [sessionId, p.step_index, p.block_started_at]);
        this.log({ severity: 'INFO', event_type: 'session.step.started', session_id: sessionId, entity_type: 'block_attempt', entity_id: attempt.id, message: `Block started: step ${p.step_index}, attempt ${p.attempt_number}`, details: p });
        break;
      }
      case 'BOX_ADVANCED': {
        const p = payload as ControlPayload<'BOX_ADVANCED'>;
        this.log({ severity: 'INFO', event_type: 'session.box.advanced', session_id: sessionId, message: `Box ${p.box_id} active (fill position ${p.fill_position})`, details: p });
        break;
      }
      case 'BLOCK_COMPLETE': {
        const p = payload as BlockComplete;
        r.pending.set(attemptKey(p.step_index, p.attempt_number), p);
        r.activeBlock = undefined;
        this.log({
          severity: 'INFO', event_type: p.end_reason === 'MANUAL' ? 'session.block.manual_finish' : 'session.block.completed', session_id: sessionId,
          message: `Block complete: step ${p.step_index}, attempt ${p.attempt_number}, ${p.sample_count} samples (${p.end_reason})`, details: p,
        });
        break;
      }
      case 'ACK':
      case 'ERROR':
      case 'INACTIVITY_ALERT':
        break;
      default:
        return this.error(socket, env.message_id, 'NOT_ALLOWED', `${env.event} is not a tablet event`);
    }
    this.ack(socket, env);
    this.toCockpits(sessionId, env);
    if (env.event === 'BLOCK_COMPLETE') {
      const p = payload as BlockComplete;
      await this.tryFinish(sessionId, p.step_index, p.attempt_number);
    }
  }

  private async onCockpitEvent(sessionId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const r = this.room(sessionId);
    const session = await loadSession(this.db, sessionId);
    if (!session) return this.error(socket, env.message_id, 'NO_SESSION', 'Session not found');
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      return this.error(socket, env.message_id, 'SESSION_CLOSED', 'Session is closed');
    }
    const needsTablet: ControlEventName[] = ['DISPATCH_STEP', 'PAUSE_SESSION', 'RESUME_SESSION', 'MANUAL_FINISH'];
    if (needsTablet.includes(env.event) && !r.tablet) {
      return this.error(socket, env.message_id, 'TABLET_OFFLINE', 'The tablet is not connected');
    }

    let forward: ControlEnvelope = env;
    switch (env.event) {
      case 'DISPATCH_STEP': {
        const p = payload as ControlPayload<'DISPATCH_STEP'>;
        const step = (await loadSteps(this.db, sessionId)).find((s) => s.step_index === p.step_index);
        if (!step || !WRITING_STEPS.has(step.step_type) || !step.geometry || !step.fill_order) {
          return this.error(socket, env.message_id, 'NOT_DISPATCHABLE', 'This step is not a writing step');
        }
        if (step.status === 'DONE' || step.status === 'SKIPPED') {
          return this.error(socket, env.message_id, 'STEP_DONE', 'This step is already finished');
        }
        const last = await this.db.query(
          `SELECT coalesce(max(attempt_number), 0) AS n FROM block_attempts WHERE session_step_id = $1`,
          [step.id],
        ) as { rows: { n: number }[] };
        const attemptNumber = Number(last.rows[0]?.n ?? 0) + 1;
        // A block left active (tablet restarted mid-block) is closed; its samples stay stored.
        await this.db.query("UPDATE block_attempts SET status = 'ABORTED', ended_at = now() WHERE session_step_id = $1 AND status = 'ACTIVE'", [step.id]);
        await this.db.query("UPDATE session_steps SET status = 'ACTIVE' WHERE id = $1", [step.id]);
        await this.db.query(
          "UPDATE sessions SET status = 'IN_PROGRESS', started_at = coalesce(started_at, now()) WHERE id = $1 AND status IN ('PAIRED', 'IN_PROGRESS', 'PAUSED')",
          [sessionId],
        );
        forward = { ...env, payload: dispatchPayload(step, attemptNumber, session.settings_snapshot) };
        r.activeBlock = { dispatch: forward };
        this.log({ severity: 'INFO', event_type: 'session.step.dispatched', session_id: sessionId, entity_type: 'session_step', entity_id: step.id, message: `Step ${step.step_index} (${step.step_type}) dispatched, attempt ${attemptNumber}`, details: { step_index: step.step_index, attempt_number: attemptNumber, canvas: step.canvas_code, mirrored: step.mirrored } });
        break;
      }
      case 'PAUSE_SESSION': {
        const p = payload as ControlPayload<'PAUSE_SESSION'>;
        await this.db.query("UPDATE sessions SET status = 'PAUSED' WHERE id = $1", [sessionId]);
        this.log({ severity: 'INFO', event_type: 'session.paused', session_id: sessionId, message: `Session paused (${p.reason})`, details: p });
        break;
      }
      case 'RESUME_SESSION':
        await this.db.query("UPDATE sessions SET status = 'IN_PROGRESS' WHERE id = $1", [sessionId]);
        this.log({ severity: 'INFO', event_type: 'session.resumed', session_id: sessionId, message: 'Session resumed' });
        break;
      case 'MANUAL_FINISH':
        break;
      case 'ABORT_SESSION': {
        const p = payload as ControlPayload<'ABORT_SESSION'>;
        await this.db.query("UPDATE sessions SET status = 'ABORTED', abort_reason = $2, completed_at = now() WHERE id = $1", [sessionId, p.reason.slice(0, 50)]);
        await this.db.query(
          `UPDATE block_attempts SET status = 'ABORTED', ended_at = now()
            WHERE status = 'ACTIVE' AND session_step_id IN (SELECT id FROM session_steps WHERE session_id = $1)`,
          [sessionId],
        );
        r.activeBlock = undefined;
        this.log({ severity: 'WARN', event_type: 'session.aborted', session_id: sessionId, message: `Session aborted: ${p.reason}`, details: p });
        break;
      }
      case 'ACK':
      case 'ERROR':
        this.sendTo(r.tablet, env);
        return;
      default:
        return this.error(socket, env.message_id, 'NOT_ALLOWED', `${env.event} is not a cockpit event in this phase`);
    }
    this.sendTo(r.tablet, forward);
    // Every cockpit sees what was sent (the dispatch carries the canvas for the mirror).
    for (const c of r.cockpits) this.sendTo(c, forward);
    this.ack(socket, env);
  }

  /** Ends the session when no step is left (gateway → all: SESSION_COMPLETE). */
  async completeSession(sessionId: string): Promise<boolean> {
    const steps = await loadSteps(this.db, sessionId);
    if (steps.some((s) => s.status === 'PENDING' || s.status === 'ACTIVE')) return false;
    const done = steps.filter((s) => s.status === 'DONE').length;
    await this.db.query("UPDATE sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1", [sessionId]);
    this.log({ severity: 'INFO', event_type: 'session.completed', session_id: sessionId, message: `Session completed (${done} steps done)`, details: { completed_steps: done } });
    const msg = controlMessage('SESSION_COMPLETE', { session_id: sessionId, completed_steps: done });
    const r = this.room(sessionId);
    this.sendTo(r.tablet, msg);
    for (const c of r.cockpits) this.sendTo(c, msg);
    return true;
  }

  // ---- binary packets --------------------------------------------------------------------------

  private async onTabletPacket(sessionId: string, socket: WebSocket, bytes: Uint8Array) {
    let packet: ReturnType<typeof decodePacket>;
    try {
      packet = decodePacket(bytes);
    } catch (err) {
      const code = err instanceof PacketError ? err.code : 'UNKNOWN';
      this.log({ severity: 'WARN', event_type: 'telemetry.batch.rejected', session_id: sessionId, message: `Packet rejected: ${code}`, details: { code, bytes: bytes.length } });
      return;
    }
    if (packet.session_id !== sessionId) {
      this.log({ severity: 'WARN', event_type: 'telemetry.batch.rejected', session_id: sessionId, message: 'Packet for another session', details: { code: 'WRONG_SESSION' } });
      return;
    }
    const r = this.room(sessionId);
    if (packet.packet_type === PacketType.LIVE) {
      // Fallback mirror path when the direct WebRTC channel is not open.
      for (const c of r.cockpits) if (c.readyState === c.OPEN) c.send(bytes);
      return;
    }

    const key = attemptKey(packet.step_index, packet.attempt_number);
    let attempt = r.attempts.get(key);
    if (!attempt) {
      attempt = await findAttempt(this.db, sessionId, packet.step_index, packet.attempt_number);
      if (!attempt) return; // STEP_STARTED not stored yet: no ACK, the tablet resends.
      r.attempts.set(key, attempt);
    }
    await insertSamples(this.db, attempt, packet.samples);
    this.sendTo(socket, controlMessage('BATCH_ACK', { step_index: packet.step_index, attempt_number: packet.attempt_number, sequence: packet.sequence }));
    if (r.pending.has(key)) await this.tryFinish(sessionId, packet.step_index, packet.attempt_number);
  }

  /** Finishes a completed block once all its samples are stored, then tells the cockpit. */
  private async tryFinish(sessionId: string, stepIndex: number, attemptNumber: number) {
    const r = this.room(sessionId);
    const key = attemptKey(stepIndex, attemptNumber);
    const complete = r.pending.get(key);
    const attempt = r.attempts.get(key) ?? (await findAttempt(this.db, sessionId, stepIndex, attemptNumber));
    if (!complete || !attempt) return;
    if ((await storedSampleCount(this.db, attempt.id)) < complete.sample_count) return;
    r.pending.delete(key);
    const { integrity_ok, stored } = await finishAttempt(this.db, attempt.id, complete);
    if (!integrity_ok) {
      this.log({ severity: 'ERROR', event_type: 'telemetry.integrity.failed', session_id: sessionId, entity_type: 'block_attempt', entity_id: attempt.id, message: `Block integrity check failed: step ${stepIndex}, attempt ${attemptNumber}`, details: { expected: complete.sample_count, stored } });
    }
    this.toCockpits(sessionId, controlMessage('BLOCK_STORED', {
      block_attempt_id: attempt.id, step_index: stepIndex, attempt_number: attemptNumber, sample_count: stored, integrity_ok,
    }));
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub;
  }
}
