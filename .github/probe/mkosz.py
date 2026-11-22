"""Temporary read-only probe (2): player pages of the players without a Hunbasket photo, on both domains (to be deleted)"""
import io, json, re, urllib.request
from bs4 import BeautifulSoup
UA = {'User-Agent': 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-probe/1.0)'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40)
miss = set(json.load(open('graphics/players/index.json'))['missing'])
for lg in ('men', 'women'):
    for t in json.load(open(f'data/team_pages_{lg}.json'))['teams']:
        for p in t['roster']:
            m = re.search(r'/([A-Z]\d+)/', p.get('url') or '')
            if not m or m.group(1) not in miss: continue
            for host in ('hunbasket.hu', 'mkosz.hu'):
                u = p['url'].replace('hunbasket.hu', host)
                try:
                    r = get(u); h = r.read().decode('utf-8', 'replace')
                except Exception as e:
                    print(p['name'], host, 'ERR', e); continue
                s = BeautifulSoup(h, 'html.parser')
                imgs = []
                for im in s.find_all('img'):
                    src = im.get('src') or ''
                    if re.search(r'player|profile|webpont|upload|foto|photo', src, re.I) and 'flags' not in src: imgs.append(src)
                og = [x.get('content') for x in s.find_all('meta', property='og:image')]
                print(p['name'], host, r.status, 'og', og, 'imgs', imgs[:6])
