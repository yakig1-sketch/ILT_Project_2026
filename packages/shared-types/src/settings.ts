// Settings catalogue (DDD §6.2). Seeded into setting_definitions; the gateway validates values with it.
import type { SettingOverrideScope } from './domain.js';

export type SettingCategory = 'SCORING' | 'ILT_PROCESS' | 'LANGUAGE' | 'GOVERNANCE' | 'PRIVACY' | 'DEVICE' | 'LOG';
export type SettingValueType = 'integer' | 'decimal' | 'boolean' | 'string' | 'enum' | 'json' | 'uuid';
export type SettingValue = string | number | boolean | null | SettingValue[] | { [k: string]: SettingValue };

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  value_type: SettingValueType;
  default_value: SettingValue;
  min_value?: number;
  max_value?: number;
  enum_values?: string[];
  unit?: string;
  override_scope: SettingOverrideScope;
  requires_director_approval: boolean;
  description_he: string;
  description_en: string;
}

const scoring = (d: Omit<SettingDefinition, 'category' | 'override_scope' | 'requires_director_approval'>): SettingDefinition => ({
  ...d,
  category: 'SCORING',
  override_scope: 'DOMAIN',
  requires_director_approval: true,
});
const process = (
  d: Omit<SettingDefinition, 'category' | 'override_scope' | 'requires_director_approval'>,
  approval = false,
): SettingDefinition => ({ ...d, category: 'ILT_PROCESS', override_scope: 'REGION', requires_director_approval: approval });
const language = (d: Omit<SettingDefinition, 'category' | 'override_scope' | 'requires_director_approval'>): SettingDefinition => ({
  ...d,
  category: 'LANGUAGE',
  override_scope: 'DOMAIN',
  requires_director_approval: false,
});
const system = (category: SettingCategory, d: Omit<SettingDefinition, 'category' | 'override_scope' | 'requires_director_approval'>): SettingDefinition => ({
  ...d,
  category,
  override_scope: 'NONE',
  requires_director_approval: false,
});

const languageGroup = (
  code: string,
  nameHe: string,
  nameEn: string,
  iltCanvas: string,
  notebookCanvas: string,
  fill: 'RTL_ROWS' | 'LTR_ROWS',
): SettingDefinition[] => [
  language({ key: `language.${code}.ilt_canvas`, value_type: 'string', default_value: iltCanvas, description_he: `קנבס ILT ל${nameHe}`, description_en: `ILT block canvas for ${nameEn}` }),
  language({ key: `language.${code}.notebook_canvas`, value_type: 'string', default_value: notebookCanvas, description_he: `קנבס מחברת ל${nameHe}`, description_en: `Notebook canvas for ${nameEn}` }),
  language({ key: `language.${code}.letter_set`, value_type: 'uuid', default_value: null, description_he: `סט דפי אותיות להתערבות ב${nameHe}`, description_en: `Real-letter canvas set for ${nameEn}` }),
  language({ key: `language.${code}.fill_direction`, value_type: 'enum', default_value: fill, enum_values: ['RTL_ROWS', 'LTR_ROWS'], description_he: `כיוון מילוי הבתים ב${nameHe}`, description_en: `Box fill direction for ${nameEn}` }),
  language({ key: `language.${code}.mirrored`, value_type: 'boolean', default_value: false, description_he: `היפוך תבנית הנקודות ב${nameHe}`, description_en: `Mirror the block's dot pattern for ${nameEn}` }),
];

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // Scoring (override per Domain, director approval)
  scoring({ key: 'scoring.composite.weight_speed_pct', value_type: 'decimal', default_value: 50, min_value: 0, max_value: 100, unit: '%', description_he: 'משקל ציון המהירות בציון המשוקלל', description_en: 'Weight of the speed score in the composite' }),
  scoring({ key: 'scoring.composite.weight_accuracy_pct', value_type: 'decimal', default_value: 25, min_value: 0, max_value: 100, unit: '%', description_he: 'משקל ציון הדיוק בציון המשוקלל', description_en: 'Weight of the accuracy score in the composite' }),
  scoring({ key: 'scoring.composite.weight_pen_lifts_pct', value_type: 'decimal', default_value: 25, min_value: 0, max_value: 100, unit: '%', description_he: 'משקל ציון הרמות העט בציון המשוקלל', description_en: 'Weight of the pen-lift score in the composite' }),
  scoring({ key: 'scoring.pass_threshold', value_type: 'decimal', default_value: null, min_value: 0, max_value: 100, description_he: 'סף עובר/נכשל על הציון המשוקלל', description_en: 'Pass/fail threshold on the composite score' }),
  scoring({ key: 'scoring.speed.above_range_policy', value_type: 'enum', default_value: 'CAP_100', enum_values: ['CAP_100', 'SYMMETRIC_PENALTY'], description_he: 'ציון למהירות מעל הטווח הנורמלי', description_en: 'Score for speed above the normal range' }),
  scoring({ key: 'scoring.pen_lift.min_gap_ms', value_type: 'integer', default_value: 50, min_value: 10, max_value: 500, unit: 'ms', description_he: 'זמן מינימלי בין הרמה להנחה שנחשב הרמת עט', description_en: 'Minimum pen-up to pen-down gap counted as a pen lift' }),
  scoring({ key: 'scoring.accurate.require_dot_order', value_type: 'boolean', default_value: true, description_he: 'אות מדויקת רק בסדר A ← B ← C', description_en: 'Accurate letters must follow the dot order' }),
  scoring({ key: 'scoring.accurate.require_width_band', value_type: 'boolean', default_value: false, description_he: 'אות מדויקת רק ברוחב שבטווח', description_en: 'Accurate letters must be within the width band' }),
  scoring({ key: 'scoring.accurate.require_no_internal_lift', value_type: 'boolean', default_value: false, description_he: 'אות מדויקת רק ללא הרמת עט בתוכה', description_en: 'Accurate letters must have no internal pen lift' }),
  scoring({ key: 'scoring.width.nominal_mm', value_type: 'decimal', default_value: 11.0, min_value: 1, max_value: 40, unit: 'mm', description_he: 'רוחב נומינלי של האות', description_en: 'Nominal letter width' }),
  scoring({ key: 'scoring.width.tolerance_mm', value_type: 'decimal', default_value: 2.0, min_value: 0, max_value: 20, unit: 'mm', description_he: 'סטייה מותרת ברוחב', description_en: 'Width tolerance' }),
  scoring({ key: 'scoring.similarity_hint.enabled', value_type: 'boolean', default_value: true, description_he: 'הצגת רמז דמיון בשורה 3 (לא נספר בציון)', description_en: 'Show the row-3 similarity hint (never scored)' }),

  // ILT process (override per Region; timers need director approval)
  process({ key: 'ilt.timer.in_transition_sec', value_type: 'integer', default_value: 20, min_value: 0, max_value: 120, unit: 's', description_he: 'זמן מעבר לפני בלוק', description_en: 'Transition countdown before a block' }, true),
  process({ key: 'ilt.timer.inactivity_sec', value_type: 'integer', default_value: 20, min_value: 5, max_value: 120, unit: 's', description_he: 'זמן חוסר פעילות עד רמז', description_en: 'Inactivity before the cue' }, true),
  process({ key: 'ilt.timer.inactivity_last_box_sec', value_type: 'integer', default_value: 30, min_value: 5, max_value: 120, unit: 's', description_he: 'זמן חוסר פעילות אחרי הבית האחרון', description_en: 'Inactivity after the last box' }, true),
  process({ key: 'ilt.timer.amber_grace_sec', value_type: 'integer', default_value: 10, min_value: 0, max_value: 60, unit: 's', description_he: 'זמן נוסף עד התראה כתומה', description_en: 'Further time before the amber alert' }, true),
  process({ key: 'ilt.timer.notebook_page_timeout_sec', value_type: 'integer', default_value: 60, min_value: 10, max_value: 600, unit: 's', description_he: 'זמן מקסימלי לדף מחברת', description_en: 'Notebook page time-out' }, true),
  process({ key: 'ilt.inactivity_cue', value_type: 'enum', default_value: 'VISUAL', enum_values: ['VISUAL', 'AUDIO', 'BOTH'], description_he: 'סוג הרמז לחוסר פעילות', description_en: 'Inactivity cue type' }),
  process({ key: 'ilt.forward_only_lock', value_type: 'boolean', default_value: true, description_he: 'נעילת בתים שהושלמו', description_en: 'Lock finished boxes' }),
  process({ key: 'ilt.box_entry_margin_mm', value_type: 'decimal', default_value: 2.0, min_value: 0, max_value: 10, unit: 'mm', description_he: 'שוליים לזיהוי כניסה לבית', description_en: 'Margin for detecting entry into a box' }),
  process({ key: 'ilt.warmup.enabled', value_type: 'boolean', default_value: true, description_he: 'בלוק חימום', description_en: 'Warm-up block' }),
  process({ key: 'ilt.video.recording_enabled', value_type: 'boolean', default_value: false, description_he: 'הקלטת וידאו של הידיים (בכפוף להסכמה)', description_en: 'Hand video recording (subject to consent)' }),
  process({ key: 'ilt.protocol.day1_template', value_type: 'string', default_value: 'DAY_1', description_he: 'תבנית יום 1', description_en: 'Day 1 template' }),
  process({ key: 'ilt.protocol.day2_template', value_type: 'string', default_value: 'DAY_2', description_he: 'תבנית יום 2', description_en: 'Day 2 template' }),
  process({ key: 'ilt.protocol.day14_template', value_type: 'string', default_value: 'DAY_14', description_he: 'תבנית יום 14', description_en: 'Day 14 template' }),

  // Language configuration (override per Domain)
  language({ key: 'language.enabled', value_type: 'json', default_value: ['he', 'en'], description_he: 'שפות פעילות', description_en: 'Enabled languages' }),
  language({ key: 'language.default', value_type: 'string', default_value: 'he', description_he: 'שפת ברירת מחדל', description_en: 'Default language' }),
  ...languageGroup('he', 'עברית', 'Hebrew', 'ILT_3X5_HE', 'NOTEBOOK_HE', 'RTL_ROWS'),
  ...languageGroup('en', 'אנגלית', 'English', 'ILT_3X5_EN', 'NOTEBOOK_EN', 'LTR_ROWS'),

  // System only
  system('GOVERNANCE', { key: 'governance.require_director_approval', value_type: 'boolean', default_value: true, description_he: 'שינויים קליניים דורשים קוד מנהל מחקר', description_en: 'Clinical changes need the research director PIN' }),
  system('PRIVACY', { key: 'privacy.research_purpose_enabled', value_type: 'boolean', default_value: false, description_he: 'אפשר מפגשי מחקר (אחרי אישור אתיקה)', description_en: 'Allow research sessions (after ethics approval)' }),
  system('DEVICE', { key: 'device.default_css_px_per_mm', value_type: 'decimal', default_value: 5.195, min_value: 1, max_value: 20, unit: 'px/mm', description_he: 'כיול ברירת מחדל לטאבלט', description_en: 'Default tablet calibration' }),
  system('LOG', { key: 'log.retention_days', value_type: 'integer', default_value: 1825, min_value: 30, max_value: 7300, unit: 'days', description_he: 'שמירת יומן הפעולות', description_en: 'Application log retention' }),
];
