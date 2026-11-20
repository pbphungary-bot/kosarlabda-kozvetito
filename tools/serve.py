"""Local preview server for the graphics studio (no caching).
Usage: python3 tools/serve.py [port]   then open http://localhost:8000/graphics/
"""
import http.server, sys, os, functools
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
H.extensions_map.update({'.js': 'text/javascript', '.mjs': 'text/javascript', '.otf': 'font/otf'})
print(f'Grafika Stúdió: http://localhost:{port}/graphics/')
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
