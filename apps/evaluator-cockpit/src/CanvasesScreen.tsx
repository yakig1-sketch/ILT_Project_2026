// Canvas library (FRS §5, FR-CAN-1…8), a tab of the Administrator cockpit: canvas sets per language
// and type, loading a canvas as a Draft, the true-size preview with its problems, the scoring
// profile, activation with a Research Director's approval, versions, retiring, and Domain
// overrides of the profile. Reference mode (true-size preview on a tablet, sample block and normal
// speed recordings) is in ReferencePanel. The gateway checks everything again.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DTH_A116 } from '@ilt/shared-types';
import { CanvasView } from '@ilt/ui';
import { fillOrderFor, mergeProfile, type CanvasGeometry, type ScoringProfile } from '@ilt/template-schemas';
import { ApiError, api } from './api';
import { isolateSizes } from './bidi';
import { ReferencePanel, type Recording } from './ReferencePanel';
import { pill, tone, ui } from './styles';
import { BackButton, LoadError } from './BackButton';

const SET_TYPES = ['ILT', 'NOTEBOOK', 'INTERVENTION_LETTERS'] as const;
type SetType = (typeof SET_TYPES)[number];
type Status = 'DRAFT' | 'ACTIVE' | 'RETIRED';
const GOVERNANCE_KEY = 'governance.require_director_approval';
/** Approximate CSS px per mm of a desktop screen (96 dpi); the tablet's own size is checked on the tablet. */
const SCREEN_PX_PER_MM = 96 / 25.4;

interface Named { name_he: string; name_en: string }
interface CanvasSummary extends Named {
  id: string;
  code: string;
  version: number;
  status: Status;
  canvas_type: string;
  created_at: string;
  activated_at: string | null;
  overrides: number;
}
interface CanvasSet extends Named {
  id: string;
  language_code: string;
  set_type: SetType;
  is_active: boolean;
  canvases: CanvasSummary[];
}
interface Issue { code: string; message: string }
interface Override {
  domain_id: number;
  domain_code: string;
  domain_name_he: string;
  domain_name_en: string;
  profile_patch: unknown;
  set_at: string;
  set_by: string;
  approved_by: string | null;
}
interface Detail extends Named {
  id: string;
  canvas_set_id: string;
  code: string;
  version: number;
  status: Status;
  canvas_type: string;
  language_code: string;
  set_type: SetType;
  geometry: CanvasGeometry;
  default_scoring_profile: ScoringProfile | null;
  issues: Issue[];
  versions: { id: string; version: number; status: Status; created_at: string; activated_at: string | null }[];
  overrides: Override[];
  used_by: { key: string; scope: string; domain_id: number | null; region_id: number | null }[];
  sessions: number;
  recordings: Recording[];
}
interface Language { code: string; name_native: string; name_en: string; direction: 'rtl' | 'ltr' }
interface Domain extends Named { id: number; code: string }

const s = {
  head: { display: 'flex', alignItems: 'end', gap: '0.75rem', flexWrap: 'wrap', marginBlockEnd: '0.75rem' },
  form: { ...ui.card, background: 'var(--ilt-surface-2)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))', gap: '0.75rem', alignItems: 'end', marginBlockEnd: '1rem' },
  wide: { gridColumn: '1 / -1' },
  set: { ...ui.card, marginBlockEnd: '0.75rem' },
  setHead: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBlockEnd: '0.5rem' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
  section: { ...ui.card, display: 'grid', gap: '0.6rem' },
  h3: { margin: 0, fontSize: '1rem' },
  code: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.85rem' },
  json: { inlineSize: '100%', boxSizing: 'border-box', minBlockSize: '12rem', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '0.8rem' },
  preview: { overflow: 'auto', border: '1px solid var(--ilt-border)', borderRadius: 6, padding: '0.5rem', background: '#f6f8fa', maxBlockSize: '70vh' },
  changed: { background: 'var(--ilt-warn-bg)' },
} satisfies Record<string, CSSProperties>;

const statusPill = (st: Status) => pill(st === 'ACTIVE' ? 'ok' : st === 'DRAFT' ? 'warn' : 'off');
const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');
const issueList = (err: unknown): Issue[] => (err instanceof ApiError ? ((err.details as { issues?: Issue[] })?.issues ?? []) : []);
const scored = (type: string) => type !== 'NOTEBOOK';
const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

/** `openId` is the canvas open in the address (#/canvases/<id>), so a refresh or Back keeps it. */
export function CanvasesScreen({ openId, onOpenId }: { openId: string | null; onOpenId: (id: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const name = (x: Named) => (he ? isolateSizes(x.name_he) : x.name_en);
  const [sets, setSets] = useState<CanvasSet[] | null>(null);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [approvalOn, setApprovalOn] = useState(true);
  const [filter, setFilter] = useState({ language: '', type: '' });
  const [form, setForm] = useState<'set' | 'canvas' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<Language[]>('/languages').then(setLanguages).catch(() => undefined);
    api<Domain[]>('/domains').then(setDomains).catch(() => undefined);
    api<{ values: Record<string, { effective: { value: unknown } }> }>('/settings/values?scope=SYSTEM')
      .then((v) => setApprovalOn(v.values[GOVERNANCE_KEY]?.effective.value !== false))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    api<CanvasSet[]>('/canvas-sets').then(setSets).catch((e) => setError(message(e)));
  }, [reload, openId === null]);

  const langName = (code: string) => {
    const l = languages.find((x) => x.code === code);
    return l ? (he ? l.name_native : l.name_en) : code;
  };
  const done = (text: string) => {
    setNotice(text);
    setError(null);
    setReload((n) => n + 1);
  };

  if (openId) {
    return (
      <CanvasDetail
        key={openId}
        id={openId}
        domains={domains}
        approvalOn={approvalOn}
        langName={langName}
        onOpen={(id) => { setNotice(null); onOpenId(id); }}
        onBack={() => onOpenId(null)}
      />
    );
  }

  const shown = (sets ?? []).filter((x) => (!filter.language || x.language_code === filter.language) && (!filter.type || x.set_type === filter.type));
  return (
    <div data-testid="canvases">
      <p style={{ ...ui.muted, marginBlockStart: 0, maxInlineSize: '52rem' }}>{t('admin.canvases.intro')}</p>
      <div style={s.head}>
        <label style={ui.field}>
          {t('admin.canvases.language')}
          <select value={filter.language} onChange={(e) => setFilter({ ...filter, language: e.target.value })}>
            <option value="">{t('admin.canvases.all')}</option>
            {languages.map((l) => <option key={l.code} value={l.code}>{langName(l.code)}</option>)}
          </select>
        </label>
        <label style={ui.field}>
          {t('admin.canvases.type')}
          <select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
            <option value="">{t('admin.canvases.all')}</option>
            {SET_TYPES.map((k) => <option key={k} value={k}>{t(`admin.canvases.set_type.${k}`)}</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button style={ui.button} onClick={() => setForm(form === 'set' ? null : 'set')}>+ {t('admin.canvases.new_set')}</button>
        <button style={ui.primary} onClick={() => setForm(form === 'canvas' ? null : 'canvas')} data-testid="canvas-load">+ {t('admin.canvases.load')}</button>
      </div>
      {notice && <p role="status" style={{ ...s.notice, marginBlockEnd: '0.75rem' }}>{notice}</p>}
      {error && <p role="alert" style={{ ...ui.error, marginBlockEnd: '0.75rem' }}>{t(error)}</p>}
      {form === 'set' && (
        <SetForm languages={languages} langName={langName} onCancel={() => setForm(null)} onDone={(n) => { setForm(null); done(t('admin.canvases.set_created', { name: n })); }} />
      )}
      {form === 'canvas' && sets && (
        <LoadForm sets={sets} name={name} langName={langName} onCancel={() => setForm(null)} onDone={(id) => { setForm(null); onOpenId(id); }} />
      )}
      {sets && shown.length === 0 && <p style={ui.muted}>{t('admin.canvases.none')}</p>}
      {shown.map((set) => (
        <SetCard key={set.id} set={set} name={name} langName={langName} onOpen={onOpenId} onChanged={done} />
      ))}
    </div>
  );
}

function SetCard({ set, name, langName, onOpen, onChanged }: {
  set: CanvasSet;
  name: (x: Named) => string;
  langName: (code: string) => string;
  onOpen: (id: string) => void;
  onChanged: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '—');

  async function patch(body: Record<string, unknown>) {
    try {
      await api(`/canvas-sets/${set.id}`, { method: 'PATCH', body });
      setRenaming(false);
      onChanged(t('admin.canvases.set_saved', { name: body.name_en ?? set.name_en }));
    } catch (err) {
      setError(message(err));
    }
  }
  function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void patch({ name_he: String(f.get('name_he')), name_en: String(f.get('name_en')) });
  }

  return (
    <section style={{ ...s.set, ...(set.is_active ? {} : { opacity: 0.65 }) }} data-testid="canvas-set">
      <div style={s.setHead}>
        <strong>{name(set)}</strong>
        <span style={ui.muted}>{langName(set.language_code)} · {t(`admin.canvases.set_type.${set.set_type}`)}</span>
        {!set.is_active && <span style={pill('off')}>{t('admin.inactive')}</span>}
        <span style={{ flex: 1 }} />
        <button style={ui.button} onClick={() => setRenaming(!renaming)}>{t('admin.canvases.rename')}</button>
        {set.is_active ? (
          <button style={ui.danger} onClick={() => confirm(t('admin.canvases.set_deactivate_confirm', { name: name(set) })) && void patch({ is_active: false })}>{t('admin.deactivate')}</button>
        ) : (
          <button style={ui.button} onClick={() => void patch({ is_active: true })}>{t('admin.reactivate')}</button>
        )}
      </div>
      {renaming && (
        <form onSubmit={rename} style={{ ...ui.row, marginBlockEnd: '0.5rem' }}>
          <label style={ui.field}>{t('admin.org.name_he')}<input name="name_he" required maxLength={100} dir="rtl" defaultValue={set.name_he} /></label>
          <label style={ui.field}>{t('admin.org.name_en')}<input name="name_en" required maxLength={100} dir="ltr" defaultValue={set.name_en} /></label>
          <button type="submit" style={ui.primary}>{t('admin.save')}</button>
          <button type="button" style={ui.button} onClick={() => setRenaming(false)}>{t('common.cancel')}</button>
        </form>
      )}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      {set.canvases.length === 0 ? (
        <p style={{ ...ui.muted, margin: 0 }}>{t('admin.canvases.set_empty')}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table}>
            <thead>
              <tr>{['code', 'name', 'version', 'status', 'activated', 'overrides', ''].map((k) => <th key={k} style={ui.cell}>{k && t(`admin.canvases.col.${k}`)}</th>)}</tr>
            </thead>
            <tbody>
              {set.canvases.map((c) => (
                <tr key={c.id} style={c.status === 'RETIRED' ? { color: 'var(--ilt-muted)' } : undefined}>
                  <td style={{ ...ui.cell, ...s.code }} dir="ltr">{c.code}</td>
                  <td style={ui.cell}>{name(c)}</td>
                  <td style={ui.cell}>v{c.version}</td>
                  <td style={ui.cell}><span style={statusPill(c.status)}>{t(`admin.canvases.status.${c.status}`)}</span></td>
                  <td style={ui.cell}>{when(c.activated_at)}</td>
                  <td style={ui.cell}>{c.overrides || ''}</td>
                  <td style={{ ...ui.cell, textAlign: 'end' }}><button style={ui.button} onClick={() => onOpen(c.id)}>{t('admin.canvases.open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SetForm({ languages, langName, onCancel, onDone }: {
  languages: Language[];
  langName: (code: string) => string;
  onCancel: () => void;
  onDone: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    try {
      await api('/canvas-sets', { method: 'POST', body: f });
      onDone(f.name_en!);
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <form onSubmit={submit} style={s.form} data-testid="set-form">
      <label style={ui.field}>{t('admin.canvases.language')}
        <select name="language_code">{languages.map((l) => <option key={l.code} value={l.code}>{langName(l.code)}</option>)}</select>
      </label>
      <label style={ui.field}>{t('admin.canvases.type')}
        <select name="set_type">{SET_TYPES.map((k) => <option key={k} value={k}>{t(`admin.canvases.set_type.${k}`)}</option>)}</select>
      </label>
      <label style={ui.field}>{t('admin.org.name_he')}<input name="name_he" required maxLength={100} dir="rtl" /></label>
      <label style={ui.field}>{t('admin.org.name_en')}<input name="name_en" required maxLength={100} dir="ltr" /></label>
      {error && <p role="alert" style={{ ...ui.error, ...s.wide }}>{t(error)}</p>}
      <div style={{ ...ui.row, ...s.wide }}>
        <button type="submit" style={ui.primary}>{t('common.create')}</button>
        <button type="button" style={ui.button} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

/** Loads a new canvas: geometry JSON from a file or pasted, and optionally its scoring profile (FR-CAN-2). */
function LoadForm({ sets, name, langName, onCancel, onDone }: {
  sets: CanvasSet[];
  name: (x: Named) => string;
  langName: (code: string) => string;
  onCancel: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useTranslation();
  const active = sets.filter((x) => x.is_active);
  const [geometry, setGeometry] = useState('');
  const [profile, setProfile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const g = parseJson(geometry);
    const p = profile.trim() ? parseJson(profile) : { ok: true as const, value: undefined };
    if (!g.ok || !p.ok) {
      setError('admin.canvases.not_json');
      setDetails([]);
      return;
    }
    try {
      const made = await api<{ id: string }>('/canvases', {
        method: 'POST',
        body: { canvas_set_id: f.canvas_set_id, code: f.code, name_he: f.name_he, name_en: f.name_en, geometry: g.value, ...(p.value === undefined ? {} : { profile: p.value }) },
      });
      onDone(made.id);
    } catch (err) {
      setError(message(err));
      setDetails(err instanceof ApiError ? ((err.details as { issues?: string[] })?.issues ?? []) : []);
    }
  }

  return (
    <form onSubmit={submit} style={s.form} data-testid="load-form">
      <label style={ui.field}>{t('admin.canvases.set')}
        <select name="canvas_set_id" required>
          {active.map((x) => <option key={x.id} value={x.id}>{name(x)} · {langName(x.language_code)} · {t(`admin.canvases.set_type.${x.set_type}`)}</option>)}
        </select>
      </label>
      <label style={ui.field}>{t('admin.org.code')}<input name="code" required pattern="[A-Za-z0-9_]{2,60}" maxLength={60} dir="ltr" placeholder="ILT_4DOT_HE" /></label>
      <label style={ui.field}>{t('admin.org.name_he')}<input name="name_he" required maxLength={100} dir="rtl" /></label>
      <label style={ui.field}>{t('admin.org.name_en')}<input name="name_en" required maxLength={100} dir="ltr" /></label>
      <JsonField label={t('admin.canvases.geometry_json')} value={geometry} onChange={setGeometry} required />
      <JsonField label={t('admin.canvases.profile_json')} value={profile} onChange={setProfile} />
      <p style={{ ...ui.muted, ...s.wide, margin: 0 }}>{t('admin.canvases.load_hint')}</p>
      {error && (
        <div role="alert" style={{ ...ui.error, ...s.wide }}>
          {t(error)}
          {details.length > 0 && <ul style={{ margin: '0.25rem 0 0', ...s.code }} dir="ltr">{details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      <div style={{ ...ui.row, ...s.wide }}>
        <button type="submit" style={ui.primary}>{t('admin.canvases.load_submit')}</button>
        <button type="button" style={ui.button} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

/** A JSON text box that can also be filled from a .json file. */
function JsonField({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const { t } = useTranslation();
  return (
    <label style={{ ...ui.field, ...s.wide }}>
      <span style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {label}
        <input type="file" accept=".json,application/json" aria-label={t('admin.canvases.from_file')}
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(onChange); }} />
      </span>
      <textarea dir="ltr" style={{ ...s.json, minBlockSize: '8rem' }} value={value} required={required} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- One canvas ----------

function CanvasDetail({ id, domains, approvalOn, langName, onOpen, onBack }: {
  id: string;
  domains: Domain[];
  approvalOn: boolean;
  langName: (code: string) => string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const name = (x: Named) => (he ? isolateSizes(x.name_he) : x.name_en);
  const [c, setC] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Issue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [geometryText, setGeometryText] = useState('');
  const [profile, setProfile] = useState<ScoringProfile | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    api<Detail>(`/canvases/${id}/detail`)
      .then((d) => {
        setC(d);
        setGeometryText(JSON.stringify(d.geometry, null, 2));
        setProfile(d.default_scoring_profile);
      })
      .catch((e) => setError(message(e)));
  }, [id, reload]);

  if (!c) return error ? <LoadError message={t(error)} onBack={onBack} backLabel={t('admin.canvases.back')} /> : null;
  const draft = c.status === 'DRAFT';
  const profileChanged = JSON.stringify(profile) !== JSON.stringify(c.default_scoring_profile);
  const geometryChanged = geometryText !== JSON.stringify(c.geometry, null, 2);
  const parsedGeometry = parseJson(geometryText);
  const shownGeometry = (parsedGeometry.ok && isGeometry(parsedGeometry.value) ? parsedGeometry.value : c.geometry);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setProblems([]);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      setReload((n) => n + 1);
      return true;
    } catch (err) {
      setError(message(err));
      setProblems(issueList(err));
      return false;
    }
  }
  const save = () => {
    const g = parseJson(geometryText);
    if (!g.ok) {
      setError('admin.canvases.not_json');
      return;
    }
    void run(() => api(`/canvases/${c.id}`, { method: 'PATCH', body: { ...(geometryChanged ? { geometry: g.value } : {}), ...(profileChanged ? { profile } : {}) } }), t('admin.canvases.draft_saved'));
  };
  const rename = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(() => api(`/canvases/${c.id}`, { method: 'PATCH', body: { name_he: String(f.get('name_he')), name_en: String(f.get('name_en')) } }), t('admin.canvases.draft_saved'));
  };
  const newVersion = async () => {
    setError(null);
    try {
      const made = await api<{ id: string }>(`/canvases/${c.id}/versions`, { method: 'POST' });
      onOpen(made.id);
    } catch (err) {
      const draftId = err instanceof ApiError ? (err.details as { id?: string })?.id : undefined;
      if (draftId && confirm(t('admin.canvases.draft_exists_open'))) onOpen(draftId);
      else setError(message(err));
    }
  };
  const settingLabel = (u: Detail['used_by'][number]) => {
    const where = u.scope === 'DOMAIN' ? domains.find((d) => d.id === u.domain_id)?.code ?? u.domain_id : '';
    return `${u.key} · ${t(`admin.canvases.scope.${u.scope}`)}${where ? ` ${where}` : ''}`;
  };

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="canvas-detail">
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <BackButton onClick={onBack} label={t('admin.canvases.back')} />
        <h3 style={{ ...s.h3, fontSize: '1.05rem' }}>
          <span dir="ltr" style={s.code}>{c.code}</span> v{c.version} · {name(c)}
        </h3>
        <span style={statusPill(c.status)} data-testid="canvas-status">{t(`admin.canvases.status.${c.status}`)}</span>
        <span style={ui.muted}>{langName(c.language_code)} · {t(`admin.canvases.set_type.${c.set_type}`)}</span>
      </div>
      {notice && <p role="status" style={s.notice}>{notice}</p>}
      {error && (
        <div role="alert" style={ui.error}>
          {t(error)}
          {problems.length > 0 && <IssueList issues={problems} />}
        </div>
      )}

      <section style={s.section}>
        <div style={{ ...ui.row, alignItems: 'center' }}>
          {draft && (
            <>
              <button style={ui.button} onClick={() => void run(() => api(`/canvases/${c.id}/validate`, { method: 'POST' }), t('admin.canvases.checked'))}>{t('admin.canvases.validate')}</button>
              <button style={ui.primary} disabled={geometryChanged || profileChanged} title={geometryChanged || profileChanged ? t('admin.canvases.save_first') : undefined}
                onClick={() => setActivating(!activating)} data-testid="canvas-activate">{t('admin.canvases.activate')}</button>
              <button style={ui.danger} onClick={() => confirm(t('admin.canvases.delete_confirm', { code: c.code, version: c.version })) && void run(() => api(`/canvases/${c.id}`, { method: 'DELETE' }), '').then((ok) => ok && onBack())}>{t('admin.canvases.delete')}</button>
            </>
          )}
          {!draft && <button style={ui.button} onClick={() => void newVersion()} data-testid="canvas-new-version">{t('admin.canvases.new_version')}</button>}
          {c.status === 'ACTIVE' && (
            <button style={ui.danger} onClick={() => confirm(t('admin.canvases.retire_confirm', { code: c.code })) && void run(() => api(`/canvases/${c.id}/retire`, { method: 'POST' }), t('admin.canvases.retired_notice'))}>{t('admin.canvases.retire')}</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={ui.muted}>{t('admin.canvases.sessions', { count: c.sessions })}</span>
        </div>
        {activating && draft && (
          <Approval
            needed={approvalOn && scored(c.canvas_type)}
            intro={t('admin.canvases.activate_intro', { code: c.code, version: c.version })}
            submitLabel={t('admin.canvases.activate')}
            onCancel={() => setActivating(false)}
            onSubmit={(a) => run(() => api(`/canvases/${c.id}/activate`, { method: 'POST', body: a }), t('admin.canvases.activated', { code: c.code, version: c.version })).then((ok) => ok && setActivating(false))}
          />
        )}
        {draft && (
          c.issues.length
            ? <div style={{ color: tone.bad }} data-testid="canvas-issues">{t('admin.canvases.problems')}<IssueList issues={c.issues} /></div>
            : <p style={{ margin: 0, color: tone.ok }} data-testid="canvas-ready">{t('admin.canvases.ready')}</p>
        )}
        {c.used_by.length > 0 && (
          <div style={ui.muted}>{t('admin.canvases.used_by')} <span dir="ltr" style={s.code}>{c.used_by.map(settingLabel).join('; ')}</span></div>
        )}
        <div style={ui.muted}>
          {t('admin.canvases.versions')}{' '}
          {c.versions.map((v, i) => (
            <span key={v.id}>
              {i > 0 && ' · '}
              {v.id === c.id ? <strong>v{v.version}</strong> : <a href="#" onClick={(e) => { e.preventDefault(); onOpen(v.id); }}>v{v.version}</a>}
              {' '}({t(`admin.canvases.status.${v.status}`)})
            </span>
          ))}
        </div>
      </section>

      {draft && (
        <section style={s.section}>
          <h3 style={s.h3}>{t('admin.canvases.names')}</h3>
          <form onSubmit={rename} style={ui.row}>
            <label style={ui.field}>{t('admin.org.name_he')}<input name="name_he" required maxLength={100} dir="rtl" defaultValue={c.name_he} /></label>
            <label style={ui.field}>{t('admin.org.name_en')}<input name="name_en" required maxLength={100} dir="ltr" defaultValue={c.name_en} /></label>
            <button type="submit" style={ui.button}>{t('admin.save')}</button>
          </form>
        </section>
      )}

      <Preview geometry={shownGeometry} profile={profile} />

      {c.status !== 'RETIRED' && (
        <ReferencePanel canvas={c} recordings={c.recordings} domains={domains} approvalOn={approvalOn}
          onChanged={(text) => { setNotice(text); setReload((n) => n + 1); }} />
      )}

      {scored(c.canvas_type) && profile && (
        <section style={s.section} data-testid="canvas-profile">
          <h3 style={s.h3}>{t('admin.canvases.profile')}</h3>
          <ProfileForm geometry={shownGeometry} profile={profile} editable={draft} onChange={setProfile} />
        </section>
      )}

      <section style={s.section}>
        <h3 style={s.h3}>{t('admin.canvases.geometry')}</h3>
        {draft ? (
          <>
            <JsonField label={t('admin.canvases.geometry_json')} value={geometryText} onChange={setGeometryText} />
            {!parsedGeometry.ok && <p style={ui.error}>{t('admin.canvases.not_json')}</p>}
          </>
        ) : (
          <details>
            <summary>{t('admin.canvases.show_json')}</summary>
            <pre dir="ltr" style={{ ...s.code, overflow: 'auto', maxBlockSize: '20rem' }}>{JSON.stringify(c.geometry, null, 2)}</pre>
          </details>
        )}
      </section>

      {draft && (geometryChanged || profileChanged) && (
        <div style={{ position: 'sticky', insetBlockEnd: 0, ...ui.card, display: 'flex', gap: '0.75rem', alignItems: 'center', boxShadow: 'var(--ilt-shadow)' }}>
          <strong>{t('admin.canvases.unsaved')}</strong>
          <button style={ui.primary} onClick={save} data-testid="canvas-save">{t('admin.canvases.save_draft')}</button>
          <button style={ui.button} onClick={() => { setGeometryText(JSON.stringify(c.geometry, null, 2)); setProfile(c.default_scoring_profile); }}>{t('admin.settings.discard')}</button>
        </div>
      )}

      {scored(c.canvas_type) && c.default_scoring_profile && c.status !== 'RETIRED' && (
        <DomainOverrides canvas={c} domains={domains} approvalOn={approvalOn} name={name} onChanged={(text) => { setNotice(text); setReload((n) => n + 1); }} />
      )}
    </div>
  );
}

const isGeometry = (v: unknown): v is CanvasGeometry =>
  typeof v === 'object' && v !== null && Array.isArray((v as CanvasGeometry).boxes) && typeof (v as CanvasGeometry).size?.width === 'number'
  && (v as CanvasGeometry).boxes.every((b) => typeof b?.x === 'number' && typeof b?.w === 'number');

function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  return (
    <ul style={{ margin: '0.25rem 0 0', paddingInlineStart: '1.25rem' }}>
      {issues.map((i, n) => (
        <li key={n}>
          {t(`admin.canvases.issue.${i.code}`, { defaultValue: i.code })}
          <span dir="ltr" style={{ ...ui.muted, ...s.code, marginInlineStart: '0.5rem' }}>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** The canvas drawn with its boxes, dots and lines; intervention letters and the fill order are laid over it. */
function Preview({ geometry, profile }: { geometry: CanvasGeometry; profile: ScoringProfile | null }) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<'fit' | 'true' | 'big'>('fit');
  const [showOrder, setShowOrder] = useState(true);
  const [boxW, setBoxW] = useState(800);
  const [viewH, setViewH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Fit both ways: the preview box is at most 70% of the window high (s.preview).
  const fitPx = Math.min((boxW - 24) / geometry.size.width, (viewH * 0.7 - 24) / geometry.size.height);
  const pxPerMm = zoom === 'true' ? SCREEN_PX_PER_MM : zoom === 'big' ? SCREEN_PX_PER_MM * 2 : Math.max(1, fitPx);
  const order = profile?.fill_order.length ? profile.fill_order : null;
  const position = new Map((order ?? []).map((boxId, i) => [boxId, i + 1]));
  const fits = geometry.size.width <= DTH_A116.SCREEN_W_MM && geometry.size.height <= DTH_A116.SCREEN_H_MM;

  return (
    <section style={s.section} data-testid="canvas-preview">
      <div style={{ ...ui.row, alignItems: 'center' }}>
        <h3 style={s.h3}>{t('admin.canvases.preview')}</h3>
        <span style={ui.muted} dir="ltr">{geometry.size.width} × {geometry.size.height} mm · {geometry.boxes.length} {t('admin.canvases.boxes')}</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
          <input type="checkbox" checked={showOrder} onChange={(e) => setShowOrder(e.target.checked)} />
          {t('admin.canvases.show_order')}
        </label>
        <select value={zoom} onChange={(e) => setZoom(e.target.value as typeof zoom)} aria-label={t('admin.canvases.zoom')}>
          <option value="fit">{t('admin.canvases.zoom_fit')}</option>
          <option value="true">{t('admin.canvases.zoom_true')}</option>
          <option value="big">{t('admin.canvases.zoom_big')}</option>
        </select>
      </div>
      {!fits && <p style={{ margin: 0, color: tone.bad }}>{t('admin.canvases.issue.DOES_NOT_FIT')}</p>}
      <div style={s.preview} ref={(el) => { if (el && Math.abs(el.clientWidth - boxW) > 4) setBoxW(el.clientWidth); }}>
        <CanvasView geometry={geometry} pxPerMm={pxPerMm}>
          <svg width={geometry.size.width * pxPerMm} height={geometry.size.height * pxPerMm} viewBox={`0 0 ${geometry.size.width} ${geometry.size.height}`}
            style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {geometry.letters.map((l) => {
              const b = geometry.boxes.find((x) => x.id === l.box_id);
              if (!b) return null;
              return (
                <g key={l.box_id} transform={`translate(${b.x} ${b.y})`}>
                  {/* The model's centre line, one line per pen stroke (the letter and its dots are drawn by the canvas). */}
                  {(l.model_strokes.length ? l.model_strokes : [l.model_path]).filter((s) => s.length > 1).map((s, i) => (
                    <polyline key={i} points={s.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="#8c959f" strokeWidth={0.4} strokeDasharray="1 0.8" />
                  ))}
                  {showOrder && l.dots.map((d) => (
                    // A dot on the canvas's top edge gets its number beside it, so the number stays on the canvas.
                    <text key={d.id} x={d.x + 1.3} y={b.y + d.y < 2.5 ? d.y + 0.8 : d.y - 0.8} fontSize={2.2} fill="#cf222e">{d.id}</text>
                  ))}
                  <text x={1} y={b.h - 1} fontSize={3} fill="#57606a">{l.letter}</text>
                </g>
              );
            })}
            {showOrder && geometry.boxes.map((b) => (
              <g key={b.id}>
                <text x={b.x + 1} y={b.y + 3.2} fontSize={2.6} fill="#0969da">#{b.id}</text>
                {position.has(b.id) && (
                  <text x={b.x + b.w - 1} y={b.y + 3.2} fontSize={2.6} fill="#bf3989" textAnchor="end">{position.get(b.id)}</text>
                )}
              </g>
            ))}
          </svg>
        </CanvasView>
      </div>
      <p style={{ ...ui.muted, margin: 0 }}>{t(zoom === 'fit' ? 'admin.canvases.preview_fit' : 'admin.canvases.preview_true')}{' '}
        {showOrder && t(order ? 'admin.canvases.order_recorded' : 'admin.canvases.order_language')}</p>
    </section>
  );
}

/** The scoring profile (FR-CAN-7). `base` marks the values a Domain changed (FR-CAN-8). */
function ProfileForm({ geometry, profile, base, editable, onChange }: {
  geometry: CanvasGeometry;
  profile: ScoringProfile;
  base?: ScoringProfile;
  editable: boolean;
  onChange: (p: ScoringProfile) => void;
}) {
  const { t } = useTranslation();
  const ids = Object.keys(profile.dots);
  // ILT dots repeat in every box; a letter sheet's dots belong to its letters.
  const printed = (id: string) => (geometry.dots.find((d) => d.id === id) ?? geometry.letters.flatMap((l) => l.dots).find((d) => d.id === id))?.diameter_mm;
  const total = ids.reduce((n, id) => n + Number(profile.dots[id]!.weight_pct || 0), 0);
  const diff = (a: unknown, b: unknown) => !!base && JSON.stringify(a) !== JSON.stringify(b);
  const mark = (changed: boolean): CSSProperties => (changed ? s.changed : {});
  const setDot = (id: string, field: 'radius_mm' | 'weight_pct' | 'required', v: number | boolean) =>
    onChange({ ...profile, dots: { ...profile.dots, [id]: { ...profile.dots[id]!, [field]: v } } });
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const [orderText, setOrderText] = useState(profile.fill_order.join(', '));
  useEffect(() => setOrderText(profile.fill_order.join(', ')), [profile.fill_order]);
  const languageOrder = useMemo(() => fillOrderFor(geometry.boxes, 'RTL_ROWS').join(', '), [geometry.boxes]);

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <label style={{ ...ui.field, ...mark(diff(profile.dot_order, base?.dot_order)) }}>
        {t('admin.canvases.dot_order')}
        <input dir="ltr" disabled={!editable} defaultValue={profile.dot_order.join(' → ')} key={profile.dot_order.join()}
          onBlur={(e) => onChange({ ...profile, dot_order: e.target.value.split(/[\s,>→-]+/).filter(Boolean) })} />
        <span style={ui.muted}>{t('admin.canvases.dot_order_hint')}</span>
      </label>
      <div style={{ overflowX: 'auto' }}>
        <table style={ui.table}>
          <thead>
            <tr>{['dot', 'printed', 'radius', 'weight', 'required'].map((k) => <th key={k} style={ui.cell}>{t(`admin.canvases.col.${k}`)}</th>)}</tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const d = profile.dots[id]!;
              const b = base?.dots[id];
              return (
                <tr key={id}>
                  <td style={{ ...ui.cell, fontWeight: 600 }} dir="ltr">{id}</td>
                  <td style={ui.cell} dir="ltr">{printed(id) !== undefined ? `⌀ ${printed(id)} mm` : '—'}</td>
                  <td style={{ ...ui.cell, ...mark(diff(d.radius_mm, b?.radius_mm)) }}>
                    <input type="number" dir="ltr" min={0} max={5} step={0.1} style={{ inlineSize: '6rem' }} disabled={!editable} value={d.radius_mm}
                      onChange={(e) => setDot(id, 'radius_mm', num(e.target.value))} /> mm
                  </td>
                  <td style={{ ...ui.cell, ...mark(diff(d.weight_pct, b?.weight_pct)) }}>
                    <input type="number" dir="ltr" min={0} max={100} step={1} style={{ inlineSize: '6rem' }} disabled={!editable} value={d.weight_pct}
                      onChange={(e) => setDot(id, 'weight_pct', num(e.target.value))} /> %
                  </td>
                  <td style={{ ...ui.cell, ...mark(diff(d.required, b?.required)) }}>
                    <input type="checkbox" disabled={!editable} checked={d.required} onChange={(e) => setDot(id, 'required', e.target.checked)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', color: Math.abs(total - 100) < 1e-9 ? 'var(--ilt-muted)' : tone.bad, fontWeight: Math.abs(total - 100) < 1e-9 ? 400 : 600 }} data-testid="dot-weights-total">
        {t('admin.canvases.weights_total', { total })}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ ...ui.field, ...mark(diff(profile.expected_pen_lifts_per_block, base?.expected_pen_lifts_per_block)) }}>
          {t('admin.canvases.pen_lifts')}
          <input type="number" dir="ltr" min={1} step={1} disabled={!editable} value={profile.expected_pen_lifts_per_block}
            onChange={(e) => onChange({ ...profile, expected_pen_lifts_per_block: num(e.target.value) })} />
        </label>
        <label style={{ ...ui.field, ...mark(diff(profile.normal_speed_mm_s, base?.normal_speed_mm_s)) }}>
          {t('admin.canvases.normal_speed')}
          <input type="number" dir="ltr" min={0} step="any" disabled={!editable} placeholder={t('admin.canvases.not_recorded')} value={profile.normal_speed_mm_s ?? ''}
            onChange={(e) => onChange({ ...profile, normal_speed_mm_s: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <label style={{ ...ui.field, ...mark(diff(profile.speed_flex_pct, base?.speed_flex_pct)) }}>
          {t('admin.canvases.speed_flex')}
          <input type="number" dir="ltr" min={0} max={100} step={1} disabled={!editable} value={profile.speed_flex_pct}
            onChange={(e) => onChange({ ...profile, speed_flex_pct: num(e.target.value) })} />
        </label>
      </div>
      <label style={{ ...ui.field, ...mark(diff(profile.fill_order, base?.fill_order)) }}>
        {t('admin.canvases.fill_order')}
        <input dir="ltr" disabled={!editable} value={orderText} placeholder={t('admin.canvases.fill_order_empty')}
          onChange={(e) => setOrderText(e.target.value)}
          onBlur={() => onChange({ ...profile, fill_order: orderText.split(/[\s,]+/).filter(Boolean).map(Number) })} />
        <span style={ui.muted}>{t('admin.canvases.fill_order_hint', { example: languageOrder })}</span>
      </label>
    </div>
  );
}

/** Director email and PIN, when approval is needed, and the submit button. */
function Approval({ needed, intro, submitLabel, onSubmit, onCancel, extra }: {
  needed: boolean;
  intro: string;
  submitLabel: string;
  onSubmit: (a: { director_email?: string; director_pin?: string }) => Promise<unknown>;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const [missing, setMissing] = useState(false);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('director_email') ?? '').trim();
    const pin = String(f.get('director_pin') ?? '');
    if (needed && (!email || !pin)) {
      setMissing(true);
      return;
    }
    setMissing(false);
    void onSubmit(needed ? { director_email: email, director_pin: pin } : {});
  }
  return (
    <form onSubmit={submit} style={{ ...ui.card, background: 'var(--ilt-surface-2)', display: 'grid', gap: '0.6rem' }} data-testid="approval">
      <p style={{ margin: 0 }}>{intro}</p>
      {extra}
      {needed && (
        <>
          <p style={{ ...ui.muted, margin: 0 }}>{t('admin.canvases.approval')}</p>
          <div style={ui.row}>
            <label style={ui.field}>{t('summary.director_email')}<input name="director_email" type="email" dir="ltr" autoComplete="off" /></label>
            <label style={ui.field}>{t('summary.director_pin')}<input name="director_pin" type="password" inputMode="numeric" maxLength={8} dir="ltr" autoComplete="off" /></label>
          </div>
          {missing && <p role="alert" style={ui.error}>{t('admin.settings.director_missing')}</p>}
        </>
      )}
      <div style={ui.row}>
        <button type="submit" style={ui.primary}>{submitLabel}</button>
        <button type="button" style={ui.button} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </form>
  );
}

/** Domain overrides of the scoring profile (FR-CAN-8): which Domains differ, and an editor that marks the changed values. */
function DomainOverrides({ canvas, domains, approvalOn, name, onChanged }: {
  canvas: Detail;
  domains: Domain[];
  approvalOn: boolean;
  name: (x: Named) => string;
  onChanged: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const base = canvas.default_scoring_profile!;
  const [domainId, setDomainId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ScoringProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Issue[]>([]);
  const existing = (id: number) => canvas.overrides.find((o) => o.domain_id === id);

  const choose = (id: number | null) => {
    setDomainId(id);
    setError(null);
    setProblems([]);
    setDraft(id === null ? null : mergeProfile(base, existing(id)?.profile_patch));
  };
  async function send(body: Record<string, unknown>, a: { director_email?: string; director_pin?: string }) {
    setError(null);
    setProblems([]);
    try {
      const r = await api<{ changed: number }>(`/canvases/${canvas.id}/overrides/${domainId}`, { method: 'PUT', body: { ...body, ...a } });
      const d = domains.find((x) => x.id === domainId);
      choose(null);
      onChanged(r.changed ? t('admin.canvases.override_saved', { domain: d ? name(d) : domainId }) : t('admin.settings.nothing_changed'));
    } catch (err) {
      setError(message(err));
      setProblems(issueList(err));
    }
  }
  const [mode, setMode] = useState<'save' | 'reset'>('save');

  return (
    <section style={s.section} data-testid="canvas-overrides">
      <h3 style={s.h3}>{t('admin.canvases.overrides')}</h3>
      <p style={{ ...ui.muted, margin: 0 }}>{t('admin.canvases.overrides_intro')}</p>
      {canvas.overrides.length === 0 ? (
        <p style={{ ...ui.muted, margin: 0 }}>{t('admin.canvases.no_overrides')}</p>
      ) : (
        <table style={ui.table}>
          <thead>
            <tr>{['domain', 'changed', 'set_by', 'approved', ''].map((k) => <th key={k} style={ui.cell}>{k && t(`admin.canvases.col.${k}`)}</th>)}</tr>
          </thead>
          <tbody>
            {canvas.overrides.map((o) => (
              <tr key={o.domain_id}>
                <td style={ui.cell}>{domainLabel(o)}</td>
                <td style={{ ...ui.cell, ...s.code }} dir="ltr">{describePatch(o.profile_patch)}</td>
                <td style={ui.cell}>{o.set_by} · {new Date(o.set_at).toLocaleDateString()}</td>
                <td style={ui.cell}>{o.approved_by ?? '—'}</td>
                <td style={{ ...ui.cell, textAlign: 'end' }}><button style={ui.button} onClick={() => choose(o.domain_id)}>{t('admin.edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label style={{ ...ui.field, maxInlineSize: '24rem' }}>
        {t('admin.canvases.domain')}
        <select value={domainId ?? ''} onChange={(e) => choose(e.target.value ? Number(e.target.value) : null)} data-testid="override-domain">
          <option value="">{t('admin.canvases.choose_domain')}</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{name(d)} ({d.code})</option>)}
        </select>
      </label>
      {draft && domainId !== null && (
        <>
          <p style={{ ...ui.muted, margin: 0 }}>{t('admin.canvases.override_hint')}</p>
          <ProfileForm geometry={canvas.geometry} profile={draft} base={base} editable onChange={setDraft} />
          {error && <div role="alert" style={ui.error}>{t(error)}{problems.length > 0 && <IssueList issues={problems} />}</div>}
          <div style={ui.row}>
            <button style={ui.button} onClick={() => setMode('reset')} disabled={!existing(domainId)}>{t('admin.canvases.follow_canvas')}</button>
            <button style={ui.button} onClick={() => setDraft(mergeProfile(base, existing(domainId)?.profile_patch))}>{t('admin.settings.undo')}</button>
          </div>
          <Approval
            key={mode}
            needed={approvalOn}
            intro={t(mode === 'reset' ? 'admin.canvases.reset_intro' : 'admin.canvases.override_intro', { code: canvas.code })}
            submitLabel={t(mode === 'reset' ? 'admin.canvases.follow_canvas' : 'admin.save')}
            onCancel={() => (mode === 'reset' ? setMode('save') : choose(null))}
            onSubmit={(a) => send(mode === 'reset' ? { reset: true } : { profile: draft }, a).then(() => setMode('save'))}
          />
        </>
      )}
    </section>
  );

  function domainLabel(o: Override) {
    return `${name({ name_he: o.domain_name_he, name_en: o.domain_name_en })} (${o.domain_code})`;
  }
}

/** "dots.B.radius_mm 2; speed_flex_pct 15" from a stored patch. */
function describePatch(patch: unknown, prefix = ''): string {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return `${prefix} ${JSON.stringify(patch)}`;
  return Object.entries(patch).map(([k, v]) => describePatch(v, prefix ? `${prefix}.${k}` : k)).join('; ');
}
