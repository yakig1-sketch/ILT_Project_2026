// Light / dark theme for the staff screens. The choice is kept per browser; "system" follows the
// computer's setting. The page's CSS reads <html data-theme>; apps without a theme stay light.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'ilt.theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(stored);
  useEffect(() => {
    apply(choice);
    if (choice !== 'system') return;
    const m = media();
    const on = () => apply('system');
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [choice]);
  const set = (c: ThemeChoice) => {
    try {
      if (c === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      // Storage blocked: the choice lasts until the page is reloaded.
    }
    setChoice(c);
  };
  return [choice, set];
}

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [choice, setChoice] = useTheme();
  return (
    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      {t('common.theme')}
      <select value={choice} onChange={(e) => setChoice(e.target.value as ThemeChoice)} data-testid="theme">
        <option value="light">{t('common.theme_light')}</option>
        <option value="dark">{t('common.theme_dark')}</option>
        <option value="system">{t('common.theme_system')}</option>
      </select>
    </label>
  );
}
