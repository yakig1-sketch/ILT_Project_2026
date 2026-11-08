// Ethics approvals (System Administrator; DDD §14, FR-PLAN-1, FR-AN-3). A research session needs a
// RESEARCH approval valid today, the research setting on and the participant's research consent.
// Approvals are never deleted: they are corrected or withdrawn and stay on record.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { pill, ui } from './styles';

interface Approval {
  id: number;
  approval_type: string;
  authority: string;
  reference: string | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  withdrawn_at: string | null;
  created_at: string;
  created_by: string | null;
  valid_now: boolean;
  sessions: number;
}
interface Form { approval_type: string; authority: string; reference: string; valid_from: string; valid_to: string; notes: string }

const TYPES = ['RESEARCH', 'INTERVENTION_PROGRAM', 'PREVIOUS_IRB'] as const;
const RESEARCH_KEY = 'privacy.research_purpose_enabled';
const empty: Form = { approval_type: 'RESEARCH', authority: '', reference: '', valid_from: '', valid_to: '', notes: '' };
const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

const s = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))', gap: '0.75rem', alignItems: 'end' },
  formCard: { ...ui.card, background: 'var(--ilt-surface-2)', display: 'grid', gap: '0.75rem', marginBlockEnd: '1rem' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
} satisfies Record<string, CSSProperties>;

export function EthicsScreen() {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<Approval[] | null>(null);
  const [researchOn, setResearchOn] = useState<boolean | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const day = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language]);
  const fmt = (d: string | null) => (d ? day.format(new Date(`${d}T12:00:00`)) : null);

  useEffect(() => {
    api<Approval[]>('/ethics-approvals').then(setList).catch((e) => setError(message(e)));
    api<{ values: Record<string, { effective: { value: unknown } }> }>('/settings/values?scope=SYSTEM')
      .then((v) => setResearchOn(v.values[RESEARCH_KEY]?.effective.value === true))
      .catch(() => undefined);
  }, [reload]);

  /** `key` is a text key, translated when shown, so the notice follows a language change. */
  const done = (key: string) => {
    setNotice(key);
    setError(null);
    setForm(null);
    setEditId(null);
    setReload((n) => n + 1);
  };
  const badRange = !!form?.valid_from && !!form.valid_to && form.valid_from > form.valid_to;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || badRange) return;
    const body = { authority: form.authority.trim(), reference: orNull(form.reference), valid_from: orNull(form.valid_from), valid_to: orNull(form.valid_to), notes: orNull(form.notes) };
    try {
      if (editId === null) await api('/ethics-approvals', { method: 'POST', body: { ...body, approval_type: form.approval_type } });
      else await api(`/ethics-approvals/${editId}`, { method: 'PATCH', body });
      done(editId === null ? 'admin.ethics.created' : 'admin.ethics.saved');
    } catch (err) {
      setError(message(err));
    }
  }

  async function withdraw(a: Approval, withdrawn: boolean) {
    if (withdrawn && !confirm(t('admin.ethics.withdraw_confirm'))) return;
    try {
      await api(`/ethics-approvals/${a.id}`, { method: 'PATCH', body: { withdrawn } });
      done('admin.ethics.saved');
    } catch (err) {
      setError(message(err));
    }
  }

  const status = (a: Approval) =>
    a.withdrawn_at ? <span style={pill('warn')}>{t('admin.ethics.withdrawn')}</span>
      : a.valid_now ? <span style={pill('ok')}>{t('admin.ethics.valid_now')}</span>
        : <span style={pill('off')}>{t('admin.ethics.not_valid')}</span>;

  return (
    <div data-testid="ethics">
      <p style={{ ...ui.muted, marginBlockStart: 0, maxInlineSize: '52rem' }}>{t('admin.ethics.intro')}</p>
      {researchOn !== null && (
        <p style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockStart: 0 }} data-testid="ethics-research-setting">
          <span style={pill(researchOn ? 'ok' : 'off')}>{t('admin.tab.settings')}</span>
          {t(researchOn ? 'admin.ethics.research_setting_on' : 'admin.ethics.research_setting_off')}
        </p>
      )}
      <div style={{ ...s.actions, marginBlockEnd: '0.75rem' }}>
        <button style={ui.primary} onClick={() => { setNotice(null); setEditId(null); setForm({ ...empty }); }} disabled={!!form} data-testid="ethics-add">
          + {t('admin.ethics.add')}
        </button>
      </div>
      {notice && <p role="status" style={{ ...s.notice, marginBlockEnd: '0.75rem' }}>{t(notice)}</p>}
      {error && <p role="alert" style={{ ...ui.error, marginBlockEnd: '0.75rem' }}>{t(error)}</p>}

      {form && (
        <form onSubmit={submit} style={s.formCard} data-testid="ethics-form">
          <div style={s.grid}>
            <label style={ui.field}>
              {t('admin.ethics.type')}
              <select value={form.approval_type} disabled={editId !== null} onChange={(e) => setForm({ ...form, approval_type: e.target.value })}>
                {TYPES.map((k) => <option key={k} value={k}>{t(`admin.ethics.types.${k}`)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('admin.ethics.authority')}
              <input required maxLength={100} value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })} data-testid="ethics-authority" />
            </label>
            <label style={ui.field}>
              {t('admin.ethics.reference')}
              <input maxLength={100} dir="ltr" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('admin.ethics.valid_from')}
              <input type="date" dir="ltr" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('admin.ethics.valid_to')}
              <input type="date" dir="ltr" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
            </label>
          </div>
          <label style={ui.field}>
            {t('admin.ethics.notes')}
            <textarea rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          {badRange && <p role="alert" style={ui.error}>{t('admin.ethics.range_bad')}</p>}
          <div style={s.actions}>
            <button type="submit" style={ui.primary} disabled={badRange} data-testid="ethics-save">{t('admin.ethics.save')}</button>
            <button type="button" style={ui.button} onClick={() => { setForm(null); setEditId(null); }}>{t('admin.ethics.cancel')}</button>
          </div>
        </form>
      )}

      {list && list.length === 0 && <p style={ui.muted}>{t('admin.ethics.none')}</p>}
      {list && list.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="ethics-table">
            <thead>
              <tr>
                {['type', 'authority', 'reference', 'validity', 'status', 'notes'].map((k) => <th key={k} style={ui.cell}>{t(`admin.ethics.${k}`)}</th>)}
                <th style={ui.cell} />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.id} style={a.withdrawn_at ? { opacity: 0.65 } : undefined}>
                  <td style={ui.cell}>{t(`admin.ethics.types.${a.approval_type}`)}</td>
                  <td style={ui.cell}>{a.authority}</td>
                  <td style={ui.cell}><bdi dir="ltr">{a.reference ?? '—'}</bdi></td>
                  <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>
                    {a.valid_from || a.valid_to ? `${fmt(a.valid_from) ?? '…'} – ${fmt(a.valid_to) ?? t('admin.ethics.open_ended')}` : t('admin.ethics.no_dates')}
                  </td>
                  <td style={ui.cell}>
                    {status(a)}
                    {a.sessions > 0 && <div style={ui.muted}>{t('admin.ethics.sessions', { count: a.sessions })}</div>}
                  </td>
                  <td style={{ ...ui.cell, maxInlineSize: '20rem' }}><span style={ui.muted}>{a.notes ?? ''}</span></td>
                  <td style={{ ...ui.cell, whiteSpace: 'nowrap', textAlign: 'end' }}>
                    <button style={ui.button} disabled={!!form}
                      onClick={() => { setNotice(null); setEditId(a.id); setForm({ approval_type: a.approval_type, authority: a.authority, reference: a.reference ?? '', valid_from: a.valid_from ?? '', valid_to: a.valid_to ?? '', notes: a.notes ?? '' }); }}>
                      {t('admin.ethics.edit')}
                    </button>{' '}
                    {a.withdrawn_at
                      ? <button style={ui.button} onClick={() => void withdraw(a, false)}>{t('admin.ethics.restore')}</button>
                      : <button style={ui.danger} onClick={() => void withdraw(a, true)} data-testid={`ethics-withdraw-${a.id}`}>{t('admin.ethics.withdraw')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
