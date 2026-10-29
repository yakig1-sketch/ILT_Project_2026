import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { VERSION } from './routes/health.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

const app = await buildApp({
  db: pool,
  checkS3: async () => (await fetch(`${config.s3Endpoint}/`, { signal: AbortSignal.timeout(2000) })).status < 500,
  logLevel: config.logLevel,
});

await app.listen({ port: config.port, host: '0.0.0.0' });
app.appLog.write({
  severity: 'INFO', event_type: 'system.service.started', entity_type: 'service', entity_id: 'telemetry-gateway',
  message: `telemetry-gateway ${VERSION} listening on port ${config.port}`, details: { version: VERSION },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.appLog.write({
      severity: 'INFO', event_type: 'system.service.stopped', entity_type: 'service', entity_id: 'telemetry-gateway',
      message: `telemetry-gateway stopping (${signal})`,
    });
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
