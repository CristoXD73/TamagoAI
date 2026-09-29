#!/usr/bin/env python3
"""Tamago's startup sequence, v1: the owner's eight universes flick through faster and faster, land on the hero,
and hand over to the idle float. Picture and sound are both made here; ffmpeg encodes.

Owner, 2026-09-29: "remove the background of all the octopuses i sent you, try to line them up on each other as
accurately as possible and do a motion design where they all transform, it becomes one then the other then the
other in rapid succession ramping up until it becomes our original hero, then the idle floating animation begins.
... Feel free to add sound and effects and polish it."

    python3 tools/brand/startup_sequence.py ALIGNED_DIR IDLE_FRAMES_DIR OUT_DIR

ALIGNED_DIR comes from startup_align.py (1024 x 1400 RGBA each, hero at PAD). Output: startup-v1.mp4
(1080 x 1920, 60 fps, AAC stereo), startup-v1.wav, and keyframes.png.
"""
import array
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from startup_align import ORDER, PAD  # noqa: E402

FPS = 60
W, H = 1080, 1920
LAYER = (1024, 1400)
ORIGIN = ((W - LAYER[0]) // 2, (H - LAYER[1]) // 2)          # where an aligned layer sits on the canvas
EYES = (ORIGIN[0] + PAD[0] + 387, ORIGIN[1] + PAD[1] + 296)   # the hero's eye midpoint on the canvas
SR = 44100
BIG = 1.35          # the octopus fills the phone frame
random.seed(3)

# Each universe's accent colour, for its glow and flash.
TINT = {'neon': (255, 40, 150), 'ink': (200, 196, 186), 'stone-moss': (120, 170, 70), 'velvet': (150, 100, 200),
        'sprout': (240, 50, 40), 'metal': (170, 190, 215), 'xray': (120, 190, 255), 'cardboard': (220, 160, 80),
        'hero': (255, 236, 228)}

INTRO = 0.75
CYCLE1 = [0.62, 0.50, 0.40, 0.32, 0.26, 0.21, 0.17, 0.14]
CYCLE2 = [0.11, 0.095, 0.08, 0.07, 0.06, 0.05, 0.045, 0.04]
IDLE = 4.8


def ease_out(t):
    return 1 - (1 - t) ** 3


def ease_out_back(t, s=1.6):
    t -= 1
    return 1 + (s + 1) * t ** 3 + s * t ** 2


def timeline():
    """[(start_seconds, name, cycle)] for every cut, then the reveal time and the total length."""
    cuts, t = [], INTRO
    for cyc, durs in ((1, CYCLE1), (2, CYCLE2)):
        for name, d in zip(ORDER, durs):
            d = max(2 / FPS, round(d * FPS) / FPS)
            cuts.append((t, name, cyc, d))
            t += d
    return cuts, t, t + IDLE


# ── Picture ────────────────────────────────────────────────────────────────────────────────────────────────
def radial(color, radius, strength):
    g = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(g)
    for i in range(40, 0, -1):
        r = radius * i / 40
        d.ellipse((EYES[0] - r, EYES[1] + 120 - r * 1.2, EYES[0] + r, EYES[1] + 120 + r * 1.2), fill=round(255 * (1 - i / 40) ** 1.6))
    g = g.filter(ImageFilter.GaussianBlur(30)).point(lambda v: round(v * strength))
    return Image.merge('RGB', [g.point(lambda v, c=c: v * c // 255) for c in color])


def place(layer, scale, split=0):
    """The octopus layer scaled about the eyes, optionally with an RGB split, as a full-canvas RGBA."""
    if split:
        r, g, b, a = layer.split()
        r, b = ImageChops.offset(r, split, 0), ImageChops.offset(b, -split, 0)
        a = ImageChops.lighter(a, ImageChops.lighter(ImageChops.offset(a, split, 0), ImageChops.offset(a, -split, 0)))
        layer = Image.merge('RGBA', (r, g, b, a))
    scale *= BIG
    ex, ey = EYES[0] - ORIGIN[0], EYES[1] - ORIGIN[1]
    sw, sh = round(LAYER[0] * scale), round(LAYER[1] * scale)
    scaled = layer.resize((sw, sh), Image.BICUBIC)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.alpha_composite(scaled, (round(EYES[0] - ex * scale), round(EYES[1] - ey * scale)))
    return out


def render(aligned_dir, idle_dir, out_dir):
    cuts, reveal, total = timeline()
    layers = {n: Image.open(Path(aligned_dir) / f'{n}.png').convert('RGBA') for n in ORDER}
    idle = sorted(Path(idle_dir).glob('frame-*.png'))
    glows = {n: radial(TINT[n], 620 * BIG, 0.55) for n in list(ORDER) + ['hero']}
    bloom = radial((255, 250, 246), 900, 1.0)     # the per-cut flash: bright in the middle, edges stay dark
    vignette = Image.new('L', (W, H), 0)
    ImageDraw.Draw(vignette).ellipse((-W * 0.35, -H * 0.2, W * 1.35, H * 1.2), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(160))
    sparks = [(random.uniform(0, 2 * math.pi), random.uniform(500, 1400), random.uniform(2, 5)) for _ in range(90)]

    frames = round(total * FPS)
    ff = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                           '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
                           '-pix_fmt', 'yuv420p', str(Path(out_dir) / 'video.mp4')], stdin=subprocess.PIPE)
    keys = []
    for fi in range(frames):
        t = fi / FPS
        canvas = Image.new('RGB', (W, H), (0, 0, 0))
        flash = 0.0
        if t < INTRO:
            # A spark where the eyes will be, swelling.
            p = t / INTRO
            spark = Image.new('L', (W, H), 0)
            r = 10 + 90 * p ** 3
            ImageDraw.Draw(spark).ellipse((EYES[0] - r, EYES[1] - r, EYES[0] + r, EYES[1] + r), fill=255)
            spark = spark.filter(ImageFilter.GaussianBlur(8 + 36 * p)).point(lambda v, p=p: min(255, round(v * (0.3 + 0.9 * p))))
            canvas = Image.composite(Image.new('RGB', (W, H), (255, 220, 240)), canvas, spark)
        elif t < reveal:
            i = max(k for k, c in enumerate(cuts) if c[0] <= t + 1e-9)
            start, name, cyc, dur = cuts[i]
            since = t - start
            progress = (t - INTRO) / (reveal - INTRO)
            zoom = 1.0 + 0.07 * progress ** 2                          # the camera leans in as it speeds up
            punch = 1 + (0.05 if cyc == 1 else 0.03) * max(0.0, 1 - since / min(0.12, dur))
            tr = min(4, max(1, round(dur * FPS / 2)))                  # frames of transition
            k = min(1.0, since * FPS / tr)
            split = round((1 - k) * (10 if cyc == 1 else 8))
            cut_flash = (0.55 if cyc == 1 else 0.35) * max(0.0, 1 - since / 0.09)
            glow_k = 0.55 + 0.45 * max(0.0, 1 - since / 0.25)
            canvas = ImageChops.add(canvas, glows[name].point(lambda v, g=glow_k: round(v * g)))
            if i == 0 and since < 0.25:
                canvas = canvas.point(lambda v, s=since: round(v * s / 0.25))
            if i > 0 and k < 1:
                prev = place(layers[cuts[i - 1][1]], zoom)
                prev.putalpha(prev.getchannel('A').point(lambda v, k=k: round(v * (1 - k))))
                canvas = canvas.convert('RGBA')
                canvas.alpha_composite(prev)
            cur = place(layers[name], zoom * punch * (0.9 + 0.1 * ease_out(min(1, since / 0.25)) if i == 0 else zoom * punch), split)
            if k < 1:
                cur.putalpha(cur.getchannel('A').point(lambda v, k=k: round(v * (0.35 + 0.65 * k))))
            canvas = canvas.convert('RGBA')
            canvas.alpha_composite(cur)
            canvas = canvas.convert('RGB')
            if cut_flash > 0.01:
                canvas = ImageChops.add(canvas, bloom.point(lambda v, f=cut_flash: round(v * f)))
        else:
            # The hero lands: flash, shockwave, sparks, and the idle float takes over.
            since = t - reveal
            frame = Image.open(idle[min(len(idle) - 1, int(since * 30)) % len(idle)]).convert('RGBA')
            layer = Image.new('RGBA', LAYER, (0, 0, 0, 0))
            layer.alpha_composite(frame, PAD)
            scale = 1.0 + 0.1 * (1 - ease_out_back(min(1.0, since / 0.55)))
            glow_k = 0.35 + 0.65 * max(0.0, 1 - since / 1.2)
            canvas = ImageChops.add(canvas, glows['hero'].point(lambda v, g=glow_k: round(v * g * 0.8)))
            if since < 0.9:
                ring = Image.new('L', (W, H), 0)
                p = ease_out(since / 0.9)
                r = 60 + 1500 * p
                ImageDraw.Draw(ring).ellipse((EYES[0] - r, EYES[1] - r, EYES[0] + r, EYES[1] + r), outline=255,
                                             width=max(2, round(26 * (1 - p))))
                ring = ring.filter(ImageFilter.GaussianBlur(3)).point(lambda v, p=p: round(v * (1 - p) * 0.9))
                canvas = Image.composite(Image.new('RGB', (W, H), (235, 245, 255)), canvas, ring)
            if since < 1.4:
                sp = Image.new('L', (W, H), 0)
                d = ImageDraw.Draw(sp)
                for ang, speed, size in sparks:
                    dist = speed * (1 - math.exp(-since * 3.2)) / 3.2
                    x, y = EYES[0] + math.cos(ang) * dist, EYES[1] + math.sin(ang) * dist
                    s = size * (1 - since / 1.4)
                    d.ellipse((x - s, y - s, x + s, y + s), fill=round(255 * (1 - since / 1.4)))
                canvas = Image.composite(Image.new('RGB', (W, H), (255, 240, 230)), canvas, sp.filter(ImageFilter.GaussianBlur(1)))
            canvas = canvas.convert('RGBA')
            canvas.alpha_composite(place(layer, scale))
            canvas = canvas.convert('RGB')
            flash = 0.85 * max(0.0, 1 - since / 0.4) ** 2
        # Vignette keeps the edges dark; flash last.
        canvas = Image.composite(canvas, Image.new('RGB', (W, H), (0, 0, 0)), vignette)
        if flash > 0.005:
            canvas = Image.blend(canvas, Image.new('RGB', (W, H), (255, 252, 250)), min(1.0, flash))
        ff.stdin.write(canvas.tobytes())
        if fi in (round(0.5 * FPS), round((cuts[2][0] + 0.2) * FPS), round((cuts[5][0] + 0.1) * FPS),
                  round((cuts[11][0]) * FPS), round((reveal + 0.05) * FPS), round((reveal + 1.5) * FPS)):
            keys.append(canvas.resize((W // 4, H // 4)))
    ff.stdin.close()
    ff.wait()
    sheet = Image.new('RGB', (len(keys) * W // 4, H // 4))
    for n, k in enumerate(keys):
        sheet.paste(k, (n * W // 4, 0))
    sheet.save(Path(out_dir) / 'keyframes.png')
    return cuts, reveal, total


# ── Sound ──────────────────────────────────────────────────────────────────────────────────────────────────
def sound(cuts, reveal, total, path):
    n = int(total * SR) + SR
    L = array.array('f', bytes(4 * n))
    R = array.array('f', bytes(4 * n))

    def add(i, v, pan=0.0):
        if 0 <= i < n:
            L[i] += v * (1 - max(0.0, pan))
            R[i] += v * (1 + min(0.0, pan))

    # Riser: a low tone climbing, and air (lowpassed noise) opening up; both cut just before the hit.
    lp = 0.0
    ph = ph2 = 0.0
    end = int((reveal - 0.06) * SR)
    start = int(0.2 * SR)
    for i in range(start, end):
        p = (i - start) / (end - start)
        f = 42 + 80 * p ** 2
        ph += 2 * math.pi * f / SR
        ph2 += 2 * math.pi * f * 2.01 / SR
        tone = (math.sin(ph) + 0.35 * math.sin(ph2)) * (0.05 + 0.22 * p ** 1.5)
        a = 0.02 + 0.5 * p ** 2
        lp += a * (random.uniform(-1, 1) - lp)
        air = lp * (0.02 + 0.3 * p ** 2.2)
        add(i, tone + air, 0.0)
    # A tick per cut, higher each time, alternating sides; a soft whoosh under the slow ones.
    for k, (t0, name, cyc, dur) in enumerate(cuts):
        i0 = int(t0 * SR)
        f = 320 * 2 ** (k / 5.5)
        pan = 0.35 if k % 2 else -0.35
        for j in range(int(0.06 * SR)):
            e = math.exp(-j / (0.012 * SR))
            add(i0 + j, 0.22 * e * math.sin(2 * math.pi * f * j / SR) + (0.25 * random.uniform(-1, 1) if j < 90 else 0), pan)
        if cyc == 1:
            lpw = 0.0
            m = int(min(0.18, dur) * SR)
            for j in range(m):
                env = math.sin(math.pi * j / m)
                lpw += 0.08 * (random.uniform(-1, 1) - lpw)
                add(i0 - m // 2 + j, 0.5 * env * lpw, -pan)
    # The reveal: a sub drop, a noise hit and a bright chime that rings out.
    i0 = int(reveal * SR)
    ph = 0.0
    lp = 0.0
    for j in range(int(2.4 * SR)):
        t = j / SR
        f = 40 + 60 * math.exp(-t * 6)
        ph += 2 * math.pi * f / SR
        sub = 0.85 * math.exp(-t * 2.2) * math.sin(ph)
        lp += 0.25 * (random.uniform(-1, 1) - lp)
        hit = 0.6 * math.exp(-t * 14) * lp
        chime = sum(a * math.sin(2 * math.pi * fr * t * (1 + 0.002 * math.sin(2 * math.pi * 5 * t))) for fr, a in
                    ((1046.5, 0.07), (1318.5, 0.05), (1568.0, 0.05), (2093.0, 0.035), (3136.0, 0.02))) * math.exp(-t * 1.6)
        add(i0 + j, sub + hit, 0.0)
        add(i0 + j, chime * 0.9, -0.2)
        add(i0 + j + int(0.013 * SR), chime * 0.9, 0.2)
    # Idle: a quiet, warm pad (G major, drifting), and now and then a bubble.
    p0 = int((reveal + 0.3) * SR)
    for i in range(p0, n):
        t = (i - p0) / SR
        fade = min(1.0, t / 1.6) * min(1.0, (n - i) / (0.6 * SR))
        v = sum(0.028 * math.sin(2 * math.pi * fr * t + 0.7 * math.sin(2 * math.pi * 0.2 * t + fr)) for fr in (196.0, 246.94, 293.66, 392.0))
        add(i, v * fade * (0.8 + 0.2 * math.sin(2 * math.pi * 0.25 * t)), 0.0)
    for b in range(5):
        i0 = int((reveal + 1.0 + b * 0.9 + random.uniform(0, 0.4)) * SR)
        f0 = random.uniform(900, 1300)
        pan = random.uniform(-0.5, 0.5)
        for j in range(int(0.07 * SR)):
            t = j / SR
            add(i0 + j, 0.05 * math.sin(2 * math.pi * (f0 * t + 6000 * t * t)) * math.sin(math.pi * j / (0.07 * SR)), pan)
    # Master: gentle saturation and a limit at -1 dBFS.
    peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1
    g = 0.89 / math.tanh(peak * 1.3) if peak > 0 else 1
    out = array.array('h')
    for i in range(int(total * SR)):
        out.append(round(32767 * max(-1, min(1, math.tanh(L[i] * 1.3) * g))))
        out.append(round(32767 * max(-1, min(1, math.tanh(R[i] * 1.3) * g))))
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(out.tobytes())


if __name__ == '__main__':
    aligned, idle_dir, out = sys.argv[1:4]
    Path(out).mkdir(parents=True, exist_ok=True)
    cuts, reveal, total = render(aligned, idle_dir, out)
    sound(cuts, reveal, total, Path(out) / 'startup-v1.wav')
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(Path(out) / 'video.mp4'), '-i', str(Path(out) / 'startup-v1.wav'),
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
                    str(Path(out) / 'startup-v1.mp4')], check=True)
    (Path(out) / 'video.mp4').unlink()
    print(f'reveal at {reveal:.2f} s, total {total:.2f} s, {len(cuts)} cuts')
