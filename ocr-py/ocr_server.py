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


def run_ocr(path):
    # resolve absolute + existence check first — clear error (path + cwd) on miss
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(f"image not found: {path} (daemon cwd={os.getcwd()})")
    with _engine_lock:
        out = engine(path)
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
            out = run_ocr(req["path"])
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
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("OCR daemon shutting down", flush=True)
    finally:
        srv.server_close()
