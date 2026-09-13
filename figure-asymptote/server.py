#!/usr/bin/env python3
"""Asymptote compile microservice (Tier 3).

POST /compile  {"source": "<asy ...>"}  ->  {"svg": "<svg ...>"}
GET  /health
"""
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8391))


def compile_asy(source):
    with tempfile.TemporaryDirectory() as d:
        asy = os.path.join(d, "fig.asy")
        open(asy, "w").write(source)
        r = subprocess.run(["asy", "-f", "svg", "-o", "fig", "fig.asy"],
                           cwd=d, capture_output=True, text=True, timeout=120)
        svg = os.path.join(d, "fig.svg")
        if not os.path.exists(svg):
            raise RuntimeError((r.stdout + r.stderr)[-1500:])
        return open(svg).read()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "engine": "asymptote"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/compile":
                return self._send(200, {"svg": compile_asy(body.get("source", ""))})
            self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"asymptote compile service on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
