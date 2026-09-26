"""Storyboard contact sheets for the first 10 prototype animations. PREVIZ ONLY."""
import math, os, textwrap
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from engine import *
import scene_edge_inspection as EI
OUT = os.environ.get('PREVIZ_OUT', os.path.join(HERE, '_work', 'out'))
os.makedirs(OUT, exist_ok=True)

F_T = ImageFont.load_default(size=22)
F_S = ImageFont.load_default(size=13)
F_B = ImageFont.load_default(size=15)
CYAN = (0.95, 0.85, 0.30)   # BGR-ish in float screen (drawn in screen space, shows cyan-ish)

BF = 'big_front'


def C(**kw):
    """creature pose with defaults"""
    p = dict(sprite=BF, scale=0.40, pos=(0.5, 0.5))
    p.update(kw)
    return p


def lagv(dx, dy=0.0, lead=0.0):
    """storyboard helper: static trailing offset (sprite units) growing to arm tips"""
    def f(frac):
        w = max(0.0, (frac - 0.30) / 0.70) ** 1.2
        h = lead if frac < 0.22 else 0.0
        return (dx * w + h, dy * w)
    return f


class Static:
    def __init__(self, layers):
        self.L = layers

    def layers(self, t):
        return self.L


def arrows_on(img, arrows):
    """draw annotation arrows (normalized screen coords) on the 2x framed image"""
    d = ImageDraw.Draw(img)
    for (x0, y0), (x1, y1) in arrows:
        p0 = (BEZEL + x0 * SW, BEZEL + y0 * SH)
        p1 = (BEZEL + x1 * SW, BEZEL + y1 * SH)
        d.line([p0, p1], fill=(80, 220, 255), width=4)
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        for s in (2.6, -2.6):
            d.line([p1, (p1[0] - 22 * math.cos(ang + s / 5), p1[1] - 22 * math.sin(ang + s / 5))], fill=(80, 220, 255), width=4)


def frame(layers, t=1.0, arrows=(), tap=None):
    scr = render_scene(Static(layers), t)
    img = frame_to_image(scr)
    if tap:
        d = ImageDraw.Draw(img)
        x, y = BEZEL + tap[0] * SW, BEZEL + tap[1] * SH
        d.ellipse([x - 26, y - 26, x + 26, y + 26], outline=(255, 120, 200), width=4)
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 120, 200))
    arrows_on(img, arrows)
    return img.resize((img.width // 2, img.height // 2), Image.LANCZOS)


def sheet(code, title, dur, frames, out):
    """frames: [(img, timing, note)]"""
    fw, fh = frames[0][0].size
    cap_h = 120
    W = fw * len(frames) + 20 * (len(frames) + 1)
    H = 70 + fh + cap_h
    S = Image.new('RGB', (W, H), (16, 16, 18))
    d = ImageDraw.Draw(S)
    d.text((20, 18), f'{code}  {title}', fill=(235, 235, 240), font=F_T)
    d.text((W - 520, 24), f'{dur}   |   PREVIZ - not production art/motion', fill=(140, 140, 150), font=F_S)
    for i, (img, timing, note) in enumerate(frames):
        x = 20 + i * (fw + 20)
        S.paste(img, (x, 60))
        d.text((x + 2, 60 + fh + 6), f'{i + 1}. {timing}', fill=(120, 210, 255), font=F_B)
        for k, line in enumerate(textwrap.wrap(note, 42)[:5]):
            d.text((x + 2, 60 + fh + 28 + k * 17), line, fill=(200, 200, 205), font=F_S)
    S.save(out)
    return S


# ------------------------------------------------------------------ 01 breathing idle
def sb01():
    ts = [0.0, 1.1, 2.2, 3.3]
    notes = ['exhale: mantle at rest; arm tips mid-curl',
             'inhale peak: mantle +2% taller, arm wave travels root->tip',
             'exhale; left and right arms out of phase (never in unison)',
             'arm tips drift independently (0.23 / 0.37 Hz noise)']
    fr = []
    for t, n in zip(ts, notes):
        fr.append((frame([('creature', C(pos=(0.5, 0.52), breath=3.0), 1.0)], t), f'{t:.1f} s', n))
    return sheet('01', 'BREATHING IDLE  (amplitude shown x3 for visibility)', 'cycle 3.6-5.2 s, continuous', fr, os.path.join(OUT, 'sb01_breathing_idle.png'))


# ------------------------------------------------------------------ 02 eyes-first curiosity
def sb02():
    P = (0.52, 0.52)
    fr = [
        (frame([('creature', C(pos=P), 1.0)]), '0 ms', 'calm idle, looking at viewer'),
        (frame([('creature', C(pos=P, gaze=(-1, 0.1)), 1.0)], arrows=[((0.36, 0.30), (0.14, 0.30))]), '0-120 ms', 'EYES snap toward a point near the left edge. Nothing else moves.'),
        (frame([('creature', C(pos=P, gaze=(-1, 0.1), lid=0.18), 1.0)]), '120-700 ms', 'PAUSE. Lids tighten slightly (focus). Breathing continues. This delay sells "thinking".'),
        (frame([('creature', C(pos=(0.49, 0.515), rot=-7, gaze=(-0.8, 0.1), lag_offset=lagv(0.07, 0.0, -0.02)), 1.0)], arrows=[((0.52, 0.25), (0.42, 0.25))]), '700-1200 ms', 'HEAD rotates toward the target; arm roots follow; tips still hang where they were (lag).'),
        (frame([('creature', C(sprite='q34_left', scale=0.46, pos=(0.47, 0.50), rot=-3), 1.0)]), '1200-2200 ms', 'body re-orients (cut/blend to 3/4 view); arms swing through and settle last.'),
    ]
    return sheet('02', 'EYES-FIRST CURIOSITY', '~2.2 s, occasional', fr, os.path.join(OUT, 'sb02_eyes_first_curiosity.png'))


# ------------------------------------------------------------------ 03 tentacle-first exploration
def sb03():
    P = (0.40, 0.46)
    fr = [
        (frame([('creature', C(pos=P), 1.0)]), '0 ms', 'idle'),
        (frame([('creature', C(pos=P, gaze=(0.8, 0.8)), 1.0)]), '0-150 ms', 'eyes drop to the lower right (something down there)'),
        (frame([('creature', C(pos=P, gaze=(0.8, 0.8), arm={'R1': dict(rot=-18, ext=0.10)}), 1.0)], arrows=[((0.62, 0.72), (0.80, 0.80))]), '300-1100 ms', 'ONE arm (outer right) slides out to test the spot. Body stays put.'),
        (frame([('creature', C(pos=P, gaze=(0.6, 0.7), arm={'R1': dict(rot=-6, ext=0.04)}), 1.0)]), '1100-1500 ms', 'DECISION: the arm half-recoils, tip curls. (~40% of the time the behavior ends here.)'),
        (frame([('creature', C(pos=P, rot=7, gaze=(0.8, 0.7), arm={'R1': dict(rot=-24, ext=0.16)}), 1.0)]), '1500-2300 ms', 'arm commits further; mantle leans after it'),
        (frame([('creature', C(pos=(0.58, 0.54), rot=3, gaze=(0.4, 0.4), lag_offset=lagv(-0.06), arm={'R1': dict(rot=-8, ext=0.04)}), 1.0)], arrows=[((0.40, 0.46), (0.58, 0.54))]), '2300-4000 ms', 'body drifts to where the arm went; other arms trail and resettle'),
    ]
    return sheet('03', 'TENTACLE-FIRST EXPLORATION', '2.5-4 s, occasional', fr, os.path.join(OUT, 'sb03_tentacle_first.png'))


# ------------------------------------------------------------------ 04 slow wander
def sb04():
    fr = [
        (frame([('creature', C(pos=(0.30, 0.42), gaze=(1, 0.4)), 1.0)]), '0 ms', 'upper-left; eyes pick a destination (lower right)'),
        (frame([('creature', C(sprite='q34_left', flip=True, scale=0.46, pos=(0.33, 0.43), rot=8), 1.0)], arrows=[((0.36, 0.43), (0.55, 0.55))]), '300-900 ms', 'turn: 3/4 view facing right; mantle tilts into travel direction'),
        (frame([('creature', C(sprite='profile_left_a', flip=True, scale=0.40, pos=(0.50, 0.52), rot=24, lag_offset=lagv(-0.20, -0.04)), 1.0)]), '900-2400 ms', 'GLIDE: mantle leads, arms stream behind (tips lag 350-500 ms). Speed <= 0.08 screen/s.'),
        (frame([('creature', C(sprite='profile_left_a', flip=True, scale=0.40, pos=(0.58, 0.60), rot=10, lag_offset=lagv(0.06, 0.02)), 1.0)]), '2400-3200 ms', 'COAST/HOVER: glide stops; arms overshoot forward then fan out (drag).'),
        (frame([('creature', C(sprite='profile_left_a', flip=True, scale=0.40, pos=(0.66, 0.68), rot=20, lag_offset=lagv(-0.16, -0.03)), 1.0)]), '3200-4500 ms', 'second, weaker pulse; path is an arc, never a straight slide'),
        (frame([('creature', C(sprite='crawl_q34_right', scale=0.46, pos=(0.64, 0.80)), 1.0)]), '4500-6000 ms', 'settles onto the bottom edge ("floor") in a spread, crawling pose'),
    ]
    return sheet('04', 'SLOW WANDER', '5-9 s per leg, occasional', fr, os.path.join(OUT, 'sb04_slow_wander.png'))


# ------------------------------------------------------------------ 05 edge inspection (actual render)
def sb05():
    sc = EI.Scene()
    keys = [(0.5, 'idle'), (2.3, 'eyes notice edge; pause'), (3.4, 'scout arm, hesitation'), (4.4, 'body follows, arms trail'),
            (5.4, 'tip meets glass, flattens'), (7.7, 'glances back at viewer'), (9.6, 'retract, drift home')]
    fr = []
    for t, n in keys:
        img = frame_to_image(render_scene(sc, t))
        fr.append((img.resize((img.width // 2, img.height // 2), Image.LANCZOS), f'{t:.1f} s', n))
    return sheet('05', 'EDGE INSPECTION  (= FIRST MOTION TEST, frames from the rendered prototype)', '11 s, rare', fr, os.path.join(OUT, 'sb05_edge_inspection.png'))


# ------------------------------------------------------------------ 06 full exit
def sb06():
    Q = dict(sprite='q34_left', flip=True, scale=0.46)
    fr = [
        (frame([('creature', C(**Q, pos=(0.60, 0.50), rot=4), 1.0)], arrows=[((0.72, 0.33), (0.95, 0.33))]), '0-600 ms', 'eyes to the right edge; a beat of stillness'),
        (frame([('creature', C(**Q, pos=(0.80, 0.49), rot=16, lag_offset=lagv(-0.14, 0.02)), 1.0)]), '600-1800 ms', 'mantle leads toward edge; arms trail'),
        (frame([('creature', C(**Q, pos=(1.02, 0.48), rot=20, lag_offset=lagv(-0.22, 0.03)), 1.0)]), '1800-2600 ms', 'mantle and eyes gone; arms still inside the window'),
        (frame([('creature', C(**Q, pos=(1.13, 0.48), rot=22, lag_offset=lagv(-0.30, 0.04)), 1.0)]), '2600-3400 ms', 'last arm tip lingers, curls, then slips out'),
        (frame([]), '3.4 s -> 2-6 s', 'EMPTY BLACK WINDOW. Nothing. The world continues offscreen.'),
    ]
    return sheet('06', 'FULL EXIT', '~3.4 s + empty hold', fr, os.path.join(OUT, 'sb06_full_exit.png'))


# ------------------------------------------------------------------ 07 peek return
def sb07():
    fr = [
        (frame([]), 'empty', 'window has been empty 2-6 s'),
        (frame([('creature', C(pos=(-0.22, 0.60), arm={'R1': dict(rot=-62, ext=0.26)}), 1.0)]), '0-900 ms', 'ONE arm tip slides in from the left edge, tastes the glass, curls'),
        (frame([('creature', C(pos=(-0.30, 0.60), arm={'R1': dict(rot=-40, ext=0.1)}), 1.0)]), '900-1300 ms', 'arm withdraws'),
        (frame([('creature', C(pos=(-0.05, 0.42), rot=90, gaze=(0, -0.6)), 1.0)]), '1300-2800 ms', 'EYES PEEK: body sideways, head pokes in; only mantle + eyes visible. Holds, watching.'),
        (frame([('creature', C(pos=(-0.09, 0.42), rot=90, gaze=(0, -0.6), lid=0.25), 1.0)]), '2800-3200 ms', 'cautious: retreats a few pt (lids tighten)'),
        (frame([('creature', C(pos=(0.20, 0.47), rot=35, lag_offset=lagv(-0.12, 0.02)), 1.0)]), '3200-4800 ms', 'decides: slides in, rotating upright; arms pour in after'),
        (frame([('creature', C(pos=(0.36, 0.52), rot=0, gaze=(0.3, 0)), 1.0)]), '4800-6000 ms', 'upright, settles, glances at viewer'),
    ]
    return sheet('07', 'PEEK RETURN', '~6 s after absence', fr, os.path.join(OUT, 'sb07_peek_return.png'))


# ------------------------------------------------------------------ 08 wrong-edge return
def sb08():
    Q = dict(sprite='q34_left', flip=True, scale=0.46)
    fr = [
        (frame([('creature', C(**Q, pos=(1.02, 0.48), rot=20, lag_offset=lagv(-0.22, 0.03)), 1.0)]), 'exit', 'leaves through the RIGHT edge (06)'),
        (frame([]), '3-8 s', 'empty'),
        (frame([('creature', C(pos=(0.30, -0.075), rot=180, gaze=(0, 0.2)), 1.0)]), '0-1500 ms', 'returns from the TOP, far from where it left: upside down, head dipping in, eyes first'),
        (frame([('creature', C(pos=(0.30, -0.01), rot=180, lid=0.2, gaze=(0.4, 0.2)), 1.0)]), '1500-2600 ms', 'hangs, looking around (uncanny, calm)'),
        (frame([('creature', C(pos=(0.34, 0.20), rot=120, lag_offset=lagv(0.10, -0.12)), 1.0)]), '2600-3800 ms', 'drops in and rolls; arms follow through the top edge'),
        (frame([('creature', C(pos=(0.36, 0.45), rot=0), 1.0)]), '3800-5000 ms', 'rights itself, settles upper-left'),
    ]
    return sheet('08', 'WRONG-EDGE RETURN', '~5 s after absence', fr, os.path.join(OUT, 'sb08_wrong_edge_return.png'))


# ------------------------------------------------------------------ 09 touch reaction
def sb09():
    P = (0.50, 0.52)
    tap = (0.585, 0.37)
    fr = [
        (frame([('creature', C(pos=P), 1.0)], tap=tap), 'tap', 'finger touches the mantle (pink marker is annotation only)'),
        (frame([('creature', C(pos=P, dent=(0.68, 0.28, 1.1, 0.10), squash=(1.05, 0.94), lid=0.55), 1.0)]), '0-80 ms', 'local DENT at the touch point, lids snap half-shut, mantle squashes (fixed pivot)'),
        (frame([('creature', C(pos=(0.48, 0.535), squash=(1.02, 0.97), lid=0.35, lag_offset=lagv(0.0, -0.05)), 1.0)]), '80-300 ms', 'recoil AWAY from touch 2-3%; arm tips jerk inward (curl), lag ~100 ms'),
        (frame([('creature', C(pos=(0.48, 0.53), lid=0.0, gaze=(0.8, -0.2)), 1.0)]), '300-700 ms', 'eyes open wide and find the touch point (reaction delay 250-400 ms)'),
        (frame([('creature', C(pos=(0.48, 0.53), gaze=(0.8, -0.2), arm={'R1': dict(rot=-38, ext=0.0, lift=0.05)}), 1.0)]), '700-1600 ms', 'the nearest arm reaches to inspect the spot. PREVIZ LIMIT: curling onto its own mantle needs arm-curl art'),
        (frame([('creature', C(pos=P), 1.0)]), '1600-2400 ms', 'arm lowers; back to idle. No lasting grudge.'),
    ]
    return sheet('09', 'TOUCH REACTION', '~2.4 s, per tap', fr, os.path.join(OUT, 'sb09_touch_reaction.png'))


# ------------------------------------------------------------------ 10 glass moment
def sb10():
    fr = [
        (frame([('creature', C(pos=(0.50, 0.55), gaze=(0, 0)), 1.0)]), '0 ms', 'idle; stops, looks straight at viewer'),
        (frame([('creature', C(pos=(0.50, 0.62), scale=0.75), 1.0)]), '0-1500 ms', 'drifts TOWARD the glass: scale grows slowly (ease-in-out), arms leave the bottom of the frame'),
        (frame([('creature', C(pos=(0.50, 0.95), scale=1.35, breath=0.4), 1.0)]), '1500-3000 ms', 'face fills the window. Eyes huge. Almost no motion.'),
        (frame([('creature', C(pos=(0.52, 0.95), scale=1.35, rot=7, lid=0.40, breath=0.4), 1.0)]), '3000-5000 ms', 'EXAMINES you: slow head tilt, lids lower to the heavy half-lid'),
        (frame([('creature', C(pos=(0.52, 0.95), scale=1.35, rot=7, lid=0.40, gaze=(0.7, 0.2), breath=0.4), 1.0)]), '5000-5600 ms', 'eyes slide sideways, then back (as if reading your face)'),
        (frame([('creature', C(sprite='underside', scale=1.30, pos=(0.5, 0.52)), 1.0)]), 'variant', 'RARE finale: underside pressed flat to the glass, suckers splayed'),
        (frame([('creature', C(pos=(0.50, 0.55), scale=0.40), 1.0)]), '6-8 s', 'lets go, drifts back to normal size and distance'),
    ]
    return sheet('10', 'GLASS MOMENT', '6-8 s, rare (<=1 per day)', fr, os.path.join(OUT, 'sb10_glass_moment.png'))


if __name__ == '__main__':
    import sys
    fns = [sb01, sb02, sb03, sb04, sb05, sb06, sb07, sb08, sb09, sb10]
    sel = sys.argv[1:] or [f.__name__ for f in fns]
    for f in fns:
        if f.__name__ in sel:
            f()
            print('done', f.__name__)
