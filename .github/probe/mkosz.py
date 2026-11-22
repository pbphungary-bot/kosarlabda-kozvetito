"""Temporary read-only probe: do mkosz.hu team pages carry photos that hunbasket.hu lacks? (to be deleted)"""
import io, json, re, urllib.request
from bs4 import BeautifulSoup
from PIL import Image
UA = {'User-Agent': 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0)'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40)
miss = set(json.load(open('graphics/players/index.json'))['missing'])
code = {'men': 'hun', 'women': 'whun'}
for lg in ('men', 'women'):
    for t in json.load(open(f'data/team_pages_{lg}.json'))['teams']:
        ids = [re.search(r'/([A-Z]\d+)/', p['url']).group(1) for p in t['roster'] if re.search(r'/([A-Z]\d+)/', p['url'] or '')]
        if not (set(ids) & miss): continue
        tid = re.search(r'/(\d+)/?$', t['team_url']).group(1)
        url = f'https://mkosz.hu/csapat/x2627/{code[lg]}/{tid}/'
        try:
            r = get(url); h = r.read().decode('utf-8', 'replace')
        except Exception as e:
            print(t['name'], url, 'ERR', e); continue
        print('==', t['name'], url, r.status, len(h))
        s = BeautifulSoup(h, 'html.parser')
        tb = s.find_all('table')[0]
        for tr in tb.find_all('tr')[1:]:
            a = tr.find('a'); img = tr.find('img', class_='team-avatar') or tr.find('img')
            href = a.get('href') if a else ''
            m = re.search(r'/([A-Z]\d+)/', href or '')
            pid = m.group(1) if m else None
            if pid in miss:
                src = img.get('src') if img else None
                print('  MISSING-ON-HUNBASKET', pid, tr.get_text(' ', strip=True)[:40], '->', src)
                if src and src.startswith('http'):
                    try:
                        rr = get(src); b = rr.read(); im = Image.open(io.BytesIO(b)); print('    image', im.size, len(b), rr.headers.get('Content-Type'), rr.headers.get('Access-Control-Allow-Origin'))
                    except Exception as e: print('    image ERR', e)
