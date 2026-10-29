// Shared page frame: title, language switch, server status. Uses CSS logical properties only,
// so the same layout works right-to-left (Hebrew) and left-to-right (English).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LanguageCode } from '@ilt/shared-types';

const styles = {
  header: {
    display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
    paddingBlock: '0.75rem', paddingInline: '1rem', borderBlockEnd: '1px solid #d0d7de', background: '#f6f8fa',
  },
  title: { margin: 0, fontSize: '1.25rem', marginInlineEnd: 'auto' },
  main: { padding: '1rem' },
  pill: (ok: boolean | null): CSSProperties => ({
    paddingInline: '0.6rem', paddingBlock: '0.15rem', borderRadius: '999px', fontSize: '0.85rem',
    background: ok === null ? '#eaeef2' : ok ? '#dafbe1' : '#ffebe9', color: ok === null ? '#57606a' : ok ? '#1a7f37' : '#cf222e',
  }),
} satisfies Record<string, CSSProperties | ((ok: boolean | null) => CSSProperties)>;

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      {t('common.language')}
      <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value as LanguageCode)}>
        <option value="he">{t('common.hebrew')}</option>
        <option value="en">{t('common.english')}</option>
      </select>
    </label>
  );
}

export function ServerStatus({ healthUrl = '/api/v1/health' }: { healthUrl?: string }) {
  const { t } = useTranslation();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch(healthUrl)
        .then((r) => alive && setOk(r.ok))
        .catch(() => alive && setOk(false));
    void check();
    const id = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [healthUrl]);
  return (
    <span style={styles.pill(ok)} data-testid="server-status">
      {t('common.server_status')}: {ok === null ? t('common.checking') : ok ? t('common.online') : t('common.offline')}
    </span>
  );
}

export function AppShell({ titleKey, children }: { titleKey: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <header style={styles.header}>
        <h1 style={styles.title}>
          {t('app.name')} · {t(titleKey)}
        </h1>
        <ServerStatus />
        <LanguageSwitcher />
      </header>
      <main style={styles.main}>{children}</main>
    </>
  );
}
