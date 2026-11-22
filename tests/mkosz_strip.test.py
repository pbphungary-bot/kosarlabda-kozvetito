"""The Play By Play logo must never be visible: every design that had it shows the MKOSZ logo instead,
placed like in the comparison / team-stat designs (40 px right of the Tippmix mark, centred on the Hunbasket mark).
Run: python3 tests/mkosz_strip.test.py"""
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / 'graphics' / 'templates'
ASSET = Image.open(ROOT / 'graphics' / 'assets' / 'mkosz-strip.png').convert('RGBA')


def layers(tid):
    return {l['name']: l for l in json.loads((TPL / tid / 'layers.json').read_text(encoding='utf-8'))['layers']}


def bbox(tid, prefix):
    return next(l['bbox'] for n, l in layers(tid).items() if n.startswith(prefix))


class MkoszStrip(unittest.TestCase):
    def test_every_design_that_had_pbp_shows_mkosz(self):
        swapped = [d.name for d in TPL.iterdir() if d.is_dir() and 'pbp_logo' in layers(d.name)] if False else [
            d.name for d in sorted(TPL.iterdir()) if (d / 'layers.json').exists() and 'pbp_logo' in layers(d.name)]
        self.assertEqual(len(swapped), 9, swapped)
        for tid in swapped:
            with self.subTest(template=tid):
                pbp = layers(tid)['pbp_logo']['bbox']
                hb, tp = bbox(tid, '74641_HUNBASKET'), bbox(tid, 'tippmix')
                x0 = tp[2] + 40
                y0 = round((hb[1] + hb[3]) / 2 - ASSET.height / 2)
                for name in ('background.png', 'reference.png'):
                    img = Image.open(TPL / tid / name).convert('RGBA')
                    box = img.crop((x0, y0, x0 + ASSET.width, y0 + ASSET.height))
                    a, b = np.asarray(box).astype(int), np.asarray(ASSET).astype(int)
                    solid = b[..., 3] > 200
                    self.assertLess(np.abs(a[solid] - b[solid]).max(), 3, f'{tid}/{name}: MKOSZ logo not at the expected place')
                    # nothing of the old Play By Play logo is left (outside the new MKOSZ logo)
                    m = 14
                    region = np.asarray(img.crop((pbp[0] - m, pbp[1] - m, pbp[2] + m, pbp[3] + m)))[..., 3].copy()
                    rx0, ry0 = pbp[0] - m, pbp[1] - m
                    sub_x0, sub_y0 = max(x0 - rx0, 0), max(y0 - ry0, 0)
                    sub_x1, sub_y1 = min(x0 + ASSET.width - rx0, region.shape[1]), min(y0 + ASSET.height - ry0, region.shape[0])
                    if sub_x1 > sub_x0 and sub_y1 > sub_y0:
                        region[sub_y0:sub_y1, sub_x0:sub_x1] = 0
                    self.assertEqual(int(region.max()), 0, f'{tid}/{name}: pixels of the old logo remain')

    def test_asset_is_the_comparison_designs_mkosz_mark(self):
        self.assertEqual(ASSET.size, (116, 60))


if __name__ == '__main__':
    unittest.main()
