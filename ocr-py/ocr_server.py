# OCR daemon — loads RapidOCR once, serves POST /ocr {path} -> {tokens[], elapse}.
# stdlib http.server only (no FastAPI/uvicorn dep). Mirrors the future TS sidecar contract.
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from rapidocr_onnxruntime import RapidOCR

# default settings — cleaner on COA scans than aggressive low-threshold tuning
engine = RapidOCR()
# ThreadingHTTPServer ทำให้ health-check/หลาย request ไม่ block กัน แต่ตัว engine() ไม่การันตี thread-safe
# → serialize เฉพาะ inference ด้วย lock (ได้ความ responsive ของ threading โดยไม่เสี่ยง state ชน)
_engine_lock = threading.Lock()


def run_ocr(path):
    # resolve เป็น absolute + เช็คมีจริง ก่อนยิงเข้า engine — error message บอก path+cwd ชัด
    # (เคสเคยพลาด: client ส่ง relative path, daemon cwd ผิด → RapidOCR throw แบบ cryptic)
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise FileNotFoundError(f"image not found: {path} (daemon cwd={os.getcwd()})")
    with _engine_lock:
        result, elapse = engine(path)
    toks = []
    if result:
        for box, text, score in result:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            toks.append({
                "text": text,
                "score": float(score),
                "x": float(min(xs)),
                "y": float(sum(ys) / 4.0),
                "y1": float(min(ys)),
                "y2": float(max(ys)),
                "x2": float(max(xs)),
            })
    return {"tokens": toks, "elapse": list(elapse) if elapse else None}


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
        f"OCR daemon ready on 127.0.0.1:{port} (model loaded, cwd={os.getcwd()})",
        flush=True,
    )
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("OCR daemon shutting down", flush=True)
    finally:
        srv.server_close()
