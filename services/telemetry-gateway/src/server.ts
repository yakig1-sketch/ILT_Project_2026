import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { s3ExportFiles, s3MediaStore } from './media.js';
import { VERSION } from './routes/health.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
// An export still running when the gateway stopped will never finish (Phase 4c).
await pool.query("UPDATE research_exports SET status = 'FAILED', error = 'Interrupted: the gateway restarted', finished_at = now() WHERE status = 'RUNNING'");

const app = await buildApp({
  db: pool,
  checkS3: async () => (await fetch(`${config.s3Endpoint}/`, { signal: AbortSignal.timeout(2000) })).status < 500,
  jwtSecret: config.jwtSecret,
  schoolHmacKey: config.schoolHmacKey,
  media: s3MediaStore(config.s3Endpoint, config.s3AccessKey, config.s3SecretKey),
  exportFiles: s3ExportFiles(config.s3Endpoint, config.s3AccessKey, config.s3SecretKey),
  logLevel: config.logLevel,
  analytics: async (path, body, timeoutMs = 20_000) => {
    const res = await fetch(`${config.analyticsUrl}/api/v1${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: res.status, body: res.status === 200 ? await res.json() : null };
  },
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
