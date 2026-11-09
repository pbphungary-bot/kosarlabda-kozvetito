#!/usr/bin/env python3
"""Fetch official Hunbasket 2026/27 standings, safely and independently per league."""
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

SOURCES = {'men': 'https://hunbasket.hu/tabella/ferfi', 'women': 'https://hunbasket.hu/tabella/noi'}
EXPECTED_TEAMS = {'men': 14, 'women': 11}
SEASON = '2026/2027'

def number(value):
    value = re.sub(r'[\s\u00a0]', '', str(value))
    if not re.fullmatch(r'\d+', value):
        raise ValueError('Not an integer: ' + repr(value))
    return int(value)

def clean(value):
    return re.sub(r'\s+', ' ', value).strip()

def parse_row(tr):
    cells = [clean(c.get_text(' ', strip=True)) for c in tr.find_all(['th', 'td'], recursive=False)]
    if len(cells) < 8:
        return None
    # Standard columns: rank, team, matches, win%, points, wins, losses, scored, conceded.
    # Some layouts put the rank and team in a single cell.
    first = re.match(r'^(\d{1,2})\s*\.\s*(.*)$', cells[0])
    if not first:
        return None
    rank = int(first.group(1))
    if len(cells) >= 9 and not first.group(2):
        name = cells[1]
        stats = cells[2:]
    else:
        name = first.group(2)
        stats = cells[1:]
    if not name or len(stats) < 7:
        return None
    try:
        played = number(stats[0])
        points = number(stats[2])
        wins = number(stats[3])
        losses = number(stats[4])
        scored = number(stats[5])
        conceded = number(stats[6])
    except ValueError:
        return None
    if played != wins + losses or points < wins or scored < 0 or conceded < 0:
        return None
    return {'rank': rank, 'name': name, 'played': played, 'points': points,
            'wins': wins, 'losses': losses, 'scored': scored, 'conceded': conceded}

def extract_standings_html(html, league):
    soup = BeautifulSoup(html, 'html.parser')
    expected = EXPECTED_TEAMS[league]
    heading = soup.find(string=re.compile(r'Tabella\s*-\s*20\d\d\s*/\s*20\d\d', re.I))
    if heading:
        match = re.search(r'(20\d\d)\s*/\s*(20\d\d)', str(heading))
        if match and '/'.join(match.groups()) != SEASON:
            raise ValueError('Wrong season on official page: ' + '/'.join(match.groups()) + '; expected ' + SEASON)
    candidates = []
    for table in soup.find_all('table'):
        text = clean(table.get_text(' ', strip=True)).lower()
        if not all(x in text for x in ('csapat', 'dob', 'kap')):
            continue
        rows = [r for tr in table.find_all('tr') if (r := parse_row(tr)) is not None]
        # Only the complete top-flight standings qualify; do not use partial or youth tables.
        if len(rows) == expected and sorted(r['rank'] for r in rows) == list(range(1, expected + 1)):
            candidates.append(sorted(rows, key=lambda r: r['rank']))
    if not candidates:
        sizes = [len([1 for tr in t.find_all('tr') if parse_row(tr)]) for t in soup.find_all('table')]
        raise ValueError(f'No complete {league} standings ({expected} teams); table row counts={sizes}; '
                         f'page title={clean(soup.title.get_text()) if soup.title else "missing"}')
    if len(candidates) > 1 and candidates[0] != candidates[1]:
        raise ValueError('Multiple different complete standings found; refusing ambiguous data')
    return candidates[0]

def fetch(url, league):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; BasketballStandings/1.0)',
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'hu-HU,hu;q=0.9'})
    with urllib.request.urlopen(req, timeout=30) as response:
        html = response.read()
    return extract_standings_html(html, league)

def main():
    Path('data').mkdir(exist_ok=True)
    failures = []
    for league, url in SOURCES.items():
        try:
            standings = fetch(url, league)
            path = Path(f'data/standings_{league}.json')
            old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
            now = datetime.now(timezone.utc).isoformat()
            unchanged = old.get('standings') == standings
            output = {'competition': 'Férfi NB I/A' if league == 'men' else 'Női NB I/A',
                'source': url, 'updated_at': old.get('updated_at', now) if unchanged else now,
                'checked_at': now, 'standings': standings}
            path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(f'{league}: {len(standings)} official teams; {"unchanged" if unchanged else "updated"}', flush=True)
        except Exception as exc:
            failures.append(f'{league}: {exc}')
            print(f'ERROR {league}: {exc}', flush=True)
    if failures:
        raise SystemExit('; '.join(failures))

if __name__ == '__main__':
    main()
