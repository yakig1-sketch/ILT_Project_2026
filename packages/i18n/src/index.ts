// Translation resources and direction helpers (DDD §13). Apps load these into i18next.
import { LANGUAGE_DIRECTION, type LanguageCode } from '@ilt/shared-types';
import { he } from './locales/he.js';
import { en } from './locales/en.js';

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
/** Every locale has exactly the Hebrew keys. */
export type LocaleShape = Widen<typeof he>;

export const resources: Record<LanguageCode, { translation: LocaleShape }> = {
  he: { translation: he },
  en: { translation: en },
};

export const DEFAULT_LANGUAGE: LanguageCode = 'he';

export const directionOf = (lang: LanguageCode): 'rtl' | 'ltr' => LANGUAGE_DIRECTION[lang];

/** Sets <html lang dir> for the interface language. The writing canvas never follows this. */
export function applyDocumentDirection(doc: Document, lang: LanguageCode): void {
  doc.documentElement.lang = lang;
  doc.documentElement.dir = directionOf(lang);
}

/** Flattens nested keys ("cockpit.telemetry.avg_speed") for completeness checks. */
export function flattenKeys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}
