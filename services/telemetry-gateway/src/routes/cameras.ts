// Session video capture (Phase 5f). Administrator: the site camera account and the cameras found on the
// network. Evaluator: pair a camera to a session by the tablet's QR code, position it (live view and
// pan/tilt), let it go. Replay: a stored clip. Camera passwords are never sent to a client.
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import WebSocket from 'ws';
import { z } from 'zod';
import type { TokenClaims, UserClaims } from '../auth.js';
import type { CameraRow } from '../camera/service.js';
import { one } from '../db.js';
import { loadSession, type SessionRow } from './sessions.js';

const Account = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) });
const CameraPatch = z.object({
  label: z.string().trim().max(50).nullable().optional(),
  retired: z.boolean().optional(),
  /** Its own account; null clears it (the site account is used again). */
  own_account: Account.nullable().optional(),
});
const Move = z.object({ direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']) });

/** A camera as clients see it: no password, only whether it has its own account. */
const publicCamera = (c: CameraRow) => ({
  id: c.id, model: c.model, label: c.label, host: c.host, status: c.status, ptz: c.ptz, retired: c.retired,
  own_account: !!(c.username && c.password_enc), own_username: c.username,
  has_sub_stream: !!c.rtsp_sub_url, last_seen_at: c.last_seen_at, last_checked_at: c.last_checked_at,
});

export const cameraRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const evaluator = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const err = (code: string, key: string) => ({ error: { code, message_key: key, details: {} } });
  const notFound = err('NOT_FOUND', 'error.404');
  const off = err('CAMERAS_OFF', 'camera.off');

  /** Evaluators reach only their own sessions. */
  async function ownSession(req: FastifyRequest<{ Params: { id: string } }>): Promise<SessionRow | undefined> {
    const user = req.user as UserClaims;
    if (!z.string().uuid().safeParse(req.params.id).success) return undefined;
    const s = await loadSession(app.deps.db, req.params.id);
    if (!s || (user.role === 'EVALUATOR' && s.evaluator_id !== user.sub)) return undefined;
    return s;
  }

  // ---- administrator ---------------------------------------------------------------------------

  app.get('/cameras', { preHandler: admin }, async (_req, reply) => {
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    const account = await one<{ username: string; updated_at: string }>(app.deps.db, 'SELECT username, updated_at FROM camera_account WHERE id = 1');
    return {
      account: account ? { username: account.username, updated_at: account.updated_at } : null,
      relay: await cameras.relayAlive(),
      cameras: (await cameras.list()).map(publicCamera),
    };
  });

  /** The site camera account; every camera is checked with it again. */
  app.put('/cameras/account', { preHandler: admin }, async (req, reply) => {
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    const body = Account.safeParse(req.body);
    if (!body.success) return reply.status(400).send(err('BAD_REQUEST', 'error.400'));
    const user = req.user as UserClaims;
    await cameras.setSiteAccount(body.data.username, body.data.password, user.sub);
    app.appLog.write({
      severity: 'SECURITY', event_type: 'camera.account.changed', actor_user_id: user.sub, actor_role: user.role,
      message: `Site camera account set (user ${body.data.username})`, details: { username: body.data.username },
    });
    const list = await cameras.refresh();
    return { cameras: list.map(publicCamera) };
  });

  /** Searches the network for cameras and checks each one found. */
  app.post('/cameras/discover', { preHandler: admin }, async (_req, reply) => {
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    return { cameras: (await cameras.refresh()).map(publicCamera) };
  });

  app.patch<{ Params: { id: string } }>('/cameras/:id', { preHandler: admin }, async (req, reply) => {
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    const body = CameraPatch.safeParse(req.body);
    if (!body.success || !z.string().uuid().safeParse(req.params.id).success) return reply.status(400).send(err('BAD_REQUEST', 'error.400'));
    const cam = await cameras.get(req.params.id);
    if (!cam) return reply.status(404).send(notFound);
    const updated = await cameras.update(cam, body.data);
    const user = req.user as UserClaims;
    app.appLog.write({
      severity: body.data.own_account !== undefined ? 'SECURITY' : 'INFO', event_type: 'camera.updated', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'camera', entity_id: cam.id,
      message: `Camera "${updated.label ?? updated.model}" (${updated.host}): ${[
        body.data.label !== undefined && (body.data.label ? `named "${body.data.label}"` : 'name removed'),
        body.data.retired !== undefined && (body.data.retired ? 'retired' : 'restored'),
        body.data.own_account !== undefined && (body.data.own_account ? `own account set (user ${body.data.own_account.username}), status ${updated.status}` : 'back to the site account'),
      ].filter(Boolean).join(', ')}`,
      details: { label: body.data.label, retired: body.data.retired, own_account: body.data.own_account === undefined ? undefined : !!body.data.own_account },
    });
    return publicCamera(updated);
  });

  /** A picture from the camera, so the administrator can see which one it is. */
  app.get<{ Params: { id: string } }>('/cameras/:id/snapshot', { preHandler: admin }, async (req, reply) => {
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const cam = await cameras.get(req.params.id);
    if (!cam) return reply.status(404).send(notFound);
    const picture = await cameras.snapshot(cam).catch(() => null);
    if (!picture) return reply.status(502).send(err('NO_PICTURE', 'camera.no_picture'));
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'no-store').send(picture);
  });

  // ---- the session's camera --------------------------------------------------------------------

  app.get<{ Params: { id: string } }>('/sessions/:id/camera', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (!app.cameras) return { video_enabled: s.video_enabled, available: false, state: null };
    return { video_enabled: s.video_enabled, available: true, state: await app.cameras.state(s.id) };
  });

  /** Starts pairing: the tablet shows a one-time QR code; the camera that sees it is paired. */
  app.post<{ Params: { id: string } }>('/sessions/:id/camera/pair', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    const cameras = app.cameras;
    if (!cameras) return reply.status(503).send(off);
    if (!s.video_enabled) return reply.status(409).send(err('VIDEO_OFF', 'camera.video_off'));
    if (s.status === 'COMPLETED' || s.status === 'ABORTED') return reply.status(409).send(err('SESSION_CLOSED', 'sessions.closed'));
    const blocker = app.hub.cameraBlocker(s.id);
    if (blocker) return reply.status(409).send(err(blocker, blocker === 'TABLET_OFFLINE' ? 'camera.tablet_offline' : 'camera.step_running'));
    const user = req.user as UserClaims;
    const p = await cameras.startPairing(s.id, user.sub);
    return { expires_at: p.expires_at };
  });

  /** Cancels a pairing in progress, or lets the paired camera go. */
  app.post<{ Params: { id: string } }>('/sessions/:id/camera/release', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (!app.cameras) return reply.status(503).send(off);
    if (app.cameras.isRecording(s.id)) return reply.status(409).send(err('STEP_RUNNING', 'camera.step_running'));
    await app.cameras.endPairing(s.id, 'BY_EVALUATOR', (req.user as UserClaims).sub);
    return { ok: true };
  });

  /** Positioning done: the tablet leaves the framing guide. */
  app.post<{ Params: { id: string } }>('/sessions/:id/camera/positioned', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (!app.cameras) return reply.status(503).send(off);
    await app.cameras.finishPositioning(s.id);
    return { ok: true };
  });

  /** Turns the paired camera a small step (pan/tilt cameras only). */
  app.post<{ Params: { id: string } }>('/sessions/:id/camera/move', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (!app.cameras) return reply.status(503).send(off);
    const body = Move.safeParse(req.body);
    if (!body.success) return reply.status(400).send(err('BAD_REQUEST', 'error.400'));
    try {
      const result = await app.cameras.move(s.id, body.data.direction);
      if (result !== 'MOVED') return reply.status(409).send(err(result, result === 'NO_PTZ' ? 'camera.no_ptz' : 'camera.not_paired'));
    } catch {
      return reply.status(502).send(err('CAMERA_ERROR', 'camera.move_failed'));
    }
    return { ok: true };
  });

  // ---- replay ----------------------------------------------------------------------------------

  /** A stored hand-video clip, for the replay of its attempt (evaluators: their own sessions). */
  app.get<{ Params: { id: string } }>('/media/clips/:id', { preHandler: evaluator }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const user = req.user as UserClaims;
    const clip = await one<{ object_key: string; evaluator_id: string; content_type: string }>(app.deps.db,
      `SELECT v.object_key, s.evaluator_id, v.content_type FROM session_video_records v JOIN sessions s ON s.id = v.session_id WHERE v.id = $1`, [req.params.id]);
    if (!clip || (user.role === 'EVALUATOR' && clip.evaluator_id !== user.sub) || !app.cameras) return reply.status(404).send(notFound);
    const file = await app.cameras.openClip(clip.object_key);
    if (!file) return reply.status(404).send(notFound);
    reply.header('content-type', clip.content_type).header('cache-control', 'private, max-age=3600');
    if (file.size !== undefined) reply.header('content-length', file.size);
    return reply.send(file.stream);
  });

};

/**
 * The paired camera's live view, registered next to the other sockets (/ws/…).
 */
export const cameraLiveRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The paired camera's live view (MSE over a WebSocket), relayed from the camera relay. The first
   * message authenticates ({ auth, session_id }); after that the relay's messages pass both ways.
   */
  app.get('/ws/camera', { websocket: true }, (socket) => {
    let upstream: WebSocket | null = null;
    let authenticating = false;
    const pending: (Buffer | string)[] = [];
    const timer = setTimeout(() => socket.close(4401, 'auth timeout'), 5000);
    socket.on('close', () => upstream?.close());
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      // After the first (sign-in) message, everything goes to the relay; what arrives before it is connected waits.
      if (authenticating) {
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(isBinary ? data : data.toString('utf8'));
        else pending.push(isBinary ? data : data.toString('utf8'));
        return;
      }
      authenticating = true;
      void (async () => {
        clearTimeout(timer);
        let msg: { auth?: unknown; session_id?: unknown };
        try {
          msg = JSON.parse(data.toString('utf8')) as typeof msg;
        } catch {
          return socket.close(4401, 'bad auth');
        }
        let claims: TokenClaims;
        try {
          claims = app.jwt.verify<TokenClaims>(String(msg.auth));
        } catch {
          return socket.close(4401, 'bad token');
        }
        if (claims.typ !== 'access' || !['EVALUATOR', 'RESEARCHER', 'ADMIN'].includes(claims.role)) return socket.close(4401, 'wrong token');
        const sessionId = String(msg.session_id ?? '');
        const s = /^[0-9a-f-]{36}$/i.test(sessionId) ? await loadSession(app.deps.db, sessionId) : undefined;
        if (!s || (claims.role === 'EVALUATOR' && s.evaluator_id !== claims.sub) || !app.cameras) return socket.close(4404, 'no such session');
        const name = await app.cameras.liveStream(s.id).catch(() => null);
        if (!name) return socket.close(4409, 'no camera');
        upstream = new WebSocket(app.cameras.relayUrl(name));
        upstream.on('open', () => {
          for (const m of pending.splice(0)) upstream!.send(m);
        });
        upstream.on('message', (d: Buffer, bin: boolean) => {
          if (socket.readyState === socket.OPEN) socket.send(bin ? d : d.toString('utf8'));
        });
        upstream.on('close', () => socket.close(1000, 'camera closed'));
        upstream.on('error', () => socket.close(1011, 'relay error'));
      })();
    });
  });
};
