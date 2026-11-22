#!/usr/bin/env python3
"""Downloads the Hunbasket player profile photos (transparent PNG cut-outs) of every roster player, shrinks them and stores them as
WebP in graphics/players/<id>.webp, so the studio can use them (a photo from another site cannot be drawn into an exported PNG:
the host sends no CORS header). Run manually (workflow `Player photos`); the photos belong to their owners (MKOSZ / photographers)."""
import collections, io, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'graphics' / 'players'
UA = 'Mozilla/5.0 (compatible; kosarlabda-kozvetito-collector/1.0; +https://github.com/pbphungary-bot/kosarlabda-kozvetito; low-frequency)'
MAX_W = 240


def headshot(im, thr=14):
    """The mkosz.hu 'photo' variant is a small full-body picture on a flat studio background: keep head and shoulders
    (like the profile cut-outs, ratio 0.88) and make the background transparent by region growing from the border."""
    im = im.convert('RGBA')
    w, h = im.size
    im = im.crop((0, 0, w, min(h, round(w / 0.88))))
    a = np.asarray(im).astype(int)[..., :3]
    H, W, _ = a.shape
    seen = np.zeros((H, W), bool)
    q = collections.deque()
    for p in [(y, x) for y in range(H) for x in (0, W - 1)] + [(y, x) for x in range(W) for y in (0, H - 1)]:
        seen[p] = True
        q.append(p)
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and not seen[ny, nx] and np.abs(a[ny, nx] - a[y, x]).sum() < thr:
                seen[ny, nx] = True
                q.append((ny, nx))
    mask = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    im.putalpha(mask)
    return im


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
            data = None
            variant = 'profile'
            # hunbasket.hu uses .../player/profile/<id>.png; mkosz.hu player pages use .../player/photo/<id>.png, which exists for some
            # players whose profile photo is missing
            for kind in ('profile', 'photo'):
                try:
                    req = urllib.request.Request(f'https://15th.webpont.com/art/player/{kind}/{pid}.png', headers={'User-Agent': UA})
                    data = urllib.request.urlopen(req, timeout=30).read()
                    variant = kind
                    if kind == 'photo':
                        print(f'{pid} {name}: only the mkosz.hu "photo" variant exists')
                    break
                except urllib.error.HTTPError as e:
                    if e.code != 404 or kind == 'photo':
                        raise
            if data is None:
                raise ValueError('no photo')
            im = Image.open(io.BytesIO(data)).convert('RGBA')
            if variant == 'photo':
                im = headshot(im)
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
            if im.width != MAX_W:
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
