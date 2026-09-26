# TamagoAI character asset pipeline

Status: **UNVERIFIED** production proposal; no final art or renderer integration
is delivered here. Follow [D-102–D-104](DECISIONS.md) and coordinate integration
with the character/UI owner after their behavior work finishes.

## Art contract

An original white, soft-bodied octopus AI companion, with octopus-like/alien
eyes and eight tentacles. Preserve anatomy across frames; tentacles may overlap
but must not appear/disappear accidentally. Use soft shading and readable eye
silhouettes, not borrowed WatchPet/Codex artwork. Record creator, rights and
revision alongside source files; see [upstream rules](UPSTREAM_REUSE.md).

- Author on a **1024 × 1024 px** transparent square master canvas. Proposed
  runtime baseline: **384 × 384 px @2x**, representing a 192 × 192 point canvas.
  This is an art export target, not a required view size: fit the whole canvas
  to the available Watch layout and inspect the smallest supported screen.
- Apple lists watchOS images at **@2x**. Export **576 × 576 @3x** only if a
  future iPhone use needs the same 192-point art. Do not bundle unused @3x
  masters in the Watch target. A 192 × 192 @1x export is optional for other
  consumers; never put a 384 px image in a 1x well by mistake.
  See [Apple image guidance](https://developer.apple.com/design/human-interface-guidelines/images).
- Export 8-bit RGBA PNG in sRGB with a real alpha channel. No opaque matte,
  baked checkerboard, background, UI, lettering or device bezel. Keep soft
  antialiased edges and inspect on black, white and mid-gray for halos.
- Use normalized canvas coordinates: origin at top-left, x right, y down.
  Register the body pivot at **(0.5, 0.5)** in every frame: (512, 512) in the
  master, (192, 192) at @2x. Record any intentional pivot exception explicitly.
- Default full silhouette including tentacles/shadow stays inside **10–90%**
  of both canvas axes; eye features inside **30–70%**. Extreme stretch may use
  **5–95%**, leaving transparent padding. These are proposed art bounds, not
  watchOS safe-area guarantees. Keep the full octopus in peek exports; the
  future renderer positions and clips it at the screen edge.
- Never auto-trim or independently auto-center frames. Preserve canvas,
  body scale, eye baseline and pivot across all poses and export scales.
  Overlay adjacent frames at 50% opacity to catch accidental jumps. Deliberate
  squash changes silhouette around the same pivot; locomotion translation
  belongs to the behavior renderer, not to drifting image origins.

## Proposed pose inventory

Frame counts are initial art budgets, not new state-machine cases or protocol
values. Hold durations belong in the future art table, not duplicated PNGs.
Start with one approved neutral pose before commissioning full sequences.

| Pose key | Initial unique frames | Intent / playback proposal |
|---|---:|---|
| idle-neutral | 1 | Calm open eyes; fallback/static pose |
| idle-blink | 3 | Open, half, closed; reverse to reopen |
| idle-look-left | 2 | Eyes shift left, body pivot fixed |
| idle-look-right | 2 | Eyes shift right, body pivot fixed |
| idle-breathe | 4 | Small soft expansion/contraction loop |
| curious | 3 | Alert eyes and slight head tilt; hold |
| happy | 4 | Bright eyes and gentle tentacle lift; one-shot |
| concerned | 3 | Subtle contracted pose; hold |
| thinking | 4 | Small eye/tentacle motion; loop |
| listening | 3 | Attentive open posture; quiet loop |
| speaking | 4 | Expressive eye/body rhythm; no forced human mouth |
| touch-react | 3 | Local recoil then recovery; one-shot |
| squish | 4 | Compress, overshoot, recover; fixed pivot |
| swim-left | 4 | Left-facing propulsion cycle; no baked translation |
| swim-right | 4 | Right-facing propulsion cycle; no baked translation |
| tentacles-down | 2 | Relaxed hanging silhouette; hold |
| peek-left | 2 | Look inward from left edge; complete canvas |
| peek-right | 2 | Look inward from right edge; complete canvas |
| peek-top | 2 | Look down from upper edge; complete canvas |
| peek-bottom | 2 | Look up from lower edge; complete canvas |
| sleep | 2 | Closed eyes; designate one static frame |

Target at most 12 displayed frames/second (D-102); use 100 ms or longer initial
frame durations and longer holds for quiet poses. Choose a low-power frame for
every sequence; `sleep` maps conceptually to existing `sleeping`, not to wrist
lowering. Curious/look/breathe are art variants, not wire states. Existing
`acknowledging`, `success`, `confused`, `error`, `toolRunning`, and `disconnected`
need explicit approved reuse mappings before replacing the current art.

## Files and import

1. Put editable originals and a provenance note in `Assets/CharacterSource/`.
   Use `octopus-v001/` revision folders; keep temporary renders in `_work/`.
2. Export approved PNGs to `Assets/CharacterProcessed/octopus-v001/` with names
   `tamago_octopus_<pose-key>_f000@2x.png` (zero-based, three-digit frame index).
   Example: `tamago_octopus_idle-neutral_f000@2x.png`. Never encode frame timing
   or current UI state in filenames. Keep an accompanying manifest listing
   revision, dimensions, scale, pivot, bounds, ordered frames, duration in ms,
   loop/one-shot policy, low-power frame and provenance.
3. After behavior work is handed off, use Xcode to create/reuse
   `Apple/WatchApp/Assets.xcassets` in the existing Watch app source folder.
   Create one Image Set per frame named `tamago_octopus_<pose-key>_f000`.
   Assign PNGs to the correct 2x wells (Watch device scope where available),
   use Original Image rendering, and retain Xcode's `Contents.json`. Verify
   existing Watch target membership; do not change targets or signing.
4. Import only selected runtime exports, not masters, references or GIFs.
   Keep image-set names globally unique; do not enable an unexpected folder
   namespace. Review the catalog diff for missing/duplicate scale entries.
5. Later, let the Watch-local `CharacterArt` table map canonical state plus
   an approved behavior pose to the frame name and timing. SwiftUI can load
   `Image("tamago_octopus_idle-neutral_f000")` from the app bundle; omit `.png`
   and `@2x`. Preserve `SpriteAnimationClock`, lifecycle pause/static behavior
   and the canonical state machine. This pass changes none of those files.

## Compression, memory and acceptance

Keep masters lossless. First optimize PNGs losslessly without stripping alpha
or misinterpreting the color profile. Optional quantization requires visual
approval on eye details, white gradients and transparent edges. Record tool
version/settings; retain the approved unoptimized source. Xcode processes the
catalog at build time; assess the built app rather than only source file size.

Decoded RGBA is roughly width × height × 4 bytes: 384² is **0.5625 MiB/frame**;
64 simultaneously decoded frames alone would be **36 MiB**, before texture,
cache and app overhead. PNG compression reduces disk bytes, not this estimate.
Do not preload all proposed poses or ship 1024 px masters. Reuse held frames,
start with small sequences, and measure peak memory in Instruments during
repeated transitions on the actual Watch. No fixed safe memory budget is claimed.

Before acceptance, check alpha, eight-tentacle continuity, fixed pivot, matching
scale, no clipping at screen corners, stable loop seams, smallest Watch layout,
and static low-power poses. Record simulator observations as
**SIMULATOR_VERIFIED_ONLY**; memory, heat, battery and physical appearance remain
**UNVERIFIED** until owner evidence is recorded in [DEVICE_TEST_LOG](DEVICE_TEST_LOG.md).
