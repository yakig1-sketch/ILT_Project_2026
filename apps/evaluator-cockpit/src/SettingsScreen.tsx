// Settings (FR-ORG-3…7, FR-CAN-12…14): System values, and the Domain or Region values that override
// them where the definition allows it. Changes are collected, reviewed and saved together; clinically
// governed ones are approved with a Research Director's PIN (FR-ROLE-3). History lists every change.
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { isolateSizes } from './bidi';
import { pill, tone, ui } from './styles';

type Scope = 'SYSTEM' | 'DOMAIN' | 'REGION';
type Value = string | number | boolean | null | Value[] | { [k: string]: Value };
type Source = 'DEFAULT' | 'SYSTEM' | 'DOMAIN' | 'REGION';

interface Definition {
  key: string;
  category: string;
  value_type: 'integer' | 'decimal' | 'boolean' | 'string' | 'enum' | 'json' | 'uuid';
  default_value: Value;
  min_value: number | null;
  max_value: number | null;
  enum_values: string[] | null;
  unit: string | null;
  override_scope: 'NONE' | 'DOMAIN' | 'REGION';
  requires_director_approval: boolean;
  description_he: string;
  description_en: string;
}
interface Named {
  name_he: string;
  name_en: string;
}
interface Catalogue {
  definitions: Definition[];
  languages: { code: string; name_native: string; name_en: string }[];
  /** recorded_direction: the fill direction the canvas's recorded fill order follows (FR-CAN-14). */
  canvases: (Named & { code: string; canvas_type: string; language_code: string; recorded_direction: string | null })[];
  letter_sets: (Named & { id: string; language_code: string })[];
  templates: (Named & { code: string; session_type: string })[];
}
interface Entry {
  stored?: Value;
  inherited: { value: Value; source: Source };
  effective: { value: Value; source: Source };
}
interface Values {
  values: Record<string, Entry>;
}
interface Group {
  id: number;
  code: string;
  name_he: string;
  name_en: string;
}
interface HistoryRow {
  id: number;
  key: string;
  old_value: Value;
  new_value: Value;
  reason: string | null;
  changed_at: string;
  changed_by: string;
  approved_by: string | null;
}
type Change = { value: Value } | { reset: true };

const WEIGHTS = ['scoring.composite.weight_speed_pct', 'scoring.composite.weight_accuracy_pct', 'scoring.composite.weight_pen_lifts_pct'];
const GOVERNANCE_KEY = 'governance.require_director_approval';
const CATEGORY_ORDER = ['SCORING', 'ILT_PROCESS', 'LANGUAGE', 'SYSTEM'];
const TEMPLATE_TYPE: Record<string, string> = { day1: 'DAY_1', day2: 'DAY_2', day14: 'DAY_14' };

const s = {
  scopeBar: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end', marginBlockEnd: '0.75rem' },
  seg: { display: 'inline-flex', border: '1px solid var(--ilt-border)', borderRadius: 6, overflow: 'hidden' },
  segBtn: { border: 0, background: 'var(--ilt-surface-2)', color: 'var(--ilt-muted)', paddingInline: '0.8rem', paddingBlock: '0.35rem', cursor: 'pointer' },
  segOn: { background: 'var(--ilt-accent)', color: '#fff', fontWeight: 600 },
  group: { marginBlockStart: '1.25rem', marginBlockEnd: '0.25rem', fontSize: '1rem' },
  sub: { marginBlockStart: '0.75rem', marginBlockEnd: '0.25rem', fontSize: '0.9rem', color: 'var(--ilt-muted)' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(14rem, 1.3fr) minmax(12rem, 1fr) auto', gap: '0.5rem 1rem', alignItems: 'center', paddingBlock: '0.5rem', borderBlockEnd: '1px solid var(--ilt-border-soft)' },
  changed: { background: 'var(--ilt-select)', marginInline: '-0.5rem', paddingInline: '0.5rem', borderRadius: 6 },
  key: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.75rem', color: 'var(--ilt-muted)' },
  footer: {
    position: 'sticky', insetBlockEnd: 0, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBlockStart: '1rem',
    padding: '0.75rem 1rem', background: 'var(--ilt-surface-2)', border: '1px solid var(--ilt-border)', borderRadius: 8, boxShadow: 'var(--ilt-shadow)',
  },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
  warn: { margin: 0, padding: '0.4rem 0.6rem', borderRadius: 6, background: 'var(--ilt-warn-bg)', color: 'var(--ilt-warn)', fontSize: '0.85rem', gridColumn: '1 / -1' },
} satisfies Record<string, CSSProperties>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const name = (x: Named) => (he ? isolateSizes(x.name_he) : x.name_en);
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [domains, setDomains] = useState<Group[]>([]);
  const [regions, setRegions] = useState<Group[]>([]);
  const [scope, setScope] = useState<Scope>('SYSTEM');
  const [targetId, setTargetId] = useState<number | null>(null);
  const [data, setData] = useState<Values | null>(null);
  const [approvalOn, setApprovalOn] = useState(true);
  const [changes, setChanges] = useState<Record<string, Change>>({});
  const [view, setView] = useState<'edit' | 'review' | 'history'>('edit');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<Catalogue>('/settings/catalogue').then(setCat).catch((e: ApiError) => setError(e.messageKey));
    api<Group[]>('/domains').then(setDomains).catch(() => undefined);
    api<Group[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);
  useEffect(() => {
    api<Values>('/settings/values?scope=SYSTEM')
      .then((v) => setApprovalOn(v.values[GOVERNANCE_KEY]?.effective.value !== false))
      .catch(() => undefined);
  }, [reload]);
  useEffect(() => {
    if (scope !== 'SYSTEM' && targetId === null) return;
    let alive = true;
    setData(null);
    api<Values>(`/settings/values?scope=${scope}${scope === 'SYSTEM' ? '' : `&target_id=${targetId}`}`)
      .then((v) => alive && setData(v))
      .catch((e: ApiError) => alive && setError(e.messageKey));
    return () => {
      alive = false;
    };
  }, [scope, targetId, reload]);

  const defs = useMemo(() => new Map((cat?.definitions ?? []).map((d) => [d.key, d])), [cat]);
  const pending = Object.keys(changes).length;

  function choose(next: Scope, id: number | null) {
    if (pending && !confirm(t('admin.settings.discard') + '?')) return;
    setChanges({});
    setRowErrors({});
    setError(null);
    setNotice(null);
    setScope(next);
    setTargetId(id);
    if (view === 'review') setView('edit');
  }

  /** The value a row shows now, with unsaved changes applied. */
  const current = (key: string): Value => {
    const c = changes[key];
    const e = data?.values[key];
    if (!e) return null;
    return c ? ('reset' in c ? e.inherited.value : c.value) : e.effective.value;
  };
  const isOwn = (key: string) => {
    const c = changes[key];
    return c ? !('reset' in c) : data?.values[key]?.stored !== undefined;
  };
  const change = (key: string, next: Change | null) => {
    setRowErrors(({ [key]: _gone, ...rest }) => rest);
    setChanges(({ [key]: _old, ...rest }) => {
      const e = data?.values[key];
      if (!next || !e) return rest;
      // Back to what is saved: no change at all. At System level a row without its own value is edited
      // directly, so typing the inherited value again is no change either. (At Domain or Region level
      // "Set own value" with the inherited value is a deliberate choice and stays.)
      if ('reset' in next ? e.stored === undefined : e.stored !== undefined && same(e.stored, next.value)) return rest;
      if (!('reset' in next) && e.stored === undefined && scope === 'SYSTEM' && same(e.inherited.value, next.value)) return rest;
      return { ...rest, [key]: next };
    });
  };

  function show(def: Definition | undefined, v: Value): string {
    if (!def) return JSON.stringify(v);
    const key = def.key;
    if (v === null) return t(key === 'scoring.pass_threshold' ? 'admin.settings.not_configured' : 'admin.settings.none');
    if (typeof v === 'boolean') return t(v ? 'admin.settings.on' : 'admin.settings.off');
    if (def.value_type === 'enum') return t(`admin.settings.enum.${String(v)}`);
    const lang = (code: unknown) => {
      const l = cat?.languages.find((x) => x.code === code);
      return l ? (he ? l.name_native : l.name_en) : String(code);
    };
    if (key === 'language.enabled' && Array.isArray(v)) return v.map(lang).join(', ');
    if (key === 'language.default') return lang(v);
    if (/\.(ilt_canvas|notebook_canvas)$/.test(key)) {
      const c = cat?.canvases.find((x) => x.code === v);
      return c ? `${name(c)} (${c.code})` : String(v);
    }
    if (key.endsWith('.letter_set')) {
      const set = cat?.letter_sets.find((x) => x.id === v);
      return set ? name(set) : String(v);
    }
    if (key.startsWith('ilt.protocol.')) {
      const tp = cat?.templates.find((x) => x.code === v);
      return tp ? `${name(tp)} (${tp.code})` : String(v);
    }
    return `${String(v)}${def.unit ? ` ${unitName(t, def.unit)}` : ''}`;
  }

  if (!cat) return error ? <p role="alert" style={ui.error}>{t(error)}</p> : null;

  const visible = cat.definitions.filter((d) => scope === 'SYSTEM' || d.override_scope === scope);
  const grouped = CATEGORY_ORDER.map((g) => ({
    g,
    defs: visible.filter((d) => (CATEGORY_ORDER.includes(d.category) ? d.category : 'SYSTEM') === g),
  })).filter((x) => x.defs.length);
  const governed = Object.keys(changes).filter((k) => defs.get(k)?.requires_director_approval || k === GOVERNANCE_KEY);
  const needsDirector = governed.length > 0 && (approvalOn || governed.includes(GOVERNANCE_KEY));
  const sourceName = (src: Source) => t(`admin.settings.source.${src}`);
  const groups = scope === 'DOMAIN' ? domains : regions;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    if (needsDirector && (!String(form.get('director_email') ?? '').trim() || !form.get('director_pin'))) {
      setError('admin.settings.director_missing');
      return;
    }
    try {
      const r = await api<{ changed: number }>('/settings', {
        method: 'PUT',
        body: {
          scope,
          ...(scope === 'SYSTEM' ? {} : { target_id: targetId }),
          changes: Object.entries(changes).map(([key, c]) => ({ key, ...c })),
          reason: String(form.get('reason') ?? '').trim() || undefined,
          ...(needsDirector ? { director_email: String(form.get('director_email') ?? '').trim(), director_pin: String(form.get('director_pin') ?? '') } : {}),
        },
      });
      setNotice(r.changed ? t('admin.settings.saved', { count: r.changed }) : t('admin.settings.nothing_changed'));
      setChanges({});
      setView('edit');
      setReload((n) => n + 1);
    } catch (err) {
      const ae = err as ApiError;
      if (ae.code === 'INVALID_SETTING') {
        const list = (ae.details as { errors?: { key: string; reason: string }[] })?.errors ?? [];
        setRowErrors(Object.fromEntries(list.map((x) => [x.key, x.reason])));
        setView('edit');
      } else if (ae.code === 'WEIGHTS_TOTAL' || ae.code === 'DEFAULT_LANGUAGE') {
        setView('edit');
      }
      setError(ae.code === 'WEIGHTS_TOTAL' ? 'admin.settings.weights_error' : ae.messageKey);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }} data-testid="settings">
      <div style={s.scopeBar}>
        <div style={ui.field}>
          {t('admin.settings.level')}
          <div style={s.seg} role="radiogroup" data-testid="settings-scope">
            {(['SYSTEM', 'DOMAIN', 'REGION'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={scope === k}
                style={{ ...s.segBtn, ...(scope === k ? s.segOn : {}) }}
                onClick={() => scope !== k && choose(k, k === 'SYSTEM' ? null : ((k === 'DOMAIN' ? domains : regions)[0]?.id ?? null))}
              >
                {t(`admin.settings.${k.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </div>
        {scope !== 'SYSTEM' && (
          <label style={ui.field}>
            {t(scope === 'DOMAIN' ? 'cockpit.domain' : 'cockpit.region')}
            <select value={targetId ?? ''} onChange={(e) => choose(scope, Number(e.target.value))} data-testid="settings-target">
              {groups.map((g) => <option key={g.id} value={g.id}>{name(g)}</option>)}
            </select>
          </label>
        )}
        <button type="button" style={{ ...ui.button, marginInlineStart: 'auto' }} aria-pressed={view === 'history'} onClick={() => setView(view === 'history' ? 'edit' : 'history')} data-testid="settings-history-toggle">
          {view === 'history' ? t('admin.settings.back') : t('admin.settings.history')}
        </button>
      </div>
      <p style={{ ...ui.muted, margin: 0, maxInlineSize: '52rem' }}>{t(`admin.settings.intro_${scope.toLowerCase()}`)}</p>
      {notice && <p role="status" style={s.notice}>{notice}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      {view === 'history' ? (
        <History scope={scope} targetId={targetId} defs={defs} show={show} label={(d) => (he ? d.description_he : d.description_en)} />
      ) : !data ? null : view === 'review' ? (
        <form onSubmit={save} style={{ ...ui.card, background: 'var(--ilt-surface-2)', display: 'grid', gap: '0.75rem' }} data-testid="settings-review">
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('admin.settings.review_title')}</h3>
          <table style={ui.table}>
            <thead>
              <tr>{['col.setting', 'col.old', 'col.new'].map((k) => <th key={k} style={ui.cell}>{t(`admin.settings.${k}`)}</th>)}</tr>
            </thead>
            <tbody>
              {visible.filter((d) => changes[d.key]).map((d) => {
                const key = d.key;
                const c = changes[key]!;
                const e = data.values[key]!;
                return (
                  <tr key={key}>
                    <td style={ui.cell}>{he ? d.description_he : d.description_en}</td>
                    <td style={ui.cell}>{e.stored !== undefined ? show(d, e.stored) : `${show(d, e.inherited.value)} ${t('admin.settings.removed')}`}</td>
                    <td style={ui.cell}>
                      {'reset' in c ? `${show(d, e.inherited.value)} ${t('admin.settings.removed')}` : show(d, c.value)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label style={ui.field}>
            {t('admin.settings.reason')}
            <textarea name="reason" rows={2} maxLength={500} />
          </label>
          {needsDirector && (
            <>
              <p style={{ ...ui.muted, margin: 0 }}>{t('admin.settings.approval')}</p>
              <div style={ui.row}>
                <label style={ui.field}>
                  {t('summary.director_email')}
                  <input name="director_email" type="email" dir="ltr" autoComplete="off" />
                </label>
                <label style={ui.field}>
                  {t('summary.director_pin')}
                  <input name="director_pin" type="password" inputMode="numeric" maxLength={8} dir="ltr" autoComplete="off" />
                </label>
              </div>
            </>
          )}
          <div style={ui.row}>
            <button type="submit" style={ui.primary}>{t('admin.settings.save')}</button>
            <button type="button" style={ui.button} onClick={() => setView('edit')}>{t('admin.settings.back')}</button>
          </div>
        </form>
      ) : (
        <>
          {grouped.map(({ g, defs: list }) => (
            <section key={g}>
              <h3 style={s.group}>{t(`admin.settings.group.${g}`)}</h3>
              {g === 'SCORING' && list.some((d) => WEIGHTS.includes(d.key)) && <WeightsTotal total={WEIGHTS.reduce((n, k) => n + Number(current(k) ?? 0), 0)} />}
              {g === 'LANGUAGE'
                ? languageBlocks(list).map(({ title, defs: sub }) => (
                  <div key={title}>
                    <h4 style={s.sub}>{title}</h4>
                    {sub.map((d) => row(d))}
                  </div>
                ))
                : list.map((d) => row(d))}
            </section>
          ))}
          {pending > 0 && (
            <div style={s.footer} data-testid="settings-pending">
              <strong>{t('admin.settings.pending', { count: pending })}</strong>
              <button type="button" style={ui.primary} onClick={() => { setError(null); setNotice(null); setView('review'); }}>{t('admin.settings.review')}</button>
              <button type="button" style={ui.button} onClick={() => { setChanges({}); setRowErrors({}); }}>{t('admin.settings.discard')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );

  function languageBlocks(list: Definition[]) {
    const general = list.filter((d) => !/^language\.[a-z]+\./.test(d.key));
    const blocks = [{ title: t('admin.settings.group.languages'), defs: general }];
    for (const l of cat!.languages) {
      const own = list.filter((d) => d.key.startsWith(`language.${l.code}.`));
      if (own.length) blocks.push({ title: he ? l.name_native : l.name_en, defs: own });
    }
    return blocks.filter((b) => b.defs.length);
  }

  function row(d: Definition): ReactNode {
    const e = data!.values[d.key];
    if (!e) return null;
    const label = he ? d.description_he : d.description_en;
    const own = isOwn(d.key);
    const c = changes[d.key];
    const hint = [
      t('admin.settings.default_is', { value: show(d, d.default_value) }),
      d.min_value !== null && d.max_value !== null ? t('admin.settings.range', { min: d.min_value, max: d.max_value }) : '',
    ].filter(Boolean).join(' · ');
    // FR-CAN-14: the canvas's recorded fill order is used; warn when the chosen direction disagrees with it.
    const fill = /^language\.([a-z]+)\.fill_direction$/.exec(d.key);
    const canvas = fill ? cat!.canvases.find((x) => x.code === current(`language.${fill[1]}.ilt_canvas`)) : undefined;
    const mismatch = !!canvas?.recorded_direction && canvas.recorded_direction !== current(d.key);
    const err = rowErrors[d.key];
    return (
      <div key={d.key} style={{ ...s.row, ...(c ? s.changed : {}) }} data-testid={`setting-${d.key}`}>
        <div title={hint}>
          <div>
            {label}
            {(d.requires_director_approval || d.key === GOVERNANCE_KEY) && (
              <span style={{ ...pill('warn'), marginInlineStart: '0.4rem', fontSize: '0.75rem' }}>{t('admin.settings.needs_director')}</span>
            )}
          </div>
          <div style={s.key} dir="ltr">{d.key}</div>
          <div style={ui.muted}>{hint}</div>
        </div>
        <div>
          {scope !== 'SYSTEM' && !own ? (
            <span style={ui.muted}>{t('admin.settings.inherited', { source: sourceName(e.inherited.source), value: show(d, e.inherited.value) })}</span>
          ) : (
            <Editor def={d} value={current(d.key)} cat={cat!} name={name} he={he} onChange={(v) => change(d.key, { value: v })} />
          )}
          {scope !== 'SYSTEM' && own && (
            <div style={ui.muted}>{t('admin.settings.without', { source: sourceName(e.inherited.source), value: show(d, e.inherited.value) })}</div>
          )}
          {err && <div style={{ ...ui.error, fontSize: '0.85rem' }}>{t(`admin.settings.reason_code.${err}`)}</div>}
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'end', flexWrap: 'wrap' }}>
          {scope !== 'SYSTEM' && !own && (
            <button type="button" style={ui.button} onClick={() => change(d.key, { value: e.inherited.value })}>{t('admin.settings.override')}</button>
          )}
          {scope !== 'SYSTEM' && own && (
            <button type="button" style={ui.button} onClick={() => change(d.key, { reset: true })}>{t('admin.settings.use_inherited', { source: sourceName(e.inherited.source) })}</button>
          )}
          {scope === 'SYSTEM' && own && (
            <button type="button" style={ui.button} onClick={() => change(d.key, { reset: true })}>{t('admin.settings.back_to_default')}</button>
          )}
          {c && <button type="button" style={ui.button} onClick={() => change(d.key, null)}>{t('admin.settings.undo')}</button>}
        </div>
        {mismatch && <p style={s.warn} data-testid="fill-mismatch">{t('admin.settings.fill_mismatch', { canvas: canvas!.code })}</p>}
      </div>
    );
  }
}

/** A unit in the interface language ("days" → "ימים"); units without a translation show as they are. */
function unitName(t: TFunction, unit: string): string {
  return t(`admin.settings.unit.${unit.replace('/', '_')}`, { defaultValue: unit });
}

function WeightsTotal({ total }: { total: number }) {
  const { t } = useTranslation();
  const ok = Math.abs(total - 100) < 0.001;
  return (
    <p style={{ margin: 0, fontSize: '0.85rem', color: ok ? 'var(--ilt-muted)' : tone.bad, fontWeight: ok ? 400 : 600 }} data-testid="weights-total">
      {t('admin.settings.weights_total', { total: Math.round(total * 100) / 100 })}
    </p>
  );
}

/** The input for one setting, by its type; canvas, letter-set, template and language settings offer their choices. */
function Editor({ def, value, cat, name, he, onChange }: {
  def: Definition;
  value: Value;
  cat: Catalogue;
  name: (x: Named) => string;
  he: boolean;
  onChange: (v: Value) => void;
}) {
  const { t } = useTranslation();
  const key = def.key;
  const select = (options: [string, string][], allowNone = false) => (
    <select value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} style={{ maxInlineSize: '100%' }}>
      {allowNone && <option value="">{t('admin.settings.none')}</option>}
      {!allowNone && !options.some(([v]) => v === String(value)) && <option value={String(value)}>{String(value)}</option>}
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );

  if (key === 'language.enabled') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {cat.languages.map((l) => (
          <label key={l.code} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={list.includes(l.code)}
              onChange={(e) => onChange(e.target.checked ? cat.languages.map((x) => x.code).filter((c) => c === l.code || list.includes(c)) : list.filter((c) => c !== l.code))}
            />
            {he ? l.name_native : l.name_en}
          </label>
        ))}
      </div>
    );
  }
  if (key === 'language.default') return select(cat.languages.map((l) => [l.code, he ? l.name_native : l.name_en]));
  const canvas = /^language\.([a-z]+)\.(ilt_canvas|notebook_canvas)$/.exec(key);
  if (canvas) {
    const type = canvas[2] === 'ilt_canvas' ? 'ILT_GRID' : 'NOTEBOOK';
    return select(cat.canvases.filter((c) => c.language_code === canvas[1] && c.canvas_type === type).map((c) => [c.code, `${name(c)} (${c.code})`]));
  }
  const letters = /^language\.([a-z]+)\.letter_set$/.exec(key);
  if (letters) return select(cat.letter_sets.filter((x) => x.language_code === letters[1]).map((x) => [x.id, name(x)]), true);
  const template = /^ilt\.protocol\.(day\d+)_template$/.exec(key);
  if (template) return select(cat.templates.filter((x) => x.session_type === TEMPLATE_TYPE[template[1]!]).map((x) => [x.code, `${name(x)} (${x.code})`]));
  if (def.value_type === 'boolean') {
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">{t('admin.settings.on')}</option>
        <option value="false">{t('admin.settings.off')}</option>
      </select>
    );
  }
  if (def.value_type === 'enum') return select((def.enum_values ?? []).map((v) => [v, t(`admin.settings.enum.${v}`)]));
  if (def.value_type === 'integer' || def.value_type === 'decimal') {
    return (
      <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
        <input
          type="number"
          dir="ltr"
          style={{ inlineSize: '7rem' }}
          min={def.min_value ?? undefined}
          max={def.max_value ?? undefined}
          step={def.value_type === 'integer' ? 1 : 'any'}
          placeholder={def.default_value === null ? t('admin.settings.not_configured') : ''}
          value={value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? (def.default_value === null ? null : '') : Number(e.target.value))}
        />
        {def.unit && <span style={ui.muted}>{unitName(t, def.unit)}</span>}
      </span>
    );
  }
  return <input dir="ltr" maxLength={100} value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />;
}

function History({ scope, targetId, defs, show, label }: {
  scope: Scope;
  targetId: number | null;
  defs: Map<string, Definition>;
  show: (d: Definition | undefined, v: Value) => string;
  label: (d: Definition) => string;
}) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<HistoryRow[] | null>(null);
  const [key, setKey] = useState('');
  // A setting picked at another level may not exist at this one: show them all again.
  useEffect(() => {
    if (key && scope !== 'SYSTEM' && defs.get(key)?.override_scope !== scope) setKey('');
  }, [scope, key, defs]);
  useEffect(() => {
    let alive = true;
    setList(null);
    const q = new URLSearchParams({ scope, ...(targetId !== null ? { target_id: String(targetId) } : {}), ...(key ? { key } : {}) });
    api<HistoryRow[]>(`/settings/history?${q}`).then((r) => alive && setList(r)).catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [scope, targetId, key]);
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }} data-testid="settings-history">
      <label style={{ ...ui.field, maxInlineSize: '28rem' }}>
        {t('admin.settings.col.setting')}
        <select value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">{t('admin.settings.all_settings')}</option>
          {[...defs.values()].filter((d) => scope === 'SYSTEM' || d.override_scope === scope).map((d) => <option key={d.key} value={d.key}>{label(d)}</option>)}
        </select>
      </label>
      {list && list.length === 0 && <p style={ui.muted}>{t('admin.settings.history_none')}</p>}
      {list && list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table}>
            <thead>
              <tr>{['when', 'setting', 'old', 'new', 'by', 'approved', 'reason'].map((k) => <th key={k} style={ui.cell}>{t(`admin.settings.col.${k}`)}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((h) => {
                const d = defs.get(h.key);
                return (
                  <tr key={h.id}>
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{when.format(new Date(h.changed_at))}</td>
                    <td style={ui.cell}>{d ? label(d) : h.key}</td>
                    <td style={ui.cell}>{h.old_value === null ? '—' : show(d, h.old_value)}</td>
                    <td style={ui.cell}>{h.new_value === null ? t('admin.settings.removed') : show(d, h.new_value)}</td>
                    <td style={ui.cell}>{h.changed_by}</td>
                    <td style={ui.cell}>{h.approved_by ?? '—'}</td>
                    <td style={{ ...ui.cell, ...ui.muted }}>{h.reason ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
