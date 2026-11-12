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
}
interface SummaryBox {
  key: string;
  session_type: string;
  block_numbers: number[];
  complete: boolean;
  blocks: SummaryBlock[];
  avg_time_ms: number | null;
  avg_pen_lifts: number | null;
  accuracy_pct: number | null;
  avg_speed_mm_s: number | null;
  speed_score: number | null;
  accuracy_score: number | null;
  pen_lift_score: number | null;
  composite_score: number | null;
  pass: boolean | null;
}
interface Summary {
  participant: { id: string; study_code: string };
  scoring: { pass_threshold: number | null; weight_speed_pct: number; weight_accuracy_pct: number; weight_pen_lifts_pct: number };
  boxes: SummaryBox[];
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
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t(`summary.anchor.${b.key}`)}</h3>
            <div style={{ ...ui.muted, fontSize: '0.8rem' }}>{t('summary.blocks', { a: b.block_numbers[0], b: b.block_numbers[1] })}</div>
            {b.blocks.every((x) => x.attempt_id === null) ? (
              <p style={ui.muted}>{t('summary.no_data')}</p>
            ) : (
              <>
                {!b.complete && <p style={{ ...ui.muted, color: 'var(--ilt-warn)', margin: 0 }}>{t('summary.incomplete')}</p>}
                <div style={s.line}><span>{t('summary.avg_time')}</span><bdi>{b.avg_time_ms === null ? '—' : `${(b.avg_time_ms / 1000).toFixed(1)} ${t('units.seconds')}`}</bdi></div>
                <div style={s.line}><span>{t('summary.pen_lifts')}</span><bdi>{fmt(b.avg_pen_lifts, 0)}</bdi></div>
                <div style={s.line}><span>{t('summary.accuracy_pct')}</span><bdi>{fmt(b.accuracy_pct)}</bdi></div>
                <div style={s.line}><span>{t('summary.avg_speed')}</span><bdi>{b.avg_speed_mm_s === null ? '—' : `${b.avg_speed_mm_s.toFixed(2)} ${t('units.mm_s')}`}</bdi></div>
                <div style={s.line}><span>{t('summary.speed_score')}</span><bdi>{b.speed_score === null ? nc : fmt(b.speed_score)}</bdi></div>
                <div style={s.line}><span>{t('summary.accuracy_score')}</span><bdi>{fmt(b.accuracy_score)}</bdi></div>
                <div style={s.line}><span>{t('summary.pen_lift_score')}</span><bdi>{fmt(b.pen_lift_score)}</bdi></div>
                <div style={{ ...s.line, fontWeight: 600 }}><span>{t('summary.composite')}</span><bdi>{b.composite_score === null ? nc : fmt(b.composite_score)}</bdi></div>
                <div style={{ ...s.line, borderBlockEnd: 'none' }}>
                  <span>{t('summary.pass_fail')}</span>
                  {b.pass === null ? <span style={ui.muted}>{nc}</span> : <span style={pill(b.pass ? 'ok' : 'warn')}>{t(b.pass ? 'summary.pass' : 'summary.fail')}</span>}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {b.blocks.map((x) => (
                <button key={x.block_number} style={ui.button} disabled={!x.attempt_id} onClick={() => x.attempt_id && onReplay(x.attempt_id)}>
                  {t('summary.replay_block', { n: x.block_number })}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <SummaryChart boxes={data.boxes} />
    </div>
  );
}
