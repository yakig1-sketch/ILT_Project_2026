import { describe, expect, it } from 'vitest';
import { ILT_GRID_GEOMETRY } from '@ilt/template-schemas';
import { buildApp as build, type AppDeps } from './app.js';
import { parseTrustProxy } from './config.js';

const buildApp = (deps: Omit<AppDeps, 'jwtSecret' | 'schoolHmacKey'>) => build({ ...deps, jwtSecret: 'test-secret', schoolHmacKey: 'test-school-key' });

function fakeDb(rows: unknown[] = [], fail = false) {
  const queries: { text: string; values?: unknown[] }[] = [];
  return {
    queries,
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (fail) throw new Error('db down');
      return { rows };
    },
  };
}

describe('gateway', () => {
  it('health is ok when the database and S3 answer', async () => {
    const app = await buildApp({ db: fakeDb(), checkS3: async () => true, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: true, s3: true });
    await app.close();
  });

  it('health is degraded (503) when the database is down', async () => {
    const app = await buildApp({ db: fakeDb([], true), checkS3: async () => true, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json().db).toBe(false);
    await app.close();
  });

  it('serves a canvas mirrored on request', async () => {
    const db = fakeDb([{ code: 'ILT_3X5_EN', geometry: ILT_GRID_GEOMETRY }]);
    const app = await buildApp({ db, checkS3: async () => true, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/v1/canvases?language=en&mirrored=true' });
    const b = res.json()[0].geometry.dots.find((d: { id: string }) => d.id === 'B');
    expect(b.x).toBeCloseTo(15.0);
    await app.close();
  });

  it('writes app events to the database in one batch', async () => {
    const db = fakeDb();
    const app = await buildApp({ db, checkS3: async () => true, logLevel: 'silent' });
    app.appLog.write({ severity: 'INFO', event_type: 'system.service.started', message: 'a' });
    app.appLog.write({ severity: 'INFO', event_type: 'session.created', message: 'b', details: { x: 1 } });
    await app.appLog.flush();
    const inserts = db.queries.filter((q) => q.text.startsWith('INSERT INTO app_events'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toContain('session.created');
    await app.close();
  });

  it('reads TRUST_PROXY as off, true, a hop count or address names (Phase 6b′)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy(' ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('uniquelocal')).toBe('uniquelocal');
  });

  it('behind a trusted proxy, locks tablet pairing per forwarded client address (Phase 6b′)', async () => {
    const app = await buildApp({ db: fakeDb(), checkS3: async () => true, logLevel: 'silent', trustProxy: 'uniquelocal' });
    const pair = (client: string) => app.inject({
      method: 'POST', url: '/api/v1/sessions/pair', remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': client },
      payload: { pin: '000000', css_px_per_mm: 5, device_pixel_ratio: 1, screen_w_mm: 300, screen_h_mm: 200 },
    });
    for (let i = 0; i < 5; i++) expect((await pair('203.0.113.7')).statusCode).toBe(401);
    expect((await pair('203.0.113.7')).statusCode).toBe(429);
    // Another tester behind the same proxy is not locked out.
    expect((await pair('198.51.100.9')).statusCode).toBe(401);
    await app.close();
  });
});
