// Paper cohort and legacy results for analysts (Phase 5e; FRS FR-LEG-1/2, FR-AN-1/3). The participant
// filters of the research screen apply (Domain, Region, school, grade, gender, SES, hand); the session
// filters do not, since these results have no tablet sessions. Only participants whose current consent
// allows research use are seen (the research views decide).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { valueLabel, type Options } from './labels';
import { FILTERS, loadFilters } from './ResearchScreen';

/** The research screen's filters that describe the participant. */
const PARTICIPANT_FILTERS = ['domain_id', 'region_id', 'school', 'grade', 'gender', 'ses', 'hand'] as const;

interface Anchor { key: string; participants: number; blocks: number; avg_time_ms: number | null; avg_pen_lifts: number | null; avg_accurate_letters: number | null; accuracy_pct: number | null }
interface Label { session_label: string; participants: number; blocks: number; imported_at: string; pen_lifts: number | null; width_mm: number | null; total_time_ms: number | null; writing_time_ms: number | null; air_time_ms: number | null }
interface PaperRow { study_code: string; cohort: string; grade_level: string | null; gender: string | null; session_type: string; block_number: number; pen_lifts: number | null; accurate_letters: number | null; total_time_ms: number | null }
interface LegacyRow { study_code: string; cohort: string; session_label: string; block_number: number; pen_lifts: number | null; width_mm: number | null; total_time_ms: number | null; writing_time_ms: number | null; air_time_ms: number | null }
interface Offline {
  anchors: Anchor[];
  labels: Label[];
  paper: { rows: PaperRow[]; total: number; limited: boolean };
  legacy: { rows: LegacyRow[]; total: number; limited: boolean };
}

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h: { margin: 0, fontSize: '1.1rem' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  scroll: { overflowX: 'auto' },
} satisfies Record<string, CSSProperties>;

export function OfflineScreen({ onChangeFilters }: { onChangeFilters: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [filters] = useState(() => loadFilters().filters);
  const [options, setOptions] = useState<Options | null>(null);
  const [data, setData] = useState<Offline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => {
    const q = new URLSearchParams();
    for (const k of PARTICIPANT_FILTERS) if (filters[k]) q.set(k, filters[k]);
    return q.toString();
  }, [filters]);
  const ignored = FILTERS.filter((k) => filters[k] && !(PARTICIPANT_FILTERS as readonly string[]).includes(k));

  useEffect(() => {
    api<Options>('/research/options').then(setOptions).catch(() => undefined);
    api<Offline>(`/research/offline?${query}`).then(setData).catch((e: ApiError) => setError(e.messageKey));
  }, [query]);

  const n = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));
  const sec = (ms: number | null) => (ms === null ? '—' : (ms / 1000).toFixed(1));
  const label = (kind: string, v: unknown) => valueLabel(t, lang, options, kind, v);
  const th = (key: string, num = false) => <th key={key} style={{ ...ui.cell, ...(num ? s.num : {}) }}>{t(key)}</th>;
  const td = (v: React.ReactNode, num = false) => <td style={{ ...ui.cell, ...(num ? s.num : {}) }}>{v}</td>;

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="offline-screen">
      <section style={s.section}>
        <h2 style={s.h}>{t('analyst.offline.title')}</h2>
        <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.offline.intro')}</p>
        <p style={{ margin: 0 }}>
          {PARTICIPANT_FILTERS.some((k) => filters[k]) ? t('analyst.offline.filtered') : t('analyst.offline.unfiltered')}{' '}
          <button style={{ background: 'none', border: 0, padding: 0, color: 'var(--ilt-link)', cursor: 'pointer', font: 'inherit' }} onClick={onChangeFilters}>
            {t('analyst.export.change_filters')}
          </button>
        </p>
        {ignored.length > 0 && <p style={{ ...ui.muted, margin: 0 }} data-testid="offline-ignored">{t('analyst.offline.ignored')}</p>}
      </section>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      {!data && !error && <p style={ui.muted}>{t('common.checking')}</p>}
      {data && (
        <>
          <section style={s.section} aria-labelledby="paper-h">
            <h3 id="paper-h" style={s.h}>{t('analyst.offline.paper')}</h3>
            <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.offline.paper_note')}</p>
            <div style={s.scroll}>
              <table style={ui.table} data-testid="offline-anchors">
                <thead><tr>
                  {th('analyst.offline.anchor')}{th('analyst.offline.participants', true)}{th('analyst.offline.blocks', true)}
                  {th('analyst.time', true)}{th('analyst.pen_lifts', true)}{th('analyst.offline.accurate', true)}{th('analyst.accuracy', true)}
                </tr></thead>
                <tbody>
                  {data.anchors.map((a) => (
                    <tr key={a.key}>
                      {td(t(`summary.anchor.${a.key}`))}{td(a.participants, true)}{td(a.blocks, true)}{td(sec(a.avg_time_ms), true)}
                      {td(n(a.avg_pen_lifts), true)}{td(n(a.avg_accurate_letters), true)}{td(n(a.accuracy_pct), true)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Rows title={t('analyst.offline.paper_rows', { n: data.paper.total })} limited={data.paper.limited} empty={data.paper.total === 0}>
              <thead><tr>
                {th('analyst.study_code')}{th('analyst.grade')}{th('analyst.gender')}{th('analyst.stage')}{th('analyst.offline.block', true)}
                {th('analyst.pen_lifts', true)}{th('analyst.offline.accurate', true)}{th('analyst.time', true)}
              </tr></thead>
              <tbody>
                {data.paper.rows.map((r) => (
                  <tr key={`${r.study_code}-${r.session_type}-${r.block_number}`}>
                    {td(<bdi dir="ltr">{r.study_code}</bdi>)}{td(label('grade', r.grade_level))}{td(label('gender', r.gender))}{td(label('stage', r.session_type))}
                    {td(r.block_number, true)}{td(r.pen_lifts ?? '—', true)}{td(r.accurate_letters ?? '—', true)}{td(sec(r.total_time_ms), true)}
                  </tr>
                ))}
              </tbody>
            </Rows>
          </section>

          <section style={s.section} aria-labelledby="legacy-h">
            <h3 id="legacy-h" style={s.h}>{t('analyst.offline.legacy')}</h3>
            <p style={{ ...ui.muted, margin: 0 }}>{t('summary.legacy.help')}</p>
            {data.labels.length === 0 ? <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.offline.none')}</p> : (
              <div style={s.scroll}>
                <table style={ui.table} data-testid="offline-labels">
                  <thead><tr>
                    {th('analyst.offline.label')}{th('analyst.offline.participants', true)}{th('analyst.offline.blocks', true)}{th('analyst.pen_lifts', true)}
                    {th('summary.legacy.col.width', true)}{th('summary.legacy.col.total', true)}{th('summary.legacy.col.writing', true)}{th('summary.legacy.col.air', true)}
                  </tr></thead>
                  <tbody>
                    {data.labels.map((l) => (
                      <tr key={l.session_label}>
                        {td(<bdi>{l.session_label}</bdi>)}{td(l.participants, true)}{td(l.blocks, true)}{td(n(l.pen_lifts), true)}{td(n(l.width_mm), true)}
                        {td(sec(l.total_time_ms), true)}{td(sec(l.writing_time_ms), true)}{td(sec(l.air_time_ms), true)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Rows title={t('analyst.offline.legacy_rows', { n: data.legacy.total })} limited={data.legacy.limited} empty={data.legacy.total === 0}>
              <thead><tr>
                {th('analyst.study_code')}{th('analyst.offline.label')}{th('analyst.offline.block', true)}{th('analyst.pen_lifts', true)}
                {th('summary.legacy.col.width', true)}{th('summary.legacy.col.total', true)}{th('summary.legacy.col.writing', true)}{th('summary.legacy.col.air', true)}
              </tr></thead>
              <tbody>
                {data.legacy.rows.map((r) => (
                  <tr key={`${r.study_code}-${r.session_label}-${r.block_number}`}>
                    {td(<bdi dir="ltr">{r.study_code}</bdi>)}{td(<bdi>{r.session_label}</bdi>)}{td(r.block_number, true)}{td(r.pen_lifts ?? '—', true)}
                    {td(n(r.width_mm), true)}{td(sec(r.total_time_ms), true)}{td(sec(r.writing_time_ms), true)}{td(sec(r.air_time_ms), true)}
                  </tr>
                ))}
              </tbody>
            </Rows>
          </section>
        </>
      )}
    </div>
  );
}

/** A folded table of the rows themselves (at most 500), under the means. */
function Rows({ title, limited, empty, children }: { title: string; limited: boolean; empty: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  if (empty) return <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.offline.none')}</p>;
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>{title}</summary>
      {limited && <p style={{ ...ui.muted, marginBlock: '0.5rem' }}>{t('analyst.offline.limited')}</p>}
      <div style={s.scroll}><table style={ui.table}>{children}</table></div>
    </details>
  );
}
