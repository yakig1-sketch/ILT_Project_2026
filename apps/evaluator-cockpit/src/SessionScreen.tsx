// Live session screen: pairing, step list, 80% live mirror and 20% clinical telemetry panel,
// and the session controls (FR-COCK-1…3, DDD §11.1).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanvasGeometry } from '@ilt/template-schemas';
import { CanvasView, InkRenderer } from '@ilt/ui';
import { ApiError, api } from './api';
import { CockpitLink, type LiveBlock } from './cockpit-link';
import { pill, ui } from './styles';

const WRITING = new Set(['WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE']);
const PAUSE_REASONS = ['STUDENT_FATIGUE', 'HARDWARE', 'EVALUATOR_INTERVENTION', 'OTHER'] as const;

interface Step {
  step_index: number;
  step_type: string;
  label_key: string;
  block_number: number | null;
  status: string;
}
interface Attempt {
  step_index: number;
  attempt_number: number;
  status: string;
  sample_count: number | null;
  integrity_ok: boolean | null;
}
interface SessionDetail {
  id: string;
  session_code: string;
  study_code: string;
  session_type: string;
  language_code: string;
  status: string;
  timers: { inactivity_sec: number; inactivity_last_box_sec: number };
  steps: Step[];
  attempts: Attempt[];
}

const layout: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 4fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' },
  // Block layout: the mirror measures this box's width, so it must not shrink to its content.
  mirror: { border: '1px solid #d0d7de', borderRadius: 8, minBlockSize: '20rem', background: '#e9ecef', overflow: 'hidden', padding: '0.5rem', minInlineSize: 0 },
  panel: { background: '#24292f', color: '#f6f8fa', borderRadius: 8, padding: '1rem' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', paddingBlock: '0.35rem', borderBlockEnd: '1px solid #444c56', fontSize: '0.9rem' },
};

export function SessionScreen({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<CockpitLink | null>(null);

  const reload = useCallback(() => {
    api<SessionDetail>(`/sessions/${sessionId}`).then(setSession).catch((e: ApiError) => setError(e.messageKey));
  }, [sessionId]);

  // The link is created inside the effect so a remount (React strict mode) gets a fresh one.
  useEffect(() => {
    const l = new CockpitLink(sessionId, reload);
    setLink(l);
    reload();
    return () => l.dispose();
  }, [sessionId, reload]);

  const { t } = useTranslation();
  if (!link || !session) {
    return error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>{t('common.checking')}</p>;
  }
  return <LiveSession link={link} session={session} reload={reload} onBack={onBack} />;
}

function LiveSession({ link, session, reload, onBack }: { link: CockpitLink; session: SessionDetail; reload: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<{ pin: string; expires_at: string } | null>(null);
  const [pauseReason, setPauseReason] = useState<(typeof PAUSE_REASONS)[number]>('STUDENT_FATIGUE');
  useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => `${link.gatewayConnected}${link.tabletConnected}${link.directOpen}${link.block?.activeBoxId}${link.block?.penLifts}${link.block?.completing}${link.lastStored?.step_index}${link.lastError}`,
  );
  // One-second tick for block time, inactivity and the relay indicator.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (link.tabletConnected) {
      setPin(null);
      reload();
    }
  }, [link.tabletConnected, reload]);

  const closed = session.status === 'COMPLETED' || session.status === 'ABORTED';
  const block = link.block;
  const writingActive = !!block && !block.completing;
  const paused = session.status === 'PAUSED';
  const stepsLeft = session.steps.some((s) => s.status === 'PENDING' || s.status === 'ACTIVE');
  const liveTone = link.liveMode === 'direct' ? 'ok' : link.liveMode === 'relay' ? 'warn' : 'off';

  async function openPairing() {
    setError(null);
    try {
      setPin(await api(`/sessions/${sessionId}/pairing`, { method: 'POST' }));
    } catch (e) {
      setError((e as ApiError).messageKey);
    }
  }

  async function skip(index: number) {
    setError(null);
    try {
      await api(`/sessions/${sessionId}/steps/${index}`, { method: 'PATCH', body: { status: 'SKIPPED' } });
      reload();
    } catch (e) {
      setError((e as ApiError).messageKey);
    }
  }

  async function complete() {
    setError(null);
    try {
      await api(`/sessions/${sessionId}/complete`, { method: 'POST' });
      reload();
    } catch (e) {
      setError((e as ApiError).messageKey);
    }
  }

  const stepLabel = (s: Step) => t(s.label_key, { n: s.block_number ?? '' });
  const attemptsFor = (index: number) => session.attempts.filter((a) => a.step_index === index);
  const shownError = error ?? link.lastError;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <button style={ui.button} onClick={onBack}>{t('common.back')}</button>
        <strong><bdi>{session.session_code}</bdi></strong>
        <span><bdi>{session.study_code}</bdi> · {t(`enum.session_type.${session.session_type}`)} · {session.language_code === 'he' ? t('common.hebrew') : t('common.english')}</span>
        <span style={pill(closed ? 'off' : 'ok')}>{t(`enum.session_status.${session.status}`)}</span>
        <span style={pill(link.tabletConnected ? 'ok' : 'off')} data-testid="tablet-status">
          {t(link.tabletConnected ? 'cockpit.pairing.tablet_connected' : 'cockpit.pairing.tablet_offline')}
        </span>
        <span style={pill(liveTone)} data-testid="live-mode">{t(`cockpit.live.${link.liveMode}`)}</span>
      </div>

      {!closed && !link.tabletConnected && (
        <section style={ui.card}>
          <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.pairing.title')}</h2>
          {pin ? (
            <div>
              <div style={ui.muted}>{t('cockpit.pairing.pin')}</div>
              <div dir="ltr" data-testid="pairing-pin" style={{ fontSize: '2.5rem', letterSpacing: '0.4rem', fontWeight: 600 }}>{pin.pin}</div>
              <div style={ui.muted}>{t('cockpit.pairing.expires', { time: new Date(pin.expires_at).toLocaleTimeString() })}</div>
            </div>
          ) : (
            <button style={ui.primary} onClick={() => void openPairing()}>{t('cockpit.pairing.open')}</button>
          )}
        </section>
      )}

      <div style={layout.grid}>
        <section style={layout.mirror} aria-label="mirror">
          {block ? (
            <Mirror link={link} canvas={block.canvas} activeBoxId={block.activeBoxId} />
          ) : (
            <p style={{ ...ui.muted, textAlign: 'center', marginBlockStart: '8rem' }}>{t('kiosk.waiting')}</p>
          )}
        </section>
        <Telemetry block={block} timers={session.timers} />
      </div>

      {!closed && (
        <div style={ui.row}>
          {paused ? (
            <button style={ui.primary} disabled={!writingActive} onClick={() => link.command('RESUME_SESSION', {})}>{t('cockpit.resume')}</button>
          ) : (
            <>
              <label style={ui.field}>
                {t('cockpit.pause_reason')}
                <select value={pauseReason} onChange={(e) => setPauseReason(e.target.value as typeof pauseReason)}>
                  {PAUSE_REASONS.map((r) => <option key={r} value={r}>{t(`enum.pause_reason.${r}`)}</option>)}
                </select>
              </label>
              <button style={ui.button} disabled={!writingActive} onClick={() => link.command('PAUSE_SESSION', { reason: pauseReason })}>{t('cockpit.pause')}</button>
            </>
          )}
          <button style={ui.button} disabled={!writingActive} onClick={() => link.command('MANUAL_FINISH', { reason: 'EVALUATOR' })} data-testid="manual-finish">
            {t('cockpit.manual_finish')}
          </button>
          <button style={ui.primary} disabled={stepsLeft || !!block} onClick={() => void complete()}>{t('cockpit.complete')}</button>
          <button
            style={ui.danger}
            onClick={() => {
              if (confirm(t('cockpit.abort_confirm'))) link.command('ABORT_SESSION', { reason: 'EVALUATOR_ABORT', save_partial: true });
            }}
          >
            {t('cockpit.abort')}
          </button>
        </div>
      )}
      {shownError && <p role="alert" style={ui.error}>{t(shownError, { code: shownError.split('.').pop() })}</p>}
      {link.lastStored && (
        <p role="status" style={{ margin: 0, color: link.lastStored.integrity_ok ? '#1a7f37' : '#cf222e' }}>
          {t('cockpit.block_stored', { n: link.lastStored.sample_count })} · {t(link.lastStored.integrity_ok ? 'cockpit.integrity_ok' : 'cockpit.integrity_failed')}
        </p>
      )}

      <section style={ui.card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.steps')}</h2>
        <table style={ui.table}>
          <tbody>
            {session.steps.map((s) => {
              const writing = WRITING.has(s.step_type);
              const attempts = attemptsFor(s.step_index);
              const lastAttempt = attempts[attempts.length - 1];
              return (
                <tr key={s.step_index} data-testid={`step-${s.step_index}`}>
                  <td style={ui.cell}>{s.step_index + 1}</td>
                  <td style={ui.cell}>{stepLabel(s)}</td>
                  <td style={ui.cell}>{t(`enum.step_status.${s.status}`)}</td>
                  <td style={ui.cell}>
                    {lastAttempt?.sample_count != null && (
                      <span style={ui.muted}>
                        {t('cockpit.block_stored', { n: lastAttempt.sample_count })}
                        {lastAttempt.integrity_ok === false && ` · ${t('cockpit.integrity_failed')}`}
                      </span>
                    )}
                  </td>
                  <td style={ui.cell}>
                    {!closed && (s.status === 'PENDING' || s.status === 'ACTIVE') && (
                      writing ? (
                        <button
                          style={ui.primary}
                          disabled={!link.tabletConnected || !!block}
                          onClick={() => link.command('DISPATCH_STEP', { step_index: s.step_index, step_type: s.step_type as 'ILT_BLOCK', attempt_number: 1 })}
                        >
                          {t('cockpit.dispatch')}
                        </button>
                      ) : (
                        <button style={ui.button} onClick={() => void skip(s.step_index)} title={t('cockpit.skip_note')}>{t('cockpit.skip')}</button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={ui.muted}>{t('cockpit.skip_note')}</p>
      </section>
    </div>
  );
}

/** The canvas scaled to the mirror's width, with the live ink drawn over it. */
function Mirror({ link, canvas, activeBoxId }: { link: CockpitLink; canvas: CanvasGeometry; activeBoxId: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const [pxPerMm, setPxPerMm] = useState(4);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPxPerMm(Math.max(1, el.clientWidth / canvas.size.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas]);

  const renderer = useRef<InkRenderer | null>(null);
  useEffect(() => {
    if (!ink.current) return;
    const r = new InkRenderer(ink.current, canvas.size, pxPerMm, { pressureColour: true, showHover: true, lineWidthMm: 0.6 });
    renderer.current = r;
    link.onSamples = (samples) => r.add(samples);
    return () => {
      link.onSamples = null;
      renderer.current = null;
    };
    // A new renderer per block; a resize only rescales it (next effect).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, canvas]);
  useEffect(() => renderer.current?.resize(pxPerMm), [pxPerMm]);

  return (
    <div ref={box} style={{ inlineSize: '100%' }}>
      <CanvasView geometry={canvas} pxPerMm={pxPerMm} activeBoxId={activeBoxId ?? undefined}>
        <canvas ref={ink} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      </CanvasView>
    </div>
  );
}

function Telemetry({ block, timers }: { block: LiveBlock | null; timers: SessionDetail['timers'] }) {
  const { t, i18n } = useTranslation();
  const num = (v: number, digits = 1) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  const s = t('units.seconds');
  const total = block?.fill_order.length ?? 0;
  const position = block && block.activeBoxId !== null ? block.fill_order.indexOf(block.activeBoxId) + 1 : 0;
  const blockTime = block && block.firstContactUs !== null && block.lastUs !== null ? (block.lastUs - block.firstContactUs) / 1e6 : null;
  const lastBox = block ? position === total : false;
  const idle = block?.lastSampleAt ? (Date.now() - block.lastSampleAt) / 1000 : null;
  const threshold = lastBox ? timers.inactivity_last_box_sec : timers.inactivity_sec;
  const later = <span style={{ opacity: 0.6 }}>{t('common.later_phase')}</span>;

  const rows: [string, React.ReactNode][] = [
    ['active_box', block ? <bdi>{t('cockpit.house_of', { n: position, total })}</bdi> : '—'],
    ['block_time', blockTime !== null ? <bdi>{num(blockTime)} {s}</bdi> : '—'],
    ['inactivity', idle !== null && block?.started ? <bdi>{num(idle, 0)} / {threshold} {s}</bdi> : '—'],
    ['pen_lifts', block ? <bdi>{block.penLifts}</bdi> : '—'],
    ['internal_lifts', later],
    ['width_outside', later],
    ['dot_b', later],
    ['skipped', block ? <bdi>{block.skipped.length}</bdi> : '—'],
    ['avg_speed', later],
  ];
  return (
    <aside style={layout.panel} data-testid="telemetry">
      <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('cockpit.telemetry.title')}</h2>
      {rows.map(([k, v]) => (
        <div key={k} style={layout.row}>
          <span>{t(`cockpit.telemetry.${k}`)}</span>
          <span>{v}</span>
        </div>
      ))}
    </aside>
  );
}
