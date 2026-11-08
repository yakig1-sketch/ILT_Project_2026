// Participant record (FRS FR-PART-1…4, FR-PLAN-1, FR-PRIV-1/2): the participant's details (no identity
// data: the study code never changes and the school is only a protected code), deactivation, consent
// with its history, and whether a research session or hand video is possible now.
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { pill, ui } from './styles';
import { BackButton } from './BackButton';

interface Consent {
  id: string;
  consent_version: string;
  signed_on: string;
  allows_hand_video: boolean;
  allows_research_use: boolean;
  allows_open_science: boolean;
  recorded_by: string;
  recorded_at: string;
  superseded_at: string | null;
}
interface Detail {
  id: string;
  study_code: string;
  domain_id: number;
  region_id: number | null;
  grade_level: string;
  gender: string;
  ses_group: string | null;
  dominant_hand: string;
  birth_year_month: string | null;
  is_active: boolean;
  has_school: boolean;
  created_at: string;
  updated_at: string | null;
  consent: Consent | null;
  consent_history: Consent[];
  sessions: number;
  research: { allowed: true } | { allowed: false; reason: string };
  hand_video: { setting: boolean };
}
interface Group { id: number; code: string; name_he: string; name_en: string }

const GRADES = ['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const HANDS = ['RIGHT', 'LEFT', 'AMBIDEXTROUS'] as const;
const SES = ['LOW', 'MID', 'HIGH'] as const;
const FLAGS = [['allows_hand_video', 'hand_video'], ['allows_research_use', 'research_use'], ['allows_open_science', 'open_science']] as const;

const message = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const s = {
  head: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))', gap: '0.75rem', alignItems: 'end' },
  dl: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))', gap: '0.6rem 1rem', margin: 0 },
  dt: { color: 'var(--ilt-muted)', fontSize: '0.8rem' },
  dd: { margin: 0, fontWeight: 600 },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  notice: { margin: 0, padding: '0.5rem 0.75rem', borderRadius: 6, background: 'var(--ilt-ok-bg)', color: 'var(--ilt-ok)' },
  status: { display: 'flex', gap: '0.5rem', alignItems: 'center', margin: 0, fontSize: '0.9rem' },
  check: { display: 'flex', gap: '0.4rem', alignItems: 'center' },
  h3: { margin: 0, fontSize: '1rem' },
} satisfies Record<string, CSSProperties>;

export function ParticipantScreen({ participantId, onConsole }: { participantId: string; onConsole: () => void }) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const [p, setP] = useState<Detail | null>(null);
  const [domains, setDomains] = useState<Group[]>([]);
  const [regions, setRegions] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const [consentForm, setConsentForm] = useState<{ consent_version: string; signed_on: string; allows_hand_video: boolean; allows_research_use: boolean; allows_open_science: boolean } | null>(null);
  const when = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }), [i18n.language]);
  const day = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }), [i18n.language]);
  const name = (g: Group | undefined) => (g ? (he ? g.name_he : g.name_en) : '—');

  useEffect(() => {
    api<Group[]>('/domains').then(setDomains).catch(() => undefined);
    api<Group[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);
  useEffect(() => {
    api<Detail>(`/participants/${participantId}`).then(setP).catch((e) => setError(message(e)));
  }, [participantId, reload]);

  /** `key` is a text key, translated when shown, so the notice follows a language change. */
  const done = (key: string) => {
    setNotice(key);
    setError(null);
    setReload((n) => n + 1);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    try {
      const body = Object.fromEntries(Object.entries(edit).filter(([k, v]) => k !== 'school' || (typeof v === 'string' && v.trim() !== '')));
      const r = await api<{ changed: string[] }>(`/participants/${participantId}`, { method: 'PATCH', body });
      setEdit(null);
      done(r.changed.length ? 'participants.saved' : 'participants.no_changes');
    } catch (err) {
      setError(message(err));
    }
  }

  async function setActive(active: boolean) {
    if (!active && !confirm(t('participants.deactivate_confirm'))) return;
    try {
      await api(`/participants/${participantId}`, { method: 'PATCH', body: { is_active: active } });
      done('participants.saved');
    } catch (err) {
      setError(message(err));
    }
  }

  async function recordConsent(e: FormEvent) {
    e.preventDefault();
    if (!consentForm) return;
    try {
      await api(`/participants/${participantId}/consent`, { method: 'POST', body: consentForm });
      setConsentForm(null);
      done('participants.consent.recorded');
    } catch (err) {
      setError(message(err));
    }
  }

  if (!p) {
    return (
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div><BackButton onClick={onConsole} label={t('participants.back_console')} /></div>
        {error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>…</p>}
      </div>
    );
  }

  const yesNo = (v: boolean) => <span style={pill(v ? 'ok' : 'off')}>{t(v ? 'participants.consent.yes' : 'participants.consent.no')}</span>;
  const c = p.consent;
  const videoKey = !p.hand_video.setting ? 'off' : c?.allows_hand_video ? 'on_consent' : 'on_no_consent';
  return (
    <div style={{ display: 'grid', gap: '0.75rem' }} data-testid="participant-record">
      <div><BackButton onClick={onConsole} label={t('participants.back_console')} /></div>

      <section style={{ ...ui.card, display: 'grid', gap: '0.9rem' }}>
        <div style={s.head}>
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{t('participants.record')}: <bdi dir="ltr">{p.study_code}</bdi></h2>
          {!p.is_active && <span style={pill('warn')}>{t('participants.deactivated')}</span>}
          <span style={ui.muted}>{t('participants.sessions', { count: p.sessions })}</span>
          <span style={{ flex: 1 }} />
          {!edit && p.is_active && (
            <button style={ui.button} data-testid="participant-edit"
              onClick={() => { setNotice(null); setEdit({ domain_id: p.domain_id, region_id: p.region_id, grade_level: p.grade_level, gender: p.gender, ses_group: p.ses_group, dominant_hand: p.dominant_hand, birth_year_month: p.birth_year_month ?? '', school: '' }); }}>
              {t('participants.edit')}
            </button>
          )}
          {!edit && (
            p.is_active
              ? <button style={ui.danger} onClick={() => void setActive(false)} data-testid="participant-deactivate">{t('participants.deactivate')}</button>
              : <button style={ui.button} onClick={() => void setActive(true)}>{t('participants.reactivate')}</button>
          )}
        </div>
        {!p.is_active && <p style={{ ...ui.muted, margin: 0 }}>{t('participants.inactive_note')}</p>}
        {notice && <p role="status" style={s.notice}>{t(notice)}</p>}
        {error && <p role="alert" style={ui.error}>{t(error)}</p>}

        {edit ? (
          <form onSubmit={save} style={{ display: 'grid', gap: '0.75rem' }} data-testid="participant-form">
            <div style={s.grid}>
              <label style={ui.field}>
                {t('cockpit.participant_code')}
                <input value={p.study_code} disabled dir="ltr" title={t('participants.code_fixed')} />
              </label>
              <label style={ui.field}>
                {t('cockpit.domain')}
                <select value={String(edit.domain_id)} onChange={(e) => setEdit({ ...edit, domain_id: Number(e.target.value) })}>
                  {domains.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
                </select>
              </label>
              <label style={ui.field}>
                {t('cockpit.region')}
                <select value={edit.region_id == null ? '' : String(edit.region_id)} onChange={(e) => setEdit({ ...edit, region_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {regions.map((r) => <option key={r.id} value={r.id}>{name(r)}</option>)}
                </select>
              </label>
              <label style={ui.field}>
                {t('participants.school_new')}
                <input maxLength={120} value={String(edit.school)} placeholder={t('participants.school_new_hint')} title={t('cockpit.school_hint')} onChange={(e) => setEdit({ ...edit, school: e.target.value })} />
              </label>
              <label style={ui.field}>
                {t('cockpit.birth_month')}
                <input required type="month" dir="ltr" min="2000-01" max={today().slice(0, 7)} value={String(edit.birth_year_month)} onChange={(e) => setEdit({ ...edit, birth_year_month: e.target.value })} />
              </label>
              <label style={ui.field}>
                {t('cockpit.grade')}
                <select value={String(edit.grade_level)} onChange={(e) => setEdit({ ...edit, grade_level: e.target.value })}>
                  {GRADES.map((v) => <option key={v} value={v}>{t(`enum.grade.${v}`)}</option>)}
                </select>
              </label>
              <label style={ui.field}>
                {t('cockpit.gender')}
                <select value={String(edit.gender)} onChange={(e) => setEdit({ ...edit, gender: e.target.value })}>
                  {GENDERS.map((v) => <option key={v} value={v}>{t(`enum.gender.${v}`)}</option>)}
                </select>
              </label>
              <label style={ui.field}>
                {t('cockpit.ses')}
                <select value={edit.ses_group == null ? '' : String(edit.ses_group)} onChange={(e) => setEdit({ ...edit, ses_group: e.target.value || null })}>
                  <option value="">—</option>
                  {SES.map((v) => <option key={v} value={v}>{t(`enum.ses.${v}`)}</option>)}
                </select>
              </label>
              <label style={ui.field}>
                {t('cockpit.hand')}
                <select value={String(edit.dominant_hand)} onChange={(e) => setEdit({ ...edit, dominant_hand: e.target.value })}>
                  {HANDS.map((v) => <option key={v} value={v}>{t(`enum.hand.${v}`)}</option>)}
                </select>
              </label>
            </div>
            <div style={s.actions}>
              <button type="submit" style={ui.primary} data-testid="participant-save">{t('participants.save')}</button>
              <button type="button" style={ui.button} onClick={() => setEdit(null)}>{t('participants.cancel')}</button>
              <span style={ui.muted}>{t('cockpit.intake_privacy')}</span>
            </div>
          </form>
        ) : (
          <dl style={s.dl}>
            {([
              ['cockpit.domain', name(domains.find((d) => d.id === p.domain_id))],
              ['cockpit.region', p.region_id ? name(regions.find((r) => r.id === p.region_id)) : '—'],
              ['cockpit.school', t(p.has_school ? 'participants.school_kept' : 'participants.school_none')],
              ['cockpit.birth_month', p.birth_year_month ? <bdi dir="ltr">{p.birth_year_month}</bdi> : '—'],
              ['cockpit.grade', t(`enum.grade.${p.grade_level}`)],
              ['cockpit.gender', t(`enum.gender.${p.gender}`)],
              ['cockpit.ses', p.ses_group ? t(`enum.ses.${p.ses_group}`) : '—'],
              ['cockpit.hand', t(`enum.hand.${p.dominant_hand}`)],
            ] as const).map(([k, v]) => (
              <div key={k}><dt style={s.dt}>{t(k)}</dt><dd style={s.dd}>{v}</dd></div>
            ))}
          </dl>
        )}
        <p style={{ ...ui.muted, margin: 0 }}>
          {t('participants.created', { when: when.format(new Date(p.created_at)) })}
          {p.updated_at && <> · {t('participants.updated', { when: when.format(new Date(p.updated_at)) })}</>}
        </p>
      </section>

      <section style={{ ...ui.card, display: 'grid', gap: '0.75rem' }} data-testid="consent">
        <div style={s.head}>
          <h3 style={s.h3}>{t('participants.consent.title')}</h3>
          <span style={{ flex: 1 }} />
          {!consentForm && p.is_active && (
            <button style={c ? ui.button : ui.primary} data-testid="consent-record"
              onClick={() => {
                setNotice(null);
                setConsentForm({ consent_version: c?.consent_version ?? '', signed_on: today(), allows_hand_video: false, allows_research_use: false, allows_open_science: false });
              }}>
              {t(c ? 'participants.consent.record_new' : 'participants.consent.record')}
            </button>
          )}
        </div>
        {c ? (
          <dl style={s.dl}>
            <div><dt style={s.dt}>{t('participants.consent.version')}</dt><dd style={s.dd}><bdi>{c.consent_version}</bdi></dd></div>
            <div><dt style={s.dt}>{t('participants.consent.signed_on')}</dt><dd style={s.dd}>{day.format(new Date(`${c.signed_on}T12:00:00`))}</dd></div>
            {FLAGS.map(([k, label]) => (
              <div key={k}><dt style={s.dt}>{t(`participants.consent.${label}`)}</dt><dd style={s.dd}>{yesNo(c[k])}</dd></div>
            ))}
          </dl>
        ) : (
          <p style={{ ...ui.muted, margin: 0 }} data-testid="consent-none">{t('participants.consent.none')}</p>
        )}

        {consentForm && (
          <form onSubmit={recordConsent} style={{ display: 'grid', gap: '0.75rem', padding: '0.75rem', borderRadius: 8, background: 'var(--ilt-surface-2)' }} data-testid="consent-form">
            <div style={s.grid}>
              <label style={ui.field}>
                {t('participants.consent.version')}
                <input required maxLength={20} value={consentForm.consent_version} onChange={(e) => setConsentForm({ ...consentForm, consent_version: e.target.value })} data-testid="consent-version" />
              </label>
              <label style={ui.field}>
                {t('participants.consent.signed_on')}
                <input required type="date" dir="ltr" max={today()} value={consentForm.signed_on} onChange={(e) => setConsentForm({ ...consentForm, signed_on: e.target.value })} />
              </label>
            </div>
            <div style={{ ...s.actions, gap: '1.25rem' }}>
              {FLAGS.map(([k, label]) => (
                <label key={k} style={s.check}>
                  <input type="checkbox" checked={consentForm[k]} onChange={(e) => setConsentForm({ ...consentForm, [k]: e.target.checked })} data-testid={`consent-${label}`} />
                  {t(`participants.consent.${label}`)}
                </label>
              ))}
            </div>
            <p style={{ ...ui.muted, margin: 0 }}>{t('participants.consent.defaults_note')}</p>
            <div style={s.actions}>
              <button type="submit" style={ui.primary} data-testid="consent-save">{t('participants.consent.record')}</button>
              <button type="button" style={ui.button} onClick={() => setConsentForm(null)}>{t('participants.cancel')}</button>
            </div>
          </form>
        )}

        <div style={{ display: 'grid', gap: '0.35rem', paddingBlockStart: '0.5rem', borderBlockStart: '1px solid var(--ilt-border-soft)' }}>
          <p style={s.status} data-testid="research-status">
            <span style={pill(p.research.allowed ? 'ok' : 'off')}>{t('participants.research.title')}</span>
            {t(p.research.allowed ? 'participants.research.allowed' : `participants.research.${p.research.reason}`)}
          </p>
          <p style={{ ...s.status, color: 'var(--ilt-muted)' }}>{t(`participants.video.${videoKey}`)}</p>
        </div>

        {p.consent_history.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer' }}>{t('participants.consent.history')} ({p.consent_history.length})</summary>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ ...ui.table, marginBlockStart: '0.5rem' }} data-testid="consent-history">
                <thead>
                  <tr>
                    {['participants.consent.at', 'participants.consent.version', 'participants.consent.signed_on', 'participants.consent.hand_video',
                      'participants.consent.research_use', 'participants.consent.open_science', 'participants.consent.by', ''].map((k, i) => (
                      <th key={i} style={ui.cell}>{k ? t(k) : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.consent_history.map((h) => (
                    <tr key={h.id}>
                      <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{when.format(new Date(h.recorded_at))}</td>
                      <td style={ui.cell}><bdi>{h.consent_version}</bdi></td>
                      <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{day.format(new Date(`${h.signed_on}T12:00:00`))}</td>
                      {FLAGS.map(([k]) => <td key={k} style={ui.cell}>{yesNo(h[k])}</td>)}
                      <td style={ui.cell}>{h.recorded_by}</td>
                      <td style={ui.cell}>
                        {h.superseded_at
                          ? <span style={ui.muted}>{t('participants.consent.superseded', { when: when.format(new Date(h.superseded_at)) })}</span>
                          : <span style={pill('ok')}>{t('participants.consent.current')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
