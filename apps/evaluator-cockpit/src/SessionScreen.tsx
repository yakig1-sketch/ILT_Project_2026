// Live session screen: pairing, step list, 80% live mirror and 20% clinical telemetry panel,
// and the session controls (FR-COCK-1…4, DDD §11.1): next step, video steps, paper notebook
// timing, pause, manual finish, repeat block, block results and the comparative summary.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SCORING_SETTINGS, scoreBlock, type BlockScore } from '@ilt/ilt-metrics';
import { atLastUnit, locksByRow, type CanvasGeometry } from '@ilt/template-schemas';
import { CanvasView, InkRenderer, PressureLegend } from '@ilt/ui';
import { ApiError, api } from './api';
import { CockpitLink, type LiveBlock } from './cockpit-link';
import { pill, tone, ui } from './styles';
import { LoadError } from './BackButton';

const WRITING = new Set(['WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE', 'INTERVENTION_SHEET']);
/** The note under a block that is measured but not scored. */
const unscoredNote = (stepType: string) =>
  stepType === 'NOTEBOOK_PAGE' ? 'cockpit.notebook_timed_only' : stepType === 'INTERVENTION_SHEET' ? 'cockpit.sheet_timed_only' : 'cockpit.warmup_not_scored';
/** A video's name: the library's keys, and any letter video (letter_<canvas code>). */
const videoName = (t: (k: string) => string, key = '') => t(key.startsWith('letter_') ? 'video.letter' : `video.${key}`);
const PAUSE_REASONS = ['STUDENT_FATIGUE', 'HARDWARE', 'EVALUATOR_INTERVENTION', 'OTHER'] as const;
const REPEAT_REASONS = ['DISRUPTION', 'HARDWARE', 'EVALUATOR_ERROR', 'OTHER'] as const;
// Manual finish blinks once it is available; reduced-motion users get the colour without the blink.
const BLINK_CSS = '@keyframes ilt-blink { 50% { opacity: 0.35; } } .ilt-blink { animation: ilt-blink 1s ease-in-out infinite; } @media (prefers-reduced-motion: reduce) { .ilt-blink { animation: none; } }';
const PREVIEW_EVERY_MS = 1000;

interface Step {
  step_index: number;
  step_type: string;
  label_key: string;
  block_number: number | null;
  video_key: string | null;
  status: string;
  paper_duration_ms: number | null;
  notes: string | null;
}
export interface AttemptScores {
  total_time_ms: number | null;
  pen_lifts: number | null;
  accurate_letters: number | null;
  accuracy_score: string | number | null;
  avg_speed_mm_s: string | number | null;
  speed_score: string | number | null;
  pen_lift_score: string | number | null;
  composite_score: string | number | null;
  pass: boolean | null;
}
interface Attempt extends AttemptScores {
  id: string;
  step_index: number;
  attempt_number: number;
  status: string;
  sample_count: number | null;
  integrity_ok: boolean | null;
  score_version: number | null;
  repeat_reason: string | null;
}
interface SessionDetail {
  id: string;
  session_code: string;
  participant_id: string;
  study_code: string;
  session_type: string;
  language_code: string;
  status: string;
  purpose: 'INTERVENTION' | 'RESEARCH';
  /** Intervention sessions (Phase 5b): what the session does with its target letter. */
  intervention_kind: 'TRAINING' | 'RETENTION' | null;
  letter: { canvas_id: string; code: string; letter: string | null } | null;
  /** A tablet holds this session's pairing, connected or not (released tablets do not count). */
  tablet_paired: boolean;
  timers: { inactivity_sec: number; inactivity_last_box_sec: number; amber_grace_sec: number };
  scoring: { pass_threshold: number | null; weight_speed_pct: number; weight_accuracy_pct: number; weight_pen_lifts_pct: number };
  steps: Step[];
  attempts: Attempt[];
  available_videos: string[];
}

const layout: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 4fr) minmax(0, 1fr)', gap: '1rem', alignItems: 'start' },
  // Block layout: the mirror measures this box's width, so it must not shrink to its content.
  mirror: { border: '1px solid var(--ilt-border)', borderRadius: 8, minBlockSize: '20rem', background: 'var(--ilt-stage)', overflow: 'hidden', padding: '0.5rem', minInlineSize: 0 },
  panel: { background: 'var(--ilt-panel)', color: 'var(--ilt-panel-fg)', border: '1px solid var(--ilt-panel-line)', borderRadius: 8, padding: '1rem' },
  panelAmber: { background: '#9a6700', color: '#fff', border: '1px solid #9a6700', borderRadius: 8, padding: '1rem' },
  row: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', paddingBlock: '0.35rem', borderBlockEnd: '1px solid var(--ilt-panel-line)', fontSize: '0.9rem' },
  result: { border: '1px solid var(--ilt-border)', borderRadius: 8, padding: '0.75rem 1rem', background: 'var(--ilt-surface-2)', display: 'grid', gap: '0.4rem' },
  figures: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.25rem', fontSize: '0.9rem' },
};

const n = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

export function SessionScreen({ sessionId, onBack, onSummary, onReplay, onConsole }: {
  sessionId: string;
  onBack: () => void;
  onSummary: (participantId: string) => void;
  onReplay: (attemptId: string) => void;
  /** The participant's Dispatch Console. */
  onConsole: (participantId: string) => void;
}) {
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
    return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('cockpit.sessions')} /> : <p style={ui.muted}>{t('common.checking')}</p>;
  }
  return <LiveSession link={link} session={session} reload={reload} onBack={onBack} onSummary={onSummary} onReplay={onReplay} onConsole={onConsole} />;
}

function LiveSession({ link, session, reload, onBack, onSummary, onReplay, onConsole }: {
  link: CockpitLink;
  session: SessionDetail;
  reload: () => void;
  onBack: () => void;
  onSummary: (participantId: string) => void;
  onReplay: (attemptId: string) => void;
  onConsole: (participantId: string) => void;
}) {
  const { t } = useTranslation();
  const sessionId = session.id;
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<{ pin: string; expires_at: string } | null>(null);
  const [pauseReason, setPauseReason] = useState<(typeof PAUSE_REASONS)[number]>('STUDENT_FATIGUE');
  const [repeatReason, setRepeatReason] = useState<(typeof REPEAT_REASONS)[number]>('DISRUPTION');
  useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => `${link.gatewayConnected}${link.tabletConnected}${link.directOpen}${link.block?.activeBoxId}${link.block?.penLifts}${link.block?.completing}${link.lastStored?.step_index}${link.lastInterrupted?.attempt_number}${link.block?.attempt_number}${link.lastError}${link.lastScored?.block_attempt_id}${link.video?.step_index}${link.amber}`,
  );
  // One-second tick for block time, inactivity, the live preview and the relay indicator.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
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
  const busy = !!block || !!link.video;
  const paused = session.status === 'PAUSED';
  const stepsLeft = session.steps.some((s) => s.status === 'PENDING' || s.status === 'ACTIVE');
  const liveTone = link.liveMode === 'direct' ? 'ok' : link.liveMode === 'relay' ? 'warn' : 'off';
  // Manual finish only once the child reached the last house (notebook: last row) and has not written for the last-house threshold.
  const canFinish = writingActive && !paused && isLastBox(block) && idleSec(block) >= session.timers.inactivity_last_box_sec;

  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError((e as ApiError).messageKey);
    }
  }
  const openPairing = () => call(async () => setPin(await api(`/sessions/${sessionId}/pairing`, { method: 'POST' })));
  const skip = (index: number) => call(() => api(`/sessions/${sessionId}/steps/${index}`, { method: 'PATCH', body: { status: 'SKIPPED' } }));
  const complete = () => call(() => api(`/sessions/${sessionId}/complete`, { method: 'POST' }));
  const releaseTablet = () => api(`/sessions/${sessionId}/release-tablet`, { method: 'POST' });
  const canRelease = !closed && session.tablet_paired && !busy;

  /** Back from an unfinished session with the tablet still connected: offer to release it first. */
  const [leaving, setLeaving] = useState(false);
  const back = () => (!closed && link.tabletConnected && !busy ? setLeaving(true) : onBack());
  async function releaseAndBack() {
    setError(null);
    try {
      await releaseTablet();
      onBack();
    } catch (e) {
      setLeaving(false);
      setError((e as ApiError).messageKey);
    }
  }

  const stepLabel = (s: Step) => t(s.label_key, { n: s.block_number ?? '' });
  const attemptsFor = (index: number) => session.attempts.filter((a) => a.step_index === index);
  const shownError = error ?? link.lastError;
  const videoMissing = (s: Step) => s.step_type === 'VIDEO' && !!s.video_key && !session.available_videos.includes(s.video_key);
  const dispatch = (s: Step) => link.command('DISPATCH_STEP', { step_index: s.step_index, step_type: s.step_type as 'ILT_BLOCK', attempt_number: 1 });
  const play = (s: Step) => link.command('VIDEO_PLAY', { step_index: s.step_index });
  const next = session.steps.find((s) => s.status === 'PENDING' || s.status === 'ACTIVE');
  const scoredStep = link.lastScored && session.steps.find((s) => s.step_index === link.lastScored!.step_index);

  /** "Next step": the first step not yet done, run the way its type needs (FR-COCK-3). */
  function runNext() {
    if (!next) return;
    if (WRITING.has(next.step_type)) dispatch(next);
    else if (next.step_type === 'VIDEO' && !videoMissing(next)) play(next);
    else document.getElementById(`step-${next.step_index}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const nextNeedsTablet = !!next && (WRITING.has(next.step_type) || next.step_type === 'VIDEO');
  const nextDisabled = !next || busy || (nextNeedsTablet && !link.tabletConnected) || videoMissing(next);

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <style>{BLINK_CSS}</style>
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <button style={ui.button} onClick={back} data-testid="back">{t('common.back')}</button>
        <strong><bdi>{session.session_code}</bdi></strong>
        <span><bdi>{session.study_code}</bdi> · {t(`enum.session_type.${session.session_type}`)}
          {session.letter && <> · {t(`enum.intervention_kind.${session.intervention_kind}`)} · <bdi data-testid="session-letter" style={{ fontWeight: 700 }}>{session.letter.letter ?? session.letter.code}</bdi></>}
          {' '}· {t(`enum.language.${session.language_code}`)}</span>
        <span style={pill(closed ? 'off' : 'ok')}>{t(`enum.session_status.${session.status}`)}</span>
        <span style={pill('off')} data-testid="session-purpose">{t(`enum.purpose.${session.purpose}`)}</span>
        <span style={pill(link.tabletConnected ? 'ok' : 'off')} data-testid="tablet-status">
          {t(link.tabletConnected ? 'cockpit.pairing.tablet_connected' : 'cockpit.pairing.tablet_offline')}
        </span>
        <span style={pill(liveTone)} data-testid="live-mode">{t(`cockpit.live.${link.liveMode}`)}</span>
        <button style={ui.button} onClick={() => onConsole(session.participant_id)} data-testid="open-console">{t('console.open')}</button>
        <button style={ui.button} onClick={() => onSummary(session.participant_id)} data-testid="open-summary">{t('cockpit.open_summary')}</button>
      </div>

      {leaving && (
        <section role="alertdialog" aria-labelledby="leave-text" style={{ ...ui.card, borderColor: 'var(--ilt-warn)', display: 'grid', gap: '0.75rem' }} data-testid="leave-dialog">
          <p id="leave-text" style={{ margin: 0 }}>{t('cockpit.leave.text')}</p>
          <div style={ui.row}>
            <button style={ui.primary} onClick={() => void releaseAndBack()} data-testid="leave-release">{t('cockpit.leave.release')}</button>
            <button style={ui.button} onClick={onBack} data-testid="leave-keep">{t('cockpit.leave.keep')}</button>
            <button style={ui.button} onClick={() => setLeaving(false)}>{t('cockpit.leave.stay')}</button>
          </div>
        </section>
      )}

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
            <>
              <Mirror link={link} canvas={block.canvas} activeBoxId={block.activeBoxId} />
              <PressureLegend />
            </>
          ) : link.video ? (
            <p style={{ ...ui.muted, textAlign: 'center', marginBlockStart: '8rem', fontSize: '1rem' }} data-testid="video-playing">
              {t('cockpit.video_playing', { name: videoName(t, link.video.video_key) })}
            </p>
          ) : (
            <p style={{ ...ui.muted, textAlign: 'center', marginBlockStart: '8rem' }}>{t('kiosk.waiting')}</p>
          )}
        </section>
        <Telemetry block={block} sheets={session.session_type === 'INTERVENTION'} timers={session.timers} amber={link.amber} scoring={session.scoring} />
      </div>

      {!closed && (
        <div style={ui.row}>
          <button style={ui.primary} disabled={nextDisabled} onClick={runNext} data-testid="next-step" title={next ? stepLabel(next) : undefined}>
            {next ? t('cockpit.next_step', { step: stepLabel(next) }) : t('cockpit.no_steps_left')}
          </button>
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
          <button
            className={canFinish ? 'ilt-blink' : undefined}
            style={canFinish ? { ...ui.button, ...ui.attention } : { ...ui.button, ...ui.faded }}
            disabled={!canFinish}
            title={t('cockpit.manual_finish_hint', { n: session.timers.inactivity_last_box_sec })}
            onClick={() => link.command('MANUAL_FINISH', { reason: 'EVALUATOR' })}
            data-testid="manual-finish"
          >
            {t('cockpit.manual_finish')}
          </button>
          <button style={ui.primary} disabled={stepsLeft || busy} onClick={() => void complete()} data-testid="complete-session">{t('cockpit.complete')}</button>
          {session.tablet_paired && (
            <button
              style={ui.button}
              disabled={!canRelease}
              title={busy ? t('sessions.release_step_running') : undefined}
              onClick={() => {
                if (confirm(t('cockpit.release_confirm'))) void call(releaseTablet);
              }}
              data-testid="release-tablet"
            >
              {t('cockpit.release')}
            </button>
          )}
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
      {link.lastInterrupted && (
        <p role="alert" style={{ margin: 0, color: tone.warn }}>{t('cockpit.block_interrupted')}</p>
      )}
      {link.lastStored && !link.lastScored && (
        <p role="status" style={{ margin: 0, color: link.lastStored.integrity_ok ? tone.ok : tone.bad }}>
          {t('cockpit.block_stored', { n: link.lastStored.sample_count })} · {t(link.lastStored.integrity_ok ? 'cockpit.integrity_ok' : 'cockpit.integrity_failed')}
        </p>
      )}
      {link.lastScored && scoredStep && (
        <BlockResult
          title={stepLabel(scoredStep)}
          stepType={scoredStep.step_type}
          scores={link.lastScored.scores as unknown as AttemptScores & { letters_expected: number | null }}
          stored={link.lastStored?.block_attempt_id === link.lastScored.block_attempt_id ? link.lastStored : null}
          threshold={session.scoring.pass_threshold}
          onReplay={() => onReplay(link.lastScored!.block_attempt_id)}
        />
      )}
      {closed && session.status === 'COMPLETED' && (
        <p role="status" style={{ margin: 0 }}>
          {t('cockpit.session_completed')}{' '}
          <button style={ui.primary} onClick={() => onSummary(session.participant_id)}>{t('cockpit.open_summary')}</button>
        </p>
      )}

      <section style={ui.card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.steps')}</h2>
        <table style={ui.table}>
          <tbody>
            {session.steps.map((s) => {
              const writing = WRITING.has(s.step_type);
              const attempts = attemptsFor(s.step_index);
              const current = [...attempts].reverse().find((a) => a.status !== 'REPEATED' && a.status !== 'ABORTED') ?? null;
              const repeated = attempts.filter((a) => a.status === 'REPEATED').length;
              const open = !closed && (s.status === 'PENDING' || s.status === 'ACTIVE');
              const playing = link.video?.step_index === s.step_index;
              return (
                <tr key={s.step_index} id={`step-${s.step_index}`} data-testid={`step-${s.step_index}`} style={next?.step_index === s.step_index && !closed ? { background: 'var(--ilt-surface-2)' } : undefined}>
                  <td style={ui.cell}>{s.step_index + 1}</td>
                  <td style={ui.cell}>{stepLabel(s)}</td>
                  <td style={ui.cell}>{t(`enum.step_status.${s.status}`)}</td>
                  <td style={{ ...ui.cell, ...ui.muted }}>
                    {current && writing && <AttemptFigures a={current} stepType={s.step_type} onReplay={() => onReplay(current.id)} />}
                    {repeated > 0 && <div>{t('cockpit.repeated_count', { n: repeated })}</div>}
                    {s.step_type === 'PAPER_NOTEBOOK_PAGE' && s.paper_duration_ms !== null && (
                      <span>{t('cockpit.paper_time', { s: (s.paper_duration_ms / 1000).toFixed(1) })}{s.notes ? ` · ${s.notes}` : ''}</span>
                    )}
                    {videoMissing(s) && s.status === 'PENDING' && <span style={{ color: tone.warn }}>{t('cockpit.video_missing')}</span>}
                  </td>
                  <td style={ui.cell}>
                    {open && writing && (
                      <button style={ui.primary} disabled={!link.tabletConnected || busy} onClick={() => dispatch(s)}>{t('cockpit.dispatch')}</button>
                    )}
                    {open && s.step_type === 'VIDEO' && (playing ? (
                      <button style={ui.button} onClick={() => link.command('VIDEO_ENDED', { step_index: s.step_index, reason: 'STOPPED' })}>{t('cockpit.stop_video')}</button>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button style={ui.primary} disabled={!link.tabletConnected || busy || videoMissing(s)} onClick={() => play(s)}>{t('cockpit.play_video')}</button>
                        <button style={ui.button} disabled={playing} onClick={() => void skip(s.step_index)}>{t('cockpit.skip')}</button>
                      </span>
                    ))}
                    {open && s.step_type === 'PAPER_NOTEBOOK_PAGE' && (
                      <PaperTimer onSave={(ms, notes) => call(() => api(`/sessions/${sessionId}/steps/${s.step_index}/paper`, { method: 'POST', body: { duration_ms: ms, notes } }))} />
                    )}
                    {!closed && writing && s.status === 'DONE' && (
                      <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select aria-label={t('cockpit.repeat_reason')} value={repeatReason} onChange={(e) => setRepeatReason(e.target.value as typeof repeatReason)}>
                          {REPEAT_REASONS.map((r) => <option key={r} value={r}>{t(`enum.repeat_reason.${r}`)}</option>)}
                        </select>
                        <button
                          style={ui.button}
                          disabled={!link.tabletConnected || busy}
                          data-testid={`repeat-${s.step_index}`}
                          onClick={() => {
                            if (confirm(t('cockpit.repeat_confirm'))) link.command('REPEAT_BLOCK', { step_index: s.step_index, reason: repeatReason });
                          }}
                        >
                          {t('cockpit.repeat')}
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** Compact figures for a step's current attempt in the step list. */
function AttemptFigures({ a, stepType, onReplay }: { a: Attempt; stepType: string; onReplay: () => void }) {
  const { t } = useTranslation();
  const sec = a.total_time_ms !== null ? (a.total_time_ms / 1000).toFixed(1) : null;
  const parts: string[] = [];
  if (a.sample_count !== null) parts.push(t('cockpit.block_stored', { n: a.sample_count }));
  if (a.integrity_ok === false) parts.push(t('cockpit.integrity_failed'));
  if (sec) parts.push(`${t('summary.time')} ${sec} ${t('units.seconds')}`);
  if (a.pen_lifts !== null) parts.push(`${t('summary.pen_lifts')} ${a.pen_lifts}`);
  if (stepType === 'ILT_BLOCK' && a.score_version !== null) {
    parts.push(`${t('summary.composite')} ${n(a.composite_score) ?? t('summary.not_configured')}`);
  }
  return (
    <span>
      {parts.join(' · ')}{' '}
      {a.sample_count !== null && <button style={{ ...ui.button, paddingBlock: 0 }} onClick={onReplay}>{t('replay.open')}</button>}
    </span>
  );
}

/** The last finished block: components next to the composite, never instead of them (FR-SCORE-13). */
function BlockResult({ title, stepType, scores, stored, threshold, onReplay }: {
  title: string;
  stepType: string;
  scores: AttemptScores & { letters_expected: number | null };
  stored: { sample_count: number; integrity_ok: boolean } | null;
  threshold: number | null;
  onReplay: () => void;
}) {
  const { t } = useTranslation();
  const nc = t('summary.not_configured');
  const f = (v: string | number | null, digits = 1) => (n(v) === null ? nc : n(v)!.toFixed(digits));
  const scored = stepType === 'ILT_BLOCK';
  const measured = stepType !== 'NOTEBOOK_PAGE' && stepType !== 'INTERVENTION_SHEET';
  return (
    <section style={layout.result} data-testid="block-result" aria-live="polite">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
        <strong>{t('cockpit.result_title', { step: title })}</strong>
        <button style={ui.button} onClick={onReplay}>{t('replay.open')}</button>
      </div>
      <div style={layout.figures}>
        {stored && (
          <span style={{ color: stored.integrity_ok ? tone.ok : tone.bad }}>
            {t('cockpit.block_stored', { n: stored.sample_count })} · {t(stored.integrity_ok ? 'cockpit.integrity_ok' : 'cockpit.integrity_failed')}
          </span>
        )}
        <span>{t('summary.time')}: {scores.total_time_ms === null ? '—' : `${(scores.total_time_ms / 1000).toFixed(1)} ${t('units.seconds')}`}</span>
        <span>{t('summary.pen_lifts')}: {scores.pen_lifts ?? '—'}</span>
        {measured && <span>{t('summary.accuracy')}: {f(scores.accuracy_score)} ({t('summary.accurate_letters', { n: scores.accurate_letters ?? 0, total: scores.letters_expected ?? 15 })})</span>}
        {measured && <span>{t('summary.avg_speed')}: {n(scores.avg_speed_mm_s) === null ? '—' : `${f(scores.avg_speed_mm_s, 2)} ${t('units.mm_s')}`}</span>}
      </div>
      {scored ? (
        <div style={layout.figures}>
          <span>{t('summary.speed_score')}: {f(scores.speed_score)}</span>
          <span>{t('summary.accuracy_score')}: {f(scores.accuracy_score)}</span>
          <span>{t('summary.pen_lift_score')}: {f(scores.pen_lift_score)}</span>
          <strong>{t('summary.composite')}: {f(scores.composite_score)}</strong>
          <strong>{scores.pass === null ? `${t('summary.pass_fail')}: ${nc}` : t(scores.pass ? 'summary.pass' : 'summary.fail')}</strong>
          {threshold === null && <span style={ui.muted}>{t('summary.threshold_not_set')}</span>}
        </div>
      ) : (
        <div style={ui.muted}>{t(unscoredNote(stepType))}</div>
      )}
    </section>
  );
}

/** Paper notebook page (FR-COCK-4): start / stop timer, notes, save. */
function PaperTimer({ onSave }: { onSave: (ms: number, notes: string) => void }) {
  const { t } = useTranslation();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  const [, setTick] = useState(0);
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setTick((x) => x + 1), 200);
    return () => clearInterval(id);
  }, [startedAt]);
  const ms = startedAt === null ? elapsed : elapsed + (Date.now() - startedAt);
  return (
    <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }} data-testid="paper-timer">
      <bdi style={{ fontVariantNumeric: 'tabular-nums', minInlineSize: '4.5rem' }}>{(ms / 1000).toFixed(1)} {t('units.seconds')}</bdi>
      {startedAt === null ? (
        <button style={ui.primary} onClick={() => setStartedAt(Date.now())}>{t(elapsed ? 'cockpit.paper_resume' : 'cockpit.paper_start')}</button>
      ) : (
        <button style={ui.button} onClick={() => { setElapsed(ms); setStartedAt(null); }}>{t('cockpit.paper_stop')}</button>
      )}
      <input aria-label={t('cockpit.paper_notes')} placeholder={t('cockpit.paper_notes')} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button style={ui.button} disabled={startedAt !== null || elapsed === 0} onClick={() => onSave(Math.round(elapsed), notes.trim())}>{t('cockpit.paper_save')}</button>
    </span>
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

const isLastBox = (b: LiveBlock | null) => !!b && atLastUnit(b.canvas, b.fill_order, b.activeBoxId);
const idleSec = (b: LiveBlock | null) => (b?.lastContactAt ? (Date.now() - b.lastContactAt) / 1000 : 0);

/** Live preview with the same scoring engine as the gateway (DDD §8), at most once a second. */
function useLivePreview(block: LiveBlock | null, scoring: SessionDetail['scoring']): BlockScore | null {
  const cache = useRef<{ key: string; at: number; result: BlockScore | null }>({ key: '', at: 0, result: null });
  if (!block?.profile || block.samples.length === 0) return null;
  const key = `${block.step_index}:${block.attempt_number}`;
  const c = cache.current;
  if (c.key === key && Date.now() - c.at < PREVIEW_EVERY_MS) return c.result;
  let result: BlockScore | null = null;
  try {
    result = scoreBlock(block.samples, block.canvas, block.profile, {
      ...DEFAULT_SCORING_SETTINGS,
      weight_speed_pct: scoring.weight_speed_pct,
      weight_accuracy_pct: scoring.weight_accuracy_pct,
      weight_pen_lifts_pct: scoring.weight_pen_lifts_pct,
      pass_threshold: scoring.pass_threshold,
    });
  } catch {
    result = null;
  }
  cache.current = { key, at: Date.now(), result };
  return result;
}

function Telemetry({ block, sheets, timers, amber, scoring }: {
  block: LiveBlock | null;
  /** An intervention session: its steps are letter sheets, also between blocks. */
  sheets: boolean;
  timers: SessionDetail['timers'];
  amber: boolean;
  scoring: SessionDetail['scoring'];
}) {
  const { t, i18n } = useTranslation();
  const num = (v: number, digits = 1) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
  const s = t('units.seconds');
  const total = block?.fill_order.length ?? 0;
  const position = block && block.activeBoxId !== null ? block.fill_order.indexOf(block.activeBoxId) + 1 : 0;
  const blockTime = block && block.firstContactUs !== null && block.lastUs !== null ? (block.lastUs - block.firstContactUs) / 1e6 : null;
  const lastBox = isLastBox(block);
  const idle = block?.lastContactAt ? idleSec(block) : null;
  const threshold = lastBox ? timers.inactivity_last_box_sec : timers.inactivity_sec;
  // Amber (FR-TAB-5): reported by the tablet, or reached here after the grace period.
  const isAmber = !!block && !block.completing && (amber || (idle !== null && idle >= threshold + timers.amber_grace_sec));
  const notebook = !!block && locksByRow(block.canvas);
  const preview = useLivePreview(block, scoring);
  const written = preview?.letters.filter((l) => l.status === 'WRITTEN') ?? [];
  const house = (boxId: number) => (block ? block.fill_order.indexOf(boxId) + 1 : 0);
  const internal = written.filter((l) => l.internal_pen_lifts > 0);
  const none = '—';

  // ILT-only lines (width, dot B, ILT speed) do not apply to a letter sheet.
  const sheet = block ? block.step_type === 'INTERVENTION_SHEET' : sheets;
  const iltOnly = new Set(sheet ? ['width_outside', 'dot_b', 'avg_speed'] : []);
  const rows: [string, React.ReactNode][] = ([
    ['active_box', block ? <bdi>{t('cockpit.house_of', { n: position, total })}</bdi> : none],
    ['block_time', blockTime !== null ? <bdi>{num(blockTime)} {s}</bdi> : none],
    ['inactivity', idle !== null && block?.started ? <bdi>{num(idle, 0)} / {threshold} {s}</bdi> : none],
    ['pen_lifts', block ? <bdi>{block.penLifts}</bdi> : none],
    ['internal_lifts', preview ? <bdi>{preview.internal_pen_lifts}{internal.length > 0 && ` (${t('cockpit.houses')} ${internal.map((l) => house(l.box_id)).join(', ')})`}</bdi> : none],
    ['width_outside', preview ? <bdi>{written.filter((l) => l.width_in_band === false).length} / {written.length}</bdi> : none],
    ['dot_b', preview ? <bdi>{written.filter((l) => l.dots.B?.hit).length} / {written.length}</bdi> : none],
    // Notebook letters are written freely along the lines, so passed cells are not skipped houses.
    ['skipped', block && !notebook ? <bdi>{block.skipped.length}</bdi> : none],
    ['avg_speed', preview?.avg_speed_mm_s != null ? <bdi>{num(preview.avg_speed_mm_s, 2)} {t('units.mm_s')}</bdi> : none],
  ] as [string, React.ReactNode][]).filter(([k]) => !iltOnly.has(k));
  return (
    <aside style={isAmber ? layout.panelAmber : layout.panel} data-testid="telemetry" data-amber={isAmber}>
      <h2 style={{ marginBlockStart: 0, fontSize: '1rem' }}>{t('cockpit.telemetry.title')}</h2>
      {isAmber && <p role="alert" style={{ marginBlock: '0 0.5rem', fontWeight: 600 }}>{t('cockpit.inactivity_amber')}</p>}
      {rows.map(([k, v]) => (
        <div key={k} style={layout.row}>
          <span>{t(`cockpit.telemetry.${k}`)}</span>
          <span>{v}</span>
        </div>
      ))}
      {block && block.step_type !== 'ILT_BLOCK' && <p style={{ fontSize: '0.8rem', opacity: 0.8, marginBlockEnd: 0 }}>{t(unscoredNote(block.step_type))}</p>}
    </aside>
  );
}
