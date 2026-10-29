// Draws pen samples on a <canvas> in millimetre coordinates. The tablet draws plain ink; the cockpit
// mirror colours ink by pressure and shows the in-air hover path in yellow (FR-COCK-1).
import { StrokeFlag, type PenSample } from '@ilt/shared-types';

export interface InkOptions {
  pressureColour: boolean;
  showHover: boolean;
  lineWidthMm: number;
}

const DEFAULTS: InkOptions = { pressureColour: false, showHover: false, lineWidthMm: 0.5 };

/** Light blue at low pressure to dark navy at high pressure. */
function pressureStyle(p: number): string {
  const v = Math.max(0, Math.min(1, p));
  return `hsl(215 85% ${Math.round(70 - v * 55)}%)`;
}

export class InkRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly options: InkOptions;
  private samples: PenSample[] = [];
  private last: PenSample | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sizeMm: { width: number; height: number },
    private pxPerMm: number,
    options: Partial<InkOptions> = {},
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.options = { ...DEFAULTS, ...options };
    this.resize(pxPerMm);
  }

  /** Sets the backing store for the scale and device pixel ratio, then redraws everything. */
  resize(pxPerMm: number): void {
    this.pxPerMm = pxPerMm;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.sizeMm.width * pxPerMm * dpr);
    this.canvas.height = Math.round(this.sizeMm.height * pxPerMm * dpr);
    this.canvas.style.width = `${this.sizeMm.width * pxPerMm}px`;
    this.canvas.style.height = `${this.sizeMm.height * pxPerMm}px`;
    this.ctx.setTransform(dpr * pxPerMm, 0, 0, dpr * pxPerMm, 0, 0);
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    const all = this.samples;
    this.samples = [];
    this.last = null;
    this.ctx.clearRect(0, 0, this.sizeMm.width, this.sizeMm.height);
    this.add(all);
  }

  clear(): void {
    this.samples = [];
    this.last = null;
    this.ctx.clearRect(0, 0, this.sizeMm.width, this.sizeMm.height);
  }

  add(samples: readonly PenSample[]): void {
    const { ctx, options } = this;
    for (const s of samples) {
      const prev = this.last;
      const contact = (s.flags & StrokeFlag.CONTACT) !== 0;
      const newStroke = (s.flags & StrokeFlag.STROKE_START) !== 0;
      if (prev && !newStroke && (prev.flags & StrokeFlag.OUT_OF_RANGE) === 0) {
        const prevContact = (prev.flags & StrokeFlag.CONTACT) !== 0;
        if (contact && prevContact && (prev.flags & StrokeFlag.STROKE_END) === 0) {
          ctx.strokeStyle = options.pressureColour ? pressureStyle(s.pressure) : '#111';
          ctx.lineWidth = options.lineWidthMm;
          this.segment(prev, s);
        } else if (options.showHover && !contact && !prevContact) {
          ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)';
          ctx.lineWidth = options.lineWidthMm * 0.5;
          this.segment(prev, s);
        }
      }
      if (contact && newStroke) {
        // A dot for a pen-down without movement.
        ctx.fillStyle = options.pressureColour ? pressureStyle(s.pressure) : '#111';
        ctx.beginPath();
        ctx.arc(s.x_mm, s.y_mm, options.lineWidthMm / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      this.samples.push(s);
      this.last = s;
    }
  }

  private segment(a: PenSample, b: PenSample) {
    this.ctx.beginPath();
    this.ctx.moveTo(a.x_mm, a.y_mm);
    this.ctx.lineTo(b.x_mm, b.y_mm);
    this.ctx.stroke();
  }
}
