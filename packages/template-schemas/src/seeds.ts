// Seed canvases (DDD §10). ILT geometry: Documents/05_Measures/ILT_Day1_Grid_Geometry.json (v3, 35 x 25 mm).
import type { Box, CanvasGeometry, Line, ScoringProfile } from './canvas.js';
import { fillOrderFor } from './canvas.js';

const ROWS = 3;
const COLS = 5;
const BOX_W = 35.0;
const BOX_H = 25.0;
const ROW_PITCH = 35.0; // box height 25 + row gap 10

export const ILT_GRID_BOXES: Box[] = Array.from({ length: ROWS * COLS }, (_, id) => {
  const row = Math.floor(id / COLS);
  const col = id % COLS;
  return { id, row, col, x: col * BOX_W, y: row * ROW_PITCH, w: BOX_W, h: BOX_H };
});

export const ILT_GRID_GEOMETRY: CanvasGeometry = {
  schema_version: 1,
  canvas_type: 'ILT_GRID',
  units: 'mm',
  size: { width: 175.0, height: 95.0 },
  boxes: ILT_GRID_BOXES,
  box_frame: { style: 'SOLID', weight_mm: 0.3, color: '#000000' },
  dots: [
    { id: 'A', x: 14.5, y: 2.6, diameter_mm: 2.6, role: 'START' },
    { id: 'B', x: 20.0, y: 12.6, diameter_mm: 2.6, role: 'TARGET' },
    { id: 'C', x: 14.5, y: 22.7, diameter_mm: 2.6, role: 'END' },
  ],
  lines: [],
  letters: [],
  background: null,
};

const iltProfile = (fill: number[]): ScoringProfile => ({
  dot_order: ['A', 'B', 'C'],
  dots: {
    A: { radius_mm: 3.5, weight_pct: 5, required: false },
    B: { radius_mm: 1.3, weight_pct: 90, required: true },
    C: { radius_mm: 3.5, weight_pct: 5, required: false },
  },
  expected_pen_lifts_per_block: 15,
  fill_order: fill,
  normal_speed_mm_s: null,
  speed_flex_pct: 10,
});

export const ILT_PROFILE_HE = iltProfile(fillOrderFor(ILT_GRID_BOXES, 'RTL_ROWS'));
export const ILT_PROFILE_EN = iltProfile(fillOrderFor(ILT_GRID_BOXES, 'LTR_ROWS'));

/**
 * Notebook page: 3 writing rows x 5 letter cells, timed only (FRS FR-PLAN-5).
 * PROVISIONAL ruling: the cells match the ILT grid so letters are segmented the same way; the
 * blue guide lines (top, mid, base per row) must be checked against the school notebook samples.
 */
export const NOTEBOOK_GEOMETRY: CanvasGeometry = {
  schema_version: 1,
  canvas_type: 'NOTEBOOK',
  units: 'mm',
  size: { width: 175.0, height: 95.0 },
  boxes: ILT_GRID_BOXES,
  box_frame: { style: 'DOTTED', weight_mm: 0.1, color: '#e0e0e0' },
  dots: [],
  lines: Array.from({ length: ROWS }, (_, r) => {
    const top = r * ROW_PITCH;
    return [
      { y: top + 2.5, x1: 0, x2: 175, style: 'SOLID' as const, weight_mm: 0.3, color: '#1565c0', role: 'TOP' as const },
      { y: top + 12.5, x1: 0, x2: 175, style: 'DASHED' as const, weight_mm: 0.2, color: '#90caf9', role: 'MID' as const },
      { y: top + 22.5, x1: 0, x2: 175, style: 'SOLID' as const, weight_mm: 0.3, color: '#1565c0', role: 'BASE' as const },
    ];
  }).flat(),
  letters: [],
  background: null,
};

/*
 * Japanese (Phase 6b″; owner request 2026-11-18, "ILT Japanese Canvas Proposal"). Vertical writing (tategaki):
 * a box's `row` is its column (writing line), numbered from the right, and its `col` its place down the column,
 * so forward-only locking, the end of the page and the notebook's lock per line work column by column.
 * Both canvases are seeded as Drafts and are not used by any session until the research team approves them.
 */
const JA_BOX = 24.0;
const JA_CELL_PITCH = 28.0; // box 24 + gap 4 down a column
const JA_COLUMN_PITCH = 36.0; // box 24 + gap 12 between columns
const JA_COLUMNS = 3;
const JA_CELLS = 5;
const JA_WIDTH = (JA_COLUMNS - 1) * JA_COLUMN_PITCH + JA_BOX; // 96 mm
const JA_HEIGHT = (JA_CELLS - 1) * JA_CELL_PITCH + JA_BOX; // 136 mm

export const ILT_TATEGAKI_BOXES: Box[] = Array.from({ length: JA_COLUMNS * JA_CELLS }, (_, id) => {
  const row = Math.floor(id / JA_CELLS);
  const col = id % JA_CELLS;
  return { id, row, col, x: JA_WIDTH - JA_BOX - row * JA_COLUMN_PITCH, y: col * JA_CELL_PITCH, w: JA_BOX, h: JA_BOX };
});

/**
 * PORTRAIT (owner decision 2026-11-18): at the proposal's 24 mm boxes the page is 96 x 136 mm, taller than the
 * DTH-A116 screen in landscape (211 x 132 mm), so Japanese sessions hold the tablet upright (132 x 211 mm).
 *
 * PLACEHOLDER GLYPH: the Hebrew ILT chevron (A, B, C) at its own size, centred in the 24 mm square box. The
 * proposal's "non-kana" glyph (top-right, centre-left, bottom-right) draws く, so the research team designs the
 * Japanese glyph; only the dots below change when it is approved.
 */
export const ILT_TATEGAKI_GEOMETRY: CanvasGeometry = {
  schema_version: 1,
  canvas_type: 'ILT_GRID',
  units: 'mm',
  size: { width: JA_WIDTH, height: JA_HEIGHT },
  orientation: 'PORTRAIT',
  boxes: ILT_TATEGAKI_BOXES,
  box_frame: { style: 'SOLID', weight_mm: 0.3, color: '#000000' },
  dots: [
    { id: 'A', x: 9.25, y: 2.5, diameter_mm: 2.6, role: 'START' },
    { id: 'B', x: 14.75, y: 12.1, diameter_mm: 2.6, role: 'TARGET' },
    { id: 'C', x: 9.25, y: 21.8, diameter_mm: 2.6, role: 'END' },
  ],
  lines: [],
  letters: [],
  background: null,
};
/** The Hebrew dot rules (B the 1.3 mm target with 90 % of the weight), in the tategaki fill order. */
export const ILT_PROFILE_JA = iltProfile(fillOrderFor(ILT_TATEGAKI_BOXES, 'TTB_RTL_COLUMNS'));

/**
 * Kokugo notebook page, upright like the tategaki ILT page so a Japanese session never turns the tablet between
 * steps: 5 columns of 8 squares (masu, 18 mm) with dashed cross-guides and a 4.5 mm furigana strip to the right of
 * each column. The proposal's page had 8 columns, which is 180 mm and does not fit the upright screen (132 mm).
 * The child writes in the 3 right-hand columns, the top 5 squares each (15, as on the Hebrew notebook page).
 * Timed only. The page's "こくご" heading is not drawn: canvases carry no text.
 */
const KOKUGO_MASU = 18.0;
const KOKUGO_FURIGANA = 4.5;
const KOKUGO_COLUMN_PITCH = KOKUGO_MASU + KOKUGO_FURIGANA; // 22.5 mm
const KOKUGO_PAGE_COLUMNS = 5;
const KOKUGO_PAGE_SQUARES = 8;
const KOKUGO_ACTIVE_COLUMNS = 3;
const KOKUGO_CELLS = 5;
const KOKUGO_WIDTH = KOKUGO_PAGE_COLUMNS * KOKUGO_COLUMN_PITCH; // 112.5 mm
const KOKUGO_HEIGHT = KOKUGO_PAGE_SQUARES * KOKUGO_MASU; // 144 mm
/** Left edge of page column k (0 = the right-hand column); its furigana strip lies to the right of the squares. */
const kokugoLeft = (k: number) => KOKUGO_WIDTH - k * KOKUGO_COLUMN_PITCH - KOKUGO_FURIGANA - KOKUGO_MASU;
const ruling = { style: 'SOLID' as const, weight_mm: 0.3, color: '#1565c0' };
const guide = { style: 'DASHED' as const, weight_mm: 0.15, color: '#90caf9', role: 'GUIDE' as const };

export const NOTEBOOK_KOKUGO_GEOMETRY: CanvasGeometry = {
  schema_version: 1,
  canvas_type: 'NOTEBOOK',
  units: 'mm',
  size: { width: KOKUGO_WIDTH, height: KOKUGO_HEIGHT },
  orientation: 'PORTRAIT',
  boxes: Array.from({ length: KOKUGO_ACTIVE_COLUMNS * KOKUGO_CELLS }, (_, id) => {
    const row = Math.floor(id / KOKUGO_CELLS);
    const col = id % KOKUGO_CELLS;
    return { id, row, col, x: kokugoLeft(row), y: col * KOKUGO_MASU, w: KOKUGO_MASU, h: KOKUGO_MASU };
  }),
  box_frame: { style: 'DOTTED', weight_mm: 0.1, color: '#e0e0e0' },
  dots: [],
  lines: Array.from({ length: KOKUGO_PAGE_COLUMNS }, (_, k): Line[] => {
    const x0 = kokugoLeft(k);
    const x1 = x0 + KOKUGO_MASU;
    return [
      { x: x0, y1: 0, y2: KOKUGO_HEIGHT, ...ruling },
      { x: x1, y1: 0, y2: KOKUGO_HEIGHT, ...ruling },
      { x: x0 + KOKUGO_MASU / 2, y1: 0, y2: KOKUGO_HEIGHT, ...guide },
      ...Array.from({ length: KOKUGO_PAGE_SQUARES + 1 }, (_, j): Line => ({ y: j * KOKUGO_MASU, x1: x0, x2: x1, ...ruling })),
      ...Array.from({ length: KOKUGO_PAGE_SQUARES }, (_, j): Line => ({ y: j * KOKUGO_MASU + KOKUGO_MASU / 2, x1: x0, x2: x1, ...guide })),
    ];
  }).flat(),
  letters: [],
  background: null,
};

export interface SeedCanvas {
  language: 'he' | 'en' | 'ja';
  /** Loaded as ACTIVE unless set; DRAFT canvases wait for approval in the canvas library. */
  status?: 'ACTIVE' | 'DRAFT';
  set_type: 'ILT' | 'NOTEBOOK';
  set_name_he: string;
  set_name_en: string;
  code: string;
  name_he: string;
  name_en: string;
  geometry: CanvasGeometry;
  profile: ScoringProfile | null;
}

export const SEED_CANVASES: SeedCanvas[] = [
  {
    language: 'he', set_type: 'ILT', set_name_he: 'ILT בסיסי', set_name_en: 'Standard ILT',
    code: 'ILT_3X5_HE', name_he: 'רשת ILT ‏3×5 (35×25 מ"מ)', name_en: 'ILT 3x5 grid (35x25 mm)',
    geometry: ILT_GRID_GEOMETRY, profile: ILT_PROFILE_HE,
  },
  {
    language: 'en', set_type: 'ILT', set_name_he: 'ILT בסיסי', set_name_en: 'Standard ILT',
    code: 'ILT_3X5_EN', name_he: 'רשת ILT ‏3×5 (35×25 מ"מ)', name_en: 'ILT 3x5 grid (35x25 mm)',
    geometry: ILT_GRID_GEOMETRY, profile: ILT_PROFILE_EN,
  },
  {
    language: 'he', set_type: 'NOTEBOOK', set_name_he: 'מחברת', set_name_en: 'Notebook',
    code: 'NOTEBOOK_HE', name_he: 'דף מחברת 3×5', name_en: 'Notebook page 3x5',
    geometry: NOTEBOOK_GEOMETRY, profile: null,
  },
  {
    language: 'en', set_type: 'NOTEBOOK', set_name_he: 'מחברת', set_name_en: 'Notebook',
    code: 'NOTEBOOK_EN', name_he: 'דף מחברת 3×5', name_en: 'Notebook page 3x5',
    geometry: NOTEBOOK_GEOMETRY, profile: null,
  },
  {
    language: 'ja', status: 'DRAFT', set_type: 'ILT', set_name_he: 'ILT יפנית (כתיבה אנכית)', set_name_en: 'Japanese ILT (tategaki)',
    code: 'ILT_TATEGAKI_JA', name_he: 'ILT אנכי לאורך, 3 טורים × 5 (24×24 מ"מ), גליף זמני', name_en: 'Tategaki ILT (portrait), 3 columns x 5 (24x24 mm), placeholder glyph',
    geometry: ILT_TATEGAKI_GEOMETRY, profile: ILT_PROFILE_JA,
  },
  {
    language: 'ja', status: 'DRAFT', set_type: 'NOTEBOOK', set_name_he: 'מחברת קוקוגו', set_name_en: 'Kokugo notebook',
    code: 'NOTEBOOK_KOKUGO_JA', name_he: 'דף קוקוגו לאורך, משבצות 18 מ"מ, 3 טורים × 5', name_en: 'Kokugo page (portrait), 18 mm masu, 3 columns x 5',
    geometry: NOTEBOOK_KOKUGO_GEOMETRY, profile: null,
  },
];
