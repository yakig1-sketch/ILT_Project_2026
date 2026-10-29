// Draws a canvas (boxes, dots, notebook lines) in millimetres, scaled by px/mm. On the tablet the
// scale is the calibration, so the page appears at true physical size. Always laid out
// left-to-right: the interface direction never flips the writing canvas.
import type { ReactNode } from 'react';
import type { CanvasGeometry } from '@ilt/template-schemas';

const dash = { SOLID: undefined, DASHED: '1.5 1', DOTTED: '0.3 0.8' } as const;

export function CanvasView({
  geometry,
  pxPerMm,
  activeBoxId,
  children,
}: {
  geometry: CanvasGeometry;
  pxPerMm: number;
  /** Highlights the active box (cockpit mirror). */
  activeBoxId?: number;
  /** Overlay (ink layer, capture surface) laid over the canvas, same size. */
  children?: ReactNode;
}) {
  const { width, height } = geometry.size;
  return (
    <div dir="ltr" style={{ position: 'relative', display: 'inline-block', width: width * pxPerMm, height: height * pxPerMm }}>
      <svg
        width={width * pxPerMm}
        height={height * pxPerMm}
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', inset: 0, overflow: 'visible', background: '#fff' }}
        data-testid="ilt-canvas"
      >
        {geometry.lines.map((l, i) => (
          <line key={`l${i}`} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} stroke={l.color} strokeWidth={l.weight_mm} strokeDasharray={dash[l.style]} />
        ))}
        {geometry.boxes.map((b) => (
          <g key={b.id} transform={`translate(${b.x} ${b.y})`}>
            <rect
              width={b.w}
              height={b.h}
              fill={b.id === activeBoxId ? '#fff8c5' : 'none'}
              stroke={geometry.box_frame.color}
              strokeWidth={geometry.box_frame.weight_mm}
              strokeDasharray={dash[geometry.box_frame.style]}
            />
            {geometry.dots.map((d) => (
              <circle key={d.id} cx={d.x} cy={d.y} r={d.diameter_mm / 2} fill="#000" />
            ))}
          </g>
        ))}
      </svg>
      {children}
    </div>
  );
}
