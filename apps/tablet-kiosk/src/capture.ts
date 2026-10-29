// Pen capture (DDD §2). One source feeds both the live mirror and persistence: pointerrawupdate
// (one event per hardware sample) where supported, otherwise pointermove + getCoalescedEvents().
// Touch is ignored while a block is active (palm rejection). Lifts come only from down/up events.
import { advanceFillPosition } from '@ilt/ilt-metrics';
import { NO_BOX, StrokeFlag, type PenSample } from '@ilt/shared-types';
import type { CanvasGeometry } from '@ilt/template-schemas';

export interface CaptureOptions {
  surface: HTMLElement;
  geometry: CanvasGeometry;
  fillOrder: readonly number[];
  pxPerMm: number;
  boxEntryMarginMm: number;
  /** Development only: accept the mouse as a pen. */
  allowMouse: boolean;
  /** Samples without sample_seq; the caller numbers them. */
  onSamples: (samples: Omit<PenSample, 'sample_seq'>[]) => void;
  onBoxAdvanced: (boxId: number, fillPosition: number, skippedBoxIds: number[]) => void;
}

const RAW_SUPPORTED = typeof window !== 'undefined' && 'onpointerrawupdate' in window;
const clampInt8 = (v: number) => Math.max(-128, Math.min(127, Math.round(v)));

export class PenCapture {
  private t0 = 0;
  private active = false;
  private rect: DOMRect;
  private fillPos = -1;
  private readonly written = new Set<number>();
  private inContact = false;
  private lastHover: Omit<PenSample, 'sample_seq'> | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly o: CaptureOptions) {
    this.rect = o.surface.getBoundingClientRect();
  }

  get activeBoxId(): number {
    return this.fillPos < 0 ? (this.o.fillOrder[0] ?? NO_BOX) : this.o.fillOrder[this.fillPos]!;
  }

  /** Starts capturing; t0 is the block start on the performance clock (event.timeStamp). */
  start(t0: number): void {
    this.t0 = t0;
    this.active = true;
    this.rect = this.o.surface.getBoundingClientRect();
    const el = this.o.surface;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void) => {
      el.addEventListener(type, fn as EventListener, { passive: false });
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    on(RAW_SUPPORTED ? ('pointerrawupdate' as 'pointermove') : 'pointermove', (e) => this.move(e));
    on('pointerleave', (e) => this.leave(e));
    // Palm rejection: block touch gestures and scrolling on the canvas.
    on('touchstart', (e) => e.preventDefault());
    on('touchmove', (e) => e.preventDefault());
    const onResize = () => (this.rect = el.getBoundingClientRect());
    window.addEventListener('resize', onResize);
    this.cleanup.push(() => window.removeEventListener('resize', onResize));
  }

  pause(): void {
    this.active = false;
  }

  resume(): void {
    this.rect = this.o.surface.getBoundingClientRect();
    this.active = true;
  }

  stop(): void {
    this.active = false;
    this.cleanup.splice(0).forEach((fn) => fn());
  }

  private accepts(e: PointerEvent): boolean {
    if (!this.active) return false;
    if (e.pointerType === 'touch') {
      e.preventDefault();
      return false;
    }
    return e.pointerType === 'pen' || (this.o.allowMouse && e.pointerType === 'mouse');
  }

  private sample(e: PointerEvent, flags: number): Omit<PenSample, 'sample_seq'> {
    const x = (e.clientX - this.rect.left) / this.o.pxPerMm;
    const y = (e.clientY - this.rect.top) / this.o.pxPerMm;
    if ((e.buttons & 32) !== 0) flags |= StrokeFlag.ERASER;
    return {
      t_us: Math.round((e.timeStamp - this.t0) * 1000),
      x_mm: x,
      y_mm: y,
      // Raw pressure, never rescaled (DDD §1). A mouse reports 0.5 while pressed.
      pressure: e.pressure,
      tilt_x: clampInt8(e.tiltX ?? 0),
      tilt_y: clampInt8(e.tiltY ?? 0),
      flags,
      box_id: this.activeBoxId,
    };
  }

  private down(e: PointerEvent) {
    if (!this.accepts(e)) return;
    e.preventDefault();
    this.o.surface.setPointerCapture(e.pointerId);
    const x = (e.clientX - this.rect.left) / this.o.pxPerMm;
    const y = (e.clientY - this.rect.top) / this.o.pxPerMm;
    const prev = this.fillPos;
    const next = advanceFillPosition(this.o.geometry.boxes, this.o.fillOrder, Math.max(prev, 0), x, y, this.o.boxEntryMarginMm);
    if (next !== prev) {
      const from = Math.max(prev, 0);
      const skipped = this.o.fillOrder.slice(from, next).filter((id) => !this.written.has(id));
      this.fillPos = next;
      this.o.onBoxAdvanced(this.activeBoxId, next, skipped);
    }
    this.written.add(this.activeBoxId);
    this.inContact = true;
    this.lastHover = null;
    this.o.onSamples([this.sample(e, StrokeFlag.CONTACT | StrokeFlag.STROKE_START)]);
  }

  private move(e: PointerEvent) {
    if (!this.accepts(e)) return;
    const events = e.getCoalescedEvents?.() ?? [];
    const list = events.length > 0 ? events : [e];
    const out: Omit<PenSample, 'sample_seq'>[] = [];
    for (const ev of list) {
      const contact = this.inContact && (ev.buttons & 1) !== 0;
      if (!contact && e.pointerType !== 'pen') continue; // a mouse has no hover range
      const s = this.sample(ev, contact ? StrokeFlag.CONTACT : StrokeFlag.HOVER);
      if (!contact) this.lastHover = s;
      out.push(s);
    }
    if (out.length > 0) this.o.onSamples(out);
  }

  private up(e: PointerEvent) {
    if (!this.accepts(e) || !this.inContact) return;
    this.inContact = false;
    this.o.onSamples([this.sample(e, StrokeFlag.CONTACT | StrokeFlag.STROKE_END)]);
  }

  /** The pen left the hover range: mark the last hover position. */
  private leave(e: PointerEvent) {
    if (!this.accepts(e) || e.pointerType !== 'pen' || this.inContact || !this.lastHover) return;
    this.o.onSamples([{ ...this.sample(e, StrokeFlag.HOVER | StrokeFlag.OUT_OF_RANGE) }]);
    this.lastHover = null;
  }
}
