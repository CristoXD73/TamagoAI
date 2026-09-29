#!/usr/bin/env python3
"""Pixel versions of Tamago's hero, for owner review (docs/VISUAL_APPROVAL_GATE.md). Not app code.

Three takes on the same approved octopus (Assets/CharacterReference/octopus-v001):
  A  faithful  - the approved front render, reduced to pixels and put on the brand palette
  B  mascot    - 32 x 32 chibi brand character: big head, lidded glossy eyes, blush, smile, one arm waving
  C  hero      - 48 px hand-shaded front view with the real proportions and one gesture (a wave)

B and C are drawn procedurally: shapes are an ellipse head and tapering tentacle tubes (turtle paths that curl at
the tip). Each pixel is lit as a 3D surface (sphere or tube normal against a top-left light) and snapped to five
pearl tones, then outlined. Pillow only, no numpy.

    python3 tools/pixel/pixel_hero.py OUT_DIR
"""
import math
import sys
from pathlib import Path

from PIL import Image

SOURCE = Path('/Volumes/Storage/Projects/TamagoAI-widget-release/docs/prototypes/idle-front-v1/octopus-front-source.png')

PAL = {
    'out': (30, 30, 52),
    't0': (255, 255, 255), 't1': (243, 238, 234), 't2': (222, 213, 209), 't3': (190, 178, 182), 't4': (142, 130, 148),
    'p1': (248, 204, 182), 'p2': (218, 158, 138),
    'eye': (13, 15, 25), 'eye2': (58, 64, 92), 'hi': (255, 255, 255),
    'blush': (246, 158, 160), 'mouth': (96, 54, 72),
}
TONES = ['t0', 't1', 't2', 't3', 't4']
_l = (-0.5, -0.72, 0.62)
_n = math.sqrt(sum(c * c for c in _l))
LIGHT = tuple(c / _n for c in _l)


def tone(nx, ny, nz, shift=0):
    i = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
    k = 0 if i > 0.86 else 1 if i > 0.56 else 2 if i > 0.3 else 3 if i > 0.08 else 4
    return TONES[min(4, k + shift)]


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.col = [[None] * w for _ in range(h)]
        self.grp = [[-1] * w for _ in range(h)]
        self.layer = [[-1] * w for _ in range(h)]
        self.n = 0

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.col[y][x] = c

    def ellipse(self, cx, cy, rx, ry, group, shift=0):
        self.n += 1
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if not (0 <= x < self.w and 0 <= y < self.h):
                    continue
                u, v = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                r2 = u * u + v * v
                if r2 <= 1:
                    self.col[y][x] = tone(u, v, math.sqrt(1 - r2), shift)
                    self.grp[y][x], self.layer[y][x] = group, self.n

    def tube(self, pts, r0, r1, group, shift=0, suckers=0):
        """pts: centerline samples; radius tapers r0 -> r1. suckers: +1 / -1 side, 0 none."""
        self.n += 1
        m = len(pts)
        radii = [r1 + (r0 - r1) * (1 - i / (m - 1)) ** 0.9 for i in range(m)]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        for y in range(int(min(ys) - r0) - 1, int(max(ys) + r0) + 2):
            for x in range(int(min(xs) - r0) - 1, int(max(xs) + r0) + 2):
                if not (0 <= x < self.w and 0 <= y < self.h):
                    continue
                px, py = x + 0.5, y + 0.5
                best, bi = 1e9, -1
                for i, (cx, cy) in enumerate(pts):
                    d = math.hypot(px - cx, py - cy) - radii[i]
                    if d < best:
                        best, bi = d, i
                if best <= 0:
                    cx, cy = pts[bi]
                    r = radii[bi]
                    u, v = (px - cx) / r, (py - cy) / r
                    s = min(1.0, u * u + v * v)
                    self.col[y][x] = tone(u, v, math.sqrt(1 - s), shift)
                    self.grp[y][x], self.layer[y][x] = group, self.n
        if suckers:
            step = max(3, int(len(pts) * 0.06))
            for i in range(int(m * 0.55), m - 2, step):
                (ax, ay), (bx, by) = pts[i], pts[min(m - 1, i + 1)]
                dx, dy = bx - ax, by - ay
                dl = math.hypot(dx, dy) or 1
                nx, ny = -dy / dl * suckers, dx / dl * suckers
                r = radii[i]
                if r < 0.9:
                    continue
                sx, sy = int(ax + nx * r * 0.55), int(ay + ny * r * 0.55)
                if 0 <= sx < self.w and 0 <= sy < self.h and self.layer[sy][sx] == self.n:
                    self.col[sy][sx] = 'p1'

    def outline(self):
        inside = lambda x, y: 0 <= x < self.w and 0 <= y < self.h and self.col[y][x] is not None
        edge = []
        for y in range(self.h):
            for x in range(self.w):
                if self.col[y][x] is None and any(inside(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    edge.append((x, y))
        # Inner lines where a front part overlaps a different part behind it.
        inner = []
        for y in range(self.h):
            for x in range(self.w):
                g, l = self.grp[y][x], self.layer[y][x]
                if g < 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    X, Y = x + dx, y + dy
                    if 0 <= X < self.w and 0 <= Y < self.h and self.grp[Y][X] >= 0 and self.grp[Y][X] != g and self.layer[Y][X] < l:
                        inner.append((X, Y))
        for x, y in edge:
            self.col[y][x] = 'out'
        for x, y in inner:
            if self.col[y][x] not in ('eye', 'hi', 'eye2'):
                self.col[y][x] = 't3' if self.col[y][x] in ('t0', 't1', 't2') else 't4'

    def eye(self, cx, cy, rx, ry, lid=0.38, look=(0.0, 0.0)):
        """Glossy dark sphere, heavy upper lid (CREATURE_SPEC: no pupil shape; lid aperture + gaze)."""
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                u, v = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if u * u + v * v <= 1:
                    self.put(x, y, 'eye2' if (u - look[0]) * 0.6 + (v - look[1]) > 0.62 else 'eye')
        lid_y = cy - ry + lid * 2 * ry
        for y in range(int(cy - ry) - 1, int(lid_y) + 1):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                u, v = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
                if u * u + v * v <= 1.05 and y + 0.5 <= lid_y:
                    self.put(x, y, 't2' if y + 1.5 <= lid_y else 'out')
        hx = int(cx - rx * 0.45 + look[0] * rx * 0.3)
        hy = int(lid_y) + 1
        self.put(hx, hy, 'hi')
        if rx >= 3:
            self.put(hx + 1, hy, 'hi')
            self.put(hx, hy + 1, 'hi')
        if rx >= 2.5:
            self.put(int(cx + rx * 0.35), int(cy + ry * 0.45), 't3')

    def image(self, scale=1, bg=None):
        im = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0) if bg is None else bg + (255,))
        px = im.load()
        for y in range(self.h):
            for x in range(self.w):
                c = self.col[y][x]
                if c is not None:
                    px[x, y] = PAL[c] + (255,)
        return im.resize((self.w * scale, self.h * scale), Image.NEAREST) if scale > 1 else im


def turtle(x, y, heading, segs, step=0.25):
    """Centerline: from (x, y), heading in degrees (0 = right, 90 = down); segs = [(length, degrees per px)]."""
    pts = [(x, y)]
    for length, curve in segs:
        for _ in range(int(length / step)):
            heading += curve * step
            x += math.cos(math.radians(heading)) * step
            y += math.sin(math.radians(heading)) * step
            pts.append((x, y))
    return pts


def mirror(segs):
    return [(l, -c) for l, c in segs]


def arm(c, x, y, side, spread, length, group, r=2.8, shift=0, bend=3.0, sway=5.0, curl=26.0, suckers=True, tip=0.55):
    """One hanging arm: bends in, swings out, and curls its tip outward (side -1 = left, +1 = right)."""
    segs = [(length * 0.42, side * bend), (length * 0.33, -side * sway), (length * 0.25, -side * curl)]
    c.tube(turtle(x, y, 90 - side * spread, segs), r, tip, group, shift, suckers=-side if suckers else 0)


# ── C: hero: the approved art at 96 px, made a character: expressive eyes, a small smile, a wave ──────────
def hero():
    def wave(c):
        e = eye_boxes(c)[1]
        x0, y0 = e[2] + 3, e[3] + 16
        c.tube(turtle(x0, y0, -25, [(9, -2), (8, -6), (9, -34)]), 3.4, 0.8, 50, 0, suckers=1)
    c = faithful(96, before_outline=wave, pad_right=16, pad_top=4)
    (lx0, ly0, lx1, ly1), (rx0, ry0, rx1, ry1) = eye_boxes(c)
    for x0, y0, x1, y1 in ((lx0, ly0, lx1, ly1), (rx0, ry0, rx1, ry1)):
        cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
        c.eye(cx, cy, (x1 - x0 + 1) / 2 * 1.3, (y1 - y0 + 1) / 2 * 1.35, lid=0.36, look=(0.2, 0.15))
    # A small, closed smile between and below the eyes, and a touch of warmth under each eye.
    mx, my = round((lx1 + rx0) / 2), max(ly1, ry1) + 4
    for x, y in ((mx - 2, my - 1), (mx - 1, my), (mx, my), (mx + 1, my), (mx + 2, my - 1)):
        c.put(x, y, 'mouth')
    for x0, x1, y in ((lx0 - 1, lx1 - 1, ly1 + 3), (rx0 + 1, rx1 + 1, ry1 + 3)):
        for x in range(x0 + 1, x1):
            c.put(x, y, 'blush')
    return c


def eye_boxes(c):
    """Bounding boxes of the dark eye pixels, left eye then right."""
    boxes = []
    for half in (range(0, c.w // 2), range(c.w // 2, c.w)):
        pts = [(x, y) for y in range(c.h) for x in half if c.col[y][x] in ('eye', 'eye2')]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        boxes.append((min(xs), min(ys), max(xs), max(ys)))
    return boxes


# ── B: mascot, 32 x 32 ──────────────────────────────────────────────────────────────────────────────────────
def mascot():
    c = Canvas(38, 38)
    arm(c, 14, 21, -1, 32, 13, 1, r=2.2, shift=1, sway=8, curl=60, suckers=False, tip=0.9)
    arm(c, 22, 21, 1, 32, 13, 2, r=2.2, shift=1, sway=8, curl=60, suckers=False, tip=0.9)
    arm(c, 16, 22, -1, 8, 14, 3, r=2.4, sway=6, curl=60, suckers=False, tip=0.9)
    arm(c, 20, 22, 1, 8, 14, 4, r=2.4, sway=6, curl=60, suckers=False, tip=0.9)
    c.ellipse(18, 12.5, 11, 10.5, 0)
    c.ellipse(18, 20, 6.5, 3.2, 0)
    c.outline()
    # Waving arm, raised at the left, in front: drawn on top with its own outline.
    w = Canvas(c.w, c.h)
    w.tube(turtle(8, 21, 205, [(4, 8), (4, 14), (4, 60)]), 2.2, 0.9, 9, 0)
    w.outline()
    for y in range(c.h):
        for x in range(c.w):
            if w.col[y][x] is not None and (w.col[y][x] != 'out' or c.col[y][x] is None):
                c.col[y][x] = w.col[y][x]
    c.eye(13.5, 13.5, 2.9, 3.4, lid=0.34, look=(0.15, 0.1))
    c.eye(22.5, 13.5, 2.9, 3.4, lid=0.34, look=(0.15, 0.1))
    for x, y in ((10, 18), (11, 18), (25, 18), (24, 18)):
        c.put(x, y, 'blush')
    for x, y in ((17, 18), (18, 18), (16, 17), (19, 17)):
        c.put(x, y, 'mouth')
    return c


# ── A: faithful, from the approved front render ────────────────────────────────────────────────────────────
def faithful(height=72, before_outline=None, crisp_eyes=False, pad_right=0, pad_top=0):
    src = Image.open(SOURCE).convert('RGBA')
    src = src.crop(src.getchannel('A').getbbox())
    w = round(src.width * height / src.height)
    # Premultiply before shrinking so the dark background doesn't bleed into edge colours.
    r, g, b, a = src.split()
    pre = Image.merge('RGB', [Image.eval(Image.merge('LA', (ch, a)).convert('RGBA').split()[0], lambda v: v) for ch in (r, g, b)])
    small_a = a.resize((w, height), Image.BOX)
    small = Image.composite(src.convert('RGB'), Image.new('RGB', src.size, (0, 0, 0)), a).resize((w, height), Image.BOX)
    c = Canvas(w + 2 + pad_right, height + 2 + pad_top)
    palette = [(k, PAL[k]) for k in TONES + ['p1', 'p2', 'eye', 'eye2']]
    for y in range(height):
        for x in range(w):
            al = small_a.getpixel((x, y))
            if al < 140:
                continue
            rr, gg, bb = (min(255, round(v * 255 / al)) for v in small.getpixel((x, y)))
            # Nearest palette entry, with extra weight on warmth so suckers land on the peach tones.
            best = min(palette, key=lambda kv: (kv[1][0] - rr) ** 2 + (kv[1][1] - gg) ** 2 * 1.3 + (kv[1][2] - bb) ** 2
                       + (0 if kv[0][0] != 'p' or rr - bb > 22 else 4000))
            c.col[y + 1 + pad_top][x + 1] = best[0]
            c.grp[y + 1 + pad_top][x + 1] = 0
    if before_outline:
        before_outline(c)
    c.outline()
    if crisp_eyes:
        # The render's eyes blur to grey-blue blobs at this size: redraw them as glossy spheres, same size.
        for x0, y0, x1, y1 in eye_boxes(c):
            c.eye((x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2, lid=0.4, look=(0.15, 0.1))
    return c


def sheet(items, out, scale, bg):
    pad, label_h = 6 * scale, 0
    w = sum(i.w for _, i in items) * scale + pad * (len(items) + 1)
    h = max(i.h for _, i in items) * scale + pad * 2
    im = Image.new('RGBA', (w, h), bg + (255,))
    x = pad
    for _, c in items:
        img = c.image(scale)
        im.alpha_composite(img, (x, h - pad - img.height))
        x += img.width + pad
    im.save(out)


if __name__ == '__main__':
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    out.mkdir(parents=True, exist_ok=True)
    items = [('A-faithful', faithful(crisp_eyes=True)), ('B-mascot', mascot()), ('C-hero', hero())]
    for name, c in items:
        c.image().save(out / f'{name}.png')                 # 1x, transparent: the real asset
        c.image(10).save(out / f'{name}@10x.png')           # for looking at
    sheet(items, out / 'sheet-dark.png', 8, (9, 10, 14))
    sheet(items, out / 'sheet-light.png', 8, (236, 233, 240))
    print('wrote', out)
