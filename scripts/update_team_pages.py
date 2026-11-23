#!/usr/bin/env python3
"""Hunbasket team pages: roster, shooting zones, single-game records and the full statistics tables
(per-game average, totals, per-40-minutes) of every NB I/A team. Real data only; a team that cannot be read keeps its old entry."""
import json, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SEASON = 'x2627'
LEAGUES = {'men': 'hun', 'women': 'whun'}
UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-collector/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito; low-frequency)'
STAT_COLS = ['#', 'Játékos', 'M.', 'K.', 'P.', 'Idő', '2P S', '2P K', '2P %', 'Középtáv S', 'Középtáv K', 'Középtáv %', '3P S', '3P K', '3P %',
             'BT S', 'BT K', 'BT %', 'VLP', 'TLP', 'ÖLP', 'SZL', 'EL', 'Fault', 'Kih. fault', 'GP', 'Blokk', 'Kapott blokk', 'VAL', 'O.RTG', 'D.RTG', 'TS%', 'ES%']
KINDS = [('átlag', 'average'), ('összes', 'total'), ('40 perces', 'per40')]


def clean(x):
    return re.sub(r'\s+', ' ', (x or '').replace('\xa0', ' ')).strip()


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'hu-HU,hu;q=0.9'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'replace')


def parse_stats(html):
    """The three player tables of /csapat-statisztika/…: {'average': {...}, 'total': {...}, 'per40': {...}} (+ team name)."""
    soup = BeautifulSoup(html, 'html.parser')
    h1 = soup.select_one('.team-stat-header h1')
    name = clean(h1.get_text(' ')) if h1 else None
    out = {}
    for table in soup.select('.player-stat-table table'):
        head = clean(table.find('tr').get_text(' ')).lower() if table.find('tr') else ''
        kind = next((k for needle, k in KINDS if head.startswith('csapat ' + needle) or head.startswith(needle)), None)
        if not kind or kind in out:
            continue
        players, team = [], None
        for tr in table.select('tbody tr'):
            cells = tr.find_all('td', recursive=False)
            if len(cells) != len(STAT_COLS):
                continue
            row = [clean(c.get_text(' ')) for c in cells]
            a = cells[1].select_one('a.player-link')
            pn = cells[1].select_one('.player-link-name')
            if pn:
                row[1] = clean(pn.get('title') or pn.get_text(' '))
            if a and a.get('href'):
                row.append(a['href'])  # trailing player-page URL (not a stat column)
            if not row[1]:
                team = row[:len(STAT_COLS)]  # the unnamed last row = whole team
                continue
            if re.fullmatch(r'\d+', row[2]):
                players.append(row)
        if players:
            out[kind] = {'players': players, 'team': team}
    return name, out


def parse_team_page(html):
    """Roster, shooting zones and records of /csapat/…"""
    soup = BeautifulSoup(html, 'html.parser')
    res = {'roster': [], 'coaches': [], 'zones': [], 'team_records': [], 'player_records': []}
    for span in soup.find_all('span'):  # "Vezetőedző: Name", "Másodedző: Name" (the value is in the text that follows)
        label = clean(span.get_text())
        if label in ('Vezetőedző:', 'Másodedző:', 'Segédedző:'):
            name = clean(span.parent.get_text(' ')).replace(label, '', 1).strip()
            if name and not any(c['name'] == name for c in res['coaches']):
                res['coaches'].append({'role': label.rstrip(':'), 'name': name})
    for table in soup.find_all('table'):
        hdr = [clean(c.get_text(' ')) for c in (table.find('tr').find_all(['th', 'td']) if table.find('tr') else [])]
        if hdr[:2] == ['#', 'Játékos'] and 'Poszt' in hdr:
            for tr in table.find_all('tr')[1:]:
                td = tr.find_all('td')
                if len(td) < 7:
                    continue
                a = td[1].find('a')
                nat = td[2].find('img')
                flag = nat.get('src') if nat and nat.get('src') else None
                name = clean(' '.join(s.get_text(' ') for s in td[1].select('span span'))) or clean(td[1].get_text(' '))
                res['roster'].append({
                    'number': clean(td[0].get_text()), 'name': name, 'url': a['href'] if a and a.get('href') else None,
                    'nationality': (nat.get('alt') if nat else None) or clean(td[2].get_text()) or None,
                    'flag': flag,
                    'birth_year': clean(td[3].get_text()) or None, 'position': clean(td[4].get_text()) or None,
                    'height': clean(td[5].get_text()) or None, 'weight': clean(td[6].get_text()) or None})
        elif hdr and hdr[0] == 'Zónák':
            for tr in table.find_all('tr')[1:]:
                td = [clean(c.get_text(' ')) for c in tr.find_all('td')]
                if len(td) >= 3:
                    res['zones'].append({'zone': td[0].lstrip('• ').strip(), 'made_att': td[1], 'pct': td[2], 'rank': td[3] if len(td) > 3 else None})
        elif hdr and (hdr[0].startswith('Csapat szintű') or hdr[0].startswith('Játékos szintű')):
            key = 'team_records' if hdr[0].startswith('Csapat') else 'player_records'
            for tr in table.find_all('tr')[1:]:
                label = tr.select_one('.team-records-type-label')
                if not label:
                    continue
                pn = tr.select_one('.team-records-player-name')
                opp = tr.select_one('.team-records-opp-link')
                score = tr.select_one('.team-records-score-link') or tr.select_one('.team-records-score')
                date = tr.select_one('.team-records-date')
                tds = [clean(c.get_text(' ')) for c in tr.find_all('td')]
                res[key].append({
                    'label': clean(label.get_text(' ')), 'player': clean(pn.get_text(' ')) if pn else None,
                    'value': clean((tr.select_one('.team-records-value') or label).get_text(' ')),
                    'opponent': (opp.get('title') if opp else None), 'result': clean(score.get_text(' ')) if score else None,
                    'date': clean(date.get_text(' ')) if date else (tds[-1] if tds and re.search(r'\d{4}\.', tds[-1]) else None)})
    return res


def team_list(league):
    """Teams and their Hunbasket ids come from the player-stats collector's output."""
    d = json.loads((ROOT / 'data' / f'player_stats_{league}.json').read_text(encoding='utf-8'))
    return [(t['club_id'], t['name']) for t in d.get('teams', []) if t.get('club_id')]


def collect(league, old):
    code = LEAGUES[league]
    teams, errors = [], []
    prev = {t['club_id']: t for t in (old or {}).get('teams', [])}
    for club_id, name in team_list(league):
        base_stat = f'https://hunbasket.hu/csapat-statisztika/{SEASON}/{code}/{club_id}/'
        base_team = f'https://hunbasket.hu/csapat/{SEASON}/{code}/{club_id}/'
        try:
            _, stats = parse_stats(get(base_stat))
            time.sleep(1)
            page = parse_team_page(get(base_team))
            time.sleep(1)
            if not stats.get('average') or not page['roster']:
                raise ValueError('stat or roster table missing')
            teams.append({'club_id': club_id, 'name': name, 'stats_url': base_stat, 'team_url': base_team, 'columns': STAT_COLS, 'stats': stats, **page})
        except Exception as e:  # keep the old entry rather than losing the team
            errors.append(f'{name}: {e}')
            if club_id in prev:
                teams.append(prev[club_id])
    return teams, errors


def fetch_missing_flags(teams):
    """Roster flags are shown on the studio's roster graphics from graphics/assets/flags/<xx>.svg: download the ones a new signing needs."""
    out = ROOT / 'graphics' / 'assets' / 'flags'
    out.mkdir(parents=True, exist_ok=True)
    for t in teams:
        for p in t.get('roster', []):
            m = re.search(r'/([a-z]{2})\.svg$', p.get('flag') or '')
            if not m or (out / f'{m.group(1)}.svg').exists():
                continue
            try:
                req = urllib.request.Request(p['flag'], headers={'User-Agent': UA})
                data = urllib.request.urlopen(req, timeout=30).read()
                if b'<svg' in data[:2000]:
                    (out / f'{m.group(1)}.svg').write_bytes(data)
                    print(f'flag downloaded: {m.group(1)} ({p.get("nationality")})')
            except Exception as e:  # a missing flag only means no flag on the graphic; the data stays valid
                print(f'flag {m.group(1)} not available: {e}')
            time.sleep(0.5)


def main():
    changed = False
    for league in LEAGUES:
        path = ROOT / 'data' / f'team_pages_{league}.json'
        old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else None
        teams, errors = collect(league, old)
        for e in errors:
            print(f'{league}: {e}')
        if not teams or (old and len(teams) < len(old.get('teams', [])) // 2):
            print(f'{league}: too little data, keeping the old file')
            continue
        fetch_missing_flags(teams)
        if old and old.get('teams') == teams:
            print(f'{league}: unchanged')
            continue  # no rewrite → no commit noise
        out = {'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'source': 'https://hunbasket.hu', 'league': league, 'teams': teams}
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{league}: {len(teams)} teams written')
        changed = True
    return 0


if __name__ == '__main__':
    sys.exit(main())
