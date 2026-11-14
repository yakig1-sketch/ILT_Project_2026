// The camera relay (go2rtc, Phase 5f), on the server's local interface. The gateway adds a camera's
// streams when it needs them (the stream addresses carry the camera account, so they live only in the
// relay's memory) and takes from it: pictures (QR pairing, administrator check), the fragmented MP4 of
// a clip, and the live view as MSE over a WebSocket.
import type { Readable } from 'node:stream';
import { Readable as NodeReadable } from 'node:stream';

export interface CameraRelay {
  /** Adds or replaces a stream (main or sub) for a camera. */
  setStream(name: string, url: string): Promise<void>;
  removeStream(name: string): Promise<void>;
  /** A JPEG picture from the stream, or null when the camera gives none. */
  frame(name: string): Promise<Buffer | null>;
  /** The stream as fragmented MP4 (H.264, no sound) until `signal` aborts. */
  mp4(name: string, signal: AbortSignal): Promise<Readable>;
  /** The relay's WebSocket address for the live view of a stream. */
  liveUrl(name: string): string;
  /** True when the relay answers. */
  ping(): Promise<boolean>;
}

export function go2rtcRelay(base: string): CameraRelay {
  const api = (path: string) => `${base.replace(/\/$/, '')}/api${path}`;
  return {
    async setStream(name, url) {
      const q = new URLSearchParams({ name, src: url });
      const res = await fetch(api(`/streams?${q}`), { method: 'PUT', signal: AbortSignal.timeout(5000) });
      // Without a config file the relay keeps the stream in memory and answers 400 "config file disabled".
      if (!res.ok && !/config file disabled/.test(await res.text())) throw new Error(`Relay refused the stream (HTTP ${res.status})`);
    },
    async removeStream(name) {
      await fetch(api(`/streams?${new URLSearchParams({ src: name })}`), { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    },
    async frame(name) {
      const res = await fetch(api(`/frame.jpeg?${new URLSearchParams({ src: name })}`), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = Buffer.from(await res.arrayBuffer());
      return body.length > 0 ? body : null;
    },
    async mp4(name, signal) {
      // `video` only: the hands, never the room's sound.
      const res = await fetch(api(`/stream.mp4?${new URLSearchParams({ src: name, video: '' })}`), { signal });
      if (!res.ok || !res.body) throw new Error(`Relay gave no video (HTTP ${res.status})`);
      return NodeReadable.fromWeb(res.body as Parameters<typeof NodeReadable.fromWeb>[0]);
    },
    liveUrl(name) {
      return `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/api/ws?${new URLSearchParams({ src: name })}`;
    },
    async ping() {
      try {
        return (await fetch(api(''), { signal: AbortSignal.timeout(2000) })).ok;
      } catch {
        return false;
      }
    },
  };
}

/** Stream names in the relay: one per camera and quality. */
export const streamName = (cameraId: string, sub = false) => `cam_${cameraId.replace(/-/g, '')}${sub ? '_sub' : ''}`;
