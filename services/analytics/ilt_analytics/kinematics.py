"""Stroke kinematics (DDD §8.9).

Each stroke is resampled to a uniform 4 ms grid, smoothed with a Savitzky-Golay filter
(window 7, order 3), then differentiated. Raw samples are never modified.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import savgol_filter

GRID_US = 4000
WINDOW = 7
ORDER = 3


def resample(t_us: np.ndarray, x: np.ndarray, y: np.ndarray, step_us: int = GRID_US):
    """Linearly resamples one stroke onto a uniform time grid. Returns (t_us, x, y)."""
    t_us = np.asarray(t_us, dtype=np.float64)
    if t_us.size < 2:
        return t_us, np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64)
    grid = np.arange(t_us[0], t_us[-1] + 1, step_us, dtype=np.float64)
    return grid, np.interp(grid, t_us, x), np.interp(grid, t_us, y)


def kinematics(t_us, x, y) -> dict[str, np.ndarray]:
    """Speed (mm/s), acceleration (mm/s^2) and jerk (mm/s^3) along one stroke."""
    t, xs, ys = resample(np.asarray(t_us), np.asarray(x), np.asarray(y))
    dt = GRID_US / 1e6
    if t.size < WINDOW:
        empty = np.zeros(0)
        return {"t_us": t, "speed": empty, "acceleration": empty, "jerk": empty}
    xs = savgol_filter(xs, WINDOW, ORDER)
    ys = savgol_filter(ys, WINDOW, ORDER)
    vx, vy = np.gradient(xs, dt), np.gradient(ys, dt)
    speed = np.hypot(vx, vy)
    acceleration = np.gradient(speed, dt)
    jerk = np.gradient(acceleration, dt)
    return {"t_us": t, "speed": speed, "acceleration": acceleration, "jerk": jerk}
