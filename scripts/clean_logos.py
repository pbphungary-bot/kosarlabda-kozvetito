import sys, glob, os
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

SCALE = 3
PLATES = {'men/kecskemet':(10,1),'men/nkapecs':(10,1),'women/nkauniversitaspecs':(10,1),'men/oroszlany':(10,2),'women/sopronbasket':(10,1),'men/deac':(8,1),'women/sercounigyor':(8,1)}

def clean(src, dst, tol=None, passes=0):
    im = Image.open(src).convert('RGBA'); a = np.array(im); h, w = a.shape[:2]
    transparent = a[..., 3] < 128
    rgb = a[..., :3].astype(int)
    opaque = ~transparent
    bg = np.zeros((h, w), bool); frac = 0
    cur = transparent.copy()
    for _ in range(passes):
        opq = ~cur & ~bg
        pad = np.pad(~opq, 1, constant_values=True)
        touch = opq & (pad[:-2,1:-1] | pad[2:,1:-1] | pad[1:-1,:-2] | pad[1:-1,2:])
        ty, tx = np.where(touch)
        if not len(ty): break
        q = (rgb[ty, tx] // 12); keys, counts = np.unique(q, axis=0, return_counts=True)
        ref = keys[counts.argmax()] * 12 + 6; frac = counts.max() / len(ty)
        dq = deque((y, x) for y, x in zip(ty, tx) if np.abs(rgb[y, x] - ref).max() <= tol)
        for y, x in dq: bg[y, x] = True
        while dq:
            y, x = dq.popleft()
            for ny, nx in ((y-1,x),(y+1,x),(y,x-1),(y,x+1)):
                if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and not transparent[ny, nx] and np.abs(rgb[ny, nx] - ref).max() <= tol:
                    bg[ny, nx] = True; dq.append((ny, nx))
        cur = transparent | bg
    keep = opaque & ~bg
    # defringe: drop 1px ring that blends plate colour
    pk = np.pad(keep, 1)
    eroded = keep & pk[:-2,1:-1] & pk[2:,1:-1] & pk[1:-1,:-2] & pk[1:-1,2:]
    # only erode where the ring borders removed plate
    near_bg = np.zeros_like(keep)
    pb = np.pad(bg, 1)
    near_bg = pb[:-2,1:-1] | pb[2:,1:-1] | pb[1:-1,:-2] | pb[1:-1,2:]
    keep = np.where(near_bg & ~eroded, False, keep) if passes else keep
    out = a.copy(); out[..., 3] = np.where(keep, 255, 0)
    # fill colour under transparent pixels with nearest logo colour to avoid dark/white halos when scaling
    img = Image.fromarray(out)
    # crop to content
    bbox = img.getchannel('A').getbbox()
    img = img.crop(bbox)
    W, H = img.size
    big = img.resize((W*SCALE, H*SCALE), Image.LANCZOS)
    al = np.array(big)[..., 3]
    # premultiplied-style cleanup: smooth alpha for antialiased edges
    alpha = Image.fromarray(al).filter(ImageFilter.GaussianBlur(SCALE*0.55))
    arr = np.array(big); arr[..., 3] = np.array(alpha)
    # soft threshold so interior stays fully opaque
    t = arr[..., 3].astype(float); t = np.clip((t - 40) * 255 / (215 - 40), 0, 255)
    arr[..., 3] = t.astype(np.uint8)
    Image.fromarray(arr).save(dst, optimize=True)
    return frac, (W, H)

for f in sorted(glob.glob(sys.argv[1] + '/*/*.png')):
    dst = os.path.join(sys.argv[2], os.path.relpath(f, sys.argv[1]))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    key=os.path.relpath(f, sys.argv[1])[:-4]; tol,ps=PLATES.get(key,(0,0)); fr, sz = clean(f, dst, tol, ps); print(os.path.relpath(f, sys.argv[1]), 'plate=%.2f' % fr, sz)
