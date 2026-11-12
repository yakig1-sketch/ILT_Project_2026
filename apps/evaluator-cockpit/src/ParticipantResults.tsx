// A participant's results that do not come from tablet sessions (Phase 4d): the old application's
// block results for a LEGACY child (FR-LEG-1, read-only), and the scores entered by hand for a PAPER
// child (FR-LEG-2: pen lifts, accurate letters and time per block of each session stage).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from './api';
import { pill, ui } from './styles';

interface LegacyRow {
  session_label: string;
  block_number: number;
  pen_lifts: number | null;
  width_mm: number | null;
  total_time_ms: number | null;
  writing_time_ms: number | null;
  air_time_ms: number | null;
  mistakes: string | null;
}
interface PaperRow {
  session_type: Stage;
  block_number: number;
  pen_lifts: number | null;
  accurate_letters: number | null;
  total_time_ms: number | null;
  notes: string | null;
  saved_at: string;
  saved_by: string;
}
type Stage = 'DAY_1' | 'DAY_2' | 'DAY_14';
/** Blocks written on paper at each stage (Day 1: ILT 1–8, Day 2: ILT 1–4, Day 14: ILT 1–2). */
const PAPER_BLOCKS: [Stage, number][] = [['DAY_1', 8], ['DAY_2', 4], ['DAY_14', 2]];

const s = {
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h3: { margin: 0, fontSize: '1rem' },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  input: { inlineSize: '4.5rem', textAlign: 'end' },
  notes: { inlineSize: '100%', minInlineSize: '7rem' },
} satisfies Record<string, CSSProperties>;

const secs = (ms: number | null) => (ms == null ? '—' : (ms / 1000).toFixed(1));

export function LegacyResults({ participantId }: { participantId: string }) {
  const { t } = useTranslation();
  const [list, setList] = useState<LegacyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LegacyRow[]>(`/participants/${participantId}/legacy-results`).then(setList).catch((e: ApiError) => setError(e.messageKey));
  }, [participantId]);
  const labels = [...new Set((list ?? []).map((r) => r.session_label))];
  const mistakes = list?.find((r) => r.mistakes != null)?.mistakes;
  return (
    <section style={s.section} data-testid="legacy-results">
      <h3 style={s.h3}>{t('participants.legacy.title')}</h3>
      <p style={{ ...ui.muted, margin: 0 }}>{t('participants.legacy.note')}</p>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      {list && list.length === 0 && <p style={{ ...ui.muted, margin: 0 }}>{t('participants.legacy.none')}</p>}
      {mistakes != null && <p style={{ margin: 0 }}>{t('participants.legacy.mistakes', { n: mistakes })}</p>}
      {labels.map((label) => (
        <div key={label} style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="legacy-results-table">
            <caption style={{ textAlign: 'start', fontWeight: 600, paddingBlockEnd: '0.35rem' }}><bdi>{label}</bdi></caption>
            <thead>
              <tr>
                <th style={{ ...ui.cell, ...s.num }}>{t('participants.legacy.block')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('participants.legacy.pen_lifts')}</th>
                <th style={{ ...ui.cell, ...s.num }} title={t('participants.legacy.width_hint')}>{t('participants.legacy.width')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('participants.legacy.total')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('participants.legacy.writing')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('participants.legacy.air')}</th>
              </tr>
            </thead>
            <tbody>
              {list!.filter((r) => r.session_label === label).map((r) => (
                <tr key={r.block_number}>
                  <td style={{ ...ui.cell, ...s.num }}>{r.block_number}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{r.pen_lifts ?? '—'}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{r.width_mm ?? '—'}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{secs(r.total_time_ms)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{secs(r.writing_time_ms)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{secs(r.air_time_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {list && list.length > 0 && <p style={{ ...ui.muted, margin: 0, fontSize: '0.85rem' }}>{t('participants.legacy.width_hint')}</p>}
    </section>
  );
}

interface Draft { pen_lifts: string; accurate_letters: string; time_s: string; notes: string }
const key = (stage: Stage, block: number) => `${stage}:${block}`;
const toDraft = (r?: PaperRow): Draft => ({
  pen_lifts: r?.pen_lifts == null ? '' : String(r.pen_lifts),
  accurate_letters: r?.accurate_letters == null ? '' : String(r.accurate_letters),
  time_s: r?.total_time_ms == null ? '' : String(r.total_time_ms / 1000),
  notes: r?.notes ?? '',
});

export function PaperScores({ participantId, editable }: { participantId: string; editable: boolean }) {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<Map<string, PaperRow>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ k: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const when = useMemo(() => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }), [i18n.language]);

  const load = () => api<PaperRow[]>(`/participants/${participantId}/paper-scores`).then((list) => {
    const m = new Map(list.map((r) => [key(r.session_type, r.block_number), r]));
    setSaved(m);
    setDrafts(new Map(PAPER_BLOCKS.flatMap(([stage, n]) => Array.from({ length: n }, (_, i) => [key(stage, i + 1), toDraft(m.get(key(stage, i + 1)))] as const))));
  }).catch((e: ApiError) => setError(e.messageKey));
  useEffect(() => {
    void load();
  }, [participantId]);

  const changed = (k: string) => {
    const d = drafts.get(k);
    const o = toDraft(saved.get(k));
    return !!d && (d.pen_lifts !== o.pen_lifts || d.accurate_letters !== o.accurate_letters || d.time_s !== o.time_s || d.notes !== o.notes);
  };

  /** A whole number in range, or null when empty; undefined when not valid. */
  const int = (v: string, max: number) => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
  };

  const save = async (stage: Stage, block: number) => {
    const k = key(stage, block);
    const d = drafts.get(k)!;
    const pen = int(d.pen_lifts, 200);
    const acc = int(d.accurate_letters, 15);
    const secsValue = d.time_s.trim() === '' ? null : Number(d.time_s.replace(',', '.'));
    if (pen === undefined) return setRowError({ k, key: 'participants.paper.bad_pen_lifts' });
    if (acc === undefined) return setRowError({ k, key: 'participants.paper.bad_accurate' });
    if (secsValue !== null && (!Number.isFinite(secsValue) || secsValue < 0 || secsValue > 3600)) return setRowError({ k, key: 'participants.paper.bad_time' });
    setRowError(null);
    setBusy(k);
    setNotice(null);
    try {
      const r = await api<{ saved: boolean }>(`/participants/${participantId}/paper-scores`, {
        method: 'PUT',
        body: { session_type: stage, block_number: block, pen_lifts: pen, accurate_letters: acc, total_time_ms: secsValue == null ? null : Math.round(secsValue * 1000), notes: d.notes.trim() || null },
      });
      setNotice(r.saved ? 'participants.paper.saved' : 'participants.paper.cleared');
      await load();
    } catch (e) {
      setRowError({ k, key: (e as ApiError).messageKey });
    } finally {
      setBusy(null);
    }
  };

  const set = (k: string, field: keyof Draft, v: string) => {
    setDrafts((m) => new Map(m).set(k, { ...m.get(k)!, [field]: v }));
    // A row's error describes the values that were refused; editing the row makes it stale.
    setRowError((e) => (e?.k === k ? null : e));
  };

  return (
    <section style={s.section} data-testid="paper-scores">
      <h3 style={s.h3}>{t('participants.paper.title')}</h3>
      <p style={{ ...ui.muted, margin: 0 }}>{t('participants.paper.note')}</p>
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}
      {notice && <p role="status" style={{ margin: 0, color: 'var(--ilt-ok)' }}>{t(notice)}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={ui.table} data-testid="paper-table">
          <thead>
            <tr>
              <th style={ui.cell}>{t('participants.paper.stage')}</th>
              <th style={{ ...ui.cell, ...s.num }}>{t('participants.paper.block')}</th>
              <th style={{ ...ui.cell, ...s.num }}>{t('participants.paper.pen_lifts')}</th>
              <th style={{ ...ui.cell, ...s.num }}>{t('participants.paper.accurate')}</th>
              <th style={{ ...ui.cell, ...s.num }}>{t('participants.paper.time')}</th>
              <th style={ui.cell}>{t('participants.paper.notes')}</th>
              <th style={ui.cell}>{t('participants.paper.saved_col')}</th>
              {editable && <th style={ui.cell} />}
            </tr>
          </thead>
          <tbody>
            {PAPER_BLOCKS.flatMap(([stage, n]) => Array.from({ length: n }, (_, i) => {
              const block = i + 1;
              const k = key(stage, block);
              const d = drafts.get(k) ?? toDraft();
              const r = saved.get(k);
              return (
                <tr key={k} data-testid={`paper-row-${stage}-${block}`}>
                  <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>{block === 1 ? t(`enum.session_type.${stage}`) : ''}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{t('participants.paper.ilt_block', { n: block })}</td>
                  {editable ? (
                    <>
                      <td style={{ ...ui.cell, ...s.num }}><input style={s.input} inputMode="numeric" value={d.pen_lifts} onChange={(e) => set(k, 'pen_lifts', e.target.value)} aria-label={t('participants.paper.pen_lifts')} data-testid={`paper-pen-${stage}-${block}`} /></td>
                      <td style={{ ...ui.cell, ...s.num }}><input style={s.input} inputMode="numeric" value={d.accurate_letters} onChange={(e) => set(k, 'accurate_letters', e.target.value)} aria-label={t('participants.paper.accurate')} data-testid={`paper-acc-${stage}-${block}`} /></td>
                      <td style={{ ...ui.cell, ...s.num }}><input style={s.input} inputMode="decimal" value={d.time_s} onChange={(e) => set(k, 'time_s', e.target.value)} aria-label={t('participants.paper.time')} data-testid={`paper-time-${stage}-${block}`} /></td>
                      <td style={ui.cell}><input style={s.notes} maxLength={500} value={d.notes} onChange={(e) => set(k, 'notes', e.target.value)} aria-label={t('participants.paper.notes')} /></td>
                    </>
                  ) : (
                    <>
                      <td style={{ ...ui.cell, ...s.num }}>{r?.pen_lifts ?? '—'}</td>
                      <td style={{ ...ui.cell, ...s.num }}>{r?.accurate_letters ?? '—'}</td>
                      <td style={{ ...ui.cell, ...s.num }}>{secs(r?.total_time_ms ?? null)}</td>
                      <td style={ui.cell}>{r?.notes ?? ''}</td>
                    </>
                  )}
                  <td style={{ ...ui.cell, color: 'var(--ilt-muted)', fontSize: '0.8rem' }}>
                    {r ? <>{when.format(new Date(r.saved_at))} · {r.saved_by}</> : <span style={pill('off')}>{t('participants.paper.empty')}</span>}
                  </td>
                  {editable && (
                    <td style={{ ...ui.cell, whiteSpace: 'nowrap' }}>
                      <button style={changed(k) ? ui.primary : ui.button} disabled={!changed(k) || busy !== null} onClick={() => void save(stage, block)} data-testid={`paper-save-${stage}-${block}`}>
                        {t('participants.paper.save')}
                      </button>
                      {rowError?.k === k && <div role="alert" style={{ ...ui.error, marginBlockStart: '0.3rem' }}>{t(rowError.key)}</div>}
                    </td>
                  )}
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
