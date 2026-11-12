import base64
from pathlib import Path

from fastapi.testclient import TestClient

from ilt_analytics.legacy import detect_measure, merge, parse_file
from ilt_analytics.main import app

SAMPLES = Path(__file__).resolve().parents[3] / "Documents" / "05_Measures" / "Samples"
FILES = {
    "HAND_RAISES": "Hands Raises sample for program.xls",
    "SEGMENT_WIDTH": "Segment width sample.xls",
    "TOTAL_TIME": "Total Time sample.xls",
    "WRITING_TIME": "Writing Time sample.xls",
    "AIR_TIME": "Air Time sample.xls",
}


def test_detects_the_measure_from_the_sheet_or_file_name():
    assert detect_measure("Air Time.xls") == "AIR_TIME"
    assert detect_measure("Sheet1", "Hands Raises sample for program.xls") == "HAND_RAISES"
    assert detect_measure("Segment width.xls") == "SEGMENT_WIDTH"
    assert detect_measure("Writing Time.xls") == "WRITING_TIME"
    assert detect_measure("Total Time.xls") == "TOTAL_TIME"
    assert detect_measure("Sheet1", "results.xls") is None


def test_reads_every_sample_file():
    for measure, name in FILES.items():
        f = parse_file(name, (SAMPLES / name).read_bytes())
        assert f["error"] is None, (name, f["error"])
        assert f["measure"] == measure and f["detected"] == measure
        assert f["rows"] == 54 and f["blocks"] == 36
    raises = parse_file(FILES["HAND_RAISES"], (SAMPLES / FILES["HAND_RAISES"]).read_bytes())
    child = raises["children"]["97"]
    assert child["hand_raw"] == 1 and child["mistakes"] is not None
    assert child["values"][1] == 16 and child["values"][2] == 16


def test_merges_the_measures_of_each_child():
    parsed = [parse_file(n, (SAMPLES / n).read_bytes()) for n in FILES.values()]
    m = merge(parsed)
    assert len(m["children"]) == 54
    first = next(c for c in m["children"] if c["legacy_id"] == "97")
    assert first["hand"] == "RIGHT"
    assert first["blocks"][1] == {"HAND_RAISES": 16, "SEGMENT_WIDTH": 15, "TOTAL_TIME": 35769, "WRITING_TIME": 20860, "AIR_TIME": 14909}
    assert first["raw"][1]["TOTAL_TIME"] == {"file": FILES["TOTAL_TIME"], "value": 35769.0}
    left = next(c for c in m["children"] if c["legacy_id"] == "132")
    assert left["hand"] == "LEFT"
    # The children are in number order.
    ids = [int(c["legacy_id"]) for c in m["children"]]
    assert ids == sorted(ids)


def test_a_file_that_is_not_xls_is_reported():
    f = parse_file("notes.xls", b"hello")
    assert f["error"].startswith("not_xls")


def test_parse_endpoint_reports_files_children_and_a_measure_given_twice():
    c = TestClient(app)
    files = [{"name": n, "content_base64": base64.b64encode((SAMPLES / n).read_bytes()).decode()} for n in (FILES["TOTAL_TIME"], FILES["AIR_TIME"])]
    res = c.post("/api/v1/legacy/parse", json={"files": files})
    assert res.status_code == 200
    body = res.json()
    assert [(f["measure"], f["rows"], f["error"]) for f in body["files"]] == [("TOTAL_TIME", 54, None), ("AIR_TIME", 54, None)]
    assert len(body["children"]) == 54 and body["children"][0]["blocks"]["1"].keys() == {"TOTAL_TIME", "AIR_TIME"}
    # The same measure twice: both files are refused, and only the other file's children remain.
    twice = files + [{**files[0], "name": "copy.xls"}]
    body = c.post("/api/v1/legacy/parse", json={"files": twice}).json()
    assert [f["error"] for f in body["files"]] == ["measure_twice", None, "measure_twice"]
    assert all(f["warnings"] == [] for f in body["files"])
    assert body["children"][0]["blocks"]["1"].keys() == {"AIR_TIME"}
    # A measure chosen by hand wins over the detected one.
    body = c.post("/api/v1/legacy/parse", json={"files": [{**files[0], "measure": "WRITING_TIME"}]}).json()
    assert body["files"][0]["measure"] == "WRITING_TIME" and body["files"][0]["detected"] == "TOTAL_TIME"
    assert c.post("/api/v1/legacy/parse", json={"files": [{**files[0], "content_base64": "@@@"}]}).json()["files"][0]["error"] == "not_base64"
