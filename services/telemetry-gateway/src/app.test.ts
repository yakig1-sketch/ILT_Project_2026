import { describe, expect, it } from 'vitest';
import { ILT_GRID_GEOMETRY } from '@ilt/template-schemas';
import { buildApp as build, type AppDeps } from './app.js';

const buildApp = (deps: Omit<AppDeps, 'jwtSecret'>) => build({ ...deps, jwtSecret: 'test-secret' });

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
});
