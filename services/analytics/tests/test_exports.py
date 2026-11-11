import json
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone

import duckdb
import pyarrow as pa
from fastapi.testclient import TestClient

import ilt_analytics.exports as exports
from ilt_analytics.exports import _table, build_zip
from ilt_analytics.main import app, get_connect, get_store


def sample_tables():
    when = datetime(2026, 11, 10, 8, 30, tzinfo=timezone.utc)
    return {
        "sessions": pa.table({"session_id": ["s1"], "study_code": ["P-01"], "region_id": pa.array([None], pa.int32()), "completed_at": [when]}),
        "blocks": pa.table({"session_id": ["s1"], "block_attempt_id": ["a1"], "composite_score": [88.5], "counts": [True]}),
        "letters": pa.table({"session_id": ["s1"], "block_attempt_id": ["a1"], "box_id": pa.array([3], pa.int16())}),
        "score_versions": pa.table({"session_id": ["s1"], "block_attempt_id": ["a1"], "version": pa.array([1], pa.int16())}),
    }


def test_zip_has_one_file_per_table_a_readme_and_a_manifest(tmp_path):
    for fmt, ext in (("PARQUET", "parquet"), ("CSV", "csv")):
        path = tmp_path / f"{fmt}.zip"
        counts = build_zip(sample_tables(), fmt, {"gender": "FEMALE"}, {"include_samples": False}, path)
        assert counts == {"sessions": 1, "blocks": 1, "letters": 1, "score_versions": 1}
        z = zipfile.ZipFile(path)
        assert sorted(z.namelist()) == sorted([f"{n}.{ext}" for n in counts] + ["README.txt", "manifest.json"])
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["format"] == fmt and manifest["filters"] == {"gender": "FEMALE"} and manifest["row_counts"] == counts
        assert "Sessions: 1" in z.read("README.txt").decode() and "samples " not in z.read("README.txt").decode()
        z.extractall(tmp_path / fmt)
    # Parquet keeps the types, including a column with no value.
    row = duckdb.sql(f"SELECT region_id, typeof(region_id), composite_score, counts FROM '{tmp_path / 'PARQUET' / 'sessions.parquet'}' "
                     f"CROSS JOIN '{tmp_path / 'PARQUET' / 'blocks.parquet'}'").fetchall()[0]
    assert row == (None, "INTEGER", 88.5, True)
    # CSV: a header row, times in UTC.
    csv = (tmp_path / "CSV" / "sessions.csv").read_text(encoding="utf-8").splitlines()
    assert csv[0] == "session_id,study_code,region_id,completed_at"
    assert csv[1].startswith("s1,P-01,,2026-11-10 08:30:00")


def test_kinematics_rows_with_no_value_get_a_number_type():
    t = _table([{"session_id": "s1", "position": None}], ["session_id"])
    assert t.schema.field("position").type == pa.float64()
    assert _table([], ["session_id", "block_attempt_id"]).column_names == ["session_id", "block_attempt_id"]


def test_export_endpoint_uploads_the_zip(monkeypatch):
    uploads = []

    class Store:
        def upload(self, path, key):
            uploads.append((key, zipfile.ZipFile(path).namelist()))

    @contextmanager
    def connect():
        yield object()

    seen = {}

    def fake_tables(conn, ids, samples, kinematics):
        seen.update(ids=ids, samples=samples, kinematics=kinematics)
        return sample_tables()

    monkeypatch.setattr(exports, "build_tables", fake_tables)
    app.dependency_overrides[get_connect] = lambda: connect
    app.dependency_overrides[get_store] = lambda: Store()
    c = TestClient(app)
    eid = "00000000-0000-0000-0000-0000000000e1"
    sid = "00000000-0000-0000-0000-0000000000a1"
    res = c.post("/api/v1/exports", json={"export_id": eid, "session_ids": [sid], "format": "CSV", "include_samples": True})
    assert res.status_code == 200
    body = res.json()
    assert body["object_key"] == f"exports/{eid}.zip" and body["size_bytes"] > 0 and body["row_counts"]["sessions"] == 1
    assert seen == {"ids": [sid], "samples": True, "kinematics": False}
    assert uploads[0][0] == f"exports/{eid}.zip" and "sessions.csv" in uploads[0][1]
    assert c.post("/api/v1/exports", json={"export_id": eid, "session_ids": [], "format": "CSV"}).status_code == 422
    assert c.post("/api/v1/exports", json={"export_id": eid, "session_ids": [sid], "format": "XLSX"}).status_code == 422
    app.dependency_overrides.clear()
