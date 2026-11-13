// Real-time hub (DDD §5.1, §11). One room per session with the paired tablet and the evaluator's
// cockpit(s). The gateway is the relay for control events and WebRTC signalling, persists every
// BATCH packet before acknowledging it, verifies and scores each completed block, and runs the
// video steps (the tablet plays the session-language video).
//
// Socket protocol: the first text message authenticates ({ auth: token }, plus session_id for a
// cockpit). After that, text messages are control-event envelopes or { signal } relays, and binary
// messages are emr-protocol packets (BATCH for persistence, LIVE as the mirror fallback).
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { createHash } from 'node:crypto';
import { decodePacket, encodeSampleRecords, PacketError, PacketType } from '@ilt/emr-protocol';
import {
  ControlEnvelope,
  ControlPayloads,
  SignalMessage,
  UNACKED_EVENTS,
  controlMessage,
  parseControlMessage,
  type ControlEventName,
  type ControlPayload,
  type PenSample,
} from '@ilt/shared-types';
import { mirrorCanvas } from '@ilt/template-schemas';
import type { TokenClaims, UserClaims } from './auth.js';
import { one } from './db.js';
import { loadSession, loadSteps, timersFrom, type SessionRow, type StepRow } from './routes/sessions.js';
import { deriveRecording, loadReferenceCanvas, packSamples, type RecordingKind, type ReferenceCanvas, type ReferenceKind } from './reference-store.js';
import { storeSuggestedMarks } from './marks-store.js';
import { scoreAttempt } from './scoring-store.js';
import type { SettingsSnapshot } from './settings-store.js';
import { findAttempt, finishAttempt, insertSamples, startAttempt, storedSampleCount, type AttemptRef } from './telemetry-store.js';

const WRITING_STEPS = new Set(['WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE', 'INTERVENTION_SHEET']);
/** Steps measured for time and pen lifts only: notebook pages (FR-PLAN-5) and, until sheet scoring (Phase 5d), intervention sheets. */
const TIMED_ONLY = new Set(['NOTEBOOK_PAGE', 'INTERVENTION_SHEET']);
const AUTH_TIMEOUT_MS = 5000;

type BlockComplete = ControlPayload<'BLOCK_COMPLETE'>;

interface Room {
  tablet?: WebSocket;
  cockpits: Set<WebSocket>;
  attempts: Map<string, AttemptRef>;
  /** BLOCK_COMPLETE received, waiting for the remaining batches. */
  pending: Map<string, BlockComplete>;
  linkLost: boolean;
  /**
   * The block in progress, replayed to a cockpit that (re)connects mid-block. `tablet` is the
   * connection it was sent on: a tablet that reconnects on a new connection without it lost it.
   */
  activeBlock?: { dispatch: ControlEnvelope; started?: ControlEnvelope; tablet?: WebSocket };
  /** The video step playing on the tablet (VIDEO_PLAY as sent), replayed to a cockpit that connects. */
  activeVideo?: ControlEnvelope;
  /** Set for a reference station's room (reference mode, FR-TAB-8); the room id is the station id. */
  ref?: { attempt: number; run?: ReferenceRun };
}

/** One canvas shown or recorded on a reference-mode tablet. */
interface ReferenceRun {
  kind: ReferenceKind;
  canvas: ReferenceCanvas;
  rows: number;
  writer_label: string | null;
  by: UserClaims;
  attempt: number;
  dispatch: ControlEnvelope;
  /** The tablet connection the run was sent on (a tablet that restarts loses it). */
  tablet?: WebSocket;
  batches: Map<number, PenSample[]>;
  complete?: BlockComplete;
}

const attemptKey = (step: number, attempt: number) => `${step}:${attempt}`;

/** DISPATCH_STEP as the tablet receives it: resolved canvas (with mirroring), fill order, timers and block position. */
function dispatchPayload(step: StepRow, attemptNumber: number, snapshot: SettingsSnapshot, steps: StepRow[]): ControlPayload<'DISPATCH_STEP'> {
  const sameType = steps.filter((s) => s.step_type === step.step_type);
  return ControlPayloads.DISPATCH_STEP.parse({
    step_index: step.step_index,
    step_type: step.step_type,
    attempt_number: attemptNumber,
    canvas: step.mirrored ? mirrorCanvas(step.geometry!) : step.geometry,
    fill_order: step.fill_order,
    timers: timersFrom(snapshot),
    block_number: sameType.findIndex((s) => s.step_index === step.step_index) + 1,
    block_count: sameType.length,
    // A sheet's profile describes its letters: the cockpit uses it for the live marks of each row (Phase 5c).
    ...(step.profile && { profile: step.profile }),
  });
}

/** Where the tablet streams an instruction video from (gateway media route, DDD §14). */
export const videoUrl = (videoId: string) => `/api/v1/media/videos/${videoId}`;

export class Hub {
  private rooms = new Map<string, Room>();
  /** Who is signed in on each cockpit socket (reference mode records who made a recording). */
  private readonly cockpitUsers = new WeakMap<WebSocket, UserClaims>();

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
      if (claims.ref) {
        const station = await one<{ tablet_token_id: string | null }>(this.db,
          'SELECT tablet_token_id FROM reference_stations WHERE id = $1 AND closed_at IS NULL', [claims.session_id]);
        if (!station || !claims.tid || station.tablet_token_id !== claims.tid) return reject('released');
        const r = this.room(claims.session_id);
        r.ref ??= { attempt: 0 };
        if (r.tablet && r.tablet !== socket) r.tablet.close(4409, 'replaced');
        r.tablet = socket;
        this.notifyPeers(claims.session_id);
        return claims.session_id;
      }
      // Only the session's current pairing: a released tablet (or an older pairing) goes back to the PIN screen.
      const current = await one<{ status: string; tablet_token_id: string | null }>(
        this.db, 'SELECT status, tablet_token_id FROM sessions WHERE id = $1', [claims.session_id],
      );
      if (!current || !claims.tid || current.tablet_token_id !== claims.tid) return reject('released');
      const r = this.room(claims.session_id);
      if (r.tablet && r.tablet !== socket) r.tablet.close(4409, 'replaced');
      r.tablet = socket;
      if (r.linkLost) {
        r.linkLost = false;
        this.log({ severity: 'INFO', event_type: 'session.link.restored', session_id: claims.session_id, client_ip: clientIp, message: 'Tablet link restored' });
      }
      this.notifyPeers(claims.session_id);
      // The session ended while the tablet was away: it sends what it still holds, shows the end and returns to the PIN screen.
      if (current.status === 'COMPLETED') {
        this.sendTo(socket, controlMessage('SESSION_COMPLETE', { session_id: claims.session_id, completed_steps: await this.doneSteps(claims.session_id) }));
      } else if (current.status === 'ABORTED') {
        this.sendTo(socket, controlMessage('ABORT_SESSION', { reason: 'SESSION_ABORTED', save_partial: true }));
      }
      // A tablet that reloaded during a video plays it again (the kiosk ignores a repeat of the one it is playing).
      else if (r.activeVideo) this.sendTo(socket, r.activeVideo);
      return claims.session_id;
    }

    if (claims.typ !== 'access' || !['EVALUATOR', 'RESEARCHER', 'ADMIN'].includes(claims.role)) return reject('wrong token');
    this.cockpitUsers.set(socket, claims);
    const referenceId = String((msg as { reference_id?: unknown }).reference_id ?? '');
    if (referenceId) {
      // The Administrator cockpit's reference station (its own stations only).
      const station = claims.role === 'ADMIN' && /^[0-9a-f-]{36}$/i.test(referenceId)
        ? await one(this.db, 'SELECT 1 FROM reference_stations WHERE id = $1 AND created_by = $2 AND closed_at IS NULL', [referenceId, claims.sub])
        : undefined;
      if (!station) return reject('no such station');
      const r = this.room(referenceId);
      r.ref ??= { attempt: 0 };
      r.cockpits.add(socket);
      this.notifyPeers(referenceId);
      if (r.ref.run && !r.ref.run.complete) this.sendTo(socket, r.ref.run.dispatch);
      return referenceId;
    }
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
    if (r.activeVideo) this.sendTo(socket, r.activeVideo);
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
    const steps = a ? await loadSteps(this.db, sessionId) : [];
    const step = a && steps.find((s) => s.step_index === a.step_index);
    if (!a || !step) return undefined;
    return {
      dispatch: controlMessage('DISPATCH_STEP', dispatchPayload(step, a.attempt_number, session.settings_snapshot, steps)),
      started: controlMessage('STEP_STARTED', { step_index: a.step_index, attempt_number: a.attempt_number, block_started_at: new Date(a.started_at).toISOString() }),
    };
  }

  private async onTabletLost(sessionId: string) {
    const s = await loadSession(this.db, sessionId);
    // A quick reload reconnects the tablet while the session is being looked up.
    if (!s || s.status === 'COMPLETED' || s.status === 'ABORTED' || this.room(sessionId).tablet) return;
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
    if (this.room(sessionId).ref) {
      if (kind === 'tablet') await this.onReferenceTablet(sessionId, socket, parsed.envelope, parsed.payload);
      else await this.onReferenceCockpit(sessionId, socket, parsed.envelope, parsed.payload);
      return;
    }
    if (kind === 'tablet') await this.onTabletEvent(sessionId, socket, parsed.envelope, parsed.payload);
    else await this.onCockpitEvent(sessionId, socket, parsed.envelope, parsed.payload);
  }

  private async onTabletEvent(sessionId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const r = this.room(sessionId);
    switch (env.event) {
      case 'TABLET_STATUS':
        // Gateway-only: not acknowledged and not forwarded.
        return this.onTabletStatus(sessionId, socket, payload as ControlPayload<'TABLET_STATUS'>);
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
      case 'INACTIVITY_ALERT': {
        const p = payload as ControlPayload<'INACTIVITY_ALERT'>;
        this.log({
          severity: p.level === 'AMBER' ? 'WARN' : 'INFO', event_type: p.level === 'AMBER' ? 'session.inactivity.amber' : 'session.inactivity.cue',
          session_id: sessionId, message: `Inactivity ${p.level.toLowerCase()}: ${Math.round(p.idle_ms / 1000)} s without writing (box ${p.box_id})`, details: p,
        });
        break;
      }
      case 'VIDEO_ENDED':
        await this.endVideo(sessionId, payload as ControlPayload<'VIDEO_ENDED'>);
        break;
      case 'ACK':
      case 'ERROR':
        break;
      default:
        return this.error(socket, env.message_id, 'NOT_ALLOWED', `${env.event} is not a tablet event`);
    }
    this.ack(socket, env);
    this.toCockpits(sessionId, env);
    if (env.event === 'BLOCK_COMPLETE') {
      const p = payload as BlockComplete;
      await this.tryFinish(sessionId, p.step_index, p.attempt_number);
      if (p.end_reason === 'NEXT_BLOCK') await this.dispatchNext(sessionId, p.step_index);
    }
  }

  /**
   * After a tablet (re)connects: if the running block was sent on an earlier connection and the
   * tablet no longer holds it (the page restarted), the attempt is closed (stored samples stay), the
   * step returns to PENDING and the cockpit can send it again. A network blip keeps the block.
   */
  private async onTabletStatus(sessionId: string, socket: WebSocket, p: ControlPayload<'TABLET_STATUS'>) {
    const r = this.room(sessionId);
    let active = r.activeBlock;
    if (!active) {
      // After a gateway restart the running block is only in the database.
      const fromDb = await this.activeBlockFromDb(sessionId);
      const d = fromDb?.dispatch.payload as ControlPayload<'DISPATCH_STEP'> | undefined;
      if (!fromDb || !d || r.pending.has(attemptKey(d.step_index, d.attempt_number))) return;
      active = r.activeBlock = fromDb;
    }
    if (active.tablet === socket) return;
    const d = active.dispatch.payload as ControlPayload<'DISPATCH_STEP'>;
    if (p.block?.step_index === d.step_index && p.block.attempt_number === d.attempt_number) {
      active.tablet = socket;
      return;
    }

    r.activeBlock = undefined;
    await this.db.query(
      `UPDATE block_attempts SET status = 'ABORTED', ended_at = now()
        WHERE status = 'ACTIVE' AND attempt_number = $3
          AND session_step_id = (SELECT id FROM session_steps WHERE session_id = $1 AND step_index = $2)`,
      [sessionId, d.step_index, d.attempt_number],
    );
    await this.db.query("UPDATE session_steps SET status = 'PENDING' WHERE session_id = $1 AND step_index = $2 AND status = 'ACTIVE'", [sessionId, d.step_index]);
    this.log({
      severity: 'WARN', event_type: 'session.block.interrupted', session_id: sessionId,
      message: `Block interrupted: the tablet restarted during step ${d.step_index}, attempt ${d.attempt_number}`,
      details: { step_index: d.step_index, attempt_number: d.attempt_number, tablet_block: p.block },
    });
    this.toCockpits(sessionId, controlMessage('BLOCK_INTERRUPTED', { step_index: d.step_index, attempt_number: d.attempt_number, reason: 'TABLET_RESTARTED' }));
  }

  /**
   * [Next block] on the tablet: dispatches the next pending step if it is a writing step. Videos and
   * paper steps, and the end of the session, stay with the evaluator.
   */
  private async dispatchNext(sessionId: string, afterStepIndex: number) {
    const session = await loadSession(this.db, sessionId);
    const r = this.room(sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'ABORTED' || !r.tablet) return;
    const next = (await loadSteps(this.db, sessionId)).find((s) => s.step_index > afterStepIndex && s.status === 'PENDING');
    if (!next || !WRITING_STEPS.has(next.step_type)) return;
    const forward = await this.prepareDispatch(sessionId, session, next.step_index, 'TABLET');
    if ('code' in forward) return;
    this.sendTo(r.tablet, forward);
    for (const c of r.cockpits) this.sendTo(c, forward);
  }

  /** Checks a step can be dispatched, opens its next attempt and builds the enriched DISPATCH_STEP. */
  private async prepareDispatch(
    sessionId: string,
    session: SessionRow,
    stepIndex: number,
    source: 'COCKPIT' | 'TABLET',
    base?: ControlEnvelope,
  ): Promise<ControlEnvelope | { code: string; message: string }> {
    const steps = await loadSteps(this.db, sessionId);
    const step = steps.find((s) => s.step_index === stepIndex);
    if (!step || !WRITING_STEPS.has(step.step_type) || !step.geometry || !step.fill_order) {
      return { code: 'NOT_DISPATCHABLE', message: 'This step is not a writing step' };
    }
    if (step.status === 'DONE' || step.status === 'SKIPPED') {
      return { code: 'STEP_DONE', message: 'This step is already finished' };
    }
    if (this.room(sessionId).activeVideo) return { code: 'VIDEO_PLAYING', message: 'A video is playing on the tablet' };
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
    const payload = { ...dispatchPayload(step, attemptNumber, session.settings_snapshot, steps), ...(source === 'TABLET' && { immediate: true }) };
    const forward = base ? { ...base, payload } : controlMessage('DISPATCH_STEP', payload);
    const r = this.room(sessionId);
    r.activeBlock = { dispatch: forward, tablet: r.tablet };
    const by = source === 'TABLET' ? ' from the tablet ([Next block])' : '';
    this.log({ severity: 'INFO', event_type: 'session.step.dispatched', session_id: sessionId, entity_type: 'session_step', entity_id: step.id, message: `Step ${step.step_index} (${step.step_type}) dispatched${by}, attempt ${attemptNumber}`, details: { step_index: step.step_index, attempt_number: attemptNumber, canvas: step.canvas_code, mirrored: step.mirrored, source } });
    return forward;
  }

  private async onCockpitEvent(sessionId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const r = this.room(sessionId);
    const session = await loadSession(this.db, sessionId);
    if (!session) return this.error(socket, env.message_id, 'NO_SESSION', 'Session not found');
    if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
      return this.error(socket, env.message_id, 'SESSION_CLOSED', 'Session is closed');
    }
    const needsTablet: ControlEventName[] = ['DISPATCH_STEP', 'PAUSE_SESSION', 'RESUME_SESSION', 'MANUAL_FINISH', 'REPEAT_BLOCK', 'VIDEO_PLAY'];
    if (needsTablet.includes(env.event) && !r.tablet) {
      return this.error(socket, env.message_id, 'TABLET_OFFLINE', 'The tablet is not connected');
    }

    let forward: ControlEnvelope = env;
    switch (env.event) {
      case 'DISPATCH_STEP': {
        const p = payload as ControlPayload<'DISPATCH_STEP'>;
        const prepared = await this.prepareDispatch(sessionId, session, p.step_index, 'COCKPIT', env);
        if ('code' in prepared) return this.error(socket, env.message_id, prepared.code, prepared.message);
        forward = prepared;
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
      case 'REPEAT_BLOCK': {
        const prepared = await this.repeatBlock(sessionId, session, payload as ControlPayload<'REPEAT_BLOCK'>);
        if ('code' in prepared) return this.error(socket, env.message_id, prepared.code, prepared.message);
        forward = prepared;
        break;
      }
      case 'VIDEO_PLAY': {
        const prepared = await this.playVideo(sessionId, session, (payload as ControlPayload<'VIDEO_PLAY'>).step_index, env);
        if ('code' in prepared) return this.error(socket, env.message_id, prepared.code, prepared.message);
        forward = prepared;
        break;
      }
      case 'VIDEO_ENDED':
        // The evaluator stops the video: the tablet closes it and the step is done.
        await this.endVideo(sessionId, payload as ControlPayload<'VIDEO_ENDED'>);
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
        r.activeVideo = undefined;
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

  /**
   * Repeat block (FR-COCK-3): the step's last finished attempt becomes REPEATED (kept for audit,
   * with its scores) and the step is sent again as the next attempt.
   */
  private async repeatBlock(sessionId: string, session: SessionRow, p: ControlPayload<'REPEAT_BLOCK'>): Promise<ControlEnvelope | { code: string; message: string }> {
    const r = this.room(sessionId);
    if (r.activeBlock || r.activeVideo) return { code: 'BLOCK_ACTIVE', message: 'Another step is running' };
    const last = await this.db.query(
      `SELECT ba.id, ba.attempt_number, st.id AS step_id FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id
        WHERE st.session_id = $1 AND st.step_index = $2 AND st.status = 'DONE'
          AND ba.status IN ('COMPLETED', 'MANUAL_FINISH', 'TIMED_OUT')
        ORDER BY ba.attempt_number DESC LIMIT 1`,
      [sessionId, p.step_index],
    ) as { rows: { id: string; attempt_number: number; step_id: string }[] };
    const a = last.rows[0];
    if (!a) return { code: 'NOT_REPEATABLE', message: 'Only a finished writing block can be repeated' };
    await this.db.query("UPDATE block_attempts SET status = 'REPEATED', repeat_reason = $2 WHERE id = $1", [a.id, p.reason.slice(0, 100)]);
    await this.db.query("UPDATE session_steps SET status = 'PENDING', completed_at = NULL WHERE id = $1", [a.step_id]);
    this.log({
      severity: 'INFO', event_type: 'session.block.repeated', session_id: sessionId, entity_type: 'block_attempt', entity_id: a.id,
      message: `Block repeated: step ${p.step_index}, attempt ${a.attempt_number} kept for audit (${p.reason})`, details: { ...p, attempt_number: a.attempt_number },
    });
    return this.prepareDispatch(sessionId, session, p.step_index, 'COCKPIT');
  }

  /** Video step (FR-PLAN-6/8): resolves the session-language video and tells the tablet to play it. */
  private async playVideo(sessionId: string, session: SessionRow, stepIndex: number, base: ControlEnvelope): Promise<ControlEnvelope | { code: string; message: string }> {
    const r = this.room(sessionId);
    if (r.activeBlock) return { code: 'BLOCK_ACTIVE', message: 'A block is running' };
    const step = (await loadSteps(this.db, sessionId)).find((s) => s.step_index === stepIndex);
    if (!step || step.step_type !== 'VIDEO' || !step.video_key) return { code: 'NOT_A_VIDEO', message: 'This step is not a video' };
    if (step.status === 'DONE' || step.status === 'SKIPPED') return { code: 'STEP_DONE', message: 'This step is already finished' };
    const video = await this.db.query(
      "SELECT id FROM instruction_videos WHERE video_key = $1 AND language_code = $2 AND status = 'ACTIVE'",
      [step.video_key, session.language_code],
    ) as { rows: { id: string }[] };
    const v = video.rows[0];
    if (!v) return { code: 'NO_VIDEO', message: `No ${session.language_code} version of video ${step.video_key}` };
    await this.db.query("UPDATE session_steps SET status = 'ACTIVE', started_at = coalesce(started_at, now()) WHERE id = $1", [step.id]);
    await this.db.query(
      "UPDATE sessions SET status = 'IN_PROGRESS', started_at = coalesce(started_at, now()) WHERE id = $1 AND status IN ('PAIRED', 'IN_PROGRESS', 'PAUSED')",
      [sessionId],
    );
    const forward = { ...base, payload: { step_index: stepIndex, video_key: step.video_key, language: session.language_code, url: videoUrl(v.id) } };
    r.activeVideo = forward;
    this.log({ severity: 'INFO', event_type: 'session.video.played', session_id: sessionId, entity_type: 'session_step', entity_id: step.id, message: `Video ${step.video_key} (${session.language_code}) playing, step ${stepIndex}`, details: { step_index: stepIndex, video_id: v.id } });
    return forward;
  }

  /** The video ended on the tablet, or the evaluator stopped it: the step is done. */
  private async endVideo(sessionId: string, p: ControlPayload<'VIDEO_ENDED'>) {
    const r = this.room(sessionId);
    const playing = r.activeVideo?.payload as ControlPayload<'VIDEO_PLAY'> | undefined;
    if (playing?.step_index !== p.step_index) return;
    r.activeVideo = undefined;
    await this.db.query(
      "UPDATE session_steps SET status = 'DONE', completed_at = now() WHERE session_id = $1 AND step_index = $2 AND status = 'ACTIVE'",
      [sessionId, p.step_index],
    );
    this.log({ severity: 'INFO', event_type: 'session.video.ended', session_id: sessionId, message: `Video ${playing.video_key} ${p.reason === 'STOPPED' ? 'stopped by the evaluator' : 'ended'}, step ${p.step_index}`, details: p });
  }

  /**
   * Releases the tablet from an unfinished session (Phase 2 QA): the pairing's token id is cleared, so
   * the tablet is turned away (4401) and returns to the PIN screen; the session can be paired again.
   * Refused while a block or video runs, so no writing is cut off.
   */
  async releaseTablet(sessionId: string, user: UserClaims): Promise<'RELEASED' | 'STEP_RUNNING'> {
    const r = this.room(sessionId);
    r.activeBlock ??= await this.activeBlockFromDb(sessionId);
    if (r.activeBlock || r.activeVideo) return 'STEP_RUNNING';
    await this.db.query(
      "UPDATE sessions SET tablet_token_id = NULL, status = CASE WHEN status = 'PAIRED' THEN 'PLANNED' ELSE status END WHERE id = $1",
      [sessionId],
    );
    const tablet = r.tablet;
    r.tablet = undefined;
    r.linkLost = false;
    tablet?.close(4401, 'released');
    this.log({
      severity: 'INFO', event_type: 'session.tablet.released', actor_user_id: user.sub, actor_role: user.role, session_id: sessionId,
      message: `Tablet released from the session (${tablet ? 'it was connected' : 'it was not connected'})`, details: { was_connected: !!tablet },
    });
    this.notifyPeers(sessionId);
    return 'RELEASED';
  }

  private async doneSteps(sessionId: string): Promise<number> {
    return (await loadSteps(this.db, sessionId)).filter((s) => s.status === 'DONE').length;
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

  // ---- reference mode (FR-CAN-6/9/10, FR-TAB-8) ------------------------------------------------

  /** Closes a reference station: its tablet returns to the PIN screen. */
  closeReferenceStation(stationId: string): void {
    const r = this.rooms.get(stationId);
    if (!r) return;
    const tablet = r.tablet;
    r.tablet = undefined;
    if (r.ref) r.ref.run = undefined;
    tablet?.close(4401, 'released');
    this.notifyPeers(stationId);
  }

  private async onReferenceCockpit(stationId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const r = this.room(stationId);
    const ref = r.ref!;
    switch (env.event) {
      case 'REFERENCE_START': {
        const p = payload as ControlPayload<'REFERENCE_START'>;
        if (!r.tablet) return this.error(socket, env.message_id, 'TABLET_OFFLINE', 'The tablet is not connected');
        if (ref.run && !ref.run.complete) return this.error(socket, env.message_id, 'BLOCK_ACTIVE', 'Finish the canvas on the tablet first');
        const canvas = await loadReferenceCanvas(this.db, p.canvas_id, p.kind, p.domain_id ?? null);
        if ('message' in canvas) return this.error(socket, env.message_id, canvas.code, canvas.message);
        // A finished recording whose samples never all arrived is dropped by the new run: say so in the log.
        if (ref.run?.complete && ref.run.kind !== 'PREVIEW') {
          const old = ref.run;
          this.logReferenceEnd(old, 'SAMPLES_MISSING',
            `${[...old.batches.values()].flat().length} of ${old.complete!.sample_count} samples arrived before the next run started`);
        }
        ref.attempt = (ref.attempt % 255) + 1;
        const rows = p.kind === 'NORMAL_SPEED' ? (p.rows ?? 1) : 0;
        const payloadOut = ControlPayloads.DISPATCH_STEP.parse({
          step_index: 0,
          step_type: canvas.geometry.canvas_type === 'NOTEBOOK' ? 'NOTEBOOK_PAGE' : 'ILT_BLOCK',
          attempt_number: ref.attempt,
          canvas: canvas.geometry,
          fill_order: canvas.fill_order,
          immediate: true,
          reference: { kind: p.kind, free_order: p.kind !== 'NORMAL_SPEED', ...(rows ? { rows } : {}) },
        });
        const dispatch = controlMessage('DISPATCH_STEP', payloadOut);
        const by = this.cockpitUsers.get(socket)!;
        ref.run = { kind: p.kind, canvas, rows, writer_label: p.writer_label || null, by, attempt: ref.attempt, dispatch, tablet: r.tablet, batches: new Map() };
        const what = p.kind === 'PREVIEW' ? 'True-size preview' : p.kind === 'SAMPLE_BLOCK_FILL' ? 'Sample block' : 'Normal speed sample';
        this.log({
          severity: 'INFO', event_type: 'canvas.reference.started', actor_user_id: by.sub, actor_role: by.role, entity_type: 'canvas', entity_id: canvas.id,
          message: `${what} of ${canvas.code} v${canvas.version} on the reference tablet${canvas.domain_code ? ` (${canvas.domain_code} profile)` : ''}`,
          details: { kind: p.kind, code: canvas.code, version: canvas.version, domain_id: canvas.domain_id, rows: rows || undefined },
        });
        this.sendTo(r.tablet, dispatch);
        for (const c of r.cockpits) this.sendTo(c, dispatch);
        return this.ack(socket, env);
      }
      case 'MANUAL_FINISH':
        if (!ref.run || ref.run.complete) return this.error(socket, env.message_id, 'NO_BLOCK', 'Nothing is shown on the tablet');
        if (!r.tablet) return this.error(socket, env.message_id, 'TABLET_OFFLINE', 'The tablet is not connected');
        this.sendTo(r.tablet, env);
        return this.ack(socket, env);
      case 'ACK':
      case 'ERROR':
        this.sendTo(r.tablet, env);
        return;
      default:
        return this.error(socket, env.message_id, 'NOT_ALLOWED', `${env.event} is not a reference-mode event`);
    }
  }

  private async onReferenceTablet(stationId: string, socket: WebSocket, env: ControlEnvelope, payload: unknown) {
    const ref = this.room(stationId).ref!;
    const run = ref.run;
    switch (env.event) {
      case 'TABLET_STATUS': {
        // A tablet that restarted mid-run has lost it: the administrator shows it again.
        const p = payload as ControlPayload<'TABLET_STATUS'>;
        if (!run || run.complete || run.tablet === socket) return;
        if (p.block?.attempt_number === run.attempt) {
          run.tablet = socket;
          return;
        }
        ref.run = undefined;
        if (run.kind !== 'PREVIEW') this.logReferenceEnd(run, 'TABLET_RESTARTED', 'the tablet restarted and lost the canvas');
        this.toCockpits(stationId, controlMessage('BLOCK_INTERRUPTED', { step_index: 0, attempt_number: run.attempt, reason: 'TABLET_RESTARTED' }));
        return;
      }
      case 'STEP_STARTED':
      case 'BOX_ADVANCED':
      case 'INACTIVITY_ALERT':
        break;
      case 'BLOCK_COMPLETE': {
        const p = payload as BlockComplete;
        if (run && p.attempt_number === run.attempt) run.complete = p;
        break;
      }
      case 'ACK':
      case 'ERROR':
        break;
      default:
        return this.error(socket, env.message_id, 'NOT_ALLOWED', `${env.event} is not a tablet event in reference mode`);
    }
    this.ack(socket, env);
    this.toCockpits(stationId, env);
    if (env.event === 'BLOCK_COMPLETE' && run?.complete) await this.finishReference(stationId, run);
  }

  /** A recording run that ended without a recording, so the log shows why nothing came back. */
  private logReferenceEnd(run: ReferenceRun, reason: 'EMPTY_RECORDING' | 'TABLET_RESTARTED' | 'SAMPLES_MISSING', why: string) {
    const what = run.kind === 'SAMPLE_BLOCK_FILL' ? 'Sample block' : 'Normal speed sample';
    this.log({
      severity: 'WARN', event_type: 'canvas.reference.ended', actor_user_id: run.by.sub, actor_role: run.by.role,
      entity_type: 'canvas', entity_id: run.canvas.id,
      message: `${what} on ${run.canvas.code} v${run.canvas.version} ended without a recording: ${why}`,
      details: { kind: run.kind, code: run.canvas.code, version: run.canvas.version, reason },
    });
  }

  /**
   * Once every sample of a finished run is in: a preview ends there; a recording is checked
   * (SHA-256), its values derived with the scoring code, stored PENDING and sent to the cockpit.
   */
  private async finishReference(stationId: string, run: ReferenceRun) {
    const r = this.room(stationId);
    const complete = run.complete!;
    const received = [...run.batches.values()].flat();
    if (received.length < complete.sample_count || r.ref?.run !== run) return;
    r.ref.run = undefined;
    if (run.kind === 'PREVIEW') return;
    const ordered = [...new Map(received.map((x) => [x.sample_seq, x])).values()].sort((a, b) => a.sample_seq - b.sample_seq);
    if (ordered.length === 0) {
      this.logReferenceEnd(run, 'EMPTY_RECORDING', 'nothing was written on the tablet');
      this.toCockpits(stationId, controlMessage('ERROR', { code: 'EMPTY_RECORDING', message: 'Nothing was written on the tablet' }));
      return;
    }
    const kind = run.kind as RecordingKind;
    const integrityOk = createHash('sha256').update(encodeSampleRecords(ordered)).digest('hex') === complete.sha256;
    const derived: Record<string, unknown> = { ...(await deriveRecording(this.db, { kind, canvas: run.canvas, rows: run.rows }, ordered)), integrity_ok: integrityOk };
    const station = await one<{ css_px_per_mm: string | null }>(this.db, 'SELECT css_px_per_mm FROM reference_stations WHERE id = $1', [stationId]);
    const rec = await one<{ id: string }>(this.db,
      `INSERT INTO reference_recordings (canvas_id, kind, domain_id, recorded_by, writer_label, samples, derived, station_id, rows_recorded, sample_count, css_px_per_mm)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [run.canvas.id, kind, run.canvas.domain_id, run.by.sub, run.writer_label, packSamples(ordered), JSON.stringify(derived), stationId,
        kind === 'NORMAL_SPEED' ? run.rows : null, ordered.length, station?.css_px_per_mm ?? null]);
    const summary = kind === 'SAMPLE_BLOCK_FILL'
      ? `${String(derived.pen_lifts)} pen lifts, ${String(derived.boxes_written)} of ${String(derived.boxes_total)} boxes`
      : `${String(derived.normal_speed_mm_s ?? 'no speed')} mm/s`;
    this.log({
      severity: integrityOk ? 'INFO' : 'ERROR', event_type: 'canvas.reference.recorded', actor_user_id: run.by.sub, actor_role: run.by.role,
      entity_type: 'reference_recording', entity_id: rec!.id,
      message: `${kind === 'SAMPLE_BLOCK_FILL' ? 'Sample block' : 'Normal speed sample'} recorded on ${run.canvas.code} v${run.canvas.version}: ${summary}`,
      details: { canvas_id: run.canvas.id, kind, domain_id: run.canvas.domain_id, sample_count: ordered.length, integrity_ok: integrityOk },
    });
    this.toCockpits(stationId, controlMessage('REFERENCE_RESULT', { recording_id: rec!.id, kind, canvas_id: run.canvas.id, derived }));
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
    if (r.ref) {
      // Reference mode: the run's samples are held until the recording is complete; nothing goes to pen_samples.
      const run = r.ref.run;
      if (run && packet.attempt_number === run.attempt) run.batches.set(packet.sequence, packet.samples);
      this.sendTo(socket, controlMessage('BATCH_ACK', { step_index: packet.step_index, attempt_number: packet.attempt_number, sequence: packet.sequence }));
      if (run?.complete) await this.finishReference(sessionId, run);
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
    await this.score(sessionId, stepIndex, attemptNumber, attempt.id);
  }

  /** Measures and scores a stored block (DDD §8), then tells the cockpit (BLOCK_SCORED). */
  private async score(sessionId: string, stepIndex: number, attemptNumber: number, attemptId: string) {
    try {
      const session = await loadSession(this.db, sessionId);
      const step = (await loadSteps(this.db, sessionId)).find((s) => s.step_index === stepIndex);
      if (!session || !step?.geometry) return;
      const { score_version, summary } = await scoreAttempt(this.db, {
        attemptId,
        canvas: step.mirrored ? mirrorCanvas(step.geometry) : step.geometry,
        profile: TIMED_ONLY.has(step.step_type) ? null : step.profile,
        isScored: step.is_scored,
        snapshot: session.settings_snapshot,
      });
      this.log({
        severity: 'INFO', event_type: 'session.block.scored', session_id: sessionId, entity_type: 'block_attempt', entity_id: attemptId,
        message: score_version === null
          ? `Block measured: step ${stepIndex}, attempt ${attemptNumber} (not scored)`
          : `Block scored: step ${stepIndex}, attempt ${attemptNumber}, composite ${summary.composite_score ?? 'not configured'}`,
        details: { step_index: stepIndex, attempt_number: attemptNumber, score_version, composite: summary.composite_score },
      });
      // A letter sheet: the system's suggested marks, for the evaluator to confirm or change (FR-COCK-5).
      if (step.step_type === 'INTERVENTION_SHEET' && step.profile) {
        const marks = await storeSuggestedMarks(this.db, attemptId, step.geometry, step.profile, session.settings_snapshot);
        const count = (v: boolean | null) => marks.filter((m) => m.auto_error === v).length;
        this.log({
          severity: 'INFO', event_type: 'intervention.mark.suggested', session_id: sessionId, entity_type: 'block_attempt', entity_id: attemptId,
          message: `Marks suggested: step ${stepIndex}, attempt ${attemptNumber}: ${count(false)} correct, ${count(true)} error, ${count(null)} for the evaluator`,
          details: { step_index: stepIndex, attempt_number: attemptNumber, correct: count(false), error: count(true), open: count(null) },
        });
      }
      this.toCockpits(sessionId, controlMessage('BLOCK_SCORED', {
        block_attempt_id: attemptId, step_index: stepIndex, attempt_number: attemptNumber, score_version, scores: { ...summary },
      }));
    } catch (err) {
      this.log({ severity: 'ERROR', event_type: 'system.error', session_id: sessionId, entity_type: 'block_attempt', entity_id: attemptId, message: `Scoring failed: ${(err as Error).message}` });
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub;
  }
}
