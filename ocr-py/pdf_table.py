"""pdf_table.py — structural table extraction for text-layer COA PDFs (pdfplumber, NO torch).

Why: the pipeline's flatten step destroys column geometry, so the LLM can't tell specMin vs
specMax vs result — worst on transposed COAs (items as columns). pdfplumber lines-strategy
recovers the TRUE 2D cell-grid from the PDF's ruling lines (or a text-alignment fallback),
giving the LLM column-correct input. Deterministic, utf-8, stdlib-light.

Orientation normalization: some COAs lay items out as COLUMNS with spec/result as rows
(e.g. Suzorite: Sieve fractions across the top, the single LOT result row at the bottom).
The LLM reads such a grid spec/result-swapped. We detect that layout (measured numbers run
HORIZONTALLY in one result strip instead of DOWN a result column) and transpose so each item
becomes one row [name | method | unit | spec | spec | result]. Anti-regression is unaffected:
the caller keeps this grid only when it strictly dominates the flat PASS set (keep-best), so a
mis-detected transpose is silently discarded, never shipped.

Usage:  python pdf_table.py <pdf_path>
Output (stdout, JSON):
  {"engine":"pdfplumber","pages":[{"page":1,"grid":"<row|row...>","source":"lines"|"text"|"none","orient":"normal"|"transposed"}]}
  On error: {"engine":"pdfplumber","pages":[],"error":"<msg>"}

`grid` renders the recovered table as rows (newline-joined); cells within a row joined by " | ".
Empty cells are KEPT as "" so column positions (and the transposed structure) survive.
"""
import sys
import json
import re

# fix Windows cp1252 console death on CJK/〜/（） before any output
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# a cell that is a PURE measured value — a result or a single-sided numeric spec.
# accepts an optional comparator (< > ＜ ＞) and a trailing % ; rejects composite/range
# cells like "-100/ÿ", "11.0ÿ^16.0", "Max 1", "+100" — those are NOT lone measurements,
# so they don't inflate the orientation signal.
NUM_RE = re.compile(r"^[<>＜＞]?\s*\d+(?:[.,]\d+)?\s*%?$")


def _is_num(c):
    return bool(NUM_RE.match((c or "").strip()))


def render_table(tbl):
    """Render a pdfplumber table (list of rows of cells) to grid text.
    Keep empty cells to preserve column alignment; drop fully-empty rows."""
    lines = []
    for row in tbl:
        cells = [(c or "").replace("\n", " ").strip() for c in row]
        if not any(cells):
            continue
        lines.append(" | ".join(cells))
    return "\n".join(lines)


def _score(tbl):
    """Non-empty cell count — proxy for 'this is the real data table', not a stray box."""
    return sum(1 for r in tbl for c in r if c and c.strip())


def _pad(tbl):
    """Pad every row to the max column count so transpose/zip is rectangular."""
    maxc = max((len(r) for r in tbl), default=0)
    return [list(r) + [""] * (maxc - len(r)) for r in tbl]


def _transpose(tbl):
    """Swap rows<->columns. After transpose each original column (= one COA item) is a row."""
    return [list(col) for col in zip(*_pad(tbl))]


def _orient(tbl):
    """Decide 'normal' (items=rows) vs 'transposed' (items=columns).

    A COA carries one measured result per item. In a NORMAL layout those results land DOWN a
    single column (one per item-row); in a TRANSPOSED layout they land ACROSS a single row
    (one per item-column). So compare the densest result-ROW vs the densest result-COLUMN:
    transposed only when a horizontal strip of pure numbers clearly out-counts any column.

    The `col_max + 2` margin keeps small normal tables safe: a normal table's result column
    grows with item count, so a real items-as-rows table almost always has col_max >= row_max.
    Mis-detection here is harmless anyway — keep-best in the caller discards a non-dominating
    grid — but the margin avoids wasting an LLM call on a misfire."""
    if not tbl:
        return "normal"
    padded = _pad(tbl)
    nrow = len(padded)
    ncol = len(padded[0]) if padded else 0
    if nrow < 2 or ncol < 2:
        return "normal"
    row_max = max((sum(1 for c in r if _is_num(c)) for r in padded), default=0)
    col_max = max((sum(1 for r in padded if _is_num(r[j])) for j in range(ncol)), default=0)
    if row_max >= 3 and row_max >= col_max + 2:
        return "transposed"
    return "normal"


def _best(tabs, min_score):
    best, best_score = None, 0
    for t in tabs:
        s = _score(t)
        if s > best_score:
            best, best_score = t, s
    return best if (best is not None and best_score >= min_score) else None


def _explode_collapsed_rows(tbl):
    """grid ที่มีเส้นคอลัมน์แต่ไม่มีเส้นแบ่งแถว → ทุก item ยุบเป็น row เดียว cell stack ค่าด้วย '\n' (เคส Z99)
    แตกกลับเป็น target rows ตาม line-count · cell 1 บรรทัด = broadcast เป็น section label · keep-best กัน regression"""
    out = []
    for row in tbl:
        counts = [((c.count("\n") + 1) if (c and c.strip()) else 0) for c in row]
        target = max(counts) if counts else 0
        at_target = sum(1 for n in counts if n == target)
        if not (target >= 3 and at_target >= 2 and all(n in (0, 1, target) for n in counts)):
            out.append(row)
            continue
        cols = []
        for c, n in zip(row, counts):
            if n == target:
                cols.append([s.strip() for s in (c or "").split("\n")])
            elif n == 1:
                cols.append([(c or "").strip()] * target)  # broadcast เป็น section/merged label
            else:
                cols.append([""] * target)
        for i in range(target):
            out.append([col[i] for col in cols])
    return out


def _merge_slivers(edges, min_col_width):
    """Remove edges that would create a column narrower than min_col_width.
    Repeated until stable (slivers can chain)."""
    merged = list(edges)
    changed = True
    while changed:
        changed = False
        i = 1
        while i < len(merged):
            if merged[i] - merged[i - 1] < min_col_width:
                merged.pop(i)
                changed = True
            else:
                i += 1
    return merged


def _scanned_vector_geom(page):
    """Try to extract column geometry from vector ruling lines (for scanned PDFs with no text chars).
    Returns (geom_dict) or None if not applicable.
    geom_dict keys: col_edges_pt, page_width, page_height, page_rotation, table_bbox, source="vector-geom"
    """
    # Only for pages with very few chars but vector geometry (ruling lines)
    if len(page.chars) >= 80:
        return None
    if len(page.rects) + len(page.curves) < 20:
        return None

    tables = page.find_tables({
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
    })
    if not tables:
        return None

    # Pick table with most cells
    tbl = max(tables, key=lambda t: len([c for c in t.cells if c is not None]))
    raw_rows = tbl.extract()
    if not raw_rows or not raw_rows[0] or len(raw_rows[0]) < 3:
        return None

    # Derive column edges from cell bounding boxes
    # cells is a list of (x0, top, x1, bottom) tuples; None for merged cells
    x_set = set()
    for cell in tbl.cells:
        if cell is not None:
            x_set.add(round(float(cell[0]), 2))
            x_set.add(round(float(cell[2]), 2))
    if len(x_set) < 4:  # need at least 3 columns = 4 edges
        return None
    x_edges = sorted(x_set)

    page_width = float(page.width)
    min_col_w = page_width * 0.04
    merged = _merge_slivers(x_edges, min_col_w)
    if len(merged) < 4:  # still need >=3 columns after merge
        return None

    bbox = tbl.bbox  # (x0, top, x1, bottom)
    return {
        "col_edges_pt": merged,
        "page_width": page_width,
        "page_height": float(page.height),
        "page_rotation": int(page.rotation or 0),
        "table_bbox": [round(float(v), 2) for v in bbox],
        "source": "vector-geom",
    }


def extract_page(page):
    # 0) scanned-vector geometry — for scanned PDFs with vector ruling lines but no text chars
    #    Returns geometry only (col edges in PDF points); text is filled later by RapidOCR tokens on TS side
    geom = _scanned_vector_geom(page)
    if geom is not None:
        return "", "vector-geom", "normal", geom

    # 1) lines-strategy — true ruling-line cell grid (best for bordered COA tables)
    best = _best(page.extract_tables({
        "vertical_strategy": "lines",
        "horizontal_strategy": "lines",
    }), 4)
    source = "lines"
    if best is None:
        # 2) text-strategy fallback — alignment-based, no ruling lines needed
        best = _best(page.extract_tables({
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "snap_tolerance": 4,
            "join_tolerance": 4,
        }), 6)
        source = "text"
    if best is None:
        return "", "none", "normal", None

    # แตก grid ที่มีแต่เส้นคอลัมน์ ทำทุก item ยุบเป็น stacked row เดียว (Z99)
    best = _explode_collapsed_rows(best)
    orient = _orient(best)
    tbl = _transpose(best) if orient == "transposed" else best
    return render_table(tbl), source, orient, None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"engine": "pdfplumber", "pages": [], "error": "no pdf path arg"}))
        return
    path = sys.argv[1]
    import pdfplumber
    out = {"engine": "pdfplumber", "pages": []}
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            grid, source, orient, geom = extract_page(page)
            page_entry = {"page": i + 1, "grid": grid, "source": source, "orient": orient}
            if geom is not None:
                page_entry.update(geom)
            out["pages"].append(page_entry)
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"engine": "pdfplumber", "pages": [], "error": f"{type(e).__name__}: {e}"}))
