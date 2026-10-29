import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LANGUAGE, applyDocumentDirection, resources } from '@ilt/i18n';
import { LANGUAGES, type LanguageCode } from '@ilt/shared-types';

const STORAGE_KEY = 'ilt.ui_language';

function storedLanguage(): LanguageCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return (LANGUAGES as readonly string[]).includes(v ?? '') ? (v as LanguageCode) : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Initialises i18next with the interface language and sets <html lang dir>. */
export async function initI18n(): Promise<typeof i18next> {
  const lng = storedLanguage();
  await i18next.use(initReactI18next).init({ resources, lng, fallbackLng: DEFAULT_LANGUAGE, interpolation: { escapeValue: false } });
  applyDocumentDirection(document, lng);
  i18next.on('languageChanged', (l) => {
    applyDocumentDirection(document, l as LanguageCode);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // Private mode: the choice simply isn't remembered.
    }
  });
  return i18next;
}
