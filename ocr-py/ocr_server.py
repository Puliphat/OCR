# OCR daemon — loads RapidOCR once, serves POST /ocr {path} -> {tokens[], elapse}.
# stdlib http.server only (no FastAPI/uvicorn dep). Mirrors the future TS sidecar contract.
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from rapidocr_onnxruntime import RapidOCR

# default settings — cleaner on COA scans than aggressive low-threshold tuning
engine = RapidOCR()


def run_ocr(path):
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
    print(f"OCR daemon ready on 127.0.0.1:{port} (model loaded)", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
