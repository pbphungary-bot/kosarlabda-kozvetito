#!/usr/bin/env python3
"""Assets of the form graphic: the win / loss badges (League Gothic letters in a circle) and the compact panels
(court texture of the roster design, rounded, with the league's border colour). Run: python3 tools/make_form_assets.py"""
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


def panel(src, box, border, path, alpha=246):
    """1920x1080 transparent canvas with the court-textured panel at box = (x0, y0, x1, y1)."""
    tex = Image.open(src).convert('RGBA')
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    # interior texture of the roster panel (away from its own border and logo area)
    crop = tex.crop((700, 90, 700 + w, 90 + h)) if tex.width >= 700 + w and tex.height >= 90 + h else tex.resize((w, h))
    r = 28
    mask = Image.new('L', (w * 2, h * 2), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius=r * 2, fill=alpha)
    mask = mask.resize((w, h), Image.LANCZOS)
    out = Image.new('RGBA', (1920, 1080), (0, 0, 0, 0))
    panel_img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    panel_img.paste(crop.convert('RGB'), (0, 0))
    panel_img.putalpha(mask)
    ring = Image.new('RGBA', (w * 2, h * 2), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle((0, 0, w * 2 - 1, h * 2 - 1), radius=r * 2, outline=border + (255,), width=12)
    panel_img.alpha_composite(ring.resize((w, h), Image.LANCZOS))
    out.alpha_composite(panel_img, (x0, y0))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path, optimize=True)


if __name__ == '__main__':
    os.makedirs(os.path.join(G, 'assets', 'form'), exist_ok=True)
    badge('GY', (31, 191, 27, 255), os.path.join(G, 'assets', 'form', 'win.png'))
    badge('V', (236, 64, 54, 255), os.path.join(G, 'assets', 'form', 'loss.png'))
    for lg, border in (('men', (11, 148, 68)), ('women', (236, 64, 54))):
        src = os.path.join(G, 'templates', f'roster-{lg}', 'background.png')
        panel(src, (40, 40, 1000, 303), border, os.path.join(G, 'templates', f'form-{lg}', 'background.png'))
        panel(src, (40, 40, 1000, 518), border, os.path.join(G, 'templates', f'formpair-{lg}', 'background.png'))
    print('ok')
