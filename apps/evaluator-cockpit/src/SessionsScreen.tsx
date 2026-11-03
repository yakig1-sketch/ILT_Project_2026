// Session list and planning: find or create a participant, then create a session. The list can be
// filtered by code, status, type and creation date (filtered on the server).
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
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
const STATUSES = ['PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABORTED'] as const;
const NO_FILTER = { q: '', status: '', session_type: '', from: '', to: '' };
const SEARCH_DELAY_MS = 250;

/** Query string from the filled fields only. */
const query = (f: Record<string, string>) => {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v.trim() !== ''));
  return p.size ? `?${p}` : '';
};

export function SessionsScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<SessionListRow[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [filter, setFilter] = useState(NO_FILTER);
  const filtered = Object.values(filter).some((v) => v !== '');
  const [domains, setDomains] = useState<Domain[]>([]);
  const [regions, setRegions] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ participant_id: '', session_type: 'DAY_1', language_code: 'he' });
  const [newP, setNewP] = useState<{ study_code: string; domain_id: number; region_id: number | null; school: string; birth_year_month: string; grade_level: string; gender: string; dominant_hand: string } | null>(null);
  const thisMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    api<Domain[]>('/domains').then(setDomains).catch(() => undefined);
    api<Domain[]>('/regions').then(setRegions).catch(() => undefined);
  }, []);
  // The list follows the filters; typing waits a moment so each key press is not a request.
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      const tz = filter.from || filter.to ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
      api<SessionListRow[]>(`/sessions${query({ ...filter, tz })}`)
        .then((list) => alive && setSessions(list))
        .catch((e: ApiError) => alive && setError(e.messageKey));
    }, filter.q ? SEARCH_DELAY_MS : 0);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [filter]);

  const name = (d: Domain) => (i18n.language === 'he' ? d.name_he : d.name_en);

  async function createParticipant(e: FormEvent) {
    e.preventDefault();
    if (!newP) return;
    setError(null);
    try {
      const p = await api<Participant>('/participants', { method: 'POST', body: newP });
      setParticipant(p);
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
          <ParticipantPicker
            value={participant}
            onChange={(p) => {
              setParticipant(p);
              setForm((f) => ({ ...f, participant_id: p?.id ?? '' }));
            }}
          />
          <button
            type="button"
            style={ui.button}
            onClick={() => setNewP({ study_code: '', domain_id: domains[0]?.id ?? 1, region_id: null, school: '', birth_year_month: '', grade_level: 'GRADE_1', gender: 'FEMALE', dominant_hand: 'RIGHT' })}
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
          <form onSubmit={createParticipant} style={{ ...ui.row, marginBlockStart: '1rem', paddingBlockStart: '1rem', borderBlockStart: '1px solid var(--ilt-border-soft)' }}>
            <label style={ui.field}>
              {t('cockpit.participant_code')}
              <input required dir="ltr" pattern="[A-Za-z0-9_\-]+" maxLength={40} value={newP.study_code} onChange={(e) => setNewP({ ...newP, study_code: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('cockpit.school')}
              <input required maxLength={120} value={newP.school} title={t('cockpit.school_hint')} onChange={(e) => setNewP({ ...newP, school: e.target.value })} />
            </label>
            <label style={ui.field}>
              {t('cockpit.birth_month')}
              <input required type="month" dir="ltr" min="2000-01" max={thisMonth} value={newP.birth_year_month} onChange={(e) => setNewP({ ...newP, birth_year_month: e.target.value })} />
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
            <p style={{ ...ui.muted, flexBasis: '100%', margin: 0 }}>{t('cockpit.intake_privacy')}</p>
          </form>
        )}
        {error && <p role="alert" style={{ ...ui.error, marginBlockStart: '0.75rem' }}>{t(error)}</p>}
      </section>

      <section style={ui.card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.1rem' }}>{t('cockpit.sessions')}</h2>
        <div style={{ ...ui.row, marginBlockEnd: '0.75rem' }} data-testid="session-filters">
          <label style={ui.field}>
            {t('cockpit.filter.search')}
            <input type="search" dir="ltr" placeholder={t('cockpit.filter.search_hint')} maxLength={40} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} data-testid="filter-q" />
          </label>
          <label style={ui.field}>
            {t('cockpit.status')}
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="filter-status">
              <option value="">{t('cockpit.filter.all')}</option>
              {STATUSES.map((v) => <option key={v} value={v}>{t(`enum.session_status.${v}`)}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('cockpit.session_type')}
            <select value={filter.session_type} onChange={(e) => setFilter({ ...filter, session_type: e.target.value })}>
              <option value="">{t('cockpit.filter.all')}</option>
              {TYPES.map((v) => <option key={v} value={v}>{t(`enum.session_type.${v}`)}</option>)}
            </select>
          </label>
          <label style={ui.field}>
            {t('cockpit.filter.from')}
            <input type="date" dir="ltr" value={filter.from} max={filter.to || undefined} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
          </label>
          <label style={ui.field}>
            {t('cockpit.filter.to')}
            <input type="date" dir="ltr" value={filter.to} min={filter.from || undefined} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
          </label>
          <button type="button" style={ui.button} disabled={!filtered} onClick={() => setFilter(NO_FILTER)}>{t('cockpit.filter.clear')}</button>
          <span style={{ ...ui.muted, alignSelf: 'center' }} data-testid="filter-count">{t('cockpit.filter.shown', { count: sessions.length })}</span>
        </div>
        {sessions.length === 0 ? (
          <p style={ui.muted}>{t(filtered ? 'cockpit.filter.none' : 'common.none_yet')}</p>
        ) : (
          <table style={ui.table}>
            <thead>
              <tr>
                {['cockpit.session_code', 'cockpit.participant_code', 'cockpit.session_type', 'cockpit.session_language', 'cockpit.status', 'cockpit.created', ''].map((k) => (
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

const pick: Record<string, CSSProperties> = {
  list: {
    position: 'absolute', insetInlineStart: 0, insetBlockStart: '100%', marginBlockStart: 2, zIndex: 10, minInlineSize: '100%', maxBlockSize: '16rem',
    overflowY: 'auto', boxSizing: 'border-box', padding: '0.25rem', listStyle: 'none',
    background: 'var(--ilt-surface)', border: '1px solid var(--ilt-border)', borderRadius: 6, boxShadow: 'var(--ilt-shadow)',
  },
  item: { paddingBlock: '0.3rem', paddingInline: '0.5rem', borderRadius: 4, cursor: 'pointer', whiteSpace: 'nowrap' },
};

/** Participant search: type part of a study code and choose from the matches (keyboard or mouse). */
function ParticipantPicker({ value, onChange }: { value: Participant | null; onChange: (p: Participant | null) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value?.study_code ?? '');
  const [matches, setMatches] = useState<Participant[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setText(value?.study_code ?? ''), [value]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const id = setTimeout(() => {
      api<Participant[]>(`/participants${query({ q: text, limit: '20' })}`)
        .then((list) => {
          if (!alive) return;
          setMatches(list);
          setActive(0);
        })
        .catch(() => alive && setMatches([]));
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [text, open]);

  const choose = (p: Participant) => {
    onChange(p);
    setText(p.study_code);
    setOpen(false);
  };

  return (
    <label style={{ ...ui.field, position: 'relative' }}>
      {t('cockpit.participant')}
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls="participant-matches"
        aria-autocomplete="list"
        dir="ltr"
        autoComplete="off"
        placeholder={t('cockpit.participant_search')}
        value={text}
        data-testid="participant-search"
        onFocus={() => setOpen(true)}
        onBlur={() => (blurTimer.current = setTimeout(() => setOpen(false), 150))}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value && e.target.value !== value.study_code) onChange(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (matches.length ? (i + step + matches.length) % matches.length : 0));
          } else if (e.key === 'Enter' && open && matches[active]) {
            e.preventDefault();
            choose(matches[active]!);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id="participant-matches" role="listbox" style={pick.list} onMouseDown={() => clearTimeout(blurTimer.current)}>
          {matches.length === 0 ? (
            <li style={{ ...pick.item, ...ui.muted, cursor: 'default' }}>{t('cockpit.no_participant_match')}</li>
          ) : (
            matches.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                dir="ltr"
                style={{ ...pick.item, background: i === active ? 'var(--ilt-select)' : undefined, fontWeight: p.id === value?.id ? 600 : undefined }}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                {p.study_code}
              </li>
            ))
          )}
        </ul>
      )}
    </label>
  );
}
