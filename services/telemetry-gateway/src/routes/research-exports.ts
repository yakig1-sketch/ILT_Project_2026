// Research exports (Phase 4c; FRS FR-AN-2, FR-AN-3; Architecture §4.4; DDD §14).
// The analyst's filters are resolved to research session ids as ilt_analyst (the research views only);
// the analytics service builds the Parquet or CSV files from the same views and uploads one zip to
// the private exports bucket. The file is downloaded through the gateway with a link signed for
// 15 minutes, so it works from a plain browser download and never exposes the bucket.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';
import { ResearchFilter, researchWhere } from './research.js';

export interface ExportFiles {
  open(objectKey: string): Promise<{ stream: Readable; size: number | undefined } | null>;
}

/** The most sessions in one export (the analytics service accepts as many). */
export const EXPORT_MAX_SESSIONS = 5000;
const LINK_MINUTES = 15;
const BUILD_TIMEOUT_MS = 10 * 60_000;

const CreateExport = z.object({
  /** The research screen's filters, as in GET /research/sessions (strings, comma lists). */
  filters: z.record(z.string(), z.string()).default({}),
  format: z.enum(['PARQUET', 'CSV']),
  include_samples: z.boolean().default(false),
  include_kinematics: z.boolean().default(false),
});

interface ExportRow {
  id: string;
  requested_by: string;
  requested_at: string;
  status: 'RUNNING' | 'READY' | 'FAILED';
  format: string;
  filters: Record<string, string>;
  include_samples: boolean;
  include_kinematics: boolean;
  session_count: number;
  object_key: string | null;
  size_bytes: string | null;
  row_counts: Record<string, number> | null;
  finished_at: string | null;
}

const COLUMNS = `id, requested_by, requested_at, status, format, filters, include_samples, include_kinematics, session_count,
  object_key, size_bytes, row_counts, finished_at`;

export const researchExportRoutes: FastifyPluginAsync = async (app) => {
  const analyst = app.requireRole('ANALYST', 'RESEARCHER');
  const err = (code: string, message_key: string) => ({ error: { code, message_key, details: {} } });
  const notFound = err('NOT_FOUND', 'error.404');

  /**
   * The file route is opened by the browser itself (a download link), so a refusal is a short page, in
   * Hebrew and English (the server does not know the interface language), not JSON.
   */
  const linkPage = (reply: FastifyReply, status: 403 | 404) => {
    const [he, en] = status === 403
      ? ['קישור ההורדה הזה פג או אינו תקף. הורידו את הייצוא שוב מפורטל האנליסטים.', 'This download link has expired or is not valid. Download the export again from the analyst portal.']
      : ['קובץ הייצוא הזה אינו זמין.', 'This export file is not available.'];
    return reply.status(status).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(
      `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ILT</title>`
      + `<style>body{font-family:"Noto Sans Hebrew","Segoe UI",Arial,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#1f2328;background:#f6f8fa}`
      + `@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}p{margin:0 0 1rem}</style></head>`
      + `<body><p>${he}</p><p lang="en" dir="ltr">${en}</p></body></html>`,
    );
  };

  // The download link: export id, user and expiry, signed with a key derived from the JWT secret.
  const linkKey = createHmac('sha256', app.deps.jwtSecret).update('ilt.research-export.link').digest();
  const sign = (id: string, user: string, expires: number) => createHmac('sha256', linkKey).update(`${id}.${user}.${expires}`).digest('base64url');

  const view = (r: ExportRow) => {
    const { requested_by: _r, object_key: _k, ...rest } = r;
    return { ...rest, size_bytes: r.size_bytes == null ? null : Number(r.size_bytes) };
  };

  /** Builds the export in the background and records the outcome. */
  const build = async (row: ExportRow, sessionIds: string[], user: UserClaims) => {
    try {
      if (!app.deps.analytics) throw new Error('analytics service not configured');
      const res = await app.deps.analytics('/exports', {
        export_id: row.id, session_ids: sessionIds, format: row.format, filters: row.filters,
        include_samples: row.include_samples, include_kinematics: row.include_kinematics,
      }, BUILD_TIMEOUT_MS);
      if (res.status !== 200) throw new Error(`analytics answered ${res.status}`);
      const out = res.body as { object_key: string; size_bytes: number; row_counts: Record<string, number> };
      await app.deps.db.query(
        `UPDATE research_exports SET status = 'READY', object_key = $2, size_bytes = $3, row_counts = $4, finished_at = now() WHERE id = $1`,
        [row.id, out.object_key, out.size_bytes, JSON.stringify(out.row_counts)],
      );
      app.appLog.write({
        severity: 'INFO', event_type: 'data.export.created', actor_user_id: user.sub, actor_role: user.role,
        entity_type: 'research_export', entity_id: row.id,
        message: `Research export created: ${row.session_count} session(s), ${row.format}`,
        details: { format: row.format, filters: row.filters, include_samples: row.include_samples, include_kinematics: row.include_kinematics, row_counts: out.row_counts, size_bytes: out.size_bytes },
      });
    } catch (e) {
      app.log.error({ err: e, export_id: row.id }, 'Research export failed');
      await app.deps.db.query(
        `UPDATE research_exports SET status = 'FAILED', error = $2, finished_at = now() WHERE id = $1`,
        [row.id, String((e as Error).message ?? e).slice(0, 500)],
      ).catch(() => undefined);
      app.appLog.write({
        severity: 'WARN', event_type: 'data.export.created', actor_user_id: user.sub, actor_role: user.role,
        entity_type: 'research_export', entity_id: row.id, message: 'Research export failed', details: { error: String((e as Error).message ?? e).slice(0, 200) },
      });
    }
  };

  /** Requests an export of the research sessions that match the filters. */
  app.post('/research/exports', { preHandler: analyst }, async (req, reply) => {
    const body = CreateExport.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    const f = ResearchFilter.safeParse(body.data.filters);
    if (!f.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: f.error.flatten() } });
    if (!app.deps.analytics) return reply.status(503).send(err('UNAVAILABLE', 'analyst.analytics_down'));
    const { sql, values } = researchWhere(f.data);
    const ids = await inTransaction(app.deps.db, async (q) => {
      await q.query('SET LOCAL ROLE ilt_analyst');
      return (await rows<{ session_id: string }>(q, `SELECT rs.session_id FROM v_research_sessions rs ${sql} ORDER BY rs.completed_at`, values)).map((r) => r.session_id);
    });
    if (ids.length === 0) return reply.status(400).send(err('NO_SESSIONS', 'analyst.export.no_sessions'));
    if (ids.length > EXPORT_MAX_SESSIONS) return reply.status(400).send(err('TOO_MANY', 'analyst.export.too_many'));
    const user = req.user as UserClaims;
    // Keep only the filters that were set, as the analyst chose them.
    const filters = Object.fromEntries(Object.entries(body.data.filters).filter(([, v]) => v !== ''));
    const row = (await one<ExportRow>(app.deps.db, `
      INSERT INTO research_exports (requested_by, format, filters, include_samples, include_kinematics, session_count)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [user.sub, body.data.format, JSON.stringify(filters), body.data.include_samples, body.data.include_kinematics, ids.length]))!;
    void build(row, ids, user);
    return reply.status(202).send(view(row));
  });

  /** The user's own exports, newest first. */
  app.get('/research/exports', { preHandler: analyst }, async (req) => {
    const user = req.user as UserClaims;
    const list = await rows<ExportRow>(app.deps.db, `SELECT ${COLUMNS} FROM research_exports WHERE requested_by = $1 ORDER BY requested_at DESC LIMIT 50`, [user.sub]);
    return { exports: list.map(view), max_sessions: EXPORT_MAX_SESSIONS };
  });

  /** A download link for one of the user's ready exports, valid for 15 minutes. */
  app.post<{ Params: { id: string } }>('/research/exports/:id/link', { preHandler: analyst }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const user = req.user as UserClaims;
    const row = await one<ExportRow>(app.deps.db, `SELECT ${COLUMNS} FROM research_exports WHERE id = $1 AND requested_by = $2 AND status = 'READY'`, [req.params.id, user.sub]);
    if (!row) return reply.status(404).send(notFound);
    const expires = Math.floor(Date.now() / 1000) + LINK_MINUTES * 60;
    const q = new URLSearchParams({ user: user.sub, expires: String(expires), sig: sign(row.id, user.sub, expires) });
    return { url: `/api/v1/research/exports/${row.id}/file?${q}`, expires_at: new Date(expires * 1000).toISOString() };
  });

  /** The export file, for a signed link (no sign-in header: a plain browser download). */
  app.get<{ Params: { id: string }; Querystring: { user?: string; expires?: string; sig?: string } }>('/research/exports/:id/file', async (req, reply) => {
    const { user = '', expires = '', sig = '' } = req.query;
    const id = req.params.id;
    const exp = Number(expires);
    const expected = Buffer.from(sign(id, user, exp));
    const given = Buffer.from(sig);
    const valid = z.string().uuid().safeParse(id).success && Number.isInteger(exp) && exp * 1000 > Date.now()
      && given.length === expected.length && timingSafeEqual(given, expected);
    if (!valid) return linkPage(reply, 403);
    const row = await one<ExportRow & { role: string }>(app.deps.db, `
      SELECT e.*, u.role FROM research_exports e JOIN users u ON u.id = e.requested_by
       WHERE e.id = $1 AND e.requested_by = $2 AND e.status = 'READY' AND u.is_active AND u.role IN ('ANALYST', 'RESEARCHER')`, [id, user]);
    if (!row?.object_key || !app.deps.exportFiles) return linkPage(reply, 404);
    const stamp = new Date(row.requested_at).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    reply.header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="ilt-research-export-${stamp}-${row.format.toLowerCase()}.zip"`)
      .header('cache-control', 'private, no-store');
    // A HEAD request only asks about the file: no file is sent, so nothing is logged.
    if (req.method === 'HEAD') return reply.send();
    const file = await app.deps.exportFiles.open(row.object_key);
    if (!file) return linkPage(reply.removeHeader('content-disposition'), 404);
    app.appLog.write({
      severity: 'INFO', event_type: 'data.export.downloaded', actor_user_id: user, actor_role: row.role as UserClaims['role'],
      entity_type: 'research_export', entity_id: id, message: `Research export downloaded: ${row.session_count} session(s), ${row.format}`,
      details: { format: row.format, size_bytes: Number(row.size_bytes) },
    });
    if (file.size != null) reply.header('content-length', String(file.size));
    return reply.send(file.stream);
  });
};
