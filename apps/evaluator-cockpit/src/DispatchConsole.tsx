// Evaluator Control & Dispatch Console (FRS v3.3 Figure 2): one participant's protocol at a glance.
// Day 1, Day 2, Day 14 and the intervention programme as step cards (completed, active, to
// dispatch), the Comparative Summary, and the live cockpit. A card opens its session in the live
// cockpit, where its steps are dispatched to the tablet.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PROTOCOLS } from '@ilt/template-schemas';
import { ApiError, api } from './api';
import { ui } from './styles';
import { BackButton, LoadError } from './BackButton';

type DayType = 'DAY_1' | 'DAY_2' | 'DAY_14';
interface Step {
  step_index: number;
  step_type: string;
  label_key: string;
  block_number: number | null;
  is_scored: boolean;
  status: 'PENDING' | 'ACTIVE' | 'DONE' | 'SKIPPED';
  video_key: string | null;
  composite_score: number | null;
}
interface Session {
  id: string;
  session_code: string;
  status: string;
  language_code: string;
  created_at: string;
  can_open: boolean;
  /** The day's other sessions, not shown on the cards (for example a second Day 1 planned after Day 1 was completed). */
  others: { id: string; session_code: string; status: string; can_open: boolean }[];
  steps: Step[];
}
/** A letter of the intervention programme and where the participant stands with it (Phase 5b). */
interface IvLetter {
  canvas_id: string;
  code: string;
  letter: string | null;
  name_he: string;
  name_en: string;
  trainings: number;
  last_trained_on: string | null;
  retention_due_on: string | null;
  retention_due: boolean;
  retention_done: boolean;
}
interface IvSession {
  id: string;
  session_code: string;
  status: string;
  created_at: string;
  kind: 'TRAINING' | 'RETENTION';
  code: string;
  letter: string | null;
  sheets_total: number;
  sheets_done: number;
  can_open: boolean;
}
interface Intervention {
  language_code: string;
  training_sheets: number;
  retention_days: number;
  letters: IvLetter[];
  sessions: IvSession[];
}
interface Protocol {
  participant: { id: string; study_code: string; grade_level: string | null; domain: { code: string; name_he: string; name_en: string } };
  sessions: Partial<Record<DayType, Session>>;
  intervention: Intervention;
  day14_average: number | null;
  settings: { in_transition_sec: number; inactivity_sec: number; timers_source: string; warmup_enabled: boolean; director_approval: boolean };
}
type CardState = 'done' | 'active' | 'pending' | 'skipped' | 'planned';
interface Card {
  type: string;
  steps: Pick<Step, 'step_type' | 'block_number' | 'is_scored' | 'video_key' | 'status'>[];
}

/** Colours of the figure; text on them is white, so they read the same in light and dark mode. */
const C = { navy: '#1d3557', green: '#2f9e5b', blue: '#2b6cb0', slate: '#4a5568', amber: '#d69e2e', greenLine: '#2f9e5b', blueLine: '#3c87c8' };
const LIVE = new Set(['PAIRED', 'IN_PROGRESS', 'PAUSED']);
/** Steps written one after another of the same kind are shown as one card ("ILT 4 Blocks"). */
const GROUPED = new Set(['ILT_BLOCK', 'NOTEBOOK_PAGE', 'PAPER_NOTEBOOK_PAGE', 'INTERVENTION_SHEET']);
const OPEN = new Set(['PLANNED', ...LIVE]);

const s = {
  frame: { border: '1px solid var(--ilt-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--ilt-surface)' },
  header: { background: C.navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', paddingInline: '1.25rem', paddingBlock: '0.9rem' },
  title: { margin: 0, fontSize: '1.15rem', fontWeight: 700 },
  subject: { fontWeight: 600, fontSize: '0.95rem' },
  body: { padding: '1rem', display: 'grid', gap: '1rem' },
  panel: { borderRadius: 10, padding: '0.9rem', display: 'grid', gap: '0.75rem', alignContent: 'start' },
  panelTitle: { margin: 0, fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase' },
  cards: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  card: {
    color: '#fff', border: 0, borderRadius: 8, paddingInline: '0.6rem', paddingBlock: '0.75rem', minInlineSize: '8.5rem', flex: '1 1 8.5rem', maxInlineSize: '11rem',
    display: 'grid', gap: '0.45rem', justifyItems: 'center', alignContent: 'space-between', textAlign: 'center', font: 'inherit', minBlockSize: '8rem',
  },
  cardTitle: { fontWeight: 700, fontSize: '0.92rem' },
  cardSub: { fontSize: '0.78rem', opacity: 0.85 },
  cardState: { fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(17rem, 1fr))', gap: '1rem' },
  status: { borderRadius: 10, padding: '1rem', background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' },
  bigButton: { background: C.blue, color: '#fff', border: 0, borderRadius: 8, paddingInline: '1.75rem', paddingBlock: '1rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' },
  wideButton: { background: C.blueLine, color: '#fff', border: 0, borderRadius: 8, padding: '1rem', fontWeight: 700, cursor: 'pointer', inlineSize: '100%' },
} satisfies Record<string, CSSProperties>;

const cardColour: Record<CardState, string> = { done: C.green, active: C.blue, pending: C.slate, skipped: '#718096', planned: C.slate };

/** Groups a session's steps into the console's cards. */
function cardsOf(steps: Card['steps']): Card[] {
  const cards: Card[] = [];
  for (const st of steps) {
    const last = cards[cards.length - 1];
    if (last && GROUPED.has(st.step_type) && last.type === st.step_type) last.steps.push(st);
    else cards.push({ type: st.step_type, steps: [st] });
  }
  return cards;
}

function stateOf(card: Card, planned: boolean): CardState {
  if (planned) return 'planned';
  const st = card.steps.map((x) => x.status);
  if (st.every((x) => x === 'SKIPPED')) return 'skipped';
  if (st.every((x) => x === 'DONE' || x === 'SKIPPED')) return 'done';
  if (st.some((x) => x === 'ACTIVE') || st.some((x) => x === 'DONE' || x === 'SKIPPED')) return 'active';
  return 'pending';
}

export function DispatchConsole({ participantId, onBack, onOpenSession, onSummary, onRecord }: {
  participantId: string;
  onBack: () => void;
  onOpenSession: (id: string) => void;
  onSummary: (participantId: string) => void;
  onRecord: (participantId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [p, setP] = useState<Protocol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Protocol>(`/participants/${participantId}/protocol`).then(setP).catch((e) => setError(e instanceof ApiError ? e.messageKey : 'error.500'));
  }, [participantId, reload]);

  if (!p) return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('cockpit.sessions')} /> : null;
  const he = i18n.language === 'he';
  const days = (['DAY_1', 'DAY_2', 'DAY_14'] as const).map((d) => p.sessions[d]);
  const ivSessions = p.intervention.sessions.filter((x) => x.can_open);
  const live = days.find((x) => x && LIVE.has(x.status) && x.can_open) ?? ivSessions.find((x) => LIVE.has(x.status))
    ?? days.find((x) => x && x.status === 'PLANNED' && x.can_open) ?? ivSessions.find((x) => x.status === 'PLANNED');
  // The card holding the step that runs on the tablet now, numbered as on the console ("Step 3 (ILT 4 Blocks)").
  const running = (['DAY_1', 'DAY_2', 'DAY_14'] as const).flatMap((d) => {
    const cards = cardsOf(p.sessions[d]?.steps ?? []);
    const i = cards.findIndex((c) => c.steps.some((y) => y.status === 'ACTIVE'));
    return i >= 0 ? [{ day: d, card: cards[i]!, n: i + 1 }] : [];
  })[0];

  /** Plans a session of this type in the participant's default language. */
  async function plan(type: DayType) {
    setBusy(true);
    setError(null);
    try {
      const langs = await api<{ enabled: string[]; default: string }>(`/participants/${participantId}/languages`);
      await api('/sessions', { method: 'POST', body: { participant_id: participantId, session_type: type, language_code: langs.default } });
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.messageKey : 'error.500');
    } finally {
      setBusy(false);
    }
  }

  const dayPanel = (type: DayType, colour: string, extra?: ReactNode) => {
    const session = p.sessions[type];
    const template = DEFAULT_PROTOCOLS.find((x) => x.session_type === type)!.steps
      .filter((x) => p.settings.warmup_enabled || x.step_type !== 'WARMUP_BLOCK')
      .map((x) => ({ step_type: x.step_type, block_number: x.block_number ?? null, is_scored: x.is_scored, video_key: x.video_key ?? null, status: 'PENDING' as const }));
    const cards = cardsOf(session ? session.steps : template);
    return (
      <section style={{ ...s.panel, border: `1.5px solid ${colour}`, background: type === 'DAY_1' ? 'color-mix(in srgb, #3c87c8 8%, var(--ilt-surface))' : 'var(--ilt-surface)' }} data-testid={`console-${type}`}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <h3 style={{ ...s.panelTitle, color: type === 'DAY_1' ? 'var(--ilt-fg)' : C.blueLine }}>{t(`console.day.${type}`)}</h3>
          {session && (
            <span style={ui.muted}>
              <bdi>{session.session_code}</bdi> · {t(`enum.session_status.${session.status}`)} · {t(`enum.language.${session.language_code}`)}
            </span>
          )}
        </div>
        <div style={s.cards}>
          {cards.map((card, i) => (
            <StepCard key={i} n={i + 1} card={card} state={stateOf(card, !session)} day={type}
              onClick={session?.can_open ? () => onOpenSession(session.id) : undefined} />
          ))}
        </div>
        {!session && (
          <button style={{ ...ui.button, justifySelf: 'start' }} disabled={busy} onClick={() => void plan(type)} data-testid={`plan-${type}`}>
            + {t('console.plan', { day: t(`enum.session_type.${type}`) })}
          </button>
        )}
        {session && !session.can_open && <p style={{ ...ui.muted, margin: 0 }}>{t('console.other_evaluator')}</p>}
        {session && session.others.length > 0 && (
          <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }} data-testid={`others-${type}`}>
            {t('console.others')}{' '}
            {session.others.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ', '}
                {o.can_open
                  ? <button style={{ border: 0, padding: 0, background: 'none', color: 'var(--ilt-accent)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }} onClick={() => onOpenSession(o.id)}><bdi>{o.session_code}</bdi></button>
                  : <bdi>{o.session_code}</bdi>}
                {' '}({t(`enum.session_status.${o.status}`)})
              </span>
            ))}
          </p>
        )}
        {extra}
      </section>
    );
  };

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <BackButton onClick={onBack} label={t('cockpit.sessions')} />
        <button style={ui.button} onClick={() => onRecord(participantId)} data-testid="console-record">{t('participants.open_record')}</button>
      </div>
      <div style={s.frame} data-testid="dispatch-console">
        <div style={s.header}>
          <h2 style={s.title}>{t('console.title')}</h2>
          <div style={s.subject}>
            {t('console.dispatcher')} | {t('console.subject')}: <bdi dir="ltr">{p.participant.study_code}</bdi>
            {p.participant.grade_level && <> | {t('console.grade')}: {t(`enum.grade.${p.participant.grade_level}`)}</>}
            {' '}| {he ? p.participant.domain.name_he : p.participant.domain.name_en}
          </div>
        </div>
        <div style={s.body}>
          {error && <p role="alert" style={ui.error}>{t(error)}</p>}
          {dayPanel('DAY_1', C.blueLine)}
          <div style={s.row}>
            {dayPanel('DAY_2', 'var(--ilt-border)')}
            {dayPanel('DAY_14', 'var(--ilt-border)', (
              <>
                <div style={{ ...s.card, background: C.slate, maxInlineSize: 'none', minBlockSize: 0, cursor: 'default' }} data-testid="day14-average">
                  <span style={s.cardTitle}>{t('console.day14_check')}</span>
                  <span style={s.cardSub}>
                    {p.day14_average === null ? t('console.day14_no_average') : t('console.day14_average', { score: p.day14_average.toFixed(1) })}
                  </span>
                </div>
                <button style={s.wideButton} onClick={() => onSummary(participantId)} data-testid="console-summary">{t('console.summary')} {he ? '‹' : '›'}</button>
              </>
            ))}
            <InterventionPanel iv={p.intervention} participantId={participantId} onOpenSession={onOpenSession}
              onPlanned={() => setReload((n) => n + 1)} />
          </div>
          <div style={s.status} data-testid="console-status">
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <strong>
                {running
                  ? t('console.status_running', { n: running.n, step: stepTitle(t, running.card.steps[0]!, running.card.steps.length), day: t(`enum.session_type.${running.day}`) })
                  : t('console.status_idle')}
              </strong>
              <ul style={{ margin: 0, paddingInlineStart: '1.1rem', ...ui.muted }}>
                <li>
                  {t('console.timer_policy', { transition: p.settings.in_transition_sec, inactivity: p.settings.inactivity_sec, source: t(`console.source.${p.settings.timers_source}`) })}
                  {p.settings.director_approval && ` ${t('console.timer_governed')}`}
                </li>
                <li>{t(p.settings.warmup_enabled ? 'console.warmup_on' : 'console.warmup_off')}</li>
              </ul>
            </div>
            <button style={{ ...s.bigButton, ...(live ? {} : { opacity: 0.5, cursor: 'not-allowed' }) }} disabled={!live}
              onClick={() => live && onOpenSession(live.id)} data-testid="open-live-cockpit">
              {t('console.open_live')} {he ? '‹' : '›'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "ILT 4 Blocks", "NB 2 Pages", "Show Intro Video", "Intro Block". */
function stepTitle(t: (k: string, o?: Record<string, unknown>) => string, st: Card['steps'][number], count: number): string {
  switch (st.step_type) {
    case 'ILT_BLOCK': return t('console.card.ilt', { count });
    case 'NOTEBOOK_PAGE': return t('console.card.notebook', { count });
    case 'PAPER_NOTEBOOK_PAGE': return t('console.card.paper', { count });
    case 'WARMUP_BLOCK': return t('console.card.warmup');
    case 'INTERVENTION_SHEET': return t('console.card.sheet', { count });
    case 'VIDEO': return t(st.video_key === 'notebook_demo' ? 'console.card.video_notebook' : st.video_key?.startsWith('letter_') ? 'console.card.video_letter' : 'console.card.video_intro');
    default: return t('console.card.other');
  }
}

function StepCard({ n, card, state, day, onClick }: { n: number; card: Card; state: CardState; day: DayType; onClick?: () => void }) {
  const { t } = useTranslation();
  const first = card.steps[0]!;
  const blocks = card.steps.map((x) => x.block_number).filter((x): x is number => x !== null);
  const range = blocks.length ? (blocks.length > 1 ? `${blocks[0]}–${blocks[blocks.length - 1]}` : String(blocks[0])) : '';
  const done = card.steps.filter((x) => x.status === 'DONE' || x.status === 'SKIPPED').length;
  const sub = (() => {
    switch (first.step_type) {
      case 'ILT_BLOCK': return t(first.is_scored ? 'console.sub.ilt_scored' : 'console.sub.ilt', { range });
      case 'NOTEBOOK_PAGE': return t('console.sub.notebook', { range });
      case 'PAPER_NOTEBOOK_PAGE': return t('console.sub.paper', { range });
      case 'WARMUP_BLOCK': return t('console.sub.warmup');
      case 'INTERVENTION_SHEET': return t('console.sub.sheet', { range });
      case 'VIDEO': return t(first.video_key?.startsWith('letter_') ? 'console.sub.video_letter' : 'console.sub.video');
      default: return '';
    }
  })();
  const label = state === 'planned' ? t('console.state.planned', { day: t(`enum.session_type.${day}`) })
    : state === 'active' && card.steps.length > 1 ? `${t('console.state.active')} ${done}/${card.steps.length}`
    : t(`console.state.${state}`);
  const style: CSSProperties = { ...s.card, background: cardColour[state], ...(state === 'active' ? { boxShadow: '0 0 0 3px color-mix(in srgb, #2b6cb0 35%, transparent)' } : {}) };
  const content = (
    <>
      <span style={s.cardTitle}>{n}. {stepTitle(t, first, card.steps.length)}</span>
      <span style={s.cardSub}>{sub}</span>
      <span style={{ ...s.cardState, color: state === 'active' ? '#fefcbf' : '#fff' }}>[ {label} ]</span>
    </>
  );
  // A card without a session to open is not a button, so it keeps its full colour.
  return onClick ? (
    <button type="button" onClick={onClick} title={t('console.open_session')} style={{ ...style, cursor: 'pointer' }} data-testid="console-card" data-state={state}>
      {content}
    </button>
  ) : (
    <div style={style} data-testid="console-card" data-state={state}>{content}</div>
  );
}

/**
 * The intervention programme (Phase 5b, FR-COCK-7): the letters of the language's set with where the
 * participant stands, the target letter, and the four ways to plan its next session. One intervention
 * session is open at a time; each session trains one letter (its video, then the training sheets) or
 * checks it again two weeks later (one sheet).
 */
function InterventionPanel({ iv, participantId, onOpenSession, onPlanned }: {
  iv: Intervention;
  participantId: string;
  onOpenSession: (id: string) => void;
  onPlanned: () => void;
}) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = iv.sessions.find((x) => OPEN.has(x.status));
  // The target: the evaluator's choice, else the letter of the latest session, else the first letter not trained yet.
  const target = iv.letters.find((l) => l.code === chosen)
    ?? iv.letters.find((l) => l.code === iv.sessions[0]?.code)
    ?? iv.letters.find((l) => l.trainings === 0) ?? iv.letters[0];
  const at = target ? iv.letters.indexOf(target) : -1;
  const next = [...iv.letters.slice(at + 1), ...iv.letters.slice(0, Math.max(0, at))].find((l) => l.trainings === 0);
  const date = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(i18n.language);
  const glyph = (l: { letter: string | null; code: string }) => l.letter ?? l.code;
  const language = t(`enum.language.${iv.language_code}`);

  async function plan(letter: IvLetter, kind: 'TRAINING' | 'RETENTION') {
    setBusy(true);
    setError(null);
    try {
      await api('/sessions', {
        method: 'POST',
        body: { participant_id: participantId, session_type: 'INTERVENTION', language_code: iv.language_code, letter_canvas_id: letter.canvas_id, intervention_kind: kind },
      });
      setChosen(letter.code);
      onPlanned();
    } catch (e) {
      setError(e instanceof ApiError ? e.messageKey : 'error.500');
    } finally {
      setBusy(false);
    }
  }

  const letterState = (l: IvLetter) => (l.trainings === 0 ? t('console.letter_state.new')
    : l.retention_done ? t('console.letter_state.retained')
    : l.retention_due ? t('console.letter_state.due')
    : t('console.letter_state.waiting', { date: date(l.retention_due_on!) }));
  const free = !open && !busy && !!target;
  const actions: { key: string; title: string; sub: string; bg: string; enabled: boolean; run: () => void }[] = target ? [
    {
      key: 'retention', title: t('console.iv_retention'), bg: C.blue,
      sub: target.trainings === 0 ? t('console.iv_retention_none') : target.retention_done ? t('console.iv_retention_done')
        : target.retention_due ? t('console.iv_retention_due') : t('console.iv_retention_wait', { date: date(target.retention_due_on!) }),
      enabled: free && target.trainings > 0 && target.retention_due, run: () => void plan(target, 'RETENTION'),
    },
    {
      key: 'training', title: t('console.iv_training', { n: iv.training_sheets }), bg: C.blue,
      sub: target.trainings === 0 ? t('console.iv_training_sub', { letter: glyph(target) }) : t('console.iv_training_done'),
      enabled: free && target.trainings === 0, run: () => void plan(target, 'TRAINING'),
    },
    {
      key: 'repeat', title: t('console.iv_repeat'), bg: C.amber,
      sub: target.trainings > 0 ? t('console.iv_repeat_sub', { letter: glyph(target) }) : t('console.iv_repeat_none'),
      enabled: free && target.trainings > 0, run: () => void plan(target, 'TRAINING'),
    },
    {
      key: 'next', title: t('console.iv_next'), bg: C.green,
      sub: next ? t('console.iv_next_sub', { letter: glyph(next) }) : t('console.iv_next_none'),
      enabled: free && !!next, run: () => { if (next) void plan(next, 'TRAINING'); },
    },
  ] : [];

  return (
    <section style={{ ...s.panel, border: `1.5px solid ${C.greenLine}` }} data-testid="console-intervention">
      <h3 style={{ ...s.panelTitle, color: C.greenLine }}>{t('console.intervention')}</h3>
      {iv.letters.length === 0 ? (
        <p style={{ ...ui.muted, margin: 0 }} data-testid="iv-no-letters">{t('console.iv_no_letters', { language })}</p>
      ) : (
        <>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('console.iv_letters', { language })}</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} role="group" aria-label={t('console.target_letter')}>
            {iv.letters.map((l) => {
              const selected = l.code === target?.code;
              return (
                <button key={l.code} type="button" aria-pressed={selected} onClick={() => setChosen(l.code)} data-testid={`iv-letter-${l.code}`}
                  title={he ? l.name_he : l.name_en}
                  style={{
                    display: 'grid', justifyItems: 'center', gap: '0.15rem', minInlineSize: '5.5rem', padding: '0.4rem 0.6rem', borderRadius: 8, cursor: 'pointer', font: 'inherit',
                    border: `2px solid ${selected ? C.greenLine : 'var(--ilt-border)'}`, color: 'var(--ilt-fg)',
                    background: selected ? 'color-mix(in srgb, #2f9e5b 12%, var(--ilt-surface))' : 'var(--ilt-surface)',
                  }}>
                  <span style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1 }} lang={iv.language_code}>{glyph(l)}</span>
                  {l.trainings > 0 && <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>{t('console.letter_state.trained', { count: l.trainings })}</span>}
                  <span style={{ fontSize: '0.72rem', opacity: 0.85 }}>{letterState(l)}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }} data-testid="iv-target">
            {target ? <>{t('console.target_letter')}: <bdi lang={iv.language_code} style={{ fontSize: '1.15rem' }}>{glyph(target)}</bdi></> : t('console.target_none')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
            {actions.map((a) => (
              <button key={a.key} disabled={!a.enabled} onClick={a.run} data-testid={`iv-${a.key}`}
                // A disabled action is grey, so it never looks like an enabled one (in Dark too).
                style={{ ...s.card, background: a.enabled ? a.bg : C.slate, maxInlineSize: 'none', minBlockSize: '4.5rem', minInlineSize: 0, cursor: a.enabled ? 'pointer' : 'not-allowed', opacity: a.enabled ? 1 : 0.6 }}>
                <span style={s.cardTitle}>{a.title}</span>
                <span style={s.cardSub}>{a.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {open && <p style={{ margin: 0, fontSize: '0.85rem' }} data-testid="iv-open">{t('console.iv_open')}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('console.iv_sessions')}</div>
      {iv.sessions.length === 0 ? <p style={{ ...ui.muted, margin: 0 }}>{t('console.iv_no_sessions')}</p> : (
        <div style={s.cards}>
          {iv.sessions.map((x) => {
            const state: CardState = x.status === 'COMPLETED' ? 'done' : LIVE.has(x.status) ? 'active' : 'pending';
            const style: CSSProperties = {
              ...s.card, background: cardColour[state], minBlockSize: '6rem',
              ...(state === 'active' ? { boxShadow: '0 0 0 3px color-mix(in srgb, #2b6cb0 35%, transparent)' } : {}),
            };
            const content = (
              <>
                <span style={s.cardTitle}>{t(`enum.intervention_kind.${x.kind}`)} · <bdi lang={iv.language_code}>{glyph(x)}</bdi></span>
                <span style={s.cardSub}><bdi>{x.session_code}</bdi></span>
                <span style={s.cardSub}>{t('console.iv_session_sheets', { done: x.sheets_done, total: x.sheets_total })}</span>
                <span style={s.cardState}>[ {t(`console.state.${state}`)} ]</span>
              </>
            );
            return x.can_open ? (
              <button key={x.id} type="button" onClick={() => onOpenSession(x.id)} title={t('console.open_session')} style={{ ...style, cursor: 'pointer' }}
                data-testid="iv-session" data-state={state}>{content}</button>
            ) : <div key={x.id} style={style} data-testid="iv-session" data-state={state}>{content}</div>;
          })}
        </div>
      )}
    </section>
  );
}
