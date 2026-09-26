# TamagoAI — First Animation Prototype Plan (v1)

**Status:** PREVIZ, awaiting owner review. **Nothing here is approved or implementation-ready.**
Nothing moves to production code until the owner approves the visual prototype
(see [VISUAL_APPROVAL_GATE.md](VISUAL_APPROVAL_GATE.md)).

**Inputs:** approved character references in `Assets/CharacterReference/octopus-v001/` (visual ground
truth), [CREATURE_SPEC.md](CREATURE_SPEC.md) (behavior intent), [DECISIONS.md](DECISIONS.md)
(D-102 renderer and 12 fps cap, D-104 lifecycle, D-114 creature engine), and
[CHARACTER_ASSET_PIPELINE.md](CHARACTER_ASSET_PIPELINE.md).

**Deliverables in this document**

1. Animation shortlist (§2)
2. Storyboards (§3; images in `docs/prototypes/animation-v1/storyboards/`)
3. First motion test: brief + rendered preview (§4; `docs/prototypes/animation-v1/05_edge_inspection/`)
4. Art gap report (§5)
5. Engineering handoff template (§6; **not used yet**)

---

## 1. What the approved art tells us (read before anything else)

| Observation from the references | Consequence for motion |
|---|---|
| Porcelain-white, soft, glossy body; large bulbous mantle that sweeps **back** over the head in 3/4 and profile views | The mantle is the "weight". It lags slightly on fast turns and leads on glides. It is not a head that bobs like a mascot. |
| **Eyes:** glossy dark spheres with a heavy upper lid and a horizontal reflection. **No visible pupil shape.** Eyes sit in raised sockets on the sides of the head. | Expression comes from **lid aperture** (open ↔ heavy half-lid, the eerie register), **gaze** (the sphere's dark mass and highlight shift within the socket), and head tilt. The "horizontal bar pupil" vocabulary in CREATURE_SPEC §5 is superseded by lid + gaze. |
| Eight thick, tapering arms with **spiral curled tips** and pale sucker rows visible on inner curves | The tip spirals are the most characterful shapes. Motion should keep them *curling and uncurling*, never straight rods. Sucker rows appear when an arm turns or reaches, which is free "texture reveal". |
| No mouth, no brows, no hands | Keep it so. All emotion goes through eyes, arms, posture, distance, timing. |
| 14-view turnaround includes **underside** (arms radiating from the beak), **low 3/4**, **high views**, and two **crawling/spread poses** | Offscreen behaviors, "glass" moments and floor locomotion can use existing views. That's less new art than CREATURE_SPEC assumed. |
| Lighting is soft studio from upper left. The 14-view sheet was lit on grey, the 4-view and hero on black | The views mix well on black. Mirroring a view flips the light, which is acceptable in previz. Production renders should come from one lighting setup (§5). |

**Scale on the Watch (SE 3 40 mm = 324 × 394 device px):** resting creature width ≈ **0.40 of display
width** (130 px), total height with arms ≈ **0.53 of display height**. Eyes are then ~17 px apart per eye.
The lid and gaze read at arm's length in the previews. Anything smaller than that isn't worth animating.

---

## 2. Deliverable 1 — Animation shortlist (ranked)

| # | Animation | Why it's on the list | Frequency |
|---|---|---|---|
| **01** | Breathing Idle | Without it, everything else sits on a static PNG. It's the carrier wave for all other behavior. | continuous |
| **02** | Eyes-First Curiosity | Establishes the core movement grammar **eyes → pause → head → body → arms**. Every later behavior reuses it. | every 1–3 min |
| **03** | Tentacle-First Exploration | The second half of the grammar: **one arm decides before the body does**. Unmistakably octopus. | every 2–4 min |
| **04** | Slow Wander | Uses the whole display without looking like a sprite sliding. The mantle leads, arms stream behind, the path arcs. | every 1–3 min |
| **05** | Edge Inspection ★ | Treats the screen as **a physical window**, the single most important illusion. Combines 02 + 03 + body motion + a boundary interaction. | rare, ≤ 1 per 10 min |
| **06** | Full Exit | The creature deliberately leaves. **An empty black Watch** is the proof that it has a life beyond the screen. | occasional |
| **07** | Peek Return | Eyes (or one arm) come back first, cautious, then the body. Pays off the exit. | after every exit |
| **08** | Wrong-Edge Return | Returning from a *different* edge implies a world wrapping around the window. Cheap, because it reuses 06/07 poses. | ~1 in 3 returns |
| **09** | Touch Reaction | The first thing every user does is tap. It must feel like touching an animal (dent, flinch, inspect), not a button. | per tap |
| **10** | Glass Moment | A rare, uncanny highlight. It approaches the glass until its eyes fill the Watch and it *examines you*. | ≤ 1 per day |

**Why this order is the fastest path to believability**

- **01–03 are the vocabulary.** Breathing, eyes-first and arm-first are the three primitives the other seven
  are assembled from. Approving them first means later reviews argue about *choreography*, not about how an
  arm moves.
- **04–05 prove the space.** Once the creature moves believably, the display edges become the story. 05 is
  the first time the window is *physical*.
- **06–08 prove offscreen existence** for almost no new art (translation + masking at the display edge).
- **09** is the first interaction and depends on 01–03 being right.
- **10** is last on purpose. It's a rare "wow" that only lands if everything else already feels alive.

**Deliberately not in v1:** AI-state animations (listening/thinking/speaking), sleep, ink escape,
Crown current, familiarity variants. They build on this vocabulary and come in prototype v2.

---

## 3. Deliverable 2 — Storyboards and per-animation specs

Storyboard images: `docs/prototypes/animation-v1/storyboards/sbNN_*.png` (overview:
`ALL_storyboards_overview.png`). They're rendered from the **approved art only**, moved/warped by the
previz rig in `tools/previz/`. Previz caveats: mirrored views flip the lighting; arm bends are
approximations; view changes are cuts or blends where turn frames don't exist yet (§5).

**Coordinates:** normalized display, `(0,0)` top-left, `(1,1)` bottom-right. **Position** = the creature's
body pivot (the base of the mantle, where the arms meet the body). **Scale** = creature width as a
fraction of display width. **Timing** assumes the D-102 renderer cap of ~12 fps for production: holds of
≥ 83 ms, snaps of ≥ 1 frame (§4.6 compares 25 vs 12 fps).

### 01 — BREATHING IDLE · storyboard `sb01_breathing_idle.png`

| Field | Spec |
|---|---|
| Purpose | Never a static image. Suggests a body that breathes and arms that are individually alive. |
| Starting pose | `big_front` (front view), pos (0.50, 0.52), scale 0.40, lids open, gaze at viewer. |
| Keyframes | K1 exhale (rest). K2 inhale peak: mantle +2% tall, −0.7% wide. K3 exhale. Arms carry a slow wave travelling root → tip; left and right arms out of phase. |
| Timing | Breath cycle 3.6–5.2 s, randomized ±10% per cycle. Arm noise uses two superimposed waves (~0.23 Hz and ~0.37 Hz). |
| Easing | Sinusoidal (breath). Arm waves are continuous; no keyframed ease. |
| Eye behavior | Micro-drift of gaze ±0.1 socket radius every 1.5–4 s. Blink every 8–25 s: lid to ~0.7 in 90 ms, hold 60 ms, open in 120 ms. |
| Tentacle behavior | Tips move most (w ∝ distance-from-root^1.4). Tips never all curl the same way at once. |
| Body deformation | Mantle-only vertical scale ±2%, with inverse width ±0.7% (volume). Pivot fixed. |
| Screen position | Wherever the creature rests. Never forces re-centering. |
| Offscreen extent | none (inherits whatever the resting position is). |
| Loop rule | Continuous, but parameters re-randomize each cycle, so there's never a visible loop seam. |
| Interruption | Never interrupted. It keeps running under every other animation, reduced to 35% during "stillness" beats. |
| Haptic/sound | none |
| Art | **Existing art only** (deformation). The production renderer does this procedurally (D-114) or via ≤ 4 breath frames (pipeline `idle-breathe`). |

### 02 — EYES-FIRST CURIOSITY · `sb02_eyes_first_curiosity.png`

| Field | Spec |
|---|---|
| Purpose | Establishes the grammar **eyes → pause → head → body → arms**. The creature *thinks* before it moves. |
| Starting pose | Front view, pos (0.52, 0.52), idle. |
| Keyframes | K1 idle. K2 eyes snap to target (gaze −1.0, +0.1). K3 hold, lids tighten to 0.18. K4 head rotates −7° toward the target, arm roots follow, tips still hang where they were. K5 body re-oriented (blend to `q34` view facing target), arms swing through and settle. |
| Timing | K2 0–120 ms · K3 120–700 ms (**the pause is the point**) · K4 700–1200 ms · K5 1200–2200 ms. |
| Easing | K2 ease-out (fast start, soft stop). K4 ease-in-out. K5 ease-in-out with a 4–6% overshoot on the arm tips. |
| Eye behavior | Eyes lead by ≥ 580 ms. The lids narrow slightly during the pause (focus), then relax when the body arrives. |
| Tentacle behavior | Roots follow the head at +100 ms. Tips lag 300–420 ms and overshoot, then settle. |
| Body deformation | Rotation only (≤ 8°). No squash. |
| Screen position | In place ± 0.03. It turns toward, it doesn't travel. |
| Offscreen extent | none |
| Loop rule | Occasional (every 1–3 min). Never the same target side twice in a row. |
| Interruption | A tap during K2–K3 aborts the turn (eyes snap to the tap point → 09). During K4–K5 it completes the turn toward the tap instead. |
| Haptic/sound | none |
| Art | Existing: front + `q34_left` (mirrored for right). **Missing:** front→3/4 turn in-betweens (§5 NEEDED NOW), so the storyboard cuts. |

### 03 — TENTACLE-FIRST EXPLORATION · `sb03_tentacle_first.png`

| Field | Spec |
|---|---|
| Purpose | Octopus arms act semi-independently. One arm tests the world before the animal commits. |
| Starting pose | Front view, pos (0.40, 0.46). |
| Keyframes | K1 idle. K2 eyes drop toward a spot (gaze 0.8, 0.8). K3 outer arm slides out (bend −18°, extend +0.10), body still. K4 **decision:** the arm half-recoils (−6°), tip curls. About 40% of the time the behavior ends here. K5 arm commits further (−24°, +0.16), mantle leans 7°. K6 body drifts to (0.58, 0.54) while other arms trail and the probing arm resettles. |
| Timing | K2 0–150 ms · K3 300–1100 ms · K4 1100–1500 ms · K5 1500–2300 ms · K6 2300–4000 ms. |
| Easing | K3 ease-out with a micro-pause (hold 120 ms) halfway. K4 ease-in-out. K6 ease-in-out; trailing arms use a lag, not an ease. |
| Eye behavior | Eyes fix on the arm tip during K3–K5 (they watch their own arm), then glance up at the viewer once the body arrives. |
| Tentacle behavior | **Initiator:** the outer arm on the target side. **Lag:** the other arms move only in K6, tips +350–450 ms. The neighbor arm twitches once in K4 (sympathetic, "small independent decision"). |
| Body deformation | Lean ≤ 7° toward the arm. Arm stretch ≤ +25% length. |
| Screen position | Start (0.40, 0.46) → end (0.58, 0.54). Target chosen within 0.15–0.85 in x and 0.30–0.85 in y. |
| Offscreen extent | none (a variant may reach past an edge, which is 05). |
| Loop rule | Occasional. Never with the same arm twice in a row. |
| Interruption | Tap → the probing arm retracts fast (250 ms, ease-in), then 09 plays. |
| Haptic/sound | none |
| Art | Existing + arm bend (previz uses one rigged arm). Production needs **per-arm separation** (§5 NEEDED NOW) so any arm can initiate. |

### 04 — SLOW WANDER · `sb04_slow_wander.png`

| Field | Spec |
|---|---|
| Purpose | Uses the whole display. Travel looks like swimming, not sliding. |
| Starting pose | Front view, pos (0.30, 0.42). |
| Keyframes | K1 eyes pick a destination. K2 turn to 3/4 facing travel, mantle tilts +8°. K3 **glide:** profile view, mantle leading, arms streaming behind, tilt ~24°. K4 **coast:** arms overshoot forward then fan (drag). K5 second, weaker pulse on an arc. K6 settle onto the bottom edge in the spread `crawl_q34_right` pose, pos (0.64, 0.80). |
| Timing | K1 0–300 ms · K2 300–900 ms · K3 900–2400 ms · K4 2400–3200 ms · K5 3200–4500 ms · K6 4500–6000 ms. Travel speed ≤ 0.08 display-widths/s. |
| Easing | Each pulse: fast ease-out (jet), then long coast deceleration. Octopus swimming is pulse–glide, **never constant velocity**. |
| Eye behavior | Eyes lock on the destination at K1 and re-check it once mid-path (a small gaze correction at K4). |
| Tentacle behavior | All arms trail during glides (tips lag 350–500 ms). On coast they swing forward past neutral and fan out. On settle, the two front arms touch down first. |
| Body deformation | Mantle stretch +5% along travel during pulses, compress −3% on coast. Tilt into direction. |
| Screen position | Path is a quadratic arc between points chosen ≥ 0.35 apart. It may run through any region of the display, including within 0.05 of edges. |
| Offscreen extent | none (a wander that crosses an edge becomes 06). |
| Loop rule | Occasional. Consecutive wanders alternate general direction. |
| Interruption | Tap mid-glide → it brakes (arms flare forward, 300 ms), turns eyes to the tap, then 09. |
| Haptic/sound | none |
| Art | Existing: front, `q34_left`, `profile_left_a`, `crawl_q34_right`. **Missing:** a 4-frame swim pulse cycle and turn in-betweens (§5). |

### 05 — EDGE INSPECTION ★ FIRST MOTION TEST · `sb05_edge_inspection.png` + rendered preview

Full brief in §4.

### 06 — FULL EXIT · `sb06_full_exit.png`

| Field | Spec |
|---|---|
| Purpose | It chooses to leave. The empty display proves the world is bigger than the window. |
| Starting pose | 3/4 view facing the chosen edge, pos (0.60, 0.50). |
| Keyframes | K1 eyes to the edge, stillness. K2 mantle leads toward the edge, arms trail. K3 mantle and eyes out; arms still inside. K4 the last arm tip lingers at the edge, curls, slips out. K5 empty. |
| Timing | K1 0–600 ms · K2 600–1800 ms · K3 1800–2600 ms · K4 2600–3400 ms · K5 empty for 2–6 s (then 07 or 08). |
| Easing | K2 ease-in (accelerating away). K4 the tip moves ease-out, holds 400 ms, then snaps out (100 ms). |
| Eye behavior | Eyes aim at the exit point well before moving. **No glance back at the viewer** (it isn't performing leaving). |
| Tentacle behavior | Arms trail with increasing lag. The last visible tip belongs to a rear arm and curls once before leaving. |
| Body deformation | Slight stretch along motion (+4%). Tilt 16–22°. |
| Screen position | Exit through any edge. Preferred edge from the personality seed (CREATURE_SPEC §1.2). |
| Offscreen extent | 100%. The creature fully leaves: K3 ≈ 55% out, K4 ≈ 95% out, K5 100% out. |
| Loop rule | Occasional. Never within 60 s of the previous exit. Never during an AI interaction. |
| Interruption | Tap during K1–K3 → it stops, eyes come back to the tap, it returns (reverse of K2). Tap during K4–K5 → **a peek within 1.2 s** (07, short form). |
| Haptic/sound | none |
| Art | **Existing art only** (translation + display clipping). |

### 07 — PEEK RETURN · `sb07_peek_return.png`

| Field | Spec |
|---|---|
| Purpose | Cautious, eyes-first return. Implies the creature has been somewhere and checks before re-entering. |
| Starting pose | Empty display. |
| Keyframes | K1 empty. K2 one arm tip slides in from the edge, touches the glass, curls. K3 arm withdraws. K4 **eyes peek**: body sideways (rot 90°), only the mantle and eyes inside the window, holds. K5 retreats a few px, lids tighten (0.25). K6 decides: slides in while rotating upright, arms pour in after. K7 upright, settles, glances at the viewer. |
| Timing | K2 0–900 ms · K3 900–1300 ms · K4 1300–2800 ms · K5 2800–3200 ms · K6 3200–4800 ms · K7 4800–6000 ms. |
| Easing | K2 ease-out. K4 slow ease-in-out (sneaking). K5 quick ease-out (flinch). K6 ease-in-out with arm lag. |
| Eye behavior | The eyes are the first body feature seen. They scan (gaze moves between 2 points) before finding the viewer. |
| Tentacle behavior | Arm-tip first (K2). In K6 the arms follow the mantle through the edge one by one (staggered 80–120 ms). |
| Body deformation | Rotation 90° → 0° during entry. No squash. |
| Screen position | Enters at the edge the life simulation says it's on. Peek depth: mantle top at x ≈ 0.22, eyes at x ≈ 0.05 (left edge example). |
| Offscreen extent | K2 ≈ 95% off (tip only). K4 ≈ 80% off. K6 → 0%. |
| Loop rule | Plays after every absence (or 08 instead). Peek depth and hold are randomized. |
| Interruption | Tap during K4–K5 → it ducks out (300 ms) and re-peeks from the **same** edge 1–2 s later, bolder. Tap after K6 → 09. |
| Haptic/sound | none |
| Art | Existing (rotation + clipping). A dedicated **"head-only peek" pose** would look better than a rotated front view (§5 NEEDED SOON). |

### 08 — WRONG-EDGE RETURN · `sb08_wrong_edge_return.png`

| Field | Spec |
|---|---|
| Purpose | It left right and comes back from above. The window is inside a larger world. |
| Starting pose | After 06 through one edge, empty for 3–8 s. |
| Keyframes | K1 exit (06). K2 empty. K3 the head dips in **upside down** from the top edge, eyes first, far from the exit point. K4 hangs, looking around (lids 0.2). K5 drops in and rolls; arms follow through the top edge. K6 rights itself, settles. |
| Timing | K3 0–1500 ms · K4 1500–2600 ms · K5 2600–3800 ms · K6 3800–5000 ms. |
| Easing | K3 slow ease-out (lowering). K5 ease-in drop then ease-out roll. K6 ease-out with a 3% settle bob. |
| Eye behavior | Upside down, the eyes find the viewer and hold for an unusually long 1–1.5 s. That's the eerie beat. |
| Tentacle behavior | Arms stay above (offscreen) during K3–K4, then pour through the top edge in K5, trailing the roll. |
| Body deformation | Rotation 180° → 0° across K5–K6. |
| Screen position | Re-entry x is ≥ 0.4 away from the exit point (or a different edge). |
| Offscreen extent | K3 ≈ 85% off (head top only). K4 ≈ 70% off. K5–K6 → 0%. |
| Loop rule | Roughly 1 in 3 returns. Never two wrong-edge returns in a row. |
| Interruption | Same as 07. |
| Haptic/sound | none |
| Art | **Existing art only** (rotation + clipping). An upside-down "hanging" arm pose would help (§5 OPTIONAL). |

### 09 — TOUCH REACTION · `sb09_touch_reaction.png`

| Field | Spec |
|---|---|
| Purpose | Touching it feels like touching a soft animal: local, physical, then curious. |
| Starting pose | Any idle pose (shown: front view, pos (0.50, 0.52)). |
| Keyframes | K1 tap. K2 **local dent** at the touch point, lids snap to ~0.55, mantle squash (1.05, 0.94) about the fixed pivot. K3 recoil away from the touch 2–3%, arm tips curl inward. K4 eyes open wide and find the touch point. K5 the nearest arm reaches to inspect the spot. K6 back to idle. |
| Timing | K2 0–80 ms · K3 80–300 ms · K4 300–700 ms (reaction delay 250–400 ms is intentional) · K5 700–1600 ms · K6 1600–2400 ms. |
| Easing | K2 instant in (1 frame), K3 ease-out, K4 ease-out, K5 ease-in-out, K6 ease-in-out with a 3% overshoot. |
| Eye behavior | Protective lid snap first (reflex), *then* the eyes open and look. This order is the difference between an animal and a button. |
| Tentacle behavior | All tips curl inward on K3 (reflex, lag ~100 ms). One arm (nearest the touch) inspects on K5. The others relax at different times. |
| Body deformation | Dent radius ≈ 0.10 creature widths at the contact point; squash ≤ 6%; pivot fixed. |
| Screen position | Recoil moves away from the touch vector by 0.02–0.03. |
| Offscreen extent | none |
| Loop rule | Per tap. Repeated taps escalate per CREATURE_SPEC §4.2 (not prototyped here). Vary the inspecting arm and the dent strength ±20%. |
| Interruption | A new tap restarts from K2 at the new point, with reduced dent (habituation). |
| Haptic/sound | none by default (CREATURE_SPEC §9.2) |
| Art | Existing + deformation. **Previz limit:** the storyboard can only show the inspecting arm *reaching*. An arm curling back onto its own mantle needs arm-curl art or a proper arm rig (§5 NEEDED NOW). |

### 10 — GLASS MOMENT · `sb10_glass_moment.png`

| Field | Spec |
|---|---|
| Purpose | Rare, uncanny, intimate. It comes right up to the glass and examines *you* with those eyes. |
| Starting pose | Idle, front view, facing the viewer. |
| Keyframes | K1 stops, looks straight out. K2 drifts toward the glass: scale 0.40 → 0.75, arms leave the bottom of the frame. K3 the face fills the window (scale ≈ 1.35, pivot below the display at y ≈ 0.95). Almost no motion. K4 slow head tilt 7°, lids lower to the heavy half-lid (0.40). K5 eyes slide sideways and back ("reading your face"). **Variant K5b (rarer):** the underside pressed flat on the glass, suckers splayed. K6 lets go, drifts back to normal size. |
| Timing | K2 0–1500 ms · K3 1500–3000 ms · K4 3000–5000 ms · K5 5000–5600 ms · K6 6000–8000 ms. |
| Easing | Everything slow ease-in-out. K5 gaze moves ease-out, holds 300 ms, ease-out back. |
| Eye behavior | The centerpiece. Very slow lid movement (≥ 600 ms), one deliberate gaze excursion, no blinking until K6. |
| Tentacle behavior | Out of frame in K3–K5. In K5b the arms radiate across the whole display. |
| Body deformation | Scale only. Breathing reduced to 40% (it's holding still). |
| Screen position | Centered x 0.50–0.52. The pivot goes below the display (y 0.95) so the face fills the top 70%. |
| Offscreen extent | K3–K5: arms and lower body 100% off the bottom edge. Only head and eyes visible. |
| Loop rule | Rare: ≤ 1 per day, never in the first 3 days (familiarity-gated per CREATURE_SPEC §6), never twice in a session. |
| Interruption | Tap on the glass during K3–K5 → **slow blink**, then it backs away gently (no flinch; it knew you were there). |
| Haptic/sound | Optional single `.click` at the moment of K5b contact. Off by default. |
| Art | Close-ups upscale the ~790 px renders to ~1.35× display width, which is soft. The painted lid shows seams at this size. **Needs high-res close-up face art with native half-lid** (§5 NEEDED SOON). The underside view exists. |

---

## 4. Deliverable 3 — First motion test: 05 EDGE INSPECTION

### 4.1 Why this one

It exercises every open question at once, on real Watch scale:

- **character identity**: front view, both eyes, full silhouette
- **eye anticipation**: the eyes notice long before anything else moves
- **tentacle-first motion**: one arm scouts, hesitates, commits
- **body follow-through**: the mantle leans, arm tips trail
- **the window illusion**: the tip flattens on the display edge and leaves faint sucker marks
- **uncanny calm**: total stillness, then a glance back at the viewer
- **timing at the production frame cap**: a 12 fps version is included

### 4.2 Preview files (PREVIEW ONLY — not integrated into the app)

`docs/prototypes/animation-v1/05_edge_inspection/`

| File | What |
|---|---|
| `05_edge_inspection_2x_30fps.mp4` | Clean, 2× device px (648×788 + preview bezel), 30 fps. **Review this first.** |
| `05_edge_inspection_2x_30fps_annotated.mp4` | Same, with a timestamp and beat caption on each frame. |
| `05_edge_inspection_native_25fps.gif` | 1:1 device px (324×394). This is the real size on the wrist. |
| `05_edge_inspection_native_12fps_production_cap.gif` | 1:1 at **12 fps**, what the current D-102 cap would look like. |

The dark grey margin is a preview bezel so you can see the display edge. It isn't part of the design.

### 4.3 Brief

| Field | Spec |
|---|---|
| Name | EDGE INSPECTION |
| Purpose | The creature notices the edge of its world and investigates it as if the display were glass. It shows curiosity, arm-first exploration and the window illusion in one beat. |
| Starting pose | `big_front`, pos (0.44, 0.50), scale 0.40, rot 0, lids open, gaze at viewer, breathing. |
| Duration | 11.0 s (the loop is for review only; in production it never repeats back to back). |
| Screen position | Home (0.44, 0.50) → inspection (0.635, 0.47) → home. Contact on the right edge at y ≈ 0.53–0.56. |
| Offscreen extent | None. The arm tip stops **at** the glass (x ≈ 0.995) and flattens rather than passing through. That's the whole point. |
| Loop rule | Rare (≤ 1 per 10 min), never the same edge twice in a row, only from idle. |
| Interruption | Tap before 2.9 s → aborts, and eyes go to the tap (09). Tap 2.9–8.2 s → the arm peels off the glass fast (300 ms ease-in), body recoils 3%, then 09. Tap after 8.2 s → blend into 09 from the current pose. |
| Haptic/sound | none |
| Art | Existing `big_front` + a separated outer right arm (previz traced it by hand). Faint sucker marks are a previz overlay; production needs an approved decal (§5). |

### 4.4 Exact keyframes (ground truth for any tool; from `tools/previz/scene_edge_inspection.py`)

Times in seconds. Ease names describe the segment **arriving at** the key: *out* = decelerate,
*in* = accelerate, *io* = ease in-out (cubic), *back* = ease-out with ~5% overshoot, *hold* = constant.

**Body position (pivot)**

| t | pos | ease |
|---|---|---|
| 0.00 | (0.440, 0.500) | — |
| 3.50 | (0.440, 0.500) | hold |
| 5.20 | (0.635, 0.470) | io |
| 8.40 | (0.635, 0.470) | hold |
| 10.30 | (0.440, 0.500) | back |

**Body rotation (degrees, + = clockwise)**: 0.00 → 0 · 2.45 → 0 (hold) · 3.00 → 5 (io) · 4.20 → 8 (io) ·
5.20 → 3 (io) · 8.40 → 3 (hold) · 9.40 → −2 (io) · 10.40 → 0 (io)

**Gaze (x, y in socket radii; +x = creature looks screen-right, −y = up)**: 0 → (0,0) · 2.00 (0,0) hold ·
**2.12 → (1.0, 0.05) out** · 5.20 hold · 5.70 → (1.0, −0.35) io · 7.30 hold · **7.55 → (0,0) out** · end hold

**Upper lid (0 open … 1 closed)**: 1.10 → 0 · 1.19 → 0.72 in · 1.25 hold · 1.37 → 0 out (blink) ·
5.20 → 0 · 5.60 → 0.30 io (focus) · 7.30 hold · 7.55 → 0.05 out · 7.95 hold · 8.08 → 0.72 in · 8.16 hold ·
8.32 → 0.05 out (slow blink) · 11.0 → 0 io

**Scout arm (outer right arm; bend ° about its root, extension in creature widths, tip lift)**

| t | bend | extend | lift | ease | beat |
|---|---|---|---|---|---|
| 2.90 | 0 | 0 | 0 | hold | rest |
| 3.35 | −30 | — | — | out | reaches |
| 3.47 | −30 | — | — | hold | **hesitates 120 ms** |
| 4.00 | −55 | 0.12 | 0.03 | io / out | commits |
| 4.60 | −55 | 0.12 | 0.03 | hold | |
| 5.20 | −66 | 0.29 | 0.03 | io | **tip meets glass** (collision flattens it) |
| 6.60 | −76 | 0.29 | 0.10 | io | slides up the glass ~12 px |
| 8.20 | −76 | 0.29 | 0.10 | hold | |
| 9.60 | 0 | 0 | 0 | io | retracts |

**Breathing amplitude**: 1.0 until 6.60 → 0.35 at 6.80 (io) · hold to 7.30 · → 1.0 at 7.60 (the stillness beat)
**Arm idle energy**: 1.0 → 0.5 at 2.30 (focused) · hold to 7.30 · → 1.0 at 8.00

**Follow-through (lag by height)**: rows of the body lag the pivot path by
`L(h) = −0.10 s` for the head (h < 0.22, leads), `0` at the mantle base, rising to `+0.42 s` at the arm tips
(`L = 0.42·((h−0.30)/0.70)^1.2`).

**Glass contact marks**: 4 faint soft sucker marks at (0.972, 0.556) appearing at 5.25 s, a second set at
(0.972, 0.527) at 6.35 s, both fading over 1.2 s from 8.25 s. Opacity ≤ 13%.

**Beat sheet**: 0–2.0 idle · 1.1 blink · **2.0 eyes notice** · 2.12–2.7 pause (nothing else moves) ·
2.45 head follows · **2.9 one arm scouts** · 3.35 hesitation · 3.5 body follows, arms trail · **5.2 tip meets
glass, flattens** · 5.6 feels along the edge · 6.6 stillness (uncanny) · **7.3 glances back at you** · 7.95 slow
blink · 8.2 arm retracts · 8.4 drifts home, arms trail, settles · 10.3 idle.

### 4.5 What to judge in review (owner checklist)

1. Does it read as **an octopus**, not a mascot or a sprite?
2. Is the eye-notice → pause → arm → body **delay** right, or too slow or too fast?
3. Does the arm-on-glass moment sell "the screen is a window"?
4. Is the stillness beat eerie-good or dead?
5. Does the glance back at you land?
6. At **12 fps** (the production cap GIF), is it still acceptable? If not, that's evidence for the D-009 proposal to raise the cap during interactions.
7. Scale: is 0.40 display width right on the wrist?

### 4.6 Known previz limitations (not design intent)

- The scout arm is a hand-traced cut of one render, bent by a mesh warp. A faint seam is visible where it
  leaves the body at extreme bends.
- Lids are painted from surrounding skin. They read fine at 1:1 but look pasted-on in close-ups.
- The arm-idle wave is a displacement approximation of independent arm motion.
- Mirrored views flip the studio lighting.

---

## 5. Deliverable 4 — Art gap report

Rule: only request what can't reasonably come from translation, rotation, scaling, masking, deformation, or the
existing 19 views. All requests must match the approved references exactly: same model, material, lighting
and camera lens. **Render from one lighting setup on transparent backgrounds** so views mix without the
grey-versus-black mismatch.

### NEEDED NOW (blocks approval of 02–05 and 09 at quality)

| # | Asset | Why transforms can't do it |
|---|---|---|
| N1 | **Layered front view** (`big_front` pose): mantle/head, each of the 8 arms as a separate layer, and the occluded areas behind each arm filled in. Transparent PNG, ≥ 1024 px tall. | Arm-first motion needs any arm to move independently. Today only one arm is separable, and moving it leaves a hole behind it (which the previz hides). |
| N2 | **Eye kit** for front and 3/4: eyeball layer (glossy dark sphere + highlight separate), **upper lid at 5 apertures** (open, 25%, 45% = the eerie half-lid, 70%, closed), eye-socket rim. | Lids painted over the render look pasted-on at larger sizes. Gaze needs the sphere and highlight separable from the socket. |
| N3 | **Turn in-betweens** front → 3/4 (left): 2 intermediate angles (≈ 22° and 45°). Mirror for right only if lighting is re-rendered. | Every eyes-first turn (02, 04, 06) currently hard-cuts between views. |
| N4 | **Arm-curl reference**: one arm curling back onto the mantle (touch/inspect), 3 poses. | Needed for 09 inspect and grooming. A 2D bend can't fold an arm over its own body convincingly. |

### NEEDED SOON (for 04, 07, 10 and the next prototype batch)

| # | Asset | Why |
|---|---|---|
| S1 | **Swim pulse cycle**, profile + 3/4: 4 poses (contracted mantle with arms together → jet → arms trailing → coast fan) | Pulse–glide locomotion (04) can't be faked convincingly from a static profile. |
| S2 | **Head-only peek pose**: head and eyes angled toward camera with arms folded back (for edge peeks) | 07 currently rotates a full front view by 90°, which reads a bit "lying down". |
| S3 | **High-res face close-up** (≥ 1400 px across the head), front and slight 3/4, with the eye kit (N2) | The Glass Moment (10) upscales the current art and looks soft. |
| S4 | **Sucker-print decal** set (3 variants, soft, very low contrast), matched to the art's sucker size | The window illusion (05, 07, 10) needs a real decal, not previz circles. |
| S5 | **Sleep/curl pose** (arms wrapped under the mantle, eyes closed with lid kit) | The next batch (AI states, sleep) needs a genuine resting silhouette. |

### OPTIONAL

| # | Asset | Why |
|---|---|---|
| O1 | Upside-down hanging pose (2 arms up holding, others dangling) | Improves 08. Rotation currently works acceptably. |
| O2 | Underside view with the mantle visible (slightly oblique) | Nicer "outside the glass" variant of 10. |
| O3 | Ink puff reference | For the future overwhelm/ink escape. Can be procedural. |
| O4 | Back-view layered arms | Only if exits/returns show the back often. The existing back views cover it. |

### Not needed (don't commission)

Separate frames for breathing, blinking at full closure, walk/drift translation, peeks from each edge (just
clip one pose), mirrored duplicates, shadows/backgrounds, "happy/sad" faces (the character has no face
expressions by design).

---

## 6. Deliverable 5 — Engineering handoff template (NOT IN USE YET)

Filled **only** after the owner approves the visual prototype. One file per animation:
`docs/handoffs/ANIM-<NN>-<slug>.md`.

```markdown
# ANIM-<NN> <NAME> — engineering handoff
Approval: APPROVED by <owner> on <date> · prototype rev <vN> · review notes: <link>
Approved visual reference: docs/prototypes/<batch>/<file>.mp4 (frame-accurate target)

Trigger:          <engine state/condition, e.g. CreatureBehaviorEngine idle + curiosity > 0.6, cooldown 10 min>
Duration:         <ms total>          Frequency/loop rule: <rule>
Start pose:       <art key>, pos (x,y), scale s, rot θ, lid, gaze
Keyframes:        | t (ms) | channel | value | ease-in |   (pos, rot, scale, gaze, lid, arm[i] bend/ext, breath)
Coordinates:      normalized display, (0,0) top-left; pos = body pivot; scale = width / display width
Easing:           named curves: out | in | io | back(overshoot %) — same definitions as the prototype
Follow-through:   lag profile by body height (head lead ms, tip lag ms)
Offscreen:        max % of creature outside display at each key; edge(s) used
Interruption:     per time window → behavior (and which animation it hands to)
Assets:           tamago_octopus_<pose-key>_f000… (CHARACTER_ASSET_PIPELINE names), layers used
Haptic/sound:     none | WKHapticType + moment
Performance:      ≤ 12 fps (D-102) unless a decision says otherwise; no timers; pauses when !isLive;
                  low-power pose = <key>; max decoded frames resident = <n>
Acceptance:       [ ] side-by-side with the approved MP4 at the same timestamps: key poses match within
                  ±0.02 position, ±3° rotation, ±80 ms timing
                  [ ] interruption cases behave as specified
                  [ ] SE 3 40 mm simulator capture recorded (SIMULATOR_VERIFIED_ONLY)
                  [ ] owner compares the simulator capture to the prototype and signs off
                  [ ] device check logged in DEVICE_TEST_LOG before any DEVICE_VERIFIED claim
Out of scope:     <explicitly not included>
```

---

## 7. Reproducing / revising the previews

`tools/previz/` is a small **preview-only** Python rig (not app code). It only moves, masks and warps
the approved renders:

```sh
pip install pillow numpy opencv-python-headless imageio imageio-ffmpeg
cd tools/previz
python3 extract_sprites.py                                   # cut reference views → _work/sprites
python3 storyboards.py                                       # → _work/out/sb*.png
python3 render_motion.py scene_edge_inspection 05_edge_inspection   # → _work/out/*.mp4, *.gif
```

Changing a timing means editing one number in `scene_edge_inspection.py` and re-rendering (about 3 minutes).
That's the point: **revise the GIF, not the Swift.**
