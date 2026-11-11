from contextlib import contextmanager

import numpy as np
from fastapi.testclient import TestClient

from ilt_analytics.kinematics import CONTACT, NO_BOX, STROKE_END, STROKE_START, block_kinematics, extract_strokes, kinematics, resample
from ilt_analytics.main import app, get_connect


def test_resample_uniform_grid():
    t = np.array([0, 4100, 8300, 16700, 20000])
    x = np.array([0.0, 0.1, 0.2, 0.4, 0.5])
    grid, xs, _, _ = resample(t, x, x)
    assert np.all(np.diff(grid) == 4000)
    assert xs[0] == 0.0


def test_constant_speed_is_recovered():
    # 20 mm/s along x, sampled at ~240 Hz with irregular gaps like the DTH-A116 at slow speed.
    t = np.cumsum(np.r_[0, np.full(100, 4167), np.full(10, 8333), np.full(100, 4167)])
    x = 20.0 * t / 1e6
    k = kinematics(t, x, np.zeros_like(x))
    assert np.allclose(k["speed"][5:-5], 20.0, rtol=1e-3)
    assert np.allclose(k["jerk"][10:-10], 0.0, atol=1e-3)


def min_jerk(length_mm: float, duration_s: float, t0_us: int = 0, x0: float = 0.0, box: int = 1, hz: float = 240.0):
    """Samples of one minimum-jerk stroke along x (a single bell-shaped speed profile)."""
    n = int(duration_s * hz) + 1
    tau = np.linspace(0, 1, n)
    x = x0 + length_mm * (10 * tau**3 - 15 * tau**4 + 6 * tau**5)
    t = t0_us + np.round(tau * duration_s * 1e6).astype(int)
    rows = []
    for i in range(n):
        f = CONTACT | (STROKE_START if i == 0 else 0) | (STROKE_END if i == n - 1 else 0)
        rows.append((int(t[i]), float(x[i]), 5.0, 0.4, f, box))
    return rows


def test_minimum_jerk_stroke_measures():
    k = block_kinematics(min_jerk(20.0, 0.5))
    s = k["strokes"][0]
    assert s["measured"] and s["velocity_peaks"] == 1
    assert abs(s["path_length_mm"] - 20.0) < 0.2
    assert abs(s["mean_speed"] - 40.0) < 0.5            # 20 mm in 0.5 s
    assert abs(s["peak_speed"] - 75.0) < 1.0           # 1.875 x mean for minimum jerk
    assert abs(s["normalized_jerk"] - 19.0) < 1.5      # sqrt(360) = 18.97, the minimum possible
    assert abs(s["mean_pressure"] - 0.4) < 1e-6


def test_strokes_letters_and_hover():
    hover = [(600_000, 30.0, 5.0, 0.0, 0x02, NO_BOX)]
    samples = min_jerk(20, 0.5, box=3) + hover + min_jerk(10, 0.3, t0_us=700_000, x0=30, box=3) + min_jerk(15, 0.4, t0_us=1_200_000, box=1)
    strokes = extract_strokes(samples)
    assert [s.box_id for s in strokes] == [3, 3, 1]
    k = block_kinematics(samples)
    assert [m["start_ms"] for m in k["strokes"]] == [0, 700, 1200]
    assert [(l["box_id"], l["position"], l["strokes"]) for l in k["letters"]] == [(3, 1, 2), (1, 2, 1)]
    assert k["summary"]["strokes"] == 3 and k["summary"]["velocity_peaks_per_stroke"] == 1.0
    assert abs(k["summary"]["path_length_mm"] - 45.0) < 0.5
    assert abs(k["summary"]["writing_time_ms"] - 1200) <= 1
    assert k["series"][1]["t_ms"][0] == 700.0 and len(k["series"]) == 3


def test_short_stroke_is_counted_not_measured():
    tap = [(0, 1.0, 1.0, 0.5, CONTACT | STROKE_START, 2), (8000, 1.1, 1.0, 0.5, CONTACT | STROKE_END, 2)]
    k = block_kinematics(tap)
    assert k["summary"]["strokes"] == 1 and k["summary"]["measured_strokes"] == 0
    assert k["strokes"][0]["mean_speed"] is None and k["series"] == []
    assert k["summary"]["mean_pressure"] == 0.5


class FakeConn:
    """Answers the service's queries from fixed rows (the views are tested in the gateway's DB tests)."""

    def __init__(self, visible: bool):
        self.visible = visible
        self.rows = []

    def execute(self, sql, params):
        if "FROM v_research_samples" in sql:
            self.rows = min_jerk(20, 0.5)
        elif "JOIN v_research_sessions" in sql:
            self.rows = [("a1", "s1", "S1", "P1", 2, "step.ilt_block", 1, "ILT_3X5_HE", 1, "COMPLETED")] if self.visible else []
        elif "FROM v_research_sessions" in sql:
            self.rows = [(1,)] if self.visible else []
        else:
            self.rows = [("a1",)]
        return self

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


def client(visible: bool) -> TestClient:
    @contextmanager
    def connect():
        yield FakeConn(visible)

    app.dependency_overrides[get_connect] = lambda: connect
    return TestClient(app)


def test_attempt_and_session_endpoints():
    c = client(True)
    a = c.get("/api/v1/kinematics/attempts/00000000-0000-0000-0000-000000000001").json()
    assert a["attempt"]["session_code"] == "S1" and a["summary"]["velocity_peaks_per_stroke"] == 1.0 and len(a["series"]) == 1
    s = c.get("/api/v1/kinematics/sessions/00000000-0000-0000-0000-000000000002").json()
    assert s["attempts"][0]["block_attempt_id"] == "a1" and "series" not in s["attempts"][0]
    assert c.get("/api/v1/kinematics/attempts/not-a-uuid").status_code == 404
    hidden = client(False)
    assert hidden.get("/api/v1/kinematics/attempts/00000000-0000-0000-0000-000000000001").status_code == 404
    assert hidden.get("/api/v1/kinematics/sessions/00000000-0000-0000-0000-000000000002").status_code == 404
    app.dependency_overrides.clear()


def test_health():
    res = TestClient(app).get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
