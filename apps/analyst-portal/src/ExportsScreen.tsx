// Research exports (Phase 4c; FRS FR-AN-2): Parquet or CSV files of the research sessions that match the
// research screen's filters, built by the analytics service and downloaded through a 15-minute link.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { pill, ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { valueLabel, type Options } from './labels';
import { FILTERS, loadFilters, type FilterKey, type Filters } from './ResearchScreen';

interface ExportRow {
  id: string;
  requested_at: string;
  status: 'RUNNING' | 'READY' | 'FAILED';
  format: 'PARQUET' | 'CSV';
  filters: Partial<Filters>;
  include_samples: boolean;
  include_kinematics: boolean;
  session_count: number;
  size_bytes: number | null;
  row_counts: Record<string, number> | null;
  finished_at: string | null;
}

/** The value kind of each filter, for its label (see labels.ts). */
const KIND: Record<FilterKey, string> = {
  domain_id: 'domain', region_id: 'region', school: 'school', grade: 'grade', gender: 'gender', ses: 'ses', hand: 'hand',
  language: 'language', session_type: 'stage', canvas: 'canvas', inactivity_sec: 'inactivity', from: 'date', to: 'date',
};
const TITLE: Record<FilterKey, string> = {
  domain_id: 'domain', region_id: 'region', school: 'school', grade: 'grade', gender: 'gender', ses: 'ses', hand: 'hand',
  language: 'language', session_type: 'stage', canvas: 'canvas', inactivity_sec: 'inactivity', from: 'from', to: 'to',
};

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h: { margin: 0, fontSize: '1.1rem' },
  row: { display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  option: { display: 'inline-flex', gap: '0.4rem', alignItems: 'center' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  notice: { margin: 0, padding: '0.6rem 0.8rem', borderRadius: 6, background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border-soft)', maxInlineSize: '60rem' },
} satisfies Record<string, CSSProperties>;

const sizeLabel = (bytes: number | null, lang: string) => {
  if (bytes == null) return '—';
  const f = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  return bytes >= 1048576 ? `${f.format(bytes / 1048576)} MB` : `${f.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
};

export function ExportsScreen({ onChangeFilters }: { onChangeFilters: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [filters] = useState(() => loadFilters().filters);
  const [options, setOptions] = useState<Options | null>(null);
  const [matching, setMatching] = useState<number | null>(null);
  const [format, setFormat] = useState<'PARQUET' | 'CSV'>('PARQUET');
  const [samples, setSamples] = useState(false);
  const [kinematics, setKinematics] = useState(false);
  const [list, setList] = useState<ExportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);

  // The filters as sent: the set ones, plus the time zone for the completion dates.
  const sent = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of FILTERS) if (filters[k]) out[k] = filters[k];
    if (out.from || out.to) out.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return out;
  }, [filters]);

  const refresh = useCallback(() => {
    api<{ exports: ExportRow[] }>('/research/exports').then((r) => setList(r.exports)).catch((e: ApiError) => setError(e.messageKey));
  }, []);
  useEffect(() => {
    api<Options>('/research/options').then(setOptions).catch(() => undefined);
    api<{ total: number }>(`/research/sessions?${new URLSearchParams(sent)}`).then((r) => setMatching(r.total)).catch((e: ApiError) => setError(e.messageKey));
    refresh();
  }, [sent, refresh]);
  // While an export is being built, look again every 2 seconds.
  const running = list?.some((x) => x.status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [running, refresh]);

  const describe = (f: Partial<Filters>) => {
    const parts = FILTERS.filter((k) => f[k]).map((k) => {
      const v = f[k]!;
      const value = KIND[k] === 'date' ? v : v === 'NONE' ? t('analyst.not_recorded') : valueLabel(t, lang, options, KIND[k], v);
      return `${t(`analyst.${TITLE[k]}`)}: ${value}`;
    });
    return parts.length ? parts.join(' · ') : t('analyst.export.no_filters');
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/research/exports', { method: 'POST', body: { filters: sent, format, include_samples: samples, include_kinematics: kinematics } });
      refresh();
    } catch (e) {
      setError((e as ApiError).messageKey);
    } finally {
      setBusy(false);
    }
  };
  const download = async (id: string) => {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/research/exports/${id}/link`, { method: 'POST', body: {} });
      window.location.assign(url);
    } catch (e) {
      setError((e as ApiError).messageKey);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="exports">
      <p style={s.notice}>{t('analyst.export.intro')}</p>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      <section style={s.section} aria-labelledby="new-export-h">
        <h2 id="new-export-h" style={s.h}>{t('analyst.export.new')}</h2>
        <div style={s.row}>
          <span data-testid="export-matching">{matching == null ? t('common.checking') : t('analyst.export.matching', { count: matching })}</span>
          <button style={ui.button} onClick={onChangeFilters}>{t('analyst.export.change_filters')}</button>
        </div>
        <p style={{ ...ui.muted, margin: 0 }} data-testid="export-filters">{describe(filters)}</p>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
          <legend style={{ fontWeight: 600, marginBlockEnd: '0.3rem' }}>{t('analyst.export.format')}</legend>
          {(['PARQUET', 'CSV'] as const).map((f) => (
            <label key={f} style={s.option}>
              <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
              {t(`analyst.export.format_${f}`)}
            </label>
          ))}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
          <legend style={{ fontWeight: 600, marginBlockEnd: '0.3rem' }}>{t('analyst.export.contents')}</legend>
          <span style={ui.muted}>{t('analyst.export.always')}</span>
          <label style={s.option}><input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} data-testid="export-samples" />{t('analyst.export.samples')}</label>
          <label style={s.option}><input type="checkbox" checked={kinematics} onChange={(e) => setKinematics(e.target.checked)} data-testid="export-kinematics" />{t('analyst.export.kinematics')}</label>
        </fieldset>
        <div>
          <button style={ui.primary} disabled={busy || !matching} onClick={() => void create()} data-testid="export-create">
            {t('analyst.export.create', { count: matching ?? 0 })}
          </button>
        </div>
      </section>

      <section style={s.section} aria-labelledby="my-exports-h">
        <h2 id="my-exports-h" style={s.h}>{t('analyst.export.mine')}</h2>
        <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.export.mine_note')}</p>
        {list && list.length === 0 && <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.export.none')}</p>}
        {list && list.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="exports-table">
              <thead>
                <tr>
                  <th style={ui.cell}>{t('analyst.export.requested')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('analyst.sessions')}</th>
                  <th style={ui.cell}>{t('analyst.export.format')}</th>
                  <th style={ui.cell}>{t('analyst.export.contents')}</th>
                  <th style={ui.cell}>{t('analyst.filters')}</th>
                  <th style={ui.cell}>{t('analyst.status')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('analyst.export.size')}</th>
                  <th style={ui.cell} />
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id}>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{when.format(new Date(x.requested_at))}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{x.session_count}</td>
                    <td style={ui.cell}>{x.format === 'PARQUET' ? 'Parquet' : 'CSV'}</td>
                    <td style={ui.cell}>
                      {[t('analyst.export.tables'), x.include_samples && t('analyst.export.samples_short'), x.include_kinematics && t('analyst.export.kinematics_short')].filter(Boolean).join(', ')}
                    </td>
                    <td style={{ ...ui.cell, maxInlineSize: '24rem' }}>{describe(x.filters)}</td>
                    <td style={ui.cell}>
                      <span style={pill(x.status === 'READY' ? 'ok' : x.status === 'FAILED' ? 'warn' : 'off')}>{t(`analyst.export.status.${x.status}`)}</span>
                    </td>
                    <td style={{ ...ui.cell, ...s.num, whiteSpace: 'nowrap' }}><bdi dir="ltr">{sizeLabel(x.size_bytes, lang)}</bdi></td>
                    <td style={{ ...ui.cell, textAlign: 'end' }}>
                      {x.status === 'READY' && <button style={ui.button} onClick={() => void download(x.id)}>{t('analyst.export.download')}</button>}
                    </td>
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
