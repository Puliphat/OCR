# OCR daemon (rapidocr 3.x, stdlib http.server) — POST /ocr {image_b64|path, hq, lang} -> {tokens[], elapse}.
# ONNX ของ tier/ภาษาที่ไม่ได้ ship มา auto-download จาก ModelScope ครั้งแรกที่ถูกเรียก.
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
from rapidocr.utils.typings import ModelType, OCRVersion, LangRec

_MT = {"mobile": ModelType.MOBILE, "server": ModelType.SERVER}
_OV = {"PP-OCRv4": OCRVersion.PPOCRV4, "PP-OCRv5": OCRVersion.PPOCRV5}


def _variant(env_prefix, mt_default, ov_default, lang=None):
    # det+rec follow the selected tier; cls stays mobile (tiny, rotation-only)
    mt = _MT.get(os.environ.get(f"COA_OCR_{env_prefix}MODEL_TYPE", mt_default).lower(), _MT[mt_default])
    ov = _OV.get(os.environ.get(f"COA_OCR_{env_prefix}VERSION", ov_default), _OV[ov_default])
    params = {
        "Det.model_type": mt, "Det.ocr_version": ov,
        "Rec.model_type": mt, "Rec.ocr_version": ov,
    }
    if lang is not None:
        params["Rec.lang_type"] = lang
    return {"params": params, "label": f"{mt.value}/{ov.value}" + (f"/{lang.value}" if lang else "")}


# 3 เครื่องอ่าน เลือกต่อ request: default ทุกหน้า · hq ตอน default อ่านเลขเพี้ยน · th ตอนใบเป็นภาษาไทย
# (dict ของ default กับ hq ไม่มีอักษรไทยเลย — ใบไทยจึงหายทั้งคอลัมน์ชื่อรายการ ไม่ใช่แค่อ่านเพี้ยน)
VARIANTS = {
    "default": _variant("", "mobile", "PP-OCRv4"),
    "hq": _variant("HQ_", "server", "PP-OCRv5"),
    "th": _variant("TH_", "mobile", "PP-OCRv5", LangRec.TH),
}

_ENGINE_FAILED = object()  # sentinel: โหลดไม่สำเร็จมาแล้ว อย่าลองซ้ำทุก request
_engines = {}
_engines_lock = threading.Lock()  # กัน race ตอน lazy-init (สอง request แรกพร้อมกัน)
# ThreadingHTTPServer keeps health-check/requests non-blocking, but engine() isn't
# guaranteed thread-safe → serialize inference with a lock.
_engine_lock = threading.Lock()


def get_engine(variant):
    eng = _engines.get(variant)
    if eng is None:
        with _engines_lock:
            eng = _engines.get(variant)  # double-check หลังได้ lock
            if eng is None:
                v = VARIANTS[variant]
                print(f"[{variant}] loading engine ({v['label']})…", flush=True)
                try:
                    eng = RapidOCR(params=v["params"])
                except Exception as e:  # noqa: BLE001
                    # จำไว้ว่าโหลดไม่ขึ้น — เครื่องออฟไลน์ที่ชุด model เก่า จะนั่งรอ download 60s ซ้ำทุกหน้า
                    _engines[variant] = _ENGINE_FAILED
                    print(f"[{variant}] ★ โหลด engine ไม่สำเร็จ: {e}", flush=True)
                    print(f"[{variant}] ★ ปิด variant นี้จนกว่า restart daemon — เช็คไฟล์ model ใน rapidocr/models", flush=True)
                    raise
                _engines[variant] = eng
                print(f"[{variant}] engine ready ({v['label']})", flush=True)
    if eng is _ENGINE_FAILED:
        raise RuntimeError(
            f"engine '{variant}' โหลดไม่สำเร็จตอน request ก่อนหน้า — เติมไฟล์ model แล้ว restart daemon"
        )
    return eng


def pick_variant(req):
    # lang มาก่อน hq — ใบไทยต้องได้ th ไม่ว่า caller จะติดธง hq มาด้วยหรือไม่ (dict hq ไม่มีไทย)
    lang = str(req.get("lang") or "").lower()
    if lang in VARIANTS and lang != "default":
        return lang
    return "hq" if req.get("hq") else "default"


# ภาพจะถูกย่อเหลือด้านยาวเท่านี้ตอน challenger retry หลังจอง memory ไม่ได้ (0 = ปิด retry)
# ค่าพังต้องไม่ทำ daemon ตายตอน start — ไม่งั้นทั้งเครื่อง OCR ไม่ได้เลยเพราะพิมพ์ env ผิดตัวเดียว
try:
    RETRY_MAX_SIDE = int(os.environ.get("COA_OCR_RETRY_MAX_SIDE", "1400"))
except ValueError:
    print("[warn] COA_OCR_RETRY_MAX_SIDE ไม่ใช่ตัวเลข — ใช้ 1400", flush=True)
    RETRY_MAX_SIDE = 1400


def resolve_image(req):
    # Prefer inline bytes so the daemon can run on a different machine than the backend
    # (LAN deploy) without the image ever touching its local disk; fall back to a
    # daemon-local path for same-machine / back-compat callers (render_and_test.py).
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


def run_ocr(img, variant="default"):
    # img = raw bytes (decoded from image_b64) or a local file path (back-compat)
    eng = get_engine(variant)
    scale = 1.0
    degraded = None
    # ★ ใช้ _engine_lock เดียวเสมอ (ทุก variant) → inference ไม่ทับซ้อน ★
    with _engine_lock:
        first_err = None
        try:
            out = eng(img)
        except Exception as e:  # noqa: BLE001
            # ★ retry เฉพาะ challenger ★ — challenger มี best เป็นพื้น อ่านแย่ลงก็แพ้ไปเฉยๆ
            #   ส่วน engine default คือแหล่งข้อมูลเดียวของหน้า ล้มแล้วต้องดังตาม OCR_DAEMON_DOWN
            if not (variant != "default" and RETRY_MAX_SIDE > 0 and is_alloc_failure(e)):
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
    res = {"tokens": toks, "elapse": elapse, "variant": variant}
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
            out = run_ocr(img, variant=pick_variant(req))
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

    def do_GET(self):  # health check — บอก variant ที่ daemon ตัวนี้รู้จัก (daemon เก่าไม่มี "th")
        data = json.dumps({"ok": True, "variants": sorted(VARIANTS)}).encode("utf-8")
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
    get_engine("default")  # โหลดตอน start — ตั้ง env ผิดต้องรู้ตั้งแต่บรรทัดแรก ไม่ใช่ตอน request แรก
    print(
        f"OCR daemon ready on {host}:{port} "
        f"(model={VARIANTS['default']['label']} loaded, cwd={os.getcwd()})",
        flush=True,
    )
    # Preload HQ engine ใน background thread — request hq แรกไม่ต้องรอ lazy-load (~5-8s)
    # แลก RAM ค้างตลอด (v5-server ~หลายร้อย MB) — ปิดกลับเป็น lazy ด้วย COA_OCR_HQ_PRELOAD=false
    if os.environ.get("COA_OCR_HQ_PRELOAD", "true").lower() != "false":
        def preload_hq():
            try:
                get_engine("hq")
            except Exception as e:  # noqa: BLE001 — preload ล้มต้องไม่ทำ daemon ตาย
                print(f"[hq] preload ล้ม: {e}", flush=True)

        threading.Thread(target=preload_hq, daemon=True).start()
    srv = ThreadingHTTPServer((host, port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("OCR daemon shutting down", flush=True)
    finally:
        srv.server_close()
