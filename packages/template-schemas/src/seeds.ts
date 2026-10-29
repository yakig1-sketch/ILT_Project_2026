// Seed canvases (DDD §10). ILT geometry: Documents/05_Measures/ILT_Day1_Grid_Geometry.json (v3, 35 x 25 mm).
import type { Box, CanvasGeometry, ScoringProfile } from './canvas.js';
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

export interface SeedCanvas {
  language: 'he' | 'en';
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
];
