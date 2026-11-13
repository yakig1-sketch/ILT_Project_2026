// Intervention marks of a sheet attempt (Phase 5c, FRS FR-COCK-5, DDD §8.7, §14): read them, and
// let the evaluator set or clear their own value per letter. Each change is logged with the old and
// the new mark (FR-LOG-1).
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { inTransaction, one } from '../db.js';
import { loadMarks, markWord } from '../marks-store.js';

const SetMarks = z.object({
  marks: z.array(z.object({
    box_id: z.number().int().min(0).max(254),
    /** true = error, false = correct, null = clear the evaluator's value (back to the system's suggestion). */
    error: z.boolean().nullable(),
  })).min(1).max(30),
});

interface AttemptRow {
  id: string;
  attempt_number: number;
  status: string;
  step_index: number;
  step_type: string;
  fill_order: number[] | null;
  session_id: string;
  session_code: string;
  session_status: string;
  evaluator_id: string;
  domain_id: number;
  region_id: number | null;
}

export const markRoutes: FastifyPluginAsync = async (app) => {
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };

  /** A sheet attempt the user may reach: evaluators their own sessions only. */
  async function sheetAttempt(req: FastifyRequest<{ Params: { id: string } }>): Promise<AttemptRow | undefined> {
    if (!z.string().uuid().safeParse(req.params.id).success) return undefined;
    const user = req.user as UserClaims;
    const a = await one<AttemptRow>(
      app.deps.db,
      `SELECT ba.id, ba.attempt_number, ba.status, st.step_index, st.step_type, st.fill_order, s.id AS session_id, s.session_code,
              s.status AS session_status, s.evaluator_id, s.domain_id, s.region_id
         FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id JOIN sessions s ON s.id = st.session_id
        WHERE ba.id = $1`,
      [req.params.id],
    );
    if (!a || a.step_type !== 'INTERVENTION_SHEET') return undefined;
    if (user.role === 'EVALUATOR' && a.evaluator_id !== user.sub) return undefined;
    return a;
  }

  const payload = async (a: AttemptRow) => ({
    block_attempt_id: a.id, session_id: a.session_id, step_index: a.step_index, attempt_number: a.attempt_number,
    marks: await loadMarks(app.deps.db, a.id, a.fill_order ?? []),
  });

  app.get<{ Params: { id: string } }>('/block-attempts/:id/intervention-marks', { preHandler: staff }, async (req, reply) => {
    const a = await sheetAttempt(req);
    if (!a) return reply.status(404).send(notFound);
    return payload(a);
  });

  app.put<{ Params: { id: string } }>('/block-attempts/:id/intervention-marks', { preHandler: staff }, async (req, reply) => {
    const body = SetMarks.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    const a = await sheetAttempt(req);
    if (!a) return reply.status(404).send(notFound);
    if (a.session_status === 'ABORTED') {
      return reply.status(409).send({ error: { code: 'SESSION_CLOSED', message_key: 'sessions.closed', details: {} } });
    }
    const user = req.user as UserClaims;
    type Change = { box_id: number; row_type: string; letter: string; old: boolean | null; now: boolean | null; evaluator: boolean | null };
    const result = await inTransaction(app.deps.db, async (q) => {
      const changes: Change[] = [];
      for (const m of body.data.marks) {
        const cur = await one<{ row_type: string; letter: string; auto_error: boolean | null; evaluator_error: boolean | null; final_error: boolean | null }>(
          q, 'SELECT row_type, letter, auto_error, evaluator_error, final_error FROM intervention_marks WHERE block_attempt_id = $1 AND box_id = $2 FOR UPDATE',
          [a.id, m.box_id],
        );
        if (!cur) return { unknown: m.box_id };
        if (cur.evaluator_error === m.error) continue;
        const final = m.error ?? cur.auto_error;
        await q.query(
          `UPDATE intervention_marks SET evaluator_error = $3, final_error = $4,
                  decided_by = CASE WHEN $3::boolean IS NOT NULL THEN 'EVALUATOR' WHEN auto_error IS NOT NULL THEN 'SYSTEM' ELSE NULL END,
                  decided_by_user = CASE WHEN $3::boolean IS NULL THEN NULL ELSE $5::uuid END,
                  decided_at = CASE WHEN $3::boolean IS NULL AND auto_error IS NULL THEN NULL ELSE now() END
            WHERE block_attempt_id = $1 AND box_id = $2`,
          [a.id, m.box_id, m.error, final, user.sub],
        );
        changes.push({ box_id: m.box_id, row_type: cur.row_type, letter: cur.letter, old: cur.final_error, now: final, evaluator: m.error });
      }
      return { changes };
    });
    if ('unknown' in result) {
      return reply.status(400).send({ error: { code: 'UNKNOWN_BOX', message_key: 'error.400', details: { box_id: result.unknown } } });
    }
    for (const c of result.changes) {
      app.appLog.write({
        severity: 'INFO', event_type: 'intervention.mark.changed', actor_user_id: user.sub, actor_role: user.role,
        domain_id: a.domain_id, region_id: a.region_id, session_id: a.session_id, entity_type: 'block_attempt', entity_id: a.id,
        message: `Mark of ${c.letter} (box ${c.box_id}, ${c.row_type}) on ${a.session_code} step ${a.step_index}, attempt ${a.attempt_number}: `
          + `${markWord(c.old)} → ${markWord(c.now)}${c.evaluator === null ? ' (back to the system\'s suggestion)' : ''}`,
        details: { box_id: c.box_id, row_type: c.row_type, step_index: a.step_index, attempt_number: a.attempt_number,
          old_final_error: c.old, new_final_error: c.now, evaluator_error: c.evaluator },
      });
    }
    return payload(a);
  });
};
