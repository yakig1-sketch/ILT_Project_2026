// Intervention sheet marks (Phase 5c, FRS FR-COCK-5/6): the five letters of each row with the
// system's suggestion filled in; the evaluator changes only what they disagree with. While the child
// writes, each row appears as soon as it is finished (suggestions computed here with the scoring
// engine); the evaluator's changes are kept and saved once the sheet is stored, where the marks
// stay editable.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_SCORING_SETTINGS, suggestSheetMarks, type SheetMark } from '@ilt/ilt-metrics';
import { ApiError, api } from './api';
import type { LiveBlock } from './cockpit-link';
import { tone, ui } from './styles';

type RowType = 'TRACE_MODEL' | 'START_DOT' | 'FREEHAND';
const ROWS: RowType[] = ['TRACE_MODEL', 'START_DOT', 'FREEHAND'];
const LIVE_EVERY_MS = 1000;

export interface MarkView {
  box_id: number;
  row_type: RowType;
  letter: string;
  auto_error: boolean | null;
  start_point_ok: boolean | null;
  evaluator_error: boolean | null;
  final_error: boolean | null;
  decided_by: 'SYSTEM' | 'EVALUATOR' | null;
  decided_by_name?: string | null;
  similarity_hint: number | null;
  /** Row 1: pen lifts inside the letter and how many it may have. */
  internal_pen_lifts?: number | null;
  lifts_allowed?: number | null;
}
interface StoredMarks {
  block_attempt_id: string;
  step_index: number;
  attempt_number: number;
  marks: MarkView[];
}
type Overrides = Record<number, boolean | null>;

const s = {
  card: { ...ui.card, display: 'grid', gap: '0.6rem' },
  row: { display: 'grid', gap: '0.35rem' },
  cells: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(5.5rem, 1fr))', gap: '0.4rem' },
  cell: { border: '1.5px solid var(--ilt-border)', borderRadius: 8, padding: '0.35rem', display: 'grid', gap: '0.25rem', justifyItems: 'center', textAlign: 'center' },
  glyph: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1 },
  pair: { display: 'flex', gap: '0.3rem' },
  mark: { minInlineSize: '2.2rem', paddingBlock: '0.15rem', borderRadius: 6, border: '1.5px solid var(--ilt-border)', background: 'var(--ilt-surface)', color: 'var(--ilt-fg)', font: 'inherit', fontWeight: 700, cursor: 'pointer' },
  small: { fontSize: '0.72rem', opacity: 0.85 },
} satisfies Record<string, CSSProperties>;

const keyOf = (step: number, attempt: number) => `${step}:${attempt}`;

/** The system's suggestion with the evaluator's (still unsaved) changes, as the stored view shows it. */
function liveView(m: SheetMark, o: Overrides): MarkView {
  const evaluator = m.box_id in o ? o[m.box_id]! : null;
  const final = evaluator ?? m.auto_error;
  return {
    box_id: m.box_id, row_type: m.row_type, letter: m.letter, auto_error: m.auto_error, start_point_ok: m.start_point_ok,
    evaluator_error: evaluator, final_error: final, decided_by: evaluator !== null ? 'EVALUATOR' : m.auto_error !== null ? 'SYSTEM' : null,
    similarity_hint: m.similarity_hint, internal_pen_lifts: m.internal_pen_lifts, lifts_allowed: m.lifts_allowed,
  };
}

export function SheetMarks({ block, reviewAttemptId, similarity, language, readOnly, stepLabel, onChanged }: {
  /** The block running now (live marks when it is a letter sheet). */
  block: LiveBlock | null;
  /** A stored sheet attempt to review (the last stored sheet, or one chosen in the step list). */
  reviewAttemptId: string | null;
  similarity: boolean;
  language: string;
  readOnly: boolean;
  stepLabel: (stepIndex: number) => string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const overrides = useRef(new Map<string, Overrides>());
  const [, setVersion] = useState(0);
  const [stored, setStored] = useState<StoredMarks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef<{ key: string; at: number; marks: SheetMark[] }>({ key: '', at: 0, marks: [] });
  const message = (e: unknown) => (e instanceof ApiError ? e.messageKey : 'error.500');

  // A stored sheet: its marks, after saving any change the evaluator made while the child wrote.
  useEffect(() => {
    if (!reviewAttemptId) {
      setStored(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        let m = await api<StoredMarks>(`/block-attempts/${reviewAttemptId}/intervention-marks`);
        const key = keyOf(m.step_index, m.attempt_number);
        const pending = overrides.current.get(key);
        if (pending && Object.keys(pending).length && m.marks.length) {
          m = await api<StoredMarks>(`/block-attempts/${reviewAttemptId}/intervention-marks`, {
            method: 'PUT', body: { marks: Object.entries(pending).map(([box, err]) => ({ box_id: Number(box), error: err })) },
          });
          overrides.current.delete(key);
          onChanged();
        }
        if (live) setStored(m);
      } catch (e) {
        if (live) setError(message(e));
      }
    })();
    return () => {
      live = false;
    };
    // onChanged is a stable reload callback of the session screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewAttemptId]);

  const liveSheet = block?.step_type === 'INTERVENTION_SHEET' && block.profile ? block : null;
  let liveMarks: MarkView[] = [];
  let rowsDone = new Set<number>();
  if (liveSheet) {
    const key = keyOf(liveSheet.step_index, liveSheet.attempt_number);
    const c = cache.current;
    if (c.key !== key || Date.now() - c.at >= LIVE_EVERY_MS) {
      let marks: SheetMark[] = [];
      try {
        marks = liveSheet.samples.length ? suggestSheetMarks(liveSheet.samples, liveSheet.canvas, liveSheet.profile!, DEFAULT_SCORING_SETTINGS, { similarity }) : [];
      } catch {
        marks = [];
      }
      cache.current = { key, at: Date.now(), marks };
    }
    // A row is finished once the child has moved on to a later row: the tablet's active box is there,
    // or a later row already has writing (or the sheet ends).
    const rowOf = new Map(liveSheet.canvas.boxes.map((b) => [b.id, b.row]));
    const writtenRow = Math.max(-1, ...cache.current.marks.filter((m) => m.status === 'WRITTEN').map((m) => rowOf.get(m.box_id) ?? -1));
    const activeRow = Math.max(writtenRow, liveSheet.activeBoxId === null ? -1 : rowOf.get(liveSheet.activeBoxId) ?? -1);
    rowsDone = new Set(liveSheet.canvas.boxes.filter((b) => liveSheet.completing || b.row < activeRow).map((b) => b.row));
    const o = overrides.current.get(key) ?? {};
    liveMarks = cache.current.marks.filter((m) => rowsDone.has(rowOf.get(m.box_id) ?? -1)).map((m) => liveView(m, o));
  }

  async function set(live: boolean, boxId: number, value: boolean | null) {
    setError(null);
    if (live && liveSheet) {
      const key = keyOf(liveSheet.step_index, liveSheet.attempt_number);
      overrides.current.set(key, { ...(overrides.current.get(key) ?? {}), [boxId]: value });
      setVersion((v) => v + 1);
      return;
    }
    if (!stored) return;
    try {
      setStored(await api<StoredMarks>(`/block-attempts/${stored.block_attempt_id}/intervention-marks`, { method: 'PUT', body: { marks: [{ box_id: boxId, error: value }] } }));
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  }

  // The sheet being written, and a stored sheet chosen for review (also while another sheet runs).
  const views: { live: boolean; marks: MarkView[]; title: string; editable: boolean }[] = [];
  if (liveSheet) views.push({ live: true, marks: liveMarks, title: t('marks.live', { step: stepLabel(liveSheet.step_index) }), editable: true });
  const storedIsLive = !!liveSheet && stored?.step_index === liveSheet.step_index && stored.attempt_number === liveSheet.attempt_number;
  if (stored && stored.marks.length && !storedIsLive) {
    views.push({ live: false, marks: stored.marks, title: t('marks.stored', { step: stepLabel(stored.step_index), n: stored.attempt_number }), editable: !readOnly });
  }
  if (views.length === 0) return error ? <p role="alert" style={ui.error}>{t(error)}</p> : null;
  const dir = language === 'he' ? 'rtl' : 'ltr';

  return (
    <>
      {views.map((view) => {
        const count = (v: boolean | null) => view.marks.filter((m) => m.final_error === v).length;
        return (
          <section key={view.live ? 'live' : 'stored'} style={s.card} data-testid="sheet-marks" data-kind={view.live ? 'live' : 'stored'} aria-label={view.title}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{view.title}</h2>
              <span style={ui.muted} data-testid="marks-summary">
                {t('marks.summary', { correct: count(false), error: count(true), open: count(null) })}
              </span>
            </div>
            <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('marks.help')}</p>
            {ROWS.map((row, i) => {
              const marks = view.marks.filter((m) => m.row_type === row);
              return (
                <div key={row} style={s.row} data-testid={`marks-row-${i + 1}`}>
                  <strong style={{ fontSize: '0.9rem' }}>{t(`marks.row.${row}`)}</strong>
                  {marks.length === 0 ? (
                    <span style={{ ...ui.muted, fontSize: '0.85rem' }}>{t(view.live ? 'marks.row_writing' : 'marks.row_none')}</span>
                  ) : (
                    // The cells in fill order, laid out in the session language's direction, so they sit as on the sheet.
                    <div style={{ ...s.cells, direction: dir }}>
                      {marks.map((m) => <MarkCell key={m.box_id} m={m} language={language} editable={view.editable} onSet={(v) => void set(view.live, m.box_id, v)} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
    </>
  );
}

function MarkCell({ m, language, editable, onSet }: { m: MarkView; language: string; editable: boolean; onSet: (value: boolean | null) => void }) {
  const { t } = useTranslation();
  const border = m.final_error === null ? 'var(--ilt-border)' : m.final_error ? tone.bad : tone.ok;
  // Pressing the evaluator's own choice again clears it (back to the system's suggestion).
  const press = (value: boolean) => onSet(m.evaluator_error === value ? null : value);
  const button = (value: boolean) => {
    const on = m.final_error === value;
    const colour = value ? tone.bad : tone.ok;
    return (
      <button type="button" disabled={!editable} aria-pressed={on} onClick={() => press(value)} data-testid={`mark-${m.box_id}-${value ? 'error' : 'ok'}`}
        title={t(value ? 'marks.set_error' : 'marks.set_ok')}
        style={{ ...s.mark, ...(on ? { background: colour, borderColor: colour, color: '#fff' } : {}), ...(editable ? {} : { cursor: 'default' }) }}>
        {value ? '✗' : '✓'}
      </button>
    );
  };
  const source = m.decided_by === 'EVALUATOR' ? t('marks.by_evaluator') : m.decided_by === 'SYSTEM' ? t('marks.by_system') : t('marks.to_set');
  return (
    <div style={{ ...s.cell, borderColor: border, borderStyle: m.final_error === null ? 'dashed' : 'solid' }} data-testid={`mark-${m.box_id}`} data-final={String(m.final_error)}>
      <span style={s.glyph} lang={language}>{m.letter}</span>
      <div style={{ ...s.pair, direction: 'ltr' }}>{button(false)}{button(true)}</div>
      <span style={s.small} title={m.decided_by_name ?? undefined}>{source}</span>
      {m.row_type === 'TRACE_MODEL' && m.internal_pen_lifts != null && m.internal_pen_lifts > (m.lifts_allowed ?? 0) && (
        <span style={{ ...s.small, color: tone.bad }}>{t('marks.lifts', { n: m.internal_pen_lifts, allowed: m.lifts_allowed ?? 0 })}</span>
      )}
      {m.row_type === 'START_DOT' && m.start_point_ok !== null && (
        <span style={{ ...s.small, color: m.start_point_ok ? tone.ok : tone.bad }}>{t(m.start_point_ok ? 'marks.start_ok' : 'marks.start_off')}</span>
      )}
      {m.row_type === 'FREEHAND' && m.similarity_hint !== null && (
        <span style={s.small} title={t('marks.hint_title')} data-testid={`hint-${m.box_id}`}>{t('marks.hint', { n: Math.round(m.similarity_hint) })}</span>
      )}
    </div>
  );
}
