"""Export sponsor and partner logos as transparent WebP for the dark tiles on breaq.html.

Sources are the PNGs in images/; output goes to images/opt/logos/. Run from anywhere:

    python tools/export-logos.py

Modes:
  key   remove a flat background colour (sampled from the border), de-matting the edges
  mono  same, but paint what remains white (for a logo that is dark on light)
  keep  the source already has transparency; just crop and resize

Needs Pillow and numpy. A logo that must keep its brand background (Artesana) is exported
in colour and its tile carries the background colour via --tile-bg in the markup.
"""
import os
import numpy as np
from PIL import Image

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = 'images/opt/logos'
os.makedirs(OUT, exist_ok=True)

JOBS = [
    # name,        source,                  mode,   max px
    ('fsas',       'images/Fsas.png',       'key',  900),
    ('nxp',        'images/nxp.png',        'keep', 900),
    ('sap',        'images/sap.png',        'keep', 900),
    ('artesana',   'images/artesana.png',   'key',  900),
    ('kfea',       'images/kfea.png',       'mono', 900),
    ('sipit',      'images/sipit.png',      'keep', 900),   # rendered from the vector PDF they sent
    ('aqora',      'images/aqora_logo.png', 'key',  900),
    ('ita',        'images/ITA.png',        'key',  900),
    ('sts',        'images/STS.png',        'key',  900),
    ('2space',     'images/2space.png',     'key',  900),
]

def border_colour(a):
    h, w = a.shape[:2]
    band = max(2, int(min(h, w) * 0.04))
    edge = np.concatenate([a[:band].reshape(-1, 4), a[-band:].reshape(-1, 4),
                           a[:, :band].reshape(-1, 4), a[:, -band:].reshape(-1, 4)])
    edge = edge[edge[:, 3] > 200]
    return np.median(edge[:, :3], axis=0)

def process(name, src, mode, maxpx):
    im = Image.open(src).convert('RGBA')
    a = np.asarray(im).astype(np.float64)
    rgb, alpha = a[..., :3], a[..., 3] / 255.0

    if mode in ('key', 'mono'):
        bg = border_colour(a)
        dist = np.sqrt(((rgb - bg) ** 2).sum(-1))
        t0, t1 = 14.0, 80.0
        k = np.clip((dist - t0) / (t1 - t0), 0, 1)
        new_alpha = alpha * k
        if mode == 'mono':
            out_rgb = np.full_like(rgb, 255.0)
        else:
            # de-matte: the pixel was bg * (1 - k) + colour * k
            kk = np.maximum(k, 1e-3)[..., None]
            out_rgb = np.clip((rgb - bg * (1 - kk)) / kk, 0, 255)
        rgb, alpha = out_rgb, new_alpha

    out = np.dstack([rgb, alpha * 255.0]).round().astype(np.uint8)
    im = Image.fromarray(out, 'RGBA')

    # crop to content, with a little air
    mask = out[..., 3] > 8
    ys, xs = np.where(mask)
    pad = int(max(im.size) * 0.02)
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad),
           min(im.width, xs.max() + 1 + pad), min(im.height, ys.max() + 1 + pad))
    im = im.crop(box)

    if max(im.size) > maxpx:
        s = maxpx / max(im.size)
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)

    path = f'{OUT}/{name}.webp'
    lossless = max(im.size) < 200
    im.save(path, 'WEBP', quality=88, method=6, lossless=lossless)
    print(f'{name:10s} {mode:4s} {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB')

if __name__ == '__main__':
    for job in JOBS:
        process(*job)
