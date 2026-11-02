// WebSocket test client for the gateway's database tests: collects every message and waits for one.
import WebSocket from 'ws';
import type { ControlEnvelope } from '@ilt/shared-types';

export class Client {
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

export const isEvent = (event: string) => (m: ControlEnvelope | Uint8Array) => !(m instanceof Uint8Array) && m.event === event;
