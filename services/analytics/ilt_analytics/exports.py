"""Research exports (Phase 4c; FRS FR-AN-2, FR-AN-3; Architecture §4.4).

The gateway resolves the analyst's filters to a list of research session ids and asks for an export.
This module reads those sessions from the research views only (as ilt_analyst), writes one file per
table in Parquet or CSV, adds a README and a manifest, zips them and uploads the zip to the private
exports bucket. The gateway serves it through a short-lived signed link.
"""

from __future__ import annotations

import json
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import duckdb
import pyarrow as pa

from . import __version__
from .kinematics import block_kinematics

BUCKET = "ilt-exports"
FINISHED = ("COMPLETED", "MANUAL_FINISH", "TIMED_OUT")

SESSIONS = """
SELECT rs.session_id, rs.session_code, rs.study_code, rs.domain_id, d.code AS domain_code, rs.region_id, r.code AS region_code,
       left(rs.school_code_hmac, 8) AS school_key, rs.grade_level, rs.gender, rs.ses_group, rs.dominant_hand, rs.cohort,
       rs.session_type, rs.language_code, rs.age_months, rs.device_model, rs.css_px_per_mm, rs.started_at, rs.completed_at,
       (rs.settings_snapshot->'ilt.timer.inactivity_sec'->>'value')::int AS inactivity_sec,
       (rs.settings_snapshot->'ilt.timer.inactivity_last_box_sec'->>'value')::int AS inactivity_last_box_sec,
       (rs.settings_snapshot->'scoring.pass_threshold'->>'value')::numeric AS pass_threshold,
       (rs.settings_snapshot->'scoring.composite.weight_speed_pct'->>'value')::numeric AS weight_speed_pct,
       (rs.settings_snapshot->'scoring.composite.weight_accuracy_pct'->>'value')::numeric AS weight_accuracy_pct,
       (rs.settings_snapshot->'scoring.composite.weight_pen_lifts_pct'->>'value')::numeric AS weight_pen_lifts_pct,
       rs.settings_snapshot
  FROM v_research_sessions rs
  LEFT JOIN domains d ON d.id = rs.domain_id
  LEFT JOIN regions r ON r.id = rs.region_id
 WHERE rs.session_id = ANY(%(ids)s::uuid[])
 ORDER BY rs.completed_at, rs.session_code"""

# counts: the latest finished attempt of each scored step, as in the portal's cohort means.
BLOCKS = f"""
SELECT b.session_id, b.study_code, b.step_index, b.step_type, b.label_key, b.block_number, b.is_scored, b.canvas_code, b.canvas_version,
       b.mirrored, b.fill_order, b.block_attempt_id, b.attempt_number, b.status, b.sample_count, b.total_time_ms, b.active_writing_time_ms,
       b.air_time_ms, b.last_box_completed, b.skipped_boxes, b.score_version, b.pen_lifts, b.internal_pen_lifts, b.accurate_letters,
       b.accuracy_score, b.avg_speed_mm_s, b.speed_score, b.pen_lift_score, b.composite_score, b.pass,
       (b.is_scored AND b.status IN {FINISHED!r} AND b.attempt_number = max(b.attempt_number) FILTER (WHERE b.status IN {FINISHED!r})
          OVER (PARTITION BY b.session_id, b.step_index)) AS counts
  FROM v_research_blocks b
 WHERE b.session_id = ANY(%(ids)s::uuid[])
 ORDER BY b.session_id, b.step_index, b.attempt_number"""

LETTERS = """
SELECT * FROM v_research_letters WHERE session_id = ANY(%(ids)s::uuid[]) ORDER BY session_id, block_attempt_id, fill_position, box_id"""

SCORE_VERSIONS = """
SELECT * FROM v_research_score_versions WHERE session_id = ANY(%(ids)s::uuid[]) ORDER BY session_id, block_attempt_id, version"""

# Phase 5d: one row per letter of each intervention sheet attempt, with the system's suggestion and the final mark.
MARKS = """
SELECT m.session_id, m.study_code, m.block_attempt_id, m.step_index, m.block_number, m.canvas_code, m.box_id, m.row_type, m.letter,
       m.auto_error, m.start_point_ok, m.evaluator_error, m.final_error, m.decided_by, m.decided_at, m.similarity_hint,
       m.internal_pen_lifts, m.lifts_allowed
  FROM v_research_marks m
 WHERE m.session_id = ANY(%(ids)s::uuid[])
 ORDER BY m.session_id, m.step_index, m.block_attempt_id, m.box_id"""

SAMPLES = """
SELECT b.session_id, s.block_attempt_id, s.sample_seq, s.sample_time, s.t_us, s.x_mm, s.y_mm, s.pressure, s.tilt_x, s.tilt_y, s.flags, s.box_id
  FROM v_research_samples s JOIN v_research_blocks b ON b.block_attempt_id = s.block_attempt_id
 WHERE b.session_id = ANY(%(ids)s::uuid[])
 ORDER BY b.session_id, s.block_attempt_id, s.sample_seq"""

README = """ILT research export
===================

Created {created} by the ILT analytics service {version}. Format: {fmt}.
Sessions: {sessions}. Filters used in the analyst portal: {filters}

Only completed Research sessions of participants whose current consent allows research use are
included. Participants appear only by study code, schools only by a short code (school_key); there
are no names, birth dates, national ids or school names. Times are UTC.

Files (one table each; join on session_id and block_attempt_id):

sessions        One row per session: participant attributes (grade, gender, SES group, dominant
                hand, cohort), Domain and Region, session stage and language, age in months, device,
                the timers, pass threshold and composite weights the session used, and the full
                settings snapshot (JSON text).
blocks          One row per block attempt (warm-up, ILT blocks, notebook pages; repeated and
                stopped attempts included) with its current score. counts = true marks the
                attempts used in the portal's cohort means: the latest finished attempt of each
                scored ILT block.
letters         One row per letter box of each attempt: measures (timing, strokes, path, width,
                pressure, closest approach to each dot) and the current letter score (dots hit,
                order, width band, line length and time, speed, accuracy).
score_versions  Every score version of each attempt (is_current marks the one in blocks and
                letters), with the settings and scoring profile used (JSON text).
marks           Intervention sheets only: one row per letter of each sheet attempt. row_type
                TRACE_MODEL (row 1), START_DOT (row 2) or FREEHAND (row 3); auto_error is the
                system's suggestion (empty for row 3), evaluator_error the evaluator's own mark,
                final_error the mark in force (true = error); decided_by SYSTEM or EVALUATOR;
                similarity_hint (row 3, 0..100) is a hint that never counts; internal_pen_lifts and
                lifts_allowed explain row 1. A sheet's accuracy_score = correct marks / marks x 100,
                set once no mark is empty.
{optional}
manifest.json   This export's filters, options and row counts.

Units: mm, ms (t_us in microseconds from the block start), mm/s; pressure is the raw 0..1 value.
Scores are on 0..100. Codes: grade_level KINDERGARTEN, GRADE_1..GRADE_6; gender MALE/FEMALE/OTHER;
ses_group LOW/MID/HIGH (empty = not recorded); session_type DAY_1/DAY_2/DAY_14/INTERVENTION.
"""

SAMPLES_TEXT = """samples         Every recorded pen sample of each attempt: t_us, x_mm, y_mm, pressure, tilt,
                flags (bit mask: 1 contact, 2 hover, 16 stroke start, 32 stroke end) and box_id
                (255 = outside the boxes).
"""

KINEMATICS_TEXT = """kinematics_blocks, kinematics_letters, kinematics_strokes
                Kinematics of each attempt with pen samples, computed for this export (DDD 8.9):
                strokes, writing time, path, mean and peak speed (mm/s), velocity peaks, mean jerk
                (mm/s^3), normalised jerk (no unit, lower is smoother) and mean pressure; per block,
                per letter box (position = writing order) and per stroke.
"""


def _cell(v):
    """A database value as a plain Parquet/CSV value."""
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False)
    return v


# Column types by PostgreSQL type name, so a column empty in every row keeps its type.
_PG_TYPES = {
    "int2": pa.int16(), "int4": pa.int32(), "int8": pa.int64(), "float4": pa.float32(), "float8": pa.float64(),
    "numeric": pa.float64(), "bool": pa.bool_(), "timestamptz": pa.timestamp("us", tz="UTC"), "date": pa.date32(),
}


def _query(conn, sql: str, ids: list[str]) -> pa.Table:
    """The rows of a query as a table typed from the database columns (text, JSON and ids as strings)."""
    cur = conn.execute(sql, {"ids": ids})
    fields = []
    for col in cur.description:
        info = conn.adapters.types.get(col.type_code)
        fields.append(pa.field(col.name, _PG_TYPES.get(info.name if info else "", pa.string())))
    names = [f.name for f in fields]
    rows = [{n: _cell(v) for n, v in zip(names, row)} for row in cur.fetchall()]
    return pa.Table.from_pylist(rows, schema=pa.schema(fields))


def _table(rows: list[dict], columns: list[str]) -> pa.Table:
    """Kinematics rows as a table; a column with no value at all is typed as a number."""
    if not rows:
        return pa.table({c: pa.array([], pa.string()) for c in columns})
    t = pa.Table.from_pylist(rows)
    for i, f in enumerate(t.schema):
        if pa.types.is_null(f.type):
            t = t.set_column(i, f.name, t.column(i).cast(pa.float64()))
    return t


def _write(table: pa.Table, fmt: str, path: Path) -> None:
    """One table as a Parquet or CSV file, written by DuckDB (header row, UTF-8, ISO timestamps in CSV)."""
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")
    rel = con.from_arrow(table)
    if fmt == "PARQUET":
        rel.write_parquet(str(path), compression="zstd")
    else:
        rel.write_csv(str(path), header=True)
    con.close()


def build_tables(conn, ids: list[str], include_samples: bool, include_kinematics: bool) -> dict[str, pa.Table]:
    tables = {
        "sessions": _query(conn, SESSIONS, ids),
        "blocks": _query(conn, BLOCKS, ids),
        "letters": _query(conn, LETTERS, ids),
        "score_versions": _query(conn, SCORE_VERSIONS, ids),
        "marks": _query(conn, MARKS, ids),
    }
    if include_samples:
        tables["samples"] = _query(conn, SAMPLES, ids)
    if include_kinematics:
        kb, kl, ks = [], [], []
        key_cols = ["session_id", "block_attempt_id"]
        attempts = conn.execute(
            "SELECT session_id, block_attempt_id FROM v_research_blocks WHERE session_id = ANY(%(ids)s::uuid[]) AND coalesce(sample_count, 0) > 0 "
            "ORDER BY session_id, step_index, attempt_number",
            {"ids": ids},
        ).fetchall()
        for session_id, attempt_id in attempts:
            samples = conn.execute(
                "SELECT t_us, x_mm, y_mm, pressure, flags, box_id FROM v_research_samples WHERE block_attempt_id = %s ORDER BY sample_seq", (attempt_id,)
            ).fetchall()
            k = block_kinematics(samples, with_series=False)
            key = {"session_id": str(session_id), "block_attempt_id": str(attempt_id)}
            kb.append({**key, **k["summary"]})
            kl.extend({**key, **letter} for letter in k["letters"])
            ks.extend({**key, **stroke} for stroke in k["strokes"])
        tables["kinematics_blocks"] = _table(kb, key_cols)
        tables["kinematics_letters"] = _table(kl, key_cols)
        tables["kinematics_strokes"] = _table(ks, key_cols)
    return tables


def build_zip(tables: dict[str, pa.Table], fmt: str, filters: dict, options: dict, path: Path) -> dict[str, int]:
    """Writes the zip to path; returns the row count of each table."""
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    counts = {name: t.num_rows for name, t in tables.items()}
    ext = "parquet" if fmt == "PARQUET" else "csv"
    optional = (SAMPLES_TEXT if "samples" in tables else "") + (KINEMATICS_TEXT if "kinematics_blocks" in tables else "")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, table in tables.items():
            file = path.parent / f"{name}.{ext}"
            _write(table, fmt, file)
            z.write(file, file.name)
            file.unlink()
        z.writestr("README.txt", README.format(
            created=created, version=__version__, fmt=fmt, sessions=counts["sessions"],
            filters=json.dumps(filters, ensure_ascii=False) if filters else "none", optional=optional,
        ))
        z.writestr("manifest.json", json.dumps({
            "created_at": created, "engine": f"ilt-analytics {__version__}", "format": fmt, "filters": filters,
            "options": options, "row_counts": counts,
        }, ensure_ascii=False, indent=2))
    return counts


def run_export(conn, store, export_id: str, ids: list[str], fmt: str, filters: dict, include_samples: bool, include_kinematics: bool) -> dict:
    """Builds the export and uploads it; returns the object key, size and row counts."""
    tables = build_tables(conn, ids, include_samples, include_kinematics)
    options = {"include_samples": include_samples, "include_kinematics": include_kinematics}
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "export.zip"
        counts = build_zip(tables, fmt, filters, options, path)
        key = f"exports/{export_id}.zip"
        store.upload(path, key)
        return {"object_key": key, "size_bytes": path.stat().st_size, "row_counts": counts}
