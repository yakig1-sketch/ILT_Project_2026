// Evaluator Control & Dispatch Console (FRS v3.3 Figure 2): one participant's protocol at a glance.
// Day 1, Day 2, Day 14 and the intervention programme as step cards (completed, active, to
// dispatch), the Comparative Summary, and the live cockpit. A card opens its session in the live
// cockpit, where its steps are dispatched to the tablet.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PROTOCOLS } from '@ilt/template-schemas';
import { ApiError, api } from './api';
import { ui } from './styles';
import { BackButton } from './BackButton';

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
interface Protocol {
  participant: { id: string; study_code: string; grade_level: string | null; domain: { code: string; name_he: string; name_en: string } };
  sessions: Partial<Record<DayType | 'INTERVENTION', Session>>;
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
const GROUPED = new Set(['ILT_BLOCK', 'NOTEBOOK_PAGE', 'PAPER_NOTEBOOK_PAGE']);

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

  if (!p) return error ? <p role="alert" style={ui.error}>{t(error)}</p> : null;
  const he = i18n.language === 'he';
  const live = (['DAY_1', 'DAY_2', 'DAY_14'] as const).map((d) => p.sessions[d]).find((x) => x && LIVE.has(x.status) && x.can_open)
    ?? (['DAY_1', 'DAY_2', 'DAY_14'] as const).map((d) => p.sessions[d]).find((x) => x && x.status === 'PLANNED' && x.can_open);
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
              <bdi>{session.session_code}</bdi> · {t(`enum.session_status.${session.status}`)} · {session.language_code === 'he' ? t('common.hebrew') : t('common.english')}
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
            <section style={{ ...s.panel, border: `1.5px solid ${C.greenLine}`, opacity: 0.7 }} data-testid="console-intervention" aria-disabled>
              <h3 style={{ ...s.panelTitle, color: C.greenLine }}>{t('console.intervention')}</h3>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t('console.target_letter')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                {[['console.iv_retention', 'console.iv_retention_sub', C.blue], ['console.iv_training', 'console.iv_training_sub', C.blue],
                  ['console.iv_repeat', 'console.iv_repeat_sub', C.amber], ['console.iv_next', 'console.iv_next_sub', C.green]].map(([k, sub, bg]) => (
                  <button key={k} disabled style={{ ...s.card, background: bg, maxInlineSize: 'none', minBlockSize: '4.5rem', minInlineSize: 0, cursor: 'not-allowed' }}>
                    <span style={s.cardTitle}>{t(k!)}</span>
                    <span style={s.cardSub}>{t(sub!)}</span>
                  </button>
                ))}
              </div>
              <p style={{ ...ui.muted, margin: 0 }}>{t('console.intervention_later')}</p>
            </section>
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
    case 'VIDEO': return t(st.video_key === 'notebook_demo' ? 'console.card.video_notebook' : 'console.card.video_intro');
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
      case 'VIDEO': return t('console.sub.video');
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
