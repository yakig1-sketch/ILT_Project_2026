// Child tablet kiosk (FR-TAB-1…7): pair with the evaluator's 6-digit PIN, then follow the cockpit.
// The canvas is drawn at true physical size from the tablet calibration and never flips with RTL.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DTH_A116 } from '@ilt/shared-types';
import { AppShell, CanvasView } from '@ilt/ui';
import { KioskSession, type Pairing } from './kiosk-session';

const PAIRING_KEY = 'ilt.kiosk.pairing';
const CALIBRATION_KEY = 'ilt.kiosk.px_per_mm';

/** px/mm from ?pxPerMm= (calibration page), then the stored calibration, then the DTH-A116 value. */
function calibration(): number {
  const fromUrl = Number(new URLSearchParams(location.search).get('pxPerMm'));
  if (fromUrl > 0) {
    try {
      localStorage.setItem(CALIBRATION_KEY, String(fromUrl));
    } catch {
      // Not remembered in private mode; the URL value still applies.
    }
    return fromUrl;
  }
  try {
    const stored = Number(localStorage.getItem(CALIBRATION_KEY));
    if (stored > 0) return stored;
  } catch {
    // Fall through to the device default.
  }
  return DTH_A116.CSS_PX_PER_MM;
}

function loadPairing(): Pairing | null {
  try {
    const raw = localStorage.getItem(PAIRING_KEY);
    return raw ? (JSON.parse(raw) as Pairing) : null;
  } catch {
    return null;
  }
}

function savePairing(p: Pairing | null) {
  try {
    if (p) localStorage.setItem(PAIRING_KEY, JSON.stringify(p));
    else localStorage.removeItem(PAIRING_KEY);
  } catch {
    // The pairing then lasts only for this page load.
  }
}

const pxPerMm = calibration();
const allowMouse = import.meta.env.DEV;

const s: Record<string, CSSProperties> = {
  screen: { minBlockSize: '100vh', display: 'grid', placeItems: 'center', background: '#f6f8fa', fontSize: '1.6rem', textAlign: 'center' },
  stage: { minBlockSize: '100vh', display: 'grid', placeItems: 'center', background: '#e9ecef', position: 'relative' },
  banner: { position: 'fixed', insetBlockStart: 0, insetInline: 0, background: '#ffebe9', color: '#cf222e', padding: '0.4rem', textAlign: 'center', fontSize: '1rem' },
  overlay: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.85)', fontSize: '2rem' },
  countdown: { fontSize: '4rem', fontWeight: 600, marginBlockEnd: '1rem' },
};

export function App() {
  const { i18n } = useTranslation();
  const [pairing, setPairing] = useState<Pairing | null>(loadPairing);
  const [session, setSession] = useState<KioskSession | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    // The child sees the session language (FR-TAB-7).
    void i18n.changeLanguage(pairing.language);
    const ks = new KioskSession(pairing, pxPerMm, allowMouse, (reason) => {
      savePairing(null);
      if (reason === 'AUTH') {
        setPairing(null);
        return;
      }
      setEnded(true);
      setTimeout(() => {
        setEnded(false);
        setPairing(null);
      }, 6000);
    });
    setSession(ks);
    return () => {
      ks.dispose();
      setSession(null);
    };
  }, [pairing, i18n]);

  if (!pairing || !session) {
    return (
      <PinScreen
        onPaired={(p) => {
          savePairing(p);
          setPairing(p);
        }}
      />
    );
  }
  return <SessionScreen session={session} ended={ended} />;
}

function PinScreen({ onPaired }: { onPaired: (p: Pairing) => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) {
      setError('kiosk.enter_pin');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/sessions/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pin,
          css_px_per_mm: pxPerMm,
          device_pixel_ratio: window.devicePixelRatio || 1,
          screen_w_mm: Math.round((screen.width / pxPerMm) * 10) / 10,
          screen_h_mm: Math.round((screen.height / pxPerMm) * 10) / 10,
        }),
      });
      const body = (await res.json()) as { status?: string; token?: string; session_id?: string; session_code?: string; language?: string; error?: { message_key: string } };
      if (!res.ok || body.status !== 'ACCEPTED') {
        setError(body.error?.message_key ?? 'kiosk.pin_wrong');
        setPin('');
        return;
      }
      onPaired({ token: body.token!, session_id: body.session_id!, session_code: body.session_code!, language: body.language! });
    } catch {
      setError('error.network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell titleKey="app.kiosk">
      <form onSubmit={submit} style={{ display: 'grid', gap: '1rem', justifyItems: 'center', marginBlockStart: '10vh' }}>
        <label htmlFor="pin" style={{ fontSize: '1.5rem' }}>{t('kiosk.enter_pin')}</label>
        <input
          id="pin"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          dir="ltr"
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          style={{ fontSize: '2.5rem', letterSpacing: '0.5rem', inlineSize: '12ch', textAlign: 'center' }}
          aria-invalid={error !== null}
        />
        {error && <p role="alert" style={{ color: '#cf222e', margin: 0 }}>{t(error)}</p>}
        <button type="submit" disabled={busy} style={{ fontSize: '1.4rem', paddingInline: '2rem', paddingBlock: '0.5rem' }}>
          {t('kiosk.connect')}
        </button>
        <p style={{ color: '#57606a', fontSize: '0.85rem' }}>{t('kiosk.calibration', { pxPerMm })}</p>
      </form>
    </AppShell>
  );
}

function SessionScreen({ session, ended }: { session: KioskSession; ended: boolean }) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => `${session.state.name}:${'secondsLeft' in session.state ? session.state.secondsLeft : ''}:${session.gatewayConnected}`,
  );
  void snapshot;
  const state = session.state;
  const banner = !session.gatewayConnected && <div style={s.banner} role="status">{t('kiosk.connection_lost')}</div>;

  if (ended || state.name === 'DONE') {
    return <div style={s.screen}>{t('kiosk.session_done')}</div>;
  }
  if (state.name === 'WAITING') {
    return (
      <div style={s.screen}>
        {banner}
        <p>{t('kiosk.waiting')}</p>
      </div>
    );
  }
  if (state.name === 'TRANSITION') {
    return (
      <div style={s.stage}>
        {banner}
        <div>
          <div style={s.countdown} aria-live="polite">{t('kiosk.get_ready')} {state.secondsLeft}</div>
          <CanvasView geometry={state.step.canvas} pxPerMm={pxPerMm} />
        </div>
      </div>
    );
  }
  return (
    <div style={s.stage}>
      {banner}
      <WritingCanvas session={session} />
      {state.name === 'PAUSED' && <div style={s.overlay}>{t('kiosk.paused')}</div>}
      {state.name === 'UPLOADING' && <div style={s.overlay}>{t('kiosk.uploading')}</div>}
    </div>
  );
}

function WritingCanvas({ session }: { session: KioskSession }) {
  const surface = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const state = session.state;
  const step = 'step' in state ? state.step : null;

  useEffect(() => {
    if (!surface.current || !ink.current || !step) return;
    return session.attachSurface(surface.current, ink.current);
    // Attach once per dispatched block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, step?.step_index, step?.attempt_number]);

  if (!step) return null;
  return (
    <CanvasView geometry={step.canvas} pxPerMm={pxPerMm}>
      <canvas ref={ink} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div
        ref={surface}
        data-testid="capture-surface"
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
      />
    </CanvasView>
  );
}
