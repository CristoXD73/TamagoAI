"""TamagoAI PREVIZ rig. Preview-only; not production code.

Moves/warps the approved reference renders (never draws new character art)
inside a simulated Apple Watch SE 3 40 mm display: 324x394 device px
(162x197 pt). Rendered at 2x device px (648x788) for review; "native" exports are 1:1 device px.
"""
import math
import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SPR = os.path.join(HERE, '_work', 'sprites')   # created by extract_sprites.py (git-ignored)
SW, SH = 648, 788          # SE 3 40 mm display (324x394 device px) x2 for review
BEZEL = 20                 # preview-only dark margin so edges are visible
CORNER = 76                # approx display corner radius @2x (preview only)

# outer right arm of big_front, traced on the approved render (normalized)
R1_POLY = [(0.63, 0.385), (0.72, 0.395), (0.84, 0.44), (0.93, 0.49), (1.0, 0.55), (1.0, 0.66), (0.995, 0.745),
           (0.96, 0.785), (0.9, 0.795), (0.855, 0.765), (0.835, 0.69), (0.77, 0.6), (0.7, 0.535), (0.61, 0.47)]

# per-sprite rig metadata (normalized to sprite bbox; measured on grids)
META = {
    'front':      dict(mantle=0.36, eyes=[(0.308, 0.242, 0.068), (0.717, 0.234, 0.068)], pivot=(0.5, 0.40)),
    'big_front':  dict(mantle=0.40, eyes=[(0.304, 0.257, 0.066), (0.754, 0.254, 0.066)], pivot=(0.5, 0.42),
                       arms={'R1': dict(poly=R1_POLY, root=(0.66, 0.43), tip=(0.95, 0.77))}),
    'hero_q34_left': dict(mantle=0.40, eyes=[(0.544, 0.261, 0.065)], pivot=(0.5, 0.42)),
    'q34_left':   dict(mantle=0.38, eyes=[], pivot=(0.5, 0.42)),
    'profile_left_a': dict(mantle=0.38, eyes=[], pivot=(0.5, 0.42)),
    'underside':  dict(mantle=0.0, eyes=[], pivot=(0.5, 0.5)),
    'crawl_side_right': dict(mantle=0.5, eyes=[], pivot=(0.5, 0.5)),
    'high_front': dict(mantle=0.4, eyes=[], pivot=(0.5, 0.45)),
}

_cache = {}
LAST_TIP = None


def load(name):
    if name not in _cache:
        im = cv2.imread(f'{SPR}/{name}.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 255.0
        a = im[:, :, 3:4]
        im[:, :, :3] *= a                       # premultiply
        _cache[name] = im
    return _cache[name]


# ---------------------------------------------------------------- easing / tracks
def ease(kind, x):
    x = min(max(x, 0.0), 1.0)
    if kind == 'lin':
        return x
    if kind == 'in':
        return x * x * x
    if kind == 'out':
        return 1 - (1 - x) ** 3
    if kind == 'hold':
        return 0.0
    if kind == 'back':          # out with slight overshoot (settle)
        c = 1.4
        return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
    return 3 * x * x - 2 * x * x * x if kind == 'io2' else (4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2)  # 'io' cubic


class Track:
    """Keys: [(time_s, value, ease_into_this_key)]. Values: float or tuple."""

    def __init__(self, keys):
        self.k = sorted(keys, key=lambda k: k[0])

    def __call__(self, t):
        k = self.k
        if t <= k[0][0]:
            return k[0][1]
        for (t0, v0, _), (t1, v1, e) in zip(k, k[1:]):
            if t <= t1:
                f = ease(e, (t - t0) / max(t1 - t0, 1e-6))
                if isinstance(v0, tuple):
                    return tuple(a + (b - a) * f for a, b in zip(v0, v1))
                return v0 + (v1 - v0) * f
        return k[-1][1]


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- creature render
PX, PY = 0.75, 0.45        # canvas padding (sprite-width units)


def field(X, Y, p, t, meta, asp):
    dX = np.zeros_like(X)
    dY = np.zeros_like(Y)
    mb = meta['mantle'] * asp
    arm_w = smooth(mb * 0.85, asp * 1.0, Y) if meta['mantle'] > 0 else np.ones_like(Y) * 0.6
    mantle_w = 1 - smooth(mb * 0.6, mb * 1.05, Y)

    # 1. breathing: mantle swells, arms carry a slow downward-travelling wave
    br = p.get('breath', 1.0)
    if br:
        ph = 2 * math.pi * t / p.get('breath_period', 4.4)
        sy = 0.022 * br * math.sin(ph)
        cy = mb
        dY += mantle_w * (Y - cy) * sy
        dX += mantle_w * (X - 0.5) * (-0.35 * sy)
        A = 0.010 * br * p.get('arm_energy', 1.0)
        w = arm_w ** 1.4
        dX += A * w * np.sin(2 * math.pi * (t * 0.23 - (Y - mb) * 0.9) + 2.6 * X)
        dX += 0.6 * A * w * np.sin(2 * math.pi * (t * 0.37 - (Y - mb) * 1.4) + 5.3 * X + 1.7)
        dY += 0.4 * A * w * np.sin(2 * math.pi * (t * 0.29 - (Y - mb) * 1.1) + 4.1 * X + 0.6)

    # 2. follow-through lag: rows deeper in the arms trail the body path
    lag = p.get('lag_offset')                  # callable(frac)->(dx,dy) in sprite units
    if lag is not None:
        frac = np.clip(Y / asp, 0, 1)
        # evaluate on 24 rows and interpolate for speed
        rows = np.linspace(0, 1, 24)
        vals = np.array([lag(r) for r in rows])
        dX += np.interp(frac, rows, vals[:, 0]).astype(np.float32)
        dY += np.interp(frac, rows, vals[:, 1]).astype(np.float32)

    # 3. single-arm reach(es): displacement grows root->tip, falls off laterally
    for (R, T, D, sig) in p.get('reach', []):
        if abs(D[0]) + abs(D[1]) < 1e-5:
            continue
        rx, ry = R[0], R[1] * asp
        tx, ty = T[0], T[1] * asp
        vx, vy = tx - rx, ty - ry
        L2 = vx * vx + vy * vy
        sp = np.clip(((X - rx) * vx + (Y - ry) * vy) / L2, 0, 1.25)
        px_, py_ = rx + np.clip(sp, 0, 1) * vx, ry + np.clip(sp, 0, 1) * vy
        dist2 = (X - px_) ** 2 + (Y - py_) ** 2
        wgt = smooth(0.0, 1.0, sp) ** 1.3 * np.exp(-dist2 / (sig * sig))
        dX += wgt * D[0]
        dY += wgt * D[1]

    # 4. touch dent: local compression away from contact point
    dent = p.get('dent')
    if dent:
        cx, cy, k, sig = dent
        cy *= asp
        rx, ry = X - cx, Y - cy
        g = np.exp(-(rx * rx + ry * ry) / (sig * sig))
        dX += -k * g * rx
        dY += -k * g * ry

    # 5. global squash around pivot
    sq = p.get('squash', (1.0, 1.0))
    pv = meta['pivot']
    if sq != (1.0, 1.0):
        dX += (X - pv[0]) * (sq[0] - 1)
        dY += (Y - pv[1] * asp) * (sq[1] - 1)

    # 6. eyes: gaze (content shift inside socket) + lid (skin slides down)
    gaze = p.get('gaze', (0.0, 0.0))
    for (ex, ey, er) in meta['eyes']:
        ey *= asp
        rx, ry = X - ex, Y - ey
        d2 = (rx * rx + ry * ry) / (er * er * 1.35 * 1.35)
        m = np.clip(1 - d2, 0, 1) ** 2
        dX += m * gaze[0] * er * 0.42
        dY += m * gaze[1] * er * 0.30
    return dX, dY




def render_creature(p, t):
    """p: dict of pose params at time t. Returns (premult RGBA canvas, affine to screen)."""
    name = p['sprite']
    src = load(name)
    hs, ws = src.shape[:2]
    asp = hs / ws
    meta = META.get(name, dict(mantle=0.38, eyes=[], pivot=(0.5, 0.42)))
    s = p['scale'] * SW                       # on-screen sprite width in px
    cw, ch = int(s * (1 + 2 * PX)), int(s * (asp + 2 * PY))
    xs = (np.arange(cw, dtype=np.float32) + 0.5) / s - PX
    ys = (np.arange(ch, dtype=np.float32) + 0.5) / s - PY
    X0, Y0 = np.meshgrid(xs, ys)
    pv = meta['pivot']
    base = lidded(name, p.get('lid', 0.0))
    layers = [(base, None)]
    for arm_id, spec in meta.get('arms', {}).items():
        ap = p.get('arm', {}).get(arm_id)
        if not ap:
            continue
        base_cut, arm_src = arm_layers(name, arm_id, base)
        layers = [(base_cut, None), (arm_src, (spec, ap))]
    # affine: canvas -> screen
    ax, ay = (pv[0] + PX) * s, (pv[1] * asp + PY) * s
    th = math.radians(p.get('rot', 0.0))
    fl = -1.0 if p.get('flip') else 1.0
    c_, s_ = math.cos(th), math.sin(th)
    Px, Py = p['pos'][0] * SW, p['pos'][1] * SH
    M = np.array([[fl * c_, -s_, 0], [fl * s_, c_, 0]], dtype=np.float32)
    M[:, 2] = [Px - (M[0, 0] * ax + M[0, 1] * ay), Py - (M[1, 0] * ax + M[1, 1] * ay)]
    canvas = np.zeros((ch, cw, 4), np.float32)
    for lsrc, armspec in layers:
        if armspec:
            lay = mesh_warp_arm(lsrc, armspec, p, t, meta, asp, s, cw, ch, ws, M)
        else:
            X, Y = X0.copy(), Y0.copy()
            for _it in range(5):               # solve src + d(src) = dest
                dX, dY = field(X, Y, p, t, meta, asp)
                X, Y = X0 - dX, Y0 - dY
            lay = cv2.remap(lsrc, (X * ws).astype(np.float32), (Y * ws).astype(np.float32),
                            cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        canvas = lay + canvas * (1 - lay[:, :, 3:4])

    return canvas, M


def composite(screen, canvas, M, alpha=1.0):
    layer = cv2.warpAffine(canvas, M, (SW, SH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a = layer[:, :, 3:4] * alpha
    screen[:] = layer[:, :, :3] * alpha + screen * (1 - a)


def glass_prints(screen, prints, t):
    """Faint, soft sucker marks on the 'glass' (preview approximation, not art)."""
    for (x, y, t_on, t_off, rot) in prints:
        if t < t_on:
            continue
        o = 1.0 if t < t_off else max(0.0, 1 - (t - t_off) / 1.2)
        o = min(o, (t - t_on) / 0.3)
        if o <= 0:
            continue
        lay = np.zeros(screen.shape[:2], np.float32)
        ang = math.radians(rot)
        for k in range(4):
            dx, dy = math.cos(ang) * k * 11, math.sin(ang) * k * 11
            r = 5.5 - k * 0.9
            cv2.ellipse(lay, (int(x * SW + dx), int(y * SH + dy)), (int(r * 0.8), int(r)), 0, 0, 360, 1.0, -1, cv2.LINE_AA)
        lay = cv2.GaussianBlur(lay, (0, 0), 1.6)
        a_ = (0.13 * o * lay)[:, :, None]
        screen[:] = screen * (1 - a_) + np.array([0.92, 0.92, 0.9], np.float32) * a_


def frame_to_image(screen, caption=None, native=False):
    img = np.clip(screen * 255, 0, 255).astype(np.uint8)
    im = Image.fromarray(img[:, :, ::-1])
    # display mask (rounded corners) + preview bezel
    mask = Image.new('L', (SW, SH), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SW - 1, SH - 1], CORNER, fill=255)
    out = Image.new('RGB', (SW + 2 * BEZEL, SH + 2 * BEZEL), (38, 38, 42))
    blk = Image.new('RGB', (SW, SH), (0, 0, 0))
    blk.paste(im, (0, 0), mask)
    out.paste(blk, (BEZEL, BEZEL), mask)
    if caption:
        d = ImageDraw.Draw(out)
        f = ImageFont.load_default(size=18)
        d.text((BEZEL + 4, 2), caption, fill=(150, 150, 160), font=f)
    if native:
        out = out.resize((out.width // 2, out.height // 2), Image.LANCZOS)
    return out


def render_scene(scene, t):
    screen = np.zeros((SH, SW, 3), np.float32)
    for layer in scene.layers(t):
        kind = layer[0]
        if kind == 'creature':
            _, pose, alpha = layer
            cv, M = render_creature(pose, t)
            composite(screen, cv, M, alpha)
        elif kind == 'prints':
            glass_prints(screen, layer[1], t)
    return screen


_lid_cache = {}


def lidded(name, lid):
    """Source sprite with upper lids lowered by `lid` (0 open .. 1 closed).
    Paints skin only INSIDE each eye ellipse (never touches the silhouette)."""
    q = round(min(max(lid, 0.0), 1.0) * 20) / 20
    key = (name, q)
    if key in _lid_cache:
        return _lid_cache[key]
    src = load(name)
    if q == 0 or not META.get(name, {}).get('eyes'):
        _lid_cache[key] = src
        return src
    out = src.copy()
    hs, ws = src.shape[:2]
    yy, xx = np.mgrid[0:hs, 0:ws].astype(np.float32)
    for (ex, ey, er) in META[name]['eyes']:
        cx, cy, r = ex * ws, ey * hs, er * ws
        d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        ann = (d > r * 1.35) & (d < r * 1.8) & (yy < cy) & (src[:, :, 3] > 0.95)
        skin = np.median(src[ann][:, :3], axis=0) if ann.any() else np.array([0.9, 0.9, 0.9])
        ell = np.clip((r * 1.0 - d) / 1.6, 0, 1)            # soft eye mask
        top = cy - r * 1.0
        yl = top + q * 2 * r * 1.0                              # lid edge
        above = np.clip((yl - yy) / 1.4, 0, 1)
        m = ell * above
        shade = 1 - 0.18 * np.clip(1 - (yl - yy) / (r * 0.9), 0, 1)   # darker toward lid edge
        col = skin[None, None, :] * shade[:, :, None]
        crease = ell * np.exp(-((yy - yl) ** 2) / (2 * 1.1 ** 2)) * 0.55 * (q < 0.98)
        out[:, :, :3] = out[:, :, :3] * (1 - m[:, :, None]) + col * m[:, :, None]
        out[:, :, :3] *= (1 - crease[:, :, None] * 0.6)
    _lid_cache[key] = out
    return out


_arm_cache = {}


def _arm_param(X, Y, spec, asp):
    rx, ry = spec['root'][0], spec['root'][1] * asp
    tx, ty = spec['tip'][0], spec['tip'][1] * asp
    vx, vy = tx - rx, ty - ry
    L2 = vx * vx + vy * vy
    return np.clip(((X - rx) * vx + (Y - ry) * vy) / L2, 0, 1.3), (rx, ry), (vx, vy)


def arm_layers(name, arm_id, base):
    key = (name, arm_id, id(base))
    if key in _arm_cache:
        return _arm_cache[key]
    hs, ws = base.shape[:2]
    spec = META[name]['arms'][arm_id]
    poly = np.array(spec['poly'])
    m = np.zeros((hs, ws), np.uint8)
    cv2.fillPoly(m, [(poly * [ws, hs]).astype(np.int32)], 255)
    m = cv2.GaussianBlur(m.astype(np.float32) / 255, (5, 5), 0)
    yy, xx = np.mgrid[0:hs, 0:ws].astype(np.float32)
    s, _, _ = _arm_param(xx / ws, yy / ws, spec, hs / ws)
    free = smooth(0.08, 0.22, s)                     # root stays attached to body
    arm = base * (m * free)[:, :, None]
    cut = base * (1 - m * free)[:, :, None]
    _arm_cache[key] = (cut, arm)
    return cut, arm


def arm_field(X, Y, spec, ap, asp):
    """Bend (rotate about root, growing along arm) + extend along the arm axis."""
    s, (rx, ry), (vx, vy) = _arm_param(X, Y, spec, asp)
    w = smooth(0.05, 1.0, s)
    wr = smooth(0.06, 0.45, s)                      # short bend zone, then mostly rigid
    ang = math.radians(ap.get('rot', 0.0)) * wr
    ca, sa = np.cos(ang), np.sin(ang)
    qx, qy = X - rx, Y - ry
    ext = ap.get('ext', 0.0) * w ** 1.2
    L = math.hypot(vx, vy)
    ux, uy = vx / L, vy / L
    nx = rx + ca * qx - sa * qy + ext * ux
    ny = ry + sa * qx + ca * qy + ext * uy
    # lift: extra perpendicular raise near the tip
    lift = ap.get('lift', 0.0) * w ** 2
    nx += lift * uy
    ny += -lift * ux
    return nx - X, ny - Y


def mesh_warp_arm(lsrc, armspec, p, t, meta, asp, s, cw, ch, ws, M=None):
    """Forward triangle-mesh warp of the arm layer (robust for large bends)."""
    spec, ap = armspec
    a = lsrc[:, :, 3]
    ys_, xs_ = np.where(a > 0.003)
    if len(xs_) == 0:
        return np.zeros((ch, cw, 4), np.float32)
    x0, x1, y0, y1 = xs_.min(), xs_.max() + 1, ys_.min(), ys_.max() + 1
    N = 22
    gx = np.linspace(x0, x1, N)
    gy = np.linspace(y0, y1, N)
    GX, GY = np.meshgrid(gx, gy)
    U, V = GX / ws, GY / ws                              # sprite-width units
    aX, aY = arm_field(U, V, spec, ap, asp)
    U2, V2 = U + aX, V + aY
    gX, gY = field(U2, V2, p, t, meta, asp)             # approx: global field at moved point
    DX = (U2 + gX + PX) * s
    DY = (V2 + gY + PY) * s
    wall = p.get('wall_right')
    if wall is not None and M is not None:          # glass: tip flattens against display edge
        Sx = M[0, 0] * DX + M[0, 1] * DY + M[0, 2]
        Sy = M[1, 0] * DX + M[1, 1] * DY + M[1, 2]
        W = wall * SW
        m_ = 9.0
        over = Sx > W - m_
        Sx = np.where(over, W - m_ * np.exp(-(Sx - (W - m_)) / m_), Sx)
        Minv = cv2.invertAffineTransform(M)
        DX = Minv[0, 0] * Sx + Minv[0, 1] * Sy + Minv[0, 2]
        DY = Minv[1, 0] * Sx + Minv[1, 1] * Sy + Minv[1, 2]
        global LAST_TIP
        LAST_TIP = (float(Sx[-1].max()) / SW, float(Sy[over].mean() / SH) if over.any() else None)
    out = np.zeros((ch, cw, 4), np.float32)
    for i in range(N - 1):
        for j in range(N - 1):
            for tri in (((i, j), (i, j + 1), (i + 1, j)), ((i + 1, j), (i, j + 1), (i + 1, j + 1))):
                sp = np.float32([[GX[q], GY[q]] for q in tri])
                sub_a = a[int(sp[:, 1].min()):int(sp[:, 1].max()) + 2, int(sp[:, 0].min()):int(sp[:, 0].max()) + 2]
                if sub_a.size == 0 or sub_a.max() < 0.003:
                    continue
                dp = np.float32([[DX[q], DY[q]] for q in tri])
                bx, by = int(np.floor(dp[:, 0].min())) - 1, int(np.floor(dp[:, 1].min())) - 1
                bw, bh = int(np.ceil(dp[:, 0].max())) - bx + 2, int(np.ceil(dp[:, 1].max())) - by + 2
                if bw <= 0 or bh <= 0 or bx >= cw or by >= ch or bx + bw <= 0 or by + bh <= 0:
                    continue
                Mt = cv2.getAffineTransform(sp, dp - np.float32([bx, by]))
                patch = cv2.warpAffine(lsrc, Mt, (bw, bh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
                msk = np.zeros((bh, bw), np.float32)
                cv2.fillConvexPoly(msk, np.round((dp - [bx, by]) * 4).astype(np.int32), 1.0, cv2.LINE_AA, shift=2)
                cx0, cy0 = max(bx, 0), max(by, 0)
                cx1, cy1 = min(bx + bw, cw), min(by + bh, ch)
                pa = patch[cy0 - by:cy1 - by, cx0 - bx:cx1 - bx]
                mk = msk[cy0 - by:cy1 - by, cx0 - bx:cx1 - bx, None]
                region = out[cy0:cy1, cx0:cx1]
                region[:] = np.maximum(region, pa * mk)
    return out
