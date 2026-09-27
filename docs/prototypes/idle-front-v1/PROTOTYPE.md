# Front-facing idle loop

Created by Codex at 2026-09-27T08:56:45-04:00. Status: PROTOTYPE_READY_FOR_REVIEW.

Ten-second periodic 2D cutout animation at 768 × 1024, 30 fps: gentle vertical float,
subtle mantle breathing, slight body sway and delayed tentacle waves. No particles,
water scenery, ground or audio. Original reference: owner's attached four-view octopus.
A front-facing transparent source was prepared with the built-in image_gen tool.
The generated alpha is preserved during premultiplied-alpha resampling.

Deliverables:
- octopus-idle-10s-alpha.mov: ProRes 4444 master with alpha (300 frames, exactly 10.0 seconds).
- octopus-idle-10s-alpha.webm: smaller VP9 with alpha (exactly 10.0 seconds).
- octopus-idle-preview.gif: transparent looping 384 × 512 preview, 20 fps, exactly 10.0 seconds.
- poster.png: full-resolution transparent first frame.
- frames/: full RGBA PNG sequence.
- preview.html: local preview with black/checkerboard/white backgrounds.
- render_idle.swift: deterministic renderer; no app code is modified.

Verification: exact t=0/t=10 pixel equality is asserted by the renderer; all 300 frames have
fully transparent canvas margins and no clipping. The last-to-first frame difference matches
normal neighboring-frame motion. FFprobe verifies durations, frame count and alpha codec metadata.
Delegated Codex reviewer independently inspected four times and decoded both movies' alpha.
Small source limitation: faint edge alpha noise in some sucker gaps is inherited from imagegen.

Use the MOV master for an Apple editing pipeline. Standard H.264 MP4 does not preserve alpha.
The GIF has a limited palette and binary transparency; it is a preview, not the master.
This prototype has not been integrated into the app. Owner approval precedes integration per
`docs/VISUAL_APPROVAL_GATE.md`.

Generation prompt (built-in image_gen; no API CLI):
Extract only the far-left front-facing octopus from the supplied turnaround as a full-body
transparent cutout; preserve pearly white sculpted skin, dark relaxed glossy eyes, long curled
arms with suckers and original proportions. Center the entire creature with padding. No
three-quarter angle, redesign, mouth, smile, water, particles, ground, background or text.

Reproduce animation: compile render_idle.swift with swiftc -O, then pass this directory to the
resulting executable. Render 300 PNG frames at 30 fps, then encode with ffmpeg prores_ks profile 4
and yuva444p10le for the master, or libvpx-vp9 with yuva420p and auto-alt-ref 0 for WebM.
