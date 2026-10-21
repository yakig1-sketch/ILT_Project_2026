# ILT Pen Probe

A single-file web page that measures what the Wacom DTH-A116 pen actually delivers to Chrome. The results set the device constants for ILT: sampling rate, timestamp precision, pressure range, hover, tilt and physical pixels per millimetre.

## Run it on the tablet

1. Host `index.html` anywhere that serves **HTTPS** (for example the same way as PenFlow). HTTPS is needed for `pointerrawupdate` and clipboard access.
2. Open it in Chrome on the DTH-A116 and tap **Fullscreen**.
3. Follow the "How to test" steps on the page (about 2 minutes). Have a physical ruler ready for the calibration step.
4. Tap **Download results**. The file `ilt-pen-probe-<timestamp>.json` lands in the tablet's Downloads folder. Copy it into `Documents/04_Development_Plan/` in this repo.

## Preview on a PC

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File tools/pen-probe/serve.ps1
```

Then open http://localhost:8765/. A mouse works for checking the page, but only the real pen gives meaningful numbers.

## What it measures

| Measurement | How |
|---|---|
| Contact sampling rate | `getCoalescedEvents()` samples per stroke ÷ stroke duration (strokes ≥ 300 ms) |
| Sample interval | Differences between consecutive event timestamps (`timeStamp`): median, p5, p95 |
| Timestamp precision | Share of timestamps with a sub-millisecond part; duplicate timestamps |
| Batching | Coalesced samples per dispatched `pointermove`; `pointerrawupdate` count |
| Pressure | Min, max and number of distinct values while in contact |
| Hover | Pen `pointermove` events with no button pressed (pen above the screen) |
| Tilt | `tiltX`/`tiltY` ranges, `altitudeAngle`, `twist` |
| Physical size | On-screen 50 mm ruler adjusted against a real ruler → CSS px/mm and physical PPI |
| Display refresh | Median `requestAnimationFrame` interval |

The downloaded JSON contains the device info, calibration, summary, and every raw sample (`t_ms, phase, x_css, y_css, pressure, tilt_x, tilt_y, altitude_rad, azimuth_rad, twist, buttons, pointer_type`).
