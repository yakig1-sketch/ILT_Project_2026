// Research sessions (FR-AN-1, FR-AN-3): cohort filters, the cohort table with a chosen grouping, and
// the matching sessions. Only completed RESEARCH sessions with research consent ever reach this screen.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { num, valueLabel, type Options } from './labels';

interface SessionRow {
  session_id: string;
  session_code: string;
  study_code: string;
  domain_id: number;
  region_id: number | null;
  school_key: string | null;
  grade_level: string;
  gender: string;
  ses_group: string | null;
  dominant_hand: string;
  language_code: string;
  session_type: string;
  completed_at: string | null;
  inactivity_sec: number | null;
  blocks: number;
  composite: number | null;
}
interface Group {
  grp: string | null;
  participants: number;
  sessions: number;
  blocks: number;
  composite: number | null;
  accuracy: number | null;
  speed_score: number | null;
  avg_speed_mm_s: number | null;
  pen_lifts: number | null;
  total_time_ms: number | null;
}

const FILTERS = ['domain_id', 'region_id', 'school', 'grade', 'gender', 'ses', 'hand', 'language', 'session_type', 'canvas', 'inactivity_sec', 'from', 'to'] as const;
type FilterKey = (typeof FILTERS)[number];
type Filters = Record<FilterKey, string>;
const EMPTY = Object.fromEntries(FILTERS.map((k) => [k, ''])) as Filters;
const GROUPS = ['none', 'domain', 'region', 'school', 'grade', 'gender', 'ses', 'hand', 'language', 'stage', 'canvas', 'inactivity'] as const;
const STORE = 'ilt.analyst.filters';

const GRADES = ['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6'];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const SES = ['LOW', 'MID', 'HIGH', 'NONE'];
const HANDS = ['RIGHT', 'LEFT', 'AMBIDEXTROUS'];
const STAGES = ['DAY_1', 'DAY_2', 'DAY_14'];

const s = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.75rem', alignItems: 'end' },
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  head: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' },
  h: { margin: 0, fontSize: '1.1rem' },
  notice: { margin: 0, padding: '0.6rem 0.8rem', borderRadius: 6, background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border-soft)', maxInlineSize: '60rem' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  // Long Domain or Region names must not push the arrow out of the cell.
  control: { inlineSize: '100%', minInlineSize: 0, boxSizing: 'border-box' },
  link: { background: 'none', border: 0, padding: 0, color: 'var(--ilt-link)', cursor: 'pointer', font: 'inherit' },
} satisfies Record<string, CSSProperties>;

const loadFilters = (): { filters: Filters; group: string } => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as { filters: Partial<Filters>; group: string } | null;
    if (saved) return { filters: { ...EMPTY, ...saved.filters }, group: GROUPS.includes(saved.group as never) ? saved.group : 'none' };
  } catch {
    // Start with no filters.
  }
  return { filters: EMPTY, group: 'none' };
};

export function ResearchScreen({ onOpen }: { onOpen: (sessionId: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [options, setOptions] = useState<Options | null>(null);
  const [{ filters, group }, setState] = useState(loadFilters);
  const [sessions, setSessions] = useState<{ sessions: SessionRow[]; total: number; limited: boolean } | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }), [lang]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const on = () => document.visibilityState === 'visible' && setRefresh((n) => n + 1);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of FILTERS) if (filters[k]) q.set(k, filters[k]);
    q.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
    return q;
  }, [filters]);

  useEffect(() => {
    api<Options>('/research/options').then(setOptions).catch((e: ApiError) => setError(e.messageKey));
  }, [refresh]);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ filters, group }));
    } catch {
      // Not kept.
    }
    let live = true;
    setError(null);
    api<{ sessions: SessionRow[]; total: number; limited: boolean }>(`/research/sessions?${query}`)
      .then((r) => live && setSessions(r)).catch((e: ApiError) => live && setError(e.messageKey));
    api<{ groups: Group[] }>(`/research/cohort?${query}&group_by=${group}`)
      .then((r) => live && setGroups(r.groups)).catch((e: ApiError) => live && setError(e.messageKey));
    return () => {
      live = false;
    };
  }, [query, group, filters, refresh]);

  const set = (k: FilterKey, v: string) => setState((st) => ({ ...st, filters: { ...st.filters, [k]: v } }));
  const label = (kind: string, v: unknown) => valueLabel(t, lang, options, kind, v);
  const pick = (k: FilterKey, title: string, values: (string | number)[], kind: string) => (
    <label style={ui.field}>
      {title}
      <select style={s.control} value={filters[k]} onChange={(e) => set(k, e.target.value)} data-testid={`filter-${k}`}>
        <option value="">{t('analyst.all')}</option>
        {values.map((v) => <option key={v} value={v}>{v === 'NONE' ? t('analyst.not_recorded') : label(kind, v)}</option>)}
      </select>
    </label>
  );
  const anyFilter = FILTERS.some((k) => filters[k]);

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="research">
      <p style={s.notice}>{t('analyst.scope')}</p>
      {options && options.sessions === 0 && <p style={{ ...s.notice, background: 'var(--ilt-warn-bg)' }} data-testid="research-empty">{t('analyst.empty')}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      <section style={s.section} aria-labelledby="filters-h">
        <div style={s.head}>
          <h2 id="filters-h" style={s.h}>{t('analyst.filters')}</h2>
          {options && <span style={ui.muted}>{t('analyst.totals', { sessions: options.sessions, participants: options.participants })}</span>}
        </div>
        <div style={s.grid}>
          {pick('domain_id', t('analyst.domain'), options?.domains.map((d) => d.id) ?? [], 'domain')}
          {pick('region_id', t('analyst.region'), [...(options?.regions.map((r) => r.id) ?? []), 'NONE'], 'region')}
          {pick('school', t('analyst.school'), options?.schools ?? [], 'school')}
          {pick('grade', t('analyst.grade'), GRADES, 'grade')}
          {pick('gender', t('analyst.gender'), GENDERS, 'gender')}
          {pick('ses', t('analyst.ses'), SES, 'ses')}
          {pick('hand', t('analyst.hand'), HANDS, 'hand')}
          {pick('language', t('analyst.language'), ['he', 'en'], 'language')}
          {pick('session_type', t('analyst.stage'), STAGES, 'stage')}
          {pick('canvas', t('analyst.canvas'), options?.canvases ?? [], 'canvas')}
          {pick('inactivity_sec', t('analyst.inactivity'), options?.inactivity_sec ?? [], 'inactivity')}
          <label style={ui.field}>
            {t('analyst.from')}
            <input type="date" dir="ltr" style={s.control} value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label style={ui.field}>
            {t('analyst.to')}
            <input type="date" dir="ltr" style={s.control} value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} />
          </label>
        </div>
        <div>
          <button style={ui.button} disabled={!anyFilter} onClick={() => setState((st) => ({ ...st, filters: EMPTY }))} data-testid="filters-clear">
            {t('analyst.clear')}
          </button>
        </div>
      </section>

      <section style={s.section} aria-labelledby="cohort-h">
        <div style={s.head}>
          <h2 id="cohort-h" style={s.h}>{t('analyst.cohort')}</h2>
          <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
            {t('analyst.group_by')}
            <select value={group} onChange={(e) => setState((st) => ({ ...st, group: e.target.value }))} data-testid="group-by">
              {GROUPS.map((g) => <option key={g} value={g}>{t(`analyst.group.${g}`)}</option>)}
            </select>
          </label>
        </div>
        <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.cohort_note')}</p>
        {groups && (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="cohort-table">
              <thead>
                <tr>
                  <th style={ui.cell}>{t(`analyst.group.${group}`)}</th>
                  {(['participants', 'sessions', 'blocks', 'composite', 'accuracy', 'speed_score', 'avg_speed', 'pen_lifts', 'time'] as const).map((k) => (
                    <th key={k} style={{ ...ui.cell, ...s.num }}>{t(`analyst.${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={String(g.grp)}>
                    <td style={ui.cell}><bdi>{group === 'none' ? t('analyst.everyone') : label(group, g.grp)}</bdi></td>
                    <td style={{ ...ui.cell, ...s.num }}>{g.participants}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{g.sessions}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{g.blocks}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(g.composite)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(g.accuracy)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(g.speed_score)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(g.avg_speed_mm_s, 2)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(g.pen_lifts, 2)}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{g.total_time_ms == null ? '—' : (g.total_time_ms / 1000).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={s.section} aria-labelledby="sessions-h">
        <div style={s.head}>
          <h2 id="sessions-h" style={s.h}>{t('analyst.session_list')}</h2>
          {sessions && <span style={ui.muted} data-testid="sessions-found">{t('analyst.found', { count: sessions.total })}</span>}
        </div>
        {sessions?.limited && <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.limited', { n: sessions.sessions.length })}</p>}
        {sessions && sessions.total === 0 && <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.none_found')}</p>}
        {sessions && sessions.total > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="sessions-table">
              <thead>
                <tr>
                  {['session_code', 'study_code', 'stage', 'language', 'grade', 'gender', 'ses', 'hand', 'domain', 'region', 'school', 'completed'].map((k) => (
                    <th key={k} style={ui.cell}>{t(`analyst.${k}`)}</th>
                  ))}
                  <th style={{ ...ui.cell, ...s.num }}>{t('analyst.blocks')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('analyst.composite')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.sessions.map((r) => (
                  <tr key={r.session_id}>
                    <td style={ui.cell}><button style={s.link} onClick={() => onOpen(r.session_id)}><bdi dir="ltr">{r.session_code}</bdi></button></td>
                    <td style={ui.cell}><bdi dir="ltr">{r.study_code}</bdi></td>
                    <td style={ui.cell}>{label('stage', r.session_type)}</td>
                    <td style={ui.cell}>{label('language', r.language_code)}</td>
                    <td style={ui.cell}>{label('grade', r.grade_level)}</td>
                    <td style={ui.cell}>{label('gender', r.gender)}</td>
                    <td style={ui.cell}>{label('ses', r.ses_group)}</td>
                    <td style={ui.cell}>{label('hand', r.dominant_hand)}</td>
                    <td style={ui.cell}>{label('domain', r.domain_id)}</td>
                    <td style={ui.cell}>{label('region', r.region_id)}</td>
                    <td style={ui.cell}><bdi dir="ltr">{r.school_key ?? '—'}</bdi></td>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{r.completed_at ? day.format(new Date(r.completed_at)) : '—'}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{r.blocks}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{num(r.composite)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
