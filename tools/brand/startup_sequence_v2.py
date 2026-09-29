#!/usr/bin/env python3
"""Tamago's startup sequence, v2: the universes fight for the spot, then the right one claims it.

Owner, 2026-09-29, on v1: "it needs more motion, screen shake, particle effects. It can't feel like a png after a
png, it needs to feel cohesive, like one is fighting for a place to stay, and a proper climax into the right AI.
Use Control Resonant art as inspiration for glitch and universe travelling."

Control's language, as used here: brutalist red / black / white, the red Hiss washing over things, hard
horizontal tearing and displaced slices, macroblock corruption, white corner-bracket UI frames, planes of reality
bleeding into each other. Nothing from the game itself is used, only the approach.

Beats:
  0.0 s     black, drone, red scanline flickers, a bracket frame, a spark at the eyes
  0.6 s     THE FIGHT: 16 takeovers, 0.55 s down to 4 frames. The holder sways and bobs; the challenger tears in
            through slices and stutters (A B A B), wins with a hit: shake, sparks in its colour, bracket flash
  ~4.2 s   OVERLOAD: every universe strobing, red Hiss, max shake, particles pulled into the eyes
  then     a hard cut to black and silence
  reveal   the hero lands: double shockwave, spark explosion, heavy shake, an elastic settle; the others try to
            glitch back twice and fail; the idle float begins

    python3 tools/brand/startup_sequence_v2.py ALIGNED_DIR IDLE_FRAMES_DIR OUT_DIR [--app]
"""
import array
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

sys.path.insert(0, str(Path(__file__).parent))
from startup_align import ORDER, PAD  # noqa: E402

FPS = 60
W, H = 1080, 1920
LAYER = (1024, 1400)
BIG = 1.35
ORIGIN = ((W - LAYER[0]) // 2, (H - LAYER[1]) // 2)
LEYE = (PAD[0] + 387, PAD[1] + 296)                     # the eye midpoint inside a layer
EYES = (ORIGIN[0] + LEYE[0], ORIGIN[1] + LEYE[1] + 40)   # and on the canvas (a touch low: room for the crown)
SR = 44100
RED = (230, 28, 36)

TINT = {'neon': (255, 40, 150), 'ink': (225, 220, 210), 'stone-moss': (130, 190, 70), 'velvet': (160, 110, 220),
        'sprout': (255, 60, 40), 'metal': (180, 200, 225), 'xray': (120, 200, 255), 'cardboard': (230, 170, 90),
        'hero': (255, 240, 232)}

INTRO = 0.6
DURS = [0.55, 0.47, 0.40, 0.34, 0.29, 0.25, 0.21, 0.18, 0.155, 0.135, 0.115, 0.1, 0.09, 0.08, 0.07, 0.065]
OVERLOAD = 0.42
BLACK = 0.13
IDLE = 4.6


def ease_out(t):
    return 1 - (1 - t) ** 3


def elastic_out(t):
    if t <= 0:
        return 0.0
    if t >= 1:
        return 1.0
    return 2 ** (-9 * t) * math.sin((t * 10 - 0.75) * (2 * math.pi) / 3.2) + 1


def plan():
    segs, t = [], INTRO
    for i, d in enumerate(DURS):
        d = max(4 / FPS, round(d * FPS) / FPS)
        segs.append((t, ORDER[i % 8], d))
        t += d
    overload = t
    black = overload + OVERLOAD
    reveal = black + BLACK
    return segs, overload, black, reveal, reveal + IDLE


# ── Picture pieces ─────────────────────────────────────────────────────────────────────────────────────────
def place(layer, scale=1.0, angle=0.0, dx=0.0, dy=0.0):
    """A layer on the canvas: rotated about its eyes, scaled, and put so the eyes sit at EYES + (dx, dy)."""
    if angle:
        layer = layer.rotate(angle, resample=Image.BICUBIC, center=LEYE)
    s = scale * BIG
    sw, sh = round(LAYER[0] * s), round(LAYER[1] * s)
    scaled = layer.resize((sw, sh), Image.BILINEAR)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(scaled, (round(EYES[0] + dx - LEYE[0] * s), round(EYES[1] + dy - LEYE[1] * s)))
    return out


def over(canvas_rgb, rgba):
    c = canvas_rgb.convert('RGBA')
    c.alpha_composite(rgba)
    return c.convert('RGB')


def radial(color, radius, strength, center=None):
    cx, cy = center or EYES
    g = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(g)
    for i in range(36, 0, -1):
        r = radius * i / 36
        d.ellipse((cx - r, cy + 140 - r * 1.25, cx + r, cy + 140 + r * 1.25), fill=round(255 * (1 - i / 36) ** 1.7))
    g = g.filter(ImageFilter.GaussianBlur(40)).point(lambda v: round(v * strength))
    return Image.merge('RGB', [g.point(lambda v, c=c: v * c // 255) for c in color])


def scale_rgb(img, k):
    return img.point(lambda v: min(255, round(v * k))) if k != 1 else img


def rgb_split(img, d, vertical=0):
    if not d:
        return img
    r, g, b = img.split()
    return Image.merge('RGB', (ImageChops.offset(r, d, vertical), g, ImageChops.offset(b, -d, -vertical)))


def tear(base, other, rng, bands, max_shift, other_share):
    """Control-style tearing: horizontal slices shoved sideways; some slices show the other reality."""
    out = base.copy()
    for _ in range(bands):
        y = rng.randrange(0, H - 8)
        h = rng.choice((6, 10, 16, 24, 40, 64, 96))
        src = other if (other is not None and rng.random() < other_share) else base
        band = src.crop((0, y, W, min(H, y + h)))
        out.paste(ImageChops.offset(band, rng.randint(-max_shift, max_shift), 0), (0, y))
    return out


def macroblocks(img, rng, count, size=24):
    out = img.copy()
    for _ in range(count):
        bw, bh = rng.choice((2, 3, 4, 6)) * size, rng.choice((1, 2, 3)) * size
        x, y = rng.randrange(0, W - bw), rng.randrange(0, H - bh)
        blk = img.crop((x, y, x + bw, y + bh)).resize((max(1, bw // size), max(1, bh // size)), Image.BILINEAR)
        out.paste(blk.resize((bw, bh), Image.NEAREST), (x + rng.randint(-size, size), y))
    return out


def hiss(img, amount):
    """The red wash: luminance mapped to black → red → white, mixed in."""
    if amount <= 0:
        return img
    red = ImageOps.colorize(img.convert('L'), black=(0, 0, 0), mid=RED, white=(255, 235, 230))
    return Image.blend(img, red, min(1.0, amount))


def brackets(img, alpha, rect, length=70, width=6, color=(255, 255, 255)):
    """Control's white corner brackets around a region."""
    if alpha <= 0.02:
        return img
    lay = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(lay)
    x0, y0, x1, y1 = rect
    for (x, y, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        d.line((x, y, x + sx * length, y), fill=255, width=width)
        d.line((x, y, x, y + sy * length), fill=255, width=width)
    return Image.composite(Image.new('RGB', (W, H), color), img, lay.point(lambda v: round(v * alpha)))


class Particles:
    def __init__(self, rng):
        self.rng = rng
        self.p = []   # [x, y, vx, vy, life, age, size, color, drag, add]

    def spawn(self, n, at, speed, color, life, size=(2, 5), drag=2.5, spread=None, inward=False):
        for _ in range(n):
            a = self.rng.uniform(0, 2 * math.pi)
            if spread:
                x = at[0] + math.cos(a) * self.rng.uniform(*spread)
                y = at[1] + math.sin(a) * self.rng.uniform(*spread) * 1.3
            else:
                x, y = at
            v = self.rng.uniform(*speed)
            vx, vy = (math.cos(a) * v, math.sin(a) * v)
            if inward:
                vx, vy = (at[0] - x) * v / 400, (at[1] - y) * v / 400
            c = color if isinstance(color, tuple) else self.rng.choice(color)
            self.p.append([x, y, vx, vy, self.rng.uniform(*life), 0.0, self.rng.uniform(*size), c, drag])

    def dust(self, n):
        for _ in range(n):
            self.p.append([self.rng.uniform(0, W), self.rng.uniform(0, H), self.rng.uniform(-8, 8), self.rng.uniform(-30, -6),
                           self.rng.uniform(3, 7), 0.0, self.rng.uniform(1, 2.6), (200, 190, 200), 0.0])

    def step(self, dt, pull=None):
        alive = []
        for q in self.p:
            q[5] += dt
            if q[5] >= q[4]:
                continue
            if pull:
                q[2] += (pull[0] - q[0]) * 9 * dt
                q[3] += (pull[1] - q[1]) * 9 * dt
            k = math.exp(-q[8] * dt)
            q[2] *= k
            q[3] *= k
            q[0] += q[2] * dt
            q[1] += q[3] * dt
            alive.append(q)
        self.p = alive

    def draw(self, img):
        if not self.p:
            return img
        lay = Image.new('RGB', (W, H), (0, 0, 0))
        d = ImageDraw.Draw(lay)
        for x, y, vx, vy, life, age, size, c, _ in self.p:
            fade = (1 - age / life) ** 1.3
            s = size * (0.6 + 0.4 * fade)
            col = tuple(round(v * fade) for v in c)
            sp = math.hypot(vx, vy)
            if sp > 250:   # fast sparks draw as streaks
                ex, ey = x - vx * 0.018, y - vy * 0.018
                d.line((x, y, ex, ey), fill=col, width=max(1, round(s)))
            else:
                d.ellipse((x - s, y - s, x + s, y + s), fill=col)
        glow = lay.filter(ImageFilter.GaussianBlur(6))
        return ImageChops.add(ImageChops.add(img, glow), lay)


# ── The render ─────────────────────────────────────────────────────────────────────────────────────────────
def render(aligned_dir, idle_dir, out_dir, app=False):
    segs, overload, black, reveal, total = plan()
    if app:
        total = reveal + 1.7
    rng = random.Random(7)
    layers = {n: Image.open(Path(aligned_dir) / f'{n}.png').convert('RGBA') for n in ORDER}
    idle = sorted(Path(idle_dir).glob('frame-*.png'))
    glows = {n: radial(TINT[n], 700, 0.5) for n in list(ORDER) + ['hero']}
    redglow = radial(RED, 900, 0.9)
    bloom = radial((255, 250, 246), 1000, 1.0)       # per-cut flash: bright at the octopus, black edges stay black
    vign = Image.new('L', (W, H), 0)
    ImageDraw.Draw(vign).ellipse((-W * 0.45, -H * 0.18, W * 1.45, H * 1.18), fill=255)
    vign = vign.filter(ImageFilter.GaussianBlur(170))
    scan = Image.new('L', (W, H), 255)
    sd = ImageDraw.Draw(scan)
    for y in range(0, H, 4):
        sd.line((0, y, W, y), fill=222)
    grains = [Image.merge('RGB', [Image.effect_noise((W // 2, H // 2), 22).resize((W, H), Image.NEAREST)] * 3) for _ in range(4)]
    parts = Particles(rng)
    parts.dust(70)
    box = (EYES[0] - 470, EYES[1] - 560, EYES[0] + 470, EYES[1] + 1020)

    events = {'cuts': [], 'stutters': [], 'overload': overload, 'black': black, 'reveal': reveal, 'relapses': []}
    frames = round(total * FPS)
    ff = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                           '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
                           '-pix_fmt', 'yuv420p', str(Path(out_dir) / 'video.mp4')], stdin=subprocess.PIPE)
    keys, key_at = [], None
    shake_imp = []          # (time, strength)
    last_seg = -1
    for fi in range(frames):
        t = fi / FPS
        dt = 1 / FPS
        frng = random.Random(fi * 7919)
        canvas = Image.new('RGB', (W, H), (0, 0, 0))
        hiss_amt, split, tears, blocks, bracket_a, flash, cut_bloom = 0.0, 0, 0, 0, 0.0, 0.0, 0.0
        pull = None
        tremble = 0.0

        if t < INTRO:
            p = t / INTRO
            if frng.random() < 0.25 + 0.5 * p:
                y = frng.randrange(0, H)
                ImageDraw.Draw(canvas).rectangle((0, y, W, y + frng.choice((2, 3, 6))), fill=RED)
            r = 8 + 70 * p ** 3
            spark = Image.new('L', (W, H), 0)
            ImageDraw.Draw(spark).ellipse((EYES[0] - r, EYES[1] - r, EYES[0] + r, EYES[1] + r), fill=255)
            spark = spark.filter(ImageFilter.GaussianBlur(10 + 30 * p)).point(lambda v, p=p: min(255, round(v * (0.3 + 1.0 * p))))
            canvas = Image.composite(Image.new('RGB', (W, H), (255, 225, 225)), canvas, spark)
            bracket_a = 0.9 if 0.2 < p < 0.34 else 0.0
            tremble = 2 * p

        elif t < overload:
            i = max(k for k, s in enumerate(segs) if s[0] <= t + 1e-9)
            start, name, dur = segs[i]
            since = t - start
            prog = (t - INTRO) / (overload - INTRO)
            if i != last_seg:
                last_seg = i
                events['cuts'].append((start, name, i))
                shake_imp.append((start, 22 - 10 * prog))
                parts.spawn(18 + round(22 * prog), EYES, (500, 1400), TINT[name], (0.25, 0.6), size=(2, 5), drag=3.0,
                            spread=(180, 420))
            nxt = segs[i + 1][1] if i + 1 < len(segs) else ORDER[(i + 1) % 8]
            prev = segs[i - 1][1] if i > 0 else None
            # The holder: alive, swaying, bobbing; the camera leans in over the whole fight.
            zoom = 1.0 + 0.08 * prog ** 1.5
            sway = 2.2 * math.sin(t * 5.1 + i) * (1 - 0.5 * prog)
            bob = 10 * math.sin(t * 3.3 + i * 1.7)
            punch = 1 + 0.05 * max(0.0, 1 - since / 0.12)
            canvas = ImageChops.add(canvas, scale_rgb(glows[name], 0.6 + 0.6 * max(0.0, 1 - since / 0.3)))
            holder = place(layers[name], zoom * punch, sway, 0, bob)
            # The loser's echo: a red ghost of the previous one, sliding off.
            if prev and since < 0.18:
                ghost = place(layers[prev], zoom * (1 + since * 0.6), -sway, frng.randint(-30, 30), bob)
                ghost.putalpha(ghost.getchannel('A').point(lambda v, s=since: round(v * 0.45 * (1 - s / 0.18))))
                canvas = over(canvas, ghost)
                canvas = hiss(canvas, 0.35 * (1 - since / 0.18))
            canvas = over(canvas, holder)
            # The challenger tears in over the last 45 % of the segment, stuttering in and out.
            intrude = (since / dur - 0.55) / 0.45
            if intrude > 0:
                chal = over(Image.new('RGB', (W, H), (0, 0, 0)), place(layers[nxt], zoom * 1.03, -sway, frng.randint(-20, 20), bob))
                if frng.random() < 0.18 + 0.5 * intrude:
                    canvas = chal if frng.random() < 0.5 * intrude else tear(canvas, chal, frng, 18, 70, 0.9)
                    events['stutters'].append(t)
                canvas = tear(canvas, chal, frng, round(4 + 24 * intrude), round(20 + 90 * intrude), 0.6 * intrude)
                split = round(4 + 14 * intrude)
                blocks = round(3 * intrude + 8 * prog * intrude)
                hiss_amt = max(hiss_amt, 0.12 * intrude * (0.4 + prog))
            split = max(split, round(12 * max(0.0, 1 - since / 0.08)))
            bracket_a = max(bracket_a, 0.9 * max(0.0, 1 - since / 0.1) if since < 0.1 else 0.0)
            cut_bloom = 0.7 * max(0.0, 1 - since / 0.08)
            tremble = 3 + 9 * prog ** 2

        elif t < black:
            # Overload: everyone at once, red, pulled into the eyes.
            p = (t - overload) / OVERLOAD
            name = ORDER[fi % 8]
            canvas = ImageChops.add(canvas, scale_rgb(redglow, 0.5 + 0.8 * p))
            for k in range(3):
                ghost = place(layers[ORDER[(fi + k * 3) % 8]], 1.08 + 0.04 * k + 0.1 * p, frng.uniform(-6, 6),
                              frng.randint(-60, 60), frng.randint(-40, 40))
                ghost.putalpha(ghost.getchannel('A').point(lambda v: v * 55 // 100))
                canvas = over(canvas, ghost)
            canvas = over(canvas, place(layers[name], 1.1 + 0.12 * p, frng.uniform(-4, 4)))
            canvas = tear(canvas, None, frng, 30, 160, 0)
            hiss_amt = 0.35 + 0.55 * p
            split = 16 + round(20 * p)
            blocks = 12
            tremble = 18 + 20 * p
            pull = EYES
            if fi % 2 == 0:
                parts.spawn(10, EYES, (0.8, 1.6), [RED, (255, 255, 255)], (0.2, 0.4), size=(2, 4), drag=0, spread=(700, 1100),
                            inward=True)
            bracket_a = 1.0 if (fi // 3) % 2 == 0 else 0.3
            if key_at is None:
                key_at = fi

        elif t < reveal:
            # Black. Silence. (Particles are cleared: the room holds its breath.)
            parts.p = [q for q in parts.p if q[8] == 0.0 and math.hypot(q[2], q[3]) < 40]
            ff.stdin.write(Image.new('RGB', (W, H), (0, 0, 0)).tobytes())
            continue

        else:
            since = t - reveal
            if since < dt / 2:
                events['cuts'].append((reveal, 'hero', 99))
                shake_imp.append((reveal, 46))
                parts.spawn(220, EYES, (500, 2600), [(255, 250, 245), (255, 220, 210), RED], (0.5, 1.4), size=(2, 6), drag=2.2)
            frame = Image.open(idle[int(since * 30) % len(idle)]).convert('RGBA')
            layer = Image.new('RGBA', LAYER, (0, 0, 0, 0))
            layer.alpha_composite(frame, PAD)
            s = 1.0 + 0.16 * (1 - elastic_out(min(1.0, since / 0.9)))
            canvas = ImageChops.add(canvas, scale_rgb(glows['hero'], 0.35 + 0.9 * max(0.0, 1 - since / 1.3)))
            for k, delay in enumerate((0.0, 0.12)):
                q = since - delay
                if 0 <= q < 0.9:
                    ring = Image.new('L', (W, H), 0)
                    pr = ease_out(q / 0.9)
                    r = 70 + 1500 * pr
                    ImageDraw.Draw(ring).ellipse((EYES[0] - r, EYES[1] - r * 1.05, EYES[0] + r, EYES[1] + r * 1.05),
                                                 outline=255, width=max(2, round((30 if k == 0 else 14) * (1 - pr))))
                    ring = ring.filter(ImageFilter.GaussianBlur(4)).point(lambda v, pr=pr: round(v * (1 - pr)))
                    canvas = Image.composite(Image.new('RGB', (W, H), (255, 240, 236) if k == 0 else RED), canvas, ring)
            canvas = over(canvas, place(layer, s))
            # The others try to come back, twice, and lose.
            for rt in (0.55, 0.95):
                if rt <= since < rt + 0.1:
                    if not events['relapses'] or events['relapses'][-1] != rt:
                        events['relapses'].append(rt)
                    intr = over(Image.new('RGB', (W, H), (0, 0, 0)), place(layers[ORDER[frng.randrange(8)]], s * 1.02))
                    canvas = tear(canvas, intr, frng, 16, 90, 0.7)
                    split, hiss_amt, tremble = 10, 0.2, 8
            flash = 1.0 * max(0.0, 1 - since / 0.32) ** 2
            bracket_a = 0.9 * max(0.0, 1 - since / 0.5)
            tremble = max(tremble, 2 * max(0.0, 1 - since / 1.5))

        # ── Effects, in order ──
        parts.step(dt, pull)
        canvas = parts.draw(canvas)
        if tears:
            canvas = tear(canvas, None, frng, tears, 60, 0)
        if blocks:
            canvas = macroblocks(canvas, frng, blocks)
        canvas = rgb_split(canvas, split, 0)
        canvas = hiss(canvas, hiss_amt)
        canvas = brackets(canvas, bracket_a, box)
        canvas = ImageChops.multiply(canvas, Image.merge('RGB', [scan] * 3))
        canvas = ImageChops.overlay(canvas, grains[fi % 4])
        canvas = Image.composite(canvas, Image.new('RGB', (W, H), (0, 0, 0)), vign)
        if cut_bloom > 0.01:
            canvas = ImageChops.add(canvas, scale_rgb(bloom, cut_bloom))
        if flash > 0.01:
            canvas = Image.blend(canvas, Image.new('RGB', (W, H), (255, 250, 248)), min(1.0, flash))
        # Screen shake: impulses decaying, plus the tremble; applied to the whole frame.
        amp = tremble + sum(sv * math.exp(-(t - st) / 0.09) for st, sv in shake_imp if 0 <= t - st < 0.6)
        if amp > 0.5:
            dx = round(amp * (math.sin(t * 91) * 0.6 + frng.uniform(-0.4, 0.4)))
            dy = round(amp * (math.cos(t * 77) * 0.6 + frng.uniform(-0.4, 0.4)))
            canvas = ImageChops.offset(canvas, dx, dy)
        ff.stdin.write(canvas.tobytes())
        if fi in (round(0.4 * FPS), round((segs[1][0] + segs[1][2] * 0.8) * FPS), round((segs[5][0] + 0.03) * FPS),
                  round((segs[12][0] + 0.02) * FPS), (key_at or -1) + 12, round((reveal + 0.06) * FPS), round((reveal + 1.5) * FPS)):
            keys.append(canvas.resize((W // 5, H // 5)))
    ff.stdin.close()
    ff.wait()
    sheet = Image.new('RGB', (len(keys) * (W // 5), H // 5))
    for n, k in enumerate(keys):
        sheet.paste(k, (n * (W // 5), 0))
    sheet.save(Path(out_dir) / 'keyframes-v2.png')
    events['total'] = total
    return events


# ── Sound ──────────────────────────────────────────────────────────────────────────────────────────────────
def sound(ev, path):
    total = ev['total']
    n = int(total * SR) + SR
    L = array.array('f', bytes(4 * n))
    R = array.array('f', bytes(4 * n))
    rng = random.Random(5)

    def add(i, v, pan=0.0):
        if 0 <= i < n:
            L[i] += v * (1 - max(0.0, pan))
            R[i] += v * (1 + min(0.0, pan))

    ov, bl, rv = ev['overload'], ev['black'], ev['reveal']
    # Drone: two detuned lows and a dissonant fifth-ish, swelling toward the overload; gone in the black.
    ph = [0.0, 0.0, 0.0]
    lp = 0.0
    for i in range(0, int(bl * SR)):
        t = i / SR
        p = min(1.0, t / ov)
        for k, f in enumerate((55.0, 58.3, 82.4 + 30 * p ** 2)):
            ph[k] += 2 * math.pi * f / SR
        saw = sum(((ph[k] / math.pi) % 2 - 1) for k in range(3)) / 3
        lp += (0.02 + 0.1 * p) * (saw - lp)
        v = lp * (0.12 + 0.35 * p ** 1.6)
        add(i, v, 0.15 * math.sin(t * 1.3))
    # Riser air, louder and brighter, then the overload roar.
    lpn = 0.0
    for i in range(int(0.4 * SR), int(bl * SR)):
        t = i / SR
        p = min(1.0, t / ov)
        roar = 0.0 if t < ov else (t - ov) / (bl - ov)
        lpn += (0.03 + 0.5 * p ** 2 + 0.4 * roar) * (rng.uniform(-1, 1) - lpn)
        add(i, lpn * (0.03 + 0.28 * p ** 2.2 + 0.5 * roar), rng.uniform(-0.2, 0.2))
    # Every takeover: a thump, a crunchy glitch (sample-and-hold noise), a tick climbing in pitch.
    for k, (t0, name, idx) in enumerate(ev['cuts']):
        if name == 'hero':
            continue
        i0 = int(t0 * SR)
        pan = 0.4 if k % 2 else -0.4
        phk = 0.0
        for j in range(int(0.16 * SR)):
            tt = j / SR
            f = 45 + 110 * math.exp(-tt * 28)
            phk += 2 * math.pi * f / SR
            add(i0 + j, 0.55 * math.exp(-tt * 18) * math.sin(phk), 0)
        hold, held = 0, 0.0
        step = rng.choice((6, 9, 14))
        for j in range(int(0.07 * SR)):
            if hold <= 0:
                held, hold = rng.uniform(-1, 1), step
            hold -= 1
            add(i0 + j, 0.22 * held * math.exp(-j / (0.03 * SR)), -pan)
        f = 380 * 2 ** (k / 6)
        for j in range(int(0.05 * SR)):
            add(i0 + j, 0.12 * math.exp(-j / (0.01 * SR)) * math.sin(2 * math.pi * f * j / SR), pan)
    # Stutters while they fight: short grains repeated.
    for t0 in ev['stutters'][::2]:
        i0 = int(t0 * SR)
        grain = [rng.uniform(-1, 1) * 0.12 for _ in range(int(0.012 * SR))]
        for rep in range(3):
            for j, v in enumerate(grain):
                add(i0 + rep * len(grain) + j, v * (1 - rep * 0.25), rng.choice((-0.5, 0.5)))
    # Overload: grains accelerating into a buzz.
    t = ov
    gap = 0.05
    while t < bl:
        i0 = int(t * SR)
        f = rng.uniform(200, 900)
        for j in range(int(0.02 * SR)):
            add(i0 + j, 0.2 * math.sin(2 * math.pi * f * j / SR) * (1 if (j // 40) % 2 else -1), rng.uniform(-0.6, 0.6))
        t += gap
        gap = max(0.012, gap * 0.82)
    # (Black: nothing at all.)
    # The reveal: sub drop, distorted hit, a bright chord that rings, a low swell under it.
    i0 = int(rv * SR)
    ph = 0.0
    lpn = 0.0
    for j in range(int(3.0 * SR)):
        tt = j / SR
        f = 36 + 80 * math.exp(-tt * 5)
        ph += 2 * math.pi * f / SR
        sub = 1.0 * math.exp(-tt * 1.8) * math.sin(ph)
        lpn += 0.35 * (rng.uniform(-1, 1) - lpn)
        hit = math.tanh(3 * lpn) * 0.7 * math.exp(-tt * 10)
        chime = sum(a * math.sin(2 * math.pi * fr * tt) for fr, a in
                    ((523.25, 0.06), (783.99, 0.05), (1046.5, 0.06), (1318.5, 0.045), (1567.98, 0.04), (2093.0, 0.03))) \
            * math.exp(-tt * 1.3) * min(1.0, tt / 0.02)
        add(i0 + j, sub + hit, 0)
        add(i0 + j, chime, -0.25)
        add(i0 + j + int(0.017 * SR), chime * 0.85, 0.25)
    for rt in ev['relapses']:
        j0 = int((rv + rt) * SR)
        for j in range(int(0.09 * SR)):
            add(j0 + j, 0.15 * rng.uniform(-1, 1) * (1 if (j // 120) % 2 else 0.2), rng.choice((-0.4, 0.4)))
    # Idle bed: warm and quiet.
    p0 = int((rv + 0.5) * SR)
    for i in range(p0, n):
        t = (i - p0) / SR
        fade = min(1.0, t / 1.8) * min(1.0, (n - SR - i) / (0.6 * SR)) if i < n - SR else 0
        v = sum(0.026 * math.sin(2 * math.pi * fr * t + 0.6 * math.sin(2 * math.pi * 0.17 * t + fr)) for fr in (196.0, 246.94, 293.66, 392.0))
        add(i, v * max(0.0, fade), 0)
    peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1
    g = 0.9 / math.tanh(peak * 1.2)
    out = array.array('h')
    for i in range(int(total * SR)):
        out.append(round(32767 * max(-1, min(1, math.tanh(L[i] * 1.2) * g))))
        out.append(round(32767 * max(-1, min(1, math.tanh(R[i] * 1.2) * g))))
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(out.tobytes())


if __name__ == '__main__':
    aligned, idle_dir, out = sys.argv[1:4]
    app = '--app' in sys.argv
    Path(out).mkdir(parents=True, exist_ok=True)
    ev = render(aligned, idle_dir, out, app)
    name = 'startup-v2-app' if app else 'startup-v2'
    sound(ev, Path(out) / f'{name}.wav')
    extra = ['-af', f"afade=t=out:st={ev['total'] - 0.6:.2f}:d=0.6", '-c:a', 'aac', '-b:a', '160k'] if app else ['-c:a', 'aac', '-b:a', '192k']
    vcodec = ['-vf', f"fade=t=out:st={ev['total'] - 0.45:.2f}:d=0.45", '-c:v', 'libx264', '-crf', '23', '-preset', 'slow',
              '-pix_fmt', 'yuv420p', '-tag:v', 'avc1'] if app else ['-c:v', 'copy']
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(Path(out) / 'video.mp4'), '-i', str(Path(out) / f'{name}.wav'),
                    *vcodec, *extra, '-shortest', '-movflags', '+faststart', str(Path(out) / f'{name}.mp4')], check=True)
    (Path(out) / 'video.mp4').unlink()
    print(f"cuts {len(ev['cuts'])}, overload {ev['overload']:.2f}, reveal {ev['reveal']:.2f}, total {ev['total']:.2f}")
