"""Local preview server for the graphics studio (no caching).
Usage: python3 tools/serve.py [port]   then open http://localhost:8000/graphics/
"""
import http.server, sys, os, functools, re, urllib.request, urllib.parse
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAME = re.compile(r'^w?hun_\d{3,8}$')
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # /live?game=whun_135563&kind=full|last : relay of the public MKOSZ live boxscore feed (the feed server sends no CORS header,
        # so the studio cannot read it directly; this machine's own connection is accepted by it). Only that one URL shape is fetched.
        u = urllib.parse.urlparse(self.path)
        if u.path != '/live': return super().do_GET()
        q = urllib.parse.parse_qs(u.query); game = (q.get('game') or [''])[0]; kind = (q.get('kind') or ['full'])[0]
        if not GAME.match(game) or kind not in ('full', 'last'):
            return self._reply(400, b'bad request')
        try:
            req = urllib.request.Request(f'https://netcasting4.webpont.com/storage/{kind}{game}.html', headers={'User-Agent': 'kosarlabda-kozvetito-live-relay'})
            with urllib.request.urlopen(req, timeout=10) as r:
                self._reply(200, r.read(3_000_000))
        except Exception as e:
            self._reply(502, f'upstream unreachable: {e}'.encode('utf-8', 'replace')[:300])
    def _reply(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
H.extensions_map.update({'.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.js': 'text/javascript', '.mjs': 'text/javascript', '.otf': 'font/otf'})
print(f'Grafika Stúdió: http://localhost:{port}/graphics/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
