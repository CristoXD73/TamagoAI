#!/usr/bin/env python3
"""Lines the owner's universe octopuses up on the hero, for the startup sequence.

Input: the cut-outs (tools/brand/liftsubject.swift) and the idle loop's first frame (the pose the sequence lands
on). Each octopus is scaled and moved so its two eyes land on the hero's eyes; the scale also leans on the body's
height so the arms reach about the same length. Output: one 768 x 1024 RGBA per universe, plus an onion-skin check.

    python3 tools/brand/startup_align.py CUT_DIR IDLE_FRAME OUT_DIR
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

# The aligned canvas is the idle frame plus headroom (the sprout's leaf) and side room; the hero sits at PAD.
PAD = (128, 280)
CANVAS = (768 + 256, 1024 + 280 + 96)
ORDER = ['neon', 'ink', 'stone-moss', 'velvet', 'sprout', 'metal', 'xray', 'cardboard']

# Eye centres read off a coordinate grid, in each cut-out's own pixels. The detector below confuses neon's dark
# head with its eyes and catches the lid shadow under the others (checked visually, 2026-09-29).
MANUAL_EYES = {
    'neon': ((313, 373), (755, 383)),
    'stone-moss': ((313, 360), (749, 358)),
    'velvet': ((309, 346), (763, 346)),
    'xray': ((292, 352), (745, 352)),
    'cardboard': ((331, 342), (755, 342)),
}


def eyes(im):
    """Centres of the two dark eyes: the darkest blobs in the upper-left and upper-right of the subject."""
    a = im.getchannel('A')
    x0, y0, x1, y1 = a.point(lambda v: 255 if v > 40 else 0).getbbox()
    w, h = x1 - x0, y1 - y0
    g = im.convert('L')
    found = []
    for fx0, fx1 in ((0.08, 0.45), (0.55, 0.92)):
        box = (int(x0 + w * fx0), int(y0 + h * 0.12), int(x0 + w * fx1), int(y0 + h * 0.42))
        pts = []
        gray, alpha = g.crop(box), a.crop(box)
        gp, ap = gray.load(), alpha.load()
        vals = sorted(gp[x, y] for y in range(gray.height) for x in range(gray.width) if ap[x, y] > 200)
        cut = vals[max(0, len(vals) // 25)] + 6          # the darkest ~4 % of the window
        for y in range(gray.height):
            for x in range(gray.width):
                if ap[x, y] > 200 and gp[x, y] <= cut:
                    pts.append((x, y))
        cx = sum(p[0] for p in pts) / len(pts) + box[0]
        cy = sum(p[1] for p in pts) / len(pts) + box[1]
        found.append((cx, cy))
    return found, (x0, y0, x1, y1)


def main(cut_dir, idle_frame, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    hero = Image.open(idle_frame).convert('RGBA')
    (hl, hr), hbb = eyes(hero)
    hero_eye_dist = hr[0] - hl[0]
    hero_mid = ((hl[0] + hr[0]) / 2, (hl[1] + hr[1]) / 2)
    hero_h = hbb[3] - hero_mid[1]          # eyes to arm tips: a leaf or a crown on top shouldn't count
    print(f'hero eyes {hl} {hr}, height {hero_h}')
    onion = Image.new('RGBA', CANVAS, (0, 0, 0, 255))
    for name in ORDER:
        im = Image.open(Path(cut_dir) / f'{name}.png').convert('RGBA')
        (l, r), bb = eyes(im)
        l, r = MANUAL_EYES.get(name, (l, r))
        by_eyes = hero_eye_dist / (r[0] - l[0])
        by_height = hero_h / (bb[3] - (l[1] + r[1]) / 2)
        s = by_eyes * 0.6 + by_height * 0.4
        scaled = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        mid = ((l[0] + r[0]) / 2 * s, (l[1] + r[1]) / 2 * s)
        canvas = Image.new('RGBA', CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(scaled, (round(PAD[0] + hero_mid[0] - mid[0]), round(PAD[1] + hero_mid[1] - mid[1])))
        canvas.save(out / f'{name}.png')
        ghost = canvas.copy()
        ghost.putalpha(canvas.getchannel('A').point(lambda v: v * 30 // 100))
        onion.alpha_composite(ghost)
        print(f'{name:11s} eyes {tuple(round(v) for v in l)} {tuple(round(v) for v in r)}  scale {s:.3f} '
              f'(eyes {by_eyes:.3f}, height {by_height:.3f})')
    ghost = hero.copy()
    ghost.putalpha(hero.getchannel('A').point(lambda v: v * 45 // 100))
    onion.alpha_composite(ghost, PAD)
    onion.save(out / 'onion.png')


if __name__ == '__main__':
    main(*sys.argv[1:4])
