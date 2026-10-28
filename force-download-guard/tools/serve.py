#!/usr/bin/env python3
"""
保護サイト管理ページをブラウザ単体でも開けるように配信する簡易サーバー。

  python3 tools/serve.py [ポート]

拡張機能として読み込んでいないブラウザ（プレビュー）では chrome.* API が
使えないため、sites.js 側で localStorage に退避する standalone モードに
切り替わります。/sites.html でそのまま開けます。
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[serve] %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print("serving %s on http://0.0.0.0:%d/sites.html" % (ROOT, PORT), flush=True)
        httpd.serve_forever()
