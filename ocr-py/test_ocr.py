# Quick RapidOCR test — read a COA image, group tokens into rows by y-position,
# print so we can compare number accuracy vs Tesseract (the "ค่าเพี้ยน" problem).
import sys
from rapidocr_onnxruntime import RapidOCR

img = sys.argv[1] if len(sys.argv) > 1 else r"C:\local-repo\OCR\backend\uploads\20260203_Lot240521.png"
# default det_limit_side_len=736 downscales the 2828px scan -> small table cells vanish.
# bump it + loosen box thresholds so faint numeric cells survive detection.
engine = RapidOCR(
    det_model_path="",          # required: lib bug accesses det_dict['model_path'] unconditionally
    det_limit_side_len=2560,
    det_limit_type="max",
    det_box_thresh=0.3,         # lower -> recover faint table cells
    det_thresh=0.2,
    det_unclip_ratio=1.8,
    text_score=0.3,
)
result, elapse = engine(img)

if not result:
    print("NO TEXT")
    sys.exit(0)

# each item: [box(4 pts), text, score]; box[0]=top-left
toks = []
for box, text, score in result:
    ys = [p[1] for p in box]
    xs = [p[0] for p in box]
    toks.append({"x": min(xs), "y": sum(ys) / 4, "text": text, "score": float(score)})

toks.sort(key=lambda t: t["y"])
rows = []
cur = [toks[0]]
last_y = toks[0]["y"]
for t in toks[1:]:
    if abs(t["y"] - last_y) > 14:  # new row
        rows.append(cur)
        cur = []
    cur.append(t)
    last_y = t["y"]
if cur:
    rows.append(cur)

out = []
out.append(f"tokens: {len(toks)}  rows: {len(rows)}  elapse: {elapse}")
out.append("-" * 80)
for r in rows:
    r.sort(key=lambda t: t["x"])
    line = "  |  ".join(t["text"] for t in r)
    avg_score = sum(t["score"] for t in r) / len(r)
    out.append(f"[{avg_score:.2f}] {line}")

text = "\n".join(out)
with open(r"C:\local-repo\OCR\ocr-py\_rapidocr_out.txt", "w", encoding="utf-8") as f:
    f.write(text)
# also try stdout, ignore encode errors
sys.stdout.reconfigure(errors="replace")
print(text)
