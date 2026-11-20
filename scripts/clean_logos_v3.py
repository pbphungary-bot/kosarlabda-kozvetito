import sys, os, glob, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
SP = sys.argv[1]; OUT = sys.argv[2]
ROUND = {'men/atomermomuse','men/szedeak','men/sopron','men/nkapecs','women/nkauniversitaspecs','women/sercounigyor','women/vasasakademia','men/falcokc'}
KEEP_PREV = {'men/deac','men/oroszlany','men/kecskemet','women/sopronbasket','women/tarrkscszekszard'}  # plate-colour removal from first pass worked
SCALE = 3
def finish(rgb, alpha01, name):
    a = np.dstack([rgb.astype(np.uint8), (alpha01 * 255).astype(np.uint8)]); im = Image.fromarray(a, 'RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    big = im.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS); arr = np.array(big)
    al = np.array(Image.fromarray(arr[..., 3]).filter(ImageFilter.GaussianBlur(SCALE * 0.5))).astype(float)
    arr[..., 3] = np.clip((al - 70) * 255 / 110, 0, 255).astype(np.uint8)
    dst = f'{OUT}/{name}.png'; os.makedirs(os.path.dirname(dst), exist_ok=True); Image.fromarray(arr).save(dst, optimize=True)
for f in sorted(glob.glob(SP + '/logos_sheet_raw/*/*.png')):
    name = f.split('/logos_sheet_raw/')[1][:-4]
    if name in KEEP_PREV:
        os.makedirs(os.path.dirname(f'{OUT}/{name}.png'), exist_ok=True); Image.open(f'{SP}/logos_new/{name}.png').save(f'{OUT}/{name}.png'); continue
    rgb = np.array(Image.open(f).convert('RGB')).astype(int)
    h, w = rgb.shape[:2]
    ring = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]); plated = ((255 - ring.min(axis=1)) > 6).mean() > 0.85
    fg = np.ones((h, w), bool)
    if plated or name in ROUND:
        s = 1 if name in ROUND else 3; rgb = rgb[s:-s, s:-s]; h, w = rgb.shape[:2]
        light = (rgb.min(axis=2) >= 185) & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 26)
        if name in ROUND:
            fg = np.ones((h, w), bool)
        else:
            le = ndi.binary_erosion(light, iterations=1, border_value=1)   # thin outlines must not leak
            lab, _ = ndi.label(le); border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
            bgm = ndi.binary_dilation(np.isin(lab, list(border)), iterations=1) & light
            fg = ~bgm
        l2, n = ndi.label(fg); sizes = ndi.sum(fg, l2, range(1, n + 1)); fg = np.isin(l2, [i + 1 for i, z in enumerate(sizes) if z >= 0.04 * sizes.max()])
        fg = fg if name in ROUND else ndi.binary_fill_holes(fg)
        if name in ROUND:
            m = Image.new('L', (w * 4, h * 4), 0); ImageDraw.Draw(m).ellipse([0, 0, w * 4 - 1, h * 4 - 1], fill=255)
            fg = fg | False; fg = fg & (np.array(m.resize((w, h), Image.LANCZOS)) > 128)
    else:
        light = (rgb.min(axis=2) >= 205) & ((rgb.max(axis=2) - rgb.min(axis=2)) <= 20)
        le = ndi.binary_erosion(light, iterations=1, border_value=1)
        lab, _ = ndi.label(le); border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        bgm = ndi.binary_dilation(np.isin(lab, list(border)), iterations=1) & light
        fg = ~bgm
        l2, n = ndi.label(fg); sizes = ndi.sum(fg, l2, range(1, n + 1)); fg = np.isin(l2, [i + 1 for i, z in enumerate(sizes) if z >= 0.04 * sizes.max()])
        fg = ndi.binary_fill_holes(fg)
    print(name, 'plated' if plated else 'free')
    finish(rgb, fg.astype(float), name)
