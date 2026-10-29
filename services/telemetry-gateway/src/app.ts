import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { AppLog, type Queryable } from './app-log.js';
import { authPlugin, authRoutes } from './auth.js';
import { Hub } from './hub.js';
import { catalogRoutes } from './routes/catalog.js';
import { healthRoutes } from './routes/health.js';
import { participantRoutes } from './routes/participants.js';
import { sessionRoutes } from './routes/sessions.js';

export interface AppDeps {
  db: Queryable;
  /** Returns true when object storage answers. */
  checkS3: () => Promise<boolean>;
  jwtSecret: string;
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

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(catalogRoutes, { prefix: '/api/v1' });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(participantRoutes, { prefix: '/api/v1' });
  await app.register(sessionRoutes, { prefix: '/api/v1' });

  // Real-time links (DDD §5.1). Authentication is the first message on the socket.
  app.get('/ws/tablet', { websocket: true }, (socket, req) => app.hub.accept(socket, 'tablet', req.ip));
  app.get('/ws/cockpit', { websocket: true }, (socket, req) => app.hub.accept(socket, 'cockpit', req.ip));

  app.addHook('onClose', async () => app.appLog.flush());
  return app;
}
