#!/usr/bin/env python3
"""Tamago in other universes: the approved octopus as a sticker, made of foam, made of shipping cardboard.

Brand exploration for owner review (docs/VISUAL_APPROVAL_GATE.md), not app code. Everything starts from the
approved front render, so the character stays exactly Tamago; only the material changes. Pillow only.

    python3 tools/brand/universes.py OUT_DIR
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

SOURCE = Path('/Volumes/Storage/Projects/TamagoAI-widget-release/docs/prototypes/idle-front-v1/octopus-front-source.png')
SIZE = 1400
random.seed(7)


def octopus(height):
    src = Image.open(SOURCE).convert('RGBA')
    src = src.crop(src.getchannel('A').getbbox())
    return src.resize((round(src.width * height / src.height), height), Image.LANCZOS)


def gradient_map(gray, stops):
    """Map a grayscale image through colour stops [(level, (r, g, b)), ...]."""
    luts = [[], [], []]
    for v in range(256):
        for (a, ca), (b, cb) in zip(stops, stops[1:]):
            if a <= v <= b:
                t = (v - a) / max(1, b - a)
                for i in range(3):
                    luts[i].append(round(ca[i] + (cb[i] - ca[i]) * t))
                break
    return Image.merge('RGB', [gray.point(luts[i]) for i in range(3)])


def noise(size, sigma=64, blur=0.0, stretch=(1, 1)):
    w, h = size
    n = Image.effect_noise((max(1, w // stretch[0]), max(1, h // stretch[1])), sigma)
    if stretch != (1, 1):
        n = n.resize((w, h), Image.BICUBIC)
    return n.filter(ImageFilter.GaussianBlur(blur)) if blur else n


def studio(top, bottom, grain=6):
    """A soft vertical gradient backdrop with a little grain."""
    bg = Image.new('RGB', (SIZE, SIZE))
    d = ImageDraw.Draw(bg)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        d.line([(0, y), (SIZE, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    g = noise((SIZE, SIZE), 30).point(lambda v: 128 + (v - 128) * grain // 30)
    return ImageChops.overlay(bg, Image.merge('RGB', [g, g, g]))


def drop_shadow(alpha, offset, blur, opacity):
    sh = Image.new('L', (SIZE, SIZE), 0)
    sh.paste(alpha, offset)
    return sh.filter(ImageFilter.GaussianBlur(blur)).point(lambda v: round(v * opacity))


def place(layer_rgba, center=(SIZE // 2, SIZE // 2)):
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(layer_rgba, (center[0] - layer_rgba.width // 2, center[1] - layer_rgba.height // 2))
    return canvas


def grow(alpha, px):
    """Round dilation of a mask by about px pixels, with a smooth edge."""
    return alpha.filter(ImageFilter.GaussianBlur(px / 2)).point(lambda v: 255 if v > 14 else 0).filter(ImageFilter.GaussianBlur(1.2))


# ── 1. Sticker ─────────────────────────────────────────────────────────────────────────────────────────────
def sticker():
    o = octopus(980)
    pad = 60
    body = Image.new('RGBA', (o.width + pad * 2, o.height + pad * 2), (0, 0, 0, 0))
    body.alpha_composite(o, (pad, pad))
    # Vinyl print: a touch more contrast and warmth than the render.
    rgb = ImageOps.autocontrast(body.convert('RGB'), cutoff=0.5)
    body = Image.merge('RGBA', (*rgb.split(), body.getchannel('A')))
    border = grow(body.getchannel('A'), 44)
    edge = ImageChops.subtract(border, border.filter(ImageFilter.MinFilter(5)))
    card = Image.new('RGBA', body.size, (252, 252, 250, 0))
    card.putalpha(border)
    shade = Image.new('RGBA', body.size, (205, 205, 212, 0))
    shade.putalpha(edge.point(lambda v: v * 3 // 4))
    card.alpha_composite(shade)
    line = Image.new('RGBA', body.size, (170, 170, 182, 0))
    line.putalpha(ImageChops.subtract(grow(body.getchannel('A'), 5), body.getchannel('A')).point(lambda v: v * 3 // 5))
    card.alpha_composite(line)
    card.alpha_composite(body)
    # Gloss: a soft diagonal sheen across the vinyl.
    sheen = Image.new('L', body.size, 0)
    d = ImageDraw.Draw(sheen)
    w, h = body.size
    d.polygon([(0, h * 0.18), (w, -h * 0.12), (w, h * 0.02), (0, h * 0.32)], fill=70)
    sheen = ImageChops.multiply(sheen.filter(ImageFilter.GaussianBlur(40)), border)
    white = Image.new('RGBA', body.size, (255, 255, 255, 0))
    white.putalpha(sheen)
    card.alpha_composite(white)
    card = card.rotate(-7, resample=Image.BICUBIC, expand=True)
    bg = studio((74, 78, 88), (46, 49, 57), grain=10).convert('RGBA')
    x0, y0 = (SIZE - card.width) // 2, (SIZE - card.height) // 2 + 10
    for off, blur, op in (((x0 + 6, y0 + 10), 6, 0.35), ((x0 + 18, y0 + 34), 34, 0.30)):
        sh = drop_shadow(card.getchannel('A'), off, blur, op)
        bg = Image.composite(Image.new('RGBA', (SIZE, SIZE), (12, 12, 16, 255)), bg, sh)
    bg.alpha_composite(card, (x0, y0))
    return bg.convert('RGB')


# ── Shared: a cut-out piece with real thickness ────────────────────────────────────────────────────────────
def extrude(face_rgba, side_rgb, depth, dx=0.55, dy=1.0, pad=24):
    """Stacks the silhouette `depth` times, shifted down-right and filled with the side material, then puts the
    face on top: a piece cut from a sheet, seen slightly from above."""
    alpha = face_rgba.getchannel('A')
    w, h = face_rgba.size
    out = Image.new('RGBA', (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    side = Image.new('RGBA', (w, h))
    for i in range(depth, 0, -1):
        # Darker toward the back of the cut, lit near the face.
        k = 0.62 + 0.3 * (1 - i / depth)
        tint = side_rgb.point(lambda v, k=k: round(v * k))
        side.paste(tint, (0, 0))
        side.putalpha(alpha)
        out.alpha_composite(side, (pad + round(i * dx), pad + round(i * dy)))
    out.alpha_composite(face_rgba, (pad, pad))
    return out


def eye_boxes(o):
    """The two eyes in the approved render: dark blobs in the upper half, left and right."""
    g = o.convert('L')
    a = o.getchannel('A')
    w, h = o.size
    # The left eye is found in a band around eye height; the render is symmetric, so the right one is its mirror
    # (searching the right half directly also caught shadows under the mantle).
    top, bottom = int(h * 0.18), int(h * 0.42)
    crop = Image.composite(g, Image.new('L', o.size, 255), a).crop((0, top, w // 2, bottom)).point(lambda v: 255 if v < 60 else 0)
    x0, y0, x1, y1 = crop.getbbox()
    left = (x0, y0 + top, x1, y1 + top)
    return [left, (w - left[2], left[1], w - left[0], left[3])]


# ── 2. Foam ────────────────────────────────────────────────────────────────────────────────────────────────
def pores(size, scale, cut, blur):
    """Open foam cells: noise drawn at 1/scale and enlarged, so each pore is a few pixels across."""
    w, h = size
    n = Image.effect_noise((w // scale, h // scale), 90).resize(size, Image.BICUBIC).filter(ImageFilter.GaussianBlur(blur))
    return n.point(lambda v: 255 if v < cut else 0).filter(ImageFilter.GaussianBlur(0.6))


def foam_texture(size, strength=1.0):
    tex = Image.new('L', size, 150)
    for scale, cut, depth in ((2, 58, 120), (3, 50, 110), (5, 46, 90)):
        holes = pores(size, scale, cut, 0.8)
        lit = ImageChops.subtract(ImageChops.offset(holes, -2, -2), holes)
        tex = ImageChops.subtract(tex, holes.point(lambda v, d=depth: round(v * d * strength / 255)))
        tex = ImageChops.add(tex, lit.point(lambda v: round(v * 45 * strength / 255)))
    return tex


def foam():
    o = octopus(1040)
    alpha = o.getchannel('A')
    size = o.size
    # Matte: the form without the gloss. Eyes become charcoal foam.
    gray = o.convert('L').filter(ImageFilter.GaussianBlur(3)).point(lambda v: round(30 + v * 0.82))
    base = gradient_map(gray, [(0, (44, 42, 50)), (80, (70, 66, 72)), (125, (184, 164, 130)),
                               (185, (232, 216, 178)), (255, (250, 242, 216))])
    d = ImageDraw.Draw(base)
    for x0, y0, x1, y1 in eye_boxes(o):
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 * 0.95, (y1 - y0) / 2 * 0.95
        d.ellipse((cx - rx - 6, cy - ry - 6, cx + rx + 6, cy + ry + 6), fill=(150, 134, 104))   # the set-in rim
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(46, 44, 54))
    tex = foam_texture(size)
    face = ImageChops.multiply(base, Image.merge('RGB', [tex.point(lambda v: min(255, v + 95))] * 3))
    # Cut foam has a slightly soft, uneven edge.
    ragged = ImageChops.add(alpha.filter(ImageFilter.GaussianBlur(2)), noise(size, 60, 1.0), scale=1.0, offset=-128)
    alpha2 = ImageChops.multiply(alpha, ragged.point(lambda v: 255 if v > 120 else 0).filter(ImageFilter.GaussianBlur(0.7)))
    face = Image.merge('RGBA', (*face.split(), alpha2))
    side = ImageChops.multiply(Image.new('RGB', size, (214, 196, 156)),
                               Image.merge('RGB', [foam_texture(size, 1.3).point(lambda v: min(255, v + 80))] * 3))
    piece = extrude(face, side, 26)
    bg = studio((196, 214, 222), (146, 168, 184), grain=8).convert('RGBA')
    x0, y0 = (SIZE - piece.width) // 2, (SIZE - piece.height) // 2 - 10
    sh = drop_shadow(piece.getchannel('A'), (x0 + 16, y0 + 30), 30, 0.34)
    bg = Image.composite(Image.new('RGBA', (SIZE, SIZE), (26, 38, 52, 255)), bg, sh)
    bg.alpha_composite(piece, (x0, y0))
    return bg.convert('RGB')


# ── 3. Shipping cardboard ─────────────────────────────────────────────────────────────────────────────────
def font(size):
    for p in ('/System/Library/Fonts/Supplemental/Impact.ttf', '/System/Library/Fonts/Supplemental/Arial Black.ttf',
              '/System/Library/Fonts/Supplemental/Arial Bold.ttf'):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def kraft(size, gray):
    """Kraft paper liner: the form as matte brown, fine fibres and flecks, uneven mottling."""
    base = gradient_map(gray, [(0, (70, 46, 26)), (90, (122, 84, 50)), (150, (164, 120, 76)),
                               (205, (198, 154, 102)), (255, (218, 178, 126))])
    fibres = noise(size, 60, 0.5, stretch=(4, 1)).point(lambda v: 128 + (v - 128) // 4)
    flecks = noise(size, 90, 0.4).point(lambda v: 90 if v < 26 else 128)
    rgb = ImageChops.overlay(base, Image.merge('RGB', [ImageChops.multiply(fibres, flecks.point(lambda v: v * 2 if v < 128 else 255))] * 3))
    mott = noise(size, 40, 30).point(lambda v: 128 + (v - 128) * 2)
    return ImageChops.soft_light(rgb, Image.merge('RGB', [mott] * 3))


def cardboard():
    o = octopus(1040)
    alpha = o.getchannel('A')
    size = o.size
    w, h = size
    # Keep the form: the octopus reads as a shaped cardboard cut-out.
    gray = o.convert('L').filter(ImageFilter.GaussianBlur(3)).point(lambda v: round(26 + v * 0.86))
    rgb = kraft(size, gray)
    # Sharpie eyes: drawn over the render's eyes, a little uneven, with a paper-white glint left unpainted.
    d = ImageDraw.Draw(rgb)
    for x0, y0, x1, y1 in eye_boxes(o):
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 * 0.92, (y1 - y0) / 2 * 0.95
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(26, 22, 24))
        d.ellipse((cx - rx * 0.55, cy - ry * 0.6, cx - rx * 0.1, cy - ry * 0.15), fill=(214, 176, 126))
    # Print: stencil ink, worn, on the mantle.
    ink = Image.new('L', size, 0)
    di = ImageDraw.Draw(ink)
    cx = w // 2
    di.text((cx, round(h * 0.075)), '↑↑', font=font(64), fill=255, anchor='mm')
    di.text((cx, round(h * 0.135)), 'THIS SIDE UP', font=font(36), fill=255, anchor='mm')
    fr = Image.new('L', (440, 96), 0)
    ImageDraw.Draw(fr).text((220, 48), 'FRAGILE', font=font(60), fill=255, anchor='mm')
    fr = fr.rotate(7, resample=Image.BICUBIC, expand=True)
    ink.paste(fr, (cx - fr.width // 2, round(h * 0.39)), fr)
    wear = noise(size, 80, 0.8).point(lambda v: 255 if v > 90 else 0)
    ink = ImageChops.multiply(ImageChops.multiply(ink, wear), alpha)
    rgb = Image.composite(Image.new('RGB', size, (30, 22, 18)), rgb, ink.point(lambda v: v * 85 // 100))
    # Packing tape across the mantle: translucent, with a sheen and a torn end.
    ty = round(h * 0.215)
    tape = Image.new('L', size, 0)
    ImageDraw.Draw(tape).polygon([(w * 0.12, ty - 34), (w * 0.9, ty - 60), (w * 0.92, ty + 12), (w * 0.1, ty + 38)], fill=150)
    tape = ImageChops.multiply(tape, alpha)
    rgb = Image.composite(Image.new('RGB', size, (222, 196, 142)), rgb, tape.point(lambda v: v * 50 // 100))
    shine = Image.new('L', size, 0)
    ImageDraw.Draw(shine).polygon([(w * 0.12, ty - 18), (w * 0.9, ty - 44), (w * 0.9, ty - 34), (w * 0.12, ty - 8)], fill=120)
    rgb = Image.composite(Image.new('RGB', size, (255, 248, 226)), rgb, ImageChops.multiply(shine.filter(ImageFilter.GaussianBlur(3)), alpha))
    face = Image.merge('RGBA', (*rgb.split(), alpha))
    # The cut side: corrugation flutes, the tell-tale of a shipping box.
    flutes = Image.new('RGB', size, (150, 108, 64))
    fd = ImageDraw.Draw(flutes)
    for x in range(0, w + h, 9):
        fd.line([(x, 0), (x - h * 0.35, h)], fill=(104, 70, 40), width=3)
    piece = extrude(face, flutes, 16)
    bg = studio((236, 233, 226), (206, 200, 190), grain=8).convert('RGBA')
    x0, y0 = (SIZE - piece.width) // 2, (SIZE - piece.height) // 2 - 10
    sh = drop_shadow(piece.getchannel('A'), (x0 + 14, y0 + 24), 22, 0.40)
    bg = Image.composite(Image.new('RGBA', (SIZE, SIZE), (50, 38, 28, 255)), bg, sh)
    bg.alpha_composite(piece, (x0, y0))
    return bg.convert('RGB')


if __name__ == '__main__':
    out = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    out.mkdir(parents=True, exist_ok=True)
    for name, make in (('sticker', sticker), ('foam', foam), ('cardboard', cardboard)):
        make().save(out / f'tamago-{name}.png')
        print('wrote', name)
