#!/usr/bin/env python3
"""TikZ/dvisvgm compile microservice.

POST /compile  {"source": "<latex ...>"}  ->  {"svg": "<svg ...>"}
GET  /health

Compiles with xelatex (CJK-capable) then converts the PDF to SVG with dvisvgm
(fallback: pdftocairo).  Text is kept as paths (--no-fonts) so CJK renders
without relying on the client having the font.
"""
import json
import os
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8390))


def compile_tex(source):
    with tempfile.TemporaryDirectory() as d:
        tex = os.path.join(d, "fig.tex")
        open(tex, "w").write(source)
        r = subprocess.run(["xelatex", "-interaction=nonstopmode", "-halt-on-error", "fig.tex"],
                           cwd=d, capture_output=True, text=True, timeout=120)
        pdf = os.path.join(d, "fig.pdf")
        if not os.path.exists(pdf):
            raise RuntimeError((r.stdout + r.stderr)[-1500:])
        svg = os.path.join(d, "fig.svg")
        r2 = subprocess.run(["dvisvgm", "--pdf", "--no-fonts", "--exact", "--output=" + svg, pdf],
                            capture_output=True, text=True, timeout=120)
        if not os.path.exists(svg):
            subprocess.run(["pdftocairo", "-svg", pdf, svg], check=True, timeout=120)
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
            return self._send(200, {"ok": True, "engine": "tikz"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/compile":
                return self._send(200, {"svg": compile_tex(body.get("source", ""))})
            self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"tikz compile service on :{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
