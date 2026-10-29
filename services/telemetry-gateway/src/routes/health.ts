import type { FastifyPluginAsync } from 'fastify';

export const VERSION = '0.1.0';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_req, reply) => {
    const [db, s3] = await Promise.all([
      app.deps.db.query('SELECT 1').then(() => true, () => false),
      app.deps.checkS3().catch(() => false),
    ]);
    const ok = db && s3;
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', version: VERSION, db, s3 });
  });
};
