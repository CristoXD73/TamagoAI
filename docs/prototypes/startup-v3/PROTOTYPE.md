# Startup sequence v3: v2 with the owner's notes (awaiting the owner)

Owner, 2026-09-29, on v2: "you tracked the eyes but you didn't resize them, so the silhouette isn't the same. Resize
them all so they conform to the size of the main hero octopus. Remove the little camera corner lines. The star
background is very uninspired, come up with something cool but still mainly black."
Status: PROTOTYPE_READY_FOR_REVIEW (VISUAL_APPROVAL_GATE #19). The app still has v1 (build 9). Nothing is shipped.

Files: `startup-v3.mp4` (9.2 s, 1080 × 1920, 60 fps, stereo), `startup-v3-app.mp4` (app cut, 6.3 s, ends on the hero),
`keyframes-v3.png`.

| Note | What changed |
|---|---|
| Resize them to the hero | `tools/brand/startup_fit.py` warps every aligned universe layer: vertically between three anchors (head top, eye line, arm tips) so head height and arm length match the hero's, and horizontally row by row either side of the eye midline so the width matches at every height. The eye line and midline are fixed, so the eyes stay pinned. Output: `Assets/Brand/universes/fitted/` (+ `onion-check.png`, all eight stacked on the hero). The sprout's stem and leaf ride on the head top. |
| Remove the corner brackets | Gone, in every beat. |
| Better background | The **Wormhole** replaces the dust: thin tapered light streaks rushing out of the eyes (the octopus travelling through the universes), tinted by whichever universe holds the frame, over a very faint drifting nebula. Idles slowly, accelerates through the fight, red-white and long in the overload, absent in the black, bursts outward when the hero lands, then settles into a slow drift. Still mostly black. |

Everything else (the fight, shake, sparks, overload, black, reveal, sound) is unchanged from v2. Made by
`tools/brand/startup_sequence_v3.py FITTED_DIR IDLE_FRAMES_DIR OUT_DIR [--app]`; the idle frames are the hero loop
at 30 fps, 768 × 1024.

Known: width is warped from the silhouette only, so fine details (suckers, markings) stretch a little where the
scale is large (up to ×1.4); arm tips are eased back to ×1 so they don't smear.
