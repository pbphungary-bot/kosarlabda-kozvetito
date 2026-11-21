"""Collect referees, MKOSZ controller and arena per game from the official Hunbasket full schedule.

The full schedule pages (https://hunbasket.hu/menetrend-teljes/...) list, under every game, the arena,
"Játékvezetők: A, B, C" and "Ellenőr: X". This script reads those detail rows and writes
data/referees_men.json and data/referees_women.json, keyed by the match URL (the same URL the
fixtures files data/men.json and data/women.json use).

It does not touch the fixtures collector. If a page cannot be read or has no games, the existing file is
kept unchanged and the script exits with an error. A game whose referees were published earlier is never
blanked by a later page that shows none (a glitch must not wipe on-air data).
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bs4 import BeautifulSoup

BASE = 'https://hunbasket.hu'
SEASON = 'x2627'
LEAGUES = {
    'men': f'/menetrend-teljes/ferfi/{SEASON}/hun',
    'women': f'/menetrend-teljes/noi/{SEASON}/whun',
}
DATA = Path(__file__).resolve().parent.parent / 'data'
HEARTBEAT = timedelta(hours=12)  # rewrite an unchanged file at least this often so its timestamp stays fresh
MATCH_URL = re.compile(r'https?://[^\s\'"]*/merkozes/[^\s\'"]+')  # canonical match page
MATCH_ID = re.compile(r'((?:w?hun)_\d+)')               # e.g. whun_135479 (also inside preview links)


def clean(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; BasketballDashboard/1.0)'})
    with urllib.request.urlopen(req, timeout=40) as res:
        return res.read().decode('utf-8', 'replace')


def match_id(row):
    """Game id (e.g. hun_134947) from any link / button of a row; upcoming games link to a preview page."""
    for el in row.select('[href], [onclick]'):
        m = MATCH_ID.search(el.get('href', '') + ' ' + el.get('onclick', ''))
        if m:
            return m.group(1)
    return None


def match_url(row):
    """Canonical match page URL (/merkozes/...) from a row's link or button, if present."""
    for el in row.select('[href], [onclick]'):
        m = MATCH_URL.search(el.get('href', '') + ' ' + el.get('onclick', ''))
        if m:
            return m.group(0)
    return None


def parse(html):
    """{url: {home, away, venue, referees[], controller}} from the alternating main / detail rows."""
    soup = BeautifulSoup(html, 'html.parser')
    games = {}
    main = None
    for row in soup.select('table.desktop-only tbody tr'):
        home = row.select_one('.home-team-name')
        if home:  # main row of a game
            away = row.select_one('.away-team-name')
            main = {'id': match_id(row), 'home': clean(home.get_text(' ')), 'away': clean(away.get_text(' ')) if away else ''}
            continue
        staff = row.select_one('.data-group-staff-overview')
        if not staff or main is None:
            continue
        url = match_url(row)
        # the detail row must belong to the previous main row (same game id) – otherwise do not guess
        if not url or (main['id'] and match_id(row) and main['id'] != match_id(row)):
            main = None
            continue
        lines = staff.select('.data-group-team > div')
        refs_el = next((d for d in lines if 'Játékvezet' in d.get_text()), None)
        ctrl_el = next((d for d in lines if 'Ellenőr' in d.get_text()), None)
        referees = []
        if refs_el is not None:
            title = refs_el.get('title')
            raw = title if title else re.sub(r'^\s*Játékvezet\w*:?', '', clean(refs_el.get_text(' ')))
            referees = [clean(x) for x in raw.split(',') if clean(x)]
        controller = clean(re.sub(r'^\s*Ellenőr:?', '', clean(ctrl_el.get_text(' ')))) if ctrl_el is not None else ''
        arena = row.select_one('td.arena-name')
        venue = clean(arena.get('title') or arena.get_text(' ')) if arena else ''
        games[url] = {'home': main['home'], 'away': main['away'], 'venue': venue, 'referees': referees, 'controller': controller}
        main = None
    return games


def merge_keep_known(old, new):
    """Never replace published referees / controller with an empty value."""
    for url, g in new.items():
        o = old.get(url)
        if not o:
            continue
        if not g['referees'] and o.get('referees'):
            g['referees'] = o['referees']
        if not g['controller'] and o.get('controller'):
            g['controller'] = o['controller']
        if not g['venue'] and o.get('venue'):
            g['venue'] = o['venue']
    return new


def main():
    now = datetime.now(timezone.utc).isoformat()
    failed = False
    for league, path in LEAGUES.items():
        out = DATA / f'referees_{league}.json'
        try:
            games = parse(fetch(BASE + path))
            if not games:
                raise ValueError('no games with a detail row found – page layout changed?')
        except Exception as exc:  # keep the existing file
            print(f'{league}: FAILED ({exc})', file=sys.stderr)
            failed = True
            continue
        old, old_at = {}, None
        if out.exists():
            try:
                prev = json.loads(out.read_text(encoding='utf-8'))
                old, old_at = prev.get('matches', {}), prev.get('updated_at')
            except Exception:
                old = {}
        games = merge_keep_known(old, games)
        with_refs = sum(1 for g in games.values() if g['referees'])
        try:
            fresh = old_at and datetime.now(timezone.utc) - datetime.fromisoformat(old_at) < HEARTBEAT
        except ValueError:
            fresh = False
        if games == old and fresh:
            print(f'{league}: {len(games)} games, {with_refs} with referees (unchanged)')
            continue
        payload = {
            'league': league,
            'source': 'hunbasket',
            'source_url': BASE + path,
            'season': SEASON,
            'updated_at': now,
            'matches': dict(sorted(games.items())),
        }
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f'{league}: {len(games)} games, {with_refs} with referees')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
