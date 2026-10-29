// Evaluator cockpit: sign-in, sessions, and the live session screen (FR-COCK-1…3).
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@ilt/ui';
import { ApiError, getAuth, login, logout, onAuthChange } from './api';
import { SessionScreen } from './SessionScreen';
import { SessionsScreen } from './SessionsScreen';
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

  return (
    <AppShell titleKey="app.cockpit">
      {!auth ? (
        <LoginForm />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', alignItems: 'center', marginBlockEnd: '0.75rem' }}>
            <span style={{ color: '#57606a' }}>{auth.user.full_name}</span>
            <button style={ui.button} onClick={() => void logout()}>{t('common.sign_out')}</button>
          </div>
          {sessionId ? (
            <SessionScreen key={sessionId} sessionId={sessionId} onBack={() => go('#/sessions')} />
          ) : (
            <SessionsScreen onOpen={(id) => go(`#/sessions/${id}`)} />
          )}
        </>
      )}
    </AppShell>
  );
}

function LoginForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <form onSubmit={submit} style={{ ...ui.card, maxInlineSize: '24rem', marginInline: 'auto', display: 'grid', gap: '0.75rem' }}>
      <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('cockpit.sign_in_title')}</h2>
      <label style={ui.field}>
        {t('common.email')}
        <input type="email" required autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label style={ui.field}>
        {t('common.password')}
        <input type="password" required autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      <button type="submit" style={ui.primary} disabled={busy}>{t('common.sign_in')}</button>
    </form>
  );
}
