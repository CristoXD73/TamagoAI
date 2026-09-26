"""PROTOTYPE 05 / FIRST MOTION TEST — "Edge Inspection". Preview only."""
import math
from engine import Track

DUR = 11.0
REST = (0.44, 0.50)

# ---- choreography (times in seconds; normalized screen coords, 0,0 = top-left)
pos = Track([(0.0, REST, 'io'), (3.50, REST, 'hold'), (5.20, (0.635, 0.47), 'io'),
             (8.40, (0.635, 0.47), 'hold'), (10.30, REST, 'back'), (DUR, REST, 'io')])
rot = Track([(0.0, 0.0, 'io'), (2.45, 0.0, 'hold'), (3.00, 5.0, 'io'), (4.20, 8.0, 'io'),
             (5.20, 3.0, 'io'), (8.40, 3.0, 'hold'), (9.40, -2.0, 'io'), (10.40, 0.0, 'io')])
gaze = Track([(0.0, (0.0, 0.0), 'io'), (2.00, (0.0, 0.0), 'hold'), (2.12, (1.0, 0.05), 'out'),
              (5.20, (1.0, 0.05), 'hold'), (5.70, (1.0, -0.35), 'io'), (7.30, (1.0, -0.35), 'hold'),
              (7.55, (0.0, 0.0), 'out'), (DUR, (0.0, 0.0), 'hold')])
lid = Track([(0.0, 0.0, 'io'), (1.10, 0.0, 'hold'), (1.19, 0.72, 'in'), (1.25, 0.72, 'hold'), (1.37, 0.0, 'out'),
             (5.20, 0.0, 'hold'), (5.60, 0.30, 'io'), (7.30, 0.30, 'hold'), (7.55, 0.05, 'out'),
             (7.95, 0.05, 'hold'), (8.08, 0.72, 'in'), (8.16, 0.72, 'hold'), (8.32, 0.05, 'out'), (DUR, 0.0, 'io')])
arm_rot = Track([(0.0, 0.0, 'io'), (2.90, 0.0, 'hold'), (3.35, -30.0, 'out'), (3.47, -30.0, 'hold'),   # hesitation
                 (4.00, -55.0, 'io'), (4.60, -55.0, 'hold'), (5.20, -66.0, 'io'), (6.60, -76.0, 'io'), (8.20, -76.0, 'hold'),
                 (9.60, 0.0, 'io')])
arm_ext = Track([(0.0, 0.0, 'io'), (2.90, 0.0, 'hold'), (4.00, 0.12, 'out'), (4.60, 0.12, 'hold'),
                 (5.20, 0.29, 'io'), (8.20, 0.29, 'hold'), (9.60, 0.0, 'io')])
arm_lift = Track([(0.0, 0.0, 'io'), (2.90, 0.0, 'hold'), (4.00, 0.03, 'out'), (5.20, 0.03, 'hold'),
                  (6.60, 0.10, 'io'), (8.20, 0.10, 'hold'), (9.60, 0.0, 'io')])
breath = Track([(0.0, 1.0, 'io'), (6.60, 1.0, 'hold'), (6.80, 0.35, 'io'), (7.30, 0.35, 'hold'), (7.60, 1.0, 'io')])
energy = Track([(0.0, 1.0, 'io'), (2.00, 1.0, 'hold'), (2.30, 0.5, 'io'), (7.30, 0.5, 'hold'), (8.00, 1.0, 'io')])

# glass contact (sucker prints): appear on contact, fade after release
PRINT_ON, PRINT_OFF = 5.25, 8.25


def lag_for(t, scale):
    """Row lag: head leads slightly, arm tips trail the body path (seconds)."""
    def f(frac):
        L = -0.10 if frac < 0.22 else 0.42 * max(0.0, (frac - 0.30) / 0.70) ** 1.2
        p0, p1 = pos(t), pos(t - L)
        return ((p1[0] - p0[0]) * 1.0 / scale, (p1[1] - p0[1]) * (788 / 648) / scale)
    return f


SCALE = 0.40
CAPTIONS = [
    (0.0, 'idle: breathing, arms drift'), (1.1, 'blink'), (2.0, 'EYES notice the edge'),
    (2.12, 'pause (nothing else moves)'), (2.45, 'head follows eyes'), (2.9, 'ONE arm scouts first'),
    (3.35, 'arm hesitates'), (3.5, 'body follows, arms trail'), (5.2, 'tip meets the glass, flattens'),
    (5.6, 'feels along the edge'), (6.6, 'stillness (uncanny beat)'), (7.3, 'glances back at YOU'),
    (7.95, 'slow blink'), (8.2, 'arm retracts'), (8.4, 'drifts home, arms trail, settles'), (10.3, 'idle'),
]


def caption(t):
    c = CAPTIONS[0][1]
    for tt, txt in CAPTIONS:
        if t >= tt:
            c = txt
    return c


class Scene:
    dur = DUR
    tip_y2 = 0.527

    def layers(self, t):
        pose = dict(sprite='big_front', scale=SCALE, pos=pos(t), rot=rot(t), gaze=gaze(t), lid=lid(t),
                    breath=breath(t), arm_energy=energy(t), lag_offset=lag_for(t, SCALE),
                    arm={'R1': dict(rot=arm_rot(t), ext=arm_ext(t), lift=arm_lift(t))},
                    wall_right=0.995)
        out = [('creature', pose, 1.0)]
        out.append(('prints', [(0.972, 0.556, PRINT_ON, PRINT_OFF, 262), (0.972, Scene.tip_y2, 6.35, PRINT_OFF, 262)]))
        return out
