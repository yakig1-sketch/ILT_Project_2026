// Browser side of the real-time links (DDD §5.1): a reconnecting WebSocket to the gateway, and the
// direct WebRTC data channel for the live mirror (emr-stream, unordered, no retransmits).
import {
  SignalMessage,
  parseControlMessage,
  type ControlEnvelope,
} from '@ilt/shared-types';

export interface GatewayLinkHandlers {
  onControl: (envelope: ControlEnvelope, payload: unknown) => void;
  onSignal?: (signal: SignalMessage['signal']) => void;
  onBinary?: (bytes: Uint8Array) => void;
  onStatus?: (connected: boolean) => void;
  /** The server refused the credentials: stop reconnecting. */
  onAuthRejected?: () => void;
}

/** WebSocket to /ws/tablet or /ws/cockpit. Authenticates with the first message and reconnects with backoff. */
export class GatewayLink {
  private ws: WebSocket | null = null;
  private stopped = false;
  private retryMs = 500;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly path: '/ws/tablet' | '/ws/cockpit',
    private readonly auth: () => Record<string, string>,
    private readonly handlers: GatewayLinkHandlers,
  ) {
    this.connect();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.stopped) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${this.path}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.auth()));
      this.retryMs = 500;
      this.handlers.onStatus?.(true);
    };
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (typeof ev.data !== 'string') {
        this.handlers.onBinary?.(new Uint8Array(ev.data));
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const signal = SignalMessage.safeParse(raw);
      if (signal.success) {
        this.handlers.onSignal?.(signal.data.signal);
        return;
      }
      try {
        const { envelope, payload } = parseControlMessage(raw);
        this.handlers.onControl(envelope, payload);
      } catch (err) {
        console.warn('Ignored malformed control message', err);
      }
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      this.handlers.onStatus?.(false);
      if (ev.code === 4401 || ev.code === 4409) {
        if (ev.code === 4401) this.handlers.onAuthRejected?.();
        this.stopped = true;
        return;
      }
      this.timer = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
  }

  send(message: unknown): boolean {
    if (!this.connected) return false;
    this.ws!.send(JSON.stringify(message));
    return true;
  }

  sendBinary(bytes: Uint8Array): boolean {
    if (!this.connected) return false;
    this.ws!.send(bytes);
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close(1000);
  }
}

/**
 * Direct tablet ↔ cockpit WebRTC link carrying the emr-stream data channel. The cockpit makes the
 * offer; the gateway only relays signalling. No STUN/TURN: both ends are on the local network.
 */
export class PeerLink {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;

  constructor(
    private readonly role: 'offerer' | 'answerer',
    private readonly sendSignal: (signal: SignalMessage['signal']) => void,
    private readonly onPacket: (bytes: Uint8Array) => void,
    private readonly onOpenChange: (open: boolean) => void,
  ) {}

  get open(): boolean {
    return this.channel?.readyState === 'open';
  }

  /** Offerer: starts (or restarts) the connection. */
  async start(): Promise<void> {
    const pc = this.reset();
    this.attach(pc.createDataChannel('emr-stream', { ordered: false, maxRetransmits: 0 }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal({ description: { type: 'offer', sdp: offer.sdp ?? '' } });
  }

  async onSignal(signal: SignalMessage['signal']): Promise<void> {
    if (signal.description?.type === 'offer' && this.role === 'answerer') {
      const pc = this.reset();
      await pc.setRemoteDescription(signal.description);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ description: { type: 'answer', sdp: answer.sdp ?? '' } });
    } else if (signal.description?.type === 'answer' && this.pc) {
      await this.pc.setRemoteDescription(signal.description);
    } else if (signal.candidate && this.pc) {
      try {
        await this.pc.addIceCandidate(signal.candidate as RTCIceCandidateInit);
      } catch {
        // A candidate for a connection that has since been replaced.
      }
    }
  }

  send(bytes: Uint8Array): boolean {
    if (!this.open) return false;
    // Packets are always backed by a plain ArrayBuffer (encodePacket allocates one).
    this.channel!.send(bytes as Uint8Array<ArrayBuffer>);
    return true;
  }

  close(): void {
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    this.onOpenChange(false);
  }

  private reset(): RTCPeerConnection {
    this.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal({ candidate: ev.candidate.toJSON() as Record<string, unknown> });
    };
    pc.ondatachannel = (ev) => this.attach(ev.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.onOpenChange(false);
    };
    return pc;
  }

  private attach(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    this.channel = channel;
    channel.onopen = () => this.onOpenChange(true);
    channel.onclose = () => this.onOpenChange(false);
    channel.onmessage = (ev: MessageEvent<ArrayBuffer>) => this.onPacket(new Uint8Array(ev.data));
  }
}
