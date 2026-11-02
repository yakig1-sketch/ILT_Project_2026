// Tablet state machine (DDD §11.2) for a paired session: receives control events, plays video
// steps, runs the transition countdown and the writing block (with the inactivity cue, FR-TAB-5),
// streams LIVE packets to the cockpit and persists BATCH packets through the outbox.
import { PacketType, encodePacket, encodeSampleRecords } from '@ilt/emr-protocol';
import {
  StrokeFlag,
  UNACKED_EVENTS,
  controlMessage,
  type ControlEnvelope,
  type ControlEventName,
  type ControlPayload,
  type PenSample,
} from '@ilt/shared-types';
import { atLastUnit, locksByRow, type CanvasGeometry } from '@ilt/template-schemas';
import { GatewayLink, InkRenderer, PeerLink } from '@ilt/ui';
import { PenCapture } from './capture';
import { Outbox, outboxKey } from './outbox';

const BATCH_MAX_SAMPLES = 50;
const BATCH_INTERVAL_MS = 210;
const LIVE_MAX_SAMPLES = 512;
const RESEND_AFTER_MS = 3000;
const BOX_ENTRY_MARGIN_MM = 2;

export interface Pairing {
  token: string;
  session_id: string;
  session_code: string;
  language: string;
}

export type Dispatch = ControlPayload<'DISPATCH_STEP'> & { canvas: CanvasGeometry; fill_order: number[] };

export type KioskState =
  | { name: 'WAITING' }
  | { name: 'TRANSITION'; step: Dispatch; secondsLeft: number }
  | { name: 'WRITING'; step: Dispatch }
  | { name: 'PAUSED'; step: Dispatch }
  | { name: 'UPLOADING'; step: Dispatch }
  /** A video step: `src` is an object URL once the video is downloaded; `blocked` when autoplay needs a tap. */
  | { name: 'VIDEO'; step_index: number; video_key: string; src: string | null; blocked: boolean }
  | { name: 'DONE' };

interface Block {
  step: Dispatch;
  t0: number;
  samples: PenSample[];
  batch: PenSample[];
  live: PenSample[];
  seq: number;
  batchSeq: number;
  liveSeq: number;
  capture: PenCapture | null;
  ink: InkRenderer | null;
  batchTimer: ReturnType<typeof setInterval>;
  rafId: number;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class KioskSession {
  state: KioskState = { name: 'WAITING' };
  gatewayConnected = false;
  liveDirect = false;
  /**
   * The child has reached the end of the page, so [Next block] is offered: a stroke in the last
   * house (ILT), or on a notebook page at least one stroke per letter cell in the last row.
   */
  endReached = false;
  private lastRowStrokes = 0;
  /** Inactivity (FR-TAB-5): CUE shows the subtle cue on the tablet; AMBER is only reported to the cockpit. */
  inactivity: 'NONE' | 'CUE' | 'AMBER' = 'NONE';
  private lastContactAt = 0;
  private activeBoxId = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private readonly link: GatewayLink;
  private readonly peer: PeerLink;
  private readonly outbox = new Outbox();
  private readonly sentAt = new Map<string, number>();
  /** Control events sent but not yet acknowledged; resent in order after a reconnect. */
  private readonly unacked = new Map<string, ControlEnvelope>();
  private block: Block | null = null;
  private countdown: ReturnType<typeof setInterval> | null = null;
  private readonly resendTimer: ReturnType<typeof setInterval>;

  constructor(
    readonly pairing: Pairing,
    private readonly pxPerMm: number,
    private readonly allowMouse: boolean,
    private readonly onEnded: (reason: 'COMPLETE' | 'ABORTED' | 'AUTH') => void,
  ) {
    this.peer = new PeerLink(
      'answerer',
      (signal) => this.link.send({ signal }),
      () => undefined,
      (open) => {
        this.liveDirect = open;
        this.emit();
      },
    );
    this.link = new GatewayLink('/ws/tablet', () => ({ auth: pairing.token }), {
      onControl: (env, payload) => this.onControl(env, payload),
      onSignal: (signal) => void this.peer.onSignal(signal),
      onStatus: (connected) => {
        this.gatewayConnected = connected;
        if (connected) {
          this.sendStatus();
          this.resendAll();
        }
        this.emit();
      },
      onAuthRejected: () => this.end('AUTH'),
    });
    void this.outbox.restore(pairing.session_id).then(() => this.resendAll());
    this.resendTimer = setInterval(() => this.resendStale(), 1000);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private setState(state: KioskState) {
    this.state = state;
    this.emit();
  }

  dispose(): void {
    this.stopBlock();
    this.closeVideo();
    if (this.countdown) clearInterval(this.countdown);
    clearInterval(this.resendTimer);
    this.peer.close();
    this.link.close();
  }

  // ---- control events --------------------------------------------------------------------------

  private send<E extends ControlEventName>(event: E, payload: ControlPayload<E>) {
    const env = controlMessage(event, payload);
    if (!UNACKED_EVENTS.has(event)) this.unacked.set(env.message_id, env);
    this.link.send(env);
  }

  /** Tells the gateway which block this tablet holds, so it can spot a block lost to a restart. */
  private sendStatus() {
    const step = 'step' in this.state ? this.state.step : null;
    this.send('TABLET_STATUS', { block: step && { step_index: step.step_index, attempt_number: step.attempt_number } });
  }

  private onControl(env: ControlEnvelope, payload: unknown) {
    if (!UNACKED_EVENTS.has(env.event)) this.link.send(controlMessage('ACK', { ack_of: env.message_id }));
    switch (env.event) {
      case 'ACK':
        this.unacked.delete((payload as ControlPayload<'ACK'>).ack_of);
        break;
      case 'BATCH_ACK': {
        const p = payload as ControlPayload<'BATCH_ACK'>;
        const key = outboxKey(this.pairing.session_id, p.step_index, p.attempt_number, p.sequence);
        this.sentAt.delete(key);
        void this.outbox.remove(key).then(() => this.checkUploaded());
        break;
      }
      case 'DISPATCH_STEP':
        this.onDispatch(payload as Dispatch);
        break;
      case 'PAUSE_SESSION':
        if (this.state.name === 'WRITING') {
          this.block?.capture?.pause();
          this.setState({ name: 'PAUSED', step: this.state.step });
        }
        break;
      case 'RESUME_SESSION':
        if (this.state.name === 'PAUSED') {
          this.block?.capture?.resume();
          this.setState({ name: 'WRITING', step: this.state.step });
        }
        break;
      case 'MANUAL_FINISH':
        void this.finish('MANUAL');
        break;
      case 'VIDEO_PLAY':
        void this.playVideo(payload as ControlPayload<'VIDEO_PLAY'>);
        break;
      case 'VIDEO_ENDED':
        // The evaluator stopped the video.
        if (this.state.name === 'VIDEO' && this.state.step_index === (payload as ControlPayload<'VIDEO_ENDED'>).step_index) this.closeVideo();
        break;
      case 'ABORT_SESSION':
        void this.finish(null).then(() => this.end('ABORTED'));
        break;
      case 'SESSION_COMPLETE':
        this.end('COMPLETE');
        break;
      default:
        break;
    }
  }

  private end(reason: 'COMPLETE' | 'ABORTED' | 'AUTH') {
    this.stopBlock();
    this.closeVideo();
    if (reason !== 'AUTH') this.setState({ name: 'DONE' });
    this.onEnded(reason);
  }

  // ---- block lifecycle ------------------------------------------------------------------------

  private onDispatch(step: Dispatch) {
    if (this.state.name === 'WRITING' || this.state.name === 'PAUSED') return;
    if (this.countdown) clearInterval(this.countdown);
    const seconds = step.immediate ? 0 : (step.timers?.in_transition_sec ?? 0);
    this.setState({ name: 'TRANSITION', step, secondsLeft: seconds });
    if (seconds <= 0) return this.begin(step);
    let left = seconds;
    this.countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(this.countdown!);
        this.countdown = null;
        this.begin(step);
      } else {
        this.setState({ name: 'TRANSITION', step, secondsLeft: left });
      }
    }, 1000);
  }

  private begin(step: Dispatch) {
    const t0 = performance.now();
    this.endReached = false;
    this.lastRowStrokes = 0;
    this.inactivity = 'NONE';
    this.lastContactAt = Date.now();
    this.activeBoxId = step.fill_order[0] ?? 0;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => this.checkIdle(), 1000);
    this.block = {
      step, t0, samples: [], batch: [], live: [], seq: 0, batchSeq: 0, liveSeq: 0, capture: null, ink: null,
      batchTimer: setInterval(() => this.flushBatch(), BATCH_INTERVAL_MS),
      rafId: requestAnimationFrame(() => this.liveLoop()),
    };
    this.send('STEP_STARTED', { step_index: step.step_index, attempt_number: step.attempt_number, block_started_at: new Date().toISOString() });
    this.setState({ name: 'WRITING', step });
  }

  /** Called by the writing screen once its capture surface and ink canvas are mounted. */
  attachSurface(surface: HTMLElement, inkCanvas: HTMLCanvasElement): () => void {
    const b = this.block;
    if (!b) return () => undefined;
    b.ink = new InkRenderer(inkCanvas, b.step.canvas.size, this.pxPerMm);
    b.ink.add(b.samples);
    b.capture = new PenCapture({
      surface,
      geometry: b.step.canvas,
      fillOrder: b.step.fill_order,
      pxPerMm: this.pxPerMm,
      boxEntryMarginMm: BOX_ENTRY_MARGIN_MM,
      allowMouse: this.allowMouse,
      onSamples: (raw) => this.onSamples(raw),
      onBoxAdvanced: (box_id, fill_position, skipped_box_ids) => {
        this.activeBoxId = box_id;
        this.send('BOX_ADVANCED', { box_id, fill_position, skipped_box_ids });
      },
    });
    b.capture.start(b.t0);
    if (this.state.name === 'PAUSED') b.capture.pause();
    return () => b.capture?.stop();
  }

  private onSamples(raw: Omit<PenSample, 'sample_seq'>[]) {
    const b = this.block;
    if (!b) return;
    const samples = raw.map((s) => ({ ...s, sample_seq: b.seq++ }));
    b.samples.push(...samples);
    b.batch.push(...samples);
    b.live.push(...samples);
    b.ink?.add(samples);
    this.checkEnd(b.step, samples);
    if (samples.some((s) => (s.flags & StrokeFlag.CONTACT) !== 0)) {
      this.lastContactAt = Date.now();
      if (this.inactivity !== 'NONE') {
        this.inactivity = 'NONE';
        this.emit();
      }
    }
    if (b.batch.length >= BATCH_MAX_SAMPLES) this.flushBatch();
  }

  /** Inactivity cue after inactivity_sec without writing (inactivity_last_box_sec at the end of the page), amber after amber_grace_sec more. */
  private checkIdle() {
    if (this.state.name !== 'WRITING') {
      // A pause does not count as inactivity.
      this.lastContactAt = Date.now();
      return;
    }
    const t = this.state.step.timers;
    if (!t) return;
    const idle = Date.now() - this.lastContactAt;
    const cueAt = (this.endReached ? t.inactivity_last_box_sec : t.inactivity_sec) * 1000;
    const level = idle >= cueAt + t.amber_grace_sec * 1000 ? 'AMBER' : idle >= cueAt ? 'CUE' : 'NONE';
    if (level === this.inactivity || level === 'NONE') return;
    this.inactivity = level;
    this.send('INACTIVITY_ALERT', { level, idle_ms: idle, box_id: this.activeBoxId });
    this.emit();
  }

  private checkEnd(step: Dispatch, samples: PenSample[]) {
    if (this.endReached) return;
    const { canvas, fill_order } = step;
    for (const s of samples) {
      if ((s.flags & StrokeFlag.STROKE_START) === 0 || !atLastUnit(canvas, fill_order, s.box_id)) continue;
      this.lastRowStrokes += 1;
      const lastRow = canvas.boxes.find((bx) => bx.id === fill_order[fill_order.length - 1])?.row;
      const cells = canvas.boxes.filter((bx) => bx.row === lastRow).length;
      if (!locksByRow(canvas) || this.lastRowStrokes >= cells) {
        this.endReached = true;
        this.emit();
        return;
      }
    }
  }

  private flushBatch() {
    const b = this.block;
    if (!b || b.batch.length === 0) return;
    const samples = b.batch.splice(0);
    const sequence = b.batchSeq++;
    const bytes = encodePacket({
      packet_type: PacketType.BATCH, session_id: this.pairing.session_id,
      step_index: b.step.step_index, attempt_number: b.step.attempt_number, sequence, samples,
    });
    const key = outboxKey(this.pairing.session_id, b.step.step_index, b.step.attempt_number, sequence);
    void this.outbox.put({ key, session_id: this.pairing.session_id, step_index: b.step.step_index, attempt_number: b.step.attempt_number, sequence, bytes });
    if (this.link.sendBinary(bytes)) this.sentAt.set(key, Date.now());
  }

  private liveLoop() {
    const b = this.block;
    if (!b) return;
    while (b.live.length > 0) {
      const samples = b.live.splice(0, LIVE_MAX_SAMPLES);
      const bytes = encodePacket({
        packet_type: PacketType.LIVE, session_id: this.pairing.session_id,
        step_index: b.step.step_index, attempt_number: b.step.attempt_number, sequence: b.liveSeq++, samples,
      });
      if (!this.peer.send(bytes)) this.link.sendBinary(bytes);
    }
    b.rafId = requestAnimationFrame(() => this.liveLoop());
  }

  private stopBlock() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = null;
    this.inactivity = 'NONE';
    const b = this.block;
    if (!b) return;
    b.capture?.stop();
    clearInterval(b.batchTimer);
    cancelAnimationFrame(b.rafId);
  }

  /** [Next block] tapped with the pen at the end of the page: finishes the block; the gateway then dispatches the next writing block. */
  nextBlock(): void {
    if (this.state.name === 'WRITING' && this.endReached) void this.finish('NEXT_BLOCK');
  }

  /** Locks the canvas, sends the last batch and BLOCK_COMPLETE with the SHA-256 (null reason: abort, no completion). */
  private async finish(reason: ControlPayload<'BLOCK_COMPLETE'>['end_reason'] | null) {
    const b = this.block;
    if (!b || (this.state.name !== 'WRITING' && this.state.name !== 'PAUSED')) return;
    b.capture?.stop();
    this.flushBatch();
    this.liveLoopOnce(b);
    this.stopBlock();
    if (reason === null) return;
    const last = b.samples[b.samples.length - 1];
    this.send('BLOCK_COMPLETE', {
      step_index: b.step.step_index,
      attempt_number: b.step.attempt_number,
      end_reason: reason,
      sample_count: b.samples.length,
      last_sample_seq: last ? last.sample_seq : -1,
      sha256: await sha256Hex(encodeSampleRecords(b.samples)),
    });
    this.setState({ name: 'UPLOADING', step: b.step });
    this.checkUploaded();
  }

  private liveLoopOnce(b: Block) {
    if (b.live.length === 0) return;
    const bytes = encodePacket({
      packet_type: PacketType.LIVE, session_id: this.pairing.session_id,
      step_index: b.step.step_index, attempt_number: b.step.attempt_number, sequence: b.liveSeq++, samples: b.live.splice(0, LIVE_MAX_SAMPLES),
    });
    if (!this.peer.send(bytes)) this.link.sendBinary(bytes);
  }

  private checkUploaded() {
    if (this.state.name !== 'UPLOADING') return;
    const { step } = this.state;
    if (this.outbox.pending(this.pairing.session_id, step.step_index, step.attempt_number).length === 0) {
      this.block = null;
      this.setState({ name: 'WAITING' });
    }
  }

  // ---- video steps ----------------------------------------------------------------------------

  /** Downloads the video with the tablet token (no token in a URL), then shows it full screen. */
  private async playVideo(p: ControlPayload<'VIDEO_PLAY'>) {
    if (this.state.name === 'VIDEO' && this.state.step_index === p.step_index) return;
    if (this.state.name !== 'WAITING' || !p.url || !p.video_key) return;
    const { step_index, video_key } = p;
    this.setState({ name: 'VIDEO', step_index, video_key, src: null, blocked: false });
    try {
      const res = await fetch(p.url, { headers: { authorization: `Bearer ${this.pairing.token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const src = URL.createObjectURL(await res.blob());
      // The state may have changed while downloading (the evaluator stopped the video).
      const now = this.state as KioskState;
      if (now.name !== 'VIDEO' || now.step_index !== step_index) return URL.revokeObjectURL(src);
      this.setState({ ...now, src });
    } catch {
      // The cockpit can stop the step and explain verbally.
      const now = this.state as KioskState;
      if (now.name === 'VIDEO' && now.step_index === step_index) this.setState({ ...now, src: null, blocked: true });
    }
  }

  /** Autoplay was refused (no tap yet on this page): a tap on the overlay starts the video. */
  videoBlocked(): void {
    if (this.state.name === 'VIDEO' && !this.state.blocked) this.setState({ ...this.state, blocked: true });
  }

  videoStarted(): void {
    if (this.state.name === 'VIDEO' && this.state.blocked) this.setState({ ...this.state, blocked: false });
  }

  /** The video played to the end. */
  videoEnded(): void {
    if (this.state.name !== 'VIDEO') return;
    this.send('VIDEO_ENDED', { step_index: this.state.step_index, reason: 'ENDED' });
    this.closeVideo();
  }

  private closeVideo() {
    if (this.state.name !== 'VIDEO') return;
    if (this.state.src) URL.revokeObjectURL(this.state.src);
    this.setState({ name: 'WAITING' });
  }

  // ---- resending ------------------------------------------------------------------------------

  /** After (re)connecting: unacknowledged control events first, then every buffered batch. */
  private resendAll() {
    if (!this.link.connected) return;
    for (const env of this.unacked.values()) this.link.send(env);
    for (const e of this.outbox.pending(this.pairing.session_id)) {
      if (this.link.sendBinary(e.bytes)) this.sentAt.set(e.key, Date.now());
    }
  }

  /** A batch the gateway has not acknowledged (e.g. it arrived before STEP_STARTED was stored). */
  private resendStale() {
    if (!this.link.connected) return;
    const now = Date.now();
    for (const e of this.outbox.pending(this.pairing.session_id)) {
      const sent = this.sentAt.get(e.key);
      if (sent === undefined || now - sent > RESEND_AFTER_MS) {
        if (this.link.sendBinary(e.bytes)) this.sentAt.set(e.key, now);
      }
    }
  }
}
