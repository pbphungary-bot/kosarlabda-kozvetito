"""Fit a per-element horizontal text scale so League Gothic set by the studio
matches the widths Photoshop rendered in the source PSDs.

The designer's League Gothic build has narrower glyphs (especially figures)
than every public release of the font, so each text element gets an `hscale`
fitted by least squares on Photoshop's own raster of that layer:
    psd_width ≈ hscale * ink_width(our font, size) + tracking * (glyphs - 1)
Output: graphics/js/calibration.js  (imported by templates.js)

Usage: python3 tools/calibrate_text.py
"""
import json
import os
import re
import warnings

import numpy as np
from PIL import ImageFont

warnings.filterwarnings('ignore')
from psd_tools import PSDImage  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'BROADCAST GRAPHICS')
FONTS = {'regular': os.path.join(ROOT, 'graphics/fonts/LeagueGothic-Regular.otf'),
         'italic': os.path.join(ROOT, 'graphics/fonts/LeagueGothic-Italic.otf')}


def ink(text, size, font='regular'):
    f = ImageFont.truetype(FONTS[font], max(1, round(size * 4)) / 4)
    bb = f.getbbox(text)
    return bb[2] - bb[0]


def line_segments(layer, gap):
    """[(top, bottom, [(x0, x1), ...]), ...] from Photoshop's raster of the layer."""
    a = np.asarray(layer.topil().convert('RGBA'))[..., 3] > 60
    x0, y0 = layer.bbox[0], layer.bbox[1]
    rows = a.any(1)
    out, inb, s = [], False, 0
    for y, v in enumerate(list(rows) + [False]):
        if v and not inb:
            s, inb = y, True
        elif not v and inb:
            inb = False
            if y - s < 20:  # accents above capitals
                continue
            cm = a[s:y].any(0)
            segs, last = [], -999
            for x, vv in enumerate(cm):
                if vv:
                    if not segs or x - last > gap:
                        segs.append([x + x0, x + x0])
                    segs[-1][1] = x + x0
                    last = x
            out.append((s + y0, y + y0, segs))
    return out


def fit(samples):
    """samples: [(psd_width, our_ink_width, tracking_px_total)] → hscale"""
    num = sum((p - t) * m for p, m, t in samples)
    den = sum(m * m for p, m, t in samples)
    return round(num / den, 4) if den else 1.0


def layer(psd, pred):
    return next(l for l in psd.descendants() if l.kind == 'type' and l.visible and pred(l))


def text_lines(l):
    return [x for x in re.split(r'\r', l.text)]


def caps(s, on):
    return s.upper() if on else s


def main():
    cal = {}

    def add(tid, key, samples):
        cal.setdefault(tid, {})[key] = fit(samples)

    # comparison: values / ranks
    for tid, fname in [('comparison-men', 'Falco - Alba statösszevetés 1111 előtt.psd'),
                       ('comparison-women', 'DVTK - CSATA statösszevetés 1122 előtt.psd')]:
        psd = PSDImage.open(os.path.join(SRC, fname))
        for key, pred, trk in [('value', lambda l: re.match(r'^\d', l.name), 25),
                               ('rank', lambda l: l.name.startswith('('), None)]:
            samples = []
            for l in [x for x in psd.descendants() if x.kind == 'type' and x.visible and pred(x)]:
                st = l.engine_dict['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
                t = st.get('Tracking', 0) if trk is None else trk
                lines = [s for s in text_lines(l) if s.strip()]
                for (top, bot, segs), s in zip(line_segments(l, 40), lines):
                    w = segs[-1][1] - segs[0][0]
                    samples.append((w, ink(s, 74.667), t / 1000 * 74.667 * (len(s) - 1)))
            add(tid, key, samples)
        l = layer(psd, lambda l: l.name.startswith('A mérkőző'))
        (top, bot, segs), = line_segments(l, 60)[:1]
        s = l.text
        add(tid, 'subtitle', [(segs[-1][1] - segs[0][0], ink(s, 48, 'italic'), 10 / 1000 * 48 * (len(s) - 1))])

    # result / schedule rows: date, match, score columns
    rows = [('results-women', 'DVTK Last Games - 1025.psd', True), ('results-men', 'Falco  LAST Games Graph 1111.psd', True),
            ('schedule-women', 'DVTK Next Games - 1025.psd', False), ('schedule-men', 'Falco  Next Games Graph 1111.psd', False),
            ('resultrows-men', 'Férfi Next Games Graph.psd', True), ('resultrows-women', 'Női Next Games Graph.psd', True)]
    for tid, fname, has_score in rows:
        psd = PSDImage.open(os.path.join(SRC, fname))
        l = layer(psd, lambda l: re.search(r'\d{4}\.\d\d', l.text))
        lines = [s for s in text_lines(l) if s.strip()]
        samples = {'date': [], 'match': [], 'score': []}
        for (top, bot, segs), s in zip(line_segments(l, 24), lines):
            cells = [c.strip() for c in s.split('\t') if c.strip()]
            date, rest = cells[0], cells[1:]
            score = rest[-1] if has_score and re.match(r'^\d+-\d+$', rest[-1]) else None
            match = ' '.join(rest[:-1] if score else rest)
            match = re.sub(r'\s+', ' ', match).upper()
            tr = lambda x: 25 / 1000 * 75 * (len(x) - 1)
            # date: first segment; score: last segment (when present)
            samples['date'].append((segs[0][1] - segs[0][0], ink(date.upper(), 75), tr(date)))
            if score:
                samples['score'].append((segs[-1][1] - segs[-1][0], ink(score, 75), tr(score)))
            mid = segs[1:-1] if score else segs[1:]
            if mid:
                samples['match'].append((mid[-1][1] - mid[0][0], ink(match, 75), tr(match)))
        for k, v in samples.items():
            if v:
                add(tid, k, v)
        t = layer(psd, lambda l: l.text.startswith('A '))
        segs = line_segments(t, 60)
        tl = [s for s in text_lines(t) if s.strip()]
        add(tid, 'title', [(sg[-1][1] - sg[0][0], ink(s.upper(), 100), 10 / 1000 * 100 * (len(s) - 1)) for (a, b, sg), s in zip(segs, tl)])

    # team stats table: names and figures
    for tid, fname, size, scale in [('teamstats-women', 'DVTK csapatstat 7. ford után 1122.psd', 58.333, 1.3589),
                                    ('teamstats-men', 'Falco csapatstat 9. ford után 1114.psd', 55.95, 1.3033)]:
        psd = PSDImage.open(os.path.join(SRC, fname))
        l = layer(psd, lambda l: 'Játékos' in l.text)
        lines = [s for s in text_lines(l) if s.strip()][1:]
        segl = line_segments(l, 14)[1:]
        samples = {'name': [], 'figure': []}
        for (top, bot, segs), s in zip(segl, lines):
            cells = [c.strip() for c in s.split('\t') if c.strip()]
            name = cells[1].replace('©', '').strip().upper()
            # name segments: everything between the number and x < 780
            nsegs = [g for g in segs[1:] if g[0] < 760]
            samples['name'].append((nsegs[-1][1] - nsegs[0][0], ink(name, size), 25 / 1000 * size * (len(name) - 1)))
            figs = [g for g in segs if g[0] > 760]
            for g, c in zip(figs, cells[2:]):
                if len(c) >= 3:
                    samples['figure'].append((g[1] - g[0], ink(c, size), 25 / 1000 * size * (len(c) - 1)))
        for k, v in samples.items():
            add(tid, k, v)
        t = layer(psd, lambda l: 'Játékos' not in l.text)
        (a, b, sg), = line_segments(t, 60)[:1]
        tsize = 100 * (0.9591 if tid.endswith('men') and 'women' not in tid else 1)
        add(tid, 'teamname', [(sg[-1][1] - sg[0][0], ink(t.text.upper(), tsize), 50 / 1000 * tsize * (len(t.text) - 1))])

    # intro + referees: single-line texts
    for tid, fname in [('intro-men', 'Férfi Intro Graph 26-27.psd'), ('intro-women', 'Női Intro Graph 26-27.psd')]:
        psd = PSDImage.open(os.path.join(SRC, fname))
        for key, pred, font in [('name', lambda l: l.name.isupper() and 'CSOPORT' not in l.name and not l.name.startswith('('), 'regular'),
                                ('round', lambda l: l.name.startswith('Alapszakasz'), None),
                                ('venue', lambda l: l.name in ('Novomatic Aréna', 'Olimpiai Sport Park'), 'regular')]:
            samples = []
            for l in [x for x in psd.descendants() if x.kind == 'type' and x.visible and x.text.strip() and pred(x)]:
                r0 = l.engine_dict['StyleRun']['RunArray'][0]['StyleSheet']['StyleSheetData']
                fnt = font or ('italic' if 'Italic' in str(l.resource_dict['FontSet'][r0['Font']]['Name']) else 'regular')
                size, trk = float(r0['FontSize']), float(r0.get('Tracking', 0))
                for (a, b, sg), s in zip(line_segments(l, 60), [x for x in text_lines(l) if x.strip()]):
                    s2 = caps(s, key == 'name')
                    samples.append((sg[-1][1] - sg[0][0], ink(s2, size, fnt), trk / 1000 * size * (len(s2) - 1)))
            add(tid, key, samples)
    psd = PSDImage.open(os.path.join(SRC, 'Sporik női alap.psd'))
    l = layer(psd, lambda l: True)
    segl = line_segments(l, 60)
    names = [s.strip() for s in text_lines(l) if s.strip()][:3]
    samples = [(sg[-1][1] - sg[0][0], ink(s.upper(), 58.333), 10 / 1000 * 58.333 * (len(s) - 1)) for (a, b, sg), s in zip(segl[:3], names)]
    for tid in ('referees-men', 'referees-women'):
        add(tid, 'name', samples)
        # controller line: label + name
        a, b, sg = segl[3]
        add(tid, 'controller', [(sg[0][1] - sg[0][0], ink('MKOSZ Ellenőr:', 45.833), 25 / 1000 * 45.833 * 13),
                                (sg[-1][1] - sg[-1][0], ink('Szabó Anita', 45.833), 25 / 1000 * 45.833 * 10)])

    out = os.path.join(ROOT, 'graphics/js/calibration.js')
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write('// Generated by tools/calibrate_text.py – horizontal text scale per template element group,\n'
                 '// fitted to the widths Photoshop rendered in the source PSDs. Do not edit by hand.\n')
        fh.write('export const HSCALE = ' + json.dumps(cal, indent=1, ensure_ascii=False) + ';\n')
    for k, v in cal.items():
        print(k.ljust(18), v)


if __name__ == '__main__':
    main()
