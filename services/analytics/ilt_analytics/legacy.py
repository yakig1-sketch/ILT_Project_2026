"""Reading the previous application's exports (Phase 4d; FRS FR-LEG-1).

The old application wrote one .xls file per measure (samples in Documents/05_Measures/Samples): one
row per child, with the child's number ("ID"), a hand flag ("L/R": 1 right, 0 left) and one column per
block ("Raises 1", "Time 1", "Block 1" …). The hand-raises file also has a "Mistakes" total per child.

Mapping (clinical decision 2026-10-25): Hand Raises -> pen lifts; Segment Width -> width (stored as
given; its unit is not confirmed); Total Time -> total time; Writing Time and Air Time -> active
writing time and air time. Times are in milliseconds.

This module only parses: it returns the children and their block values, with warnings, and never
writes to the database. The gateway decides what to import.
"""

from __future__ import annotations

import re

import xlrd

MEASURES = ("HAND_RAISES", "SEGMENT_WIDTH", "TOTAL_TIME", "WRITING_TIME", "AIR_TIME")
_KEYWORDS = (("raise", "HAND_RAISES"), ("width", "SEGMENT_WIDTH"), ("total", "TOTAL_TIME"), ("writing", "WRITING_TIME"), ("air", "AIR_TIME"))
_BLOCK = re.compile(r"^\s*(?:raises|time|block|width)\s*(\d{1,3})\s*$", re.IGNORECASE)
HANDS = {1: "RIGHT", 0: "LEFT"}


def detect_measure(*names: str) -> str | None:
    """The measure named by the sheet or file name ("Air Time.xls", "Hands Raises sample …")."""
    for name in names:
        low = (name or "").lower()
        for word, measure in _KEYWORDS:
            if word in low:
                return measure
    return None


def _number(cell) -> float | None:
    """A cell as a number; empty is None; text that is a number is accepted."""
    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return None
    if cell.ctype == xlrd.XL_CELL_NUMBER:
        return float(cell.value)
    text = str(cell.value).strip()
    if text == "":
        return None
    return float(text)  # ValueError for anything else


def parse_file(name: str, content: bytes, measure: str | None = None) -> dict:
    """One measure file: {name, measure, detected, rows, blocks, warnings, children: {id: {...}}}."""
    warnings: list[str] = []
    try:
        book = xlrd.open_workbook(file_contents=content)
    except Exception as e:  # not an .xls workbook
        return {"name": name, "measure": measure, "detected": None, "rows": 0, "blocks": 0, "children": {},
                "warnings": [], "error": f"not_xls: {str(e)[:120]}"}
    sheet = book.sheet_by_index(0)
    detected = detect_measure(sheet.name, name)
    measure = measure or detected
    out = {"name": name, "measure": measure, "detected": detected, "rows": 0, "blocks": 0, "children": {}, "warnings": warnings, "error": None}
    if measure not in MEASURES:
        out["error"] = "unknown_measure"
        return out
    if sheet.nrows < 2:
        out["error"] = "empty"
        return out
    header = [str(v).strip() for v in sheet.row_values(0)]
    lower = [h.lower() for h in header]
    if "id" not in lower:
        out["error"] = "no_id_column"
        return out
    id_col = lower.index("id")
    hand_col = lower.index("l/r") if "l/r" in lower else None
    mistakes_col = lower.index("mistakes") if "mistakes" in lower else None
    blocks = {c: int(m.group(1)) for c, h in enumerate(header) if (m := _BLOCK.match(h))}
    if not blocks:
        out["error"] = "no_block_columns"
        return out
    out["blocks"] = max(blocks.values())
    children: dict[str, dict] = {}
    for r in range(1, sheet.nrows):
        row = sheet.row(r)
        try:
            raw_id = _number(row[id_col])
        except ValueError:
            warnings.append(f"row {r + 1}: id {row[id_col].value!r} is not a number; skipped")
            continue
        if raw_id is None:
            continue  # empty line
        if raw_id != int(raw_id) or raw_id <= 0:
            warnings.append(f"row {r + 1}: id {raw_id!r} is not a whole positive number; skipped")
            continue
        legacy_id = str(int(raw_id))
        if legacy_id in children:
            warnings.append(f"row {r + 1}: id {legacy_id} appears again; the first row is used")
            continue
        child = {"hand_raw": None, "mistakes": None, "values": {}, "raw": {}}
        if hand_col is not None:
            try:
                h = _number(row[hand_col])
                child["hand_raw"] = None if h is None else int(h)
            except ValueError:
                warnings.append(f"row {r + 1}: L/R {row[hand_col].value!r} is not 0 or 1")
        if mistakes_col is not None:
            try:
                m = _number(row[mistakes_col])
                child["mistakes"] = None if m is None else int(m)
            except ValueError:
                warnings.append(f"row {r + 1}: Mistakes {row[mistakes_col].value!r} is not a number")
        for c, block in blocks.items():
            if c >= len(row):
                continue
            try:
                v = _number(row[c])
            except ValueError:
                warnings.append(f"row {r + 1}, {header[c]}: {row[c].value!r} is not a number; left empty")
                continue
            if v is None:
                continue
            if v < 0:
                warnings.append(f"row {r + 1}, {header[c]}: negative value {v:g}; left empty")
                continue
            child["values"][block] = v
            child["raw"][block] = row[c].value
        children[legacy_id] = child
    out["children"] = children
    out["rows"] = len(children)
    return out


def merge(files: list[dict]) -> dict:
    """The children of all files together: {legacy_id: {hand, hand_raw, mistakes, blocks: {n: {measure: value}}}}."""
    merged: dict[str, dict] = {}
    warnings: list[str] = []
    for f in files:
        if f.get("error"):
            continue
        for legacy_id, child in f["children"].items():
            m = merged.setdefault(legacy_id, {"legacy_id": legacy_id, "hand_raw": None, "hand": None, "mistakes": None, "blocks": {}, "raw": {}})
            if child["hand_raw"] is not None:
                if m["hand_raw"] is None:
                    m["hand_raw"] = child["hand_raw"]
                    m["hand"] = HANDS.get(child["hand_raw"])
                    if m["hand"] is None:
                        warnings.append(f"id {legacy_id}: L/R {child['hand_raw']} is not 0 or 1; hand not recorded")
                elif m["hand_raw"] != child["hand_raw"]:
                    warnings.append(f"id {legacy_id}: L/R differs between files ({m['hand_raw']} and {child['hand_raw']} in {f['name']}); the first is used")
            if child["mistakes"] is not None:
                m["mistakes"] = child["mistakes"]
            for block, v in child["values"].items():
                m["blocks"].setdefault(block, {})[f["measure"]] = v
                m["raw"].setdefault(block, {})[f["measure"]] = {"file": f["name"], "value": child["raw"][block]}
    return {"children": sorted(merged.values(), key=lambda c: int(c["legacy_id"])), "warnings": warnings}
