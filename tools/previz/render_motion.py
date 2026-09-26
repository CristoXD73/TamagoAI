import os, sys, time, importlib
import numpy as np, imageio.v2 as imageio
from engine import *
OUT = os.environ.get('PREVIZ_OUT', os.path.join(HERE, '_work', 'out'))
os.makedirs(OUT, exist_ok=True)
# usage: python3 render_motion.py <scene_module> <output_name>
mod = importlib.import_module(sys.argv[1]); name = sys.argv[2]
sc = mod.Scene(); dur = mod.DUR
t0 = time.time()
# MP4 @30fps, 2x, clean + annotated
w_clean = imageio.get_writer(os.path.join(OUT, f'{name}_2x_30fps.mp4'), fps=30, codec='libx264', quality=8, macro_block_size=8, pixelformat='yuv420p')
w_ann = imageio.get_writer(os.path.join(OUT, f'{name}_2x_30fps_annotated.mp4'), fps=30, codec='libx264', quality=8, macro_block_size=8, pixelformat='yuv420p')
n = int(dur * 30)
for i in range(n):
    t = i / 30
    scr = render_scene(sc, t)
    w_clean.append_data(np.asarray(frame_to_image(scr)))
    w_ann.append_data(np.asarray(frame_to_image(scr, f'{t:5.2f}s  {mod.caption(t)}')))
w_clean.close(); w_ann.close()
print('mp4 done', time.time() - t0)
for fps, tag in ((25, 'native_25fps'), (12, 'native_12fps_production_cap')):
    frames = [frame_to_image(render_scene(sc, i / fps), native=True) for i in range(int(dur * fps))]
    pal = [f.convert('P', palette=Image.ADAPTIVE, colors=128) for f in frames]
    pal[0].save(os.path.join(OUT, f'{name}_{tag}.gif'), save_all=True, append_images=pal[1:], duration=int(round(1000 / fps)), loop=0, optimize=True, disposal=1)
    print(tag, 'done', time.time() - t0)
