// Intervention sheet scores (Phase 5d, FRS FR-SCORE-12/14/16, DDD §8.7): accuracy = correct marks ÷
// marks × 100; the pen-lift and speed scores use the letter canvas's own profile (expected lifts,
// Normal speed); width is not scored. The sheet is scored once no mark is open, and scored again
// whenever a mark changes (the marks' change log is the audit trail): its score version 1 is
// replaced. While a mark is open the sheet has no score version.
import { compositeScore, scoreBlock, sheetAccuracy, type BlockScore } from '@ilt/ilt-metrics';
import type { CanvasGeometry, ScoringProfile } from '@ilt/template-schemas';
import type { Queryable } from './app-log.js';
import { inTransaction, one, rows } from './db.js';
import { insertScoreVersion, scoringSettingsFrom, storeMeasures, summaryOf, type BlockSummary } from './scoring-store.js';
import type { SettingsSnapshot } from './settings-store.js';
import { loadSamples } from './telemetry-store.js';

export const SHEET_SCORE_REASON = 'Intervention sheet: accuracy from the marks';

export interface SheetScore {
  /** 1 once every mark is set, else null (no score yet). */
  score_version: number | null;
  /** Marks still to set. */
  open_marks: number;
  summary: BlockSummary;
}

/** The block result with accuracy from the marks: a letter is accurate when its final mark is correct. */
export function withMarks(r: BlockScore, finals: Map<number, boolean | null>, settings: ReturnType<typeof scoringSettingsFrom>): BlockScore {
  const letters = r.letters.map((l) => {
    const ok = finals.get(l.box_id) === false;
    return { ...l, is_accurate: ok, accuracy_score: ok ? 100 : 0 };
  });
  const accuracy = sheetAccuracy([...finals.values()]);
  const composite = compositeScore(r.speed_score, accuracy, r.pen_lift_score, settings);
  return {
    ...r,
    letters,
    accuracy_score: accuracy ?? 0,
    accurate_letters: letters.filter((l) => l.is_accurate).length,
    composite_score: composite,
    pass: composite === null || settings.pass_threshold === null ? null : composite >= settings.pass_threshold,
  };
}

/** Measures a stored sheet attempt and, when no mark is open, (re)writes its score version 1. */
export async function scoreSheet(
  db: Queryable,
  attemptId: string,
  canvas: CanvasGeometry,
  profile: ScoringProfile,
  snapshot: SettingsSnapshot,
  userId: string | null,
): Promise<SheetScore> {
  const settings = scoringSettingsFrom(snapshot);
  const r = scoreBlock(await loadSamples(db, attemptId), canvas, profile, settings);
  const marks = await rows<{ box_id: number; final_error: boolean | null }>(db,
    'SELECT box_id, final_error FROM intervention_marks WHERE block_attempt_id = $1', [attemptId]);
  const finals = new Map(marks.map((m) => [m.box_id, m.final_error]));
  const open = marks.length === 0 ? r.letters_expected : marks.filter((m) => m.final_error === null).length;
  const scored = withMarks(r, finals, settings);
  const version = await inTransaction(db, async (q) => {
    await storeMeasures(q, attemptId, r);
    await q.query('DELETE FROM score_versions WHERE block_attempt_id = $1', [attemptId]);
    if (open > 0) return null;
    return insertScoreVersion(q, attemptId, 1, scored, settings, profile, SHEET_SCORE_REASON, userId);
  });
  const summary = summaryOf(scored);
  // Until every mark is set, accuracy and the composite are not known.
  return {
    score_version: version,
    open_marks: open,
    summary: version === null ? { ...summary, accuracy_score: null, accurate_letters: null, composite_score: null, pass: null } : summary,
  };
}

/** Scores a sheet attempt again after its marks changed (marks route). Not a sheet with a profile: null. */
export async function rescoreSheet(db: Queryable, attemptId: string, userId: string): Promise<SheetScore | null> {
  const a = await one<{ geometry: CanvasGeometry | null; profile: ScoringProfile | null; snapshot: SettingsSnapshot; step_type: string }>(db,
    `SELECT c.geometry, st.canvas_profile_snapshot AS profile, s.settings_snapshot AS snapshot, st.step_type
       FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id JOIN sessions s ON s.id = st.session_id
       LEFT JOIN canvases c ON c.id = st.canvas_id
      WHERE ba.id = $1`, [attemptId]);
  if (!a || a.step_type !== 'INTERVENTION_SHEET' || !a.geometry || !a.profile) return null;
  return scoreSheet(db, attemptId, a.geometry, a.profile, a.snapshot, userId);
}

/** A sheet's score as the cockpit shows it with the marks: the current version, or why there is none yet. */
export async function loadSheetScore(db: Queryable, attemptId: string) {
  const sv = await one<{ score_version: number | null; accuracy_score: string | null; accurate_letters: number | null; speed_score: string | null;
    pen_lift_score: string | null; composite_score: string | null; pass: boolean | null; avg_speed_mm_s: string | null; pen_lifts: number | null;
    total_time_ms: number | null; open_marks: number }>(db,
    `SELECT sv.version AS score_version, sv.accuracy_score, sv.accurate_letters, sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass,
            sv.avg_speed_mm_s, ba.pen_lifts, ba.total_time_ms,
            (SELECT count(*)::int FROM intervention_marks im WHERE im.block_attempt_id = ba.id AND im.final_error IS NULL) AS open_marks
       FROM block_attempts ba LEFT JOIN score_versions sv ON sv.block_attempt_id = ba.id AND sv.is_current
      WHERE ba.id = $1`, [attemptId]);
  if (!sv) return null;
  const n = (v: string | null) => (v === null ? null : Number(v));
  return {
    score_version: sv.score_version, open_marks: sv.open_marks, pen_lifts: sv.pen_lifts, total_time_ms: sv.total_time_ms,
    accuracy_score: n(sv.accuracy_score), accurate_letters: sv.accurate_letters, avg_speed_mm_s: n(sv.avg_speed_mm_s),
    speed_score: n(sv.speed_score), pen_lift_score: n(sv.pen_lift_score), composite_score: n(sv.composite_score), pass: sv.pass,
  };
}
