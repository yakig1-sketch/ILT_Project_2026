import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { AppLog, type Queryable } from './app-log.js';
import { authPlugin, authRoutes } from './auth.js';
import { Hub } from './hub.js';
import { mediaRoutes, type MediaStore } from './media.js';
import { catalogRoutes } from './routes/catalog.js';
import { ethicsRoutes } from './routes/ethics.js';
import { researchRoutes } from './routes/research.js';
import { healthRoutes } from './routes/health.js';
import { logRoutes } from './routes/log.js';
import { organisationRoutes } from './routes/organisation.js';
import { participantRoutes } from './routes/participants.js';
import { resultRoutes } from './routes/results.js';
import { sessionRoutes } from './routes/sessions.js';
import { canvasRoutes } from './routes/canvases.js';
import { referenceRoutes } from './routes/reference.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { researchExportRoutes, type ExportFiles } from './routes/research-exports.js';
import { legacyRoutes } from './routes/legacy.js';

export interface AppDeps {
  db: Queryable;
  /** Returns true when object storage answers. */
  checkS3: () => Promise<boolean>;
  jwtSecret: string;
  /** Key for the school code HMAC; school names are never stored (DDD §15). */
  schoolHmacKey: string;
  /** Object storage for instruction videos; absent in unit tests. */
  media?: MediaStore;
  /**
   * The analytics service (kinematics Phase 4b, exports Phase 4c): a path under its /api/v1, GET, or POST
   * when a body is given; absent when not configured.
   */
  analytics?: (path: string, body?: unknown, timeoutMs?: number) => Promise<{ status: number; body: unknown }>;
  /** The private exports bucket (Phase 4c); absent in unit tests. */
  exportFiles?: ExportFiles;
  logLevel?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    appLog: AppLog;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: deps.logLevel ?? 'info' },
    genReqId: () => crypto.randomUUID(),
  });
  app.decorate('deps', deps);
  app.decorate('appLog', new AppLog(deps.db, app.log));
  await app.register(cors, { origin: true });
  await app.register(authPlugin, { secret: deps.jwtSecret });
  await app.register(websocket, { options: { maxPayload: 1 << 20 } });
  app.decorate('hub', new Hub(app));

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      app.appLog.write({
        severity: 'ERROR', event_type: 'system.error', correlation_id: req.id,
        message: err.message, details: { url: req.url, method: req.method },
      });
    }
    void reply.status(status).send({ error: { code: err.code ?? 'INTERNAL', message_key: `error.${status}`, details: {} } });
  });
  // An unknown address: the usual error shape, without repeating the address (it may hold ids or a signed link).
  app.setNotFoundHandler((_req, reply) => {
    void reply.status(404).send({ error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } });
  });

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(catalogRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(organisationRoutes, { prefix: '/api/v1' });
  await app.register(participantRoutes, { prefix: '/api/v1' });
  await app.register(sessionRoutes, { prefix: '/api/v1' });
  await app.register(resultRoutes, { prefix: '/api/v1' });
  await app.register(settingsRoutes, { prefix: '/api/v1' });
  await app.register(canvasRoutes, { prefix: '/api/v1' });
  await app.register(referenceRoutes, { prefix: '/api/v1' });
  await app.register(logRoutes, { prefix: '/api/v1' });
  await app.register(ethicsRoutes, { prefix: '/api/v1' });
  await app.register(researchRoutes, { prefix: '/api/v1' });
  await app.register(researchExportRoutes, { prefix: '/api/v1' });
  await app.register(legacyRoutes, { prefix: '/api/v1' });
  await app.register(mediaRoutes, { prefix: '/api/v1' });

  // Real-time links (DDD §5.1). Authentication is the first message on the socket.
  app.get('/ws/tablet', { websocket: true }, (socket, req) => app.hub.accept(socket, 'tablet', req.ip));
  app.get('/ws/cockpit', { websocket: true }, (socket, req) => app.hub.accept(socket, 'cockpit', req.ip));

  app.addHook('onClose', async () => app.appLog.flush());
  return app;
}
