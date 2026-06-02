# Standalone test: render the 8 scanned (OCR-FALLBACK) COA PDFs -> PNG (PyMuPDF @300dpi),
# send each to the OCR daemon, group tokens into rows, dump per-doc text for accuracy review.
import json
import os
import sys
import urllib.request

import fitz  # PyMuPDF

SCANNED = [
    "20260203_Lot240521.pdf",
    "20260323_ZP10_Lot.2026021327.pdf",
    "20260409_RI-015_Lot_EC250306801.pdf",
    "20260420_PR1950W_Lot_4063-01_4063-02.pdf",
    "20260507_SODA___ASH_Lot_60223.pdf",
    "20260513_D-2072.pdf",
    "20260514_1F1710_Lot_26011A.pdf",
    "20260514_4A_Lot_34002411172.pdf",
]
UPLOADS = r"C:\local-repo\OCR\backend\uploads"
OUTDIR = r"C:\local-repo\OCR\ocr-py\_scan_test"
PORT = 8765
os.makedirs(OUTDIR, exist_ok=True)


def render(pdf, dpi=300):
    doc = fitz.open(pdf)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pngs = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        out = os.path.join(OUTDIR, f"{os.path.basename(pdf)}.p{i}.png")
        pix.save(out)
        pngs.append(out)
    doc.close()
    return pngs


def ocr(path):
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/ocr",
        data=json.dumps({"path": path}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n else 0


def group_rows(toks):
    if not toks:
        return []
    heights = [t["y2"] - t["y1"] for t in toks if t["y2"] > t["y1"]]
    gap = max(8.0, 0.6 * median(heights)) if heights else 14.0
    toks = sorted(toks, key=lambda t: t["y"])
    rows, cur, last = [], [toks[0]], toks[0]["y"]
    for t in toks[1:]:
        if abs(t["y"] - last) > gap:
            rows.append(cur)
            cur = []
        cur.append(t)
        last = t["y"]
    if cur:
        rows.append(cur)
    return rows


def main():
    summary = []
    for name in SCANNED:
        pdf = os.path.join(UPLOADS, name)
        lines = [f"### {name}"]
        total_tokens = 0
        for png in render(pdf):
            res = ocr(png)
            if "error" in res:
                lines.append(f"  {os.path.basename(png)} ERROR: {res['error']}")
                continue
            toks = res["tokens"]
            total_tokens += len(toks)
            rows = group_rows(toks)
            lines.append(f"  {os.path.basename(png)}  tokens={len(toks)} rows={len(rows)} elapse={res.get('elapse')}")
            for r in rows:
                r.sort(key=lambda t: t["x"])
                line = "  |  ".join(t["text"] for t in r)
                avg = sum(t["score"] for t in r) / len(r)
                lines.append(f"    [{avg:.2f}] {line}")
        text = "\n".join(lines)
        with open(os.path.join(OUTDIR, name + ".txt"), "w", encoding="utf-8") as f:
            f.write(text)
        summary.append(f"{name}: tokens={total_tokens}")
        print(f"done: {name}  tokens={total_tokens}", flush=True)
    with open(os.path.join(OUTDIR, "_SUMMARY.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(summary))


if __name__ == "__main__":
    main()
