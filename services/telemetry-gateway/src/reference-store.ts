// Reference mode (FR-CAN-6/9/10/11, DDD §7.3): what a reference run needs about its canvas, and the
// values derived from a finished recording. Shared by the hub (recording) and the routes (Accept).
import { gzipSync } from 'node:zlib';
import { encodeSampleRecords } from '@ilt/emr-protocol';
import { deriveNormalSpeed, deriveSampleFill } from '@ilt/ilt-metrics';
import { LANGUAGE_DIRECTION, type LanguageCode, type PenSample } from '@ilt/shared-types';
import {
  fillOrderFor, isScoredCanvas, mergeProfile,
  type CanvasGeometry, type FillDirection, type ScoringProfile,
} from '@ilt/template-schemas';
import type { Queryable } from './app-log.js';
import { one } from './db.js';
import { NO_GROUP } from './director.js';
import { scoringSettingsFrom } from './scoring-store.js';
import { loadEffectiveSettings, setting } from './settings-store.js';

export type ReferenceKind = 'PREVIEW' | 'SAMPLE_BLOCK_FILL' | 'NORMAL_SPEED';
export type RecordingKind = Exclude<ReferenceKind, 'PREVIEW'>;

export interface ReferenceCanvas {
  id: string;
  code: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  geometry: CanvasGeometry;
  language_code: string;
  /** The profile the recording is for: the canvas's own, or merged with the Domain's override. */
  profile: ScoringProfile | null;
  /** The order the boxes are filled in: the profile's recorded order, else the language direction's. */
  fill_order: number[];
  /** The order the language's fill direction gives (FR-CAN-14 compares a recorded order with it). */
  direction_order: number[];
  domain_id: number | null;
  domain_code: string | null;
}

/**
 * Loads a canvas for a reference run. Recording into the canvas's own profile needs a Draft (an
 * Active canvas is never edited: a change is a new version, FR-CAN-3); a Domain's profile can be
 * recorded for a Draft or Active canvas. A preview shows any canvas that is not retired.
 */
export async function loadReferenceCanvas(
  db: Queryable, canvasId: string, kind: ReferenceKind, domainId: number | null,
): Promise<ReferenceCanvas | { code: string; message: string }> {
  const c = await one<{ id: string; code: string; version: number; status: ReferenceCanvas['status']; geometry: CanvasGeometry;
    default_scoring_profile: ScoringProfile | null; language_code: string }>(db,
    `SELECT c.id, c.code, c.version, c.status, c.geometry, c.default_scoring_profile, s.language_code
       FROM canvases c JOIN canvas_sets s ON s.id = c.canvas_set_id WHERE c.id = $1`, [canvasId]);
  if (!c) return { code: 'NOT_FOUND', message: 'No such canvas' };
  if (c.status === 'RETIRED') return { code: 'RETIRED', message: 'This canvas is retired' };
  let domainCode: string | null = null;
  let patch: unknown = null;
  if (domainId !== null) {
    const d = await one<{ code: string }>(db, 'SELECT code FROM domains WHERE id = $1', [domainId]);
    if (!d) return { code: 'NOT_FOUND', message: 'No such Domain' };
    domainCode = d.code;
    patch = (await one<{ profile_patch: unknown }>(db, 'SELECT profile_patch FROM canvas_scoring_overrides WHERE canvas_id = $1 AND domain_id = $2', [c.id, domainId]))?.profile_patch ?? null;
  }
  if (kind !== 'PREVIEW') {
    if (!isScoredCanvas(c.geometry) || !c.default_scoring_profile) return { code: 'NOT_SCORED', message: 'Only scored canvases take reference recordings' };
    if (domainId === null && c.status !== 'DRAFT') return { code: 'NOT_DRAFT', message: 'The canvas profile changes only in a Draft: create a new version, or record for a Domain' };
  }
  const profile = c.default_scoring_profile && (patch ? mergeProfile(c.default_scoring_profile, patch) : c.default_scoring_profile);
  const settings = await loadEffectiveSettings(db, domainId ?? NO_GROUP, null);
  const lang = c.language_code as LanguageCode;
  const direction = setting<FillDirection>(settings, `language.${lang}.fill_direction`, LANGUAGE_DIRECTION[lang] === 'rtl' ? 'RTL_ROWS' : 'LTR_ROWS');
  const directionOrder = fillOrderFor(c.geometry.boxes, direction);
  return {
    id: c.id, code: c.code, version: c.version, status: c.status, geometry: c.geometry, language_code: c.language_code,
    profile, fill_order: profile?.fill_order.length ? profile.fill_order : directionOrder, direction_order: directionOrder,
    domain_id: domainId, domain_code: domainCode,
  };
}

/** The values a recording gives its profile, with what the administrator needs to judge it. */
export async function deriveRecording(
  db: Queryable, run: { kind: RecordingKind; canvas: ReferenceCanvas; rows: number }, samples: readonly PenSample[],
): Promise<Record<string, unknown>> {
  const settings = scoringSettingsFrom(await loadEffectiveSettings(db, run.canvas.domain_id ?? NO_GROUP, null));
  if (run.kind === 'SAMPLE_BLOCK_FILL') {
    const r = deriveSampleFill(samples, run.canvas.geometry, settings);
    return {
      ...r,
      direction_order: run.canvas.direction_order,
      // FR-CAN-14: the setup screen warns when the recorded order and the language direction disagree.
      direction_matches: r.complete && r.fill_order.every((id, i) => id === run.canvas.direction_order[i]),
      previous: { fill_order: run.canvas.profile?.fill_order ?? [], expected_pen_lifts_per_block: run.canvas.profile?.expected_pen_lifts_per_block ?? null },
    };
  }
  const r = deriveNormalSpeed(samples, run.canvas.geometry, run.canvas.profile!, run.canvas.fill_order, run.rows, settings);
  return { ...r, previous: { normal_speed_mm_s: run.canvas.profile?.normal_speed_mm_s ?? null } };
}

/** The profile values a recording sets on Accept, or null when it cannot be accepted. */
export function profileValues(kind: RecordingKind, derived: Record<string, unknown>): Partial<ScoringProfile> | null {
  if (!derived.complete) return null;
  if (kind === 'SAMPLE_BLOCK_FILL') {
    return { fill_order: derived.fill_order as number[], expected_pen_lifts_per_block: Math.max(1, Number(derived.pen_lifts)) };
  }
  return typeof derived.normal_speed_mm_s === 'number' ? { normal_speed_mm_s: derived.normal_speed_mm_s } : null;
}

/** Raw pen data as stored (FR-CAN-11): gzip of the §5.2 sample records. */
export const packSamples = (samples: readonly PenSample[]): Buffer => gzipSync(encodeSampleRecords(samples));
