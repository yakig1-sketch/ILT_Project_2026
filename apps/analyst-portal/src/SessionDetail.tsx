// One research session (FR-AN-1): its de-identified details, the settings it ran with, and every block
// attempt with its current score. The counted attempts (the latest finished one of each scored ILT block)
// are marked; any block with samples can be replayed (FR-REP-4).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BackButton, pill, ui } from '@ilt/ui';
import { ApiError, api } from './api';
import { KIN_COLUMNS, KinCells, type KinSummary } from './KinematicsScreen';
import { ageLabel, num, valueLabel, type Options } from './labels';

interface Detail {
  session: {
    session_id: string;
    session_code: string;
    study_code: string;
    domain_id: number;
    region_id: number | null;
    school_key: string | null;
    grade_level: string;
    gender: string;
    ses_group: string | null;
    dominant_hand: string;
    cohort: string;
    session_type: string;
    language_code: string;
    age_months: number | null;
    device_model: string | null;
    started_at: string | null;
    completed_at: string | null;
    settings: {
      inactivity_sec: number | null;
      inactivity_last_box_sec: number | null;
      pass_threshold: number | null;
      weight_speed_pct: number | null;
      weight_accuracy_pct: number | null;
      weight_pen_lifts_pct: number | null;
    };
  };
  blocks: {
    block_attempt_id: string;
    step_index: number;
    step_type: string;
    label_key: string;
    block_number: number | null;
    canvas_code: string | null;
    attempt_number: number;
    status: string;
    sample_count: number | null;
    total_time_ms: number | null;
    pen_lifts: number | null;
    accuracy_score: number | null;
    avg_speed_mm_s: number | null;
    speed_score: number | null;
    composite_score: number | null;
    pass: boolean | null;
    counts: boolean;
  }[];
}

/** An intervention sheet's marks (Phase 5d): the system's suggestion and the mark in force per letter. */
interface SheetMark {
  box_id: number;
  row_type: 'TRACE_MODEL' | 'START_DOT' | 'FREEHAND';
  letter: string;
  auto_error: boolean | null;
  start_point_ok: boolean | null;
  final_error: boolean | null;
  decided_by: 'SYSTEM' | 'EVALUATOR' | null;
  similarity_hint: number | null;
  internal_pen_lifts: number | null;
  lifts_allowed: number | null;
}

const s = {
  dl: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))', gap: '0.5rem 1rem', margin: 0 },
  dt: { color: 'var(--ilt-muted)', fontSize: '0.85rem' },
  dd: { margin: 0 },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums' },
  section: { ...ui.card, display: 'grid', gap: '0.75rem' },
  h: { margin: 0, fontSize: '1.1rem' },
} satisfies Record<string, CSSProperties>;

export function SessionDetail({ sessionId, onBack, onReplay, onKinematics }: {
  sessionId: string; onBack: () => void; onReplay: (attemptId: string) => void; onKinematics: (attemptId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [data, setData] = useState<Detail | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kin, setKin] = useState<(KinSummary & { block_attempt_id: string })[] | null>(null);
  const [kinError, setKinError] = useState<string | null>(null);
  const [marks, setMarks] = useState<{ id: string; label: string; marks: SheetMark[] } | null>(null);
  const [marksError, setMarksError] = useState<string | null>(null);
  const openMarks = (id: string, label: string) => {
    setMarksError(null);
    if (marks?.id === id) return setMarks(null);
    api<{ marks: SheetMark[] }>(`/research/attempts/${id}/marks`).then((r) => setMarks({ id, label, marks: r.marks })).catch((e: ApiError) => setMarksError(e.messageKey));
  };
  const when = useMemo(() => new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }), [lang]);

  useEffect(() => {
    api<Detail>(`/research/sessions/${sessionId}`).then(setData).catch((e: ApiError) => setError(e.messageKey));
    api<Options>('/research/options').then(setOptions).catch(() => undefined);
    api<{ attempts: (KinSummary & { block_attempt_id: string })[] }>(`/research/sessions/${sessionId}/kinematics`)
      .then((r) => setKin(r.attempts)).catch((e: ApiError) => setKinError(e.messageKey));
  }, [sessionId]);

  const back = <BackButton onClick={onBack} label={t('analyst.back_list')} />;
  if (!data) return <div style={{ display: 'grid', gap: '1rem' }}><div>{back}</div>{error ? <p role="alert" style={ui.error}>{t(error)}</p> : <p style={ui.muted}>{t('common.checking')}</p>}</div>;
  const { session: x, blocks } = data;
  const label = (kind: string, v: unknown) => valueLabel(t, lang, options, kind, v);
  const st = x.settings;
  const item = (title: string, value: React.ReactNode) => (
    <div><dt style={s.dt}>{title}</dt><dd style={s.dd}>{value}</dd></div>
  );

  return (
    <div style={{ display: 'grid', gap: '1rem' }} data-testid="research-session">
      <div>{back}</div>
      <h2 style={{ margin: 0, fontSize: '1.3rem' }}>
        <bdi dir="ltr">{x.session_code}</bdi> · <bdi dir="ltr">{x.study_code}</bdi> · {label('stage', x.session_type)}
      </h2>

      <section style={s.section} aria-labelledby="details-h">
        <h3 id="details-h" style={s.h}>{t('analyst.details')}</h3>
        <dl style={s.dl}>
          {item(t('analyst.language'), label('language', x.language_code))}
          {item(t('analyst.age'), ageLabel(t, x.age_months))}
          {item(t('analyst.grade'), label('grade', x.grade_level))}
          {item(t('analyst.gender'), label('gender', x.gender))}
          {item(t('analyst.ses'), label('ses', x.ses_group))}
          {item(t('analyst.hand'), label('hand', x.dominant_hand))}
          {item(t('analyst.domain'), label('domain', x.domain_id))}
          {item(t('analyst.region'), label('region', x.region_id))}
          {item(t('analyst.school'), <bdi dir="ltr">{x.school_key ?? '—'}</bdi>)}
          {item(t('analyst.device'), x.device_model ?? '—')}
          {item(t('analyst.started'), x.started_at ? when.format(new Date(x.started_at)) : '—')}
          {item(t('analyst.completed'), x.completed_at ? when.format(new Date(x.completed_at)) : '—')}
        </dl>
        <h3 style={{ ...s.h, fontSize: '1rem' }}>{t('analyst.settings')}</h3>
        <dl style={s.dl}>
          {item(t('analyst.inactivity'), st.inactivity_sec == null ? '—' : t('analyst.seconds_value', { n: st.inactivity_sec }))}
          {item(t('analyst.inactivity_last_box'), st.inactivity_last_box_sec == null ? '—' : t('analyst.seconds_value', { n: st.inactivity_last_box_sec }))}
          {item(t('analyst.pass_threshold'), st.pass_threshold ?? t('summary.not_configured'))}
        </dl>
        {st.weight_speed_pct != null && (
          <p style={{ ...ui.muted, margin: 0 }}>
            {t('analyst.weights', { speed: st.weight_speed_pct, accuracy: st.weight_accuracy_pct, lifts: st.weight_pen_lifts_pct })}
          </p>
        )}
      </section>

      <section style={s.section} aria-labelledby="blocks-h">
        <h3 id="blocks-h" style={s.h}>{t('analyst.block_list')}</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={ui.table} data-testid="research-blocks">
            <thead>
              <tr>
                <th style={ui.cell}>{t('analyst.step')}</th>
                <th style={ui.cell}>{t('analyst.canvas')}</th>
                <th style={{ ...ui.cell, ...s.num }}>{t('analyst.attempt')}</th>
                <th style={ui.cell}>{t('analyst.status')}</th>
                <th style={ui.cell}>{t('analyst.counts')}</th>
                {(['samples', 'time', 'pen_lifts', 'accuracy', 'avg_speed', 'speed_score', 'composite'] as const).map((k) => (
                  <th key={k} style={{ ...ui.cell, ...s.num }}>{t(`analyst.${k}`)}</th>
                ))}
                <th style={ui.cell}>{t('analyst.pass')}</th>
                <th style={ui.cell} />
              </tr>
            </thead>
            <tbody>
              {blocks.map((b) => (
                <tr key={b.block_attempt_id} style={b.counts ? undefined : { color: 'var(--ilt-muted)' }}>
                  <td style={ui.cell}>{t(b.label_key, { n: b.block_number ?? '' })}</td>
                  <td style={ui.cell}><bdi dir="ltr">{b.canvas_code ?? '—'}</bdi></td>
                  <td style={{ ...ui.cell, ...s.num }}>{b.attempt_number}</td>
                  <td style={ui.cell}>{t(`analyst.attempt_status.${b.status}`)}</td>
                  <td style={ui.cell}>{b.counts && <span style={pill('ok')}>{t('analyst.counted')}</span>}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{b.sample_count ?? '—'}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{b.total_time_ms == null ? '—' : (b.total_time_ms / 1000).toFixed(1)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{b.pen_lifts ?? '—'}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{num(b.accuracy_score)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{num(b.avg_speed_mm_s, 2)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{num(b.speed_score)}</td>
                  <td style={{ ...ui.cell, ...s.num }}>{num(b.composite_score)}</td>
                  <td style={ui.cell}>{b.pass == null ? '—' : t(b.pass ? 'summary.pass' : 'summary.fail')}</td>
                  <td style={{ ...ui.cell, textAlign: 'end', whiteSpace: 'nowrap' }}>
                    {(b.sample_count ?? 0) > 0 && b.canvas_code && (
                      <span style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        <button style={ui.button} onClick={() => onReplay(b.block_attempt_id)}>{t('analyst.replay')}</button>
                        <button style={ui.button} onClick={() => onKinematics(b.block_attempt_id)}>{t('analyst.kin.open')}</button>
                        {b.step_type === 'INTERVENTION_SHEET' && (
                          <button style={ui.button} aria-pressed={marks?.id === b.block_attempt_id} data-testid={`research-marks-${b.block_attempt_id}`}
                            onClick={() => openMarks(b.block_attempt_id, `${t(b.label_key, { n: b.block_number ?? '' })} · ${t('analyst.attempt')} ${b.attempt_number}`)}>
                            {t('marks.open')}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {marksError && <p role="alert" style={ui.error}>{t(marksError)}</p>}
      {marks && <MarksTable title={marks.label} marks={marks.marks} language={x.language_code} />}

      <section style={s.section} aria-labelledby="kin-h">
        <h3 id="kin-h" style={s.h}>{t('analyst.kin.session_title')}</h3>
        <p style={{ ...ui.muted, margin: 0 }}>{t('analyst.kin.session_note')}</p>
        {kinError && <p role="alert" style={ui.error}>{t(kinError)}</p>}
        {!kin && !kinError && <p style={ui.muted}>{t('common.checking')}</p>}
        {kin && (
          <div style={{ overflowX: 'auto' }}>
            <table style={ui.table} data-testid="session-kinematics">
              <thead>
                <tr>
                  <th style={ui.cell}>{t('analyst.step')}</th>
                  <th style={{ ...ui.cell, ...s.num }}>{t('analyst.attempt')}</th>
                  <th style={ui.cell}>{t('analyst.counts')}</th>
                  {KIN_COLUMNS.map((k) => <th key={k} style={{ ...ui.cell, ...s.num }}>{t(`analyst.kin.${k}`)}</th>)}
                  <th style={ui.cell} />
                </tr>
              </thead>
              <tbody>
                {kin.map((k) => {
                  const b = blocks.find((x) => x.block_attempt_id === k.block_attempt_id);
                  if (!b) return null;
                  return (
                    <tr key={k.block_attempt_id} style={b.counts ? undefined : { color: 'var(--ilt-muted)' }}>
                      <td style={ui.cell}>{t(b.label_key, { n: b.block_number ?? '' })}</td>
                      <td style={{ ...ui.cell, ...s.num }}>{b.attempt_number}</td>
                      <td style={ui.cell}>{b.counts && <span style={pill('ok')}>{t('analyst.counted')}</span>}</td>
                      <KinCells k={k} style={{ ...ui.cell, ...s.num }} />
                      <td style={{ ...ui.cell, textAlign: 'end' }}>
                        <button style={ui.button} onClick={() => onKinematics(k.block_attempt_id)}>{t('analyst.kin.open')}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** An intervention sheet's marks by row, laid out as on the sheet (in the session language's direction). */
function MarksTable({ title, marks, language }: { title: string; marks: SheetMark[]; language: string }) {
  const { t } = useTranslation();
  const mark = (v: boolean | null) => (v === null ? '—' : v ? '✗' : '✓');
  return (
    <section style={s.section} data-testid="research-marks" aria-label={title}>
      <h3 style={s.h}>{t('marks.open')} · {title}</h3>
      {(['TRACE_MODEL', 'START_DOT', 'FREEHAND'] as const).map((row) => (
        <div key={row} style={{ display: 'grid', gap: '0.3rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>{t(`marks.row.${row}`)}</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(5rem, 1fr))', gap: '0.4rem', direction: language === 'he' ? 'rtl' : 'ltr' }}>
            {marks.filter((m) => m.row_type === row).map((m) => (
              <div key={m.box_id} style={{ border: '1px solid var(--ilt-border)', borderRadius: 6, padding: '0.3rem', textAlign: 'center', fontSize: '0.85rem' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }} lang={language}>{m.letter}</div>
                <div><strong>{mark(m.final_error)}</strong> {m.decided_by ? t(m.decided_by === 'EVALUATOR' ? 'marks.by_evaluator' : 'marks.by_system') : t('marks.to_set')}</div>
                {m.auto_error !== null && m.decided_by === 'EVALUATOR' && <div style={ui.muted}>{t('analyst.marks_suggested', { mark: mark(m.auto_error) })}</div>}
                {m.internal_pen_lifts !== null && m.internal_pen_lifts > (m.lifts_allowed ?? 0) && <div style={ui.muted}>{t('marks.lifts', { n: m.internal_pen_lifts, allowed: m.lifts_allowed ?? 0 })}</div>}
                {m.start_point_ok !== null && <div style={ui.muted}>{t(m.start_point_ok ? 'marks.start_ok' : 'marks.start_off')}</div>}
                {m.similarity_hint !== null && <div style={ui.muted}>{t('marks.hint', { n: Math.round(m.similarity_hint) })}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
