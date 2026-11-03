// Evaluator cockpit: sign-in, sessions, the live session screen (FR-COCK-1…4), the Comparative
// Summary Dashboard (FR-SUM) and Replay (FR-REP).
import { useEffect, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell, ThemeSwitcher } from '@ilt/ui';
import { ApiError, getAuth, login, logout, onAuthChange } from './api';
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

  return (
    <AppShell titleKey="app.cockpit" controls={<ThemeSwitcher />}>
      {!auth ? (
        <LoginForm />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', marginBlockEnd: '0.75rem' }}>
            <span style={{ color: 'var(--ilt-muted)' }}>{auth.user.full_name}</span>
            <button style={ui.button} onClick={() => void logout()}>{t('common.sign_out')}</button>
          </div>
          {replayId ? (
            <ReplayScreen key={replayId} attemptId={replayId} onBack={() => history.back()} />
          ) : summaryId ? (
            <SummaryScreen key={summaryId} participantId={summaryId} onBack={() => history.back()} onReplay={(id) => go(`#/replay/${id}`)} />
          ) : sessionId ? (
            <SessionScreen
              key={sessionId}
              sessionId={sessionId}
              onBack={() => go('#/sessions')}
              onSummary={(id) => go(`#/summary/${id}`)}
              onReplay={(id) => go(`#/replay/${id}`)}
            />
          ) : (
            <SessionsScreen onOpen={(id) => go(`#/sessions/${id}`)} />
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
  const { t } = useTranslation();
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
          <h2 style={{ margin: 0, fontSize: '1.35rem' }}>{t('cockpit.sign_in_title')}</h2>
          <p style={{ ...ui.muted, margin: 0, fontSize: '0.9rem' }}>{t('cockpit.sign_in_subtitle')}</p>
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
        {error && <p role="alert" style={login_.alert}>{t(error)}</p>}
        <button type="submit" style={{ ...ui.primary, paddingBlock: '0.6rem', fontWeight: 600 }} disabled={busy}>
          {t(busy ? 'cockpit.signing_in' : 'common.sign_in')}
        </button>
      </form>
    </div>
  );
}
