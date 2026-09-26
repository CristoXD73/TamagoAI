# TamagoAI media capture guide

Status: **UNVERIFIED** capture recipes, to be exercised after the character/UI
handoff. No final media is supplied. Existing evidence in `docs/screenshots/`
is historical, not final-octopus marketing art. Final deliverables and capture
records live in [media/README.md](media/README.md).

## Prepare a reproducible session

Use macOS, Xcode and its installed watchOS Simulator. `ffmpeg` is optional for
conversion; check `command -v ffmpeg` and `ffmpeg -version`. Install nothing as
part of this guide automatically. Built-in alternatives are Simulator
screenshots, macOS Screenshot (Shift-Command-5) and QuickTime Player trimming.
QuickTime can retain a short video when GIF conversion is unavailable.

Build and launch using [DEVELOPMENT.md](DEVELOPMENT.md). Coordinate capture with
the UI owner: do not interrupt their simulator run. Record commit and dirty-tree
state, Xcode/runtime/device model, art revision, exact actions, settings, clip
trim range and tools. Choose the same simulator and window size across clips.
Hide debug controls for presentation shots using existing app controls/builds;
do not edit production code to stage a scene. Do not claim planned behavior
from a pose preview. Exclude personal notifications, tokens and hostnames.

## Capture (commands from repository root)

Choose an explicit Watch UDID from `xcrun simctl list devices available`; avoid
`booted` when an iPhone and Watch are both booted. Set it in the same shell:

```sh
export TAMAGO_SIM_UDID='REPLACE_WITH_WATCH_SIMULATOR_UDID'
mkdir -p docs/media/raw docs/media/_work
export TAMAGO_CAPTURE_DIR="$(mktemp -d /tmp/tamago-capture.XXXXXX)"
xcrun simctl io "$TAMAGO_SIM_UDID" screenshot "$TAMAGO_CAPTURE_DIR/watch-simulator.png"
xcrun simctl io "$TAMAGO_SIM_UDID" recordVideo --codec=h264 "$TAMAGO_CAPTURE_DIR/idle.mov"
```

Record 4–8 seconds after launch has settled; press **Control-C** and wait for
recording finalization before copying. Local `/tmp` capture avoids the external
volume permission issue recorded in HANDOFF_LOG. Then:

```sh
cp "$TAMAGO_CAPTURE_DIR/watch-simulator.png" docs/media/_work/watch-simulator.png
cp "$TAMAGO_CAPTURE_DIR/idle.mov" docs/media/raw/idle.mov
```

Repeat as `wander.mov`, `peek.mov`, `touch.mov`. Capture actual movement, edge
entry/exit and visible tap/recovery. If a feature is unavailable, leave that
final filename absent and record the blocker. Do not synthesize a demonstration.
For touch input use Simulator's visible UI; describe the action in the caption
if the cursor/touch is not visible. A screen recording is not evidence of
physical haptics, wrist behavior, microphone quality or speaker quality.

If `simctl` recording is unavailable for the installed runtime, use
Shift-Command-5 → Record Selected Portion around the Simulator display, save
into `docs/media/raw/`, and crop out desktop chrome. Check local syntax with
`xcrun simctl help io`. Do not restart shared simulator services during another
agent's work.

## Optimize a short loop

These commands trim an idle clip to four seconds, remove audio, and create a
palette-based GIF. Reuse the recipe with the other action names. Inspect the
trim start/end and choose matching poses for a clean loop; don't conceal a bug
by splicing unrelated actions. Width 320 is a starting budget, not a mandate
to upscale a smaller original.

```sh
ffmpeg -n -ss 0.5 -t 4 -i docs/media/raw/idle.mov -an \
  -vf 'fps=12,scale=320:-1:flags=lanczos,palettegen=max_colors=128' \
  -frames:v 1 docs/media/_work/idle-palette.png
ffmpeg -n -ss 0.5 -t 4 -i docs/media/raw/idle.mov \
  -i docs/media/_work/idle-palette.png -an \
  -lavfi 'fps=12,scale=320:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3' \
  -loop 0 docs/media/_work/character-idle.gif
```

`-n` refuses overwrites; use new scratch names when iterating. Aim for **≤3 MiB
per GIF**, 3–6 seconds and 10–12 fps. Reduce duration, dimensions or palette
size if needed; assess gradients and eyes visually. Keep encoded playback
speed faithful to the recorded interaction. See the official
[FFmpeg palette filters](https://ffmpeg.org/ffmpeg-filters.html#palettegen).

For a sharper/smaller optional downloadable MP4 (link from Markdown rather than
assuming inline video support):

```sh
ffmpeg -n -ss 0.5 -t 4 -i docs/media/raw/idle.mov -an \
  -vf 'scale=320:-2:flags=lanczos' -c:v libx264 -crf 23 \
  -pix_fmt yuv420p -movflags +faststart -map_metadata -1 \
  docs/media/_work/character-idle.mp4
```

Inspect GIF/video at actual GitHub display size before copying approved output
from `_work/` into `docs/media/`. PNG screenshots should retain native pixels;
use Preview for intentional crops and `sips -g pixelWidth -g pixelHeight` to
check dimensions. Aim for ≤1 MiB per PNG and ≤2 MiB for the physical photo.
Review and remove identifying photo metadata before publishing. Preserve raw
originals outside Git, including the physical photo. Never ignore all PNG/GIF/
MP4 files: final optimized documentation exports must remain trackable.

## Publish and verify

- `hero.png`: compose from approved real art/capture; proposed 1600 × 900 canvas.
  Label composites as presentation art, not device screenshots.
- `architecture.png`: later export the Mermaid source in
  [TAMAGO_ARCHITECTURE.md](TAMAGO_ARCHITECTURE.md) using an available Mermaid
  renderer, or retain native Mermaid in the README. No new renderer install is
  required for this pass. Check text and arrows at README size.
- `physical-watch.jpg`: owner-provided real Watch photo only. Record the
  observed behavior in [DEVICE_TEST_LOG.md](DEVICE_TEST_LOG.md) before labeling
  it **DEVICE_VERIFIED**. A photo alone does not verify all features pictured.
- View each final image/loop in a browser, check corners/alpha/text, frame order,
  filesize and absence of debug/private material. Add descriptive alt text and
  a static screenshot link beside animations for readers avoiding motion.
- Record simulator observations as **SIMULATOR_VERIFIED_ONLY**, automated
  assertions as **UNIT_TESTED_ONLY**, and anything untested as **UNVERIFIED**.
  Run `git diff --check` and inspect `git status --short --untracked-files=all`;
  stage only reviewed final files and their capture record, never `git add .`.
