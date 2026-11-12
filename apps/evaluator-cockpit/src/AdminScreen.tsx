// Administration (System Administrator only, FR-ROLE-2): users and roles with the Research Director
// PIN (FR-ROLE-3), the Domains and Regions that group students (FR-ORG-1/2), the canvas library
// (CanvasesScreen.tsx), Settings (SettingsScreen.tsx), legacy data (LegacyScreen.tsx) and the action log (LogScreen.tsx). This is the Administrator cockpit (<base>admin); the gateway checks the role on every call.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api, getAuth } from './api';
import { CanvasesScreen } from './CanvasesScreen';
import { EthicsScreen } from './EthicsScreen';
import { LegacyScreen } from './LegacyScreen';
import { LogScreen } from './LogScreen';
import { SettingsScreen } from './SettingsScreen';
import { pill, ui } from './styles';

export const ADMIN_TABS = ['users', 'domains', 'regions', 'canvases', 'settings', 'ethics', 'legacy', 'log'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

const ROLES = ['ADMIN', 'RESEARCHER', 'EVALUATOR', 'ANALYST'] as const;
const MIN_PASSWORD = 12;

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  ui_language: string;
  domain_id: number | null;
  region_id: number | null;
  is_active: boolean;
  has_director_pin: boolean;
  locked: boolean;
}
interface Group {
  id: number;
  code: string;
  name_he: string;
  name_en: string;
  description_he?: string | null;
  description_en?: string | null;
  is_active: boolean;
}

const tabs: Record<string, CSSProperties> = {
  bar: { display: 'flex', gap: '0.25rem', borderBlockEnd: '1px solid var(--ilt-border)', marginBlockEnd: '1rem' },
  tab: {
    paddingInline: '0.9rem', paddingBlock: '0.45rem', border: 0, borderBlockEnd: '2px solid transparent',
    background: 'transparent', color: 'var(--ilt-muted)', cursor: 'pointer', marginBlockEnd: -1,
  },
  active: { color: 'var(--ilt-fg)', borderBlockEndColor: 'var(--ilt-accent)', fontWeight: 600 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBlockEnd: '0.75rem' },
  form: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))', gap: '0.75rem', alignItems: 'end' },
  formCard: { ...ui.card, marginBlockEnd: '1rem', background: 'var(--ilt-surface-2)' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', gridColumn: '1 / -1' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
};

const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');

/** A random password that is easy to read out (no 0/O or 1/l). */
function newPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function AdminScreen({ tab, onTab, canvasId, onCanvas }: {
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  canvasId: string | null;
  onCanvas: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={ui.card}>
      <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('admin.title')}</h2>
      <div role="tablist" style={tabs.bar}>
        {ADMIN_TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} style={{ ...tabs.tab, ...(tab === k ? tabs.active : {}) }} onClick={() => onTab(k)} data-testid={`admin-tab-${k}`}>
            {t(`admin.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersPanel /> : tab === 'log' ? <LogScreen /> : tab === 'ethics' ? <EthicsScreen /> : tab === 'legacy' ? <LegacyScreen /> : tab === 'settings' ? <SettingsScreen /> : tab === 'canvases' ? <CanvasesScreen openId={canvasId} onOpenId={onCanvas} /> : <GroupPanel key={tab} kind={tab} />}
    </div>
  );
}

// ---------- Users ----------

const NO_USER_FILTER = { q: '', role: '', active: 'true' };
type UserForm = {
  full_name: string;
  email: string;
  role: string;
  ui_language: string;
  domain_id: number | null;
  region_id: number | null;
  password: string;
  director_pin: string;
  remove_pin: boolean;
  is_active: boolean;
};

function UsersPanel() {
  const { t, i18n } = useTranslation();
  const me = getAuth()?.user.id;
  const [users, setUsers] = useState<User[]>([]);
  const [domains, setDomains] = useState<Group[]>([]);
  const [regions, setRegions] = useState<Group[]>([]);
  const [filter, setFilter] = useState(NO_USER_FILTER);
  /** null: no form; 'new': create; otherwise the user being edited. */
  const [editing, setEditing] = useState<'new' | User | null>(null);
  const [form, setForm] = useState<UserForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<Group[]>('/domains').then(setDomains).catch(() => undefined);
    api<Group[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);
  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams(Object.entries(filter).filter(([, v]) => v !== ''));
    const id = setTimeout(() => {
      api<User[]>(`/users${p.size ? `?${p}` : ''}`)
        .then((list) => alive && setUsers(list))
        .catch((e) => alive && setError(message(e)));
    }, filter.q ? 250 : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [filter, reload]);

  const groupName = (list: Group[], id: number | null) => {
    const g = list.find((x) => x.id === id);
    return g ? (i18n.language === 'he' ? g.name_he : g.name_en) : '—';
  };

  function open(target: 'new' | User) {
    setError(null);
    setNotice(null);
    setEditing(target);
    setForm(
      target === 'new'
        ? { full_name: '', email: '', role: 'EVALUATOR', ui_language: 'he', domain_id: domains[0]?.id ?? null, region_id: null, password: newPassword(), director_pin: '', remove_pin: false, is_active: true }
        : { full_name: target.full_name, email: target.email, role: target.role, ui_language: target.ui_language, domain_id: target.domain_id, region_id: target.region_id, password: '', director_pin: '', remove_pin: false, is_active: target.is_active },
    );
  }
  const close = () => {
    setEditing(null);
    setForm(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !editing) return;
    setError(null);
    const director = form.role === 'RESEARCHER';
    try {
      if (editing === 'new') {
        await api('/users', {
          method: 'POST',
          body: { full_name: form.full_name, email: form.email, role: form.role, ui_language: form.ui_language, domain_id: form.domain_id, region_id: form.region_id, password: form.password, director_pin: director && form.director_pin ? form.director_pin : null },
        });
        setNotice(t('admin.users.created', { email: form.email.trim().toLowerCase() }));
      } else {
        const deactivating = editing.is_active && !form.is_active;
        if (deactivating && !confirm(t('admin.users.deactivate_confirm', { name: editing.full_name }))) return;
        await api(`/users/${editing.id}`, {
          method: 'PATCH',
          body: {
            full_name: form.full_name, role: form.role, ui_language: form.ui_language, domain_id: form.domain_id, region_id: form.region_id,
            ...(form.is_active !== editing.is_active ? { is_active: form.is_active } : {}),
            ...(form.password ? { password: form.password } : {}),
            ...(director && form.director_pin ? { director_pin: form.director_pin } : director && form.remove_pin ? { director_pin: null } : {}),
          },
        });
        setNotice(t('admin.users.saved', { email: editing.email }));
      }
      close();
      setReload((n) => n + 1);
    } catch (err) {
      setError(message(err));
    }
  }

  async function patch(user: User, body: Record<string, unknown>, confirmKey?: string) {
    if (confirmKey && !confirm(t(confirmKey, { name: user.full_name }))) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body });
      close();
      setNotice(t('admin.users.saved', { email: user.email }));
      setReload((n) => n + 1);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={tabs.head}>
        <div style={ui.row} data-testid="user-filters">
          <label style={ui.field}>
            {t('cockpit.filter.search')}
            <input type="search" placeholder={t('admin.users.search_hint')} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          </label>
          <label style={ui.field}>
            {t('admin.users.role')}
            <select value={filter.role} onChange={(e) => setFilter({ ...filter, role: e.target.value })}>
              <option value="">{t('cockpit.filter.all')}</option>
              {ROLES.map((r) => <option key={r} value={r}>{t(`enum.role.${r}`)}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('cockpit.status')}
            <select value={filter.active} onChange={(e) => setFilter({ ...filter, active: e.target.value })}>
              <option value="true">{t('admin.active')}</option>
              <option value="false">{t('admin.inactive')}</option>
              <option value="">{t('cockpit.filter.all')}</option>
            </select>
          </label>
        </div>
        <button style={ui.primary} onClick={() => open('new')} data-testid="new-user">+ {t('admin.users.new')}</button>
      </div>

      {notice && <p role="status" style={tabs.notice}>{notice}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      {form && editing && (
        <form onSubmit={save} style={tabs.formCard} data-testid="user-form">
          <h3 style={{ marginBlockStart: 0, fontSize: '1rem' }}>
            {editing === 'new' ? t('admin.users.new') : t('admin.users.edit', { name: editing.full_name })}
          </h3>
          <div style={tabs.form}>
            <label style={ui.field}>
              {t('admin.users.full_name')}
              <input required maxLength={100} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('common.email')}
              <input type="email" required dir="ltr" disabled={editing !== 'new'} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('admin.users.role')}
              <select value={form.role} disabled={editing !== 'new' && editing.id === me} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`enum.role.${r}`)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('admin.users.ui_language')}
              <select value={form.ui_language} onChange={(e) => setForm({ ...form, ui_language: e.target.value })}>
                <option value="he">{t('common.hebrew')}</option>
                <option value="en">{t('common.english')}</option>
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.domain')}
              <select value={form.domain_id ?? ''} onChange={(e) => setForm({ ...form, domain_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{groupName(domains, d.id)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.region')}
              <select value={form.region_id ?? ''} onChange={(e) => setForm({ ...form, region_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{groupName(regions, r.id)}</option>)}
              </select>
            </label>
            {editing !== 'new' && (
              <label style={ui.field}>
                {t('cockpit.status')}
                <select value={String(form.is_active)} disabled={editing.id === me} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })} data-testid="user-status">
                  <option value="true">{t('admin.active')}</option>
                  <option value="false">{t('admin.inactive')}</option>
                </select>
              </label>
            )}
            <label style={{ ...ui.field, gridColumn: 'span 2' }}>
              {editing === 'new' ? t('common.password') : t('admin.users.new_password')}
              <span style={{ display: 'flex', gap: '0.35rem' }}>
                <input
                  dir="ltr"
                  autoComplete="new-password"
                  required={editing === 'new'}
                  minLength={MIN_PASSWORD}
                  style={{ flex: 1, minInlineSize: 0, fontFamily: 'ui-monospace, Consolas, monospace' }}
                  placeholder={editing === 'new' ? '' : t('admin.users.keep_password')}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  data-testid="user-password"
                />
                <button type="button" style={ui.button} onClick={() => setForm({ ...form, password: newPassword() })}>{t('admin.users.generate')}</button>
              </span>
              <span style={ui.muted}>{t('admin.users.password_hint', { n: MIN_PASSWORD })}</span>
            </label>
            {form.role === 'RESEARCHER' && (
              <div style={ui.field}>
                <label htmlFor="director-pin">{t('admin.users.director_pin')}</label>
                <input
                  id="director-pin"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="\d{6}"
                  maxLength={6}
                  disabled={form.remove_pin}
                  placeholder={editing !== 'new' && editing.has_director_pin ? t('admin.users.keep_pin') : ''}
                  value={form.director_pin}
                  onChange={(e) => setForm({ ...form, director_pin: e.target.value.replace(/\D/g, '') })}
                />
                <span style={ui.muted}>{t('admin.users.director_pin_hint')}</span>
                {editing !== 'new' && editing.has_director_pin && (
                  <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={form.remove_pin} onChange={(e) => setForm({ ...form, remove_pin: e.target.checked, director_pin: '' })} />
                    {t('admin.users.remove_pin')}
                  </label>
                )}
              </div>
            )}
            {editing !== 'new' && editing.has_director_pin && form.role !== 'RESEARCHER' && (
              <p style={{ ...ui.muted, margin: 0 }}>{t('admin.users.pin_dropped')}</p>
            )}
            {editing === 'new' && <p style={{ ...ui.muted, margin: 0, gridColumn: '1 / -1' }}>{t('admin.users.pass_on')}</p>}
            <div style={tabs.actions}>
              <button type="submit" style={ui.primary}>{t(editing === 'new' ? 'common.create' : 'admin.save')}</button>
              <button type="button" style={ui.button} onClick={close}>{t('common.cancel')}</button>
              {editing !== 'new' && editing.locked && (
                <button type="button" style={ui.button} onClick={() => void patch(editing, { unlock: true })}>{t('admin.users.unlock')}</button>
              )}
            </div>
          </div>
        </form>
      )}

      <table style={ui.table} data-testid="user-list">
        <thead>
          <tr>
            {['admin.users.full_name', 'common.email', 'admin.users.role', 'cockpit.domain', 'cockpit.region', 'cockpit.status', ''].map((k, i) => (
              <th key={i} style={ui.cell}>{k && t(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={u.is_active ? undefined : { color: 'var(--ilt-muted)' }}>
              <td style={ui.cell}>
                {u.full_name}
                {u.id === me && <span style={ui.muted}> ({t('admin.users.you')})</span>}
              </td>
              <td style={ui.cell}><bdi dir="ltr">{u.email}</bdi></td>
              <td style={ui.cell}>
                {t(`enum.role.${u.role}`)}
                {u.has_director_pin && <span style={{ ...pill('ok'), marginInlineStart: '0.4rem' }}>{t('admin.users.director')}</span>}
              </td>
              <td style={ui.cell}>{groupName(domains, u.domain_id)}</td>
              <td style={ui.cell}>{groupName(regions, u.region_id)}</td>
              <td style={ui.cell}>
                <span style={pill(!u.is_active ? 'off' : u.locked ? 'warn' : 'ok')}>
                  {t(!u.is_active ? 'admin.inactive' : u.locked ? 'admin.users.locked' : 'admin.active')}
                </span>
              </td>
              <td style={{ ...ui.cell, textAlign: 'end', whiteSpace: 'nowrap' }}>
                <button style={ui.button} onClick={() => open(u)}>{t('admin.edit')}</button>
                {u.id !== me && (
                  <>
                    {' '}
                    {u.is_active ? (
                      <button style={ui.danger} onClick={() => void patch(u, { is_active: false }, 'admin.users.deactivate_confirm')}>{t('admin.deactivate')}</button>
                    ) : (
                      <button style={ui.button} onClick={() => void patch(u, { is_active: true })}>{t('admin.reactivate')}</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 0 && <p style={ui.muted}>{t('admin.users.none')}</p>}
    </div>
  );
}

// ---------- Domains and Regions ----------

type GroupForm = { code: string; name_he: string; name_en: string; description_he: string; description_en: string };

function GroupPanel({ kind }: { kind: 'domains' | 'regions' }) {
  const { t, i18n } = useTranslation();
  const described = kind === 'domains';
  const [list, setList] = useState<Group[]>([]);
  const [editing, setEditing] = useState<'new' | Group | null>(null);
  const [form, setForm] = useState<GroupForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<Group[]>(`/${kind}?all=true`).then(setList).catch((e) => setError(message(e)));
  }, [kind, reload]);

  function open(target: 'new' | Group) {
    setError(null);
    setEditing(target);
    setForm(
      target === 'new'
        ? { code: '', name_he: '', name_en: '', description_he: '', description_en: '' }
        : { code: target.code, name_he: target.name_he, name_en: target.name_en, description_he: target.description_he ?? '', description_en: target.description_en ?? '' },
    );
  }
  const close = () => {
    setEditing(null);
    setForm(null);
  };

  async function send(path: string, method: string, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(path, { method, body });
      close();
      setReload((n) => n + 1);
    } catch (err) {
      setError(message(err));
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !editing) return;
    const { code, description_he, description_en, ...names } = form;
    const body = described ? { ...names, description_he: description_he || null, description_en: description_en || null } : names;
    void (editing === 'new' ? send(`/${kind}`, 'POST', { code, ...body }) : send(`/${kind}/${editing.id}`, 'PATCH', body));
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={tabs.head}>
        <p style={{ ...ui.muted, margin: 0, maxInlineSize: '48rem' }}>{t(`admin.org.${kind}_intro`)}</p>
        <button style={ui.primary} onClick={() => open('new')} data-testid={`new-${kind}`}>+ {t(`admin.org.new_${kind}`)}</button>
      </div>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      {form && editing && (
        <form onSubmit={save} style={tabs.formCard} data-testid={`${kind}-form`}>
          <div style={tabs.form}>
            <label style={ui.field}>
              {t('admin.org.code')}
              <input
                required
                dir="ltr"
                pattern="[A-Za-z0-9_]{2,30}"
                maxLength={30}
                disabled={editing !== 'new'}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
              <span style={ui.muted}>{t('admin.org.code_hint')}</span>
            </label>
            <label style={ui.field}>
              {t('admin.org.name_he')}
              <input required dir="rtl" maxLength={100} value={form.name_he} onChange={(e) => setForm({ ...form, name_he: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('admin.org.name_en')}
              <input required dir="ltr" maxLength={100} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            </label>
            {described && (
              <>
                <label style={ui.field}>
                  {t('admin.org.description_he')}
                  <textarea dir="rtl" rows={2} maxLength={1000} value={form.description_he} onChange={(e) => setForm({ ...form, description_he: e.target.value })} />
                </label>
                <label style={ui.field}>
                  {t('admin.org.description_en')}
                  <textarea dir="ltr" rows={2} maxLength={1000} value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} />
                </label>
              </>
            )}
            <div style={tabs.actions}>
              <button type="submit" style={ui.primary}>{t(editing === 'new' ? 'common.create' : 'admin.save')}</button>
              <button type="button" style={ui.button} onClick={close}>{t('common.cancel')}</button>
            </div>
          </div>
        </form>
      )}

      <table style={ui.table} data-testid={`${kind}-list`}>
        <thead>
          <tr>
            {['admin.org.code', 'admin.org.name_he', 'admin.org.name_en', ...(described ? ['admin.org.description'] : []), 'cockpit.status', ''].map((k, i) => (
              <th key={i} style={ui.cell}>{k && t(k)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((g) => (
            <tr key={g.id} style={g.is_active ? undefined : { color: 'var(--ilt-muted)' }}>
              <td style={ui.cell}><bdi dir="ltr">{g.code}</bdi></td>
              <td style={ui.cell}><bdi dir="rtl">{g.name_he}</bdi></td>
              <td style={ui.cell}><bdi dir="ltr">{g.name_en}</bdi></td>
              {described && <td style={{ ...ui.cell, ...ui.muted }}>{(i18n.language === 'he' ? g.description_he : g.description_en) ?? ''}</td>}
              <td style={ui.cell}><span style={pill(g.is_active ? 'ok' : 'off')}>{t(g.is_active ? 'admin.active' : 'admin.inactive')}</span></td>
              <td style={{ ...ui.cell, textAlign: 'end', whiteSpace: 'nowrap' }}>
                <button style={ui.button} onClick={() => open(g)}>{t('admin.edit')}</button>{' '}
                {g.is_active ? (
                  <button style={ui.danger} onClick={() => confirm(t(`admin.org.deactivate_confirm_${kind}`, { name: g.code })) && void send(`/${kind}/${g.id}`, 'PATCH', { is_active: false })}>
                    {t('admin.deactivate')}
                  </button>
                ) : (
                  <button style={ui.button} onClick={() => void send(`/${kind}/${g.id}`, 'PATCH', { is_active: true })}>{t('admin.reactivate')}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
