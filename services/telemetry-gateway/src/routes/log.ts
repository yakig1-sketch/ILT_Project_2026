// Action-log search for the System Administrator (FR-LOG-3, DDD §12): filter app_events by time
// range, event types, severity, user, session code, Domain/Region and free text; page newest first;
// export the matches to CSV (logged as data.export.created). The log stays append-only (FR-LOG-4):
// there is no route that changes or removes an entry.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LOG_EVENT_TYPES, LOG_SEVERITIES } from '@ilt/shared-types';
import type { UserClaims } from '../auth.js';
import { rows } from '../db.js';

/** Most rows one CSV export holds; narrow the filter for more. */
export const CSV_MAX_ROWS = 50_000;
const PAGE_MAX = 200;
/** The count stops here and is shown as "more than". */
const COUNT_CAP = 10_000;

const list = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(values)).max(values.length));

const Filter = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  types: list(LOG_EVENT_TYPES).optional(),
  severity: list(LOG_SEVERITIES).optional(),
  user_id: z.string().uuid().optional(),
  session_code: z.string().trim().min(1).max(40).optional(),
  domain_id: z.coerce.number().int().positive().optional(),
  region_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
type Filter = z.infer<typeof Filter>;

const Page = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(100),
  /** The `next` cursor of the previous page: "<occurred_at ISO>|<id>". */
  before: z.string().regex(/^[^|]+\|\d+$/).optional(),
});

export interface LogRow {
  id: string;
  occurred_at: string;
  severity: string;
  event_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  device_id: string | null;
  domain_id: number | null;
  domain_code: string | null;
  region_id: number | null;
  region_code: string | null;
  session_id: string | null;
  session_code: string | null;
  entity_type: string | null;
  entity_id: string | null;
  client_ip: string | null;
  message: string;
  details: Record<string, unknown>;
  /** occurred_at to the microsecond, for the page cursor (a JS Date keeps only milliseconds). */
  cursor_at?: string;
}

const bad = (details: unknown) => ({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details } });

/** The WHERE clause and its values for a filter; `extra` conditions are appended. */
function where(f: Filter, values: unknown[] = []): { sql: string; values: unknown[] } {
  const c: string[] = [];
  const add = (cond: (n: string) => string, v: unknown) => {
    values.push(v);
    c.push(cond(`$${values.length}`));
  };
  if (f.from) add((n) => `e.occurred_at >= ${n}::timestamptz`, f.from);
  if (f.to) add((n) => `e.occurred_at < ${n}::timestamptz`, f.to);
  if (f.types?.length) add((n) => `e.event_type = ANY(${n}::text[])`, f.types);
  if (f.severity?.length) add((n) => `e.severity = ANY(${n}::text[])`, f.severity);
  if (f.user_id) add((n) => `e.actor_user_id = ${n}::uuid`, f.user_id);
  if (f.session_code) add((n) => `e.session_id IN (SELECT id FROM sessions WHERE upper(session_code) = upper(${n}))`, f.session_code);
  if (f.domain_id) add((n) => `e.domain_id = ${n}::int`, f.domain_id);
  if (f.region_id) add((n) => `e.region_id = ${n}::int`, f.region_id);
  // Free text: every word must appear (search_text, DDD §12); a word may be the start of a token,
  // so "S2611" finds the session code S261105-JMZW. The text is split by the same parser that built
  // search_text, so a code like QA3F-01 (stored as 'qa3f' and the signed number '-01') is found too.
  if (f.q && /[\p{L}\p{N}]/u.test(f.q)) {
    add(
      (n) => `e.search_text @@ (SELECT to_tsquery('simple', string_agg(quote_literal(lexeme) || ':*', ' & ')) FROM unnest(to_tsvector('simple', ${n})))`,
      f.q.replace(/\\/g, ' '),
    );
  }
  return { sql: c.length ? `WHERE ${c.join(' AND ')}` : '', values };
}

const SELECT = `SELECT e.id::text, e.occurred_at,
         to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at, e.severity, e.event_type, e.actor_user_id, u.full_name AS actor_name, u.email AS actor_email,
         e.actor_role, e.device_id, e.domain_id, d.code AS domain_code, e.region_id, r.code AS region_code, e.session_id,
         s.session_code, e.entity_type, e.entity_id, host(e.client_ip) AS client_ip, e.message, e.details
    FROM app_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    LEFT JOIN domains d ON d.id = e.domain_id
    LEFT JOIN regions r ON r.id = e.region_id
    LEFT JOIN sessions s ON s.id = e.session_id`;

/** One CSV cell: quoted, and a leading = + - @ (a spreadsheet formula) made plain text. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS: [string, (r: LogRow) => unknown][] = [
  ['occurred_at', (r) => new Date(r.occurred_at).toISOString()],
  ['severity', (r) => r.severity],
  ['event_type', (r) => r.event_type],
  ['user_email', (r) => r.actor_email],
  ['user_name', (r) => r.actor_name],
  ['role', (r) => r.actor_role],
  ['device_id', (r) => r.device_id],
  ['domain', (r) => r.domain_code],
  ['region', (r) => r.region_code],
  ['session_code', (r) => r.session_code],
  ['entity_type', (r) => r.entity_type],
  ['entity_id', (r) => r.entity_id],
  ['client_ip', (r) => r.client_ip],
  ['message', (r) => r.message],
  ['details', (r) => r.details],
];

export const logRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const db = () => app.deps.db;

  app.get('/log/events', { preHandler: admin }, async (req, reply) => {
    const f = Filter.safeParse(req.query);
    const p = Page.safeParse(req.query);
    if (!f.success) return reply.status(400).send(bad(f.error.flatten()));
    if (!p.success) return reply.status(400).send(bad(p.error.flatten()));
    const base = where(f.data);
    const page = where(f.data);
    if (p.data.before) {
      const [at, id] = p.data.before.split('|');
      page.values.push(at, id);
      const n = page.values.length;
      page.sql = `${page.sql ? `${page.sql} AND` : 'WHERE'} (e.occurred_at, e.id) < ($${n - 1}::timestamptz, $${n}::bigint)`;
    }
    page.values.push(p.data.limit + 1);
    const found = await rows<LogRow>(db(), `${SELECT} ${page.sql} ORDER BY e.occurred_at DESC, e.id DESC LIMIT $${page.values.length}`, page.values);
    const more = found.length > p.data.limit;
    const events = found.slice(0, p.data.limit);
    const last = events[events.length - 1];
    const next = more && last ? `${last.cursor_at}|${last.id}` : null;
    for (const e of events) delete e.cursor_at;
    // The total is counted once, for the first page.
    let total: number | null = null;
    if (!p.data.before) {
      base.values.push(COUNT_CAP + 1);
      const [c] = await rows<{ n: number }>(db(),
        `SELECT count(*)::int AS n FROM (SELECT 1 FROM app_events e ${base.sql} LIMIT $${base.values.length}) x`, base.values);
      total = c!.n;
    }
    return {
      events,
      next,
      total: total === null ? null : Math.min(total, COUNT_CAP),
      total_capped: total !== null && total > COUNT_CAP,
    };
  });

  app.get('/log/events.csv', { preHandler: admin }, async (req, reply) => {
    const f = Filter.safeParse(req.query);
    if (!f.success) return reply.status(400).send(bad(f.error.flatten()));
    const w = where(f.data);
    w.values.push(CSV_MAX_ROWS + 1);
    const found = await rows<LogRow>(db(), `${SELECT} ${w.sql} ORDER BY e.occurred_at DESC, e.id DESC LIMIT $${w.values.length}`, w.values);
    const truncated = found.length > CSV_MAX_ROWS;
    const out = found.slice(0, CSV_MAX_ROWS);
    const user = req.user as UserClaims;
    app.appLog.write({
      severity: 'INFO', event_type: 'data.export.created', actor_user_id: user.sub, actor_role: user.role,
      client_ip: req.ip, entity_type: 'app_events', entity_id: null,
      message: `Action log exported to CSV: ${out.length} rows${truncated ? ` (first ${CSV_MAX_ROWS})` : ''}`,
      details: { export: 'action_log', rows: out.length, truncated, filter: f.data },
    });
    const lines = [CSV_COLUMNS.map(([h]) => h).join(','), ...out.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(','))];
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ilt_action_log_${stamp}.csv"`)
      .header('x-ilt-rows', String(out.length))
      .header('x-ilt-truncated', String(truncated))
      .header('access-control-expose-headers', 'content-disposition, x-ilt-rows, x-ilt-truncated')
      // A BOM, so Excel opens the Hebrew text as UTF-8.
      .send(`﻿${lines.join('\r\n')}\r\n`);
  });
};
