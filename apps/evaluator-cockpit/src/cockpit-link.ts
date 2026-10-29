// Cockpit end of a session's real-time links: the gateway socket (control events, signalling,
// relayed LIVE packets) and the direct WebRTC mirror channel, which the cockpit offers.
import { PacketType, decodePacket } from '@ilt/emr-protocol';
import {
  StrokeFlag,
  controlMessage,
  type ControlEnvelope,
  type ControlEventName,
  type ControlPayload,
  type PenSample,
} from '@ilt/shared-types';
import type { CanvasGeometry } from '@ilt/template-schemas';
import { GatewayLink, PeerLink } from '@ilt/ui';
import { getAuth } from './api';

const MIN_LIFT_GAP_MS = 50;
const RELAY_FRESH_MS = 1500;

export interface LiveBlock {
  step_index: number;
  attempt_number: number;
  canvas: CanvasGeometry;
  fill_order: number[];
  started: boolean;
  completing: boolean;
  activeBoxId: number | null;
  fillPosition: number;
  skipped: number[];
  firstContactUs: number | null;
  lastUs: number | null;
  lastSampleAt: number | null;
  penLifts: number;
  lastStrokeEndUs: number | null;
}

export interface StoredResult {
  step_index: number;
  attempt_number: number;
  sample_count: number;
  integrity_ok: boolean;
}

export class CockpitLink {
  gatewayConnected = false;
  tabletConnected = false;
  directOpen = false;
  lastRelayAt = 0;
  block: LiveBlock | null = null;
  lastStored: StoredResult | null = null;
  lastError: string | null = null;
  /** Called with each batch of mirror samples for the current block. */
  onSamples: ((samples: PenSample[]) => void) | null = null;
  private listeners = new Set<() => void>();
  private readonly link: GatewayLink;
  private readonly peer: PeerLink;

  constructor(
    readonly sessionId: string,
    private readonly onSessionChanged: () => void,
  ) {
    this.peer = new PeerLink(
      'offerer',
      (signal) => this.link.send({ signal }),
      (bytes) => this.onPacket(bytes),
      (open) => {
        this.directOpen = open;
        this.emit();
      },
    );
    this.link = new GatewayLink('/ws/cockpit', () => ({ auth: getAuth()?.access_token ?? '', session_id: sessionId }), {
      onControl: (env, payload) => this.onControl(env, payload),
      onSignal: (signal) => void this.peer.onSignal(signal),
      onBinary: (bytes) => {
        this.lastRelayAt = Date.now();
        this.onPacket(bytes);
      },
      onStatus: (connected) => {
        this.gatewayConnected = connected;
        this.emit();
      },
    });
  }

  get liveMode(): 'direct' | 'relay' | 'none' {
    if (this.directOpen) return 'direct';
    return Date.now() - this.lastRelayAt < RELAY_FRESH_MS ? 'relay' : 'none';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  dispose(): void {
    this.peer.close();
    this.link.close();
  }

  command<E extends ControlEventName>(event: E, payload: ControlPayload<E>): void {
    this.lastError = null;
    if (!this.link.send(controlMessage(event, payload))) this.lastError = 'error.network';
    this.emit();
  }

  private onControl(env: ControlEnvelope, payload: unknown) {
    switch (env.event) {
      case 'PEER_STATUS': {
        const p = payload as ControlPayload<'PEER_STATUS'>;
        const wasConnected = this.tabletConnected;
        this.tabletConnected = p.tablet;
        if (p.tablet && (!wasConnected || !this.directOpen)) void this.peer.start();
        if (!p.tablet) this.peer.close();
        break;
      }
      case 'DISPATCH_STEP': {
        const p = payload as ControlPayload<'DISPATCH_STEP'>;
        this.block = {
          step_index: p.step_index, attempt_number: p.attempt_number,
          canvas: p.canvas as CanvasGeometry, fill_order: p.fill_order ?? [],
          started: false, completing: false, activeBoxId: p.fill_order?.[0] ?? null, fillPosition: 0, skipped: [],
          firstContactUs: null, lastUs: null, lastSampleAt: null, penLifts: 0, lastStrokeEndUs: null,
        };
        this.lastStored = null;
        this.onSessionChanged();
        break;
      }
      case 'STEP_STARTED':
        if (this.block) this.block.started = true;
        break;
      case 'BOX_ADVANCED': {
        const p = payload as ControlPayload<'BOX_ADVANCED'>;
        if (this.block) {
          this.block.activeBoxId = p.box_id;
          this.block.fillPosition = p.fill_position;
          this.block.skipped = [...new Set([...this.block.skipped, ...p.skipped_box_ids])];
        }
        break;
      }
      case 'BLOCK_COMPLETE':
        if (this.block) this.block.completing = true;
        break;
      case 'BLOCK_STORED': {
        const p = payload as ControlPayload<'BLOCK_STORED'>;
        this.lastStored = p;
        if (this.block?.step_index === p.step_index && this.block.attempt_number === p.attempt_number) this.block = null;
        this.onSessionChanged();
        break;
      }
      case 'PAUSE_SESSION':
      case 'RESUME_SESSION':
      case 'ABORT_SESSION':
      case 'SESSION_COMPLETE':
        this.onSessionChanged();
        break;
      case 'ERROR': {
        const p = payload as ControlPayload<'ERROR'>;
        this.lastError = `hub_error.${p.code}`;
        break;
      }
      default:
        break;
    }
    this.emit();
  }

  private onPacket(bytes: Uint8Array) {
    let packet: ReturnType<typeof decodePacket>;
    try {
      packet = decodePacket(bytes);
    } catch {
      return;
    }
    const b = this.block;
    if (packet.packet_type !== PacketType.LIVE || !b) return;
    if (packet.step_index !== b.step_index || packet.attempt_number !== b.attempt_number) return;
    for (const s of packet.samples) {
      if ((s.flags & StrokeFlag.CONTACT) !== 0 && b.firstContactUs === null) b.firstContactUs = s.t_us;
      if ((s.flags & StrokeFlag.STROKE_START) !== 0) {
        // A lift shorter than the minimum gap joins the strokes: it is not a pen lift (DDD §8.2).
        if (b.lastStrokeEndUs === null || s.t_us - b.lastStrokeEndUs >= MIN_LIFT_GAP_MS * 1000) b.penLifts += 1;
      }
      if ((s.flags & StrokeFlag.STROKE_END) !== 0) b.lastStrokeEndUs = s.t_us;
      b.lastUs = s.t_us;
    }
    b.lastSampleAt = Date.now();
    this.onSamples?.(packet.samples);
    this.emit();
  }
}
