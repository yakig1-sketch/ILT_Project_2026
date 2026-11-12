// Reference mode in the Administrator cockpit (FR-CAN-6/9/10/11, FR-TAB-8): pair a tablet to a
// reference station, show a canvas on it at true size, record the sample block (fill order, pen
// lifts) and the normal speed (one row by a skilled writer), then [Accept] into the canvas's Draft
// profile or a Domain's profile, or [Clear]. The station lives for the whole admin visit, so the
// tablet stays paired while the administrator moves between canvases.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { controlMessage, type ControlEnvelope, type ControlEventName, type ControlPayload } from '@ilt/shared-types';
import type { ScoringProfile } from '@ilt/template-schemas';
import { GatewayLink } from '@ilt/ui';
import { ApiError, api, getAuth } from './api';
import { pill, tone, ui } from './styles';

type Kind = 'PREVIEW' | 'SAMPLE_BLOCK_FILL' | 'NORMAL_SPEED';
type RecordingKind = Exclude<Kind, 'PREVIEW'>;
type Result = ControlPayload<'REFERENCE_RESULT'> & { kind: RecordingKind; canvas_id: string };

export interface Recording {
  id: string;
  kind: RecordingKind;
  domain_id: number | null;
  domain_code: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'CLEARED';
  derived: Record<string, unknown>;
  writer_label: string | null;
  rows_recorded: number | null;
  sample_count: number;
  recorded_at: string;
  decided_at: string | null;
  recorded_by: string;
  decided_by: string | null;
  approved_by: string | null;
}

/** The administrator's reference station: its PIN, the gateway link and what the tablet is doing. */
class Station {
  id: string | null = null;
  pin: string | null = null;
  expiresAt: string | null = null;
  linkUp = false;
  tablet = false;
  /** The canvas on the tablet now (from the gateway's DISPATCH_STEP), until the tablet finishes it. */
  running: { kind: Kind; attempt: number; writing: boolean; finishing: boolean } | null = null;
  result: Result | null = null;
  error: string | null = null;
  private link: GatewayLink | null = null;
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }

  async open(language: string) {
    const r = await api<{ id: string; pin: string; expires_at: string }>('/reference/stations', { method: 'POST', body: { language_code: language } });
    Object.assign(this, { id: r.id, pin: r.pin, expiresAt: r.expires_at, tablet: false, running: null, result: null, error: null });
    this.connect();
    this.emit();
  }

  async newPin() {
    if (!this.id) return;
    const r = await api<{ pin: string; expires_at: string }>(`/reference/stations/${this.id}/pin`, { method: 'POST' });
    Object.assign(this, { pin: r.pin, expiresAt: r.expires_at });
    this.emit();
  }

  async close() {
    const id = this.id;
    this.link?.close();
    this.link = null;
    Object.assign(this, { id: null, pin: null, expiresAt: null, linkUp: false, tablet: false, running: null, result: null, error: null });
    this.emit();
    if (id) await api(`/reference/stations/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }

  private connect() {
    const id = this.id!;
    this.link?.close();
    this.link = new GatewayLink('/ws/cockpit', () => ({ auth: getAuth()?.access_token ?? '', reference_id: id }), {
      onControl: (env, payload) => this.onControl(env, payload),
      onStatus: (up) => {
        this.linkUp = up;
        this.emit();
      },
      onAuthRejected: () => void this.close(),
    });
  }

  send<E extends ControlEventName>(event: E, payload: ControlPayload<E>) {
    this.error = null;
    this.link?.send(controlMessage(event, payload));
    this.emit();
  }

  private onControl(env: ControlEnvelope, payload: unknown) {
    switch (env.event) {
      case 'PEER_STATUS': {
        this.tablet = (payload as ControlPayload<'PEER_STATUS'>).tablet;
        if (this.tablet) this.pin = null;
        break;
      }
      case 'DISPATCH_STEP': {
        const p = payload as ControlPayload<'DISPATCH_STEP'>;
        if (p.reference) this.running = { kind: p.reference.kind, attempt: p.attempt_number, writing: false, finishing: false };
        this.result = null;
        break;
      }
      case 'STEP_STARTED':
        if (this.running) this.running.writing = true;
        break;
      case 'BLOCK_COMPLETE':
        // A preview ends here; a recording waits for its result.
        if (this.running?.kind === 'PREVIEW') this.running = null;
        else if (this.running) this.running.finishing = true;
        break;
      case 'REFERENCE_RESULT':
        this.running = null;
        this.result = payload as Result;
        break;
      case 'BLOCK_INTERRUPTED':
        this.running = null;
        this.error = 'admin.reference.interrupted';
        break;
      case 'ERROR': {
        const code = (payload as ControlPayload<'ERROR'>).code;
        if (code === 'EMPTY_RECORDING') this.running = null;
        this.error = `admin.reference.error.${code}`;
        break;
      }
      default:
        return;
    }
    this.emit();
  }
}

const station = new Station();

const s = {
  pin: { fontSize: '2rem', fontWeight: 700, letterSpacing: '0.4rem', fontFamily: 'ui-monospace, Consolas, monospace' },
  result: { ...ui.card, background: 'var(--ilt-surface-2)', display: 'grid', gap: '0.4rem' },
  warn: { margin: 0, color: tone.warn },
  table: { ...ui.table, fontSize: '0.85rem' },
} satisfies Record<string, CSSProperties>;

const errorKey = (err: unknown) => (err instanceof ApiError ? err.messageKey : 'error.500');

export function ReferencePanel({ canvas, recordings, domains, approvalOn, onChanged }: {
  canvas: { id: string; code: string; version: number; status: string; canvas_type: string; language_code: string; default_scoring_profile: ScoringProfile | null };
  recordings: Recording[];
  domains: { id: number; code: string }[];
  approvalOn: boolean;
  onChanged: (notice: string) => void;
}) {
  const { t, i18n } = useTranslation();
  useSyncExternalStore(station.subscribe, () => station.version);
  const scoredCanvas = canvas.canvas_type !== 'NOTEBOOK' && !!canvas.default_scoring_profile;
  const draft = canvas.status === 'DRAFT';
  // Recording target: the canvas's own profile (Draft only) or a Domain's profile.
  const [target, setTarget] = useState<string>(draft ? 'CANVAS' : '');
  const [rows, setRows] = useState(1);
  const [writer, setWriter] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTarget(draft ? 'CANVAS' : ''), [canvas.id, draft]);

  const domainId = target === 'CANVAS' || target === '' ? null : Number(target);
  const canRecord = scoredCanvas && target !== '' && station.tablet && !station.running;
  const start = (kind: Kind) => station.send('REFERENCE_START', {
    canvas_id: canvas.id, kind,
    ...(kind !== 'PREVIEW' && { domain_id: domainId }),
    ...(kind === 'NORMAL_SPEED' && { rows, ...(writer.trim() && { writer_label: writer.trim() }) }),
  });
  const result = station.result?.canvas_id === canvas.id ? station.result : null;
  const pending = recordings.filter((r) => r.status === 'PENDING' && r.id !== result?.recording_id);

  async function decide(id: string, action: 'accept' | 'clear', approval: { director_email?: string; director_pin?: string } = {}) {
    setError(null);
    try {
      await api(`/reference-recordings/${id}/${action}`, { method: 'POST', body: action === 'accept' ? approval : {} });
      if (station.result?.recording_id === id) station.result = null;
      onChanged(t(action === 'accept' ? 'admin.reference.accepted' : 'admin.reference.cleared'));
    } catch (err) {
      setError(errorKey(err));
    }
  }

  return (
    <section style={{ ...ui.card, display: 'grid', gap: '0.6rem' }} data-testid="canvas-reference">
      <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('admin.reference.title')}</h3>
      <p style={{ ...ui.muted, margin: 0 }}>{t('admin.reference.intro')}</p>

      {/* ---- Station and pairing ---- */}
      {!station.id ? (
        <div style={ui.row}>
          <button style={ui.primary} data-testid="reference-pair"
            onClick={() => station.open(canvas.language_code || i18n.language).catch((e) => setError(errorKey(e)))}>{t('admin.reference.pair')}</button>
        </div>
      ) : (
        <div style={{ ...ui.row, alignItems: 'center' }} data-testid="reference-station">
          <span style={pill(station.tablet ? 'ok' : 'warn')}>{t(station.tablet ? 'admin.reference.tablet_on' : 'admin.reference.tablet_off')}</span>
          {!station.tablet && station.pin && (
            <span>
              {t('admin.reference.type_pin')} <bdi style={s.pin} data-testid="reference-pin">{station.pin}</bdi>
            </span>
          )}
          {!station.tablet && !station.pin && <button style={ui.button} onClick={() => void station.newPin()}>{t('admin.reference.new_pin')}</button>}
          {!station.linkUp && <span style={ui.muted}>{t('admin.reference.connecting')}</span>}
          <span style={{ flex: 1 }} />
          <button style={ui.button} onClick={() => void station.close()} data-testid="reference-close">{t('admin.reference.close')}</button>
        </div>
      )}

      {/* ---- What to show or record ---- */}
      {station.id && (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <div style={ui.row}>
            <button style={ui.button} disabled={!station.tablet || !!station.running || canvas.status === 'RETIRED'} onClick={() => start('PREVIEW')} data-testid="reference-preview">
              {t('admin.reference.preview')}
            </button>
          </div>
          {scoredCanvas && canvas.status !== 'RETIRED' && (
            <div style={{ ...ui.row, alignItems: 'end' }}>
              <label style={ui.field}>
                {t('admin.reference.target')}
                <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="reference-target">
                  {!draft && <option value="">{t('admin.reference.choose_domain')}</option>}
                  {draft && <option value="CANVAS">{t('admin.reference.target_canvas', { code: canvas.code, version: canvas.version })}</option>}
                  {domains.map((d) => <option key={d.id} value={d.id}>{t('admin.reference.target_domain', { domain: d.code })}</option>)}
                </select>
              </label>
              <button style={ui.button} disabled={!canRecord} onClick={() => start('SAMPLE_BLOCK_FILL')} data-testid="reference-sample">{t('admin.reference.record_sample')}</button>
            </div>
          )}
          {/* Rows and writer belong to the normal-speed recording only; a sample block is always the whole canvas. */}
          {scoredCanvas && canvas.status !== 'RETIRED' && (
            <div style={{ ...ui.row, alignItems: 'end' }}>
              <label style={ui.field}>
                {t('admin.reference.rows')}
                <input type="number" min={1} max={3} value={rows} style={{ inlineSize: '4rem' }} onChange={(e) => setRows(Math.min(3, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
              <label style={ui.field}>
                {t('admin.reference.writer')}
                <input value={writer} maxLength={100} placeholder={t('admin.reference.writer_hint')} onChange={(e) => setWriter(e.target.value)} />
              </label>
              <button style={ui.button} disabled={!canRecord} onClick={() => start('NORMAL_SPEED')} data-testid="reference-speed">{t('admin.reference.record_speed')}</button>
            </div>
          )}
          {scoredCanvas && !draft && canvas.status !== 'RETIRED' && <p style={{ ...ui.muted, margin: 0 }}>{t('admin.reference.active_note')}</p>}
          {station.running && (
            <div style={{ ...ui.row, alignItems: 'center' }} role="status" data-testid="reference-running">
              <span style={pill('warn')}>{t(`admin.reference.kind.${station.running.kind}`)}</span>
              <span>{t(station.running.finishing ? 'admin.reference.saving' : station.running.writing ? 'admin.reference.writing' : 'admin.reference.sent')}</span>
              {!station.running.finishing && (
                <button style={ui.button} onClick={() => station.send('MANUAL_FINISH', { reason: 'Finished by the administrator' })}>{t('admin.reference.finish')}</button>
              )}
            </div>
          )}
        </div>
      )}
      {station.error && <p role="alert" style={ui.error}>{t(station.error)}</p>}
      {error && <p role="alert" style={ui.error}>{t(error)}</p>}

      {/* ---- The new recording, then any earlier one still waiting ---- */}
      {result && (
        <Decision
          rec={{ id: result.recording_id, kind: result.kind, derived: result.derived as Record<string, unknown>, domain_id: domainId, domain_code: domains.find((d) => d.id === domainId)?.code ?? null }}
          needsPin={approvalOn && domainId !== null}
          onDecide={decide}
        />
      )}
      {pending.map((r) => (
        <Decision key={r.id} rec={r} needsPin={approvalOn && r.domain_id !== null} onDecide={decide} />
      ))}

      {/* ---- History (FR-CAN-11: who recorded and when; never shown as participant data) ---- */}
      {recordings.length > 0 && (
        <details>
          <summary>{t('admin.reference.history', { count: recordings.length })}</summary>
          <table style={s.table} data-testid="reference-history">
            <thead>
              <tr>
                {['when', 'kind', 'for', 'values', 'status', 'by'].map((k) => <th key={k} style={ui.cell}>{t(`admin.reference.col.${k}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id}>
                  <td style={ui.cell}>{new Date(r.recorded_at).toLocaleString(i18n.language)}</td>
                  <td style={ui.cell}>{t(`admin.reference.kind.${r.kind}`)}{r.writer_label ? ` · ${r.writer_label}` : ''}</td>
                  <td style={ui.cell}>{r.domain_code ? t('admin.reference.target_domain', { domain: r.domain_code }) : t('admin.reference.canvas_profile')}</td>
                  <td style={ui.cell}><Values kind={r.kind} derived={r.derived} /></td>
                  <td style={ui.cell}><span style={pill(r.status === 'ACCEPTED' ? 'ok' : r.status === 'PENDING' ? 'warn' : 'off')}>{t(`admin.reference.status.${r.status}`)}</span></td>
                  <td style={ui.cell}>
                    {r.recorded_by}
                    {r.decided_by && <> · {r.decided_by}</>}
                    {r.approved_by && <> · {t('admin.reference.approved_by', { name: r.approved_by })}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

/** The derived values in one line. */
function Values({ kind, derived }: { kind: RecordingKind; derived: Record<string, unknown> }) {
  const { t } = useTranslation();
  if (kind === 'SAMPLE_BLOCK_FILL') {
    return <span>{t('admin.reference.values_sample', { lifts: derived.pen_lifts, written: derived.boxes_written, total: derived.boxes_total })}</span>;
  }
  return derived.normal_speed_mm_s == null
    ? <span>{t('admin.reference.no_speed')}</span>
    : <bdi>{t('admin.reference.values_speed', { speed: Number(derived.normal_speed_mm_s).toFixed(2) })}</bdi>;
}

/** A recording waiting for [Accept] or [Clear], with what it would change and its warnings. */
function Decision({ rec, needsPin, onDecide }: {
  rec: Pick<Recording, 'id' | 'kind' | 'derived' | 'domain_id' | 'domain_code'>;
  needsPin: boolean;
  onDecide: (id: string, action: 'accept' | 'clear', approval?: { director_email?: string; director_pin?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const d = rec.derived;
  const previous = (d.previous ?? {}) as Record<string, unknown>;
  const complete = d.complete === true;
  return (
    <div style={s.result} data-testid="reference-result">
      <strong>
        {t(`admin.reference.kind.${rec.kind}`)} · {rec.domain_code ? t('admin.reference.target_domain', { domain: rec.domain_code }) : t('admin.reference.canvas_profile')}
      </strong>
      {rec.kind === 'SAMPLE_BLOCK_FILL' ? (
        <>
          <span>{t('admin.reference.fill_order')} <bdi dir="ltr" style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{(d.fill_order as number[]).join(', ')}</bdi></span>
          <span>{t('admin.reference.values_sample', { lifts: d.pen_lifts, written: d.boxes_written, total: d.boxes_total })}</span>
          <span style={ui.muted}>{t('admin.reference.was_lifts', { lifts: previous.expected_pen_lifts_per_block ?? '—' })}</span>
          {!complete && <p style={s.warn}>{t('admin.reference.incomplete_sample')}</p>}
          {complete && d.direction_matches === false && (
            <p style={s.warn} data-testid="reference-direction-warning">
              {t('admin.reference.direction_differs')} <bdi dir="ltr">{(d.direction_order as number[]).join(', ')}</bdi>
            </p>
          )}
        </>
      ) : (
        <>
          <span style={{ fontSize: '1.2rem', fontWeight: 600 }}><Values kind={rec.kind} derived={d} /></span>
          <span style={ui.muted}>
            {t('admin.reference.speed_detail', { written: d.letters_written, total: d.letters_expected, length: d.sum_line_length_mm, time: d.sum_line_time_ms })}
          </span>
          <span style={ui.muted}>{t('admin.reference.was_speed', { speed: previous.normal_speed_mm_s ?? t('summary.not_configured') })}</span>
          {!complete && <p style={s.warn}>{t('admin.reference.incomplete_speed')}</p>}
        </>
      )}
      {d.integrity_ok === false && <p style={{ margin: 0, color: tone.bad }}>{t('admin.reference.integrity_failed')}</p>}
      {needsPin && complete && (
        <div style={ui.row}>
          <label style={ui.field}>{t('summary.director_email')}<input type="email" dir="ltr" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label style={ui.field}>{t('summary.director_pin')}<input type="password" inputMode="numeric" maxLength={8} dir="ltr" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        </div>
      )}
      <div style={ui.row}>
        <button style={ui.primary} disabled={!complete || (needsPin && (!email.trim() || !pin))} data-testid="reference-accept"
          onClick={() => void onDecide(rec.id, 'accept', needsPin ? { director_email: email.trim(), director_pin: pin } : {})}>{t('admin.reference.accept')}</button>
        <button style={ui.button} data-testid="reference-clear" onClick={() => void onDecide(rec.id, 'clear')}>{t('admin.reference.clear')}</button>
      </div>
    </div>
  );
}
