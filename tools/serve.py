"""Server for the graphics studio and the live overlays (no caching of files).
Usage: python3 tools/serve.py [port] [--host 0.0.0.0] [--token SECRET]
  then open http://localhost:8000/graphics/ (studio), /graphics/live.html (link maker for OBS), /graphics/overlay.html?... (the OBS browser source).

The one central computer of the broadcast runs this (behind a tunnel, see MANIFEST 5b): it relays the MKOSZ live feed at /live and caches it,
so any number of OBS browser sources (any number of games) cost one request per game and refresh to the feed server, not one per source.
With --token (or the LIVE_TOKEN environment variable) /live only answers requests that carry &token=SECRET: nobody else can use this machine as a relay.
"""
import http.server, sys, os, re, time, threading, gzip, json, urllib.request, urllib.parse
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mkosz_names
GAME = re.compile(r'^w?hun[a-z0-9]*_\d{3,8}$')
CACHE_TTL = {'full': 3.0, 'last': 1.5}  # seconds a fetched feed is reused (the feed itself changes about every 5 s)
STALE_OK = 60.0                         # if the feed server fails, a copy younger than this is still served (marked with X-Live-Stale)
_names = {}                             # game -> {'t': time, 'body': bytes}: the official player names from the mkosz.hu match page (10 minutes)
_cache = {}                             # (game, kind) -> {'t': time, 'body': bytes, 'gz': bytes}
_locks = {}
_glock = threading.Lock()
TOKEN = os.environ.get('LIVE_TOKEN', '')

def fetch_feed(game, kind):
    """The feed text of one game (cached; one upstream request at a time per game and kind). Returns (body, gz, stale)."""
    key = (game, kind)
    with _glock: lock = _locks.setdefault(key, threading.Lock())
    with lock:
        hit = _cache.get(key)
        if hit and time.time() - hit['t'] < CACHE_TTL[kind]: return hit['body'], hit['gz'], False
        try:
            req = urllib.request.Request(f'https://netcasting4.webpont.com/storage/{kind}{game}.html', headers={'User-Agent': 'kosarlabda-kozvetito-live-relay'})
            with urllib.request.urlopen(req, timeout=10) as r: body = r.read(3_000_000)
            _cache[key] = hit = {'t': time.time(), 'body': body, 'gz': gzip.compress(body, 4)}
            return hit['body'], hit['gz'], False
        except Exception:
            if hit and time.time() - hit['t'] < STALE_OK: return hit['body'], hit['gz'], True
            raise

def official_names(game):
    """{player number: correctly spelled name} of a game (the feed writes ő / ű as '?'), cached; a copy up to 6 hours old is served when mkosz.hu does not answer."""
    hit = _names.get(game)
    if hit and time.time() - hit['t'] < 600: return hit['body']
    try:
        body = json.dumps({'names': mkosz_names.fetch_names(game)}, ensure_ascii=False).encode('utf-8')
        _names[game] = {'t': time.time(), 'body': body}
        return body
    except Exception:
        if hit and time.time() - hit['t'] < 21600: return hit['body']
        raise

class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # /live?game=whun_135563&kind=full|last[&token=..] : relay of the public MKOSZ live boxscore feed (the feed server sends no CORS header,
        # so a browser cannot read it directly, and it refuses cloud networks; this machine's own connection is accepted). Only that one URL shape is fetched.
        u = urllib.parse.urlparse(self.path)
        if u.path == '/mkosz': return self._mkosz(u)
        if u.path != '/live': return super().do_GET()
        q = urllib.parse.parse_qs(u.query); game = (q.get('game') or [''])[0]; kind = (q.get('kind') or ['full'])[0]
        if TOKEN and (q.get('token') or [''])[0] != TOKEN: return self._reply(403, b'token missing or wrong')
        if not GAME.match(game) or kind not in CACHE_TTL: return self._reply(400, b'bad request')
        try:
            body, gz, stale = fetch_feed(game, kind)
            self._reply(200, body, gz if 'gzip' in (self.headers.get('Accept-Encoding') or '') else None, stale)
        except Exception as e:
            self._reply(502, f'upstream unreachable: {e}'.encode('utf-8', 'replace')[:300])
    def _mkosz(self, u):
        # /mkosz?game=whunu18_142813[&token=..] : the official spelling of the players' names (JSON), see tools/mkosz_names.py
        q = urllib.parse.parse_qs(u.query); game = (q.get('game') or [''])[0]
        if TOKEN and (q.get('token') or [''])[0] != TOKEN: return self._reply(403, b'token missing or wrong')
        if not GAME.match(game): return self._reply(400, b'bad request')
        try: self._reply(200, official_names(game), ctype='application/json; charset=utf-8')
        except Exception as e: self._reply(502, f'mkosz.hu unreachable: {e}'.encode('utf-8', 'replace')[:300])
    def _reply(self, code, body, gz=None, stale=False, ctype='text/plain; charset=utf-8'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        if stale: self.send_header('X-Live-Stale', '1')
        if gz is not None: self.send_header('Content-Encoding', 'gzip'); body = gz
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass

if __name__ == '__main__':
    args = sys.argv[1:]
    host = '127.0.0.1'
    if '--host' in args: i = args.index('--host'); host = args[i + 1]; del args[i:i + 2]
    if '--token' in args: i = args.index('--token'); TOKEN = args[i + 1]; del args[i:i + 2]
    port = int(args[0]) if args else 8000
    H.extensions_map.update({'.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.js': 'text/javascript', '.mjs': 'text/javascript', '.otf': 'font/otf'})
    print(f'Grafika Stúdió: http://localhost:{port}/graphics/   Élő linkek: http://localhost:{port}/graphics/live.html' + ('   (token kötelező az élő lekéréshez)' if TOKEN else ''))
    http.server.ThreadingHTTPServer((host, port), H).serve_forever()
