// Kinematics of one research block attempt (Phase 4b; FRS FR-AN-1; DDD §8.9): speed, jerk and pressure
// over the block's time, the block summary, and the measures per letter and per stroke. Computed by the
// analytics service from the research views.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BackButton, ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { KinematicsChart, type StrokeSeries } from './KinematicsChart';
import { num } from './labels';

export interface KinSummary {
  strokes: number;
  measured_strokes: number;
  writing_time_ms: number | null;
  path_length_mm: number | null;
  mean_speed: number | null;
  peak_speed: number | null;
  velocity_peaks_per_stroke: number | null;
  mean_jerk: number | null;
  normalized_jerk: number | null;
  mean_pressure: number | null;
}
interface StrokeRow {
  index: number; box_id: number | null; start_ms: number; duration_ms: number; samples: number; measured: boolean;
  path_length_mm: number | null; mean_speed: number | null; peak_speed: number | null; velocity_peaks: number | null;
  mean_jerk: number | null; normalized_jerk: number | null; mean_pressure: number | null;
}
interface Data {
  attempt: { id: string; session_id: string; session_code: string; study_code: string; step_index: number; label_key: string; block_number: number | null; canvas_code: string | null; attempt_number: number; status: string };
  summary: KinSummary;
  letters: (KinSummary & { box_id: number | null; position: number | null })[];
  strokes: StrokeRow[];
  series: { index: number; box_id: number | null; t_ms: number[]; speed: number[]; jerk: number[]; pressure: number[] }[];
}

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h: { margin: 0, fontSize: '1.1rem' },
  dl: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.5rem 1rem', margin: 0 },
  dt: { color: 'var(--ilt-muted)', fontSize: '0.85rem' },
  dd: { margin: 0, fontVariantNumeric: 'tabular-nums' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  readout: { minBlockSize: '1.5rem', fontVariantNumeric: 'tabular-nums', color: 'var(--ilt-muted)' },
} satisfies Record<string, CSSProperties>;

/** The value at the given percentile (0..1) of all values: the top of a chart's scale, so a few spikes do not flatten it. */
const percentile = (values: number[], q: number) => {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 1;
};

/** The measure columns shared by the block summary, the session table and the letter table. */
export function KinCells({ k, style }: { k: KinSummary; style: CSSProperties }) {
  return (
    <>
      <td style={style}>{k.strokes}</td>
      <td style={style}>{k.writing_time_ms == null ? '—' : (k.writing_time_ms / 1000).toFixed(2)}</td>
      <td style={style}>{num(k.path_length_mm)}</td>
      <td style={style}>{num(k.mean_speed)}</td>
      <td style={style}>{num(k.peak_speed)}</td>
      <td style={style}>{num(k.velocity_peaks_per_stroke, 2)}</td>
      <td style={style}>{num(k.normalized_jerk)}</td>
      <td style={style}>{num(k.mean_pressure, 2)}</td>
    </>
  );
}
export const KIN_COLUMNS = ['strokes', 'writing_time', 'path', 'mean_speed', 'peak_speed', 'peaks_per_stroke', 'normalized_jerk', 'pressure'] as const;

export function KinematicsScreen({ attemptId, onBack }: { attemptId: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [letter, setLetter] = useState<string>('');
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const int = useMemo(() => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }), [i18n.language]);

  useEffect(() => {
    api<Data>(`/research/attempts/${attemptId}/kinematics`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [attemptId]);

  const view = useMemo(() => {
    if (!data) return null;
    const pick = (k: 'speed' | 'jerk' | 'pressure'): StrokeSeries[] => data.series.map((x) => ({ index: x.index, box_id: x.box_id, t_ms: x.t_ms, values: x[k] }));
    const last = data.strokes[data.strokes.length - 1];
    return {
      speed: pick('speed'), jerk: pick('jerk'), pressure: pick('pressure'),
      duration: last ? last.start_ms + last.duration_ms : 0,
      speedMax: percentile(data.series.flatMap((x) => x.speed), 0.995) * 1.05,
      jerkMax: percentile(data.series.flatMap((x) => x.jerk), 0.99) * 1.05,
    };
  }, [data]);

  const back = <BackButton onClick={onBack} label={t('analyst.back_session')} />;
  if (!data || !view) return <div style={{ display: 'grid', gap: '1rem' }}><div>{back}</div>{error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>{t('common.checking')}</p>}</div>;

  const a = data.attempt;
  const letterName = (box: number | null, position: number | null) => (box == null ? t('analyst.kin.outside') : t('analyst.kin.letter', { n: position, box }));
  const selected = data.letters.find((l) => String(l.box_id) === letter);
  const bands: [number, number][] = selected ? data.strokes.filter((x) => String(x.box_id) === letter).map((x) => [x.start_ms, x.start_ms + x.duration_ms]) : [];

  // The readout: the values at the crosshair, from the stroke under it.
  let readout = '';
  if (hoverMs != null) {
    const ser = data.series.find((x) => x.t_ms.length && hoverMs >= x.t_ms[0]! && hoverMs <= x.t_ms[x.t_ms.length - 1]!);
    // Isolated left to right, so "4.04 s" keeps its order in a Hebrew line.
    const time = String.fromCharCode(0x2066) + (hoverMs / 1000).toFixed(2) + ' s' + String.fromCharCode(0x2069);
    if (ser) {
      const i = Math.min(ser.t_ms.length - 1, Math.max(0, Math.round((hoverMs - ser.t_ms[0]!) / 4)));
      const l = data.letters.find((x) => x.box_id === ser.box_id);
      readout = t('analyst.kin.readout', {
        time, stroke: ser.index, letter: letterName(ser.box_id, l?.position ?? null),
        speed: ser.speed[i]!.toFixed(1), jerk: int.format(ser.jerk[i]!), pressure: ser.pressure[i]!.toFixed(2),
      });
    } else {
      readout = t('analyst.kin.readout_lifted', { time });
    }
  }
  const sm = data.summary;
  const item = (title: string, value: React.ReactNode) => <div><dt style={s.dt}>{title}</dt><dd style={s.dd}>{value}</dd></div>;
  const head = (cols: readonly string[]) => cols.map((k) => <th key={k} style={{ ...ui.cell, ...s.num }}>{t(`analyst.kin.${k}`)}</th>);

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="kinematics">
      <div>{back}</div>
      <h2 style={{ margin: 0, fontSize: '1.3rem' }}>
        {t('analyst.kin.title')}: <bdi dir="ltr">{a.session_code}</bdi> · {t(a.label_key, { n: a.block_number ?? '' })} · {t('analyst.kin.attempt_n', { n: a.attempt_number })}
        {a.canvas_code && <> · <bdi dir="ltr">{a.canvas_code}</bdi></>}
      </h2>
      <p style={{ ...ui.muted, margin: 0, maxInlineSize: '60rem' }}>{t('analyst.kin.intro')}</p>

      <section style={s.section} aria-labelledby="kin-summary-h">
        <h3 id="kin-summary-h" style={s.h}>{t('analyst.kin.summary')}</h3>
        <dl style={s.dl} data-testid="kin-summary">
          {item(t('analyst.kin.strokes'), t('analyst.kin.strokes_value', { n: sm.strokes, measured: sm.measured_strokes }))}
          {item(t('analyst.kin.writing_time'), sm.writing_time_ms == null ? '—' : (sm.writing_time_ms / 1000).toFixed(2))}
          {item(t('analyst.kin.path'), num(sm.path_length_mm))}
          {item(t('analyst.kin.mean_speed'), num(sm.mean_speed))}
          {item(t('analyst.kin.peak_speed'), num(sm.peak_speed))}
          {item(t('analyst.kin.peaks_per_stroke'), num(sm.velocity_peaks_per_stroke, 2))}
          {item(t('analyst.kin.mean_jerk_unit'), sm.mean_jerk == null ? '—' : int.format(sm.mean_jerk))}
          {item(t('analyst.kin.normalized_jerk'), num(sm.normalized_jerk))}
          {item(t('analyst.kin.pressure'), num(sm.mean_pressure, 2))}
        </dl>
      </section>

      <section style={s.section} aria-labelledby="kin-charts-h">
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <h3 id="kin-charts-h" style={s.h}>{t('analyst.kin.charts')}</h3>
          <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
            {t('analyst.kin.highlight')}
            <select value={letter} onChange={(e) => setLetter(e.target.value)} data-testid="kin-letter">
              <option value="">{t('analyst.kin.no_highlight')}</option>
              {data.letters.filter((l) => l.box_id != null).map((l) => <option key={l.box_id} value={String(l.box_id)}>{letterName(l.box_id, l.position)}</option>)}
            </select>
          </label>
        </div>
        <div style={s.readout} aria-live="polite" data-testid="kin-readout">{readout || t('analyst.kin.hover_hint')}</div>
        {data.series.length === 0 ? (
          <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.kin.no_series')}</p>
        ) : (
          <>
            <KinematicsChart testId="chart-speed" title={t('analyst.kin.speed')} unit={t('analyst.kin.unit_speed')} strokes={view.speed} durationMs={view.duration} yMax={view.speedMax}
              format={(v) => int.format(v)} bands={bands} hoverMs={hoverMs} onHover={setHoverMs} />
            <KinematicsChart testId="chart-jerk" title={t('analyst.kin.jerk')} unit={t('analyst.kin.unit_jerk')} strokes={view.jerk} durationMs={view.duration} yMax={view.jerkMax}
              format={(v) => int.format(v)} bands={bands} hoverMs={hoverMs} onHover={setHoverMs} />
            <KinematicsChart testId="chart-pressure" title={t('analyst.kin.pressure_chart')} unit="0–1" strokes={view.pressure} durationMs={view.duration} yMax={1}
              format={(v) => v.toFixed(2)} bands={bands} hoverMs={hoverMs} onHover={setHoverMs} />
            <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('analyst.kin.chart_note')}</p>
          </>
        )}
      </section>

      <section style={s.section} aria-labelledby="kin-letters-h">
        <h3 id="kin-letters-h" style={s.h}>{t('analyst.kin.letters')}</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="kin-letters">
            <thead><tr><th style={ui.cell}>{t('analyst.kin.letter_col')}</th>{head(KIN_COLUMNS)}</tr></thead>
            <tbody>
              {data.letters.map((l) => (
                <tr key={String(l.box_id)} onClick={() => l.box_id != null && setLetter(String(l.box_id))}
                  style={{ cursor: l.box_id != null ? 'pointer' : undefined, background: String(l.box_id) === letter ? 'var(--ilt-select)' : undefined }}>
                  <td style={ui.cell}>{letterName(l.box_id, l.position)}</td>
                  <KinCells k={l} style={{ ...ui.cell, ...s.num }} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details style={s.section}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('analyst.kin.stroke_list', { n: data.strokes.length })}</summary>
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="kin-strokes">
            <thead>
              <tr>
                <th style={{ ...ui.cell, ...s.num }}>#</th>
                <th style={ui.cell}>{t('analyst.kin.letter_col')}</th>
                {head(['start', 'duration', 'path', 'mean_speed', 'peak_speed', 'velocity_peaks', 'normalized_jerk', 'pressure'])}
              </tr>
            </thead>
            <tbody>
              {data.strokes.map((x) => {
                const l = data.letters.find((y) => y.box_id === x.box_id);
                return (
                  <tr key={x.index} style={x.measured ? undefined : { color: 'var(--ilt-muted)' }}>
                    <td style={{ ...ui.cell, ...s.num }}>{x.index}</td>
                    <td style={ui.cell}>{letterName(x.box_id, l?.position ?? null)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{(x.start_ms / 1000).toFixed(2)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{x.duration_ms}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(x.path_length_mm)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(x.mean_speed)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(x.peak_speed)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{x.velocity_peaks ?? '—'}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(x.normalized_jerk)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(x.mean_pressure, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('analyst.kin.short_note')}</p>
      </details>
    </div>
  );
}
