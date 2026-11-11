"""Stroke kinematics (DDD §8.9; FRS FR-AN-1).

A stroke is one pen contact, from pen-down to pen-up (the raw strokes of DDD §8.1: short lifts are
not merged here, so no line is drawn through the air). Each stroke is resampled to a uniform 4 ms
grid (linear interpolation of x, y and pressure), then smoothed and differentiated with a
Savitzky-Golay filter (window 7, order 3). Raw samples are never modified.

Measures per stroke:
- speed: tangential speed |v| in mm/s; peak and mean (path length / duration);
- jerk: magnitude of the third derivative of position, mm/s^3; mean over the stroke;
- normalised jerk: sqrt(0.5 * integral(|jerk|^2 dt) * T^5 / L^2), dimensionless (T duration, L path
  length; Teulings et al. 1997). Lower is smoother; it does not depend on size or duration;
- velocity peaks: local maxima of the speed whose prominence is at least 10 % of the stroke's peak
  speed (fewer peaks per stroke = more automatic writing);
- pressure: mean of the raw 0..1 pressure on the grid.
Strokes shorter than the filter window (under 7 grid points, about 24 ms) are counted but not measured.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.signal import find_peaks, savgol_filter

GRID_US = 4000
WINDOW = 7
ORDER = 3
PEAK_PROMINENCE = 0.10
CONTACT, STROKE_START, STROKE_END = 0x01, 0x10, 0x20
NO_BOX = 255


def resample(t_us, x, y, p=None, step_us: int = GRID_US):
    """Linearly resamples one stroke onto a uniform time grid. Returns (t_us, x, y, p)."""
    t_us = np.asarray(t_us, dtype=np.float64)
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    p = np.zeros_like(t_us) if p is None else np.asarray(p, dtype=np.float64)
    if t_us.size < 2:
        return t_us, x, y, p
    grid = np.arange(t_us[0], t_us[-1] + 1, step_us, dtype=np.float64)
    return grid, np.interp(grid, t_us, x), np.interp(grid, t_us, y), np.interp(grid, t_us, p)


def kinematics(t_us, x, y, p=None) -> dict[str, np.ndarray]:
    """Speed (mm/s), tangential acceleration (mm/s^2), jerk magnitude (mm/s^3) and pressure along one stroke."""
    t, xs, ys, ps = resample(t_us, x, y, p)
    dt = GRID_US / 1e6
    if t.size < WINDOW:
        empty = np.zeros(0)
        return {"t_us": t, "speed": empty, "acceleration": empty, "jerk": empty, "pressure": ps, "jerk_x": empty, "jerk_y": empty}
    d = lambda v, n: savgol_filter(v, WINDOW, ORDER, deriv=n, delta=dt)  # noqa: E731
    vx, vy = d(xs, 1), d(ys, 1)
    speed = np.hypot(vx, vy)
    acceleration = savgol_filter(speed, WINDOW, ORDER, deriv=1, delta=dt)
    jx, jy = d(xs, 3), d(ys, 3)
    return {"t_us": t, "speed": speed, "acceleration": acceleration, "jerk": np.hypot(jx, jy), "pressure": ps, "jerk_x": jx, "jerk_y": jy}


@dataclass
class Stroke:
    t_us: list[int] = field(default_factory=list)
    x: list[float] = field(default_factory=list)
    y: list[float] = field(default_factory=list)
    p: list[float] = field(default_factory=list)
    box_id: int = NO_BOX


def extract_strokes(samples) -> list[Stroke]:
    """Splits samples (dicts or tuples with t_us, x, y, pressure, flags, box_id, in sample order) into contact strokes."""
    strokes: list[Stroke] = []
    current: Stroke | None = None
    for t_us, x, y, p, flags, box in samples:
        if not flags & CONTACT:
            current = None
            continue
        if current is None or flags & STROKE_START:
            current = Stroke(box_id=box)
            strokes.append(current)
        current.t_us.append(t_us)
        current.x.append(x)
        current.y.append(y)
        current.p.append(p)
        if current.box_id == NO_BOX and box != NO_BOX:
            current.box_id = box
        if flags & STROKE_END:
            current = None
    return strokes


def _r(v, digits: int = 2):
    return None if v is None or not np.isfinite(v) else round(float(v), digits)


def stroke_measures(s: Stroke) -> tuple[dict, dict | None]:
    """The measures of one stroke and its plotted series (None when it is too short to measure)."""
    k = kinematics(s.t_us, s.x, s.y, s.p)
    duration_s = (s.t_us[-1] - s.t_us[0]) / 1e6 if s.t_us else 0.0
    m = {
        "box_id": None if s.box_id == NO_BOX else s.box_id,
        "start_us": s.t_us[0],
        "duration_ms": _r(duration_s * 1000, 0),
        "samples": len(s.t_us),
        "measured": k["speed"].size > 0,
        "path_length_mm": None, "mean_speed": None, "peak_speed": None, "velocity_peaks": None,
        "mean_jerk": None, "normalized_jerk": None,
        "mean_pressure": _r(np.mean(k["pressure"]) if k["pressure"].size else None, 3),
    }
    if not m["measured"]:
        return m, None
    dt = GRID_US / 1e6
    T = dt * (k["speed"].size - 1)
    length = float(np.sum(k["speed"]) * dt)
    peak = float(np.max(k["speed"]))
    peaks, _ = find_peaks(k["speed"], prominence=PEAK_PROMINENCE * peak) if peak > 0 else ([], None)
    jerk_sq = float(np.sum(k["jerk_x"] ** 2 + k["jerk_y"] ** 2) * dt)
    m.update({
        "path_length_mm": _r(length),
        "mean_speed": _r(length / T if T > 0 else None),
        "peak_speed": _r(peak),
        "velocity_peaks": int(len(peaks)),
        "mean_jerk": _r(np.mean(k["jerk"]), 0),
        "normalized_jerk": _r(np.sqrt(0.5 * jerk_sq * T**5 / length**2) if length > 0 and T > 0 else None, 1),
    })
    series = {
        "t_ms": [float(t) / 1000 for t in k["t_us"]],
        "speed": [round(float(v), 1) for v in k["speed"]],
        "jerk": [round(float(v)) for v in k["jerk"]],
        "pressure": [round(float(v), 3) for v in k["pressure"]],
    }
    return m, series


def _mean(values):
    vals = [v for v in values if v is not None]
    return float(np.mean(vals)) if vals else None


def summarize(measures: list[dict]) -> dict:
    """Block or letter summary over its strokes: writing time, path, mean and peak speed, peaks, jerk, pressure."""
    measured = [m for m in measures if m["measured"]]
    time_ms = sum(m["duration_ms"] or 0 for m in measures)
    path = sum(m["path_length_mm"] for m in measured)
    measured_time_s = sum(m["duration_ms"] for m in measured) / 1000
    weighted_pressure = [(m["mean_pressure"], m["duration_ms"] or 0) for m in measures if m["mean_pressure"] is not None]
    w = sum(d for _, d in weighted_pressure)
    return {
        "strokes": len(measures),
        "measured_strokes": len(measured),
        "writing_time_ms": _r(time_ms, 0),
        "path_length_mm": _r(path) if measured else None,
        "mean_speed": _r(path / measured_time_s) if measured_time_s > 0 else None,
        "peak_speed": _r(max((m["peak_speed"] for m in measured), default=None)),
        "velocity_peaks_per_stroke": _r(_mean(m["velocity_peaks"] for m in measured)),
        "mean_jerk": _r(_mean(m["mean_jerk"] for m in measured), 0),
        "normalized_jerk": _r(_mean(m["normalized_jerk"] for m in measured), 1),
        "mean_pressure": _r(sum(p * d for p, d in weighted_pressure) / w, 3) if w > 0 else (weighted_pressure[0][0] if weighted_pressure else None),
    }


def block_kinematics(samples, with_series: bool = True) -> dict:
    """Kinematics of one block attempt: a summary, one row per letter box (in writing order) and per stroke, and the series."""
    strokes = extract_strokes(samples)
    t0 = strokes[0].t_us[0] if strokes else 0
    rows, series = [], []
    for i, s in enumerate(strokes):
        m, ser = stroke_measures(s)
        m["index"] = i + 1
        m["start_ms"] = _r((m.pop("start_us") - t0) / 1000, 0)
        rows.append(m)
        if ser is not None and with_series:
            series.append({"index": i + 1, "box_id": m["box_id"], **ser, "t_ms": [round(t - t0 / 1000, 1) for t in ser["t_ms"]]})
    letters, order = {}, []
    for m in rows:
        if m["box_id"] not in letters:
            letters[m["box_id"]] = []
            order.append(m["box_id"])
        letters[m["box_id"]].append(m)
    out = {
        "summary": summarize(rows),
        # Writing order of the boxes; strokes outside every box come last, without a position.
        "letters": [{"box_id": b, "position": i + 1, **summarize(letters[b])} for i, b in enumerate(x for x in order if x is not None)]
        + ([{"box_id": None, "position": None, **summarize(letters[None])}] if None in letters else []),
        "strokes": rows,
    }
    if with_series:
        out["series"] = series
    return out
