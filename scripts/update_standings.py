#!/usr/bin/env python3
"""Refresh official Hunbasket league tables; never replace valid data on failure."""
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

SOURCES = {'men': 'https://hunbasket.hu/tabella/ferfi', 'women': 'https://hunbasket.hu/tabella/noi'}
EXPECTED_TEAMS = {'men': 14, 'women': 11}

def integer(value):
    value = re.sub(r'\s+', '', str(value))
    if not re.fullmatch(r'\d+', value):
        raise ValueError(value)
    return int(value)

def extract_standings_html(html, league):
    soup = BeautifulSoup(html, 'html.parser')
    expected = EXPECTED_TEAMS[league]
    # Hunbasket columns: H., Csapat, M, %, PT, GY, V, DOB, KAP, ...
    # Some table layouts merge rank and team into the same cell.
    options = []
    for table in soup.find_all('table'):
        rows = []
        for tr in table.find_all('tr'):
            cells = [c.get_text(' ', strip=True) for c in tr.find_all(['th','td'], recursive=False)]
            if len(cells) < 9:
                continue
            rank = cells[0].strip().rstrip('.')
            if not rank.isdigit():
                continue
            try:
                row = {'rank': int(rank), 'name': cells[1], 'played': integer(cells[2]),
                       'points': integer(cells[4]), 'wins': integer(cells[5]),
                       'losses': integer(cells[6]), 'scored': integer(cells[7]),
                       'conceded': integer(cells[8])}
            except (ValueError, IndexError):
                continue
            if not row['name'] or row['played'] != row['wins'] + row['losses']:
                continue
            rows.append(row)
        if len(rows) == expected and sorted(x['rank'] for x in rows) == list(range(1, expected+1)):
            options.append(sorted(rows, key=lambda x: x['rank']))
    if not options:
        raise ValueError(f'No complete {league} table ({expected} teams) on source page')
    # Avoid silently selecting a lower division if several tables are present.
    return options[0]

def extract_standings(url, league):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'hu-HU,hu;q=0.9'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return extract_standings_html(response.read(), league)

def main():
    Path('data').mkdir(exist_ok=True)
    failures = []
    for league, url in SOURCES.items():
        try:
            standings = extract_standings(url, league)
            path = Path(f'data/standings_{league}.json')
            old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
            now = datetime.now(timezone.utc).isoformat()
            unchanged = old.get('standings') == standings
            output = {'competition': 'Férfi NB I/A' if league == 'men' else 'Női NB I/A',
                      'source': url, 'updated_at': old.get('updated_at', now) if unchanged else now,
                      'checked_at': now, 'standings': standings}
            path.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
            print(f'{league}: {len(standings)} teams; {"unchanged" if unchanged else "updated"}')
        except Exception as exc:
            failures.append(f'{league}: {exc}')
            print(f'ERROR {league}: {exc}')
    if failures:
        raise SystemExit('; '.join(failures))

if __name__ == '__main__':
    main()
