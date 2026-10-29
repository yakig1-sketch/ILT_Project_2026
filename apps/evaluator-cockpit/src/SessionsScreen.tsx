// Session list and planning: choose or create a participant, then create a session.
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { ui } from './styles';

interface SessionListRow {
  id: string;
  session_code: string;
  study_code: string;
  session_type: string;
  language_code: string;
  status: string;
  created_at: string;
}
interface Participant {
  id: string;
  study_code: string;
}
interface Domain {
  id: number;
  code: string;
  name_he: string;
  name_en: string;
}

const GRADES = ['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6'] as const;
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const HANDS = ['RIGHT', 'LEFT', 'AMBIDEXTROUS'] as const;
const TYPES = ['DAY_1', 'DAY_2', 'DAY_14'] as const;

export function SessionsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [regions, setRegions] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ participant_id: '', session_type: 'DAY_1', language_code: 'he' });
  const [newP, setNewP] = useState<{ study_code: string; domain_id: number; region_id: number | null; grade_level: string; gender: string; dominant_hand: string } | null>(null);

  const load = () => {
    api<SessionListRow[]>('/sessions').then(setSessions).catch((e: ApiError) => setError(e.messageKey));
    api<Participant[]>('/participants').then(setParticipants).catch((e: ApiError) => setError(e.messageKey));
  };
  useEffect(() => {
    load();
    api<Domain[]>('/domains').then(setDomains).catch(() => undefined);
    api<Domain[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);

  const name = (d: Domain) => (i18n.language === 'he' ? d.name_he : d.name_en);

  async function createParticipant(e: FormEvent) {
    e.preventDefault();
    if (!newP) return;
    setError(null);
    try {
      const p = await api<Participant>('/participants', { method: 'POST', body: newP });
      setParticipants((list) => [p, ...list]);
      setForm((f) => ({ ...f, participant_id: p.id }));
      setNewP(null);
    } catch (err) {
      setError((err as ApiError).messageKey);
    }
  }

  async function createSession(e: FormEvent) {
    e.preventDefault();
    if (!form.participant_id) {
      setError('cockpit.choose_participant');
      return;
    }
    setError(null);
    try {
      const s = await api<{ id: string }>('/sessions', { method: 'POST', body: form });
      onOpen(s.id);
    } catch (err) {
      setError((err as ApiError).messageKey);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <section style={ui.card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.new_session')}</h2>
        <form onSubmit={createSession} style={ui.row}>
          <label style={ui.field}>
            {t('cockpit.participant')}
            <select value={form.participant_id} onChange={(e) => setForm({ ...form, participant_id: e.target.value })}>
              <option value="">{t('cockpit.choose_participant')}</option>
              {participants.map((p) => (
                <option key={p.id} value={p.id}>{p.study_code}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            style={ui.button}
            onClick={() => setNewP({ study_code: '', domain_id: domains[0]?.id ?? 1, region_id: null, grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' })}
          >
            + {t('cockpit.new_participant')}
          </button>
          <label style={ui.field}>
            {t('cockpit.session_type')}
            <select value={form.session_type} onChange={(e) => setForm({ ...form, session_type: e.target.value })}>
              {TYPES.map((v) => <option key={v} value={v}>{t(`enum.session_type.${v}`)}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('cockpit.session_language')}
            <select value={form.language_code} onChange={(e) => setForm({ ...form, language_code: e.target.value })}>
              <option value="he">{t('common.hebrew')}</option>
              <option value="en">{t('common.english')}</option>
            </select>
          </label>
          <button type="submit" style={ui.primary}>{t('common.create')}</button>
        </form>

        {newP && (
          <form onSubmit={createParticipant} style={{ ...ui.row, marginBlockStart: '1rem', paddingBlockStart: '1rem', borderBlockStart: '1px solid #eaeef2' }}>
            <label style={ui.field}>
              {t('cockpit.study_code')}
              <input required dir="ltr" pattern="[A-Za-z0-9_\-]+" maxLength={40} value={newP.study_code} onChange={(e) => setNewP({ ...newP, study_code: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('cockpit.domain')}
              <select value={newP.domain_id} onChange={(e) => setNewP({ ...newP, domain_id: Number(e.target.value) })}>
                {domains.map((d) => <option key={d.id} value={d.id}>{name(d)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.region')}
              <select value={newP.region_id ?? ''} onChange={(e) => setNewP({ ...newP, region_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{name(r)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.grade')}
              <select value={newP.grade_level} onChange={(e) => setNewP({ ...newP, grade_level: e.target.value })}>
                {GRADES.map((v) => <option key={v} value={v}>{t(`enum.grade.${v}`)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.gender')}
              <select value={newP.gender} onChange={(e) => setNewP({ ...newP, gender: e.target.value })}>
                {GENDERS.map((v) => <option key={v} value={v}>{t(`enum.gender.${v}`)}</option>)}
              </select>
            </label>
            <label style={ui.field}>
              {t('cockpit.hand')}
              <select value={newP.dominant_hand} onChange={(e) => setNewP({ ...newP, dominant_hand: e.target.value })}>
                {HANDS.map((v) => <option key={v} value={v}>{t(`enum.hand.${v}`)}</option>)}
              </select>
            </label>
            <button type="submit" style={ui.primary}>{t('common.create')}</button>
            <button type="button" style={ui.button} onClick={() => setNewP(null)}>{t('common.cancel')}</button>
          </form>
        )}
        {error && <p role="alert" style={{ ...ui.error, marginBlockStart: '0.75rem' }}>{t(error)}</p>}
      </section>

      <section style={ui.card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.sessions')}</h2>
        {sessions.length === 0 ? (
          <p style={ui.muted}>{t('common.none_yet')}</p>
        ) : (
          <table style={ui.table}>
            <thead>
              <tr>
                {['cockpit.session_code', 'cockpit.participant', 'cockpit.session_type', 'cockpit.session_language', 'cockpit.status', 'cockpit.created', ''].map((k) => (
                  <th key={k} style={ui.cell}>{k && t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td style={ui.cell}><bdi>{s.session_code}</bdi></td>
                  <td style={ui.cell}><bdi>{s.study_code}</bdi></td>
                  <td style={ui.cell}>{t(`enum.session_type.${s.session_type}`)}</td>
                  <td style={ui.cell}>{s.language_code === 'he' ? t('common.hebrew') : t('common.english')}</td>
                  <td style={ui.cell}>{t(`enum.session_status.${s.status}`)}</td>
                  <td style={ui.cell}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s.created_at))}</td>
                  <td style={ui.cell}><button style={ui.button} onClick={() => onOpen(s.id)}>{t('cockpit.open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
