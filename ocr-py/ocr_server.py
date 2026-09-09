# OCR daemon — loads RapidOCR once, serves POST /ocr {image_b64|path, hq} -> {tokens[], elapse}.
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
import base64
import json
import gc
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import cv2
import numpy as np
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

# ภาพจะถูกย่อเหลือด้านยาวเท่านี้ตอน HQ retry หลังจอง memory ไม่ได้ (0 = ปิด retry)
# ค่าพังต้องไม่ทำ daemon ตายตอน start — ไม่งั้นทั้งเครื่อง OCR ไม่ได้เลยเพราะพิมพ์ env ผิดตัวเดียว
try:
    RETRY_MAX_SIDE = int(os.environ.get("COA_OCR_RETRY_MAX_SIDE", "1400"))
except ValueError:
    print("[warn] COA_OCR_RETRY_MAX_SIDE ไม่ใช่ตัวเลข — ใช้ 1400", flush=True)
    RETRY_MAX_SIDE = 1400

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


def resolve_image(req):
    # Prefer inline bytes → daemon can run on a different machine than the backend
    # (LAN deploy): the image never has to exist on this daemon's local disk.
    # Fall back to a daemon-local path for same-machine / back-compat callers
    # (render_and_test.py still POSTs {"path": ...}).
    b64 = req.get("image_b64")
    if b64:
        return base64.b64decode(b64)  # RapidOCR 3.x LoadImage accepts raw bytes
    path = os.path.abspath(req["path"])
    if not os.path.exists(path):
        raise FileNotFoundError(f"image not found: {path} (daemon cwd={os.getcwd()})")
    return path


def to_array(img):
    # rapidocr รับ bytes/path ตรงๆ ได้ แต่ retry ต้องย่อภาพเอง → ต้องได้ ndarray ก่อน
    if isinstance(img, (bytes, bytearray)):
        return cv2.imdecode(np.frombuffer(img, np.uint8), cv2.IMREAD_COLOR)
    return cv2.imread(img)


def shrink(arr, max_side):
    # คืน (ภาพย่อ, ตัวคูณกลับ) — คูณกลับเพื่อให้ box ที่ส่งออกอยู่ในพิกัดภาพเดิมเสมอ
    # INTER_AREA = เฉลี่ยพื้นที่ ไม่ใช่สุ่มจุด — ย่อครึ่งแล้วเส้นตัวเลขบางไม่แหว่งจนอ่านเป็นเลขอื่น
    h, w = arr.shape[:2]
    if max(h, w) <= max_side:
        return None, 1.0
    r = max_side / max(h, w)
    small = cv2.resize(arr, (max(1, int(w * r)), max(1, int(h * r))), interpolation=cv2.INTER_AREA)
    return small, 1.0 / r


def is_alloc_failure(e):
    # ORT ห่อ std::bad_alloc ไว้หลาย wrapper (FAIL ตอนโหลด, RUNTIME_EXCEPTION ตอนรัน) → ดูที่ข้อความ
    if isinstance(e, MemoryError):
        return True
    s = str(e).lower()
    return "bad allocation" in s or "out of memory" in s or "failed to allocate" in s


def run_ocr(img, hq=False):
    # img = raw bytes (decoded from image_b64) or a local file path (back-compat)
    eng = get_hq_engine() if hq else engine
    scale = 1.0
    degraded = None
    # ★ ใช้ _engine_lock เดียวเสมอ (ทั้ง default + hq) → inference ไม่ทับซ้อน ★
    with _engine_lock:
        first_err = None
        try:
            out = eng(img)
        except Exception as e:  # noqa: BLE001
            # ★ retry เฉพาะ hq ★ — HQ เป็น challenger ที่มี best เป็นพื้น อ่านแย่ลงก็แพ้ไปเฉยๆ
            #   ส่วน engine default คือแหล่งข้อมูลเดียวของหน้า ล้มแล้วต้องดังตาม OCR_DAEMON_DOWN
            if not (hq and RETRY_MAX_SIDE > 0 and is_alloc_failure(e)):
                raise
            first_err = str(e).strip().splitlines()[-1][:200]
        if first_err is not None:
            # ออกนอก except ก่อนค่อยยิงใหม่ — traceback ค้างอยู่จะพา tensor ของรอบที่ล้มไว้ทั้งชุด
            arr = to_array(img)
            small, scale = shrink(arr, RETRY_MAX_SIDE) if arr is not None else (None, 1.0)
            del arr
            if small is None:
                raise RuntimeError(first_err)
            print(f"[retry] OCR ล้ม ({first_err}) → ลองใหม่ที่ {small.shape[1]}x{small.shape[0]}", flush=True)
            gc.collect()
            try:
                out = eng(small)
            except Exception as e2:  # noqa: BLE001
                raise RuntimeError(f"{first_err} (retry ที่ {RETRY_MAX_SIDE}px ก็ล้ม: {e2})") from e2
            degraded = {"max_side": RETRY_MAX_SIDE, "reason": first_err}
    toks = []
    if out is not None and out.boxes is not None and out.txts is not None:
        for box, text, score in zip(out.boxes, out.txts, out.scores):
            xs = [float(p[0]) * scale for p in box]
            ys = [float(p[1]) * scale for p in box]
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
    res = {"tokens": toks, "elapse": elapse}
    if degraded:
        res["degraded"] = degraded
    return res


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        try:
            req = json.loads(body)
            img = resolve_image(req)
            out = run_ocr(img, hq=bool(req.get("hq", False)))
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
    # 0.0.0.0 = รับ request จากเครื่องอื่นใน LAN (deploy หน้างาน); ตั้ง OCR_BIND_HOST=127.0.0.1 ถ้าจะปิดเฉพาะเครื่อง
    host = os.environ.get("OCR_BIND_HOST", "0.0.0.0")
    print(
        f"OCR daemon ready on {host}:{port} "
        f"(model={mt.value}/{ov.value} loaded, cwd={os.getcwd()})",
        flush=True,
    )
    # Preload HQ engine ใน background thread — request hq แรกไม่ต้องรอ lazy-load (~5-8s)
    # แลก RAM ค้างตลอด (v5-server ~หลายร้อย MB) — ปิดกลับเป็น lazy ด้วย COA_OCR_HQ_PRELOAD=false
    # get_hq_engine มี lock + double-check อยู่แล้ว → ชนกับ request hq แรกได้ปลอดภัย
    if os.environ.get("COA_OCR_HQ_PRELOAD", "true").lower() != "false":
        threading.Thread(target=get_hq_engine, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("OCR daemon shutting down", flush=True)
    finally:
        srv.server_close()
