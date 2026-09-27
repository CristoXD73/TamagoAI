# Derives the widget cutout from the approved hero art (unchanged pixels, background removed).
# Background = near-black regions connected to the border, plus enclosed pure-black pockets
# between tentacles (mean < 10, area >= 200 px). The eyes (mean ~20) and sucker crevices stay opaque.
import sys
from collections import deque
import numpy as np
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
m = a.max(axis=2); H, W = m.shape; T = 48.0
dark = m < T; lab = np.zeros((H, W), np.int32); bg = np.zeros((H, W), bool); n = 0
for y in range(H):
    for x in range(W):
        if dark[y, x] and not lab[y, x]:
            n += 1; q = deque([(y, x)]); lab[y, x] = n; pts = []; edge = False
            while q:
                cy, cx = q.popleft(); pts.append((cy, cx))
                edge |= cy in (0, H - 1) or cx in (0, W - 1)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and dark[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n; q.append((ny, nx))
            p = np.array(pts); v = m[p[:, 0], p[:, 1]]
            if edge or (len(pts) >= 200 and v.mean() < 10):
                bg[p[:, 0], p[:, 1]] = True
t = np.clip((m - 6.0) / (T - 6.0), 0, 1)
alpha = np.where(bg, t * t * (3 - 2 * t), 1.0)
img = Image.fromarray(np.dstack([a, alpha * 255]).clip(0, 255).astype(np.uint8), 'RGBA')
ys, xs = np.where(alpha > 0.02); pad = 8
img = img.crop((max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad + 1, W), min(ys.max() + pad + 1, H)))
img.save(out, optimize=True)
print(out, img.size)
