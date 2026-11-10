// Replay player (FR-REP-1/2), shared by the evaluator cockpit and the analyst portal: plays a stored
// block back like a video, from the saved pen samples, with play/pause, a timeline scrubber, speed
// 0.25x to 4x and frame (sample) steps. The computed ILT speed is shown under each house; ink is
// coloured by pressure and the hover path is yellow. The caller loads the data.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { StrokeFlag, type PenSample } from '@ilt/shared-types';
import type { CanvasGeometry } from '@ilt/template-schemas';
import { CanvasView } from './CanvasView.js';
import { InkRenderer } from './ink.js';
import { PressureLegend } from './PressureLegend.js';
import { ui } from './styles.js';

export interface ReplayData {
  attempt: { id: string; attempt_number: number; status: string; session_code: string; step_index: number; step_type: string; label_key: string; block_number: number | null; total_time_ms: number | null };
  canvas: CanvasGeometry;
  fill_order: number[] | null;
  samples: { t_us: number[]; x: number[]; y: number[]; p: number[]; f: number[]; box: number[] };
  letters: { box_id: number; speed_mm_s: number | null; is_accurate: boolean | null; pen_lifts_internal: number | null }[];
  score: { composite_score: string | null; avg_speed_mm_s: string | null; pen_lifts: number | null } | null;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const s: Record<string, CSSProperties> = {
  // Extra space below the canvas for the speed labels under the last row of houses.
  stage: { border: '1px solid var(--ilt-border)', borderRadius: 8, background: 'var(--ilt-stage)', padding: '0.5rem', paddingBlockEnd: '1.75rem', overflow: 'hidden', minInlineSize: 0 },
  bar: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  speedLabel: { position: 'absolute', transform: 'translateX(-50%)', fontSize: '0.75rem', color: 'var(--ilt-link)', fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none' },
};

export function ReplayPlayer({ data, onBack }: { data: ReplayData; onBack: () => void }) {
  const { t } = useTranslation();
  const samples = useRef<PenSample[]>([]);
  if (samples.current.length === 0 && data.samples.t_us.length > 0) {
    const c = data.samples;
    samples.current = c.t_us.map((t_us, i) => ({ sample_seq: i, t_us, x_mm: c.x[i]!, y_mm: c.y[i]!, pressure: c.p[i]!, tilt_x: 0, tilt_y: 0, flags: c.f[i]!, box_id: c.box[i]! }));
  }
  const all = samples.current;
  const endUs = all.length ? all[all.length - 1]!.t_us : 0;
  const box = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<InkRenderer | null>(null);
  const drawn = useRef(0); // samples already drawn
  const [pxPerMm, setPxPerMm] = useState(4);
  const [index, setIndex] = useState(0); // samples shown
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const clock = useRef<{ wall: number; us: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPxPerMm(Math.max(1, el.clientWidth / data.canvas.size.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.canvas]);

  useEffect(() => {
    if (!ink.current) return;
    renderer.current = new InkRenderer(ink.current, data.canvas.size, pxPerMm, { pressureColour: true, showHover: true, lineWidthMm: 0.6 });
    renderer.current.add(all.slice(0, drawn.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.canvas]);
  useEffect(() => renderer.current?.resize(pxPerMm), [pxPerMm]);

  /** Shows exactly the first `to` samples, drawing forward or redrawing after a step back. */
  const showTo = useCallback((to: number) => {
    const r = renderer.current;
    const target = Math.max(0, Math.min(all.length, to));
    if (r) {
      if (target < drawn.current) {
        r.clear();
        r.add(all.slice(0, target));
      } else if (target > drawn.current) {
        r.add(all.slice(drawn.current, target));
      }
    }
    drawn.current = target;
    setIndex(target);
  }, [all]);

  const indexAt = (us: number) => {
    let lo = 0;
    let hi = all.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (all[mid]!.t_us <= us) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const startUs = drawn.current > 0 && drawn.current < all.length ? all[drawn.current - 1]!.t_us : drawn.current >= all.length ? 0 : (all[0]?.t_us ?? 0);
    if (drawn.current >= all.length) showTo(0);
    clock.current = { wall: performance.now(), us: startUs };
    const tick = () => {
      const c = clock.current!;
      const us = c.us + (performance.now() - c.wall) * 1000 * speed;
      const to = indexAt(us);
      showTo(to);
      if (to >= all.length) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  const current = index > 0 ? all[index - 1]! : null;
  const nowUs = current?.t_us ?? 0;
  const liftsSoFar = all.slice(0, index).filter((x) => (x.flags & StrokeFlag.STROKE_START) !== 0).length;
  const speedByBox = new Map(data.letters.map((l) => [l.box_id, l.speed_mm_s]));
  const fmtTime = (us: number) => `${(us / 1e6).toFixed(2)} ${t('units.seconds')}`;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <button style={ui.button} onClick={onBack}>{t('common.back')}</button>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>
          {t('replay.title')} · <bdi>{data.attempt.session_code}</bdi> · {t(data.attempt.label_key, { n: data.attempt.block_number ?? '' })} · {t('replay.attempt', { n: data.attempt.attempt_number })}
        </h2>
      </div>
      <section style={s.stage}>
        <div ref={box} style={{ inlineSize: '100%' }}>
          <CanvasView geometry={data.canvas} pxPerMm={pxPerMm}>
            <canvas ref={ink} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
            {data.canvas.boxes.map((b) => {
              const v = speedByBox.get(b.id);
              return v == null ? null : (
                <span key={b.id} style={{ ...s.speedLabel, left: (b.x + b.w / 2) * pxPerMm, top: (b.y + b.h + 1) * pxPerMm }} data-testid="house-speed">
                  {Number(v).toFixed(1)} {t('units.mm_s')}
                </span>
              );
            })}
          </CanvasView>
        </div>
      </section>
      <PressureLegend />
      <div style={s.bar} data-testid="replay-controls">
        <button style={ui.button} aria-label={t('replay.step_back')} onClick={() => { setPlaying(false); showTo(index - 1); }}>⏮</button>
        <button style={ui.primary} onClick={() => setPlaying((p) => !p)} data-testid="replay-play">{t(playing ? 'replay.pause' : 'replay.play')}</button>
        <button style={ui.button} aria-label={t('replay.step_forward')} onClick={() => { setPlaying(false); showTo(index + 1); }}>⏭</button>
        <input
          type="range"
          aria-label={t('replay.timeline')}
          min={0}
          max={Math.max(1, Math.round(endUs / 1000))}
          value={Math.round(nowUs / 1000)}
          onChange={(e) => {
            setPlaying(false);
            showTo(indexAt(Number(e.target.value) * 1000));
          }}
          style={{ flex: 1, minInlineSize: '12rem' }}
        />
        <bdi style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(nowUs)} / {fmtTime(endUs)}</bdi>
        <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
          {t('replay.speed')}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
          </select>
        </label>
      </div>
      <p style={{ ...ui.muted, margin: 0 }} data-testid="replay-readout">
        {t('replay.samples', { n: index, total: all.length })} · {t('summary.pen_lifts')}: {liftsSoFar} ·{' '}
        {t('replay.pressure')}: {current && (current.flags & StrokeFlag.CONTACT) !== 0 ? current.pressure.toFixed(2) : '—'}
        {data.score && <> · {t('summary.composite')}: {data.score.composite_score ?? t('summary.not_configured')}</>}
      </p>
    </div>
  );
}
