import numpy as np
from fastapi.testclient import TestClient

from ilt_analytics.kinematics import kinematics, resample
from ilt_analytics.main import app


def test_resample_uniform_grid():
    t = np.array([0, 4100, 8300, 16700, 20000])
    x = np.array([0.0, 0.1, 0.2, 0.4, 0.5])
    grid, xs, _ = resample(t, x, x)
    assert np.all(np.diff(grid) == 4000)
    assert xs[0] == 0.0


def test_constant_speed_is_recovered():
    # 20 mm/s along x, sampled at ~240 Hz with irregular gaps like the DTH-A116 at slow speed.
    t = np.cumsum(np.r_[0, np.full(100, 4167), np.full(10, 8333), np.full(100, 4167)])
    x = 20.0 * t / 1e6
    k = kinematics(t, x, np.zeros_like(x))
    assert np.allclose(k["speed"][5:-5], 20.0, rtol=1e-3)
    assert np.allclose(k["jerk"][10:-10], 0.0, atol=1e-3)


def test_health():
    res = TestClient(app).get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
