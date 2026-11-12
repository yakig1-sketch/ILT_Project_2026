"""Turns one of the clinical team's intervention letter sheets (PDF) into an ILT canvas (Phase 5a).

The sheets (Documents/09_Samples/Hebrew_Letter_Sheets) were made in Word. On each page, a block is
3 rows of 5 boxes:
  row 1  the model letter in the first box (right-most, Hebrew is written right to left), and in the
         other four boxes only the dots where each pen stroke starts and ends;
  row 2  only the start dot;
  row 3  empty, written freehand.

What is read, and how:
  - Box frames and the model letter are vector drawings, so they are exact.
  - The dots are small pictures, so the page is rendered at 600 dpi and each dot is found as a dark,
    grey (not blue) ring with a centre; its position is the centre of the ring.
  - Each separately filled shape of the model is one pen stroke. Its centre line (skeleton) gives the
    stroke's path; the stroke's two ends are matched to the dots.
  - Writing order: the stroke that starts at row 2's start dot is first; any other stroke starts at
    its higher end. Dots are numbered in writing order: stroke 1 start, stroke 1 end, stroke 2 start…

Output: a JSON file with the canvas geometry (DDD 7.1), a starting scoring profile (7.2) and where
each value came from, and a PNG drawing everything over the sheet for checking by eye.

Usage (Python 3.12 with pymupdf, scikit-image and pillow; see requirements.txt):
  python extract_letter_sheet.py SHEET.pdf --letter ה --code LETTER_HE_HE --name-he "..." --name-en "..." --out OUT_DIR [--page 0] [--block 0]
"""
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw
from skimage import draw as skdraw
from skimage import measure, morphology

PT = 25.4 / 72  # millimetres per PDF point
DPI = 600
PX = DPI / 25.4  # pixels per millimetre in the rendered page


def r1(v: float) -> float:
    return round(float(v), 2)


# ---------------------------------------------------------------- box frames
def frames(page: pymupdf.Page) -> list[dict]:
    """Rows of boxes from the thin filled rectangles Word draws as table borders."""
    hs, vs = [], []
    for d in page.get_drawings():
        if d.get("fill") is None or len(d["items"]) != 1 or d["items"][0][0] != "re":
            continue
        r = d["rect"]
        w, h = r.width * PT, r.height * PT
        if h < 0.6 and w > 3:
            hs.append(((r.y0 + r.y1) / 2 * PT, r.x0 * PT, r.x1 * PT))
        elif w < 0.6 and h > 3:
            vs.append(((r.x0 + r.x1) / 2 * PT, r.y0 * PT, r.y1 * PT))
    ys = cluster(sorted(y for y, _, _ in hs), 0.6)
    rows, i = [], 0
    while i < len(ys) - 1:
        top, bottom = ys[i], ys[i + 1]
        if 15 < bottom - top < 40:
            xs = cluster(sorted(x for x, y0, y1 in vs if y0 < bottom - 2 and y1 > top + 2), 0.6)
            if len(xs) >= 2:
                rows.append({"top": top, "bottom": bottom, "xs": xs})
            i += 2
        else:
            i += 1
    return rows


def cluster(values: list[float], tol: float) -> list[float]:
    out: list[list[float]] = []
    for v in values:
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


# ---------------------------------------------------------------- dots
def find_dots(page: pymupdf.Page, area: tuple[float, float, float, float], rows: list[dict]) -> list[tuple[float, float]]:
    """Dot centres (mm, page coordinates) inside `area`: dark grey rings, not the blue model or frames."""
    x0, y0, x1, y1 = area
    pix = page.get_pixmap(dpi=DPI, clip=pymupdf.Rect(x0 / PT, y0 / PT, x1 / PT, y1 / PT))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
    grey = (img.max(axis=2) < 150) & (img.max(axis=2) - img.min(axis=2) < 45)
    # Remove the box frames (and a little around them).
    for row in rows:
        for y in (row["top"], row["bottom"]):
            py = int((y - y0) * PX)
            grey[max(0, py - 6):py + 7, :] = False
        for x in row["xs"]:
            px = int((x - x0) * PX)
            top, bottom = int((row["top"] - y0) * PX), int((row["bottom"] - y0) * PX)
            grey[max(0, top - 6):bottom + 7, max(0, px - 6):px + 7] = False
    lab = measure.label(grey, connectivity=2)
    parts = []
    for p in measure.regionprops(lab):
        h, w = (p.bbox[2] - p.bbox[0]) / PX, (p.bbox[3] - p.bbox[1]) / PX
        if 0.15 <= max(h, w) <= 3.5:
            parts.append(p.bbox)
    # A dot is a ring plus a centre: merge parts whose boxes are within 1.2 mm of each other.
    groups: list[list[float]] = []
    for b in parts:
        b = [b[0] / PX, b[1] / PX, b[2] / PX, b[3] / PX]
        for g in groups:
            if b[0] < g[2] + 1.2 and b[2] > g[0] - 1.2 and b[1] < g[3] + 1.2 and b[3] > g[1] - 1.2:
                g[:] = [min(g[0], b[0]), min(g[1], b[1]), max(g[2], b[2]), max(g[3], b[3])]
                break
        else:
            groups.append(b)
    dots = []
    for g in groups:
        size = max(g[2] - g[0], g[3] - g[1])
        if 1.0 <= size <= 3.5:  # a full ring; stray specks are smaller
            dots.append((x0 + (g[1] + g[3]) / 2, y0 + (g[0] + g[2]) / 2))
    return dots


# ---------------------------------------------------------------- model letter
def model_strokes(page: pymupdf.Page, box: tuple[float, float, float, float]) -> list[list[tuple[float, float]]]:
    """The model letter's filled shapes over the given box, as polygons (mm, page coordinates)."""
    bx0, by0, bx1, by1 = box
    shapes = []
    for d in page.get_drawings():
        if d.get("fill") is None or all(it[0] == "re" for it in d["items"]):
            continue
        r = d["rect"]
        if r.x1 * PT < bx0 or r.x0 * PT > bx1 or r.y1 * PT < by0 - 5 or r.y0 * PT > by1 + 15:
            continue
        pts: list[tuple[float, float]] = []
        for it in d["items"]:
            if it[0] == "l":
                seg = [it[1], it[2]]
            elif it[0] == "c":
                p0, c1, c2, p3 = it[1], it[2], it[3], it[4]
                seg = [bezier(p0, c1, c2, p3, t / 8) for t in range(9)]
            else:
                continue
            for p in seg:
                q = (p.x * PT, p.y * PT) if hasattr(p, "x") else (p[0] * PT, p[1] * PT)
                if not pts or math.dist(pts[-1], q) > 1e-6:
                    pts.append(q)
        if len(pts) >= 3:
            shapes.append(pts)
    # Word sometimes writes the same shape twice; keep one of each.
    unique = []
    for s in shapes:
        if not any(len(s) == len(u) and max(math.dist(a, b) for a, b in zip(s, u)) < 0.05 for u in unique):
            unique.append(s)
    return unique


def bezier(p0, c1, c2, p3, t):
    mt = 1 - t
    return (
        mt**3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t**3 * p3.x,
        mt**3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t**3 * p3.y,
    )


def centre_line(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """The longest path through the shape's skeleton, from one end to the other (mm)."""
    res = 20  # pixels per mm
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    ox, oy = min(xs) - 1, min(ys) - 1
    w, h = int((max(xs) - ox + 1) * res) + 2, int((max(ys) - oy + 1) * res) + 2
    mask = np.zeros((h, w), dtype=bool)
    rr, cc = skdraw.polygon([(y - oy) * res for y in ys], [(x - ox) * res for x in xs], (h, w))
    mask[rr, cc] = True
    sk = morphology.skeletonize(mask)
    pts = list(zip(*np.nonzero(sk)))
    if not pts:
        return []
    nodes = set(pts)
    nb = lambda p: [(p[0] + dy, p[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (p[0] + dy, p[1] + dx) in nodes]

    def farthest(start):
        prev, dist, queue = {start: None}, {start: 0}, [start]
        for p in queue:
            for q in nb(p):
                if q not in dist:
                    dist[q] = dist[p] + 1
                    prev[q] = p
                    queue.append(q)
        end = max(dist, key=dist.get)
        return end, prev

    a, _ = farthest(pts[0])
    b, prev = farthest(a)
    path, p = [], b
    while p is not None:
        path.append(p)
        p = prev[p]
    line = np.array([((c / res) + ox, (r / res) + oy) for r, c in path])
    line = measure.approximate_polygon(line, tolerance=0.25)
    return [(float(x), float(y)) for x, y in line]


def simplify(poly: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    arr = measure.approximate_polygon(np.array(poly + [poly[0]]), tolerance=tol)
    return [(float(x), float(y)) for x, y in arr[:-1]]


# ---------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--letter", required=True)
    ap.add_argument("--code", required=True)
    ap.add_argument("--name-he", required=True)
    ap.add_argument("--name-en", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--page", type=int, default=0)
    ap.add_argument("--block", type=int, default=0, help="which block of 3 rows on the page (0 = the first)")
    args = ap.parse_args()

    doc = pymupdf.open(args.pdf)
    page = doc[args.page]
    rows = frames(page)
    block = rows[args.block * 3:args.block * 3 + 3]
    if len(block) != 3 or any(len(r["xs"]) != 6 for r in block):
        raise SystemExit(f"expected 3 rows of 5 boxes, found {[len(r['xs']) - 1 for r in block]}")

    left, top = block[0]["xs"][0], block[0]["top"]
    right, bottom = block[0]["xs"][-1], block[2]["bottom"]
    boxes = []
    for ri, row in enumerate(block):
        for ci in range(5):
            boxes.append({
                "id": ri * 5 + ci, "row": ri, "col": ci,
                "x": r1(row["xs"][ci] - left), "y": r1(row["top"] - top),
                "w": r1(row["xs"][ci + 1] - row["xs"][ci]), "h": r1(row["bottom"] - row["top"]),
            })
    box_abs = {b["id"]: (b["x"] + left, b["y"] + top, b["x"] + left + b["w"], b["y"] + top + b["h"]) for b in boxes}
    model_box = 4  # row 1, right-most: written first in Hebrew

    dots = find_dots(page, (left - 2, top - 6, right + 2, bottom + 6), block)

    def dots_in(bid: int) -> list[tuple[float, float]]:
        # A dot belongs to the box it is in, or (a descender's end) to the box just above it.
        x0, y0, x1, y1 = box_abs[bid]
        return [(x - x0, y - y0) for x, y in dots if x0 <= x <= x1 and y0 - 1 <= y <= y1 + 8 and owner(x, y) == bid]

    def owner(x: float, y: float) -> int | None:
        inside = [b for b, (x0, y0, x1, y1) in box_abs.items() if x0 <= x <= x1 and y0 <= y <= y1]
        if inside:
            return inside[0]
        below = [b for b, (x0, y0, x1, y1) in box_abs.items() if x0 <= x <= x1 and 0 < y - y1 <= 8]
        return below[0] if below else None

    shapes = model_strokes(page, box_abs[model_box])
    if not shapes:
        raise SystemExit("no model letter found in row 1")
    mx0, my0 = box_abs[model_box][0], box_abs[model_box][1]
    rel = lambda pts: [(x - mx0, y - my0) for x, y in pts]
    strokes = [rel(centre_line(s)) for s in shapes]
    outlines = [rel(simplify(s, 0.08)) for s in shapes]

    # The dots of row 1, the same in each traced box: their mean position per dot.
    traced = [sorted(dots_in(b), key=lambda p: (round(p[1] / 3), p[0])) for b in (0, 1, 2, 3)]
    n = len(traced[0])
    if n == 0 or any(len(t) != n for t in traced):
        raise SystemExit(f"row 1 boxes have different dot counts: {[len(t) for t in traced]}")
    mean = [(sum(t[i][0] for t in traced) / 4, sum(t[i][1] for t in traced) / 4) for i in range(n)]
    spread = max(math.dist(t[i], mean[i]) for t in traced for i in range(n))
    starts_row2 = {b: dots_in(b) for b in range(5, 10)}
    if any(len(v) != 1 for v in starts_row2.values()):
        raise SystemExit(f"row 2 boxes should have one dot each: {[len(v) for v in starts_row2.values()]}")
    start_mean = tuple(np.mean([v[0] for v in starts_row2.values()], axis=0))

    # Order the strokes: the one at row 2's start dot first, the others from their higher end.
    first_stroke = min(range(len(strokes)), key=lambda si: min(math.dist(strokes[si][0], start_mean), math.dist(strokes[si][-1], start_mean)))
    order = [first_stroke] + sorted((s for s in range(len(strokes)) if s != first_stroke), key=lambda s: min(strokes[s][0][1], strokes[s][-1][1]))
    ordered_strokes = []
    for k, si in enumerate(order):
        s = strokes[si]
        if k == 0:
            forward = math.dist(s[0], start_mean) <= math.dist(s[-1], start_mean)
        else:
            forward = s[0][1] <= s[-1][1]  # start at the higher end
        ordered_strokes.append(s if forward else s[::-1])
    # Every dot of row 1 in writing order: each is placed on the stroke it lies on (an end, or a point
    # along it such as a corner), at its distance along that stroke.
    def along(stroke, p):
        best, run, at = None, 0.0, 0.0
        for a, b in zip(stroke, stroke[1:]):
            seg = math.dist(a, b) or 1e-9
            t = max(0.0, min(1.0, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / seg**2))
            q = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
            d = math.dist(p, q)
            if best is None or d < best:
                best, at = d, run + t * seg
            run += seg
        # An end dot sits beyond the centre line's end; keep it at the very start or end.
        if math.dist(p, stroke[0]) < 4.0 and math.dist(p, stroke[0]) <= best + 3.0:
            at = min(at, 0.0) - 1e-3
        if math.dist(p, stroke[-1]) < 4.0 and math.dist(p, stroke[-1]) <= best + 3.0:
            at = max(at, run) + 1e-3
        return best, at

    # Stroke ends first (one dot per end, nearest first): a start dot can also lie on another
    # stroke's line, as on ת, where the arch starts right next to the left leg.
    placed, unmatched, taken = [], [], set()
    ends = [(math.dist(m, s[e]), i, k, e) for i, m in enumerate(mean) for k, s in enumerate(ordered_strokes) for e in (0, -1)]
    for d, i, k, e in sorted(ends):
        if d <= 3.5 and i not in {p[2] for p in placed} and (k, e) not in taken:
            taken.add((k, e))
            placed.append((k, -1e-3 if e == 0 else 1e9, i))
    for i, m in enumerate(mean):
        if i in {p[2] for p in placed}:
            continue
        (dist, at), k = min(((along(s, m), k) for k, s in enumerate(ordered_strokes)), key=lambda c: c[0][0])
        if dist <= 4.0:
            placed.append((k, at, i))
        else:
            unmatched.append(i)
    dot_seq = [i for _, _, i in sorted(placed)]

    def dot_list(points: list[tuple[float, float]]) -> list[dict]:
        out = []
        for k, (x, y) in enumerate(points):
            role = "START" if k == 0 else "END" if k == len(points) - 1 else "TARGET"
            out.append({"id": str(k + 1), "x": r1(x), "y": r1(y), "diameter_mm": 2.0, "role": role})
        return out

    letters = []
    for b in boxes:
        bid = b["id"]
        if b["row"] == 0:
            pts = mean if bid == model_box else traced[bid]
            seq = [pts[i] for i in dot_seq]
            cell = {"box_id": bid, "row_type": "TRACE_MODEL", "letter": args.letter, "dots": dot_list(seq)}
        elif b["row"] == 1:
            cell = {"box_id": bid, "row_type": "START_DOT", "letter": args.letter, "dots": dot_list(starts_row2[bid])}
        else:
            cell = {"box_id": bid, "row_type": "FREEHAND", "letter": args.letter, "dots": []}
        cell["model_path"] = [[r1(x), r1(y)] for s in ordered_strokes for x, y in s]
        cell["model_strokes"] = [[[r1(x), r1(y)] for x, y in s] for s in ordered_strokes]
        cell["show_model"] = bid == model_box
        cell["allow_internal_lifts"] = len(ordered_strokes) > 1
        letters.append(cell)
    # The outline is drawn only where the model is shown.
    for c in letters:
        c["model_outline"] = [[[r1(x), r1(y)] for x, y in o] for o in outlines] if c["show_model"] else []

    ids = [str(k + 1) for k in range(len(dot_seq))]
    weight = [100 // len(ids)] * len(ids)
    weight[0] += 100 - sum(weight)
    fill_order = [b["id"] for b in sorted(boxes, key=lambda b: (b["row"], -b["col"]))]
    geometry = {
        "schema_version": 1, "canvas_type": "INTERVENTION_SHEET", "units": "mm",
        "size": {"width": r1(right - left), "height": r1(bottom - top)},
        "boxes": boxes, "box_frame": {"style": "SOLID", "weight_mm": 0.3, "color": "#000000"},
        "dots": [], "lines": [], "letters": letters, "background": None,
    }
    profile = {
        "dot_order": ids,
        "dots": {i: {"radius_mm": 3.5, "weight_pct": w, "required": False} for i, w in zip(ids, weight)},
        "expected_pen_lifts_per_block": 15 * len(ordered_strokes),
        "fill_order": fill_order,
        "normal_speed_mm_s": None,
        "speed_flex_pct": 10,
    }
    report = {
        "source": Path(args.pdf).name, "page": args.page + 1, "block": args.block + 1,
        "strokes": len(ordered_strokes), "row1_dots": n, "row1_dot_spread_mm": r1(spread),
        "dot_to_model_mm": [r1(min(along(s, mean[i])[0] for s in ordered_strokes)) for i in dot_seq],
        "dot_on_stroke": [k + 1 for k, _, _ in sorted(placed)],
        "unmatched_row1_dots": unmatched,
        "row2_start_vs_dot1_mm": r1(math.dist(start_mean, mean[dot_seq[0]])) if dot_seq else None,
    }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    data = {"code": args.code, "letter": args.letter, "name_he": args.name_he, "name_en": args.name_en, "geometry": geometry, "profile": profile, "extraction": report}
    io.open(out / f"{args.code}.json", "w", encoding="utf-8").write(json.dumps(data, ensure_ascii=False, indent=1))
    check_image(page, (left, top, right, bottom), geometry, out / f"{args.code}_check.png")
    print(json.dumps(report))


def check_image(page, area, geometry, path) -> None:
    """The sheet with the extracted boxes (green), dots (red, numbered) and centre lines (orange) on top."""
    x0, y0, x1, y1 = area
    res = 12
    pix = page.get_pixmap(dpi=int(res * 25.4), clip=pymupdf.Rect((x0 - 3) / PT, (y0 - 3) / PT, (x1 + 3) / PT, (y1 + 10) / PT))
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    dr = ImageDraw.Draw(im)
    P = lambda x, y: ((x + 3) * res, (y + 3) * res)
    boxes = {b["id"]: b for b in geometry["boxes"]}
    for b in geometry["boxes"]:
        dr.rectangle([P(b["x"], b["y"]), P(b["x"] + b["w"], b["y"] + b["h"])], outline=(0, 160, 0), width=1)
    for c in geometry["letters"]:
        b = boxes[c["box_id"]]
        for s in c["model_strokes"] if c["row_type"] != "FREEHAND" else []:
            dr.line([P(b["x"] + x, b["y"] + y) for x, y in s], fill=(255, 140, 0), width=2)
        for d in c["dots"]:
            cx, cy = P(b["x"] + d["x"], b["y"] + d["y"])
            dr.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=(220, 0, 0), width=2)
            dr.text((cx + 5, cy - 12), d["id"], fill=(220, 0, 0))
    im.save(path)


if __name__ == "__main__":
    main()
