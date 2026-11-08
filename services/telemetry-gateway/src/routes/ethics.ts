// Ethics approvals (DDD §14, FR-PLAN-1, FR-AN-3): the System Administrator records them; a RESEARCH
// approval valid today is one of the conditions for a research session. An approval is never
// deleted: it can be corrected or withdrawn, so sessions that point at it keep a real record.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { one, rows } from '../db.js';

const TYPES = ['INTERVENTION_PROGRAM', 'RESEARCH', 'PREVIOUS_IRB'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(v)));
const inOrder = (a: { valid_from?: string | null; valid_to?: string | null }) => !a.valid_from || !a.valid_to || a.valid_from <= a.valid_to;

const Create = z.object({
  approval_type: z.enum(TYPES),
  authority: z.string().trim().min(1).max(100),
  reference: z.string().trim().max(100).nullable().default(null),
  valid_from: day.nullable().default(null),
  valid_to: day.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
}).refine(inOrder, { message: 'valid_from after valid_to', path: ['valid_to'] });

const Update = z.object({
  authority: z.string().trim().min(1).max(100).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  valid_from: day.nullable().optional(),
  valid_to: day.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** true withdraws the approval (kept, no longer valid); false restores it. */
  withdrawn: z.boolean().optional(),
}).strict();

interface Approval {
  id: number;
  approval_type: string;
  authority: string;
  reference: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  withdrawn_at: string | null;
}

const COLUMNS = `a.id, a.approval_type, a.authority, a.reference, to_char(a.valid_from, 'YYYY-MM-DD') AS valid_from,
  to_char(a.valid_to, 'YYYY-MM-DD') AS valid_to, a.notes, a.withdrawn_at, a.created_at, u.full_name AS created_by,
  (a.withdrawn_at IS NULL AND (a.valid_from IS NULL OR a.valid_from <= current_date) AND (a.valid_to IS NULL OR a.valid_to >= current_date)) AS valid_now,
  (SELECT count(*)::int FROM sessions s WHERE s.research_approval_id = a.id) AS sessions`;

const bad = (details: unknown) => ({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details } });

export const ethicsRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const db = () => app.deps.db;
  const load = (id: number) => one<Approval>(db(), `SELECT ${COLUMNS} FROM ethics_approvals a LEFT JOIN users u ON u.id = a.created_by WHERE a.id = $1`, [id]);

  app.get('/ethics-approvals', { preHandler: staff }, async () =>
    rows(db(), `SELECT ${COLUMNS} FROM ethics_approvals a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC`));

  app.post('/ethics-approvals', { preHandler: admin }, async (req, reply) => {
    const body = Create.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad(body.error.flatten()));
    const user = req.user as UserClaims;
    const a = body.data;
    const created = await one<{ id: number }>(db(),
      `INSERT INTO ethics_approvals (approval_type, authority, reference, valid_from, valid_to, notes, created_by)
       VALUES ($1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), $7) RETURNING id`,
      [a.approval_type, a.authority, a.reference, a.valid_from, a.valid_to, a.notes, user.sub]);
    app.appLog.write({
      severity: 'SECURITY', event_type: 'ethics.approval.created', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'ethics_approval', entity_id: String(created!.id),
      message: `${a.approval_type} approval by ${a.authority} recorded`, details: { ...a },
    });
    return reply.status(201).send(await load(created!.id));
  });

  app.patch<{ Params: { id: string } }>('/ethics-approvals/:id', { preHandler: admin }, async (req, reply) => {
    const id = Number(req.params.id);
    const body = Update.safeParse(req.body);
    if (!Number.isInteger(id) || id < 1 || !body.success) return reply.status(400).send(bad(body.success ? {} : body.error.flatten()));
    const before = await load(id);
    if (!before) return reply.status(404).send({ error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } });
    const { withdrawn, ...p } = body.data;
    const next = { ...before, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '' ? null : v])) } as Approval;
    if (!inOrder(next)) return reply.status(400).send(bad({ valid_to: ['valid_from after valid_to'] }));

    const changed: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of ['authority', 'reference', 'valid_from', 'valid_to', 'notes'] as const) {
      if (p[k] !== undefined && next[k] !== before[k]) changed[k] = { old: before[k], new: next[k] };
    }
    if (withdrawn !== undefined && withdrawn !== (before.withdrawn_at !== null)) changed.withdrawn = { old: before.withdrawn_at !== null, new: withdrawn };
    if (Object.keys(changed).length === 0) return before;

    await db().query(
      `UPDATE ethics_approvals SET authority = $2, reference = $3, valid_from = $4, valid_to = $5, notes = $6,
         withdrawn_at = CASE WHEN $7::boolean IS NULL THEN withdrawn_at WHEN $7 THEN COALESCE(withdrawn_at, now()) ELSE NULL END
       WHERE id = $1`,
      [id, next.authority, next.reference, next.valid_from, next.valid_to, next.notes, withdrawn ?? null]);
    const user = req.user as UserClaims;
    app.appLog.write({
      severity: 'SECURITY', event_type: 'ethics.approval.updated', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'ethics_approval', entity_id: String(id),
      message: `${before.approval_type} approval ${id} ${changed.withdrawn ? (withdrawn ? 'withdrawn' : 'restored') : 'updated'}`,
      details: { approval_type: before.approval_type, changed },
    });
    return load(id);
  });
};
