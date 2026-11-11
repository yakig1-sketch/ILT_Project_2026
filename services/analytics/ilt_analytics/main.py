"""FastAPI entry point. Run: uvicorn ilt_analytics.main:app --host 127.0.0.1 --port 8090

Kinematics for the analyst portal (FRS FR-AN-1; DDD §8.9). The gateway authenticates the analyst and
forwards the request; this service listens on the local interface only and reads the database as
ilt_analyst, so it can reach nothing but the research views (completed RESEARCH sessions with
research consent). An attempt or session outside them is 404.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from fastapi import Depends, FastAPI, HTTPException

from . import __version__
from .config import analyst_database_url
from .kinematics import block_kinematics

app = FastAPI(title="ILT analytics", version=__version__)


@contextmanager
def _connect() -> Iterator[psycopg.Connection]:
    with psycopg.connect(analyst_database_url(), autocommit=True, connect_timeout=5) as conn:
        yield conn


def get_connect():
    """The database connection factory (replaced in tests)."""
    return _connect


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(status_code=404) from None


SAMPLES = "SELECT t_us, x_mm, y_mm, pressure, flags, box_id FROM v_research_samples WHERE block_attempt_id = %s ORDER BY sample_seq"


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/api/v1/kinematics/attempts/{attempt_id}")
def attempt_kinematics(attempt_id: str, connect=Depends(get_connect)) -> dict:
    """One block attempt: summary, letters, strokes and the plotted series."""
    attempt_id = _uuid(attempt_id)
    with connect() as conn:
        row = conn.execute(
            """SELECT b.block_attempt_id, b.session_id, rs.session_code, rs.study_code, b.step_index, b.label_key, b.block_number,
                      b.canvas_code, b.attempt_number, b.status
                 FROM v_research_blocks b JOIN v_research_sessions rs ON rs.session_id = b.session_id
                WHERE b.block_attempt_id = %s""",
            (attempt_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404)
        samples = conn.execute(SAMPLES, (attempt_id,)).fetchall()
    keys = ["id", "session_id", "session_code", "study_code", "step_index", "label_key", "block_number", "canvas_code", "attempt_number", "status"]
    attempt = {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in zip(keys, row)}
    return {"attempt": attempt, **block_kinematics(samples)}


@app.get("/api/v1/kinematics/sessions/{session_id}")
def session_kinematics(session_id: str, connect=Depends(get_connect)) -> dict:
    """The kinematic summary of every block attempt with pen samples in one research session."""
    session_id = _uuid(session_id)
    with connect() as conn:
        if conn.execute("SELECT 1 FROM v_research_sessions WHERE session_id = %s", (session_id,)).fetchone() is None:
            raise HTTPException(status_code=404)
        attempts = conn.execute(
            "SELECT block_attempt_id FROM v_research_blocks WHERE session_id = %s AND coalesce(sample_count, 0) > 0 ORDER BY step_index, attempt_number",
            (session_id,),
        ).fetchall()
        out = []
        for (attempt_id,) in attempts:
            k = block_kinematics(conn.execute(SAMPLES, (attempt_id,)).fetchall(), with_series=False)
            out.append({"block_attempt_id": str(attempt_id), **k["summary"]})
    return {"attempts": out}
