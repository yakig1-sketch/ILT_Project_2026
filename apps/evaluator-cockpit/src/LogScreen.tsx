// Action-log search for the System Administrator (FR-LOG-3, DDD §12): time range, event types by
// area, severity, user, session code, Domain/Region and free text; newest first, paged; details per
// entry; CSV export of the matches. The log is read-only here (FR-LOG-4).
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LOG_EVENT_TYPES, LOG_SEVERITIES } from '@ilt/shared-types';
import { ApiError, api, apiFile, saveFile } from './api';
import { ui } from './styles';

interface LogEvent {
  id: string;
  occurred_at: string;
  severity: string;
  event_type: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  device_id: string | null;
  domain_code: string | null;
  region_code: string | null;
  session_code: string | null;
  entity_type: string | null;
  entity_id: string | null;
  client_ip: string | null;
  message: string;
  details: Record<string, unknown>;
}
interface Page { events: LogEvent[]; next: string | null; total: number | null; total_capped: boolean }
interface Person { id: string; full_name: string; email: string }
interface Group { id: number; code: string }

interface Filter {
  from: string; // datetime-local, the browser's time zone
  to: string;
  types: string[];
  severity: string[];
  user_id: string;
  session_code: string;
  domain_id: string;
  region_id: string;
  q: string;
}

const AREAS = [...new Set(LOG_EVENT_TYPES.map((x) => x.split('.')[0]!))];
const PAGE = 100;

/** A Date as the value of a datetime-local input. */
const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const daysAgo = (n: number) => local(new Date(Date.now() - n * 86_400_000));
const empty = (): Filter => ({ from: daysAgo(7), to: '', types: [], severity: [], user_id: '', session_code: '', domain_id: '', region_id: '', q: '' });

/** Lower case with single spaces, for comparing free text with an event's displayed name. */
const fold = (x: string) => x.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** The query string of a filter (times sent as UTC instants); `names` gives an event type's displayed names. */
function query(f: Filter, names?: (type: string) => string[]): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set('from', new Date(f.from).toISOString());
  if (f.to) p.set('to', new Date(f.to).toISOString());
  if (f.types.length) p.set('types', f.types.join(','));
  if (f.severity.length) p.set('severity', f.severity.join(','));
  if (f.user_id) p.set('user_id', f.user_id);
  if (f.session_code.trim()) p.set('session_code', f.session_code.trim());
  if (f.domain_id) p.set('domain_id', f.domain_id);
  if (f.region_id) p.set('region_id', f.region_id);
  if (f.q.trim()) {
    p.set('q', f.q.trim());
    // Free text also finds the entries whose event name contains it ("Paper scores entered").
    const q = fold(f.q);
    const types = names ? LOG_EVENT_TYPES.filter((type) => names(type).some((n) => fold(n).includes(q))) : [];
    if (types.length) p.set('q_types', types.join(','));
  }
  return p;
}

const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');

const sevStyle = (sev: string): CSSProperties => {
  const tone = sev === 'ERROR' || sev === 'SECURITY' ? 'bad' : sev === 'WARN' ? 'warn' : 'off';
  return {
    paddingInline: '0.5rem', paddingBlock: '0.1rem', borderRadius: 999, fontSize: '0.8rem', whiteSpace: 'nowrap',
    background: `var(--ilt-${tone}-bg)`, color: tone === 'off' ? 'var(--ilt-muted)' : `var(--ilt-${tone})`,
  };
};

const s = {
  filters: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))', gap: '0.75rem', alignItems: 'end', marginBlockEnd: '0.75rem' },
  wide: { gridColumn: 'span 2' },
  input: { inlineSize: '100%', boxSizing: 'border-box' },
  quick: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center', marginBlockEnd: '0.75rem' },
  link: { border: 0, background: 'transparent', color: 'var(--ilt-link)', cursor: 'pointer', padding: 0, fontSize: '0.85rem' },
  popover: {
    position: 'absolute', zIndex: 5, insetInlineStart: 0, insetBlockStart: 'calc(100% + 4px)', inlineSize: 'min(36rem, 90vw)', maxBlockSize: '24rem',
    overflow: 'auto', background: 'var(--ilt-surface)', border: '1px solid var(--ilt-border)', borderRadius: 8, boxShadow: 'var(--ilt-shadow)', padding: '0.75rem',
  },
  areaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '0.75rem' },
  check: { display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBlockEnd: '0.75rem' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
  warn: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-warn-bg)', color: 'var(--ilt-warn)' },
  row: { cursor: 'pointer' },
  code: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.8rem', color: 'var(--ilt-muted)' },
  pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.8rem' },
  detail: { background: 'var(--ilt-surface-2)', padding: '0.75rem', display: 'grid', gap: '0.5rem' },
} satisfies Record<string, CSSProperties>;

export function LogScreen() {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState<Filter>(empty);
  const [applied, setApplied] = useState<Filter>(draft);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [domains, setDomains] = useState<Group[]>([]);
  const [regions, setRegions] = useState<Group[]>([]);
  const when = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'medium' }), [i18n.language]);
  const label = (type: string) => t(`admin.log.event.${type.replace(/\./g, '_')}`, { defaultValue: type });
  /** An event type's names in the current language and in English (an English name typed in Hebrew still finds it). */
  const names = (type: string) => [label(type), i18n.t(`admin.log.event.${type.replace(/\./g, '_')}`, { lng: 'en', defaultValue: type })];

  useEffect(() => {
    api<Person[]>('/users').then((u) => setPeople([...u].sort((a, b) => a.full_name.localeCompare(b.full_name, i18n.language)))).catch(() => undefined);
    api<Group[]>('/domains?all=true').then(setDomains).catch(() => undefined);
    api<Group[]>('/regions?all=true').then(setRegions).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badRange = !!draft.from && !!draft.to && new Date(draft.from) >= new Date(draft.to);

  async function load(f: Filter, before?: string) {
    setBusy(true);
    setError(null);
    try {
      const p = query(f, names);
      p.set('limit', String(PAGE));
      if (before) p.set('before', before);
      const next = await api<Page>(`/log/events?${p}`);
      setPage((prev) => (before && prev ? { ...next, events: [...prev.events, ...next.events], total: prev.total, total_capped: prev.total_capped } : next));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load(applied);
  }, [applied]);

  function search(e?: FormEvent) {
    e?.preventDefault();
    if (badRange) return;
    setNotice(null);
    setOpen(null);
    setApplied({ ...draft });
  }

  async function exportCsv() {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const file = await apiFile(`/log/events.csv?${query(applied, names)}`);
      saveFile(file.blob, file.filename);
      const rows = Number(file.headers.get('x-ilt-rows') ?? 0);
      const truncated = file.headers.get('x-ilt-truncated') === 'true';
      setNotice({ text: t(truncated ? 'admin.log.export_truncated' : 'admin.log.exported', { count: rows }), warn: truncated });
    } catch (e) {
      setError(message(e));
    } finally {
      setExporting(false);
    }
  }

  const set = <K extends keyof Filter>(k: K, v: Filter[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const toggle = (k: 'types' | 'severity', v: string) => set(k, draft[k].includes(v) ? draft[k].filter((x) => x !== v) : [...draft[k], v]);
  const quick = (days: number | null) => setDraft((d) => ({ ...d, from: days === null ? '' : daysAgo(days), to: '' }));

  const total = page?.total ?? 0;
  return (
    <div data-testid="action-log">
      <p style={{ ...ui.muted, marginBlockStart: 0, maxInlineSize: '52rem' }}>{t('admin.log.intro')}</p>
      <form onSubmit={search}>
        <div style={s.filters}>
          <label style={ui.field}>
            {t('admin.log.from')}
            <input type="datetime-local" style={s.input} value={draft.from} onChange={(e) => set('from', e.target.value)} data-testid="log-from" />
          </label>
          <label style={ui.field}>
            {t('admin.log.to')}
            <input type="datetime-local" style={s.input} value={draft.to} onChange={(e) => set('to', e.target.value)} data-testid="log-to" />
          </label>
          <TypePicker selected={draft.types} onToggle={(v) => toggle('types', v)} onSet={(v) => set('types', v)} label={label} />
          <label style={ui.field}>
            {t('admin.log.user')}
            <select style={s.input} value={draft.user_id} onChange={(e) => set('user_id', e.target.value)} data-testid="log-user">
              <option value="">{t('admin.log.user_all')}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.email})</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('admin.log.session')}
            <input style={s.input} dir="ltr" value={draft.session_code} onChange={(e) => set('session_code', e.target.value)} placeholder="S261105-ABCD" data-testid="log-session" />
          </label>
          <label style={ui.field}>
            {t('admin.log.domain')}
            <select style={s.input} value={draft.domain_id} onChange={(e) => set('domain_id', e.target.value)}>
              <option value="">{t('admin.log.all')}</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('admin.log.region')}
            <select style={s.input} value={draft.region_id} onChange={(e) => set('region_id', e.target.value)}>
              <option value="">{t('admin.log.all')}</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
          </label>
          <label style={{ ...ui.field, ...s.wide }}>
            {t('admin.log.q')}
            <input type="search" style={s.input} value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder={t('admin.log.q_hint')} data-testid="log-q" />
          </label>
        </div>
        <div style={s.quick}>
          <span style={ui.muted}>{t('admin.log.severity')}:</span>
          {LOG_SEVERITIES.map((v) => (
            <label key={v} style={s.check}>
              <input type="checkbox" checked={draft.severity.includes(v)} onChange={() => toggle('severity', v)} />
              <span style={sevStyle(v)}>{t(`admin.log.sev.${v}`)}</span>
            </label>
          ))}
          <span style={{ flex: 1 }} />
          {([[1, 'last_24h'], [7, 'last_7d'], [30, 'last_30d'], [null, 'any_time']] as const).map(([d, k]) => (
            <button key={k} type="button" style={s.link} onClick={() => quick(d)}>{t(`admin.log.${k}`)}</button>
          ))}
        </div>
        <div style={s.actions}>
          <button type="submit" style={ui.primary} disabled={busy || badRange} data-testid="log-search">{t('admin.log.search')}</button>
          <button type="button" style={ui.button} onClick={() => { const e = empty(); setDraft(e); setApplied(e); setNotice(null); }}>{t('admin.log.reset')}</button>
          <span style={{ flex: 1 }} />
          {page && (
            <span style={ui.muted} data-testid="log-total">
              {page.total_capped ? t('admin.log.found_capped', { count: total }) : t('admin.log.found', { count: total })}
            </span>
          )}
          <button type="button" style={ui.button} onClick={() => void exportCsv()} disabled={exporting || !page || total === 0} data-testid="log-export">
            {t(exporting ? 'admin.log.exporting' : 'admin.log.export')}
          </button>
        </div>
      </form>
      {badRange && <p role="alert" style={{ ...ui.error, marginBlockEnd: '0.75rem' }}>{t('admin.log.range_bad')}</p>}
      {notice && <p role="status" style={{ ...(notice.warn ? s.warn : s.notice), marginBlockEnd: '0.75rem' }}>{notice.text}</p>}
      {error && <p role="alert" style={{ ...ui.error, marginBlockEnd: '0.75rem' }}>{t(error)}</p>}

      {page && page.events.length === 0 && <p style={ui.muted}>{t('admin.log.none')}</p>}
      {page && page.events.length > 0 && (
        <>
          <p style={{ ...ui.muted, marginBlock: '0 0.35rem' }}>{t('admin.log.row_hint')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="log-table">
              <thead>
                <tr>
                  {(['when', 'sev', 'event', 'user', 'session', 'group', 'message'] as const).map((k) => (
                    <th key={k} style={ui.cell}>{t(`admin.log.col_${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.events.map((e) => (
                  <Fragment key={e.id}>
                    <tr style={s.row} onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                      <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{when.format(new Date(e.occurred_at))}</td>
                      <td style={ui.cell}><span style={sevStyle(e.severity)}>{t(`admin.log.sev.${e.severity}`, { defaultValue: e.severity })}</span></td>
                      <td style={ui.cell}>
                        {label(e.event_type)}
                        <div style={s.code}><bdi dir="ltr">{e.event_type}</bdi></div>
                      </td>
                      <td style={ui.cell}>
                        {e.actor_name ?? '—'}
                        {e.actor_role && <div style={ui.muted}>{t(`enum.role.${e.actor_role}`, { defaultValue: e.actor_role })}</div>}
                      </td>
                      <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}><bdi dir="ltr">{e.session_code ?? '—'}</bdi></td>
                      <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}><bdi dir="ltr">{[e.domain_code, e.region_code].filter(Boolean).join(' · ') || '—'}</bdi></td>
                      <td style={ui.cell}><span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{e.message}</span></td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={7} style={{ ...ui.cell, padding: 0 }}>
                          <div style={s.detail} data-testid="log-detail">
                            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                              <span>{t('admin.log.event_code')}: <bdi dir="ltr" style={s.code}>{e.event_type}</bdi></span>
                              {e.actor_email && <span>{t('admin.log.user')}: <bdi dir="ltr">{e.actor_email}</bdi></span>}
                              {e.entity_type && <span>{t('admin.log.entity')}: <bdi dir="ltr">{e.entity_type}{e.entity_id ? ` ${e.entity_id}` : ''}</bdi></span>}
                              {e.device_id && <span>{t('admin.log.device')}: <bdi dir="ltr">{e.device_id}</bdi></span>}
                              {e.client_ip && <span>{t('admin.log.ip')}: <bdi dir="ltr">{e.client_ip}</bdi></span>}
                            </div>
                            <pre dir="ltr" style={s.pre}>{JSON.stringify(e.details, null, 2)}</pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {page.next && (
            <div style={{ textAlign: 'center', marginBlockStart: '0.75rem' }}>
              <button style={ui.button} disabled={busy} onClick={() => void load(applied, page.next!)} data-testid="log-more">
                {t(busy ? 'admin.log.loading' : 'admin.log.more')}
              </button>
            </div>
          )}
        </>
      )}
      {!page && busy && <p style={ui.muted}>{t('admin.log.loading')}</p>}
    </div>
  );
}

/** The event-type multi-select, grouped by area (DDD §12). No selection means every type. */
function TypePicker({ selected, onToggle, onSet, label }: {
  selected: string[];
  onToggle: (type: string) => void;
  onSet: (types: string[]) => void;
  label: (type: string) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Escape or a click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const click = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', key);
    document.addEventListener('mousedown', click);
    return () => {
      window.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', click);
    };
  }, [open]);
  const summary = selected.length === 0 ? t('admin.log.types_all') : selected.length === 1 ? label(selected[0]!) : t('admin.log.types_n', { count: selected.length });
  return (
    <div ref={root} style={{ ...ui.field, position: 'relative' }}>
      <span>{t('admin.log.types')}</span>
      <button type="button" style={{ ...ui.button, textAlign: 'start', inlineSize: '100%' }} aria-expanded={open} onClick={() => setOpen(!open)} data-testid="log-types">
        {summary} ▾
      </button>
      {open && (
        <div style={s.popover} data-testid="log-types-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockEnd: '0.5rem' }}>
            <button type="button" style={s.link} onClick={() => onSet([])}>{t('admin.log.clear_types')}</button>
            <button type="button" style={s.link} onClick={() => setOpen(false)}>{t('admin.log.hide')}</button>
          </div>
          <div style={s.areaGrid}>
            {AREAS.map((area) => {
              const types: string[] = LOG_EVENT_TYPES.filter((x) => x.split('.')[0] === area);
              const all = types.every((x) => selected.includes(x));
              const some = !all && types.some((x) => selected.includes(x));
              return (
                <fieldset key={area} style={{ border: '1px solid var(--ilt-border-soft)', borderRadius: 6, margin: 0, padding: '0.5rem' }}>
                  <legend style={{ fontWeight: 600, fontSize: '0.85rem' }}>{t(`admin.log.area.${area}`)}</legend>
                  <label style={s.check}>
                    <input
                      type="checkbox"
                      checked={all}
                      ref={(el) => { if (el) el.indeterminate = some; }}
                      onChange={() => onSet(all ? selected.filter((x) => !types.includes(x)) : [...new Set([...selected, ...types])])}
                    />
                    <em>{t('admin.log.area_all')}</em>
                  </label>
                  {types.map((x) => (
                    <label key={x} style={s.check} title={x}>
                      <input type="checkbox" checked={selected.includes(x)} onChange={() => onToggle(x)} />
                      {label(x)}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
