// Comparative Summary Dashboard (FR-SUM-1…4): anchor pairs across Day 1, Day 2 and Day 14, each with
// time, pen lifts, accuracy, average ILT speed, the separate component scores, the composite and
// Pass/Fail, plus [Replay]. The System Administrator sets the pass threshold in the Administrator cockpit.
// Below the boxes, a diagram of the four measures across the anchors (SummaryChart).
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { pill, ui } from './styles';
import { SummaryChart } from './SummaryChart';
import { LoadError } from './BackButton';

interface SummaryBlock {
  block_number: number;
  attempt_id: string | null;
  attempt_number?: number;
  session_code?: string;
  composite_score?: number | null;
  /** Paper anchors (Phase 5e): whether this block was entered. */
  on_paper?: boolean;
}
interface SummaryBox {
  key: string;
  session_type: string;
  block_numbers: number[];
  /** Phase 5e: tablet blocks, or the paper cohort's entered blocks (no speed, no composite). */
  source: 'TABLET' | 'PAPER';
  complete: boolean;
  blocks: SummaryBlock[];
  avg_time_ms: number | null;
  avg_pen_lifts: number | null;
  avg_accurate_letters: number | null;
  accuracy_pct: number | null;
  avg_speed_mm_s: number | null;
  speed_score: number | null;
  accuracy_score: number | null;
  pen_lift_score: number | null;
  composite_score: number | null;
  pass: boolean | null;
}
/** Phase 5d: one intervention session's sheet results. */
interface InterventionResult {
  session_id: string;
  session_code: string;
  kind: 'TRAINING' | 'RETENTION';
  code: string;
  letter: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  sheets_total: number;
  sheets_done: number;
  sheets_scored: number;
  open_marks: number;
  avg_time_ms: number | null;
  avg_pen_lifts: number | null;
  accuracy_score: number | null;
  speed_score: number | null;
  pen_lift_score: number | null;
  composite_score: number | null;
  pass: boolean | null;
}
/** Phase 5e: the old application's results for one session label. */
interface LegacyResult {
  session_label: string;
  imported_at: string;
  blocks: { block_number: number; pen_lifts: number | null; width_mm: number | null; total_time_ms: number | null; writing_time_ms: number | null; air_time_ms: number | null }[];
  means: { pen_lifts: number | null; width_mm: number | null; total_time_ms: number | null; writing_time_ms: number | null; air_time_ms: number | null };
}
interface Summary {
  participant: { id: string; study_code: string; cohort: string };
  scoring: { pass_threshold: number | null; weight_speed_pct: number; weight_accuracy_pct: number; weight_pen_lifts_pct: number };
  boxes: SummaryBox[];
  intervention: InterventionResult[];
  legacy: LegacyResult[];
}

const s: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '1rem' },
  box: { border: '1px solid var(--ilt-border)', borderRadius: 8, padding: '0.9rem', background: 'var(--ilt-surface)', display: 'grid', gap: '0.3rem', alignContent: 'start' },
  line: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.9rem', borderBlockEnd: '1px solid var(--ilt-border-soft)', paddingBlock: '0.15rem' },
};

export function SummaryScreen({ participantId, onBack, onReplay }: { participantId: string; onBack: () => void; onReplay: (attemptId: string) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Summary>(`/participants/${participantId}/summary`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [participantId]);
  useEffect(load, [load]);

  if (!data) return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('common.back')} /> : <p style={ui.muted}>{t('common.checking')}</p>;
  const nc = t('summary.not_configured');
  const np = t('summary.not_on_paper');
  const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
  const w = data.scoring;
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <button style={ui.button} onClick={onBack}>{t('common.back')}</button>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('summary.title')} · <bdi>{data.participant.study_code}</bdi></h2>
      </div>
      <p style={{ ...ui.muted, margin: 0 }} data-testid="summary-scoring">
        {t('summary.weights', { speed: w.weight_speed_pct, accuracy: w.weight_accuracy_pct, lifts: w.weight_pen_lifts_pct })} ·{' '}
        {t('summary.threshold')}: {w.pass_threshold === null ? nc : w.pass_threshold}
      </p>
      <div style={s.grid}>
        {data.boxes.map((b) => (
          <section key={b.key} style={s.box} data-testid={`summary-${b.key}`}>
            <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {t(`summary.anchor.${b.key}`)}
              {b.source === 'PAPER' && <span style={pill('off')} data-testid={`summary-${b.key}-paper`}>{t('summary.paper')}</span>}
            </h3>
            <div style={{ ...ui.muted, fontSize: '0.8rem' }}>{t('summary.blocks', { a: b.block_numbers[0], b: b.block_numbers[1] })}</div>
            {/* Tablet anchors have attempts; paper anchors have entered blocks (Phase 5e). */}
            {b.blocks.every((x) => x.attempt_id === null && !x.on_paper) ? (
              <p style={ui.muted}>{t('summary.no_data')}</p>
            ) : (
              <>
                {!b.complete && <p style={{ ...ui.muted, color: 'var(--ilt-warn)', margin: 0 }}>{t('summary.incomplete')}</p>}
                <div style={s.line}><span>{t('summary.avg_time')}</span><bdi>{b.avg_time_ms === null ? '—' : `${(b.avg_time_ms / 1000).toFixed(1)} ${t('units.seconds')}`}</bdi></div>
                <div style={s.line}><span>{t('summary.pen_lifts')}</span><bdi>{fmt(b.avg_pen_lifts, 0)}</bdi></div>
                <div style={s.line}><span>{t('summary.accurate_avg')}</span><bdi>{b.avg_accurate_letters === null ? '—' : `${fmt(b.avg_accurate_letters)} / 15`}</bdi></div>
                <div style={s.line}><span>{t('summary.accuracy_pct')}</span><bdi>{fmt(b.accuracy_pct)}</bdi></div>
                <div style={s.line}><span>{t('summary.avg_speed')}</span><bdi>{b.source === 'PAPER' ? np : b.avg_speed_mm_s === null ? '—' : `${b.avg_speed_mm_s.toFixed(2)} ${t('units.mm_s')}`}</bdi></div>
                <div style={s.line}><span>{t('summary.speed_score')}</span><bdi>{b.source === 'PAPER' ? np : b.speed_score === null ? nc : fmt(b.speed_score)}</bdi></div>
                <div style={s.line}><span>{t('summary.accuracy_score')}</span><bdi>{b.source === 'PAPER' ? np : fmt(b.accuracy_score)}</bdi></div>
                <div style={s.line}><span>{t('summary.pen_lift_score')}</span><bdi>{fmt(b.pen_lift_score)}</bdi></div>
                <div style={{ ...s.line, fontWeight: 600 }}><span>{t('summary.composite')}</span><bdi>{b.source === 'PAPER' ? np : b.composite_score === null ? nc : fmt(b.composite_score)}</bdi></div>
                <div style={{ ...s.line, borderBlockEnd: 'none' }}>
                  <span>{t('summary.pass_fail')}</span>
                  {b.source === 'PAPER' ? <span style={ui.muted}>{np}</span>
                    : b.pass === null ? <span style={ui.muted}>{nc}</span> : <span style={pill(b.pass ? 'ok' : 'warn')}>{t(b.pass ? 'summary.pass' : 'summary.fail')}</span>}
                </div>
              </>
            )}
            {b.source === 'PAPER' ? (
              <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('summary.paper_note')}</p>
            ) : <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {b.blocks.map((x) => (
                <button key={x.block_number} style={ui.button} disabled={!x.attempt_id} onClick={() => x.attempt_id && onReplay(x.attempt_id)}>
                  {t('summary.replay_block', { n: x.block_number })}
                </button>
              ))}
            </div>}
          </section>
        ))}
      </div>
      <SummaryChart boxes={data.boxes} />
      <InterventionSummary results={data.intervention} />
      {data.legacy.length > 0 && <LegacySummary results={data.legacy} />}
    </div>
  );
}

/**
 * The old application's results (Phase 5e, FR-LEG-1): one table per session label, its blocks and
 * means, as imported. No scores, and not compared with the anchors: the old measures differ.
 */
function LegacySummary({ results }: { results: LegacyResult[] }) {
  const { t, i18n } = useTranslation();
  const f = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
  const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} ${t('units.seconds')}`);
  const cell: CSSProperties = { ...ui.cell, fontSize: '0.88rem' };
  const cols = ['block', 'pen_lifts', 'width', 'total', 'writing', 'air'] as const;
  return (
    <section style={{ ...ui.card, display: 'grid', gap: '0.6rem' }} data-testid="summary-legacy">
      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{t('summary.legacy.title')}</h3>
      <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('summary.legacy.help')}</p>
      {results.map((r) => (
        <div key={r.session_label} style={{ display: 'grid', gap: '0.3rem' }} data-testid={`legacy-${r.session_label}`}>
          <strong>
            <bdi>{r.session_label}</bdi>{' '}
            <span style={{ ...ui.muted, fontWeight: 400 }}>· {t('summary.legacy.imported', { date: new Date(r.imported_at).toLocaleDateString(i18n.language) })}</span>
          </strong>
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table}>
              <thead><tr>{cols.map((c) => <th key={c} style={{ ...cell, textAlign: 'start' }}>{t(`summary.legacy.col.${c}`)}</th>)}</tr></thead>
              <tbody>
                {r.blocks.map((b) => (
                  <tr key={b.block_number}>
                    <td style={cell}>{b.block_number}</td>
                    <td style={cell}><bdi>{b.pen_lifts ?? '—'}</bdi></td>
                    <td style={cell}><bdi>{f(b.width_mm)}</bdi></td>
                    <td style={cell}><bdi>{sec(b.total_time_ms)}</bdi></td>
                    <td style={cell}><bdi>{sec(b.writing_time_ms)}</bdi></td>
                    <td style={cell}><bdi>{sec(b.air_time_ms)}</bdi></td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td style={cell}>{t('summary.legacy.mean')}</td>
                  <td style={cell}><bdi>{f(r.means.pen_lifts)}</bdi></td>
                  <td style={cell}><bdi>{f(r.means.width_mm)}</bdi></td>
                  <td style={cell}><bdi>{sec(r.means.total_time_ms)}</bdi></td>
                  <td style={cell}><bdi>{sec(r.means.writing_time_ms)}</bdi></td>
                  <td style={cell}><bdi>{sec(r.means.air_time_ms)}</bdi></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The intervention programme's results (Phase 5d, FR-SCORE-16): one row per session, grouped by
 * letter (oldest letter first), with the means over its scored sheets next to the composite.
 */
function InterventionSummary({ results }: { results: InterventionResult[] }) {
  const { t, i18n } = useTranslation();
  const nc = t('summary.not_configured');
  const f = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
  const letters = [...new Set([...results].reverse().map((r) => r.code))];
  const cell: CSSProperties = { ...ui.cell, fontSize: '0.88rem' };
  return (
    <section style={{ ...ui.card, display: 'grid', gap: '0.6rem' }} data-testid="summary-intervention">
      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{t('summary.iv.title')}</h3>
      {results.length === 0 ? <p style={{ ...ui.muted, margin: 0 }}>{t('summary.iv.none')}</p> : (
        <>
          <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('summary.iv.help')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table}>
              <thead>
                <tr>
                  {['letter', 'session', 'sheets', 'time', 'pen_lifts', 'accuracy', 'pen_lift_score', 'speed_score', 'composite', 'pass'].map((k) => (
                    <th key={k} style={{ ...cell, textAlign: 'start' }}>{t(`summary.iv.col.${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {letters.flatMap((code) => results.filter((r) => r.code === code).map((r) => (
                  <tr key={r.session_id} data-testid={`iv-result-${r.session_code}`}>
                    <td style={{ ...cell, fontSize: '1.2rem', fontWeight: 700 }}>{r.letter ?? r.code}</td>
                    <td style={cell}>
                      {t(`enum.intervention_kind.${r.kind}`)} · <bdi>{r.session_code}</bdi>
                      {/* The day it was completed; an unfinished session shows the day it was planned and its status. */}
                      <div style={ui.muted}>
                        {new Date(r.completed_at ?? r.created_at).toLocaleDateString(i18n.language)}
                        {r.status !== 'COMPLETED' && ` · ${t(`enum.session_status.${r.status}`)}`}
                      </div>
                    </td>
                    <td style={cell}>
                      {t('summary.iv.sheets', { scored: r.sheets_scored, total: r.sheets_total })}
                      {r.open_marks > 0 && <div style={{ color: 'var(--ilt-warn)' }}>{t('marks.score_pending', { n: r.open_marks })}</div>}
                    </td>
                    <td style={cell}><bdi>{r.avg_time_ms === null ? '—' : `${(r.avg_time_ms / 1000).toFixed(1)} ${t('units.seconds')}`}</bdi></td>
                    <td style={cell}><bdi>{f(r.avg_pen_lifts, 0)}</bdi></td>
                    <td style={cell}><bdi>{f(r.accuracy_score)}</bdi></td>
                    <td style={cell}><bdi>{f(r.pen_lift_score)}</bdi></td>
                    <td style={cell}><bdi>{r.sheets_scored && r.speed_score === null ? nc : f(r.speed_score)}</bdi></td>
                    <td style={{ ...cell, fontWeight: 600 }}><bdi>{r.sheets_scored && r.composite_score === null ? nc : f(r.composite_score)}</bdi></td>
                    <td style={cell}>{r.pass === null ? <span style={ui.muted}>{r.sheets_scored ? nc : '—'}</span> : <span style={pill(r.pass ? 'ok' : 'warn')}>{t(r.pass ? 'summary.pass' : 'summary.fail')}</span>}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
