#!/usr/bin/env python3
"""Downloads the Hunbasket player profile photos (transparent PNG cut-outs) of every roster player, shrinks them and stores them as
WebP in graphics/players/<id>.webp, so the studio can use them (a photo from another site cannot be drawn into an exported PNG:
the host sends no CORS header). Run manually (workflow `Player photos`); the photos belong to their owners (MKOSZ / photographers)."""
import io, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'graphics' / 'players'
UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-collector/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito; low-frequency)'
MAX_W = 240


def player_id(url):
    m = re.search(r'/([A-Z]\d+)/', url or '')
    return m.group(1) if m else None


def main():
    refresh = '--refresh' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    ids = {}
    for lg in ('men', 'women'):
        for t in json.loads((ROOT / 'data' / f'team_pages_{lg}.json').read_text(encoding='utf-8'))['teams']:
            for p in t['roster']:
                pid = player_id(p.get('url'))
                if pid:
                    ids[pid] = p['name']
    have, missing = [], []
    for pid, name in sorted(ids.items()):
        path = OUT / f'{pid}.webp'
        if path.exists() and not refresh:
            have.append(pid)
            continue
        try:
            req = urllib.request.Request(f'https://15th.webpont.com/art/player/profile/{pid}.png', headers={'User-Agent': UA})
            data = urllib.request.urlopen(req, timeout=30).read()
            im = Image.open(io.BytesIO(data)).convert('RGBA')
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
            im.save(path, 'WEBP', quality=86, method=6)
            have.append(pid)
        except urllib.error.HTTPError as e:
            missing.append(pid)
            print(f'{pid} {name}: HTTP {e.code}')
        except Exception as e:
            missing.append(pid)
            print(f'{pid} {name}: {e}')
        time.sleep(0.25)
    (OUT / 'index.json').write_text(json.dumps({'ids': sorted(have), 'missing': sorted(missing)}, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{len(have)} photos, {len(missing)} missing, {len(ids)} players')


if __name__ == '__main__':
    main()
