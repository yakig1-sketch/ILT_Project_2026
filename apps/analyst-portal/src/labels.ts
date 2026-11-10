// Display labels for research values (Domain and Region names, enum values, school codes).
import type { TFunction } from 'i18next';

export interface Named { id: number; code: string; name_he: string; name_en: string }

export interface Options {
  domains: Named[];
  regions: Named[];
  sessions: number;
  participants: number;
  schools: string[];
  inactivity_sec: number[];
  canvases: string[];
}

export const nameOf = (list: Named[], id: number | string | null, language: string) => {
  const found = list.find((x) => String(x.id) === String(id));
  return found ? (language === 'he' ? found.name_he : found.name_en) : null;
};

/** A value as shown in a filter or a cohort group (null means "not recorded"). */
export function valueLabel(t: TFunction, language: string, options: Options | null, kind: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return t('analyst.not_recorded');
  const v = String(value);
  switch (kind) {
    case 'none': return t('analyst.everyone');
    case 'domain': return (options && nameOf(options.domains, v, language)) ?? v;
    case 'region': return (options && nameOf(options.regions, v, language)) ?? v;
    case 'grade': return t(`enum.grade.${v}`);
    case 'gender': return t(`enum.gender.${v}`);
    case 'ses': return t(`enum.ses.${v}`);
    case 'hand': return t(`enum.hand.${v}`);
    case 'language': return v === 'he' || v === 'en' ? t(`enum.language.${v}`) : v;
    case 'stage': return t(`enum.session_type.${v}`);
    case 'inactivity': return t('analyst.seconds_value', { n: v });
    default: return v;
  }
}

/** Age in months as years and months. */
export const ageLabel = (t: TFunction, months: number | null) =>
  months == null ? '—' : t('analyst.age_value', { y: Math.floor(months / 12), m: months % 12 });

/** A number for a table cell, or a dash. */
export const num = (v: number | string | null | undefined, digits = 1) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(digits);
