#!/usr/bin/env python3
"""Fits every universe octopus to the hero's silhouette, for startup sequence v3.

Owner, 2026-09-29, on v2: "you tracked the eyes but you didn't resize them, so the silhouette isn't the same.
Resize them all so they conform to the size of the main hero octopus."

v2 only scaled each universe evenly (startup_align.py), so heads were fatter and arms longer or shorter than the
hero's. This takes the aligned layers (eyes already on the hero's) and warps each one:
  * vertically, piecewise-linear between three anchors (head top, eye line, arm tips) so head height and arm
    length match the hero's;
  * horizontally, row by row, left and right of the eye midline, so the width at every height matches;
the eye line and the eye midline are fixed points, so the eyes stay pinned. Things above the head (sprout's stem
and leaf) ride along with the head top.

    python3 tools/brand/startup_fit.py ALIGNED_DIR IDLE_FRAME OUT_DIR
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from startup_align import ORDER, PAD  # noqa: E402

LAYER = (1024, 1400)
LEYE = (PAD[0] + 387, PAD[1] + 296)
STRIP = 4
SMOOTH = 14
SCALE_RANGE = (0.62, 1.4)
TIP_EASE = 70           # rows above the arm tips over which the width scale eases back to 1 (no stretched slivers)


def profile(layer):
    """Per row: (left extent, right extent) from the eye midline, or None where the row is empty."""
    a = layer.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    rows = []
    for y in range(LAYER[1]):
        bb = a.crop((0, y, LAYER[0], y + 1)).getbbox()
        rows.append(None if bb is None else (LEYE[0] - bb[0], bb[2] - LEYE[0]))
    return rows


def anchors(rows):
    """Head top (first row that is a real head, not a leaf or stem) and arm tips (last row of any substance)."""
    widths = [(r[0] + r[1]) if r else 0 for r in rows]
    mx = max(widths)
    top = next(y for y, w in enumerate(widths) if w >= 0.5 * mx)
    bottom = max(y for y, w in enumerate(widths) if w >= 0.04 * mx)
    return top, bottom


def smooth(vals):
    out = []
    for i in range(len(vals)):
        seg = vals[max(0, i - SMOOTH):i + SMOOTH + 1]
        out.append(sum(seg) / len(seg))
    return out


def piecewise(y, pts):
    """Linear through pts (sorted (x, y) pairs); slope 1 beyond the ends."""
    if y <= pts[0][0]:
        return pts[0][1] + (y - pts[0][0])
    for (x0, v0), (x1, v1) in zip(pts, pts[1:]):
        if y <= x1:
            return v0 + (v1 - v0) * (y - x0) / (x1 - x0)
    return pts[-1][1] + (y - pts[-1][0])


def fit(layer, hero_rows, hero_anc):
    rows = profile(layer)
    top, bottom = anchors(rows)
    ht, hb = hero_anc
    eye = LEYE[1]
    # output row → source row
    ymap = [(ht, top), (eye, eye), (hb, bottom)]
    src_y = [piecewise(y, ymap) for y in range(LAYER[1] + 1)]

    def ext(rowlist, y, side):
        yi = min(LAYER[1] - 1, max(0, round(y)))
        r = rowlist[yi]
        return r[side] if r else None

    scales = []
    for side in (0, 1):
        raw = []
        for y in range(LAYER[1]):
            h, u = ext(hero_rows, y, side), ext(rows, src_y[y], side)
            raw.append(h / u if h and u and u > 20 and h > 20 else None)
        # holes (outside either silhouette) take the nearest known scale
        known = [i for i, v in enumerate(raw) if v is not None]
        filled = [raw[min(known, key=lambda k: abs(k - i))] for i in range(LAYER[1])]
        sm = smooth([min(SCALE_RANGE[1], max(SCALE_RANGE[0], v)) for v in filled])
        for y in range(LAYER[1]):
            k = min(1.0, max(0.0, (hb - y) / TIP_EASE))
            sm[y] = 1 + (sm[y] - 1) * k
        scales.append(sm)

    out = Image.new('RGBA', LAYER, (0, 0, 0, 0))
    mesh = []
    for y0 in range(0, LAYER[1], STRIP):
        y1 = min(LAYER[1], y0 + STRIP)
        ym = (y0 + y1) // 2
        sy0, sy1 = src_y[y0], src_y[y1]
        sl, sr = scales[0][ym], scales[1][ym]
        # left half: output x in [0, cx] maps from source cx - (cx - x) / sl
        xl = LEYE[0] - LEYE[0] / sl
        xr = LEYE[0] + (LAYER[0] - LEYE[0]) / sr
        mesh.append(((0, y0, LEYE[0], y1), (xl, sy0, xl, sy1, LEYE[0], sy1, LEYE[0], sy0)))
        mesh.append(((LEYE[0], y0, LAYER[0], y1), (LEYE[0], sy0, LEYE[0], sy1, xr, sy1, xr, sy0)))
    out = layer.transform(LAYER, Image.MESH, mesh, Image.BICUBIC)
    return out, (top, bottom), scales


def main(aligned_dir, idle_frame, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    hero = Image.new('RGBA', LAYER, (0, 0, 0, 0))
    hero.alpha_composite(Image.open(idle_frame).convert('RGBA'), PAD)
    hero_rows = profile(hero)
    hero_anc = anchors(hero_rows)
    print(f'hero head top {hero_anc[0]}, arm tips {hero_anc[1]}')
    onion = Image.new('RGBA', LAYER, (0, 0, 0, 255))
    for name in ORDER:
        layer = Image.open(Path(aligned_dir) / f'{name}.png').convert('RGBA')
        fitted, anc, sc = fit(layer, hero_rows, hero_anc)
        fitted.save(out / f'{name}.png')
        ghost = fitted.copy()
        ghost.putalpha(fitted.getchannel('A').point(lambda v: v * 30 // 100))
        onion.alpha_composite(ghost)
        print(f'{name:11s} head top {anc[0]} → {hero_anc[0]}, arm tips {anc[1]} → {hero_anc[1]}, '
              f'width scale L {min(sc[0]):.2f}-{max(sc[0]):.2f} R {min(sc[1]):.2f}-{max(sc[1]):.2f}')
    onion.save(out / 'onion-check.png')


if __name__ == '__main__':
    main(*sys.argv[1:4])
