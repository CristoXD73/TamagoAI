# Startup sequence v1 (awaiting the owner)

Made by Claude Code, 2026-09-29. Owner: "remove the background of all the octopuses i sent you, try to line them
up on each other as accurately as possible and do a motion design where they all transform … in rapid succession
ramping up until it becomes our original hero, then the idle floating animation begins. I think it would be a
good startup sequence. Feel free to add sound and effects and polish it. Show me v1."
Status: PROTOTYPE_READY_FOR_REVIEW (VISUAL_APPROVAL_GATE #17).

`startup-v1.mp4`: 1080 × 1920, 60 fps, 8.7 s, AAC stereo. `keyframes.png`: six moments.

| Time | What happens | Sound |
|---|---|---|
| 0–0.75 s | Darkness, a spark swelling where the eyes will be | a low tone starts to rise |
| 0.75–3.9 s | The eight universes (neon, ink, stone, velvet, sprout, metal, x-ray, cardboard), twice: 0.62 s each at first, down to 2–3 frames. Each cut: scale punch, RGB split, a bloom, the universe's own colour glowing behind; the camera leans in | a tick per cut, rising in pitch, left/right; soft whooshes under the slow ones; the riser (tone + air) builds and cuts out 60 ms before the hit |
| 3.9 s | The original hero lands: white flash, shockwave ring from the eyes, sparks, a small overshoot | sub drop, noise hit, a bright chime ringing out |
| 3.9–8.7 s | The approved idle float (D-124) takes over | a quiet warm pad; a few bubbles |

How it's made:
- **Backgrounds:** removed with Apple Vision's subject lifting (`tools/brand/liftsubject.swift`).
- **Alignment:** each octopus is scaled and moved so its eyes land on the hero's eyes in the idle loop's first frame
  (`tools/brand/startup_align.py`). Five eye centres were set by hand where the detector was fooled. The check
  image is `Assets/Brand/universes/aligned/onion-check.png`.
- **Picture and sound:** `tools/brand/startup_sequence.py`. The sound is synthesized: no samples, nothing
  licensed.
- The cut-outs and aligned layers are in `Assets/Brand/universes/cutouts/` and `aligned/`.

Not done yet: not in the app; no Watch-sized version (the Watch launch would need a shorter cut, and has no
sound unless the owner wants it).
