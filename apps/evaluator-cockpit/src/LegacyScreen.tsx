// Legacy data (Phase 4d; FRS FR-LEG-1): import of the previous application's measure files (.xls, one
// measure each). "Check files" reads them and shows what would be imported without writing anything;
// "Import" creates the missing children as LEGACY participants (LEG-<number>) and fills their block
// rows. Importing the same files again updates the values instead of adding rows.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { pill, ui } from './styles';

const MEASURES = ['HAND_RAISES', 'SEGMENT_WIDTH', 'TOTAL_TIME', 'WRITING_TIME', 'AIR_TIME'] as const;
type Measure = (typeof MEASURES)[number];
/** First-strong isolate and pop: keeps a Latin file name whole inside a Hebrew sentence. */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);

interface Group { id: number; code: string; name_he: string; name_en: string; is_active: boolean }
interface Picked { name: string; content_base64: string; measure: Measure | '' }
interface FileResult { name: string; measure: Measure | null; detected: Measure | null; rows: number; blocks: number; warnings: string[]; error: string | null }
interface Result {
  dry_run: boolean;
  batch_id?: string;
  files: FileResult[];
  warnings: string[];
  children: number;
  new_children: number;
  existing_children: number;
  conflicts: string[];
  block_rows: number;
  rows_to_update: number;
  sample: { legacy_id: string; study_code: string; existing: boolean; hand: string | null; mistakes: number | null; blocks: number; block_1: Partial<Record<Measure, number>> | null }[];
}
interface Batch {
  id: string;
  imported_at: string;
  imported_by: string;
  session_label: string;
  domain_id: number;
  files: { name: string; measure: Measure; rows: number }[];
  participants_created: number;
  participants_matched: number;
  block_rows: number;
}

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h: { margin: 0, fontSize: '1.05rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))', gap: '0.75rem', alignItems: 'end' },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  notice: { margin: 0, padding: '0.6rem 0.8rem', borderRadius: 6, background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border-soft)', maxInlineSize: '60rem' },
  ok: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
} satisfies Record<string, CSSProperties>;

/** The measure a file name suggests, as the analytics service guesses it (it also reads the sheet name). */
const guess = (name: string): Measure | '' => {
  const low = name.toLowerCase();
  return low.includes('raise') ? 'HAND_RAISES' : low.includes('width') ? 'SEGMENT_WIDTH' : low.includes('total') ? 'TOTAL_TIME'
    : low.includes('writing') ? 'WRITING_TIME' : low.includes('air') ? 'AIR_TIME' : '';
};

const readBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export function LegacyScreen() {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const [domains, setDomains] = useState<Group[]>([]);
  const [files, setFiles] = useState<Picked[]>([]);
  const [domainId, setDomainId] = useState<number | null>(null);
  const [label, setLabel] = useState('Legacy');
  const [result, setResult] = useState<Result | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }), [i18n.language]);
  const num = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const loadBatches = () => api<Batch[]>('/legacy/imports').then(setBatches).catch((e: ApiError) => setError(e.messageKey));
  useEffect(() => {
    api<Group[]>('/domains').then((d) => {
      const active = d.filter((x) => x.is_active);
      setDomains(active);
      setDomainId((cur) => cur ?? active.find((x) => x.code === 'GENERAL')?.id ?? active[0]?.id ?? null);
    }).catch(() => undefined);
    void loadBatches();
  }, []);

  const pick = async (list: FileList | null) => {
    setResult(null);
    setError(null);
    if (!list) return;
    const picked: Picked[] = [];
    for (const f of Array.from(list).slice(0, 5)) picked.push({ name: f.name, content_base64: await readBase64(f), measure: guess(f.name) });
    setFiles(picked);
  };

  const run = async (dryRun: boolean) => {
    if (!domainId || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Result>('/legacy/import', {
        method: 'POST',
        body: { files: files.map((f) => ({ name: f.name, content_base64: f.content_base64, measure: f.measure || null })), domain_id: domainId, session_label: label.trim(), dry_run: dryRun },
      });
      setResult(r);
      // The measure the service settled on (detected from the sheet when the name said nothing).
      if (dryRun) setFiles((cur) => cur.map((f, i) => ({ ...f, measure: f.measure || (r.files[i]?.measure ?? '') })));
      if (!dryRun) void loadBatches();
    } catch (e) {
      setError((e as ApiError).messageKey);
    } finally {
      setBusy(false);
    }
  };

  const measureLabel = (m: Measure | null) => (m ? t(`legacy.measure.${m}`) : '—');
  const domainName = (id: number) => {
    const d = domains.find((x) => x.id === id);
    return d ? (he ? d.name_he : d.name_en) : String(id);
  };
  const okFiles = result?.files.filter((f) => !f.error).length ?? 0;
  /** Measures that two or more files claim; the import is blocked until they are corrected. */
  const twice = [...new Set((result?.files ?? []).filter((f) => f.error === 'measure_twice' && f.measure).map((f) => f.measure as Measure))];

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="legacy">
      <p style={s.notice}>{t('legacy.intro')}</p>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      <section style={s.section} aria-labelledby="legacy-new-h">
        <h3 id="legacy-new-h" style={s.h}>{t('legacy.new')}</h3>
        <label style={ui.field}>
          {t('legacy.files')}
          <input type="file" accept=".xls,application/vnd.ms-excel" multiple onChange={(e) => void pick(e.target.files)} data-testid="legacy-files" />
        </label>
        <p style={{ ...ui.muted, margin: 0 }}>{t('legacy.files_hint')}</p>
        {files.length > 0 && (
          <table style={ui.table} data-testid="legacy-picked">
            <thead><tr><th style={ui.cell}>{t('legacy.file')}</th><th style={ui.cell}>{t('legacy.measure_col')}</th><th style={ui.cell}>{t('legacy.mapping')}</th></tr></thead>
            <tbody>
              {files.map((f, i) => (
                <tr key={f.name + i}>
                  <td style={ui.cell}><bdi dir="ltr">{f.name}</bdi></td>
                  <td style={ui.cell}>
                    <select value={f.measure} onChange={(e) => { setResult(null); setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, measure: e.target.value as Measure | '' } : x))); }}
                      data-testid={`legacy-measure-${i}`}>
                      <option value="">{t('legacy.measure_auto')}</option>
                      {MEASURES.map((m) => <option key={m} value={m}>{measureLabel(m)}</option>)}
                    </select>
                  </td>
                  <td style={{ ...ui.cell, color: 'var(--ilt-muted)' }}>{f.measure ? t(`legacy.maps_to.${f.measure}`) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={s.grid}>
          <label style={ui.field}>
            {t('legacy.domain')}
            <select value={domainId ?? ''} onChange={(e) => { setResult(null); setDomainId(Number(e.target.value)); }} data-testid="legacy-domain">
              {domains.map((d) => <option key={d.id} value={d.id}>{he ? d.name_he : d.name_en}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('legacy.session_label')}
            <input value={label} maxLength={50} onChange={(e) => { setResult(null); setLabel(e.target.value); }} data-testid="legacy-label" />
          </label>
        </div>
        <p style={{ ...ui.muted, margin: 0 }}>{t('legacy.label_hint')}</p>
        <div style={s.row}>
          <button style={ui.button} disabled={busy || files.length === 0 || !label.trim()} onClick={() => void run(true)} data-testid="legacy-check">{t('legacy.check')}</button>
          <button style={ui.primary} disabled={busy || !result?.dry_run || result.children === 0 || okFiles === 0 || twice.length > 0} onClick={() => void run(false)} data-testid="legacy-import">
            {t('legacy.import', { count: result?.dry_run ? result.children : 0 })}
          </button>
          {busy && <span style={ui.muted}>{t('common.checking')}</span>}
        </div>

        {result && (
          <div style={{ display: 'grid', gap: '0.6rem' }} data-testid="legacy-result">
            {!result.dry_run && <p role="status" style={s.ok}>{t('legacy.done', { children: result.children, created: result.new_children, rows: result.block_rows })}</p>}
            <table style={ui.table} data-testid="legacy-file-results">
              <thead>
                <tr>
                  <th style={ui.cell}>{t('legacy.file')}</th><th style={ui.cell}>{t('legacy.measure_col')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('legacy.children')}</th><th style={{ ...ui.cell, ...s.num }}>{t('legacy.blocks')}</th><th style={ui.cell}>{t('legacy.state')}</th>
                </tr>
              </thead>
              <tbody>
                {result.files.map((f, i) => (
                  <tr key={f.name + i}>
                    <td style={ui.cell}><bdi dir="ltr">{f.name}</bdi></td>
                    <td style={ui.cell}>{measureLabel(f.measure)}{f.detected && f.measure !== f.detected && <span style={ui.muted}> ({t('legacy.detected', { m: measureLabel(f.detected) })})</span>}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{f.rows}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{f.blocks}</td>
                    <td style={ui.cell}>
                      {f.error ? <span style={pill('warn')}>{t(`legacy.error.${f.error.split(':')[0]}`)}</span> : <span style={pill('ok')}>{t('legacy.readable')}</span>}
                      {f.warnings.length > 0 && <span style={ui.muted}> · {t('legacy.warnings', { count: f.warnings.length })}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.dry_run && (
              <p style={{ margin: 0 }} data-testid="legacy-summary">
                {t('legacy.summary', { children: result.children, created: result.new_children, matched: result.existing_children, rows: result.block_rows })}
                {result.rows_to_update > 0 && <> {t('legacy.updates', { count: result.rows_to_update })}</>}
              </p>
            )}
            {twice.map((m) => (
              <p key={m} role="alert" style={ui.error} data-testid="legacy-twice">
                {t('legacy.twice', { measure: measureLabel(m), files: result.files.filter((f) => f.error === 'measure_twice' && f.measure === m).map((f) => FSI + f.name + PDI).join(', ') })}
              </p>
            ))}
            {result.conflicts.length > 0 &&<p role="alert" style={ui.error}>{t('legacy.conflicts', { codes: result.conflicts.join(', ') })}</p>}
            {[...result.warnings, ...result.files.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`))].length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer' }}>{t('legacy.warning_list')}</summary>
                <ul style={{ margin: '0.4rem 0 0', paddingInlineStart: '1.2rem' }} dir="ltr">
                  {[...result.warnings, ...result.files.flatMap((f) => f.warnings.map((w) => `${f.name}: ${w}`))].slice(0, 200).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
            {result.dry_run && result.sample.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={ui.table} data-testid="legacy-sample">
                  <caption style={{ textAlign: 'start', paddingBlockEnd: '0.4rem', color: 'var(--ilt-muted)' }}>{t('legacy.sample')}</caption>
                  <thead>
                    <tr>
                      <th style={ui.cell}>{t('legacy.old_number')}</th><th style={ui.cell}>{t('legacy.study_code')}</th><th style={ui.cell}>{t('legacy.hand')}</th>
                      <th style={{ ...ui.cell, ...s.num }}>{t('legacy.blocks')}</th>
                      {MEASURES.map((m) => <th key={m} style={{ ...ui.cell, ...s.num }}>{t('legacy.block1', { m: measureLabel(m) })}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sample.map((c) => (
                      <tr key={c.legacy_id}>
                        <td style={ui.cell}>{c.legacy_id}</td>
                        <td style={ui.cell}><bdi dir="ltr">{c.study_code}</bdi> {c.existing && <span style={pill('off')}>{t('legacy.existing')}</span>}</td>
                        <td style={ui.cell}>{c.hand ? t(`enum.hand.${c.hand}`) : t('legacy.not_recorded')}</td>
                        <td style={{ ...ui.cell, ...s.num }}>{c.blocks}</td>
                        {MEASURES.map((m) => <td key={m} style={{ ...ui.cell, ...s.num }}>{c.block_1?.[m] == null ? '—' : num.format(c.block_1[m]!)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      <section style={s.section} aria-labelledby="legacy-batches-h">
        <h3 id="legacy-batches-h" style={s.h}>{t('legacy.history')}</h3>
        {batches && batches.length === 0 && <p style={{ ...ui.muted, margin: 0 }}>{t('legacy.none')}</p>}
        {batches && batches.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="legacy-batches">
              <thead>
                <tr>
                  <th style={ui.cell}>{t('legacy.when')}</th><th style={ui.cell}>{t('legacy.by')}</th><th style={ui.cell}>{t('legacy.session_label')}</th>
                  <th style={ui.cell}>{t('legacy.domain')}</th><th style={ui.cell}>{t('legacy.files')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('legacy.created')}</th><th style={{ ...ui.cell, ...s.num }}>{t('legacy.matched')}</th><th style={{ ...ui.cell, ...s.num }}>{t('legacy.rows')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{when.format(new Date(b.imported_at))}</td>
                    <td style={ui.cell}>{b.imported_by}</td>
                    <td style={ui.cell}><bdi>{b.session_label}</bdi></td>
                    <td style={ui.cell}>{domainName(b.domain_id)}</td>
                    <td style={ui.cell}>{b.files.map((f) => measureLabel(f.measure)).join(', ')}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{b.participants_created}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{b.participants_matched}</td>
                    <td style={{ ...ui.cell, ...s.num }}>{b.block_rows}</td>
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
