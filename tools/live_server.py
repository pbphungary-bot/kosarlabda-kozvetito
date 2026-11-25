"""One command for the central computer of the broadcast: starts the studio / relay server AND a public tunnel, prints the links.

    python3 tools/live_server.py                      # quick tunnel: free, no account, but the public address is NEW at every start
    python3 tools/live_server.py --tunnel-token XYZ --public-url https://live.pelda.hu   # your own fixed address (Cloudflare account + domain)
    python3 tools/live_server.py --no-tunnel          # only the local server (same network)

The access key (token) is generated once and kept in .live-server.json (not committed), so links made earlier keep working after a restart.
The tunnel is `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/): the laptops need nothing installed.
"""
import argparse, json, os, re, secrets, shutil, subprocess, sys, threading, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(ROOT, '.live-server.json')

def load_token(given):
    try: saved = json.load(open(STATE, encoding='utf-8'))
    except Exception: saved = {}
    token = given or saved.get('token') or secrets.token_urlsafe(9)
    if saved.get('token') != token:
        try: json.dump({'token': token}, open(STATE, 'w', encoding='utf-8'))
        except Exception: pass
    return token

def show(base, token):
    print('\n' + '=' * 70)
    print(' KÉSZ. Közvetítők, innen kérjétek a linkeket (egy meccs = egy link az OBS-hez):')
    print(f'\n   {base}/graphics/live.html?token={token}\n')
    print(' A linket az OBS-ben Böngésző forrásként kell felvenni (1920×1080). A link maga tartalmazza a kulcsot.')
    print(' Leállítás: Ctrl+C. Ne add ki a linket kívülállónak (a kulcs azt védi, hogy mások ne használják a gépet).')
    print('=' * 70 + '\n', flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--token', default=os.environ.get('LIVE_TOKEN', ''))
    ap.add_argument('--no-tunnel', action='store_true')
    ap.add_argument('--tunnel-token', default='', help='token of a named Cloudflare tunnel (fixed address)')
    ap.add_argument('--public-url', default='', help='the fixed address of the named tunnel, e.g. https://live.pelda.hu')
    a = ap.parse_args()
    token = load_token(a.token)
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'serve.py'), str(a.port), '--token', token])
    procs = [server]
    try:
        time.sleep(1)
        if server.poll() is not None: sys.exit('A szerver nem indult el (foglalt a port? próbáld: --port 8001).')
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
                procs.append(subprocess.Popen([cf, 'tunnel', '--no-autoupdate', 'run', '--token', a.tunnel_token]))
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
        while all(p.poll() is None for p in procs): time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            if p.poll() is None: p.terminate()

if __name__ == '__main__': main()
