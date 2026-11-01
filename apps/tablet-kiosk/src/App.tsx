// Child tablet kiosk (FR-TAB-1…7): pair with the evaluator's 6-digit PIN, then follow the cockpit.
// The canvas is drawn at true physical size from the tablet calibration and never flips with RTL.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DTH_A116 } from '@ilt/shared-types';
import { AppShell, CanvasView } from '@ilt/ui';
import { KioskSession, type Dispatch, type Pairing } from './kiosk-session';

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
  screen: { minBlockSize: '100dvh', display: 'grid', placeItems: 'center', background: '#f6f8fa', fontSize: '1.6rem', textAlign: 'center' },
  // Full-screen block frame: title bar, the true-size canvas, then the pen note and [Next block].
  frame: { blockSize: '100dvh', display: 'flex', flexDirection: 'column', background: '#e9ecef', position: 'relative', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', paddingBlock: '0.4rem', paddingInline: '1rem', background: '#fff', borderBlockEnd: '1px solid #d0d7de' },
  title: { margin: 0, fontSize: '1.25rem', fontWeight: 600 },
  blockLabel: { fontSize: '1.25rem', fontWeight: 600, color: '#0969da' },
  main: { flex: 1, minBlockSize: 0, display: 'grid', placeItems: 'center', position: 'relative' },
  footer: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', paddingBlock: '0.5rem', paddingInline: '1rem', background: '#fff', borderBlockStart: '1px solid #d0d7de', minBlockSize: '3.5rem' },
  note: { margin: 0, fontSize: '1.05rem', color: '#57606a' },
  nextButton: {
    flexShrink: 0, fontSize: '1.3rem', fontWeight: 600, paddingBlock: '0.6rem', paddingInline: '1.6rem', border: 'none', borderRadius: '0.6rem',
    background: '#0969da', color: '#fff', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', cursor: 'pointer',
  },
  nextButtonOff: { background: '#d0d7de', color: '#8c959f', cursor: 'default' },
  banner: { position: 'fixed', insetBlockStart: 0, insetInline: 0, background: '#ffebe9', color: '#cf222e', padding: '0.4rem', textAlign: 'center', fontSize: '1rem', zIndex: 2 },
  overlay: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.85)', fontSize: '2rem', zIndex: 1 },
  countdown: { fontSize: '1.6rem', fontWeight: 600 },
};

/** Hides the browser bars. Needs a user gesture, so it is called from taps (never from a stroke on the canvas). */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
}

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
    enterFullscreen();
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
    () => `${session.state.name}:${'secondsLeft' in session.state ? session.state.secondsLeft : ''}:${session.gatewayConnected}:${session.endReached}`,
  );
  void snapshot;
  const state = session.state;
  const writing = state.name === 'WRITING' || state.name === 'PAUSED';

  // Any tap returns to full screen if the browser left it (after a page reload, for example). During
  // writing only taps outside the canvas count ([Next block], the title bar), so no stroke is shifted.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (writing && e.target instanceof Element && e.target.closest('[data-testid="capture-surface"]')) return;
      enterFullscreen();
    };
    document.addEventListener('pointerup', onUp);
    return () => document.removeEventListener('pointerup', onUp);
  }, [writing]);

  const banner = !session.gatewayConnected && <div style={s.banner} role="status">{t('kiosk.connection_lost')}</div>;

  if (ended || state.name === 'DONE') {
    return <div style={s.screen}>{t('kiosk.session_done')}</div>;
  }
  if (state.name === 'WAITING') {
    return (
      <BlockFrame step={null}>
        {banner}
        <p style={{ fontSize: '1.6rem' }}>{t('kiosk.waiting')}</p>
      </BlockFrame>
    );
  }
  if (state.name === 'TRANSITION') {
    return (
      <BlockFrame step={state.step} footer={<div style={s.countdown} aria-live="polite">{t('kiosk.get_ready')} {state.secondsLeft}</div>}>
        {banner}
        <CanvasView geometry={state.step.canvas} pxPerMm={pxPerMm} />
      </BlockFrame>
    );
  }
  return (
    <BlockFrame
      step={state.step}
      footer={
        <>
          <p style={s.note}>{t('kiosk.pen_down_note')}</p>
          <PenButton label={t('kiosk.next_block')} disabled={state.name !== 'WRITING' || !session.endReached} onTap={() => session.nextBlock()} />
        </>
      }
    >
      {banner}
      <WritingCanvas session={session} />
      {state.name === 'PAUSED' && <div style={s.overlay}>{t('kiosk.paused')}</div>}
      {state.name === 'UPLOADING' && <div style={s.overlay}>{t('kiosk.uploading')}</div>}
    </BlockFrame>
  );
}

function blockLabel(t: (key: string, o: Record<string, unknown>) => string, step: Dispatch): string | null {
  if (!step.block_number || !step.block_count) return null;
  const key = step.step_type === 'WARMUP_BLOCK' ? 'kiosk.warmup_of' : step.step_type === 'NOTEBOOK_PAGE' ? 'kiosk.page_of' : 'kiosk.block_of';
  return t(key, { n: step.block_number, total: step.block_count });
}

/** Full-screen layout: task title and block position, the canvas centred, then the footer. */
function BlockFrame({ step, footer, children }: { step: Dispatch | null; footer?: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const label = step && blockLabel(t, step);
  return (
    <div style={s.frame}>
      <header style={s.header}>
        <h1 style={s.title}>{t('kiosk.task_title')}</h1>
        {label && <span style={s.blockLabel}>{label}</span>}
      </header>
      <main style={s.main}>{children}</main>
      {footer && <footer style={s.footer}>{footer}</footer>}
    </div>
  );
}

/**
 * [Next block]: answers only a pen tap (and the mouse in development), never a finger or palm, and
 * only once the child has reached the last house.
 */
function PenButton({ label, disabled, onTap }: { label: string; disabled: boolean; onTap: () => void }) {
  const down = useRef<number | null>(null);
  const isPen = (e: ReactPointerEvent) => e.pointerType === 'pen' || (allowMouse && e.pointerType === 'mouse');
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      style={{ ...s.nextButton, ...(disabled && s.nextButtonOff) }}
      onPointerDown={(e) => {
        down.current = !disabled && isPen(e) ? e.pointerId : null;
      }}
      onPointerUp={(e) => {
        if (down.current === null || down.current !== e.pointerId || !isPen(e)) return;
        down.current = null;
        onTap();
      }}
      onPointerCancel={() => (down.current = null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
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
