// Session video capture (Phase 5f; FR-PRIV-2, FR-REP-3, FR-VID-1…6).
//
// - Discovery: ONVIF WS-Discovery on the site network; each camera found is checked with the site
//   camera account (or its own) for its stream addresses and pan/tilt.
// - Pairing: the evaluator asks for a camera; the tablet shows a one-time QR code; the gateway looks at
//   every free camera's picture until one sees that code, and pairs that camera to the session. A camera
//   serves one session at a time, so sessions side by side never mix cameras.
// - Clips: with video allowed for the session (setting and consent), one clip per writing-step attempt,
//   from its dispatch to its end, stored in the private video bucket and linked to the attempt.
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import type { AppLog, Queryable } from '../app-log.js';
import { one, rows } from '../db.js';
import { OnvifError, withAccount, type CameraAccount, type CameraInfo, type DiscoveredCamera, type Direction } from './onvif.js';
import { readPairingCode } from './qr.js';
import { streamName, type CameraRelay } from './relay.js';
import type { SecretBox } from './secret.js';

/** Where clips are kept: a private bucket, read only through the gateway. */
export interface ClipStore {
  put(objectKey: string, filePath: string, size: number): Promise<void>;
  get(objectKey: string): Promise<{ stream: Readable; size: number | undefined } | null>;
}

export interface CameraDeps {
  relay: CameraRelay;
  secrets: SecretBox;
  clips: ClipStore;
  discover: () => Promise<DiscoveredCamera[]>;
  onvif: (deviceUrl: string, account: CameraAccount) => {
    inspect(): Promise<CameraInfo>;
    move(ptzUrl: string, profileToken: string, direction: Direction): Promise<void>;
  };
}

/** How the session's camera stands, for the cockpit (CAMERA_STATUS). */
export interface SessionCamera {
  state: 'NONE' | 'SEARCHING' | 'PAIRED';
  camera: { id: string; label: string | null; model: string; ptz: boolean } | null;
  expires_at: string | null;
  /** Free cameras the gateway is looking at for the code. */
  watching: number;
  recording: boolean;
}

export interface CameraEvents {
  /** The tablet shows the QR code (code), the framing guide ('FRAME') or neither (null). */
  tabletScreen(sessionId: string, screen: { code: string } | 'FRAME' | null): void;
  /** The session's camera changed: tell its cockpits. */
  changed(sessionId: string): void;
}

export interface CameraRow {
  id: string;
  device_urn: string;
  model: string;
  label: string | null;
  host: string;
  device_url: string;
  username: string | null;
  password_enc: string | null;
  status: string;
  rtsp_url: string | null;
  rtsp_sub_url: string | null;
  profile_token: string | null;
  ptz: boolean;
  retired: boolean;
  last_seen_at: string | null;
  last_checked_at: string | null;
}

/** A clip being written for an attempt. */
interface Clip {
  sessionId: string;
  cameraId: string;
  stepIndex: number;
  attemptNumber: number;
  attemptId: string | null;
  /** When the gateway heard the attempt start (STEP_STARTED): the replay's zero. */
  attemptStartedAt: number | null;
  firstByteAt: number | null;
  file: string;
  abort: AbortController;
  done: Promise<{ size: number; sha256: string } | null>;
  timer: NodeJS.Timeout;
}

const PAIRING_MS = 3 * 60_000;
const SCAN_PAUSE_MS = 600;
/** A clip never runs longer than this (a step left open). */
const MAX_CLIP_MS = 20 * 60_000;
/** Cameras not seen by discovery for this long are not looked at for a code. */
const SEEN_WITHIN_MS = 24 * 3600_000;

const code = () => randomBytes(15).toString('base64url');

export class CameraService {
  private scanning = false;
  private refreshing: Promise<CameraRow[]> | null = null;
  private readonly clips = new Map<string, Clip>();
  private readonly streams = new Map<string, string>();
  private events: CameraEvents = { tabletScreen: () => undefined, changed: () => undefined };

  constructor(private readonly db: Queryable, private readonly deps: CameraDeps, private readonly log: AppLog) {}

  setEvents(events: CameraEvents) {
    this.events = events;
  }

  // ---- accounts and discovery ----------------------------------------------------------------

  async siteAccount(): Promise<{ username: string; password: string } | null> {
    const row = await one<{ username: string; password_enc: string }>(this.db, 'SELECT username, password_enc FROM camera_account WHERE id = 1');
    if (!row) return null;
    try {
      return { username: row.username, password: this.deps.secrets.open(row.password_enc) };
    } catch {
      return null;
    }
  }

  async setSiteAccount(username: string, password: string, userId: string) {
    await this.db.query(
      `INSERT INTO camera_account (id, username, password_enc, updated_by, updated_at) VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_enc = EXCLUDED.password_enc, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [username, this.deps.secrets.seal(password), userId],
    );
    this.streams.clear();
  }

  private async accountFor(cam: CameraRow): Promise<CameraAccount | null> {
    if (cam.username && cam.password_enc) {
      try {
        return { username: cam.username, password: this.deps.secrets.open(cam.password_enc) };
      } catch {
        return null;
      }
    }
    return this.siteAccount();
  }

  async list(): Promise<CameraRow[]> {
    return rows<CameraRow>(this.db, 'SELECT * FROM cameras ORDER BY retired, coalesce(label, model), host');
  }

  async get(id: string): Promise<CameraRow | undefined> {
    return one<CameraRow>(this.db, 'SELECT * FROM cameras WHERE id = $1', [id]);
  }

  relayAlive(): Promise<boolean> {
    return this.deps.relay.ping();
  }

  /** The administrator's changes: label, retired, its own account (null: back to the site account). Checked again after an account change. */
  async update(cam: CameraRow, patch: { label?: string | null; retired?: boolean; own_account?: CameraAccount | null }): Promise<CameraRow> {
    const sets: string[] = [];
    const values: unknown[] = [cam.id];
    const set = (col: string, v: unknown) => {
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    };
    if (patch.label !== undefined) set('label', patch.label || null);
    if (patch.retired !== undefined) set('retired', patch.retired);
    if (patch.own_account !== undefined) {
      set('username', patch.own_account?.username ?? null);
      set('password_enc', patch.own_account ? this.deps.secrets.seal(patch.own_account.password) : null);
    }
    if (sets.length) await this.db.query(`UPDATE cameras SET ${sets.join(', ')} WHERE id = $1`, values);
    let updated = (await this.get(cam.id))!;
    if (patch.own_account !== undefined) {
      await this.check(updated);
      updated = (await this.get(cam.id))!;
    }
    return updated;
  }

  /** Finds the cameras on the network and checks each one found. One search at a time. */
  refresh(): Promise<CameraRow[]> {
    this.refreshing ??= (async () => {
      try {
        const found = await this.deps.discover();
        for (const d of found) {
          await this.db.query(
            `INSERT INTO cameras (device_urn, model, host, device_url, last_seen_at) VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (device_urn) DO UPDATE SET host = EXCLUDED.host, device_url = EXCLUDED.device_url, model = EXCLUDED.model, last_seen_at = now()`,
            [d.urn, d.model, d.host, d.deviceUrl],
          );
        }
        const seen = await rows<CameraRow>(this.db, 'SELECT * FROM cameras WHERE device_urn = ANY($1::text[])', [found.map((d) => d.urn)]);
        await Promise.all(seen.map((c) => this.check(c)));
        return this.list();
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /** Asks the camera for its streams with its account; records the outcome. */
  async check(cam: CameraRow): Promise<string> {
    const account = await this.accountFor(cam);
    let status: string;
    let info: CameraInfo | null = null;
    if (!account) status = 'NO_ACCOUNT';
    else {
      try {
        info = await this.deps.onvif(cam.device_url, account).inspect();
        status = 'OK';
      } catch (err) {
        status = err instanceof OnvifError ? ({ AUTH: 'AUTH_FAILED', UNREACHABLE: 'UNREACHABLE', NOT_SUPPORTED: 'NOT_SUPPORTED', FAULT: 'NOT_SUPPORTED' } as const)[err.code] : 'UNREACHABLE';
      }
    }
    await this.db.query(
      `UPDATE cameras SET status = $2, last_checked_at = now(),
              rtsp_url = coalesce($3, rtsp_url), rtsp_sub_url = CASE WHEN $3::text IS NULL THEN rtsp_sub_url ELSE $4 END,
              profile_token = coalesce($5, profile_token), ptz = coalesce($6, ptz)
        WHERE id = $1`,
      [cam.id, status, info?.rtspUrl ?? null, info?.rtspSubUrl ?? null, info?.profileToken ?? null, info ? info.ptz : null],
    );
    if (info) this.ptzUrls.set(cam.id, info.ptzUrl);
    this.streams.delete(streamName(cam.id));
    this.streams.delete(streamName(cam.id, true));
    return status;
  }

  private readonly ptzUrls = new Map<string, string | null>();

  /** Makes sure the relay has the camera's stream (main or sub), with the camera account in its address. */
  private async stream(cam: CameraRow, sub = false): Promise<string | null> {
    const url = sub ? (cam.rtsp_sub_url ?? cam.rtsp_url) : cam.rtsp_url;
    if (!url) return null;
    const name = streamName(cam.id, sub);
    if (this.streams.get(name) === url) return name;
    const account = await this.accountFor(cam);
    if (!account) return null;
    await this.deps.relay.setStream(name, withAccount(url, account));
    this.streams.set(name, url);
    return name;
  }

  /** A picture from a camera (administrator check), or null. */
  async snapshot(cam: CameraRow): Promise<Buffer | null> {
    const name = await this.stream(cam);
    const picture = name ? await this.deps.relay.frame(name) : null;
    if (picture) await this.seen(cam.id, true);
    return picture;
  }

  private readonly lastTouched = new Map<string, number>();

  /** The camera answered with a picture or video: it is on the network now (Last seen; at most once a minute). */
  private async seen(cameraId: string, now = false) {
    const last = this.lastTouched.get(cameraId) ?? 0;
    if (!now && Date.now() - last < 60_000) return;
    this.lastTouched.set(cameraId, Date.now());
    await this.db.query('UPDATE cameras SET last_seen_at = now() WHERE id = $1', [cameraId]);
  }

  // ---- pairing ---------------------------------------------------------------------------------

  private async openPairing(sessionId: string) {
    return one<{ id: string; camera_id: string | null; code: string; status: string; expires_at: string }>(this.db,
      "SELECT id, camera_id, code, status, expires_at FROM camera_pairings WHERE session_id = $1 AND status IN ('PENDING', 'PAIRED')", [sessionId]);
  }

  /** Free cameras: checked, not retired, seen lately and not serving a session. */
  private async freeCameras(): Promise<CameraRow[]> {
    return rows<CameraRow>(this.db,
      `SELECT c.* FROM cameras c
        WHERE c.status = 'OK' AND NOT c.retired AND c.rtsp_url IS NOT NULL AND c.last_seen_at > now() - make_interval(secs => $1)
          AND NOT EXISTS (SELECT 1 FROM camera_pairings p WHERE p.camera_id = c.id AND p.status = 'PAIRED')`, [SEEN_WITHIN_MS / 1000]);
  }

  async state(sessionId: string): Promise<SessionCamera> {
    const p = await this.openPairing(sessionId);
    const recording = this.clips.has(sessionId);
    if (!p) return { state: 'NONE', camera: null, expires_at: null, watching: 0, recording };
    if (p.status === 'PENDING') return { state: 'SEARCHING', camera: null, expires_at: new Date(p.expires_at).toISOString(), watching: (await this.freeCameras()).length, recording };
    const cam = p.camera_id ? await this.get(p.camera_id) : undefined;
    return { state: 'PAIRED', camera: cam ? { id: cam.id, label: cam.label, model: cam.model, ptz: cam.ptz } : null, expires_at: null, watching: 0, recording };
  }

  /**
   * Starts a pairing: a new one-time code for the tablet's QR. An earlier camera of the session is let go.
   * The cameras on the network are searched again in the background, so a camera just switched on counts.
   */
  async startPairing(sessionId: string, userId: string): Promise<{ code: string; expires_at: string }> {
    await this.endPairing(sessionId, 'NEW_PAIRING');
    const c = code();
    const row = await one<{ expires_at: string }>(this.db,
      `INSERT INTO camera_pairings (session_id, code, status, created_by, expires_at) VALUES ($1, $2, 'PENDING', $3, now() + make_interval(secs => $4)) RETURNING expires_at`,
      [sessionId, c, userId, PAIRING_MS / 1000]);
    this.log.write({ severity: 'INFO', event_type: 'camera.pairing.started', actor_user_id: userId, session_id: sessionId, message: 'Camera pairing started: the tablet shows the QR code' });
    this.events.tabletScreen(sessionId, { code: c });
    this.events.changed(sessionId);
    void this.refresh().catch(() => undefined).then(() => this.events.changed(sessionId));
    void this.scan();
    return { code: c, expires_at: new Date(row!.expires_at).toISOString() };
  }

  /** The tablet (re)connected: it shows what the session's camera needs. */
  async tabletScreenFor(sessionId: string): Promise<{ code: string } | null> {
    const p = await this.openPairing(sessionId);
    return p?.status === 'PENDING' ? { code: p.code } : null;
  }

  /** Looks for the pending codes in the free cameras' pictures until no pairing waits. */
  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (;;) {
        await this.expire();
        const pending = await rows<{ id: string; session_id: string; code: string }>(this.db, "SELECT id, session_id, code FROM camera_pairings WHERE status = 'PENDING'");
        if (pending.length === 0) return;
        const byCode = new Map(pending.map((p) => [p.code, p]));
        const cameras = await this.freeCameras();
        await Promise.all(cameras.map(async (cam) => {
          try {
            const name = await this.stream(cam);
            const picture = name ? await this.deps.relay.frame(name) : null;
            if (picture) await this.seen(cam.id);
            const seen = picture ? readPairingCode(picture) : null;
            const p = seen ? byCode.get(seen) : undefined;
            if (p) {
              byCode.delete(seen!);
              await this.pair(p, cam);
            }
          } catch {
            // A camera that does not answer is skipped this round.
          }
        }));
        await new Promise((r) => setTimeout(r, SCAN_PAUSE_MS));
      }
    } finally {
      this.scanning = false;
    }
  }

  private async pair(p: { id: string; session_id: string }, cam: CameraRow) {
    try {
      const done = (await this.db.query("UPDATE camera_pairings SET status = 'PAIRED', camera_id = $2, paired_at = now() WHERE id = $1 AND status = 'PENDING'", [p.id, cam.id])) as { rowCount?: number | null };
      if (!done.rowCount) return;
    } catch {
      return; // The camera was paired to another session meanwhile.
    }
    this.log.write({
      severity: 'INFO', event_type: 'camera.paired', session_id: p.session_id, entity_type: 'camera', entity_id: cam.id,
      message: `Camera paired: ${cam.label ?? cam.model} (${cam.host}) saw the session's QR code`, details: { camera_id: cam.id, model: cam.model, host: cam.host },
    });
    this.events.tabletScreen(p.session_id, 'FRAME');
    this.events.changed(p.session_id);
  }

  private async expire() {
    const gone = await rows<{ session_id: string }>(this.db,
      "UPDATE camera_pairings SET status = 'EXPIRED', ended_at = now(), end_reason = 'NOT_SEEN' WHERE status = 'PENDING' AND expires_at < now() RETURNING session_id");
    for (const g of gone) {
      this.log.write({ severity: 'WARN', event_type: 'camera.pairing.expired', session_id: g.session_id, message: 'Camera pairing expired: no camera saw the QR code' });
      this.events.tabletScreen(g.session_id, null);
      this.events.changed(g.session_id);
    }
  }

  /** The evaluator is done positioning: the tablet leaves the framing guide. */
  async finishPositioning(sessionId: string) {
    this.events.tabletScreen(sessionId, null);
  }

  /** Ends the session's pairing (cancelled, released, or the session ended). Any clip is closed first. */
  async endPairing(sessionId: string, reason: string, userId?: string) {
    await this.stopClip(sessionId);
    const ended = await rows<{ status: string; camera_id: string | null }>(this.db,
      `UPDATE camera_pairings SET status = CASE WHEN status = 'PENDING' THEN 'EXPIRED' ELSE 'ENDED' END, ended_at = now(), end_reason = $2
        WHERE session_id = $1 AND status IN ('PENDING', 'PAIRED') RETURNING camera_id, (CASE WHEN camera_id IS NULL THEN 'PENDING' ELSE 'PAIRED' END) AS status`,
      [sessionId, reason]);
    if (ended.length === 0) return;
    const was = ended[0]!;
    this.log.write({
      severity: 'INFO', event_type: was.status === 'PAIRED' ? 'camera.released' : 'camera.pairing.cancelled', actor_user_id: userId ?? null, session_id: sessionId,
      entity_type: was.camera_id ? 'camera' : null, entity_id: was.camera_id,
      message: was.status === 'PAIRED' ? `Camera released from the session (${reason})` : `Camera pairing cancelled (${reason})`, details: { reason },
    });
    this.events.tabletScreen(sessionId, null);
    this.events.changed(sessionId);
  }

  private async pairedCamera(sessionId: string): Promise<CameraRow | undefined> {
    const p = await this.openPairing(sessionId);
    return p?.status === 'PAIRED' && p.camera_id ? this.get(p.camera_id) : undefined;
  }

  /** The relay stream for the session's live view (the smaller stream when there is one). */
  async liveStream(sessionId: string): Promise<string | null> {
    const cam = await this.pairedCamera(sessionId);
    if (cam) await this.seen(cam.id);
    return cam ? this.stream(cam, true) : null;
  }

  relayUrl(name: string) {
    return this.deps.relay.liveUrl(name);
  }

  async move(sessionId: string, direction: Direction): Promise<'MOVED' | 'NO_CAMERA' | 'NO_PTZ'> {
    const cam = await this.pairedCamera(sessionId);
    if (!cam) return 'NO_CAMERA';
    if (!cam.ptz || !cam.profile_token) return 'NO_PTZ';
    const account = await this.accountFor(cam);
    if (!account) return 'NO_CAMERA';
    let ptzUrl = this.ptzUrls.get(cam.id);
    if (ptzUrl === undefined) {
      ptzUrl = (await this.deps.onvif(cam.device_url, account).inspect()).ptzUrl;
      this.ptzUrls.set(cam.id, ptzUrl);
    }
    if (!ptzUrl) return 'NO_PTZ';
    await this.deps.onvif(cam.device_url, account).move(ptzUrl, cam.profile_token, direction);
    return 'MOVED';
  }

  // ---- clips -----------------------------------------------------------------------------------

  /** A writing step was dispatched: its clip starts (only when the session records video and has a camera). */
  async startClip(sessionId: string, stepIndex: number, attemptNumber: number) {
    await this.stopClip(sessionId);
    const cam = await this.pairedCamera(sessionId);
    if (!cam) return;
    const name = await this.stream(cam).catch(() => null);
    if (!name) return;
    const dir = join(tmpdir(), 'ilt-clips');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${sessionId}-${stepIndex}-${attemptNumber}-${Date.now()}.mp4`);
    const abort = new AbortController();
    const clip: Clip = {
      sessionId, cameraId: cam.id, stepIndex, attemptNumber, attemptId: null, attemptStartedAt: null, firstByteAt: null, file, abort,
      done: Promise.resolve(null), timer: setTimeout(() => void this.stopClip(sessionId), MAX_CLIP_MS),
    };
    clip.done = (async () => {
      const hash = createHash('sha256');
      let size = 0;
      try {
        const video = await this.deps.relay.mp4(name, abort.signal);
        const tap = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            clip.firstByteAt ??= Date.now();
            hash.update(chunk);
            size += chunk.length;
            cb(null, chunk);
          },
        });
        await pipeline(video, tap, createWriteStream(file), { signal: abort.signal }).catch((err: Error) => {
          if (!abort.signal.aborted) throw err;
        });
      } catch (err) {
        if (!abort.signal.aborted) {
          this.log.write({ severity: 'WARN', event_type: 'camera.clip.failed', session_id: sessionId, entity_type: 'camera', entity_id: cam.id, message: `Clip failed: ${(err as Error).message}`, details: { step_index: stepIndex, attempt_number: attemptNumber } });
        }
      }
      return size > 0 ? { size, sha256: hash.digest('hex') } : null;
    })();
    this.clips.set(sessionId, clip);
    this.events.changed(sessionId);
  }

  /** The attempt started on the tablet: the clip is linked to it, and its zero is now. */
  attemptStarted(sessionId: string, stepIndex: number, attemptNumber: number, attemptId: string) {
    const clip = this.clips.get(sessionId);
    if (!clip || clip.stepIndex !== stepIndex || clip.attemptNumber !== attemptNumber) return;
    clip.attemptId = attemptId;
    clip.attemptStartedAt = Date.now();
  }

  /** Closes the session's clip: stored when its attempt started, otherwise dropped. */
  async stopClip(sessionId: string) {
    const clip = this.clips.get(sessionId);
    if (!clip) return;
    this.clips.delete(sessionId);
    clearTimeout(clip.timer);
    clip.abort.abort();
    const written = await clip.done;
    this.events.changed(sessionId);
    try {
      if (!written || !clip.attemptId || clip.firstByteAt === null || clip.attemptStartedAt === null) return;
      const size = (await stat(clip.file)).size;
      const objectKey = `clips/${sessionId}/${clip.attemptId}.mp4`;
      await this.deps.clips.put(objectKey, clip.file, size);
      const durationMs = Date.now() - clip.firstByteAt;
      await this.seen(clip.cameraId, true);
      const rec = await one<{ id: string }>(this.db,
        `INSERT INTO session_video_records (session_id, object_key, camera_label, started_at, duration_ms, sync_offset_ms, sha256, block_attempt_id, camera_id, size_bytes)
         VALUES ($1, $2, 'OVERHEAD_HANDS', to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8, $9) RETURNING id`,
        [sessionId, objectKey, clip.firstByteAt, durationMs, clip.firstByteAt - clip.attemptStartedAt, written.sha256, clip.attemptId, clip.cameraId, size]);
      this.log.write({
        severity: 'INFO', event_type: 'camera.clip.stored', session_id: sessionId, entity_type: 'block_attempt', entity_id: clip.attemptId,
        message: `Hand video stored: step ${clip.stepIndex}, attempt ${clip.attemptNumber}, ${Math.round(durationMs / 1000)} s, ${Math.round(size / 1024)} KB`,
        details: { record_id: rec!.id, step_index: clip.stepIndex, attempt_number: clip.attemptNumber, size_bytes: size, duration_ms: durationMs },
      });
    } catch (err) {
      this.log.write({ severity: 'ERROR', event_type: 'camera.clip.failed', session_id: sessionId, message: `Clip not stored: ${(err as Error).message}`, details: { step_index: clip.stepIndex, attempt_number: clip.attemptNumber } });
    } finally {
      await rm(clip.file, { force: true });
    }
  }

  isRecording(sessionId: string) {
    return this.clips.has(sessionId);
  }

  /** A stored clip, for replay. */
  openClip(objectKey: string) {
    return this.deps.clips.get(objectKey);
  }
}

/** Reads a whole file as a stream (for uploads). */
export const fileStream = (path: string) => createReadStream(path);
