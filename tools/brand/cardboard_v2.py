#!/usr/bin/env python3
"""Tamago made of a shipping box, v2: after the owner's references (2026-09-29): a stylized hand-painted box,
Valve's Half-Life: Alyx box set, a worn Priority Mail box, a painted box with star stickers.

What they share, and what this adds over v1 (docs/prototypes/universes-v1):
- dusty, desaturated kraft rather than orange brown; flat panels, not a glossy form
- a fold down the mantle (the head reads as a box corner), scored creases, worn light edges, water stains, grime
  toward the bottom, torn spots showing the corrugation
- real box graphics: a white shipping label with a barcode, handling pictograms with FRAGILE, an orange sticker,
  torn-edged packing tape along the seam, star stickers and a marker scribble

    python3 tools/brand/cardboard_v2.py OUT_DIR
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from universes import SIZE, drop_shadow, extrude, eye_boxes, gradient_map, noise, octopus, studio  # noqa: E402

random.seed(11)
FONTS = '/System/Library/Fonts/'


def f(name, size, index=0):
    for path in (FONTS + name, FONTS + 'Supplemental/' + name):
        try:
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


def paste(dst_rgb, layer_rgba, xy, angle=0.0, clip=None, shadow=True):
    """Pastes a sticker/label onto the face, rotated, with a thin contact shadow, clipped to the octopus."""
    if angle:
        layer_rgba = layer_rgba.rotate(angle, resample=Image.BICUBIC, expand=True)
    full = Image.new('RGBA', dst_rgb.size, (0, 0, 0, 0))
    full.alpha_composite(layer_rgba, (int(xy[0] - layer_rgba.width / 2), int(xy[1] - layer_rgba.height / 2)))
    a = full.getchannel('A')
    if clip is not None:
        a = ImageChops.multiply(a, clip)
        full.putalpha(a)
    base = dst_rgb.convert('RGBA')
    if shadow:
        sh = ImageChops.offset(a, 2, 3).filter(ImageFilter.GaussianBlur(3)).point(lambda v: v * 40 // 100)
        base = Image.composite(Image.new('RGBA', base.size, (40, 30, 20, 255)), base, sh)
    base.alpha_composite(full)
    return base.convert('RGB')


def roughen(layer, amount=1.0):
    """Worn print/labels: scuffs and a dirty tint."""
    a = layer.getchannel('A')
    scuff = noise(layer.size, 80, 0.7).point(lambda v: 255 if v > 50 * amount else 150)
    layer.putalpha(ImageChops.multiply(a, scuff))
    return layer


# ── Graphics ───────────────────────────────────────────────────────────────────────────────────────────────
def shipping_label(w=250, h=170):
    lab = Image.new('RGBA', (w, h), (244, 240, 230, 255))
    d = ImageDraw.Draw(lab)
    d.rectangle((0, 0, w - 1, h - 1), outline=(200, 194, 182), width=2)
    d.rectangle((10, 10, 58, 58), fill=(32, 110, 196))
    d.text((34, 34), 'T', font=f('Helvetica.ttc', 44, 1), fill='white', anchor='mm')
    d.text((68, 14), 'TAMAGO EXPRESS', font=f('Helvetica.ttc', 17, 1), fill=(20, 20, 24))
    d.text((68, 36), 'OVERNIGHT · HANDLE GENTLY', font=f('Helvetica.ttc', 10), fill=(60, 60, 66))
    d.line((10, 66, w - 10, 66), fill=(30, 30, 34), width=2)
    d.text((12, 72), 'DELIVER TO:', font=f('Helvetica.ttc', 10, 1), fill=(30, 30, 34))
    d.text((12, 86), 'your wrist', font=f('Noteworthy.ttc', 18), fill=(30, 40, 90))
    d.text((140, 72), 'FROM:', font=f('Helvetica.ttc', 10, 1), fill=(30, 30, 34))
    d.text((140, 86), 'the Mac mini', font=f('Noteworthy.ttc', 16), fill=(30, 40, 90))
    x = 14
    while x < w - 16:
        bw = random.choice((1, 1, 2, 3))
        d.rectangle((x, 116, x + bw, 150), fill=(18, 18, 20))
        x += bw + random.choice((1, 2, 2, 3))
    d.text((w // 2, 158), '9400 1TAM 4GO0 0001 2026', font=f('Courier New.ttf', 10), fill=(30, 30, 34), anchor='mm')
    # Grime and a water mark on the paper.
    stain = noise((w, h), 50, 10).point(lambda v: 255 if 120 < v < 128 else 0).filter(ImageFilter.GaussianBlur(1.5))
    lab = Image.composite(Image.new('RGBA', (w, h), (200, 186, 160, 255)), lab, stain.point(lambda v: v // 3))
    return roughen(lab, 0.5)


def pictograms(cell=62):
    """The handling marks: fragile, this way up, keep dry, recycle; FRAGILE underneath. Drawn at 62 px, scaled."""
    g = _pictograms()
    return g.resize((round(g.width * cell / 62), round(g.height * cell / 62)), Image.LANCZOS)


def _pictograms(cell=62):
    g = Image.new('RGBA', (cell * 2 + 6, cell * 2 + 44), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    ink = (26, 22, 20, 235)
    sym = f('Apple Symbols.ttf', 48)
    for i, glyph in enumerate(('glass', '↑↑', '☂', '♻')):
        x0, y0 = (i % 2) * (cell + 6), (i // 2) * (cell + 6)
        d.rectangle((x0, y0, x0 + cell, y0 + cell), outline=ink, width=4)
        cx, cy = x0 + cell / 2, y0 + cell / 2
        if glyph == 'glass':
            d.polygon([(cx - 13, cy - 20), (cx + 13, cy - 20), (cx + 9, cy - 2), (cx - 9, cy - 2)], fill=ink)
            d.line((cx, cy - 2, cx, cy + 14), fill=ink, width=4)
            d.line((cx - 10, cy + 16, cx + 10, cy + 16), fill=ink, width=4)
            d.line((cx - 4, cy - 20, cx + 1, cy - 12, cx - 3, cy - 6), fill=(0, 0, 0, 0), width=2)
        elif glyph == '↑↑':
            for dx in (-10, 10):
                d.line((cx + dx, cy + 16, cx + dx, cy - 12), fill=ink, width=5)
                d.polygon([(cx + dx - 9, cy - 8), (cx + dx + 9, cy - 8), (cx + dx, cy - 22)], fill=ink)
            d.line((cx - 20, cy + 20, cx + 20, cy + 20), fill=ink, width=4)
        else:
            d.text((cx, cy + 2), glyph, font=sym, fill=ink, anchor='mm')
    d.text((g.width / 2, cell * 2 + 22), 'FRAGILE', font=f('Supplemental/Arial Black.ttf', 24), fill=ink, anchor='mm')
    d.text((g.width / 2, cell * 2 + 40), 'PLEASE HANDLE WITH CARE', font=f('Helvetica.ttc', 8, 1), fill=ink, anchor='mm')
    return roughen(g, 1.3)


def star(r, color):
    s = Image.new('RGBA', (r * 2 + 8, r * 2 + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    c = r + 4
    pts = [(c + (r if i % 2 == 0 else r * 0.45) * math.cos(math.radians(-90 + i * 36)),
            c + (r if i % 2 == 0 else r * 0.45) * math.sin(math.radians(-90 + i * 36))) for i in range(10)]
    d.polygon(pts, fill=color, outline=tuple(max(0, v - 70) for v in color[:3]) + (255,))
    d.line(pts + [pts[0]], fill=tuple(max(0, v - 70) for v in color[:3]) + (255,), width=3)
    return roughen(s, 0.4)


def orange_sticker(w=96, h=58):
    s = Image.new('RGBA', (w, h), (236, 112, 40, 255))
    d = ImageDraw.Draw(s)
    d.rectangle((4, 4, w - 5, h - 5), outline=(255, 238, 220), width=2)
    d.text((w / 2, 20), '⚠', font=f('Apple Symbols.ttf', 22), fill=(30, 20, 16), anchor='mm')
    d.text((w / 2, 42), 'LIVE CARGO', font=f('Helvetica.ttc', 12, 1), fill=(30, 20, 16), anchor='mm')
    return roughen(s, 0.6)


def tape(length, width=62):
    """Translucent packing tape with torn zigzag ends and a few wrinkles."""
    t = Image.new('RGBA', (width, length), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    top = [(0, 10)] + [(x, 4 + random.randint(0, 10)) for x in range(6, width, 6)] + [(width, 10)]
    bot = [(width, length - 12)] + [(x, length - 4 - random.randint(0, 10)) for x in range(width - 6, 0, -6)] + [(0, length - 12)]
    d.polygon(top + bot, fill=(214, 184, 116, 120))
    for y in range(40, length - 40, 70):
        d.line((0, y + random.randint(-8, 8), width, y + random.randint(-8, 8)), fill=(250, 236, 200, 90), width=2)
    d.line((width * 0.25, 12, width * 0.25, length - 14), fill=(255, 248, 226, 70), width=6)
    return t


# ── The octopus as a box ───────────────────────────────────────────────────────────────────────────────────
def cardboard():
    o = octopus(1040)
    alpha = o.getchannel('A')
    size = o.size
    w, h = size
    # Flat panels: keep the silhouette's big shapes, drop the render's roundness and gloss.
    src_gray = o.convert('L')
    gray = src_gray.filter(ImageFilter.GaussianBlur(4)).point(lambda v: round(150 + (v - 160) * 0.55))
    base = gradient_map(gray, [(0, (84, 68, 52)), (100, (138, 114, 86)), (150, (176, 150, 116)),
                               (200, (202, 180, 146)), (255, (220, 202, 170))])
    # Liner texture: fibres, flecks, and a faint flute ripple under the paper.
    fib = noise(size, 50, 0.6, stretch=(4, 1)).point(lambda v: 128 + (v - 128) // 5)
    flute = Image.new('L', size)
    fd = ImageDraw.Draw(flute)
    for x in range(w):
        fd.line([(x, 0), (x, h)], fill=round(128 + 5 * math.sin(x / 11 * 2 * math.pi)))
    rgb = ImageChops.overlay(base, Image.merge('RGB', [ImageChops.overlay(fib, flute)] * 3))
    rgb = ImageChops.soft_light(rgb, Image.merge('RGB', [noise(size, 40, 26).point(lambda v: 128 + (v - 128) * 2)] * 3))
    crevice = src_gray.filter(ImageFilter.GaussianBlur(1.5)).point(lambda v: 255 if v > 200 else round(90 + v * 0.8))
    rgb = ImageChops.multiply(rgb, Image.merge('RGB', [crevice] * 3))

    # The head is a box corner: a fold down the middle, the right face in shade.
    mantle_h = int(h * 0.36)
    cx = w // 2
    right = Image.new('L', size, 0)
    ImageDraw.Draw(right).polygon([(cx, 0), (w, 0), (w, mantle_h), (cx + 8, mantle_h + 30)], fill=255)
    rgb = Image.composite(rgb.point(lambda v: round(v * 0.86)), rgb, ImageChops.multiply(right.filter(ImageFilter.GaussianBlur(2)), alpha))
    d = ImageDraw.Draw(rgb)
    d.line((cx, 0, cx + 8, mantle_h + 30), fill=(96, 78, 58), width=3)
    d.line((cx - 3, 0, cx + 5, mantle_h + 30), fill=(222, 204, 172), width=2)
    # Scored creases where the arms bend, as if folded from flat stock.
    for (x0, y0, x1, y1) in ((0.05, 0.62, 0.42, 0.58), (0.58, 0.60, 0.97, 0.66), (0.1, 0.8, 0.45, 0.84), (0.55, 0.83, 0.92, 0.79)):
        p = (x0 * w, y0 * h, x1 * w, y1 * h)
        d.line(p, fill=(112, 92, 70), width=3)
        d.line((p[0], p[1] + 3, p[2], p[3] + 3), fill=(214, 196, 164), width=2)

    # Wear: scuffed light edges, dents, water stains, grime toward the bottom.
    edge = ImageChops.subtract(alpha, alpha.filter(ImageFilter.MinFilter(7)))
    fuzz = ImageChops.multiply(edge, noise(size, 70, 0.8).point(lambda v: 255 if v > 110 else 90))
    rgb = Image.composite(Image.new('RGB', size, (224, 208, 178)), rgb, fuzz.point(lambda v: v * 70 // 100))
    blot = noise((w // 8, h // 8), 60).resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(6))
    rings = blot.point(lambda v: 255 if 150 < v < 156 else 0).filter(ImageFilter.GaussianBlur(1.5))
    rgb = Image.composite(Image.new('RGB', size, (112, 92, 70)), rgb, ImageChops.multiply(rings, alpha).point(lambda v: v * 45 // 100))
    grad = Image.linear_gradient('L').resize(size).point(lambda v: max(0, v - 120) * 2)
    grime = ImageChops.multiply(grad, noise(size, 50, 5).point(lambda v: min(255, v + 40)))
    rgb = Image.composite(Image.new('RGB', size, (70, 58, 46)), rgb, ImageChops.multiply(grime, alpha).point(lambda v: v * 45 // 100))
    # Two tears: the top paper ripped away, corrugation showing through.
    for (tx, ty, tw, th) in ((0.23, 0.7, 34, 26), (0.74, 0.52, 28, 22)):
        m = Image.new('L', size, 0)
        pts = [(tx * w + tw * math.cos(a) * random.uniform(0.6, 1.1), ty * h + th * math.sin(a) * random.uniform(0.6, 1.1))
               for a in [i * math.pi / 7 for i in range(14)]]
        ImageDraw.Draw(m).polygon(pts, fill=255)
        tear = Image.new('RGB', size, (150, 124, 90))
        td = ImageDraw.Draw(tear)
        for x in range(int(tx * w - tw), int(tx * w + tw), 6):
            td.line((x, ty * h - th, x, ty * h + th), fill=(112, 88, 60), width=2)
        rgb = Image.composite(tear, rgb, ImageChops.multiply(m, alpha))
        ImageDraw.Draw(rgb).line(pts + [pts[0]], fill=(230, 214, 184), width=2)

    # Marker eyes over the render's eyes: glossy black with a heavy lid line, a paper glint left unpainted.
    d = ImageDraw.Draw(rgb)
    for x0, y0, x1, y1 in eye_boxes(o):
        ex, ey, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 * 0.95, (y1 - y0) / 2 * 0.95
        d.ellipse((ex - rx, ey - ry, ex + rx, ey + ry), fill=(22, 20, 22))
        d.chord((ex - rx - 3, ey - ry - 4, ex + rx + 3, ey + ry * 0.3), 180, 360, fill=(196, 174, 140))
        d.arc((ex - rx - 3, ey - ry - 4, ex + rx + 3, ey + ry * 0.3), 180, 360, fill=(22, 20, 22), width=5)
        d.ellipse((ex - rx * 0.55, ey - ry * 0.05, ex - rx * 0.15, ey + ry * 0.35), fill=(214, 196, 164))

    # Graphics, placed where the silhouette is wide enough. Print first, then tape over it, then stickers.
    clip = alpha
    inside = lambda x, y, r: all(alpha.getpixel((int(x + dx), int(y + dy))) > 200 for dx in (-r, 0, r) for dy in (-r, 0, r)
                                 if 0 <= x + dx < w and 0 <= y + dy < h)
    rgb = paste(rgb, pictograms(36), (w * 0.605, h * 0.145), angle=-2, clip=clip, shadow=False)
    fr = Image.new('RGBA', (220, 50), (0, 0, 0, 0))
    ImageDraw.Draw(fr).text((110, 25), 'FRAGILE', font=f('Supplemental/Impact.ttf', 40), fill=(170, 40, 34, 215), anchor='mm')
    rgb = paste(rgb, roughen(fr, 1.4), (w * 0.4, h * 0.145), angle=-8, clip=clip, shadow=False)
    rgb = paste(rgb, tape(int(h * 0.3)), (cx + 4, h * 0.14), angle=-1.2, clip=clip, shadow=False)
    rgb = paste(rgb, shipping_label(230, 150), (w * 0.5, h * 0.36), angle=3, clip=clip)
    note = Image.new('RGBA', (260, 60), (0, 0, 0, 0))
    nd = ImageDraw.Draw(note)
    nd.text((4, 8), 'to: you', font=f('MarkerFelt.ttc', 32), fill=(40, 50, 120, 225))
    hx, hy = 138, 28
    nd.polygon([(hx, hy), (hx + 11, hy - 11), (hx + 20, hy - 6), (hx + 20, hy + 3), (hx, hy + 20), (hx - 20, hy + 3),
                (hx - 20, hy - 6), (hx - 11, hy - 11)], fill=(200, 40, 60, 225))
    rgb = paste(rgb, note, (w * 0.52, h * 0.49), angle=-6, clip=clip, shadow=False)
    def spot(fx0, fx1, fy0, fy1, r):
        for fy in [fy0 + (fy1 - fy0) * i / 12 for i in range(13)]:
            for fx in [fx0 + (fx1 - fx0) * i / 12 for i in range(13)]:
                if inside(fx * w, fy * h, r + 6):
                    return fx * w, fy * h
        return None
    for (box, r, color, ang) in (((0.02, 0.25, 0.55, 0.7), 24, (206, 52, 44, 255), 12),
                                 ((0.75, 0.98, 0.55, 0.72), 20, (46, 92, 190, 255), -18),
                                 ((0.3, 0.5, 0.75, 0.9), 16, (240, 190, 40, 255), 4)):
        at = spot(*box, r)
        if at:
            rgb = paste(rgb, star(r, color), at, angle=ang, clip=clip)
    if inside(w * 0.68, h * 0.64, 30):
        rgb = paste(rgb, orange_sticker(), (w * 0.68, h * 0.64), angle=9, clip=clip)

    face = Image.merge('RGBA', (*rgb.split(), alpha))
    # The cut side: corrugated flutes, with the liner's edge.
    side = Image.new('RGB', size, (168, 142, 106))
    sd = ImageDraw.Draw(side)
    for x in range(0, w + h, 8):
        sd.line([(x, 0), (x - h * 0.5, h)], fill=(118, 96, 70), width=3)
    piece = extrude(face, side, 14)
    bg = studio((52, 58, 70), (32, 36, 46), grain=10).convert('RGBA')
    x0, y0 = (SIZE - piece.width) // 2, (SIZE - piece.height) // 2 - 10
    sh = drop_shadow(piece.getchannel('A'), (x0 + 14, y0 + 26), 26, 0.55)
    bg = Image.composite(Image.new('RGBA', (SIZE, SIZE), (8, 8, 12, 255)), bg, sh)
    bg.alpha_composite(piece, (x0, y0))
    return bg.convert('RGB')


if __name__ == '__main__':
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    out.mkdir(parents=True, exist_ok=True)
    cardboard().save(out / 'tamago-cardboard-v2.png')
    print('wrote', out / 'tamago-cardboard-v2.png')
