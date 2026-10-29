// Canonical pen sample, shared by the wire codec, database, scoring engine and replayer (DDD §4).

export interface PenSample {
  /** uint32, per block attempt, starts at 0. Idempotency key for persistence. */
  sample_seq: number;
  /** int32 microseconds since block start. */
  t_us: number;
  /** float32 millimetres from the canvas's top-left, x to the right. */
  x_mm: number;
  /** float32 millimetres from the canvas's top-left, y down. */
  y_mm: number;
  /** Raw pressure 0..1 as reported by the browser. Never rescaled or clipped. */
  pressure: number;
  /** int8 degrees. */
  tilt_x: number;
  /** int8 degrees. */
  tilt_y: number;
  /** uint8 bitmask of StrokeFlag. */
  flags: number;
  /** uint8 active box id (0..14 on the ILT grid), NO_BOX when none. */
  box_id: number;
}

export const StrokeFlag = {
  CONTACT: 0x01,
  HOVER: 0x02,
  ERASER: 0x04,
  /** Live hint computed on the tablet; scoring recomputes on the server. */
  TARGET_HIT_HINT: 0x08,
  STROKE_START: 0x10,
  STROKE_END: 0x20,
  OUT_OF_RANGE: 0x40,
} as const;
export type StrokeFlag = (typeof StrokeFlag)[keyof typeof StrokeFlag];

export const NO_BOX = 255;

export const hasFlag = (sample: Pick<PenSample, 'flags'>, flag: StrokeFlag): boolean =>
  (sample.flags & flag) !== 0;

/** Measured on the DTH-A116 in Chrome, 2026-10-22 (Documents/04_Development_Plan/ILT_DTH-A116_Device_Profile.md). */
export const DTH_A116 = {
  MODEL: 'DTH-A116',
  SAMPLE_RATE_DESIGN_HZ: 240,
  SAMPLE_RATE_PEAK_HZ: 270,
  SAMPLE_INTERVAL_MEDIAN_MS: 4.1,
  TIMESTAMP_RESOLUTION_MS: 0.1,
  CSS_PX_PER_MM: 5.195,
  DEVICE_PIXEL_RATIO: 1.75,
  PHYSICAL_PPI: 230.9,
  DISPLAY_REFRESH_HZ: 60,
  HOVER_RATE_HZ: 60,
  PRESSURE_OBSERVED_MAX: 0.86,
  TILT_SUPPORTED: true,
} as const;
