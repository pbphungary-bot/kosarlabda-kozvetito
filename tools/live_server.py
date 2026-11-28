"""One command for the central computer of the broadcast: starts the studio / relay server AND a public tunnel, prints the links.

    python3 tools/live_server.py                      # quick tunnel: free, no account, but the public address is NEW at every start
    python3 tools/live_server.py --tunnel-token XYZ --public-url https://live.pelda.hu   # your own fixed address (Cloudflare account + domain); typed once, remembered in .live-server.json
    python3 tools/live_server.py --no-tunnel          # only the local server (same network)

The access key (token) is generated once and kept in .live-server.json (not committed), so links made earlier keep working after a restart.
The tunnel is `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/): the laptops need nothing installed.
"""
import argparse, json, os, re, secrets, shutil, subprocess, sys, threading, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, '.live-server.json')

def load_state():
    try: return json.load(open(STATE, encoding='utf-8'))
    except Exception: return {}

def save_state(st):
    try: json.dump(st, open(STATE, 'w', encoding='utf-8'))
    except Exception: pass

def load_token(given):
    st = load_state()
    token = given or st.get('token') or secrets.token_urlsafe(9)
    if st.get('token') != token: st['token'] = token; save_state(st)
    return token

def remember_tunnel(tunnel_token, public_url):
    """A fixed Cloudflare address is typed once: it is kept in the same private file as the access key (not committed), later starts need no options."""
    st = load_state()
    if tunnel_token: st['tunnel_token'] = tunnel_token
    if public_url: st['public_url'] = public_url.rstrip('/')
    save_state(st)
    return st.get('tunnel_token', ''), st.get('public_url', '')

def update_repo():
    """If this folder is a git clone (not an unzipped download), fetch the newest version before starting; a failure never stops the server."""
    if not os.path.isdir(os.path.join(ROOT, '.git')) or not shutil.which('git'):
        print('Frissítés: kihagyva (a mappa nem git-másolat; lásd a leírást a git telepítéséhez).'); return
    try:
        r = subprocess.run(['git', 'pull', '--ff-only'], cwd=ROOT, capture_output=True, text=True, timeout=90)
        print('Frissítés (git pull):', (r.stdout.strip() or r.stderr.strip() or 'kész').splitlines()[-1])
    except Exception as e:
        print('Frissítés nem sikerült, a meglévő változattal indulok:', e)

LOG = os.path.join(ROOT, '.live-server.log')  # private, not committed: what happened and when (a crash leaves its reason here)

def log(msg):
    line = time.strftime('%Y-%m-%d %H:%M:%S ') + msg
    print(line, flush=True)
    try:
        with open(LOG, 'a', encoding='utf-8') as f: f.write(line + '\n')
    except Exception: pass

class Child:
    """One supervised process (the server, the named tunnel): when it stops it is started again (3 s later; the waits grow to 60 s if it keeps dying right after a start),
    and every stop is logged with its exit code, so a broadcast does not end with a silent crash."""
    def __init__(self, name, argv, now=time.time, **popen_kw):
        self.name, self.argv, self.kw, self.now = name, argv, popen_kw, now
        self.p, self.started, self.fails, self.restart_at, self.restarts = None, 0, 0, None, 0
    def start(self):
        self.p = subprocess.Popen(self.argv, **self.kw); self.started = self.now(); self.restart_at = None
    def alive(self): return self.p is not None and self.p.poll() is None
    def check(self):
        """Call about once a second: notices a stop, schedules and performs the restart. Returns True when it (re)started now."""
        if self.alive(): return False
        t = self.now()
        if self.restart_at is None:
            self.fails = self.fails + 1 if t - self.started < 20 else 1  # died right after a start: wait longer each time
            delay = min(60, 3 * 2 ** (self.fails - 1))
            self.restart_at = t + delay
            log(f'FIGYELEM: {self.name} leállt (kilépési kód: {self.p.returncode if self.p else "?"}); újraindítom {delay} mp múlva.')
        if t >= self.restart_at:
            self.start(); self.restarts += 1
            log(f'{self.name} újraindítva ({self.restarts}. alkalom).')
            return True
        return False

def show(base, token):
    print('\n' + '=' * 70)
    print(' KÉSZ. Közvetítők, ezen az oldalon vezérlitek az élő grafikákat (egy meccs = egy állandó link az OBS-hez):')
    print(f'\n   {base}/graphics/live.html?token={token}\n')
    print(' A meccs linkjét egyszer kell az OBS-ben Böngésző forrásként felvenni (1920×1080); utána csak az oldalon kattintjátok ki, melyik grafika legyen adásban.')
    print(' Leállítás: Ctrl+C. Ne add ki a linket kívülállónak (a kulcs azt védi, hogy mások ne használják a gépet).')
    print('=' * 70 + '\n', flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--token', default=os.environ.get('LIVE_TOKEN', ''))
    ap.add_argument('--no-tunnel', action='store_true')
    ap.add_argument('--no-update', action='store_true', help='do not run git pull before starting')
    ap.add_argument('--tunnel-token', default='', help='token of a named Cloudflare tunnel (fixed address); remembered after the first start')
    ap.add_argument('--public-url', default='', help='the fixed address of the named tunnel, e.g. https://live.livegolf.eu; remembered after the first start')
    a = ap.parse_args()
    if not a.no_update: update_repo()
    token = load_token(a.token)
    a.tunnel_token, a.public_url = remember_tunnel(a.tunnel_token, a.public_url)  # given now, or remembered from an earlier start
    server = Child('a szerver', [sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(a.port), '--token', token]); server.start()
    kept = [server]   # restarted when they stop
    procs = []        # the quick tunnel: its address changes with every start, so when it stops everything stops
    try:
        time.sleep(1)
        if not server.alive(): sys.exit('A szerver nem indult el (foglalt a port? próbáld: --port 8001).')
        log(f'Indítás kész (a naplófájl: {LOG}).')
        local = f'http://localhost:{a.port}'
        if a.no_tunnel:
            print(f'Csak helyi hálózat: {local}/graphics/live.html?token={token}'); show(local, token)
        else:
            cf = shutil.which('cloudflared')
            if not cf:
                print('A "cloudflared" nincs telepítve, ezért most csak ezen a gépen / a helyi hálózaton érhető el a rendszer.\n'
                      'Telepítés (egyszer): Windows: winget install --id Cloudflare.cloudflared · Mac: brew install cloudflared · Linux: lásd\n'
                      'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ – utána indítsd újra ezt a parancsot.')
                show(local, token)
            elif a.tunnel_token:
                tun = Child('az alagút', [cf, 'tunnel', '--no-autoupdate', 'run', '--token', a.tunnel_token]); tun.start(); kept.append(tun)
                show((a.public_url or '(a Cloudflare-ban beállított cím)').rstrip('/'), token)
            else:
                t = subprocess.Popen([cf, 'tunnel', '--no-autoupdate', '--url', local], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                procs.append(t)
                def watch():
                    shown = False
                    for line in t.stdout:
                        m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
                        if m and not shown: shown = True; show(m.group(0), token); print(' FIGYELEM: ez a cím minden újraindításnál MÁS lesz – ilyenkor új linkek kellenek.\n', flush=True)
                threading.Thread(target=watch, daemon=True).start()
        while all(p.poll() is None for p in procs):
            for c in kept: c.check()
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs + [c.p for c in kept if c.p]:
            if p.poll() is None: p.terminate()

if __name__ == '__main__': main()
