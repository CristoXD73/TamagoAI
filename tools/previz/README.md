# tools/previz — animation PREVIEW rig (not app code)

Makes storyboards, GIFs and MP4s for owner review under the
[Visual Approval Gate](../../docs/VISUAL_APPROVAL_GATE.md). It only **moves, masks and warps the approved
reference renders** (`Assets/CharacterReference/octopus-v001/`) inside a simulated Apple Watch SE 3 40 mm
display (324×394 device px, rendered 2× for review). It never draws new character art, and nothing here
ships in the app.

```sh
pip install pillow numpy opencv-python-headless imageio imageio-ffmpeg   # imageio-ffmpeg bundles ffmpeg
python3 extract_sprites.py                                  # → _work/sprites/ (19 views)
python3 storyboards.py [sb01 sb05 …]                        # → _work/out/sb*.png
python3 render_motion.py scene_edge_inspection 05_edge_inspection   # → _work/out/*.mp4 / *.gif
```

| File | Role |
|---|---|
| `engine.py` | Rig: breathing, lag-by-height follow-through, lid/gaze, touch dent, one separable arm (mesh warp), glass collision, display clipping |
| `scene_edge_inspection.py` | Keyframe tracks for prototype 05 (the first motion test). Edit numbers here, re-render. |
| `storyboards.py` | Static key poses for prototypes 01–10 |
| `render_motion.py` | Renders a scene module to MP4 (2×, 30 fps) and GIFs (1:1 at 25 fps and at the 12 fps production cap) |

Known limits (previz, not design): one separable arm only, painted lids, mirrored views flip the lighting,
turns cut between views. The art needed to remove these limits is listed in `docs/ANIMATION_PROTOTYPE_PLAN.md` §5.
Reviewed outputs are copied to `docs/prototypes/<batch>/`. `_work/` is git-ignored.
