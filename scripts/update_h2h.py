"""Build historical H2H from official Hunbasket season schedule pages.

Does not touch the working fixtures collector. Historical season URLs and
completeness are logged; missing seasons are not silently represented as full.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup

BASE = 'https://hunbasket.hu'
SEASONS = ['2627', '2526', '2425', '2324', '2223', '2122', '2021']
LEAGUES = {'men': ('ferfi', 'hun'), 'women': ('noi', 'whun')}
DATE = re.compile(r'20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.')
SCORE = re.compile(r'\b(\d{1,3})\s*[-–:]\s*(\d{1,3})\b')
URL_RE = re.compile(r'/merkozes/(?:x\d{4}/)?(?:hun|whun)/(?:hun|whun)_\d+', re.I)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0 (compatible; BasketballDashboard/1.0)'})
    with urllib.request.urlopen(req, timeout=35) as res:
        return BeautifulSoup(res.read(), 'html.parser')

def parse(soup, league, season):
    output = []
    for row in soup.select('table.desktop-only tbody tr'):
        d = row.select_one('.data-group.game-date')
        h = row.select_one('.home-team-name')
        a = row.select_one('.away-team-name')
        sc = row.select_one('.game-cell')
        if not all((d, h, a, sc)): continue
        dm = DATE.search(d.get_text(' ',strip=True))
        sm = SCORE.search(sc.get_text(' ',strip=True))
        if not dm or not sm: continue
        date = re.sub(r'\s+', '', dm.group(0)).strip('.')
        try:
            y,m,day = (int(v) for v in date.split('.'))
            iso = f'{y:04d}-{m:02d}-{day:02d}'
        except ValueError: continue
        home,away = h.get_text(' ',strip=True),a.get_text(' ',strip=True)
        if not home or not away or home==away: continue
        markup = str(row)
        links = []
        for anchor in row.select('a[href]'):
            link=urljoin(BASE,anchor.get('href',''))
            if URL_RE.search(link): links.append(link)
        if not links:
            found=URL_RE.search(markup.replace('\\/','/'))
            if found: links.append(urljoin(BASE,found.group(0)))
        if not links:
            ident=re.search(r'\b(?:hun|whun)_\d{5,7}\b',markup,re.I)
            if ident: links.append(f'{BASE}/merkozes/x{season}/{LEAGUES[league][1]}/{ident.group(0)}')
        output.append({'league':league,'season':f'20{season[:2]}/20{season[2:]}' if len(season)==4 else season,
                       'home':home,'away':away,'date':iso,'score':f'{sm.group(1)}–{sm.group(2)}',
                       'url':links[0] if links else '', 'source':'Hunbasket'})
    return output

def main():
    all_games=[];coverage=[]
    for league,(gender,code) in LEAGUES.items():
        for season in SEASONS:
            if len(season)!=4:continue
            url=f'{BASE}/menetrend-teljes/{gender}/x{season}/{code}'
            try:
                games=parse(get(url),league,season)
                coverage.append({'league':league,'season':season,'count':len(games),'url':url})
                print(f'{league} {season}: {len(games)} finished matches',flush=True)
                all_games.extend(games)
            except Exception as exc:
                print(f'WARNING {league} {season}: {exc}',file=sys.stderr,flush=True)
                coverage.append({'league':league,'season':season,'count':0,'error':str(exc)})
    # Merge current-season results from the already-working fixtures JSON.
    for league in LEAGUES:
        path=Path(f'data/{league}.json')
        if not path.exists():continue
        for m in json.loads(path.read_text(encoding='utf-8')).get('matches',[]):
            if m.get('status')!='finished':continue
            sm=SCORE.search(m.get('result',''))
            dm=DATE.search(m.get('date',''))
            if not sm or not dm:continue
            bits=[int(v) for v in re.sub(r'\s+','',dm.group(0)).strip('.').split('.')]
            if len(bits)!=3:continue
            all_games.append({'league':league,'season':'2026/2027','home':m['home'],'away':m['away'],
              'date':f'{bits[0]:04d}-{bits[1]:02d}-{bits[2]:02d}',
              'score':f'{sm.group(1)}–{sm.group(2)}','url':m.get('url',''),'source':'Hunbasket'})
    # Deduplicate by date, score and team names; prefer entries with a match URL.
    unique={}
    for m in all_games:
        key=(m['league'],m['date'],m['home'],m['away'],m['score'])
        if key not in unique or (m['url'] and not unique[key]['url']):unique[key]=m
    matches=sorted(unique.values(),key=lambda x:x['date'],reverse=True)
    if len(matches)<100:
        raise RuntimeError(f'Only {len(matches)} historical games collected; existing H2H file preserved')
    path=Path('data/h2h_hunbasket.json');path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({'source':'Hunbasket','updated_at':datetime.now(timezone.utc).isoformat(),
      'coverage':coverage,'matches':matches},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Saved {len(matches)} completed games, {sum(bool(m["url"]) for m in matches)} linked')

if __name__=='__main__':main()
