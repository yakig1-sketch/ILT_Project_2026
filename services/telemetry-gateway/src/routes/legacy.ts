// Legacy data and the paper cohort (Phase 4d; FRS FR-LEG-1, FR-LEG-2; DDD §9, §14).
//
// Legacy import (System Administrator): the old application's measure files are read by the analytics
// service; the gateway matches the children to LEGACY participants by their old number (creating the
// missing ones as LEG-<number>, with grade and gender not recorded) and fills one row per child,
// session label and block. "Check" runs everything but writes nothing.
//
// Paper scores (staff): pen lifts, accurate letters and time per block for a PAPER-cohort participant.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';

const MEASURE_COLUMN = {
  HAND_RAISES: 'pen_lifts',
  SEGMENT_WIDTH: 'width_mm',
  TOTAL_TIME: 'total_time_ms',
  WRITING_TIME: 'writing_time_ms',
  AIR_TIME: 'air_time_ms',
} as const;
type Measure = keyof typeof MEASURE_COLUMN;
const MEASURES = Object.keys(MEASURE_COLUMN) as Measure[];

const ImportBody = z.object({
  files: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    content_base64: z.string().min(1).max(14_000_000),
    measure: z.enum(MEASURES as [Measure, ...Measure[]]).nullable().optional(),
  })).min(1).max(5),
  domain_id: z.number().int().positive(),
  session_label: z.string().trim().min(1).max(50),
  dry_run: z.boolean().default(true),
});

interface ParsedFile { name: string; measure: Measure | null; detected: Measure | null; rows: number; blocks: number; warnings: string[]; error: string | null }
interface ParsedChild {
  legacy_id: string;
  hand: 'RIGHT' | 'LEFT' | null;
  hand_raw: number | null;
  mistakes: number | null;
  blocks: Record<string, Partial<Record<Measure, number>>>;
  raw: Record<string, Partial<Record<Measure, { file: string; value: unknown }>>>;
}

/** Block numbers of each session stage on paper (Day 1: ILT 1–8, Day 2: ILT 1–4, Day 14: ILT 1–2). */
export const PAPER_BLOCKS = { DAY_1: 8, DAY_2: 4, DAY_14: 2 } as const;

const PaperScore = z.object({
  session_type: z.enum(['DAY_1', 'DAY_2', 'DAY_14']),
  block_number: z.number().int().min(1).max(8),
  pen_lifts: z.number().int().min(0).max(200).nullable(),
  accurate_letters: z.number().int().min(0).max(15).nullable(),
  total_time_ms: z.number().int().min(0).max(3_600_000).nullable(),
  notes: z.string().trim().max(500).nullable().default(null),
}).refine((v) => v.block_number <= PAPER_BLOCKS[v.session_type], { path: ['block_number'], message: 'block out of range' });

export const legacyRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const err = (status: number, code: string, message_key: string, details: unknown = {}) => ({ status, body: { error: { code, message_key, details } } });

  /** Checks (dry_run) or imports one set of the old application's measure files. */
  app.post('/legacy/import', { preHandler: admin, bodyLimit: 80 * 1024 * 1024 }, async (req, reply) => {
    const body = ImportBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    const b = body.data;
    if (!(await one(app.deps.db, 'SELECT 1 FROM domains WHERE id = $1 AND is_active', [b.domain_id]))) {
      return reply.status(400).send(err(400, 'BAD_DOMAIN', 'legacy.bad_domain').body);
    }
    if (!app.deps.analytics) return reply.status(503).send(err(503, 'UNAVAILABLE', 'legacy.analytics_down').body);
    let parsed: { files: ParsedFile[]; children: ParsedChild[]; warnings: string[] };
    try {
      const res = await app.deps.analytics('/legacy/parse', { files: b.files.map((f) => ({ name: f.name, content_base64: f.content_base64, measure: f.measure ?? null })) }, 60_000);
      if (res.status !== 200) throw new Error(`analytics answered ${res.status}`);
      parsed = res.body as typeof parsed;
    } catch (e) {
      app.log.error({ err: e }, 'Legacy parse failed');
      return reply.status(503).send(err(503, 'UNAVAILABLE', 'legacy.analytics_down').body);
    }
    const usable = parsed.files.filter((f) => !f.error && f.measure);
    const ids = parsed.children.map((c) => c.legacy_id);
    const existing = new Map((await rows<{ id: string; legacy_ref: string; study_code: string }>(app.deps.db,
      "SELECT id, legacy_ref, study_code FROM participants WHERE cohort = 'LEGACY' AND legacy_ref = ANY($1::text[])", [ids])).map((r) => [r.legacy_ref, r]));
    // A new child's study code must not belong to someone else already.
    const taken = new Set((await rows<{ code: string }>(app.deps.db,
      'SELECT upper(study_code) AS code FROM participants WHERE upper(study_code) = ANY($1::text[])',
      [ids.filter((i) => !existing.has(i)).map((i) => `LEG-${i}`.toUpperCase())])).map((r) => r.code));
    const conflicts = ids.filter((i) => !existing.has(i) && taken.has(`LEG-${i}`.toUpperCase()));
    const importable = parsed.children.filter((c) => !conflicts.includes(c.legacy_id));
    const blockRows = importable.reduce((n, c) => n + Object.keys(c.blocks).length, 0);
    const already = existing.size === 0 ? 0 : Number((await one<{ n: string }>(app.deps.db,
      'SELECT count(*) AS n FROM legacy_block_results WHERE session_label = $1 AND participant_id = ANY($2::uuid[])',
      [b.session_label, [...existing.values()].map((e) => e.id)]))?.n ?? 0);
    const preview = {
      files: parsed.files,
      warnings: parsed.warnings,
      children: importable.length,
      new_children: importable.filter((c) => !existing.has(c.legacy_id)).length,
      existing_children: importable.filter((c) => existing.has(c.legacy_id)).length,
      conflicts: conflicts.map((i) => `LEG-${i}`),
      block_rows: blockRows,
      rows_to_update: already,
      sample: importable.slice(0, 8).map((c) => ({
        legacy_id: c.legacy_id, study_code: existing.get(c.legacy_id)?.study_code ?? `LEG-${c.legacy_id}`, existing: existing.has(c.legacy_id),
        hand: c.hand, mistakes: c.mistakes, blocks: Object.keys(c.blocks).length, block_1: c.blocks['1'] ?? null,
      })),
    };
    if (b.dry_run) return { dry_run: true, ...preview };
    // Two files set to the same measure: importing the rest would hide the mistake, so nothing is imported.
    if (parsed.files.some((f) => f.error === 'measure_twice')) return reply.status(400).send(err(400, 'MEASURE_TWICE', 'legacy.measure_twice').body);
    if (usable.length === 0 || importable.length === 0) return reply.status(400).send(err(400, 'NOTHING', 'legacy.nothing_to_import').body);

    const user = req.user as UserClaims;
    const result = await inTransaction(app.deps.db, async (q) => {
      const batch = (await one<{ id: string }>(q, `
        INSERT INTO legacy_import_batches (imported_by, session_label, domain_id, files, participants_created, participants_matched, block_rows)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user.sub, b.session_label, b.domain_id, JSON.stringify(usable.map((f) => ({ name: f.name, measure: f.measure, rows: f.rows }))),
          preview.new_children, preview.existing_children, blockRows]))!;
      const sourceFiles = usable.map((f) => f.name).join('; ').slice(0, 1000);
      for (const c of importable) {
        let pid = existing.get(c.legacy_id)?.id;
        if (!pid) {
          // Grade, gender, SES, school and birth month are not in the old files, nor the hand when L/R is missing: not recorded.
          pid = (await one<{ id: string }>(q, `
            INSERT INTO participants (study_code, domain_id, grade_level, gender, dominant_hand, cohort, legacy_ref, created_by)
            VALUES ($1, $2, NULL, NULL, $3, 'LEGACY', $4, $5) RETURNING id`,
            [`LEG-${c.legacy_id}`, b.domain_id, c.hand, c.legacy_id, user.sub]))!.id;
        }
        for (const [block, values] of Object.entries(c.blocks)) {
          const set = MEASURES.filter((m) => values[m] !== undefined);
          const cols = set.map((m) => MEASURE_COLUMN[m]);
          const vals = set.map((m) => (m === 'SEGMENT_WIDTH' ? values[m] : Math.round(values[m]!)));
          const raw = { ...c.raw[block], participant: { 'L/R': c.hand_raw, Mistakes: c.mistakes } };
          const params = [pid, batch.id, sourceFiles, b.session_label, Number(block), JSON.stringify(raw), ...vals];
          await q.query(`
            INSERT INTO legacy_block_results (participant_id, import_batch_id, source_file, session_label, block_number, raw_row${cols.map((col) => `, ${col}`).join('')})
            VALUES ($1, $2, $3, $4, $5, $6${cols.map((_, i) => `, $${i + 7}`).join('')})
            ON CONFLICT (participant_id, session_label, block_number) DO UPDATE SET
              import_batch_id = EXCLUDED.import_batch_id, source_file = EXCLUDED.source_file, imported_at = now(),
              raw_row = legacy_block_results.raw_row || EXCLUDED.raw_row${cols.map((col) => `, ${col} = EXCLUDED.${col}`).join('')}`, params);
        }
      }
      return batch.id;
    });
    app.appLog.write({
      severity: 'INFO', event_type: 'data.legacy.imported', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'legacy_import', entity_id: result,
      message: `Legacy import "${b.session_label}": ${preview.children} children (${preview.new_children} new), ${blockRows} block rows`,
      details: { files: usable.map((f) => ({ name: f.name, measure: f.measure, rows: f.rows })), domain_id: b.domain_id, session_label: b.session_label,
        new_children: preview.new_children, existing_children: preview.existing_children, block_rows: blockRows, conflicts: preview.conflicts, warnings: parsed.warnings.length },
    });
    return { dry_run: false, batch_id: result, ...preview };
  });

  /** The legacy imports, newest first. */
  app.get('/legacy/imports', { preHandler: admin }, async () =>
    rows(app.deps.db, `
      SELECT b.id, b.imported_at, u.full_name AS imported_by, b.session_label, b.domain_id, b.files, b.participants_created, b.participants_matched, b.block_rows
        FROM legacy_import_batches b JOIN users u ON u.id = b.imported_by ORDER BY b.imported_at DESC LIMIT 100`));

  /** A participant's legacy block results (FR-LEG-1). */
  app.get<{ Params: { id: string } }>('/participants/:id/legacy-results', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(err(404, 'NOT_FOUND', 'error.404').body);
    return rows(app.deps.db, `
      SELECT session_label, block_number, pen_lifts, width_mm, total_time_ms, writing_time_ms, air_time_ms,
             raw_row->'participant'->>'Mistakes' AS mistakes, imported_at
        FROM legacy_block_results WHERE participant_id = $1 ORDER BY session_label, block_number`, [req.params.id]);
  });

  /** A paper-cohort participant's scores (FR-LEG-2). */
  app.get<{ Params: { id: string } }>('/participants/:id/paper-scores', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(err(404, 'NOT_FOUND', 'error.404').body);
    return rows(app.deps.db, `
      SELECT ps.session_type, ps.block_number, ps.pen_lifts, ps.accurate_letters, ps.total_time_ms, ps.notes,
             coalesce(ps.updated_at, ps.entered_at) AS saved_at, coalesce(uu.full_name, ue.full_name) AS saved_by
        FROM paper_block_scores ps JOIN users ue ON ue.id = ps.entered_by LEFT JOIN users uu ON uu.id = ps.updated_by
       WHERE ps.participant_id = $1 ORDER BY ps.session_type, ps.block_number`, [req.params.id]);
  });

  /** Saves one block's paper scores; all three empty (and no note) clears the block. Logged with old and new values. */
  app.put<{ Params: { id: string } }>('/participants/:id/paper-scores', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(err(404, 'NOT_FOUND', 'error.404').body);
    const body = PaperScore.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    const s = body.data;
    const p = await one<{ id: string; study_code: string; cohort: string; is_active: boolean }>(app.deps.db,
      'SELECT id, study_code, cohort, is_active FROM participants WHERE id = $1', [req.params.id]);
    if (!p) return reply.status(404).send(err(404, 'NOT_FOUND', 'error.404').body);
    if (p.cohort !== 'PAPER') return reply.status(400).send(err(400, 'NOT_PAPER', 'paper.not_paper').body);
    if (!p.is_active) return reply.status(400).send(err(400, 'INACTIVE', 'paper.inactive').body);
    const user = req.user as UserClaims;
    const empty = s.pen_lifts == null && s.accurate_letters == null && s.total_time_ms == null && !s.notes;
    const { before, after } = await inTransaction(app.deps.db, async (q) => {
      const before = await one<Record<string, unknown>>(q, `
        SELECT pen_lifts, accurate_letters, total_time_ms, notes FROM paper_block_scores
         WHERE participant_id = $1 AND session_type = $2 AND block_number = $3 FOR UPDATE`, [p.id, s.session_type, s.block_number]);
      if (empty) {
        await q.query('DELETE FROM paper_block_scores WHERE participant_id = $1 AND session_type = $2 AND block_number = $3', [p.id, s.session_type, s.block_number]);
        return { before, after: null };
      }
      await q.query(`
        INSERT INTO paper_block_scores (participant_id, session_type, block_number, pen_lifts, accurate_letters, total_time_ms, notes, entered_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (participant_id, session_type, block_number) DO UPDATE SET
          pen_lifts = EXCLUDED.pen_lifts, accurate_letters = EXCLUDED.accurate_letters, total_time_ms = EXCLUDED.total_time_ms,
          notes = EXCLUDED.notes, updated_by = $8, updated_at = now()`,
        [p.id, s.session_type, s.block_number, s.pen_lifts, s.accurate_letters, s.total_time_ms, s.notes, user.sub]);
      return { before, after: { pen_lifts: s.pen_lifts, accurate_letters: s.accurate_letters, total_time_ms: s.total_time_ms, notes: s.notes } };
    });
    app.appLog.write({
      severity: 'INFO', event_type: 'data.paper_scores.entered', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'participant', entity_id: p.id,
      message: `Paper scores ${after ? (before ? 'changed' : 'entered') : 'cleared'}: ${p.study_code} ${s.session_type} block ${s.block_number}`,
      details: { study_code: p.study_code, session_type: s.session_type, block_number: s.block_number, old: before, new: after },
    });
    return { saved: !!after };
  });
};
