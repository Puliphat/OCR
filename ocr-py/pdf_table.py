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


def extract_page(page):
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
        return "", "none", "normal"

    orient = _orient(best)
    tbl = _transpose(best) if orient == "transposed" else best
    return render_table(tbl), source, orient


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"engine": "pdfplumber", "pages": [], "error": "no pdf path arg"}))
        return
    path = sys.argv[1]
    import pdfplumber
    out = {"engine": "pdfplumber", "pages": []}
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            grid, source, orient = extract_page(page)
            out["pages"].append(
                {"page": i + 1, "grid": grid, "source": source, "orient": orient}
            )
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"engine": "pdfplumber", "pages": [], "error": f"{type(e).__name__}: {e}"}))
