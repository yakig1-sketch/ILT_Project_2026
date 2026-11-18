// Child tablet kiosk (FR-TAB-1…7): pair with the evaluator's 6-digit PIN, then follow the cockpit.
// The canvas is drawn at true physical size from the tablet calibration and never flips with RTL.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DTH_A116 } from '@ilt/shared-types';
import { AppShell, CanvasView } from '@ilt/ui';
import qrcode from 'qrcode-generator';
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

/**
 * Beta stack only (VITE_ALLOW_TOUCH=1, Phase 6b′): testers with a touch-screen tablet choose "Touch screen"
 * on the code screen; a finger or passive stylus then writes and taps [Next block]. Every other build is pen only.
 */
const touchBuild = import.meta.env.VITE_ALLOW_TOUCH === '1';
const INPUT_KEY = 'ilt.kiosk.input_kind';
type InputKind = 'PEN' | 'TOUCH';
function loadInputKind(): InputKind {
  if (!touchBuild) return 'PEN';
  try {
    return localStorage.getItem(INPUT_KEY) === 'TOUCH' ? 'TOUCH' : 'PEN';
  } catch {
    return 'PEN';
  }
}
const inputKind = loadInputKind();
const allowTouch = inputKind === 'TOUCH';
/** A bank card (ISO/IEC 7810 ID-1), the ruler for the touch-tablet calibration. */
const CARD_MM = { w: 85.6, h: 53.98 };

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
  referenceBar: { background: '#fff3cd', borderBlockEnd: '2px solid #bf8700', color: '#5c3d00' },
  fullscreen: { position: 'fixed', insetBlockEnd: '0.75rem', insetInlineStart: '0.75rem', zIndex: 2, fontSize: '1.1rem', fontWeight: 600, paddingBlock: '0.6rem', paddingInline: '1.1rem', borderRadius: '0.6rem', border: '2px solid #0969da', background: '#fff', color: '#0969da' },
  banner: { position: 'fixed', insetBlockStart: 0, insetInline: 0, background: '#ffebe9', color: '#cf222e', padding: '0.4rem', textAlign: 'center', fontSize: '1rem', zIndex: 2 },
  overlay: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.85)', fontSize: '2rem', zIndex: 1 },
  rotate: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#fff', fontSize: '2rem', fontWeight: 600, textAlign: 'center', padding: '2rem', zIndex: 2, touchAction: 'none' },
  countdown: { fontSize: '1.6rem', fontWeight: 600 },
  video: { position: 'fixed', inset: 0, background: '#000', display: 'grid', placeItems: 'center', zIndex: 3 },
  videoTap: { fontSize: '1.6rem', fontWeight: 600, paddingBlock: '1rem', paddingInline: '2.5rem', borderRadius: '0.8rem', border: 'none', background: '#0969da', color: '#fff' },
};

// Inactivity cue (FR-TAB-5): a soft, slow amber glow around the page; no motion under reduced motion.
const CUE_CSS = '@keyframes ilt-cue { 50% { box-shadow: 0 0 0 10px rgba(255, 193, 7, 0.55); } } .ilt-cue { box-shadow: 0 0 0 6px rgba(255, 193, 7, 0.35); animation: ilt-cue 2.4s ease-in-out infinite; } @media (prefers-reduced-motion: reduce) { .ilt-cue { animation: none; } }';

/** Hides the browser bars. Needs a user gesture, so it is called from taps (never from a stroke on the canvas). */
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
}

/**
 * The browser leaves full screen when the tablet sleeps or the page reloads, and only a tap can bring
 * it back. While it is out, a button outside the canvas says so (a stroke on the canvas never counts).
 */
function FullscreenButton({ label }: { label: string }) {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const update = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  if (full || !document.documentElement.requestFullscreen) return null;
  return (
    <button type="button" style={s.fullscreen} onClick={enterFullscreen} data-testid="kiosk-fullscreen">⛶ {label}</button>
  );
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
    }, allowTouch);
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
          input_kind: inputKind,
        }),
      });
      const body = (await res.json()) as { status?: string; token?: string; session_id?: string; session_code?: string; language?: string; mode?: 'SESSION' | 'REFERENCE'; error?: { message_key: string } };
      if (!res.ok || body.status !== 'ACCEPTED') {
        setError(body.error?.message_key ?? 'kiosk.pin_wrong');
        setPin('');
        return;
      }
      onPaired({ token: body.token!, session_id: body.session_id!, session_code: body.session_code!, language: body.language!, mode: body.mode ?? 'SESSION' });
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
        <p style={{ color: '#57606a', fontSize: '0.85rem' }} data-testid="kiosk-calibration">{t('kiosk.calibration', { pxPerMm })}</p>
        {touchBuild && <InputChoice />}
      </form>
    </AppShell>
  );
}

function SessionScreen({ session, ended }: { session: KioskSession; ended: boolean }) {
  const { t } = useTranslation();
  const snapshot = useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => {
      const st = session.state;
      const video = st.name === 'VIDEO' ? `${st.step_index}:${!!st.src}:${st.blocked}` : '';
      const camera = session.camera ? `${session.camera.screen}:${'code' in session.camera ? session.camera.code : ''}` : '';
      return `${st.name}:${'secondsLeft' in st ? st.secondsLeft : ''}:${session.gatewayConnected}:${session.endReached}:${session.inactivity}:${video}:${camera}`;
    },
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

  const banner = (
    <>
      {!session.gatewayConnected && <div style={s.banner} role="status">{t('kiosk.connection_lost')}</div>}
      <FullscreenButton label={t('kiosk.full_screen')} />
    </>
  );

  if (ended || state.name === 'DONE') {
    return <div style={s.screen}>{t('kiosk.session_done')}</div>;
  }
  if (state.name === 'VIDEO') {
    return (
      <div style={s.video}>
        {banner}
        {state.src ? (
          <VideoPlayer session={session} src={state.src} blocked={state.blocked} label={t('kiosk.tap_to_play')} />
        ) : (
          <p style={{ color: '#fff', fontSize: '1.6rem' }}>{t(state.blocked ? 'kiosk.video_failed' : 'kiosk.video_loading')}</p>
        )}
      </div>
    );
  }
  const reference = session.pairing.mode === 'REFERENCE';
  // Camera pairing and positioning (Phase 5f): only between steps.
  if (state.name === 'WAITING' && session.camera) {
    return session.camera.screen === 'CODE'
      ? <CameraCode code={session.camera.code} label={t('kiosk.camera.code')} help={t('kiosk.camera.code_help')}>{banner}</CameraCode>
      : <CameraFrame label={t('kiosk.camera.frame')}>{banner}</CameraFrame>;
  }
  if (state.name === 'WAITING') {
    return (
      <BlockFrame step={null} reference={reference}>
        {banner}
        <p style={{ fontSize: '1.6rem' }}>{t(reference ? 'kiosk.reference.waiting' : 'kiosk.waiting')}</p>
      </BlockFrame>
    );
  }
  if (state.name === 'TRANSITION') {
    return (
      <BlockFrame step={state.step} reference={reference} footer={<div style={s.countdown} aria-live="polite">{t('kiosk.get_ready')} {state.secondsLeft}</div>}>
        {banner}
        <CanvasView geometry={state.step.canvas} pxPerMm={pxPerMm} />
      </BlockFrame>
    );
  }
  const kind = state.step.reference?.kind;
  return (
    <BlockFrame
      step={state.step}
      reference={reference}
      footer={
        kind ? (
          <>
            <p style={s.note}>{t(`kiosk.reference.note.${kind}`, { count: state.step.reference?.rows ?? 1 })}</p>
            <PenButton label={t('kiosk.reference.done')} disabled={state.name !== 'WRITING'} onTap={() => session.nextBlock()} />
          </>
        ) : (
          <>
            <p style={s.note}>{t('kiosk.pen_down_note')}</p>
            <PenButton label={t('kiosk.next_block')} disabled={state.name !== 'WRITING' || !session.endReached} onTap={() => session.nextBlock()} />
          </>
        )
      }
    >
      {banner}
      <style>{CUE_CSS}</style>
      <WritingCanvas session={session} cue={session.inactivity !== 'NONE'} />
      {state.name === 'PAUSED' && <div style={s.overlay}>{t('kiosk.paused')}</div>}
      {state.name === 'UPLOADING' && <div style={s.overlay}>{t('kiosk.uploading')}</div>}
    </BlockFrame>
  );
}

/** The one-time pairing code as a large QR code, black on white with its quiet zone (Phase 5f). */
function CameraCode({ code, label, help, children }: { code: string; label: string; help: string; children: ReactNode }) {
  const qr = qrcode(0, 'M');
  qr.addData(`ILT-CAM:${code}`);
  qr.make();
  const n = qr.getModuleCount();
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
  return (
    <div style={{ ...s.screen, background: '#fff', color: '#000', gap: '1rem', alignContent: 'center' }} data-testid="camera-code">
      {children}
      <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{label}</div>
      <svg viewBox={`0 0 ${n + 8} ${n + 8}`} style={{ inlineSize: 'min(72vh, 72vw)', blockSize: 'min(72vh, 72vw)' }} shapeRendering="crispEdges" role="img" aria-label={label}>
        <rect width={n + 8} height={n + 8} fill="#fff" />
        <path d={path} fill="#000" />
      </svg>
      <div style={{ fontSize: '1.1rem' }}>{help}</div>
    </div>
  );
}

/** The framing guide: the screen's edges and corners, so the evaluator sees the whole writing area in the camera. */
function CameraFrame({ label, children }: { label: string; children: ReactNode }) {
  const corner = (pos: CSSProperties): CSSProperties => ({ position: 'absolute', inlineSize: '12vmin', blockSize: '12vmin', borderColor: '#000', borderStyle: 'solid', borderWidth: 0, ...pos });
  return (
    <div style={{ ...s.screen, position: 'relative', background: '#fff', boxShadow: 'inset 0 0 0 1.2vmin #0a6cff' }} data-testid="camera-frame">
      {children}
      <div style={corner({ insetBlockStart: '3vmin', insetInlineStart: '3vmin', borderBlockStartWidth: '1.5vmin', borderInlineStartWidth: '1.5vmin' })} />
      <div style={corner({ insetBlockStart: '3vmin', insetInlineEnd: '3vmin', borderBlockStartWidth: '1.5vmin', borderInlineEndWidth: '1.5vmin' })} />
      <div style={corner({ insetBlockEnd: '3vmin', insetInlineStart: '3vmin', borderBlockEndWidth: '1.5vmin', borderInlineStartWidth: '1.5vmin' })} />
      <div style={corner({ insetBlockEnd: '3vmin', insetInlineEnd: '3vmin', borderBlockEndWidth: '1.5vmin', borderInlineEndWidth: '1.5vmin' })} />
      <div style={{ fontSize: '1.6rem', maxInlineSize: '70vw' }}>{label}</div>
    </div>
  );
}

function blockLabel(t: (key: string, o: Record<string, unknown>) => string, step: Dispatch): string | null {
  if (!step.block_number || !step.block_count) return null;
  const key = step.step_type === 'WARMUP_BLOCK' ? 'kiosk.warmup_of' : step.step_type === 'NOTEBOOK_PAGE' ? 'kiosk.page_of'
    : step.step_type === 'INTERVENTION_SHEET' ? 'kiosk.sheet_of' : 'kiosk.block_of';
  return t(key, { n: step.block_number, total: step.block_count });
}

/**
 * Full-screen layout: task title and block position, the canvas centred, then the footer. In
 * reference mode (FR-TAB-8) the title bar is an amber "reference recording" banner instead.
 */
/** How the screen is held now, from its shape (it follows the display's rotation in Windows). */
function useOrientation(): 'PORTRAIT' | 'LANDSCAPE' {
  const query = '(orientation: portrait)';
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const update = () => setPortrait(m.matches);
    m.addEventListener('change', update);
    return () => m.removeEventListener('change', update);
  }, []);
  return portrait ? 'PORTRAIT' : 'LANDSCAPE';
}

function BlockFrame({ step, footer, reference = false, children }: { step: Dispatch | null; footer?: ReactNode; reference?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const label = step && !reference && blockLabel(t, step);
  const kind = step?.reference?.kind;
  // Phase 6b″: a page made for the other orientation is not drawn until the tablet is turned (it would not fit,
  // and part of it could take ink); the notice stands in its place. The Japanese pages are upright, every other
  // page lies on its side.
  const held = useOrientation();
  const needed = step?.canvas.orientation ?? 'LANDSCAPE';
  return (
    <div style={s.frame}>
      <header style={reference ? { ...s.header, ...s.referenceBar } : s.header} data-testid={reference ? 'reference-banner' : undefined}>
        <h1 style={s.title}>{t(reference ? 'kiosk.reference.banner' : 'kiosk.task_title')}</h1>
        {label && <span style={s.blockLabel}>{label}</span>}
        {reference && kind && <span style={s.blockLabel}>{t(`kiosk.reference.kind.${kind}`)}</span>}
      </header>
      <main style={s.main}>
        {step && held !== needed ? <div style={s.rotate} role="alert" data-testid="kiosk-rotate">{t(`kiosk.rotate.${needed}`)}</div> : children}
      </main>
      {footer && <footer style={s.footer}>{footer}</footer>}
    </div>
  );
}

/**
 * Beta touch build only (Phase 6b′): pen or touch for this tablet, and the screen-size calibration a touch
 * tablet needs once (the ILT page must show at true size). Both are kept in this browser; the page reloads.
 */
function InputChoice() {
  const { t } = useTranslation();
  const [calibrating, setCalibrating] = useState(false);
  const choose = (kind: InputKind) => {
    try {
      localStorage.setItem(INPUT_KEY, kind);
    } catch {
      // Private mode: nothing is kept, so the tablet stays on the pen.
    }
    location.reload();
  };
  const option = (kind: InputKind) => (
    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '1.1rem' }}>
      <input type="radio" name="input-kind" checked={inputKind === kind} onChange={() => choose(kind)} data-testid={`kiosk-input-${kind}`} />
      {t(`kiosk.input.${kind}`)}
    </label>
  );
  return (
    <fieldset style={{ display: 'grid', gap: '0.5rem', justifyItems: 'start', border: '1px solid #d0d7de', borderRadius: '0.5rem', padding: '0.75rem 1rem' }}>
      <legend style={{ fontSize: '1rem', color: '#57606a' }}>{t('kiosk.input.title')}</legend>
      {option('PEN')}
      {option('TOUCH')}
      {inputKind === 'TOUCH' && (
        <button type="button" onClick={() => setCalibrating(true)} style={{ fontSize: '1rem' }} data-testid="kiosk-calibrate">{t('kiosk.input.calibrate')}</button>
      )}
      {calibrating && <CardCalibration onClose={() => setCalibrating(false)} />}
    </fieldset>
  );
}

/** The tester matches a drawn box to a bank card held against the screen; that sets px per mm. */
function CardCalibration({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [px, setPx] = useState(pxPerMm);
  const step = (factor: number) => setPx((v) => Math.round(v * factor * 1000) / 1000);
  const save = () => {
    try {
      localStorage.setItem(CALIBRATION_KEY, String(px));
    } catch {
      // Not kept in private mode.
    }
    location.reload();
  };
  const big = { fontSize: '1.6rem', minInlineSize: '3.5rem', paddingBlock: '0.3rem' };
  return (
    <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 4, background: '#fff', display: 'grid', placeItems: 'center', alignContent: 'center', gap: '1rem', padding: '1rem' }}>
      <p style={{ margin: 0, fontSize: '1.1rem', maxInlineSize: '40rem' }}>{t('kiosk.input.calibrate_hint')}</p>
      <div style={{ inlineSize: `${CARD_MM.w * px}px`, blockSize: `${CARD_MM.h * px}px`, border: '3px solid #0969da', borderRadius: `${3 * px}px`, background: 'rgba(9, 105, 218, 0.08)' }} data-testid="kiosk-card" />
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button type="button" style={big} onClick={() => step(1 / 1.005)} aria-label={t('kiosk.input.smaller')} data-testid="kiosk-calibrate-smaller">−</button>
        <span dir="ltr" data-testid="kiosk-calibrate-value">{t('kiosk.calibration', { pxPerMm: px.toFixed(3) })}</span>
        <button type="button" style={big} onClick={() => step(1.005)} aria-label={t('kiosk.input.larger')} data-testid="kiosk-calibrate-larger">+</button>
      </div>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button type="button" style={{ fontSize: '1.2rem' }} onClick={save} data-testid="kiosk-calibrate-save">{t('kiosk.input.save')}</button>
        <button type="button" style={{ fontSize: '1.2rem' }} onClick={onClose}>{t('kiosk.input.cancel')}</button>
      </div>
    </div>
  );
}

/**
 * [Next block]: answers only a pen tap (and the mouse in development), never a finger or palm, and
 * only once the child has reached the last house. In the beta touch mode the first finger counts too.
 */
function PenButton({ label, disabled, onTap }: { label: string; disabled: boolean; onTap: () => void }) {
  const down = useRef<number | null>(null);
  const isPen = (e: ReactPointerEvent) => e.pointerType === 'pen' || (allowMouse && e.pointerType === 'mouse')
    || (allowTouch && e.pointerType === 'touch' && e.isPrimary);
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

/** Full-screen instruction video (FR-PLAN-6). If the browser refuses autoplay with sound, a tap starts it. */
function VideoPlayer({ session, src, blocked, label }: { session: KioskSession; src: string; blocked: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const play = () => {
    ref.current?.play().then(() => session.videoStarted(), () => session.videoBlocked());
  };
  useEffect(play, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <video ref={ref} src={src} playsInline onEnded={() => session.videoEnded()} style={{ inlineSize: '100vw', blockSize: '100dvh', objectFit: 'contain' }} />
      {blocked && (
        <button type="button" style={{ ...s.videoTap, position: 'absolute' }} onClick={() => { enterFullscreen(); play(); }}>{label}</button>
      )}
    </>
  );
}

function WritingCanvas({ session, cue }: { session: KioskSession; cue: boolean }) {
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
    <div className={cue ? 'ilt-cue' : undefined} data-testid="writing-page" data-cue={cue} style={{ lineHeight: 0 }}>
      <CanvasView geometry={step.canvas} pxPerMm={pxPerMm}>
        <canvas ref={ink} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div
          ref={surface}
          data-testid="capture-surface"
          style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
        />
      </CanvasView>
    </div>
  );
}
