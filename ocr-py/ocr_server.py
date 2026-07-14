# OCR daemon — loads RapidOCR once, serves POST /ocr {path} -> {tokens[], elapse}.
# stdlib http.server only (no FastAPI/uvicorn dep). Mirrors the TS sidecar contract.
#
# rapidocr 3.x (PP-OCRv4/v5) — successor of rapidocr-onnxruntime (which capped at v3 on
# Python 3.13: every >=1.2.4 release has Requires-Python <3.13). New API:
#   engine = RapidOCR(params={...}); out = engine(path) -> RapidOCROutput(boxes,txts,scores)
# Model selected via env (no code edit for A/B):
#   COA_OCR_MODEL_TYPE = mobile (default, light) | server (heavier, ~same accuracy)
#   COA_OCR_VERSION    = PP-OCRv4 (default) | PP-OCRv5
# Server/v5 ONNX auto-download once from ModelScope into the package models/ dir.
#
# HQ fallback engine (POST {"hq": true}) — เครื่องอ่านความละเอียดสูงกว่า (default server/PP-OCRv5)
#   ★ lazy-load ★: โหลดครั้งแรกที่มี request hq=true เท่านั้น (ไฟล์สะอาดไม่เคยแตะ → ไม่กิน RAM)
#   ใช้ _engine_lock เดียวกับ default → inference ไม่รันพร้อมกัน (กัน CPU oversubscribe)
#   override: COA_OCR_HQ_MODEL_TYPE (server default) · COA_OCR_HQ_VERSION (PP-OCRv5 default)
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from rapidocr import RapidOCR
from rapidocr.utils.typings import ModelType, OCRVersion

_MT = {"mobile": ModelType.MOBILE, "server": ModelType.SERVER}
_OV = {"PP-OCRv4": OCRVersion.PPOCRV4, "PP-OCRv5": OCRVersion.PPOCRV5}
mt = _MT.get(os.environ.get("COA_OCR_MODEL_TYPE", "mobile").lower(), ModelType.MOBILE)
ov = _OV.get(os.environ.get("COA_OCR_VERSION", "PP-OCRv4"), OCRVersion.PPOCRV4)

# det+rec follow the selected tier; cls stays mobile (tiny, rotation-only)
engine = RapidOCR(params={
    "Det.model_type": mt, "Det.ocr_version": ov,
    "Rec.model_type": mt, "Rec.ocr_version": ov,
})
# ThreadingHTTPServer keeps health-check/requests non-blocking, but engine() isn't
# guaranteed thread-safe → serialize inference with a lock.
_engine_lock = threading.Lock()

# HQ engine — lazy-loaded สำหรับ scanned page ที่ default อ่าน spec/เลขเพี้ยน (เคส 4A LoI "%98"→"≤3.5%")
_hq_engine = None
_hq_lock = threading.Lock()  # กัน race ตอน lazy-init (สอง request hq พร้อมกันครั้งแรก)


def get_hq_engine():
    global _hq_engine
    if _hq_engine is None:
        with _hq_lock:
            if _hq_engine is None:  # double-check หลังได้ lock
                hmt = _MT.get(os.environ.get("COA_OCR_HQ_MODEL_TYPE", "server").lower(), ModelType.SERVER)
                hov = _OV.get(os.environ.get("COA_OCR_HQ_VERSION", "PP-OCRv5"), OCRVersion.PPOCRV5)
                print(f"[hq] lazy-loading HQ engine ({hmt.value}/{hov.value})…", flush=True)
                _hq_engine = RapidOCR(params={
                    "Det.model_type": hmt, "Det.ocr_version": hov,
                    "Rec.model_type": hmt, "Rec.ocr_version": hov,
                })
                print(f"[hq] HQ engine ready ({hmt.value}/{hov.value})", flush=True)
    return _hq_engine


def run_ocr(path, hq=False):
    # resolve absolute + existence check first — clear error (path + cwd) on miss
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(f"image not found: {path} (daemon cwd={os.getcwd()})")
    eng = get_hq_engine() if hq else engine
    # ★ ใช้ _engine_lock เดียวเสมอ (ทั้ง default + hq) → inference ไม่ทับซ้อน ★
    with _engine_lock:
        out = eng(path)
    toks = []
    if out is not None and out.boxes is not None and out.txts is not None:
        for box, text, score in zip(out.boxes, out.txts, out.scores):
            xs = [float(p[0]) for p in box]
            ys = [float(p[1]) for p in box]
            toks.append({
                "text": text,
                "score": float(score),
                "x": min(xs),
                "y": sum(ys) / 4.0,
                "y1": min(ys),
                "y2": max(ys),
                "x2": max(xs),
            })
    elapse = getattr(out, "elapse", None) if out is not None else None
    return {"tokens": toks, "elapse": elapse}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            req = json.loads(body)
            out = run_ocr(req["path"], hq=bool(req.get("hq", False)))
            code = 200
        except Exception as e:  # noqa: BLE001 — return error to caller
            out = {"error": str(e)}
            code = 500
        data = json.dumps(out).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # health check
        data = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(
        f"OCR daemon ready on 127.0.0.1:{port} "
        f"(model={mt.value}/{ov.value} loaded, cwd={os.getcwd()})",
        flush=True,
    )
    # Preload HQ engine ใน background thread — request hq แรกไม่ต้องรอ lazy-load (~5-8s)
    # แลก RAM ค้างตลอด (v5-server ~หลายร้อย MB) — ปิดกลับเป็น lazy ด้วย COA_OCR_HQ_PRELOAD=false
    # get_hq_engine มี lock + double-check อยู่แล้ว → ชนกับ request hq แรกได้ปลอดภัย
    if os.environ.get("COA_OCR_HQ_PRELOAD", "true").lower() != "false":
        threading.Thread(target=get_hq_engine, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("OCR daemon shutting down", flush=True)
    finally:
        srv.server_close()
