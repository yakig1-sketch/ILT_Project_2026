// Cohort overview (Phase 5g; FR-AN-1, FRS v3.3 Figure 8): the research filters, summary tiles, the
// learning curve over the protocol's ILT blocks (Day 1 blocks 1–8, Day 2 1–4, Day 14 1–2), box plots that
// compare the groups, and one row per participant with the Day 14 result and its replay.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { num, valueLabel, type Options } from './labels';
import { FILTERS, FilterPanel, GROUPS, loadFilters, saveFilters, type Filters } from './ResearchScreen';

export const MEASURES = ['time', 'composite', 'accuracy', 'pen_lifts', 'speed', 'speed_score'] as const;
type Measure = (typeof MEASURES)[number];
const DIGITS: Record<Measure, number> = { time: 1, composite: 1, accuracy: 1, pen_lifts: 1, speed: 2, speed_score: 1 };
/** The protocol positions of the learning curve. */
const STAGES = [['DAY_1', 8], ['DAY_2', 4], ['DAY_14', 2]] as const;
const POSITIONS = STAGES.flatMap(([stage, n]) => Array.from({ length: n }, (_, i) => ({ stage, block: i + 1 })));
/** At most this many lines; the groups with the most participants are drawn. */
const MAX_LINES = 6;
const STORE = 'ilt.analyst.overview';

interface CurvePoint { grp: string | null; session_type: string; block_number: number; blocks: number; participants: number; mean: number | null }
interface Box { grp: string | null; participants: number; min: number; q1: number; median: number; q3: number; max: number }
interface ParticipantRow {
  study_code: string; domain_id: number; school_key: string | null; grade_level: string | null; gender: string | null; ses_group: string | null;
  dominant_hand: string | null; sessions: number; stages: string[]; ilt_blocks: number; day14_composite: number | null; day14_pass: boolean | null;
  day14_attempt_id: string | null;
}
interface Overview {
  totals: { participants: number; sessions: number; blocks: number; composite: number | null; accuracy: number | null; total_time_ms: number | null } | null;
  curve: CurvePoint[];
  boxes: Box[];
  participants: { rows: ParticipantRow[]; total: number; limited: boolean };
}

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem', minInlineSize: 0 },
  head: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' },
  h: { margin: 0, fontSize: '1.1rem' },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))', gap: '0.75rem' },
  tile: { ...ui.card, display: 'grid', gap: '0.2rem', padding: '0.75rem 1rem' },
  tileLabel: { color: 'var(--ilt-muted)', fontSize: '0.85rem' },
  tileValue: { fontSize: '1.6rem', fontWeight: 600 },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  link: { background: 'none', border: 0, padding: 0, color: 'var(--ilt-link)', cursor: 'pointer', font: 'inherit' },
  tip: {
    position: 'absolute', pointerEvents: 'none', background: 'var(--ilt-surface)', border: '1px solid var(--ilt-border)', borderRadius: 6,
    padding: '0.4rem 0.6rem', fontSize: '0.85rem', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', whiteSpace: 'nowrap', zIndex: 1,
  },
  legend: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1rem', margin: 0, padding: 0, listStyle: 'none', fontSize: '0.9rem' },
} satisfies Record<string, CSSProperties>;

const loadView = (): { group: string; measure: Measure } => {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as { group: string; measure: Measure } | null;
    if (v && GROUPS.includes(v.group as never) && MEASURES.includes(v.measure)) return v;
  } catch {
    // The defaults.
  }
  return { group: 'none', measure: 'time' };
};

/**
 * The width of a chart's box (at least `min`). A callback ref follows the element itself, so a box that is
 * replaced is watched again; a width of 0 (the box hidden or detached for a moment) is ignored rather than
 * shrinking the chart, and the width is checked again when the window changes size (Phase 5g QA Take#1).
 */
function useWidth(min = 300): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(min);
  useEffect(() => {
    if (!el) return;
    const measure = (w = el.getBoundingClientRect().width) => {
      if (w > 0) setWidth(Math.max(min, Math.floor(w)));
    };
    measure();
    const ro = new ResizeObserver(([e]) => measure(e!.contentRect.width));
    ro.observe(el);
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onResize);
    };
  }, [el, min]);
  return [setEl, width];
}

/** A round step for about `count` ticks over [lo, hi]. */
const niceStep = (span: number, count: number) => {
  const raw = span / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
};
const ticks = (lo: number, hi: number, count: number) => {
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step * 0.001; v += step) out.push(+v.toFixed(6));
  return out;
};

export function OverviewScreen({ onReplay }: { onReplay: (attemptId: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [options, setOptions] = useState<Options | null>(null);
  const [filters, setFilters] = useState<Filters>(() => loadFilters().filters);
  const [{ group, measure }, setView] = useState(loadView);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Options>('/research/options').then(setOptions).catch((e: ApiError) => setError(e.messageKey));
  }, []);
  useEffect(() => {
    saveFilters(filters);
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ group, measure }));
    } catch {
      // Not kept.
    }
    const q = new URLSearchParams();
    for (const k of FILTERS) if (filters[k]) q.set(k, filters[k]);
    q.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
    q.set('group_by', group);
    q.set('measure', measure);
    let live = true;
    setError(null);
    api<Overview>(`/research/overview?${q}`).then((r) => live && setData(r)).catch((e: ApiError) => live && setError(e.messageKey));
    return () => {
      live = false;
    };
  }, [filters, group, measure]);

  const label = (kind: string, v: unknown) => valueLabel(t, lang, options, kind, v);
  const groupLabel = (g: string | null) => (group === 'none' ? t('analyst.everyone') : label(group, g));
  const fmt = (v: number | null | undefined) => num(v ?? null, DIGITS[measure]);
  const measureLabel = t(`analyst.overview.measure.${measure}`);
  const tot = data?.totals;

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="overview">
      <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.scope')}</p>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      <FilterPanel options={options} filters={filters} onChange={setFilters} />

      <section style={s.section} aria-label={t('analyst.overview.view')}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
            {t('analyst.overview.compare')}
            <select value={group} onChange={(e) => setView((v) => ({ ...v, group: e.target.value }))} data-testid="overview-group">
              {GROUPS.map((g) => <option key={g} value={g}>{t(`analyst.group.${g}`)}</option>)}
            </select>
          </label>
          <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
            {t('analyst.overview.measure_label')}
            <select value={measure} onChange={(e) => setView((v) => ({ ...v, measure: e.target.value as Measure }))} data-testid="overview-measure">
              {MEASURES.map((m) => <option key={m} value={m}>{t(`analyst.overview.measure.${m}`)}</option>)}
            </select>
          </label>
        </div>
      </section>

      {!data && !error && <p style={ui.muted}>{t('common.checking')}</p>}
      {data && (
        <>
          <div style={s.tiles} data-testid="overview-tiles">
            <Tile label={t('analyst.participants')} value={tot?.participants ?? 0} id="participants" />
            <Tile label={t('analyst.sessions')} value={tot?.sessions ?? 0} id="sessions" />
            <Tile label={t('analyst.overview.blocks')} value={tot?.blocks ?? 0} id="blocks" />
            <Tile label={t('analyst.overview.mean_time')} value={tot?.total_time_ms == null ? '—' : (tot.total_time_ms / 1000).toFixed(1)} id="time" />
            <Tile label={t('analyst.overview.mean_accuracy')} value={num(tot?.accuracy ?? null)} id="accuracy" />
            <Tile label={t('analyst.overview.mean_composite')} value={num(tot?.composite ?? null)} id="composite" />
          </div>

          <section style={s.section} aria-labelledby="curve-h">
            <h2 id="curve-h" style={s.h}>{t('analyst.overview.curve', { measure: measureLabel })}</h2>
            <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.overview.curve_note')}</p>
            <LearningCurve points={data.curve} groupLabel={groupLabel} fmt={fmt} measureLabel={measureLabel} single={group === 'none'} />
          </section>

          <section style={s.section} aria-labelledby="box-h">
            <h2 id="box-h" style={s.h}>{t('analyst.overview.boxes', { measure: measureLabel })}</h2>
            <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.overview.boxes_note')}</p>
            <BoxPlots boxes={data.boxes} groupLabel={groupLabel} fmt={fmt} measureLabel={measureLabel} />
          </section>

          <section style={s.section} aria-labelledby="people-h">
            <div style={s.head}>
              <h2 id="people-h" style={s.h}>{t('analyst.overview.participants')}</h2>
              <span style={ui.muted}>{t('analyst.overview.participants_found', { count: data.participants.total })}</span>
            </div>
            {data.participants.limited && <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.overview.limited')}</p>}
            {data.participants.total === 0 ? <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.none_found')}</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={ui.table} data-testid="overview-participants">
                  <thead>
                    <tr>
                      {['study_code', 'grade', 'gender', 'ses', 'hand', 'domain', 'school'].map((k) => <th key={k} style={ui.cell}>{t(`analyst.${k}`)}</th>)}
                      <th style={ui.cell}>{t('analyst.overview.stages')}</th>
                      <th style={{ ...ui.cell, ...s.num }}>{t('analyst.overview.ilt_blocks')}</th>
                      <th style={{ ...ui.cell, ...s.num }}>{t('analyst.overview.day14')}</th>
                      <th style={ui.cell}>{t('analyst.overview.day14_status')}</th>
                      <th style={ui.cell}>{t('analyst.overview.replay_day14')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.participants.rows.map((p) => (
                      <tr key={p.study_code}>
                        <td style={ui.cell}><bdi dir="ltr">{p.study_code}</bdi></td>
                        <td style={ui.cell}>{label('grade', p.grade_level)}</td>
                        <td style={ui.cell}>{label('gender', p.gender)}</td>
                        <td style={ui.cell}>{label('ses', p.ses_group)}</td>
                        <td style={ui.cell}>{label('hand', p.dominant_hand)}</td>
                        <td style={ui.cell}>{label('domain', p.domain_id)}</td>
                        <td style={ui.cell}><bdi dir="ltr">{p.school_key ?? '—'}</bdi></td>
                        <td style={ui.cell}>{[...p.stages].sort((a, b) => stageOrder(a) - stageOrder(b)).map((st) => label('stage', st)).join(', ')}</td>
                        <td style={{ ...ui.cell, ...s.num }}>{p.ilt_blocks}</td>
                        <td style={{ ...ui.cell, ...s.num }}>{num(p.day14_composite)}</td>
                        <td style={ui.cell} data-testid={`day14-${p.study_code}`}>
                          {p.day14_pass === null ? '—' : p.day14_pass
                            ? <span style={{ color: 'var(--ilt-ok)' }}>✓ {t('analyst.overview.passed')}</span>
                            : <span style={{ color: 'var(--ilt-bad)' }}>✗ {t('analyst.overview.not_passed')}</span>}
                        </td>
                        <td style={ui.cell}>
                          {p.day14_attempt_id && (
                            <button style={s.link} onClick={() => onReplay(p.day14_attempt_id!)} data-testid={`replay-${p.study_code}`}>
                              {t('analyst.replay')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, id }: { label: string; value: ReactNode; id: string }) {
  return (
    <div style={s.tile} data-testid={`tile-${id}`}>
      <span style={s.tileLabel}>{label}</span>
      <span style={s.tileValue}>{value}</span>
    </div>
  );
}

const series = (i: number) => `var(--ilt-series-${i + 1})`;

/** The learning curve: the mean per protocol position, one line per group (broken between the stages). */
function LearningCurve({ points, groupLabel, fmt, measureLabel, single }: {
  points: CurvePoint[]; groupLabel: (g: string | null) => string; fmt: (v: number | null) => string; measureLabel: string; single: boolean;
}) {
  const { t } = useTranslation();
  // Narrower than this the stage names collide: the chart scrolls inside its box instead.
  const [box, width] = useWidth(520);
  const [hover, setHover] = useState<number | null>(null);
  // The groups with the most participants, in a fixed order (by their value), so a colour stays with its group.
  const groups = useMemo(() => {
    const size = new Map<string, number>();
    for (const p of points) size.set(String(p.grp), Math.max(size.get(String(p.grp)) ?? 0, p.participants));
    const keep = [...size.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LINES).map(([g]) => g);
    const order = [...new Set(points.map((p) => String(p.grp)))];
    return order.filter((g) => keep.includes(g)).map((g) => ({ key: g, grp: points.find((p) => String(p.grp) === g)!.grp }));
  }, [points]);
  const hidden = new Set(points.map((p) => String(p.grp))).size - groups.length;
  if (points.length === 0) return <p style={{ ...ui.muted, margin: 0 }} data-testid="curve-empty">{t('analyst.overview.no_blocks')}</p>;

  const H = 260;
  const PAD = { top: 12, right: single ? 16 : 120, bottom: 44, left: 52 };
  const w = width - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;
  const at = (gKey: string, i: number) => points.find((p) => String(p.grp) === gKey && p.session_type === POSITIONS[i]!.stage && p.block_number === POSITIONS[i]!.block);
  const values = points.filter((p) => groups.some((g) => g.key === String(p.grp))).map((p) => p.mean ?? 0);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const yTicks = ticks(Math.max(0, lo - (hi - lo) * 0.1), hi + (hi - lo) * 0.1, 4);
  const y0 = yTicks[0]!;
  const y1 = yTicks[yTicks.length - 1]!;
  const x = (i: number) => PAD.left + ((i + 0.5) / POSITIONS.length) * w;
  const y = (v: number) => PAD.top + h - ((v - y0) / (y1 - y0 || 1)) * h;

  // Direct labels at each line's last point, pushed apart so they do not overlap.
  const ends = groups.map((g, gi) => {
    let last = -1;
    POSITIONS.forEach((_, i) => { if (at(g.key, i)?.mean != null) last = i; });
    return { gi, i: last, y: last < 0 ? 0 : y(at(g.key, last)!.mean!) };
  }).filter((e) => e.i >= 0).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 18) ends[k]!.y = ends[k - 1]!.y + 18;

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left - PAD.left) / w) * POSITIONS.length);
    setHover(i >= 0 && i < POSITIONS.length ? i : null);
  };
  const stageStart = (si: number) => STAGES.slice(0, si).reduce((n, [, c]) => n + c, 0);

  return (
    <div style={{ display: 'grid', gap: '0.5rem', minInlineSize: 0 }}>
      {!single && (
        <ul style={s.legend} aria-label={t('analyst.overview.legend')}>
          {groups.map((g, gi) => (
            <li key={g.key} style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
              <svg width="18" height="10" aria-hidden><line x1="1" x2="17" y1="5" y2="5" stroke={series(gi)} strokeWidth="2" /><circle cx="9" cy="5" r="3.5" fill={series(gi)} /></svg>
              <bdi>{groupLabel(g.grp)}</bdi>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.overview.more_groups', { shown: groups.length, count: hidden })}</p>}
      <div dir="ltr" style={{ overflowX: 'auto', minInlineSize: 0 }}>
      <div ref={box} style={{ position: 'relative', minInlineSize: 0 }} data-testid="curve">
        <svg width={width} height={H} role="img" aria-label={measureLabel} onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'none' }}>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} stroke="var(--ilt-border-soft)" />
              <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--ilt-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{+v.toFixed(2)}</text>
            </g>
          ))}
          <line x1={PAD.left} x2={PAD.left + w} y1={PAD.top + h} y2={PAD.top + h} stroke="var(--ilt-border)" />
          {STAGES.map(([stage, n], si) => {
            const a = stageStart(si);
            return (
              <g key={stage}>
                {si > 0 && <line x1={x(a) - w / POSITIONS.length / 2} x2={x(a) - w / POSITIONS.length / 2} y1={PAD.top} y2={PAD.top + h + 30} stroke="var(--ilt-border)" strokeDasharray="2 3" />}
                {Array.from({ length: n }, (_, b) => (
                  <text key={b} x={x(a + b)} y={PAD.top + h + 15} textAnchor="middle" fontSize="11" fill="var(--ilt-muted)">{b + 1}</text>
                ))}
                <text x={(x(a) + x(a + n - 1)) / 2} y={PAD.top + h + 32} textAnchor="middle" fontSize="12" fill="var(--ilt-fg)">{t(`enum.session_type.${stage}`)}</text>
              </g>
            );
          })}
          {hover !== null && <rect x={x(hover) - w / POSITIONS.length / 2} y={PAD.top} width={w / POSITIONS.length} height={h} fill="var(--ilt-select)" opacity="0.6" />}
          {groups.map((g, gi) => (
            <g key={g.key}>
              {STAGES.map(([stage, n], si) => {
                const a = stageStart(si);
                const pts = Array.from({ length: n }, (_, b) => a + b).map((i) => [i, at(g.key, i)?.mean] as const).filter(([, v]) => v != null);
                return pts.length > 1 && (
                  <polyline key={stage} fill="none" stroke={series(gi)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                    points={pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v!).toFixed(1)}`).join(' ')} />
                );
              })}
              {POSITIONS.map((_, i) => {
                const p = at(g.key, i);
                return p?.mean != null && <circle key={i} cx={x(i)} cy={y(p.mean)} r={hover === i ? 5 : 4} fill={series(gi)} stroke="var(--ilt-surface)" strokeWidth="2" />;
              })}
            </g>
          ))}
          {!single && ends.map((e) => (
            <text key={e.gi} x={x(e.i) + 9} y={e.y} dy="0.32em" fontSize="12" fill="var(--ilt-fg)">
              {truncate(groupLabel(groups[e.gi]!.grp), 14)}
            </text>
          ))}
        </svg>
        {hover !== null && (
          <div style={{ ...s.tip, top: PAD.top, ...(x(hover) > width / 2 ? { right: width - x(hover) + 14 } : { left: x(hover) + 14 }) }} role="status">
            <div style={{ fontWeight: 600, marginBlockEnd: '0.2rem' }}>
              {t(`enum.session_type.${POSITIONS[hover]!.stage}`)} · {t('analyst.overview.block_n', { n: POSITIONS[hover]!.block })}
            </div>
            {groups.map((g, gi) => {
              const p = at(g.key, hover);
              return (
                <div key={g.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span aria-hidden style={{ inlineSize: 8, blockSize: 8, borderRadius: 4, background: series(gi) }} />
                  {!single && <bdi>{groupLabel(g.grp)}:</bdi>}
                  <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(p?.mean ?? null)}</strong>
                  {p && <span style={{ color: 'var(--ilt-muted)' }}>{t('analyst.overview.n_blocks', { count: p.blocks })}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
      <details>
        <summary style={{ cursor: 'pointer' }}>{t('analyst.overview.as_table')}</summary>
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="curve-table">
            <thead>
              <tr>
                <th style={ui.cell}>{t('analyst.stage')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('analyst.offline.block')}</th>
                {groups.map((g) => <th key={g.key} style={{ ...ui.cell, ...s.num }}><bdi>{groupLabel(g.grp)}</bdi></th>)}
              </tr>
            </thead>
            <tbody>
              {POSITIONS.map((pos, i) => groups.some((g) => at(g.key, i)) && (
                <tr key={i}>
                  <td style={ui.cell}>{t(`enum.session_type.${pos.stage}`)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{pos.block}</td>
                  {groups.map((g) => {
                    const p = at(g.key, i);
                    return <td key={g.key} style={{ ...ui.cell, ...s.num }}>{p ? `${fmt(p.mean)} (${p.blocks})` : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** Protocol order of the stages (the intervention last). */
const stageOrder = (stage: string) => {
  const i = STAGES.findIndex(([st]) => st === stage);
  return i < 0 ? STAGES.length : i;
};

const truncate = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** Box plots: per group, the participants' own means (whiskers at the lowest and highest). */
function BoxPlots({ boxes, groupLabel, fmt, measureLabel }: {
  boxes: Box[]; groupLabel: (g: string | null) => string; fmt: (v: number | null) => string; measureLabel: string;
}) {
  const { t } = useTranslation();
  const [box, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  if (boxes.length === 0) return <p style={{ ...ui.muted, margin: 0 }} data-testid="boxes-empty">{t('analyst.overview.no_blocks')}</p>;
  const ROW = 34;
  // The label column fits the longest group name (about 7 px a character), up to a third of the width.
  const longest = Math.max(...boxes.map((b) => groupLabel(b.grp).length));
  const PAD = { top: 6, right: 56, bottom: 26, left: Math.round(Math.min(width / 3, Math.max(90, longest * 7 + 20))) };
  const labelChars = Math.max(8, Math.floor((PAD.left - 20) / 7));
  const H = PAD.top + PAD.bottom + ROW * boxes.length;
  const w = width - PAD.left - PAD.right;
  let lo = Math.min(...boxes.map((b) => b.min));
  let hi = Math.max(...boxes.map((b) => b.max));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const xt = ticks(Math.max(0, lo - (hi - lo) * 0.05), hi + (hi - lo) * 0.05, Math.max(2, Math.floor(w / 90)));
  const x0 = xt[0]!;
  const x1 = xt[xt.length - 1]!;
  const x = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * w;
  const cy = (i: number) => PAD.top + ROW * i + ROW / 2;
  const hb = hover === null ? null : boxes[hover]!;

  return (
    <div style={{ display: 'grid', gap: '0.5rem', minInlineSize: 0 }}>
      <div ref={box} dir="ltr" style={{ position: 'relative', minInlineSize: 0 }} data-testid="boxes">
        <svg width={width} height={H} role="img" aria-label={measureLabel} style={{ display: 'block' }} onPointerLeave={() => setHover(null)}>
          {xt.map((v) => (
            <g key={v}>
              <line x1={x(v)} x2={x(v)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--ilt-border-soft)" />
              <text x={x(v)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ilt-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{+v.toFixed(2)}</text>
            </g>
          ))}
          {boxes.map((b, i) => (
            <g key={String(b.grp)} onPointerEnter={() => setHover(i)}>
              <rect x={0} y={cy(i) - ROW / 2} width={width} height={ROW} fill={hover === i ? 'var(--ilt-select)' : 'transparent'} opacity="0.6" />
              <text x={PAD.left - 8} y={cy(i)} dy="0.32em" textAnchor="end" fontSize="12" fill="var(--ilt-fg)">{truncate(groupLabel(b.grp), labelChars)}</text>
              <line x1={x(b.min)} x2={x(b.max)} y1={cy(i)} y2={cy(i)} stroke="var(--ilt-series-1)" strokeWidth="1.5" />
              <line x1={x(b.min)} x2={x(b.min)} y1={cy(i) - 6} y2={cy(i) + 6} stroke="var(--ilt-series-1)" strokeWidth="1.5" />
              <line x1={x(b.max)} x2={x(b.max)} y1={cy(i) - 6} y2={cy(i) + 6} stroke="var(--ilt-series-1)" strokeWidth="1.5" />
              <rect x={x(b.q1)} y={cy(i) - 10} width={Math.max(2, x(b.q3) - x(b.q1))} height={20} rx="4" fill="var(--ilt-series-1-soft)" stroke="var(--ilt-series-1)" strokeWidth="1.5" />
              <line x1={x(b.median)} x2={x(b.median)} y1={cy(i) - 10} y2={cy(i) + 10} stroke="var(--ilt-fg)" strokeWidth="2" />
              <text x={width - PAD.right + 8} y={cy(i)} dy="0.32em" fontSize="11" fill="var(--ilt-muted)">n={b.participants}</text>
            </g>
          ))}
        </svg>
        {hb && (
          <div style={{ ...s.tip, top: cy(hover!) + 14, ...(x(hb.median) > width / 2 ? { right: width - x(hb.median) } : { left: x(hb.median) }) }} role="status">
            <div style={{ fontWeight: 600 }}><bdi>{groupLabel(hb.grp)}</bdi> · {t('analyst.overview.n_participants', { count: hb.participants })}</div>
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t('analyst.overview.box_values', { min: fmt(hb.min), q1: fmt(hb.q1), median: fmt(hb.median), q3: fmt(hb.q3), max: fmt(hb.max) })}
            </div>
          </div>
        )}
      </div>
      <details>
        <summary style={{ cursor: 'pointer' }}>{t('analyst.overview.as_table')}</summary>
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="boxes-table">
            <thead>
              <tr>
                <th style={ui.cell}>{t('analyst.overview.group')}</th>
                {(['participants', 'min', 'q1', 'median', 'q3', 'max'] as const).map((k) => (
                  <th key={k} style={{ ...ui.cell, ...s.num }}>{t(k === 'participants' ? 'analyst.participants' : `analyst.overview.stat.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <tr key={String(b.grp)}>
                  <td style={ui.cell}><bdi>{groupLabel(b.grp)}</bdi></td>
                  <td style={{ ...ui.cell, ...s.num }}>{b.participants}</td>
                  {([b.min, b.q1, b.median, b.q3, b.max]).map((v, k) => <td key={k} style={{ ...ui.cell, ...s.num }}>{fmt(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
