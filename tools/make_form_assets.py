#!/usr/bin/env python3
"""Assets of the form graphic: the win / loss badges (League Gothic letters in a circle) and the compact panels
. Run: python3 tools/make_form_assets.py"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(ROOT, 'graphics')
FONT = os.path.join(G, 'fonts', 'LeagueGothic-Regular.otf')
S = 4  # supersampling


def badge(letter, fill, path, d=184):
    big = Image.new('RGBA', (d * S, d * S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(big)
    m = 10 * S
    dr.ellipse((m, m, d * S - m, d * S - m), fill=(0, 0, 0, 200))            # soft dark rim (reads on any background)
    m2 = 16 * S
    dr.ellipse((m2, m2, d * S - m2, d * S - m2), fill=fill, outline=(255, 255, 255, 255), width=6 * S)
    f = ImageFont.truetype(FONT, int(d * 0.62 * S))
    bb = dr.textbbox((0, 0), letter, font=f)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    dr.text(((d * S - w) / 2 - bb[0], (d * S - h) / 2 - bb[1] - 2 * S), letter, font=f, fill=(255, 255, 255, 255))
    big.resize((d, d), Image.LANCZOS).save(path, optimize=True)


if __name__ == '__main__':
    os.makedirs(os.path.join(G, 'assets', 'form'), exist_ok=True)
    badge('GY', (31, 191, 27, 255), os.path.join(G, 'assets', 'form', 'win.png'))
    badge('V', (236, 64, 54, 255), os.path.join(G, 'assets', 'form', 'loss.png'))
    # the panels of the form / head-to-head graphics are drawn by the studio (resizable shapes filled with assets/court/<league>.jpg)
    print('ok')
