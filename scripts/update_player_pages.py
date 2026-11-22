#!/usr/bin/env python3
"""Hunbasket player pages: season box score (average / total / per 40), advanced statistics, shooting zones, the game log
("mérkőzésről mérkőzésre") and the career tables (per season, average and total) of every NB I/A player. Real data only;
a player that cannot be read keeps the old entry. Output: data/player_pages_men.json / data/player_pages_women.json"""
import json, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-collector/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito; low-frequency)'
SEASON_COLS = ['M.', 'K.', 'P.', 'Idő', '2P S', '2P K', '2P %', '3P S', '3P K', '3P %', 'BT S', 'BT K', 'BT %', 'VLP', 'TLP', 'ÖLP',
               'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL']
GAME_COLS = ['K.', 'P.', 'Idő', '2P S', '2P K', '2P %', '3P S', '3P K', '3P %', 'BT S', 'BT K', 'BT %', 'VLP', 'TLP', 'ÖLP',
             'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL']
ADV_COLS = ['M.', 'K.', 'P.', 'Idő', 'Off RTG', 'Def RTG', 'Net RTG', 'TS%', 'ES%', 'Usg%', 'Támadás', 'Pont/tám']


def clean(x):
    return re.sub(r'\s+', ' ', (x or '').replace('\xa0', ' ')).strip()


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'hu-HU,hu;q=0.9'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')


def title_of(table):
    head = table.find('tr')
    return clean(head.get_text(' ')).lower() if head else ''


def parse_player_page(html):
    soup = BeautifulSoup(html, 'html.parser')
    out = {'season': {}, 'advanced': None, 'zones': [], 'gamelog': [], 'career': {}}
    for table in soup.find_all('table'):
        t = title_of(table)
        rows = table.find_all('tr')
        if t.startswith('box score'):
            for tr in rows:
                td = [clean(c.get_text(' ')) for c in tr.find_all('td')]
                key = {'átlag': 'average', 'total': 'total', '40 perc': 'per40'}.get(td[0].lower()[:7] if td else '', None) or \
                      {'átlag': 'average', 'total': 'total'}.get(td[0].lower() if td else '', None) or ('per40' if td and td[0].lower().startswith('40') else None)
                if key and key not in out['season'] and len(td) - 1 == len(SEASON_COLS):
                    out['season'][key] = td[1:]
        elif t.startswith('fejlett'):
            for tr in rows:
                td = [clean(c.get_text(' ')) for c in tr.find_all('td')]
                if td and td[0].lower() == 'total' and len(td) - 1 == len(ADV_COLS):
                    out['advanced'] = td[1:]
                    break
        elif t.startswith('zónák') and not out['zones']:
            for tr in rows[1:]:
                td = [clean(c.get_text(' ')) for c in tr.find_all('td')]
                if len(td) >= 3:
                    out['zones'].append({'zone': td[0].lstrip('• ').strip(), 'made_att': td[1], 'pct': td[2]})
        elif t.startswith('mérkőzésről') and not out['gamelog']:
            for tr in rows:
                td = tr.find_all('td', recursive=False)
                if len(td) != 5 + len(GAME_COLS) or not re.fullmatch(r'\d+', clean(td[0].get_text())):
                    continue
                opp = td[3].find('a')
                res = td[4].find('a')
                out['gamelog'].append({
                    'no': clean(td[0].get_text()), 'date': clean(td[1].get_text()),
                    'opponent': clean(td[3].get_text(' ')), 'opponent_url': opp['href'] if opp and opp.get('href') else None,
                    'result': re.sub(r'\s+', '', res.get_text()) if res else clean(td[4].get_text()),
                    'game_url': res['href'] if res and res.get('href') else None,
                    'win': 'green-col' in (td[4].get('class') or []), 'loss': 'red-col' in (td[4].get('class') or []),
                    'stats': [clean(c.get_text(' ')) for c in td[5:]],
                })
        elif t.startswith('karrier'):
            tab = table.find_parent(id=True)
            kind = (tab.get('id') if tab else 'tab-regular').replace('tab-', '') or 'regular'
            if kind in out['career']:
                continue
            rws = []
            for tr in rows:
                td = tr.find_all('td', recursive=False)
                if len(td) != 4 + len(SEASON_COLS):
                    continue
                label = clean(td[0].get_text(' '))
                team = clean(td[2].get_text(' '))
                league = clean(td[3].get_text(' '))
                avg, tot = [], []
                for i, c in enumerate(td[4:]):
                    a, s = c.find(class_='mode-avg'), c.find(class_='mode-sum')
                    if a is not None:
                        avg.append(clean(a.get_text())); tot.append(clean(s.get_text()) if s is not None else '')
                    else:
                        avg.append(clean(c.get_text())); tot.append(clean(c.get_text()))
                rws.append({'label': label, 'team': team, 'league': league, 'average': avg, 'total': tot})
            if rws:
                out['career'][kind] = rws
    return out


def player_list(league):
    d = json.loads((ROOT / 'data' / f'team_pages_{league}.json').read_text(encoding='utf-8'))
    for t in d['teams']:
        for p in t['roster']:
            m = re.search(r'/([A-Z]\d+)/', p.get('url') or '')
            if m:
                yield m.group(1), p['name'], t['name'], p['url']


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for league in ('men', 'women'):
        if only and league != only:
            continue
        path = ROOT / 'data' / f'player_pages_{league}.json'
        old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'players': {}}
        players, errors = {}, []
        for pid, name, team, url in player_list(league):
            try:
                data = parse_player_page(get(url))
                if not data['season'].get('average') or not data['gamelog'] and not data['career']:
                    raise ValueError('no tables')
                data['career'] = {k: v for k, v in data['career'].items() if k == 'regular'}  # the other career tab repeats it
                players[pid] = {'name': name, 'team': team, 'url': url, **data}
            except Exception as e:
                errors.append(f'{name}: {e}')
                if pid in old.get('players', {}):
                    players[pid] = old['players'][pid]
            time.sleep(1)
        for e in errors:
            print(f'{league}: {e}')
        if len(players) < len(old.get('players', {})) // 2 or not players:
            print(f'{league}: too little data, keeping the old file')
            continue
        if old.get('players') == players:
            print(f'{league}: unchanged')
            continue
        out = {'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'source': 'https://hunbasket.hu', 'league': league, 'columns': SEASON_COLS, 'game_columns': GAME_COLS, 'advanced_columns': ADV_COLS, 'players': players}
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{league}: {len(players)} players written')
    return 0


if __name__ == '__main__':
    sys.exit(main())
