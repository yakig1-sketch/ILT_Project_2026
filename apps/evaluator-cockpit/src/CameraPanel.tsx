// Hand video in the live cockpit (Phase 5f; FR-PRIV-2). The evaluator pairs a camera by pointing it at the
// tablet, which shows a one-time QR code: the camera that sees it serves this session (sessions side by
// side never share a camera). Then the live view, with pan/tilt buttons when the camera can turn, helps
// frame the tablet. Each writing step is recorded while a camera is paired and video is allowed.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlPayload } from '@ilt/shared-types';
import { useVideoRotation } from '@ilt/ui';
import { ApiError, api, getAuth } from './api';
import type { CockpitLink } from './cockpit-link';
import { pill, tone, ui } from './styles';

type Status = ControlPayload<'CAMERA_STATUS'>;
interface Info { video_enabled: boolean; available: boolean; state: Status | null }

const s = {
  card: { ...ui.card, display: 'grid', gap: '0.6rem' },
  row: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' },
  live: { position: 'relative', inlineSize: '100%', maxInlineSize: '48rem', aspectRatio: '16 / 9', background: '#000', borderRadius: 8, overflow: 'hidden' },
  video: { inlineSize: '100%', blockSize: '100%', objectFit: 'contain', display: 'block' },
  liveNote: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: '1rem' },
  pad: { display: 'grid', gridTemplateColumns: 'repeat(3, 3rem)', gridTemplateRows: 'repeat(3, 2.4rem)', gap: '0.25rem' },
} satisfies Record<string, CSSProperties>;

export function CameraPanel({ sessionId, link, closed, busy }: { sessionId: string; link: CockpitLink; closed: boolean; busy: boolean }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positioning, setPositioning] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    api<Info>(`/sessions/${sessionId}/camera`).then(setInfo).catch(() => setInfo({ video_enabled: false, available: false, state: null }));
  }, [sessionId]);

  const status: Status | null = link.camera ?? info?.state ?? null;
  // A camera just paired: open the live view so the evaluator can frame the tablet.
  const previous = useRef(status?.state);
  useEffect(() => {
    if (previous.current === 'SEARCHING' && status?.state === 'PAIRED') setPositioning(true);
    if (status?.state !== 'PAIRED') setPositioning(false);
    previous.current = status?.state;
  }, [status?.state]);

  if (!info || closed) return null;
  if (!info.video_enabled) {
    return <p style={{ ...ui.muted, margin: 0 }} data-testid="camera-off">{t('cockpit.camera.title')}: {t('cockpit.camera.off')}</p>;
  }
  if (!info.available) {
    return <p style={{ ...ui.muted, margin: 0 }} data-testid="camera-unavailable">{t('cockpit.camera.title')}: {t('cockpit.camera.unavailable')}</p>;
  }

  async function call(path: string, body?: unknown) {
    setWorking(true);
    setError(null);
    try {
      await api(`/sessions/${sessionId}/camera/${path}`, { method: 'POST', body: body ?? {} });
    } catch (e) {
      setError(e instanceof ApiError ? e.messageKey : 'error.500');
    } finally {
      setWorking(false);
    }
  }
  const done = () => {
    setPositioning(false);
    void call('positioned');
  };
  const cameraName = status?.camera ? (status.camera.label ?? status.camera.model) : '';

  return (
    <section style={s.card} data-testid="camera-panel" aria-labelledby="camera-title">
      <div style={s.row}>
        <h2 id="camera-title" style={{ margin: 0, fontSize: '1.05rem' }}>{t('cockpit.camera.title')}</h2>
        {status?.state === 'PAIRED' && <span style={pill('ok')} data-testid="camera-name">{t('cockpit.camera.paired', { name: cameraName })}</span>}
        {status?.recording
          ? <span style={{ ...pill('warn'), color: tone.warn }} data-testid="camera-recording">● {t('cockpit.camera.recording')}</span>
          : status?.state === 'PAIRED' && <span style={ui.muted}>{t('cockpit.camera.not_recording')}</span>}
      </div>
      {error && <p role="alert" style={{ ...ui.error, margin: 0 }}>{t(error)}</p>}

      {(!status || status.state === 'NONE') && (
        <>
          <p style={{ ...ui.muted, margin: 0 }}>{t('cockpit.camera.none')} {t('cockpit.camera.none_help')}</p>
          <div style={s.row}>
            <button style={ui.primary} disabled={working || busy || !link.tabletConnected} onClick={() => void call('pair')} data-testid="camera-pair">{t('cockpit.camera.pair')}</button>
          </div>
        </>
      )}

      {status?.state === 'SEARCHING' && (
        <>
          <p style={{ margin: 0 }} role="status" data-testid="camera-searching">
            {status.watching > 0 ? t('cockpit.camera.searching', { count: status.watching }) : t('cockpit.camera.searching_none')}
            {status.expires_at && <span style={ui.muted}> ({t('cockpit.camera.until', { time: new Date(status.expires_at).toLocaleTimeString() })})</span>}
          </p>
          <p style={{ ...ui.muted, margin: 0 }}>{t('cockpit.camera.pair_help')}</p>
          <div style={s.row}>
            <button style={ui.button} disabled={working} onClick={() => void call('release')} data-testid="camera-cancel">{t('cockpit.camera.cancel')}</button>
          </div>
        </>
      )}

      {status?.state === 'PAIRED' && !positioning && (
        <div style={s.row}>
          <button style={ui.button} disabled={working || busy} onClick={() => setPositioning(true)} data-testid="camera-position">{t('cockpit.camera.position')}</button>
          <button style={ui.button} disabled={working || status.recording}
            onClick={() => { if (confirm(t('cockpit.camera.release_confirm'))) void call('release'); }} data-testid="camera-release">
            {t('cockpit.camera.release')}
          </button>
        </div>
      )}

      {status?.state === 'PAIRED' && positioning && (
        <div style={{ display: 'grid', gap: '0.6rem' }} data-testid="camera-positioning">
          <p style={{ ...ui.muted, margin: 0 }}>{t('cockpit.camera.positioning_help')}</p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'start' }}>
            <LiveView sessionId={sessionId} />
            {status.camera?.ptz && (
              <div style={s.pad} role="group" aria-label={t('cockpit.camera.position')}>
                {([['UP', 2, 1, '▲'], ['LEFT', 1, 2, '◀'], ['RIGHT', 3, 2, '▶'], ['DOWN', 2, 3, '▼']] as const).map(([dir, col, row, glyph]) => (
                  <button key={dir} style={{ ...ui.button, gridColumn: col, gridRow: row, padding: 0 }} disabled={working}
                    aria-label={t(`cockpit.camera.${dir.toLowerCase()}`)} title={t(`cockpit.camera.${dir.toLowerCase()}`)}
                    onClick={() => void call('move', { direction: dir })} data-testid={`camera-move-${dir.toLowerCase()}`}>
                    {glyph}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={s.row}>
            <button style={ui.primary} onClick={done} data-testid="camera-done">{t('cockpit.camera.done')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The paired camera's live picture: Media Source Extensions fed by the gateway's /ws/camera, which
 * relays the camera relay's MSE stream (fragmented MP4) after checking the evaluator's token.
 */
function LiveView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'CONNECTING' | 'PLAYING' | 'FAILED'>('CONNECTING');
  const [rotated, toggleRotation] = useVideoRotation();

  useEffect(() => {
    const el = video.current;
    if (!el || typeof MediaSource === 'undefined') {
      setState('FAILED');
      return;
    }
    const ms = new MediaSource();
    el.src = URL.createObjectURL(ms);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/camera`);
    ws.binaryType = 'arraybuffer';
    let sb: SourceBuffer | null = null;
    const queue: ArrayBuffer[] = [];
    const pump = () => {
      if (!sb || sb.updating || queue.length === 0) return;
      try {
        sb.appendBuffer(queue.shift()!);
      } catch {
        // A full buffer: drop what is old and carry on.
        if (sb.buffered.length) sb.remove(0, Math.max(0, el.currentTime - 2));
      }
    };
    const codecs = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'avc1.42E01E', 'avc1.4D401F', 'hvc1.1.6.L153.B0'].filter((c) => MediaSource.isTypeSupported(`video/mp4; codecs="${c}"`));
    ms.addEventListener('sourceopen', () => {
      ws.onopen = () => {
        ws.send(JSON.stringify({ auth: getAuth()?.access_token ?? '', session_id: sessionId }));
        ws.send(JSON.stringify({ type: 'mse', value: codecs.join(',') }));
      };
      if (ws.readyState === WebSocket.OPEN) ws.onopen(new Event('open'));
    }, { once: true });
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const msg = JSON.parse(ev.data) as { type: string; value: string };
        if (msg.type === 'mse' && !sb && ms.readyState === 'open') {
          sb = ms.addSourceBuffer(msg.value);
          sb.mode = 'segments';
          sb.addEventListener('updateend', () => {
            // Stay at the live edge and keep the buffer short.
            const b = sb!.buffered;
            if (b.length) {
              const end = b.end(b.length - 1);
              if (end - el.currentTime > 1.5) el.currentTime = end - 0.3;
              if (!sb!.updating && el.currentTime - b.start(0) > 10) sb!.remove(b.start(0), el.currentTime - 5);
            }
            pump();
          });
        } else if (msg.type === 'error') setState('FAILED');
        return;
      }
      queue.push(ev.data as ArrayBuffer);
      pump();
    };
    // Failed only when the connection drops before any picture, or no picture comes within 10 s.
    setState('CONNECTING');
    ws.onclose = () => setState((st) => (st === 'PLAYING' ? st : 'FAILED'));
    const giveUp = setTimeout(() => setState((st) => (st === 'PLAYING' ? st : 'FAILED')), 10_000);
    const onPlaying = () => {
      clearTimeout(giveUp);
      setState('PLAYING');
    };
    el.addEventListener('playing', onPlaying);
    void el.play().catch(() => undefined);
    return () => {
      clearTimeout(giveUp);
      el.removeEventListener('playing', onPlaying);
      // A deliberate close (leaving the view) is not a failure.
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
      URL.revokeObjectURL(el.src);
      el.removeAttribute('src');
    };
  }, [sessionId]);

  return (
    <div style={{ display: 'grid', gap: '0.4rem', inlineSize: '100%', maxInlineSize: '48rem' }}>
      <div style={s.live} data-testid="camera-live">
        <video ref={video} style={{ ...s.video, ...(rotated ? { transform: 'rotate(180deg)' } : {}) }} muted autoPlay playsInline />
        {state !== 'PLAYING' && <div style={s.liveNote}>{t(state === 'FAILED' ? 'cockpit.camera.live_failed' : 'cockpit.camera.live_connecting')}</div>}
      </div>
      <div>
        <button style={ui.button} aria-pressed={rotated} onClick={toggleRotation} data-testid="camera-rotate">↻ {t('cockpit.camera.rotate')}</button>
      </div>
    </div>
  );
}
