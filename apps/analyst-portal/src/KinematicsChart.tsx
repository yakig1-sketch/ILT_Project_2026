// One kinematic measure over the block's time (speed, jerk or pressure): a line per stroke, with gaps
// where the pen was lifted, a shared crosshair, and shaded bands for the selected letter.
import { useEffect, useRef, useState } from 'react';

export interface StrokeSeries { index: number; box_id: number | null; t_ms: number[]; values: number[] }

const H = 150;
const PAD = { top: 8, right: 12, bottom: 22, left: 56 };

/** A round step for about `count` ticks over [0, max]. */
const niceStep = (max: number, count: number) => {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
};

export function KinematicsChart(props: {
  title: string;
  unit: string;
  strokes: StrokeSeries[];
  durationMs: number;
  /** Top of the scale; values above it are drawn at the top edge. */
  yMax: number;
  format: (v: number) => string;
  bands: [number, number][];
  hoverMs: number | null;
  onHover: (ms: number | null) => void;
  testId: string;
}) {
  const { strokes, durationMs, yMax, bands, hoverMs } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;
  const span = Math.max(durationMs, 1);
  const x = (ms: number) => PAD.left + (ms / span) * w;
  const y = (v: number) => PAD.top + h - (Math.min(Math.max(v, 0), yMax) / (yMax || 1)) * h;
  const yStep = niceStep(yMax, 3);
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const xStep = niceStep(span / 1000, Math.max(2, Math.floor(w / 90))) * 1000;
  const xTicks = Array.from({ length: Math.floor(span / xStep) + 1 }, (_, i) => i * xStep);

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const ms = ((e.clientX - r.left - PAD.left) / w) * span;
    props.onHover(ms < 0 || ms > span ? null : ms);
  };

  return (
    <figure style={{ margin: 0 }} data-testid={props.testId}>
      <figcaption style={{ fontWeight: 600, marginBlockEnd: '0.25rem' }}>{props.title} <span style={{ color: 'var(--ilt-muted)', fontWeight: 400 }}>(<bdi>{props.unit}</bdi>)</span></figcaption>
      <div ref={box} dir="ltr">
        <svg width={width} height={H} role="img" aria-label={props.title} onPointerMove={move} onPointerLeave={() => props.onHover(null)} style={{ display: 'block', touchAction: 'none' }}>
          {bands.map(([a, b], i) => (
            <rect key={i} x={x(a)} y={PAD.top} width={Math.max(2, x(b) - x(a))} height={h} fill="var(--ilt-select)" />
          ))}
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} stroke="var(--ilt-border-soft)" />
              <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ilt-muted)">{props.format(v)}</text>
            </g>
          ))}
          {xTicks.map((ms) => (
            <text key={ms} x={x(ms)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--ilt-muted)">{`${+(ms / 1000).toFixed(2)} s`}</text>
          ))}
          <line x1={PAD.left} x2={PAD.left + w} y1={PAD.top + h} y2={PAD.top + h} stroke="var(--ilt-border)" />
          {strokes.map((s) => (
            <polyline
              key={s.index}
              fill="none"
              stroke="var(--ilt-accent)"
              strokeWidth={1.5}
              strokeLinejoin="round"
              points={s.t_ms.map((t, i) => `${x(t).toFixed(1)},${y(s.values[i]!).toFixed(1)}`).join(' ')}
            />
          ))}
          {hoverMs != null && <line x1={x(hoverMs)} x2={x(hoverMs)} y1={PAD.top} y2={PAD.top + h} stroke="var(--ilt-fg)" strokeDasharray="3 3" />}
        </svg>
      </div>
    </figure>
  );
}
