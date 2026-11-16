// Analyst portal (Phase 4a; FRS FR-AN-1, FR-AN-3, FR-REP-4): de-identified research data for analysts
// and researchers. Research sessions with cohort filters and grouping, one session's blocks, and replay.
// Routes: #/ (research sessions), #/session/<id>, #/replay/<attempt id>, #/kinematics/<attempt id> (Phase 4b),
// #/exports (Phase 4c), #/offline (paper and legacy results, Phase 5e), #/overview (cohort overview, Phase 5g).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AppShell, configureHelp, HelpButton, ReplayPlayer, ThemeSwitcher, ui, useHelpSection, type ReplayData } from '@ilt/ui';
import { ApiError, PORTAL_ROLES, api, getAuth, logout, onAuthChange } from './api';
import { ExportsScreen } from './ExportsScreen';
import { KinematicsScreen } from './KinematicsScreen';
import { LoginForm } from './LoginForm';
import { OfflineScreen } from './OfflineScreen';
import { OverviewScreen } from './OverviewScreen';
import { ResearchScreen } from './ResearchScreen';
import { SessionDetail } from './SessionDetail';

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
  const sessionId = /^#\/session\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const replayId = /^#\/replay\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  const onExports = hash === '#/exports';
  const onOffline = hash === '#/offline';
  const onOverview = hash === '#/overview';
  const kinematicsId = /^#\/kinematics\/([0-9a-f-]{36})$/.exec(hash)?.[1];
  // A role changed since sign-in (seen at the token refresh) may no longer belong here.
  const wrongRole = !!auth && !PORTAL_ROLES.includes(auth.user.role);
  useEffect(() => {
    if (wrongRole) void logout();
  }, [wrongRole]);
  useEffect(() => {
    document.title = `${t('app.name')} · ${t('app.analyst')}`;
  }, [t]);
  // Help: the analyst guide; a researcher's own guide where it has the section.
  configureHelp({ base: `${import.meta.env.BASE_URL}help/`, main: 'analyst', own: auth && !wrongRole && auth.user.role === 'RESEARCHER' ? 'researcher' : null });
  useHelpSection(
    !auth || wrongRole ? 'sign-in'
      : onOverview ? 'portal-overview' : onExports ? 'portal-exports' : onOffline ? 'portal-offline'
      : kinematicsId ? 'portal-kinematics' : replayId ? 'portal-replay' : sessionId ? 'portal-session' : 'portal-sessions',
  );

  return (
    <AppShell titleKey="app.analyst" controls={<><HelpButton /><ThemeSwitcher /></>}>
      {!auth || wrongRole ? (
        <LoginForm />
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBlockEnd: '0.75rem' }}>
            <nav aria-label={t('analyst.nav')} style={{ display: 'flex', gap: '0.25rem', marginInlineEnd: 'auto' }}>
              {([['#/overview', 'analyst.overview.tab', onOverview, 'overview'], ['#/', 'analyst.session_list', !onExports && !onOffline && !onOverview, 'sessions'],
                ['#/offline', 'analyst.offline.tab', onOffline, 'offline'],
                ['#/exports', 'analyst.export.tab', onExports, 'exports']] as const).map(([to, key, active, id]) => (
                <a key={to} href={to} aria-current={active ? 'page' : undefined} data-testid={`nav-${id}`}
                  style={{ padding: '0.35rem 0.8rem', borderRadius: 6, textDecoration: 'none', color: active ? 'var(--ilt-fg)' : 'var(--ilt-link)', background: active ? 'var(--ilt-select)' : 'transparent', fontWeight: active ? 600 : 400 }}>
                  {t(key)}
                </a>
              ))}
            </nav>
            <span style={{ color: 'var(--ilt-muted)' }}>{auth.user.full_name} · {t(`enum.role.${auth.user.role}`)}</span>
            <button style={ui.button} onClick={() => void logout()}>{t('common.sign_out')}</button>
          </div>
          {onOverview ? (
            <OverviewScreen onReplay={(id) => go(`#/replay/${id}`)} />
          ) : onExports ? (
            <ExportsScreen onChangeFilters={() => go('#/')} />
          ) : onOffline ? (
            <OfflineScreen onChangeFilters={() => go('#/')} />
          ) : kinematicsId ? (
            <KinematicsScreen key={kinematicsId} attemptId={kinematicsId} onBack={() => history.back()} />
          ) : replayId ? (
            <Replay key={replayId} attemptId={replayId} onBack={() => history.back()} />
          ) : sessionId ? (
            <SessionDetail key={sessionId} sessionId={sessionId} onBack={() => go('#/')} onReplay={(id) => go(`#/replay/${id}`)} onKinematics={(id) => go(`#/kinematics/${id}`)} />
          ) : (
            <ResearchScreen onOpen={(id) => go(`#/session/${id}`)} />
          )}
        </>
      )}
    </AppShell>
  );
}

function Replay({ attemptId, onBack }: { attemptId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ReplayData>(`/research/attempts/${attemptId}/replay`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [attemptId]);
  if (!data) return error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>{t('common.checking')}</p>;
  return <ReplayPlayer data={data} onBack={onBack} />;
}
