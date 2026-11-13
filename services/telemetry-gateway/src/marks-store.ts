// Intervention marks (Phase 5c, FRS FR-COCK-5/6, DDD §8.7): the system's suggestion per letter is
// stored when a sheet is stored; the evaluator then confirms or changes it. final_error is the
// evaluator's value when set, else the system's.
import { suggestSheetMarks, type SheetMark } from '@ilt/ilt-metrics';
import type { CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import type { Queryable } from './app-log.js';
import { inTransaction, rows } from './db.js';
import { scoringSettingsFrom } from './scoring-store.js';
import { setting, type SettingsSnapshot } from './settings-store.js';
import { loadSamples } from './telemetry-store.js';

export interface StoredMark {
  box_id: number;
  row_type: 'TRACE_MODEL' | 'START_DOT' | 'FREEHAND';
  letter: string;
  auto_error: boolean | null;
  start_point_ok: boolean | null;
  evaluator_error: boolean | null;
  final_error: boolean | null;
  decided_by: 'SYSTEM' | 'EVALUATOR' | null;
  decided_by_name: string | null;
  decided_at: string | null;
  similarity_hint: number | null;
  /** Row 1: pen lifts inside the letter and how many it may have (null for rows 2 and 3). */
  internal_pen_lifts: number | null;
  lifts_allowed: number | null;
}

/** Suggests the marks of a stored sheet attempt and stores them (once per attempt). */
export async function storeSuggestedMarks(
  db: Queryable,
  attemptId: string,
  canvas: CanvasGeometry,
  profile: ScoringProfile,
  snapshot: SettingsSnapshot,
): Promise<SheetMark[]> {
  const samples = await loadSamples(db, attemptId);
  const marks = suggestSheetMarks(samples, canvas, profile, scoringSettingsFrom(snapshot), {
    similarity: setting(snapshot, 'scoring.similarity_hint.enabled', true),
  });
  await inTransaction(db, async (q) => {
    for (const m of marks) {
      await q.query(
        `INSERT INTO intervention_marks (block_attempt_id, box_id, row_type, letter, auto_error, start_point_ok, final_error,
           decided_by, decided_at, similarity_hint, internal_pen_lifts, lifts_allowed)
         VALUES ($1, $2, $3, $4, $5, $6, $5, CASE WHEN $5::boolean IS NULL THEN NULL ELSE 'SYSTEM' END,
                 CASE WHEN $5::boolean IS NULL THEN NULL ELSE now() END, $7, $8, $9)
         ON CONFLICT (block_attempt_id, box_id) DO NOTHING`,
        [attemptId, m.box_id, m.row_type, m.letter, m.auto_error, m.start_point_ok, m.similarity_hint,
          m.row_type === 'TRACE_MODEL' && m.status === 'WRITTEN' ? m.internal_pen_lifts : null, m.row_type === 'TRACE_MODEL' ? m.lifts_allowed : null],
      );
    }
  });
  return marks;
}

/** An attempt's marks in the given box order (the step's fill order). */
export async function loadMarks(db: Queryable, attemptId: string, fillOrder: readonly number[]): Promise<StoredMark[]> {
  const list = await rows<StoredMark & { similarity_hint: string | number | null }>(
    db,
    `SELECT im.box_id, im.row_type, im.letter, im.auto_error, im.start_point_ok, im.evaluator_error, im.final_error, im.decided_by,
            u.full_name AS decided_by_name, im.decided_at, im.similarity_hint, im.internal_pen_lifts, im.lifts_allowed
       FROM intervention_marks im LEFT JOIN users u ON u.id = im.decided_by_user
      WHERE im.block_attempt_id = $1`,
    [attemptId],
  );
  const pos = new Map(fillOrder.map((id, i) => [id, i]));
  return list
    .map((m) => ({ ...m, similarity_hint: m.similarity_hint === null ? null : Number(m.similarity_hint) }))
    .sort((a, b) => (pos.get(a.box_id) ?? a.box_id) - (pos.get(b.box_id) ?? b.box_id));
}

/** "correct", "error" or "not set": a mark's value in the log. */
export const markWord = (error: boolean | null) => (error === null ? 'not set' : error ? 'error' : 'correct');
