// Protocol templates: ordered session steps (FRS §6, DDD §10).
import { z } from 'zod';
import { SESSION_TYPES, STEP_TYPES } from '@ilt/shared-types';

export const ProtocolStepSchema = z.object({
  step_type: z.enum(STEP_TYPES),
  /** Resolved through the session language's settings: language.L.ilt_canvas, notebook_canvas, letter_set. */
  canvas_role: z.enum(['ILT', 'NOTEBOOK', 'LETTER']).optional(),
  video_key: z.string().optional(),
  label_key: z.string(),
  block_number: z.number().int().positive().optional(),
  is_scored: z.boolean().default(false),
});
export type ProtocolStep = z.infer<typeof ProtocolStepSchema>;

export const ProtocolTemplateSchema = z.object({
  code: z.string(),
  session_type: z.enum(SESSION_TYPES),
  name_he: z.string(),
  name_en: z.string(),
  steps: z.array(ProtocolStepSchema).min(1),
});
export type ProtocolTemplate = z.infer<typeof ProtocolTemplateSchema>;

const ilt = (n: number): ProtocolStep => ({
  step_type: 'ILT_BLOCK',
  canvas_role: 'ILT',
  label_key: 'step.ilt_block',
  block_number: n,
  is_scored: true,
});
const notebook = (n: number): ProtocolStep => ({
  step_type: 'NOTEBOOK_PAGE',
  canvas_role: 'NOTEBOOK',
  label_key: 'step.notebook_page',
  block_number: n,
  is_scored: false,
});
const paper = (n: number): ProtocolStep => ({
  step_type: 'PAPER_NOTEBOOK_PAGE',
  label_key: 'step.paper_notebook_page',
  block_number: n,
  is_scored: false,
});

export const DEFAULT_PROTOCOLS: ProtocolTemplate[] = [
  {
    code: 'DAY_1',
    session_type: 'DAY_1',
    name_he: 'יום 1',
    name_en: 'Day 1',
    steps: [
      { step_type: 'VIDEO', video_key: 'intro', label_key: 'step.video_intro', is_scored: false },
      { step_type: 'WARMUP_BLOCK', canvas_role: 'ILT', label_key: 'step.warmup', is_scored: false },
      ilt(1), ilt(2), ilt(3), ilt(4),
      { step_type: 'VIDEO', video_key: 'notebook_demo', label_key: 'step.video_notebook', is_scored: false },
      notebook(1), notebook(2), notebook(3), notebook(4),
      ilt(5), ilt(6), ilt(7), ilt(8),
    ],
  },
  {
    code: 'DAY_2',
    session_type: 'DAY_2',
    name_he: 'יום 2',
    name_en: 'Day 2',
    steps: [ilt(1), ilt(2), ilt(3), ilt(4), paper(1), paper(2)],
  },
  {
    code: 'DAY_14',
    session_type: 'DAY_14',
    name_he: 'יום 14',
    name_en: 'Day 14',
    steps: [ilt(1), ilt(2)],
  },
  {
    code: 'INTERVENTION',
    session_type: 'INTERVENTION',
    name_he: 'תוכנית התערבות',
    name_en: 'Intervention',
    steps: [
      { step_type: 'INTERVENTION_SHEET', canvas_role: 'LETTER', label_key: 'step.intervention_sheet', is_scored: true },
    ],
  },
];
