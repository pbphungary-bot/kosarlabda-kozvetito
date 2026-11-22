"""Temporary read-only probe: how good / how available are the Hunbasket player photos? (to be deleted)"""
import io, json, re, urllib.request
from PIL import Image
from bs4 import BeautifulSoup
UA = {'User-Agent': 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0)'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30)
stats = []
for lg in ('men', 'women'):
    d = json.load(open(f'data/team_pages_{lg}.json'))
    for t in d['teams'][:6]:
        for p in t['roster']:
            m = re.search(r'/([A-Z]\d+)/', p['url'] or '')
            if not m: stats.append((lg, t['name'], p['name'], 'no-id')); continue
            u = f'https://15th.webpont.com/art/player/profile/{m.group(1)}.png'
            try:
                r = get(u); b = r.read(); im = Image.open(io.BytesIO(b)); a = im.convert('RGBA').getchannel('A')
                bbox = a.getbbox(); opaque = sum(1 for x in a.getdata() if x > 200) / (im.width * im.height)
                stats.append((lg, t['name'], p['name'], im.size, len(b), im.mode, 'bbox', bbox, 'opaque%', round(opaque * 100), r.headers.get('Access-Control-Allow-Origin'), r.headers.get('Content-Type')))
            except Exception as e:
                stats.append((lg, t['name'], p['name'], 'ERR', str(e)[:60]))
for s in stats: print(s)
ok = [s for s in stats if isinstance(s[3], tuple)]
print('TOTAL', len(stats), 'ok', len(ok), 'sizes', sorted({s[3] for s in ok})[:10])
# a player page: which images, how big
h = get('https://hunbasket.hu/jatekos/x2627/whun/B152349/fisher-malia-jordan').read().decode('utf-8', 'replace')
s = BeautifulSoup(h, 'html.parser')
print('og:image', [m.get('content') for m in s.find_all('meta', property='og:image')])
for im in s.find_all('img'):
    src = im.get('src') or ''
    if 'player' in src or 'profile' in src: print('img', src, im.get('width'), im.get('height'), im.get('class'))
