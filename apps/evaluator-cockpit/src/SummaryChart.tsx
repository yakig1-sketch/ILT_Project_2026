// Comparative summary diagram (ECR, Phase 3): the measures of each anchor pair (average time, pen lifts,
// accuracy %, average ILT speed and, since a second ECR, the speed score) as lines across Day 1, Day 2
// and Day 14. One shared y-axis: the measures fall in the same 0–100 range, so a second scale is not needed.
// The speed score has no value until the canvas profile has a normal speed: its line is then absent and
// the tooltip says "not configured". Identity is never colour
// alone: a legend, a name at each line's end and a hover tooltip; the anchor boxes above are the table.
import { useMemo, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChartBox {
  key: string;
  session_type: string;
  block_numbers: number[];
  avg_time_ms: number | null;
  avg_pen_lifts: number | null;
  accuracy_pct: number | null;
  avg_speed_mm_s: number | null;
  speed_score: number | null;
}

/** Categorical slots 1–5 of the validated palette, stepped separately for light and dark. */
const CSS = `
.ilt-chart { --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; }
:root[data-theme="dark"] .ilt-chart { --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; }
`;

const W = 760;
const H = 330;
const M = { top: 16, right: 150, bottom: 40, left: 44 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

export function SummaryChart({ boxes }: { boxes: ChartBox[] }) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(() => [
    { key: 'time', colour: 'var(--s1)', digits: 1, value: (b: ChartBox) => (b.avg_time_ms === null ? null : b.avg_time_ms / 1000) },
    { key: 'pen_lifts', colour: 'var(--s2)', digits: 0, value: (b: ChartBox) => b.avg_pen_lifts },
    { key: 'accuracy', colour: 'var(--s3)', digits: 1, value: (b: ChartBox) => b.accuracy_pct },
    { key: 'speed', colour: 'var(--s4)', digits: 2, value: (b: ChartBox) => b.avg_speed_mm_s },
    { key: 'speed_score', colour: 'var(--s5)', digits: 1, value: (b: ChartBox) => b.speed_score, missing: 'summary.not_configured' },
  ].map((s) => ({ ...s, label: t(`summary.chart.${s.key}`), short: t(`summary.chart.short.${s.key}`), values: boxes.map(s.value) })), [boxes, t]);

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (all.length === 0) return null;
  const step = Math.max(...all) > 200 ? 50 : 20;
  const top = Math.max(100, Math.ceil(Math.max(...all) / step) * step);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const x = (i: number) => M.left + (boxes.length === 1 ? PW / 2 : (i * PW) / (boxes.length - 1));
  const y = (v: number) => M.top + PH - (v / top) * PH;
  // The block range is isolated left to right (LRI … PDI) so Hebrew shows "יום 1 (1–2)", not "(2–1)".
  const xLabel = (b: ChartBox) => `${t(`enum.session_type.${b.session_type}`)} (⁦${b.block_numbers[0]}–${b.block_numbers[1]}⁩)`;

  // Names at each line's last point, nudged apart so they never overlap.
  const ends = series
    .map((s) => {
      const i = s.values.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0).pop();
      return i === undefined ? null : { s, i, y: y(s.values[i]!) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 14);

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    boxes.forEach((_, i) => { if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i; });
    setHover(best);
  }

  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;
  return (
    <section className="ilt-chart" data-testid="summary-chart"
      style={{ border: '1px solid var(--ilt-border)', borderRadius: 8, padding: '0.9rem', background: 'var(--ilt-surface)', display: 'grid', gap: '0.6rem', inlineSize: '100%', maxInlineSize: '52rem', justifySelf: 'center', boxSizing: 'border-box' }}>
      <style>{CSS}</style>
      <h3 style={{ margin: 0, fontSize: '1rem', textAlign: 'center' }}>{t('summary.chart.title')}</h3>
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem', justifyContent: 'center', listStyle: 'none', margin: 0, padding: 0, fontSize: '0.85rem', color: 'var(--ilt-muted)' }}>
        {series.map((s) => (
          <li key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span aria-hidden style={{ inlineSize: 16, blockSize: 3, borderRadius: 2, background: s.colour }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('summary.chart.title')}
          style={{ direction: 'ltr', display: 'block', overflow: 'visible', touchAction: 'none' }}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + PW} y1={y(v)} y2={y(v)} stroke="var(--ilt-border-soft)" strokeWidth={1} />
              <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ilt-muted)">{v}</text>
            </g>
          ))}
          {boxes.map((b, i) => (
            <text key={b.key} x={x(i)} y={H - M.bottom + 22} textAnchor="middle" fontSize={11} fill="var(--ilt-muted)" direction={he ? 'rtl' : 'ltr'}>{xLabel(b)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PH} stroke="var(--ilt-muted)" strokeWidth={1} strokeDasharray="3 3" />}
          {series.map((s) => {
            // A missing anchor breaks the line rather than bridging it.
            const parts: string[] = [];
            let d = '';
            s.values.forEach((v, i) => {
              if (v === null) { if (d) parts.push(d); d = ''; return; }
              d += `${d ? 'L' : 'M'}${x(i)},${y(v)}`;
            });
            if (d) parts.push(d);
            return (
              <g key={s.key}>
                {parts.map((p, k) => <path key={k} d={p} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
                {s.values.map((v, i) => v !== null && (
                  <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 5 : 4} fill={s.colour} stroke="var(--ilt-surface)" strokeWidth={2} />
                ))}
              </g>
            );
          })}
          {ends.map((e) => (
            <text key={e.s.key} x={x(e.i) + 10} y={e.y} dy="0.32em" fontSize={11} fill="var(--ilt-fg)"
              direction={he ? 'rtl' : 'ltr'} textAnchor={he ? 'end' : 'start'}>{e.s.short}</text>
          ))}
        </svg>
        {hover !== null && (
          <div role="status" data-testid="summary-chart-tip"
            style={{
              position: 'absolute', insetBlockStart: 0, left: `${tipLeft}%`, transform: `translateX(${tipLeft > 60 ? 'calc(-100% - 12px)' : '12px'})`,
              background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border)', borderRadius: 6, padding: '0.45rem 0.6rem',
              fontSize: '0.8rem', pointerEvents: 'none', boxShadow: 'var(--ilt-shadow)', display: 'grid', gap: '0.2rem', whiteSpace: 'nowrap',
            }}>
            <strong>{t(`summary.anchor.${boxes[hover]!.key}`)}</strong>
            {series.map((s) => (
              <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: s.colour }} />
                <span style={{ color: 'var(--ilt-muted)' }}>{s.label}</span>
                <bdi style={{ marginInlineStart: 'auto', fontWeight: 600 }}>{s.values[hover] === null ? ('missing' in s && s.missing ? t(s.missing) : '—') : s.values[hover]!.toFixed(s.digits)}</bdi>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
