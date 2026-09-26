"""Cut the approved reference renders into a working sprite library (PREVIZ ONLY).

Reads Assets/CharacterReference/octopus-v001/, writes tools/previz/_work/sprites/*.png.
Nothing here is production art; the sprites are the approved renders, cropped/keyed.
"""
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', '..', 'Assets', 'CharacterReference', 'octopus-v001')
OUT = os.path.join(HERE, '_work', 'sprites')
os.makedirs(OUT, exist_ok=True)

# 14-view turnaround has a real alpha channel: split by connected components
im = cv2.imread(os.path.join(REF, 'ref_turnaround_14view_alpha.webp'), cv2.IMREAD_UNCHANGED)
m = cv2.dilate((im[:, :, 3] > 20).astype(np.uint8), np.ones((9, 9), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
comps = sorted([(i, s) for i, s in enumerate(stats) if i > 0 and s[4] > 5000], key=lambda t: (t[1][1] > 330, t[1][0]))
names = ['front', 'q34_left', 'profile_left_a', 'profile_left_b', 'back34_right_a', 'back34_right_b', 'back_a', 'back_b',
         'high_front', 'high_q34_left', 'underside', 'low_q34_right', 'crawl_q34_right', 'crawl_side_right']
assert len(comps) == len(names), f'expected 14 views, found {len(comps)}'
for (i, s), nm in zip(comps, names):
    x, y, w, h, _ = s
    x0, y0 = max(0, x - 6), max(0, y - 6)
    x1, y1 = min(im.shape[1], x + w + 6), min(im.shape[0], y + h + 6)
    crop = im[y0:y1, x0:x1].copy()
    crop[:, :, 3] = np.where(lab[y0:y1, x0:x1] == i, crop[:, :, 3], 0)
    cv2.imwrite(os.path.join(OUT, f'{nm}.png'), crop)


def key_black(bgr):
    """Background = near-black region connected to the border (keeps dark eyes)."""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    n, lab = cv2.connectedComponents((g < 18).astype(np.uint8))
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = (~np.isin(lab, list(border))).astype(np.uint8) * 255
    edge = cv2.dilate(fg, np.ones((3, 3), np.uint8)) - cv2.erode(fg, np.ones((3, 3), np.uint8))
    lum = np.clip(g.astype(np.float32) / 140, 0, 1) * 255
    alpha = np.where(edge > 0, np.minimum(fg.astype(np.float32), lum), fg.astype(np.float32))
    return np.dstack([bgr, cv2.GaussianBlur(alpha, (3, 3), 0).astype(np.uint8)])


cv2.imwrite(os.path.join(OUT, 'hero_q34_left.png'), key_black(cv2.imread(os.path.join(REF, 'ref_hero_q34.jpg'))))
im2 = cv2.imread(os.path.join(REF, 'ref_turnaround_4view.webp'))
col = (cv2.cvtColor(im2, cv2.COLOR_BGR2GRAY) > 25).sum(0)
xs = np.where(col > 0)[0]
gaps = np.where(np.diff(xs) > 15)[0]
bounds = [xs[0]] + [v for k in gaps for v in (xs[k], xs[k + 1])] + [xs[-1]]
for j, nm in enumerate(['big_front', 'big_q34_left', 'big_profile_left', 'big_back']):
    cv2.imwrite(os.path.join(OUT, f'{nm}.png'), key_black(im2[:, max(0, bounds[2 * j] - 6):bounds[2 * j + 1] + 6]))
print('sprites ->', OUT, sorted(os.listdir(OUT)))
