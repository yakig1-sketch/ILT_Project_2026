# Wacom DTH-A116 in Chrome: Measured Device Profile

**Source:** ILT Pen Probe v1.0, run on the DTH-A116 in Chrome on 2026-10-22 ([raw results](Device_Tests/DTH-A116_pen-probe_2026-10-22.json))
**Test:** 7 pen strokes (3,829 contact samples, ~16 s of writing), 328 hover samples, ruler calibration confirmed with a physical ruler
**Purpose:** replace the assumed hardware numbers in the specs with measured ones. Closes blocking gap B8.

## Results

| Property | Datasheet / spec assumption | **Measured in Chrome** | Verdict |
|---|---|---|---|
| Pen recognised as pen | — | `pointerType = "pen"` on every stroke | ✅ |
| Contact sampling rate | 270 pps (spec: 133 Hz) | **~239 Hz** while moving (median interval 4.1 ms, p5 3.5 ms, p95 5.6 ms). Stable across speeds from 20 to >200 mm/s. | ✅ Use **240 Hz** as the design rate |
| Slow movement | — | Below ~20 mm/s the interval sometimes doubles to 7–10 ms (skipped samples while almost stationary) | ⚠️ Analysis must be time-based, not sample-count-based |
| Timestamp precision | Spec: integer ms is "lossless" | **0.1 ms** steps; no duplicates | ❌ Integer ms loses precision. Store **microseconds** |
| Samples per screen frame | — | Screen runs at **60 Hz**; each `pointermove` carries **3.9 samples** | ⚠️ Without `getCoalescedEvents()` about 75% of samples are lost |
| `pointerrawupdate` | — | Supported. Fires once per sample (3,828 events for 3,829 samples) | ✅ Use for low-latency live mirroring |
| Pressure | 4,096 levels | Continuous 0–1, **~8,192 steps** (smallest step 0.00012). 2,133 distinct values. Typical writing 0.5–0.8; hardest press reached **0.86** | ✅ Don't assume pressure reaches 1.0 |
| Hover | 10 mm reading height | **Reported**, with position and tilt, at **60 Hz** (one per frame). Leaving hover range is detected. | ✅ Air time is measurable (±17 ms). Hover paths are coarse |
| Tilt | Not listed in datasheet | **Reported and smooth**: tiltX −41…+51°, tiltY −54…+54°, altitude 32°–85° | ✅ Better than expected |
| Twist / eraser | — | Not reported / not present | — |
| Coordinate precision | — | Sub-pixel (finer than 1 CSS px = 0.19 mm) | ✅ |
| Physical size | 230.9 PPI (from datasheet geometry) | **230.9 PPI confirmed with a physical ruler**: 5.195 CSS px/mm at devicePixelRatio 1.75 | ✅ |
| Palm contact | — | **22 touch contacts** during 7 pen strokes | ⚠️ Touch must be ignored while writing |
| Browser identity | — | User-agent reports "Android 10; K" (Chrome's reduced UA, not the real OS) | ℹ️ Don't detect the device from the UA string |

## Device constants for ILT

These become the DTH-A116 entry in `packages/shared-types` during Phase 0.

| Constant | Value |
|---|---|
| `SAMPLE_RATE_DESIGN_HZ` | 240 (buffers and load tests sized for 270 peak) |
| `SAMPLE_INTERVAL_MEDIAN_MS` | 4.1 |
| `TIMESTAMP_RESOLUTION_MS` | 0.1 |
| `CSS_PX_PER_MM` | 5.195 (at devicePixelRatio 1.75) |
| `PHYSICAL_PPI` | 230.9 |
| `DISPLAY_REFRESH_HZ` | 60 |
| `HOVER_RATE_HZ` | 60 |
| `PRESSURE_OBSERVED_MAX` | 0.86 |
| `TILT_SUPPORTED` | true |
| Telemetry volume | ~240 rows/s → ~7,200 rows per 30 s block; ~5.8 KB/s on the wire |

## Required changes to the specs (DDD v1.4 / Architecture v5.4)

1. **Sampling rate:** replace every "133 Hz" with a 240 Hz design rate. A 50-sample chunk is ~210 ms, not 375 ms.
2. **Timestamps:** change `time_offset_ms` (int32 ms) to **`time_offset_us` (int32 microseconds)**. Same 4 bytes on the wire, and it covers 35 minutes per block.
3. **Coordinates:** store **millimetres (float32)** from the canvas origin, converted at capture with the calibrated px/mm. Save the calibration with each session. This removes v1.4's "mm or virtual px" ambiguity and lets the 3.5 mm dot and 15 ± 2 mm width rules apply directly.
4. **Capture source:** use **one** event source for persistence to avoid double-counting. Either `pointermove` + `getCoalescedEvents()`, or `pointerrawupdate` (which fires per sample).
5. **Live mirror latency:** at 60 Hz, `pointermove` holds samples for up to 16.7 ms, which already exceeds the <15 ms mirror target. Stream from `pointerrawupdate` to meet it.
6. **Pen-lift detection:** pressure never drops to 0 during contact. Lifts arrive as `pointerup` / `pointerdown`. The v1.4 rule "pressure == 0 for ≥ 50 ms" should become "time between `pointerup` and the next `pointerdown` ≥ 50 ms" (the threshold still needs the researchers' confirmation).
7. **Kinematics:** resample each stroke to a uniform time grid (for example 4 ms) before computing velocity and jerk, so gaps at slow speeds don't distort them.
8. **Pressure-based rules:** normalise to the device's observed range (max ≈ 0.86), not to 1.0.
9. **Palm rejection:** the tablet kiosk ignores all touch input while a block is active.
10. **Hover:** air time is reliable. If detailed hover paths matter clinically, test whether `pointerrawupdate` delivers hover faster than 60 Hz (the probe can be extended for this).

## Status

Gap **B8 is closed**: the DTH-A116 works for ILT in Chrome, with measured constants above. The only open item is optional: the hover rate through `pointerrawupdate`.
