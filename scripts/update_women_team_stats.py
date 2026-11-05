#!/usr/bin/env python3
"""Collect 2026/27 women's NB I/A official team statistics from Hunbasket."""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys
import unicodedata
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://hunbasket.hu'
TEAMS_URL = BASE + '/csapatok'
SEASON = 'x2627'
LEAGUE = 'whun'
METRICS = {
    'dobottpont': 'ppg',
    '2pontosdobo': 'fg2_pct',
    '3pontosdobo': 'fg3_pct',
    'buntetodobo': 'ft_pct',
    'vedolepattano': 'dreb',
    'tamadolepattano': 'oreb',
    'osszeslepattano': 'reb',
    'golpassz': 'ast',
    'labdaszerzes': 'stl',
    'eladottlabda': 'tov',
    'blokk': 'blk',
    'val': 'val',
}

def norm(value):
    value = unicodedata.normalize('NFKD', str(value)).lower()
    return re.sub('[^a-z0-9]', '', ''.join(c for c in value if not unicodedata.combining(c)))

def num(value):
    match = re.search(r'-?\d+(?:[.,]\d+)?', str(value).replace('\xa0', ' '))
    return float(match.group(0).replace(',', '.')) if match else None

def parse_page(html, fallback_name):
    # Parse raw bytes so BeautifulSoup detects Hunbasket's legacy encoding.
    soup = BeautifulSoup(html, 'html.parser', from_encoding='windows-1250' if isinstance(html, bytes) and b'charset=windows-1250' in html.lower() else None)
    title = next((h.get_text(' ', strip=True) for h in soup.select('h1,h2')
                  if '2026/2027' in h.get_text(' ', strip=True) and 'csoport' in h.get_text(' ', strip=True)), '')
    # Do not depend on an exact accented league title: Hunbasket may serve
    # legacy encodings and headings vary between page templates.
    if not title:
        raise ValueError('No 2026/2027 league/team heading on statistics page')
    match = re.search(r'csoport\s*-\s*(.*?)\s*-\s*2026/2027', title)
    name = match.group(1).strip() if match else fallback_name
    values = {}
    table_debug = []
    for table in soup.select('table'):
        rows = table.select('tr')
        if not rows:
            continue
        # Header cells may be td, th, or missing a thead altogether.
        first = [norm(c.get_text(' ', strip=True)) for c in rows[0].find_all(['td', 'th'], recursive=False)]
        if 'kategoria' in first and 'atlag' in first:
            category_index, avg_index = first.index('kategoria'), first.index('atlag')
            data_rows = rows[1:]
        else:
            # A Hunbasket team page has a single category/average/total/max/rank table.
            # Some server-rendered variants omit the column header row.
            category_index, avg_index = 0, 1
            data_rows = rows
        for row in data_rows:
            cells = row.find_all(['td', 'th'], recursive=False)
            if len(cells) <= max(category_index, avg_index):
                continue
            label = norm(cells[category_index].get_text(' ', strip=True))
            if label in ('kategoria', 'category'):
                continue
            for prefix, key in METRICS.items():
                if label.startswith(prefix):
                    value = num(cells[avg_index].get_text(' ', strip=True))
                    if value is not None:
                        values[key] = round(value, 3)
                    break
        table_debug.append((len(rows), first[:5]))
    if len(values) < 9:
        raise ValueError(f'Only {len(values)} fields for {name}: {list(values)}; table shapes: {table_debug[:5]}')
    return name, values

def discover(session):
    response = session.get(TEAMS_URL, timeout=35)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    entries = {}
    for a in soup.select('a[href]'):
        href = urljoin(BASE, a['href'])
        m = re.search(r'/csapat/x2627/whun/(\d+)(?:[/?#]|$)', href)
        if m:
            label = a.get_text(' ', strip=True)
            if label:
                entries[m.group(1)] = label
    if len(entries) != 11:
        raise ValueError(f'Expected 11 women teams in league roster; found {len(entries)}')
    return entries

def main():
    session = requests.Session()
    session.headers.update({'User-Agent': 'Mozilla/5.0 (compatible; BasketballStatsUpdater/1.1)'})
    teams = []
    for team_id, roster_name in discover(session).items():
        url = f'{BASE}/csapatstatisztika/{SEASON}/{LEAGUE}/{team_id}'
        response = session.get(url, timeout=35)
        response.raise_for_status()
        name, stats = parse_page(response.content, roster_name)
        teams.append({'name': name, 'aliases': [roster_name] if norm(roster_name) != norm(name) else [],
                      'periods': {'season': stats}, 'source_url': url})
        print(f'{name}: {len(stats)} verified stats')
    if len(teams) != 11 or len({norm(t['name']) for t in teams}) != 11:
        raise ValueError('Invalid team count or duplicate team names; keeping existing data')
    target = ROOT / 'data' / 'team_stats_women.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {'league': 'women', 'source': 'hunbasket', 'source_url': TEAMS_URL,
               'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'teams': teams}
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(target)
    print(f'Saved {len(teams)} teams to {target}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--league', choices=['women'], default='women')
    args = parser.parse_args()
    try:
        main()
    except Exception as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
