// Evaluator cockpit: sign-in, sessions, the Dispatch Console per participant (FRS v3.3 Figure 2),
// the live session screen (FR-COCK-1…4), the Comparative
// Summary Dashboard (FR-SUM) and Replay (FR-REP). At <base>admin the same build is the Administrator
// cockpit: its own sign-in, for the System Administrator only, and the Administration screens.
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell, ThemeSwitcher } from '@ilt/ui';
import { AdminScreen, ADMIN_TABS, type AdminTab } from './AdminScreen';
import { DispatchConsole } from './DispatchConsole';
import { ADMIN_ENTRY, ApiError, entryAddress, getAuth, login, logout, onAuthChange } from './api';
import { ReplayScreen } from './ReplayScreen';
import { SessionScreen } from './SessionScreen';
import { SessionsScreen } from './SessionsScreen';
import { SummaryScreen } from './SummaryScreen';
import { ui } from './styles';

function useHashRoute(): [string, (to: string) => void] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [hash, (to) => (location.hash = to)];
}

export function App() {
  const { t } = useTranslation();
  const auth = useSyncExternalStore(onAuthChange, getAuth);
  const [hash, go] = useHashRoute();
  const sessionId = /^#\/sessions\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const summaryId = /^#\/summary\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const replayId = /^#\/replay\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const consoleId = /^#\/participant\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const adminTab: AdminTab = ADMIN_TABS.find((k) => hash === `#/${k}`) ?? 'users';
  // A role changed since sign-in (seen at the token refresh) may no longer belong at this address.
  const wrongEntry = !!auth && (auth.user.role === 'ADMIN') !== ADMIN_ENTRY;
  useEffect(() => {
    if (wrongEntry) void logout();
  }, [wrongEntry]);
  // The admin address always names its tab, so the address bar matches the open tab from sign-in on.
  useEffect(() => {
    if (ADMIN_ENTRY && auth && !wrongEntry && !ADMIN_TABS.some((k) => hash === `#/${k}`)) {
      history.replaceState(null, '', `#/${adminTab}`);
    }
  }, [auth, wrongEntry, hash, adminTab]);
  useEffect(() => {
    document.title = `${t('app.name')} · ${t(ADMIN_ENTRY ? 'app.admin' : 'app.cockpit')}`;
  }, [t]);

  return (
    <AppShell titleKey={ADMIN_ENTRY ? 'app.admin' : 'app.cockpit'} controls={<ThemeSwitcher />}>
      {!auth || wrongEntry ? (
        <LoginForm />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'flex-end', marginBlockEnd: '0.75rem' }}>
            <span style={{ color: 'var(--ilt-muted)' }}>{auth.user.full_name}</span>
            <button style={ui.button} onClick={() => void logout()}>{t('common.sign_out')}</button>
          </div>
          {ADMIN_ENTRY ? (
            <AdminScreen tab={adminTab} onTab={(k) => go(`#/${k}`)} />
          ) : replayId ? (
            <ReplayScreen key={replayId} attemptId={replayId} onBack={() => history.back()} />
          ) : consoleId ? (
            <DispatchConsole
              key={consoleId}
              participantId={consoleId}
              onBack={() => go('#/sessions')}
              onOpenSession={(id) => go(`#/sessions/${id}`)}
              onSummary={(id) => go(`#/summary/${id}`)}
            />
          ) : summaryId ? (
            <SummaryScreen key={summaryId} participantId={summaryId} onBack={() => history.back()} onReplay={(id) => go(`#/replay/${id}`)} />
          ) : sessionId ? (
            <SessionScreen
              key={sessionId}
              sessionId={sessionId}
              onBack={() => go('#/sessions')}
              onSummary={(id) => go(`#/summary/${id}`)}
              onReplay={(id) => go(`#/replay/${id}`)}
              onConsole={(id) => go(`#/participant/${id}`)}
            />
          ) : (
            <SessionsScreen onOpen={(id) => go(`#/sessions/${id}`)} onConsole={(id) => go(`#/participant/${id}`)} />
          )}
        </>
      )}
    </AppShell>
  );
}

const login_ = {
  page: { display: 'grid', placeItems: 'center', minBlockSize: 'calc(100vh - 8rem)' },
  card: {
    ...ui.card, inlineSize: '100%', maxInlineSize: '24rem', boxSizing: 'border-box', padding: '2rem',
    display: 'grid', gap: '1rem', boxShadow: 'var(--ilt-shadow)', borderRadius: 12,
  },
  head: { display: 'grid', justifyItems: 'center', gap: '0.5rem', textAlign: 'center', marginBlockEnd: '0.5rem' },
  input: { inlineSize: '100%', boxSizing: 'border-box', paddingBlock: '0.55rem' },
  eye: {
    position: 'absolute', insetInlineEnd: '0.35rem', insetBlockStart: '50%', transform: 'translateY(-50%)',
    border: 0, background: 'transparent', color: 'var(--ilt-muted)', cursor: 'pointer', padding: '0.25rem', display: 'grid', placeItems: 'center',
  },
  alert: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-bad-bg)', color: 'var(--ilt-bad)', fontSize: '0.9rem' },
} satisfies Record<string, CSSProperties>;

/** The ILT box with its three dots, as on the child's page. */
function IltMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
      <rect x="1" y="1" width="54" height="54" rx="12" fill="var(--ilt-accent)" />
      <rect x="14" y="12" width="28" height="32" rx="2" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="34" cy="18" r="2.6" fill="#fff" />
      <circle cx="20" cy="28" r="2.6" fill="#fff" />
      <circle cx="34" cy="38" r="2.6" fill="#fff" />
      <path d="M34 18 L20 28 L34 38" fill="none" stroke="#9ec5ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LoginForm() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      // Each user has their own interface language (FR-LANG-4); the switcher can still change it.
      const language = getAuth()?.user.ui_language;
      if (language && language !== i18n.language) await i18n.changeLanguage(language);
    } catch (err) {
      setError(err instanceof ApiError ? err.messageKey : 'error.500');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={login_.page}>
      <form onSubmit={submit} style={login_.card} data-testid="sign-in">
        <div style={login_.head}>
          <IltMark />
          <h2 style={{ margin: 0, fontSize: '1.35rem' }}>{t(ADMIN_ENTRY ? 'admin.sign_in_title' : 'cockpit.sign_in_title')}</h2>
          <p style={{ ...ui.muted, margin: 0, fontSize: '0.9rem' }}>{t(ADMIN_ENTRY ? 'admin.sign_in_subtitle' : 'cockpit.sign_in_subtitle')}</p>
        </div>
        <label style={ui.field}>
          {t('common.email')}
          <input type="email" required autoFocus autoComplete="username" dir="ltr" style={login_.input} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={ui.field}>
          {t('common.password')}
          <span style={{ position: 'relative', display: 'block' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              dir="ltr"
              style={{ ...login_.input, paddingInlineEnd: '2.5rem' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              style={login_.eye}
              aria-pressed={showPassword}
              aria-label={t('common.show_password')}
              title={t(showPassword ? 'common.hide_password' : 'common.show_password')}
              onClick={() => setShowPassword((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
                {showPassword && <path d="M4 4l16 16" />}
              </svg>
            </button>
          </span>
        </label>
        {error && <p role="alert" style={login_.alert}>{t(error, { address: entryAddress(!ADMIN_ENTRY) })}</p>}
        <button type="submit" style={{ ...ui.primary, paddingBlock: '0.6rem', fontWeight: 600 }} disabled={busy}>
          {t(busy ? 'cockpit.signing_in' : 'common.sign_in')}
        </button>
      </form>
    </div>
  );
}
