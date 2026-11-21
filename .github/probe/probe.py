"""Read-only probe of candidate sources for European / cup games (temporary; removed after the evaluation)."""
import json, re, sys, urllib.request, urllib.error

UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito)'
URLS = [l.split('#')[0].strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'hu,en;q=0.8'})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.geturl(), r.headers.get('content-type', ''), r.read()
    except urllib.error.HTTPError as e:
        return e.code, url, e.headers.get('content-type', ''), e.read()[:2000]
    except Exception as e:
        return 0, url, '', str(e).encode()

for url in URLS:
    st, final, ct, body = get(url)
    text = body.decode('utf-8', 'replace')
    print('=' * 100)
    print(f'{st} {url}' + (f'  -> {final}' if final != url else ''))
    print(f'content-type: {ct} | {len(body)} bytes')
    if 'robots.txt' in url:
        print(text[:1500]); continue
    if 'json' in ct or text.lstrip().startswith(('{', '[')):
        try:
            j = json.loads(text)
            print('JSON top level:', (list(j.keys())[:15] if isinstance(j, dict) else f'list of {len(j)}'))
            print(json.dumps(j, ensure_ascii=False)[:1800])
        except Exception as e:
            print('json parse failed', e, text[:300])
        continue
    m = re.search(r'<title>(.*?)</title>', text, re.S)
    print('title:', re.sub(r'\s+', ' ', m.group(1)).strip()[:120] if m else None)
    for kw in ['DVTK', 'Falco', 'Brod', 'AEK', 'Jairis', 'Panathlitikos', 'Szombathely', 'Sopron']:
        print(f'  {kw}: {len(re.findall(kw, text))}', end='')
    print()
    nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', text, re.S)
    print('__NEXT_DATA__:', bool(nd), '| ld+json:', len(re.findall(r'application/ld\+json', text)), '| SportsEvent:', len(re.findall(r'SportsEvent', text)))
    if nd:
        try:
            j = json.loads(nd.group(1)); props = j.get('props', {}).get('pageProps', {})
            print('pageProps keys:', list(props.keys())[:20])
            s = json.dumps(props, ensure_ascii=False)
            print('pageProps size', len(s)); print(s[:1500])
        except Exception as e:
            print('NEXT_DATA parse failed', e)
    links = sorted({h for h in re.findall(r'href="([^"]+)"', text) if re.search(r'/games?/|schedule|fixtures|results|calendar', h)})
    print('links (games/schedule):', len(links)); print('\n'.join(links[:25]))
    snippet = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', text, flags=re.S)
    snippet = re.sub(r'<[^>]+>', ' ', snippet); snippet = re.sub(r'\s+', ' ', snippet).strip()
    print('text:', snippet[:700])
