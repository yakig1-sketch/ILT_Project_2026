// Enumerations shared by the database, API and apps. Values match the CHECK constraints in
// infra/db/migrations (DDD §9).

export const ROLES = ['ADMIN', 'RESEARCHER', 'EVALUATOR', 'ANALYST'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Session languages: the language a child is tested in, of its canvases and of the tablet's texts.
 * Japanese (Phase 6b″) is off until an administrator adds it to the `language.enabled` setting.
 */
export const LANGUAGES = ['he', 'en', 'ja'] as const;
export type LanguageCode = (typeof LANGUAGES)[number];
/** Interface direction of the texts. A Japanese canvas is written in vertical columns (tategaki) whatever this says. */
export const LANGUAGE_DIRECTION: Record<LanguageCode, 'rtl' | 'ltr'> = { he: 'rtl', en: 'ltr', ja: 'ltr' };
/** Languages of the staff screens (cockpit, administration, analyst portal). */
export const STAFF_LANGUAGES = ['he', 'en'] as const;
export type StaffLanguage = (typeof STAFF_LANGUAGES)[number];

export const SESSION_PURPOSES = ['INTERVENTION', 'RESEARCH'] as const;
export type SessionPurpose = (typeof SESSION_PURPOSES)[number];

export const SESSION_TYPES = ['DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION', 'CUSTOM'] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const SESSION_STATUSES = ['PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABORTED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const STEP_TYPES = [
  'VIDEO',
  'WARMUP_BLOCK',
  'ILT_BLOCK',
  'NOTEBOOK_PAGE',
  'PAPER_NOTEBOOK_PAGE',
  'INTERVENTION_SHEET',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const CANVAS_TYPES = ['ILT_GRID', 'NOTEBOOK', 'INTERVENTION_SHEET'] as const;
export type CanvasType = (typeof CANVAS_TYPES)[number];

export const CANVAS_SET_TYPES = ['ILT', 'NOTEBOOK', 'INTERVENTION_LETTERS'] as const;
export type CanvasSetType = (typeof CANVAS_SET_TYPES)[number];

export const ROW_TYPES = ['TRACE_MODEL', 'START_DOT', 'FREEHAND'] as const;
export type RowType = (typeof ROW_TYPES)[number];

export const SETTING_OVERRIDE_SCOPES = ['NONE', 'DOMAIN', 'REGION'] as const;
export type SettingOverrideScope = (typeof SETTING_OVERRIDE_SCOPES)[number];
