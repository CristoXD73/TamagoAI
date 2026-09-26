# TamagoAI — Creature Behavior & Personality Specification

**Status:** Design spec v1 (2026-09-26). No implementation code. Owned by product/interaction design.
**Audience:** Swift/watchOS engineers (Claude Opus / Sonnet in Xcode, Codex), character artists, animators.
**Naming:** The product is now called **TamagoAI**. "Apple Tamago" and "TamaWatch" in older
docs refer to the same project. The creature itself is referred to as **Tamago** or "the octopus".

**Rule for implementers:** Behavior described here is *intent*. Everything that depends on watchOS
behavior (Always-On, complication refresh, frontmost duration, CoreMotion, audio) is `UNVERIFIED`
until observed on the physical Apple Watch SE 3 and logged in `DEVICE_TEST_LOG.md`. When the device
disagrees with this document, the device wins. Update this file; don't fake the behavior.

---

## 0. The one-paragraph brief

Tamago is a small, white, octopus-like creature that lives in a pocket of dark water behind the
Watch glass. The screen is **a window, not a stage**: the creature's world is larger than the
screen, and it has its own things to do in it. It is calm, curious, a little uncanny, and quietly
fond of its owner. It never begs, never punishes, never pings. When you speak to it, you don't
see a spinner or a chat bubble: you see an animal *listen*, *turn something over in its arms*,
and *answer*. The goal is that after a week, the owner glances at their wrist and thinks
"I wonder what it's doing" rather than "I should check the app."

### What we learned from research (summary; sources at the end)

| Source | Lesson we keep | What we do differently |
|---|---|---|
| **Meta Muse / Muse Charm, "Jolly" (Connect 2026)** | A character is the best answer to "how do I show what an AI agent is doing?". The avatar reacts *while you talk*, and work-in-progress is shown as character activity, not a progress bar. A charm-like, watch-sized device works as a home for a companion. | Jolly's status animations are humanoid (e.g. tapping at a keyboard) and it has a smiling face. Tamago shows state through **octopus biology** (skin, pupils, arms, distance). Jolly was widely criticized as infantilizing and toddler-like, and as "cuteness lowering users' guard". Tamago is **cute but slightly alien**, adult in tone, and cuteness is never used to extract engagement or data. |
| **Anki Cozmo / Vector** | "Genuine, not clownish; curious, not cloying; cheerful, not cheesy." They turned necessary machine latency into personality (acting curious while sensing). Vector could just *hang out* and was comfortable being ignored. | Same philosophy. AI latency becomes visible *thinking behavior*. |
| **Neko Atsume** | Life happens **while you're away**. Every time you open it, something different is going on. There's no punishment for absence. | We compute "what it was doing" deterministically from the clock (§7). There's no collection grind. |
| **Casio Moflin** | Familiarity develops slowly (~50 days) and shows as *distinctness*, special gestures only for the owner, and no demands. | Same shape of curve (§6), without sensors we don't have. |
| **Tamagotchi (original)** | Pocket presence and a glanceable character are timeless. | We reject hunger/health meters, death, poop, and attention calls entirely. |
| **HBS "Emotional Manipulation by AI Companions" (2025)** | 37% of companion-app farewells use guilt, FOMO, or restraint tactics. They raise engagement up to 14×, driven by curiosity and *anger*, not enjoyment. A well-being-focused app showed none. | Tamago has **no farewell behavior at all** except continuing its own life (§10). |
| **Real octopus behavior** | Chromatophores change color in under a second. Papillae change texture (smooth ↔ bumpy). Arms carry most of the neurons and act semi-independently. When approached, an octopus often **sends out one arm to inspect**. They play, remember, and have dens. Pupils are horizontal bars. | These give us a whole nonverbal vocabulary that isn't a human face. |
| **Game idle-animation practice** | Stillness is a behavior. Layered noise beats looping clips. Break loops with randomized timing and cascading phase offsets on appendages. | §2 and §8 are built on layers, not loops. |

### 0.1 How this spec relates to what is already built (D-101…D-114)

This spec was written after the Phase 3/4 work landed. It **doesn't override** architecture decisions.
Where it asks for something different, that's a **proposal** for Opus to accept or reject in
`DECISIONS.md` (see D-009). Current facts that constrain the design:

| Existing decision | Fact | What this spec does with it |
|---|---|---|
| **D-106 Voice** | `Speech.framework` is absent from the watchOS 27 SDK. V1 speech input is **system dictation**, and its sheet **covers the creature** while the user speaks. There's no mic level in V1. | The embodied *listening* phase (§4.5) plays as a **summon beat before** the sheet and an **acknowledge beat after** it. The full on-screen listening performance (trembling arm tips, silence prompt) is kept for the V2 recorded-audio path. The talk trigger follows whatever control D-106 requires on device (§4.5). |
| **D-102 Renderer** | SwiftUI `TimelineView`, **~12 fps cap**, paused when not live. | Motion is designed to read well at 12 fps: large, slow, eased arcs, no fine jitter. Raising the cap during interaction/AI states only is a device-measured proposal (§7.2.8). |
| **D-114 Creature engine** | A pure seeded `CreatureBehaviorEngine` (resting/moving/peeking/offscreen) drives the idle world. A procedural octopus is drawn by `CharacterFace`. Hidden holds are 2–5.5 s. Long gaps "reset calmly". | This spec is the **behavior content** for that engine: catalogs (§2–3), mood variables, the scheduler, and tuning. The procedural approach matches §8.1. Proposed tuning: longer trips with signs of life (§3.2), and `lifeState(at:)` instead of a calm reset after long gaps (§7.2.1). |
| **D-103 / D-104** | One canonical interaction reducer. Transient states are never restored. Relaunch starts `idle`/`disconnected`. | Unchanged. "Resume in media res" (§7.2.2) applies only to the **idle world** (position, activity, pose), never to request states. |
| **D-105 Complication** | Mood snapshot, single entry, `.never` policy, app-driven reloads, App Group in Phase 6. | Proposal: generate the day's pose entries from `lifeState` (§7.2.4) while keeping app-driven mood overrides. There's still no background refresh. |

---

## 1. Core personality

### 1.1 Temperament (fixed for all Tamagos)

| Trait | Setting | What it means in behavior |
|---|---|---|
| **Calm** | high | Default tempo is slow. Most motion is drift, breath, and arm-curl. Sudden motion is rare and always *motivated* (a tap, a surprise, joy). |
| **Curious** | high | It investigates new things *with an arm first*, then with its eyes, then with its body. Unknown → inspect, never → flee (except rapid tapping). |
| **Self-possessed** | high | It has its own agenda (exploring, grooming, rearranging its den). It is happy when you're there and fine when you aren't. |
| **Gentle** | high | It never shows anger. Its strongest negative display is "overwhelmed, hides for a bit". |
| **Uncanny** | low–medium | Small, deliberate alien notes: horizontal bar pupils, arms that seem to act on their own, occasional total stillness, sometimes more arm tips at the edges than seems possible. *Eerie-cute, never scary.* |
| **Playful** | medium | Plays with motes, pebbles, taps, and crown currents. Doesn't perform for you. |
| **Fond** | grows over time | Expressed through proximity, speed of recognition, warmth of skin color, and owner-only gestures (§6). |

### 1.2 Per-install personality seed

Each install generates a persistent **seed** with small trait offsets, so no two Tamagos are identical.
All values are clamped so every variant still reads as "Tamago".

| Trait offset | Range | Affects |
|---|---|---|
| `boldness` | 0.35–0.75 | tap tolerance, offscreen trip frequency, upside-down hangs |
| `playfulness` | 0.3–0.8 | weight of mote/pebble/crown play |
| `tidiness` | 0.2–0.8 | den rearranging, grooming frequency |
| `nocturnality` | −1 h … +1.5 h | shifts its sleep window |
| `favoriteArm` | 0–7 | which arm does "inspecting" most (a tiny quirk owners notice) |
| `favoriteEdge` | left/right/top/bottom | where it prefers to exit/peek |
| `flushHue` | ±6° around base peach | its personal "happy" color |

### 1.3 Behavioral rules (the constitution)

1. **Always motivated.** Every noticeable action has a readable reason: something moved, it got
   curious, it got tired, you touched it. No random "tricks".
2. **Reaction latency is a feature.** It takes **250–700 ms** to react to a stimulus when awake,
   and **1.5–3 s** when asleep. An instant reaction reads as UI; a slight delay reads as an animal noticing.
3. **Arm first, body later.** New stimulus → one arm reaches or points → eyes follow → body turns → body moves.
4. **Distance is engagement.** Near the glass = attending to you. Mid-water = its own business.
   Offscreen/den = privacy or rest.
5. **Never the same twice.** Every behavior randomizes duration and amplitude (±15%), arm choice,
   and mirroring. No behavior repeats within the last 3 idle picks.
6. **Stillness is allowed.** 20–30% of idle beats are "do nothing but breathe". Constant fidgeting kills believability.
7. **It never asks for anything.** No hunger, no loneliness, no "come back", no attention haptics. Ever.
8. **It never punishes.** No sulking, no decay, no lost progress, no sad face on return.
9. **AI requests always win.** When the owner starts speaking, Tamago drops whatever it's doing
   and arrives within **≤ 0.6 s** (§4.5), even from offscreen or sleep.
10. **Honest about being a creature on a watch.** It doesn't pretend to see the room, know
    your feelings, or have needs. Its "world" is its water.

---

## 2. Idle life

### 2.1 Architecture (engineers: this is the shape of the behavior engine)

Behavior runs in **layers**. Higher layers override lower ones only on the channels they use.

| Layer | Name | Always running while visible? | Examples |
|---|---|---|---|
| L0 | **Life** | yes | breathing, arm-tip noise, pupil micro-drift, faint skin shimmer |
| L1 | **Mood** | yes (slow variables) | energy, arousal, valence, curiosity, familiarity |
| L2 | **Idle behaviors** | when nothing above is active | groom, inspect arm, chase mote, stillness |
| L3 | **Spatial / offscreen** | scheduled trips | exit, peek, tentacle-left-behind, return |
| L4 | **AI state** | during a request | listening, thinking, toolRunning, speaking, reactions |
| L5 | **Reactions** | interrupts, ≤ 3 s | tap flinch, crown current, ink escape |

Priority: **L5 > L4 > L3 > L2**, and L0 never stops. It keeps breathing even while speaking.

**Mood variables (L1)**

| Variable | Range | Baseline | Dynamics |
|---|---|---|---|
| `energy` | 0–1 | circadian curve: 0.25 at 03:00, 0.8 at 10:00–16:00, 0.5 at 21:00 (shifted by `nocturnality`) | −0.05 per 5 min of continuous session, recovers when app not visible |
| `arousal` | 0–1 | 0.2 | spikes on events; exponential decay, half-life **20 s** |
| `valence` | −1…+1 | +0.3 | success/affection raise it; errors/overwhelm lower it; half-life **60 s** back to baseline |
| `curiosity` | 0–1 | 0.3 | +0.02/s while nothing happens (boredom → exploration); reset by an exploration trip or interaction |
| `familiarity` | 0–1 | 0 at install | long-term only (§6); never decays |

**Idle scheduler rules**

- Beat interval: **7–18 s** calm · **4–10 s** aroused · **15–40 s** low energy.
- Each beat, pick from the idle table by weight × mood modifiers, skipping anything on cooldown or
  gated by familiarity. "Stillness" has a base weight equal to ~25% of the total.
- No behavior repeats within the last 3 picks. The same arm is never used twice in a row.
- "Rare" behaviors have per-session caps.
- Every idle behavior must be **interruptible within 150 ms** by L4/L5, blending out over ≤ 250 ms.

### 2.2 Idle behavior catalog (25)

Reuse legend (details in §8): **T** translate · **S** scale/squash · **R** rotate · **D** mesh/spline
deform · **P** procedural arms (no art) · **O** overlay layer (pattern/texture opacity) · **U** unique art needed.

| # | Behavior | Description | Duration | Frequency / cooldown | Mood bias | Build |
|---|---|---|---|---|---|---|
| I-01 | **Mantle breathing** | Mantle inflates 3–4% and deflates; the siphon puffs a tiny bubble every 3rd–5th breath. | cycle 3.6–5.2 s, ±10% jitter per cycle | continuous (L0) | slower when tired (6–8 s asleep) | S, O(bubble) |
| I-02 | **Arm-tip noise** | Each arm's distal third curls/uncurls on its own noise phase. Arms never move in unison. | continuous, 0.1–0.3 Hz per arm | continuous (L0) | amplitude ↑ with arousal | P |
| I-03 | **Pupil micro-drift** | Pupils drift 1–3 px and settle; occasional saccade to a new point. | saccade 60–120 ms | every 1.5–4 s (L0) | more saccades when curious | T |
| I-04 | **Eye squeeze (blink)** | Lower lid rises to cover about 70% of the eye, holds 80 ms, releases. Octopus-style, from below. | 250–350 ms | every 8–25 s; sometimes one eye only | slower when tired | U (lid shape), S |
| I-05 | **Pupil breathing** | Bar pupil widens toward round and back, as if the light changed. | 1.5–3 s | every 30–90 s | — | S (pupil set) |
| I-06 | **Arm inspection** | Lifts `favoriteArm` (70%) or another, curls the tip in front of one eye, looks at the suckers, turns the tip over, lowers it. | 3–5 s | every 2–4 min | curious ↑ | P, T(eyes) |
| I-07 | **Glass taste** | One arm presses flat against the glass *from inside*. Sucker prints appear where it touched and fade over ~20 s. | touch 2–3 s, fade 20 s | every 3–6 min; max 3 prints on screen | familiarity ↑ | P, **U** (sucker-print decal) |
| I-08 | **Skin shimmer** | A faint band of chromatophore speckle travels across the mantle. | 1.2–2 s | every 40–120 s | — | O (speckle texture, masked sweep) |
| I-09 | **Goosebumps** | Papillae rise across the mantle (bumpy silhouette), hold, smooth out. | 0.3 s rise, 1–2 s hold, 0.6 s smooth | every 3–8 min | more when aroused or startled | O (papillae normal/texture) + D (edge bumps) |
| I-10 | **Drift reposition** | Floats to a new resting spot within the window, arms trailing behind (drag). | 2–5 s move, ease-in-out | every 20–60 s | ↑ with energy | T, P (trailing) |
| I-11 | **Settle & spread** | Sinks to the "floor" (lower third) and splays arms flat, mantle slightly flattened. | 2 s in, rests 10–40 s | every 2–5 min | ↑ when energy < 0.5 | T, S, P |
| I-12 | **Full stretch** | All 8 arms extend radially and slowly (the octopus "yawn"), hold, retract with a curl. | 3–4 s | every 5–12 min | ↑↑ when tired / just woke | P, S |
| I-13 | **Grooming** | Arms sweep over the mantle one after another, front to back, like combing. | 4–6 s | every 4–10 min | `tidiness` ↑ | P, O (mantle highlight follows arm) |
| I-14 | **Mote tracking** | A tiny glowing particle drifts through the water. Eyes track it; 40% of the time an arm reaches and misses; 10% it catches it and "tastes" it (the mote winks out). | 3–8 s | every 1–3 min | curious ↑, `playfulness` ↑ | T, P, U (mote sprite, 2 frames) |
| I-15 | **Pebble fiddle** | Rolls a small pebble between arm tips, passes it arm to arm, sometimes drops it and watches it sink. | 5–10 s | every 5–15 min (needs pebble in den inventory) | playful ↑ | P, T/R (pebble), **U** (pebble) |
| I-16 | **Startle jet** | Something unseen: a sudden tiny backward jet (~12% of screen), arms streaming; then a sheepish settle and slow return. *The "occasionally surprising" beat.* | 0.3 s jet, 2 s recovery | rare: 1 per 15–30 min, max 2/session | ↓ with familiarity (it gets more at ease) | T, S (stretch), P (streaming) |
| I-17 | **Dream color** | An unmotivated slow color wash, e.g. two bands of pale peach and lavender cross the body. *"It has an inner life you don't get to read."* | 3–5 s | rare: 1 per 10–20 min | — | O (color gradient masks) |
| I-18 | **Look at you** | Turns to face the glass, pupils widen, holds 1–2 s, then looks away as if satisfied. | 1.5–3 s | every 1–3 min; frequency and hold time ↑ with familiarity | — | T (eyes), R (mantle 5–10°) |
| I-19 | **Upside-down hang** | Climbs to the top edge and hangs by 2 arms, mantle down, rest of arms dangling. Pupils rotate to stay level (it's disoriented-cute). | 6–15 s | rare: 1 per 20–40 min | `boldness` ↑, energy ↑ | R (180°), P, T |
| I-20 | **Arm braid** | Two arms twist around each other, then unwind in the opposite direction. | 2–4 s | every 6–15 min | idle-bored ↑ | P |
| I-21 | **Siphon puff** | A small visible jet of water ripples the particles behind it. | 0.4 s | every 30–90 s (paired with breath) | — | O (particle displacement) |
| I-22 | **The freeze** | Everything stops except breathing. Eyes fixed on a point just past the viewer. Then it resumes as if nothing happened. *Slightly eerie.* | 4–10 s | every 3–6 min | — | none (absence of motion) |
| I-23 | **Tip-walk** | "Walks" along the bottom on arm tips, mantle bobbing, a few steps, then stops. | 3–6 s | every 5–12 min | energy ↑ | P (gait cycle), T |
| I-24 | **Camouflage attempt** | Slowly fades toward the water color until only its eyes and a faint outline remain, holds, returns. Very rare, never while the user is interacting. | 2 s fade, 3–5 s hold, 1.5 s return | 1 per 30–60 min | `boldness` low ↑ | O (body opacity + edge) |
| I-25 | **Den tidying** | (Only when the den is in view.) Moves a pebble or shell a few pixels, looks at it, moves it back. | 4–8 s | every 10–20 min | `tidiness` ↑ | P, T |

**Idle budget sanity:** in a 60 s calm window the viewer should typically see L0 life, 3–5 small
beats (including 1–2 stillness beats), and at most one "noticeable" behavior (I-06/07/12/13/14/15/19/20/23).
If a tester can predict what happens next, add variance.

---

## 3. Offscreen life

### 3.1 The world model

- The screen is a **window** onto a larger water volume. World size = **3 × screen width, 2 × screen height**,
  with the default window centered horizontally and at the lower half.
- **The den:** a dark rocky crevice at the **bottom-left of the default window**, partly visible at
  the edge (a silhouette with depth). It's where it sleeps and keeps up to 3 found objects.
- **Depth layers:** foreground glass (sucker prints, ripples) · creature plane · mid-water particles
  (parallax 0.6) · far water (gradient, parallax 0.2, where shadows can pass).
- **The glow:** a faint warm light seeping in from the **top-right** far water, representing the
  connection to the home Mac. It's there when the gateway is reachable and absent when not (§5, disconnected).

### 3.2 Offscreen state machine

```text
ONSCREEN ─▶ EXITING ─▶ OFFSCREEN{gone | tentacleVisible | peeking | inDen} ─▶ RETURNING ─▶ ONSCREEN
```

- **Trip trigger:** `curiosity > 0.6` and `energy > 0.35`, probability per idle beat 8–15% × `boldness` factor.
  Familiarity *increases* trip frequency. Comfort means it can go about its business; a stranger-Tamago stays and watches you.
- **Trip length while the app is active:** 15–90 s.
- **Sign of life:** while offscreen, a sign of life (peek, arm tip, shadow, ripple) appears every
  **6–15 s**. The window is **never totally empty for more than 12 s** while the app is active,
  except in `inDen` sleep, where the eyes glint in the crevice.
- **Hard recall rules:**
  - Tap anywhere → at least a peek within **≤ 1.2 s**.
  - Crown → it reacts to the "current" and peeks (§4.4).
  - Voice start → it jets back to the glass in **0.4–0.6 s**, from anywhere.
- **Session start:** it's offscreen on open in at most ~30% of cold opens (driven by the life simulation, §7),
  and it shows a peek within **1.5 s** of the app becoming active.

### 3.3 Offscreen behavior catalog (18)

| # | Behavior | Description | Timing | Build |
|---|---|---|---|---|
| O-01 | **Drift exit** | Drifts slowly past an edge (preferring `favoriteEdge`); the arms slide out last, the final arm tip lingers 1–2 s, curls, and is gone. | exit 3–6 s | T, P |
| O-02 | **Tentacle left behind** | Body offscreen; 1–2 arm tips stay visible at an edge, curling idly, sometimes tapping the glass edge. The "it's still here" signature. | 10–40 s | P (arm root pinned offscreen) |
| O-03 | **Peek** | Top of the mantle and one eye slide in from an edge, the pupil finds the viewer, holds 0.5–1.5 s, and it retracts. | 1.5–3 s | T, masked by edge |
| O-04 | **Wrong-edge peek** | Peeks from an edge *different* from the one it left by. This implies a space that wraps around behind the screen. | as O-03 | T |
| O-05 | **Double-take** | Peeks, retracts, then immediately peeks again wider-eyed. | 2–3 s | T, S (pupil) |
| O-06 | **Fly-by** | Jets across the whole window edge to edge (0.6–1.2 s), arms streaming. 1–3 s later it peeks back from the exit edge as if to say "did you see that?". | 0.6–1.2 s + peek | T, S (stretch), P |
| O-07 | **Return with a find** | Re-enters carrying a pebble, shell, or tiny glowing mote. Takes it to the den or turns it over and drops it. | 5–10 s | T, P, U (objects) |
| O-08 | **Ceiling dangle** | Descends from the top edge upside down by 2 arms, eyes rotating to stay level, looks at you, climbs back up. | 4–8 s | R, T, P |
| O-09 | **Periscope** | Only the eyes and the top of the mantle rise above the bottom edge. Watches for 3–10 s, sinks. | 4–12 s | T, masked |
| O-10 | **Outside the glass** | Rare. We see its **underside pressed against the glass**: suckers splayed, mantle blurred beyond. It's exploring *our* side. Slides off. Uncanny highlight. | 4–6 s | **U** (underside pose, suckers) |
| O-11 | **Ink escape** | Response to overwhelm (§4.2). A puff of ink blooms, the creature is gone, and the ink disperses over 3 s. It peeks back after 5–15 s. | ink 3 s | O/U (ink cloud: procedural particles or 8-frame sprite) |
| O-12 | **Den retreat** | Drifts to the den crevice and squeezes in (the body deforms through the gap, which octopuses really do). Only the eyes glint. | squeeze 2–3 s | D (mantle squeeze), T, U (den foreground lip) |
| O-13 | **Shadow pass** | While it's offscreen, a faint, blurred silhouette crosses the far-water layer: it's moving around back there. | 3–5 s | T (blurred copy of base art at low opacity) |
| O-14 | **Knock** | On app open when it's offscreen: an arm tip taps the glass edge twice from outside (tiny ripples), then it enters. | 1–2 s | P, O (ripple) |
| O-15 | **Edge nap** | Sleeps half offscreen: mantle out of view, 3–4 arms trailing into the window, rising and falling with breath. | long | P |
| O-16 | **Too many arms** | Rare, eerie. Arm tips curl in from **three different edges at once**, then all withdraw together. It's only one creature… probably. | 3–4 s; max 1/day | P |
| O-17 | **Glow check** | Offscreen toward the glow (top-right); a faint shape passes in front of the light. Only when connected. | 3–5 s | T, O |
| O-18 | **Follow the crown** | When the owner pans away with the Crown (§4.4), it follows at its own pace and peeks into the new view. | reactive | T |

---

## 4. User interaction

Input vocabulary (final; engineers shouldn't invent more for V1):

| Input | Meaning |
|---|---|
| **Tap** | poke / get its attention |
| **Stroke** (drag across its body) | affection / petting |
| **Talk trigger** | **talk** (starts listening). See below. |
| **Digital Crown** | look around its water (pan the window) |
| Double-tap hardware gesture | optional alternative for talk, *only if* supported on this Watch; verify on device |

**Talk trigger (preferred → fallback):**
1. **Press and hold ≥ 0.45 s anywhere**, *if* the dictation input from D-106 can be presented from a gesture on watchOS 27.
2. Otherwise, a **small, dim shell-shaped control resting at the bottom edge of the water**. It's part of the
   scene, not a UI button: the creature sometimes touches or rests an arm on it. Tapping it summons dictation.
   This control also serves VoiceOver/Switch Control.

Either way, the trigger must be discoverable once (§11). Engineers decide on device and record it in DECISIONS.

### 4.1 Single tap

- **Tap on body:** 250–400 ms latency → flinch. The mantle compresses 8%, a skin ripple radiates from the
  touch point, and papillae spike briefly. It then turns its eyes to the tap point, and 50% of the time
  one arm reaches toward the spot. Valence unchanged, arousal +0.2.
- **Tap on water:** a ripple ring on the glass. It looks at the ripple, and if curious, swims 20–40% of the
  way toward it and inspects with an arm tip.
- **Tap while it's offscreen:** a peek from the nearest edge within 1.2 s (O-03).
- **Tap while asleep:** one eye opens (1.5–3 s latency), looks, and closes again. A second tap within 10 s
  wakes it gently (stretch I-12, then idle). It never startles awake.
- **Familiarity changes (§6):** the flinch shrinks; at "Familiar" and above it may **touch the glass exactly
  where you tapped** from inside (sucker print at the tap point). That's the signature owner gesture.
- Haptic: none by default. At Bonded+, a single `.click` when its arm "meets" your finger.

### 4.2 Repeated taps

| Taps (rolling 3 s window) | Response |
|---|---|
| 2–3 | Increasing interest: approaches the tap point, both eyes on it, a playful arm "catch" attempt. |
| 4–6 | Getting overwhelmed: mantle flattens, papillae up, backs away 15–25%, pupils narrow to slits. |
| 7+ | **Ink escape** (O-11), offscreen 5–15 s, then a cautious peek and a slow return. |

- The overwhelm memory is short: arousal and valence recover on normal half-lives. **No grudge after
  ~60 s. No persistent penalty.**
- The tap tolerance threshold scales with `boldness` and familiarity (+1 tap per familiarity tier).
- At "Bonded", rapid taps become a *game*: it tries to catch each tap point with a different arm,
  then gets dizzy and wobbles rather than inking.

### 4.3 Long interaction session

- **0–3 min continuous:** full liveliness.
- **3–8 min:** energy drifts down. Fewer noticeable idle behaviors and more settling (I-11) and stillness.
  It is *allowed to be boring*.
- **8+ min:** companionable calm. It rests near the glass (familiar) or in mid-water (stranger),
  occasionally looks at you, and may doze into edge nap or den.
- **It never:** asks you to stay, asks you to leave, escalates content to hold attention, or
  rewards session length.
- **Stroke (petting) during a session:** the body "melts": it flattens toward the finger, the skin
  flushes warm from the stroke point, the pupils soften round, and the arms curl loosely. It leans into
  the direction of the stroke. Three or more strokes: it wraps one arm around the stroke point.
  Valence +0.3. There's no haptic (warmth is visual).

### 4.4 Digital Crown

The Crown **looks around the water**, panning the window across the 3×-wide world.

- **Mapping:** rotation pans horizontally with a small vertical parallax. Rubber-band resistance applies at
  world edges. **2.5 s after the Crown stops, the window eases back** to its default position (1.2 s ease-out).
- **Creature reaction:** it notices the view moving (latency 300–600 ms) and follows at its own pace.
  It might peek into the new view (O-18), or, if it was *already* offscreen, the pan may reveal it
  somewhere unexpected. Panning is how owners discover it has a world.
- **Fast spin (current):** above a velocity threshold, the particles stream and its arms sway in the
  "current". It braces with suckers on the floor, then rights itself with a shake-off when the current stops.
  Playful Tamagos may "surf" it. No repeated-spin penalty.
- **Crown haptics:** system default detents off, or the lightest available. The current itself doesn't vibrate.
- **Asleep:** the pan works, and it keeps sleeping (the den may come into view). That respects its rest.

### 4.5 Voice / listening (maps to protocol states; see §5 for full emotional detail)

```text
hold ≥0.45s ─▶ LISTENING ─(release or end of speech)─▶ ACKNOWLEDGING ─▶ THINKING ─(toolRunning?)─▶ SPEAKING ─▶ REACTION ─▶ idle
```

**V1 (system dictation, D-106): the sheet covers the creature while the user speaks.**

| Phase | Timing | Creature | Haptic |
|---|---|---|---|
| Summon | 0–150 ms | Whatever it was doing freezes; pupils snap round. | `.start` on trigger |
| Arrive | 150–500 ms | Jets or drifts to the glass, centered and large (fills ~60% of the width), arms fanning, pupils huge. From offscreen it bursts in. From sleep it wakes in one beat. **Then the dictation sheet opens** (≤ 0.5 s after the trigger, so it never feels laggy). | — |
| (Sheet up) | while talking | Creature hidden by the system UI. When the sheet dismisses, the creature must already be in the **listening pose**, as if it listened the whole time. | — |
| Acknowledge | 250–400 ms after the transcript returns | Mantle squeezes and puffs, pupils flick to bar and back, a small bubble pops. "Got it." | `.click` |
| Cancel | sheet dismissed / empty transcript | Arms relax and it drifts back to mid-water with a small shrug-ripple of the skin. No error state. | — |

**V2 (recorded audio → Mac STT, future protocol v2): the full on-screen listening performance.**

| Phase | Timing | Creature |
|---|---|---|
| Listen | while talking | Arms fan outward "sensing". Arm tips tremble with **mic level**. Skin goes smooth and bright white. Pupils large. Mantle leans forward. |
| Silence prompt | 1.5 s silence while still listening | One arm reaches slightly toward the viewer, an invitation instead of a UI hint. |

### 4.6 Returning after minutes (< 15 min)

- The app resumes where the creature was, advanced by the life simulation (§7). Usually it's the
  same spot or slightly moved.
- **Noticing beat:** 300–600 ms after the app becomes active, it glances at you (I-18 short form).
  At Familiar+, add a quick warm flush (0.8 s).
- If it was mid-behavior when you left, it continues that behavior. **It never snaps to a reset pose.**

### 4.7 Returning after hours (1–12 h)

- The life simulation decides where it is: exploring (offscreen trip in progress), resting in the
  den, asleep (night), or mid-idle somewhere new. Sometimes the den has a new object.
- **Noticing beat:** 0.5–1.5 s. Then it comes toward the glass with a look and a warm flush that
  scales with familiarity.
- **Night rule:** if its life simulation says it's asleep, it **stays asleep**. One eye opens, sees you, and
  closes. Tapping or talking wakes it gently. We never jolt a sleeping creature awake to greet you.

### 4.8 Returning after days (> 24 h)

**Re-acquaintance, never guilt.**

1. It's found in the den or exploring (life simulation).
2. **Noticing beat 1–2 s.** Then it approaches to mid-distance and **extends a single arm to inspect**
   (the real octopus approach behavior). It touches the glass: sucker print.
3. **Recognition:** a big warm bloom (§5 happiness), arms flare into a star, a small hop, and a happy loop of 3–5 s.
4. It *shows you* the den if there's a found object (drifts to it, touches it, looks at you).
5. At Bonded+: recognition is **instant** (no inspection step) and the bloom is bigger.
6. **Explicitly forbidden:** sad poses, thinness/hunger, dust/cobwebs, "I missed you" speech, sulking,
   lower familiarity, a withheld greeting.

---

## 5. Emotional language

### 5.1 Channels (no text bubbles, no human facial expressions)

| Channel | Range | Notes |
|---|---|---|
| **Pupil shape** | round (open, attentive, affectionate) · horizontal bar (neutral/calm, the default) · narrow slit (wary, bright, overwhelmed) · closed line (asleep) | The bar pupil is the alien signature. There are never cartoon "sparkle eyes". |
| **Pupil size** | small ↔ large | Large = interest/affection. Small = wariness. |
| **Eye squeeze** | from below, 0–100% | Contentment = soft 30% squeeze held. Tired = heavy 60%. |
| **Mantle posture** | height (tall/slumped), inflation (puffed/flat), tilt ±15° | Tall + tilt = curious. Flat = overwhelmed or resting. |
| **Arm configuration** | tucked · relaxed · fanned · reaching · curled · star-flared · wrapped | The richest channel. Arms can express different things at once. |
| **Skin color flush** | base warm white; **peach/apricot** (joy, affection); **rose** (excitement); **lavender-grey** bands (thinking); **cool slate** pallor (tired, uncertain, disconnected); **ink blue-black** (escape only) | Flushes are subtle (≤ 35% tint) except the joy bloom (≤ 60%). There's no rainbow and no neon. |
| **Skin pattern** | clear · speckle shimmer · passing clouds · spots flash · mottled | "Passing clouds" is a real cephalopod display, used for thinking. |
| **Texture** | smooth ↔ papillae-bumpy | Smooth = calm/attentive. Bumpy = startled/uncertain. |
| **Locomotion** | drift · jet · tip-walk · squeeze | Jets only for surprise, joy, and overwhelm. |
| **Distance** | glass · mid-water · edge · offscreen · den | Engagement. |
| **Tempo** | slow ↔ quick | Calm is the default. Quickness is an event. |

### 5.2 Emotion definitions

| Emotion | Pupils | Mantle | Arms | Skin | Motion/tempo | Duration |
|---|---|---|---|---|---|---|
| **Curiosity** | bar widening toward round, large | tall, tilted 10–15° toward the object | *one arm* reaches first, others still | smooth, faint speckle | slow approach, pauses | until resolved |
| **Happiness** | round, soft 30% squeeze | gently puffed | loose, tips curling outward | peach flush from center outward, 0.8 s in | small bob, 1–2 slow rolls | 2–4 s, then fades over 3 s |
| **Uncertainty** | bar, gaze shifting between two points | slightly lowered, small tilts left/right | two arms extend partially in different directions, retract | mild papillae prickle, cool tint ≤ 15% | hesitation: starts to move, stops | 1.5–3 s |
| **Thinking** | narrowed bar, gaze up/aside, slow drift | still, slightly drawn back from the glass | 1–2 arms curl and uncurl slowly, "turning something over" | **lavender-grey clouds** passing head→tail, one band every 1.2–1.6 s | minimal; breathing continues | as long as the request |
| **Listening** | round, large, locked on the viewer | leaning forward, close to the glass | fanned, tips trembling with sound | bright, smooth white | still body, lively tips | while the user speaks |
| **Excitement** | round, very large | quick puff-pulses | star-flare, quick flutters | rose flush + spots flash | a hop or jet upward, float down | 1–2 s |
| **Tiredness** | heavy squeeze 60%, slow blinks | slumped, low in the water | limp, trailing, fewer tip curls | cool slate ≤ 20%, desaturated | slow; long stillness; drifts toward den; stretch-yawns (I-12) | mood-driven |
| **Confusion** | asymmetric: one bar, one round; quick darts | tilt one way, then the other | one arm rises and curls into a hook shape (*not* a literal "?"), others tuck | papillae up, brief mottling | a small backward bob | 1.5–2.5 s |
| **Affection / familiarity** | round, soft squeeze, *slow* blinks at the viewer | relaxed, close to the glass | one arm touches the glass toward the viewer; loose curls | warm peach at 15–25%, held | leans toward the finger or center | a moment, never prolonged |

### 5.3 AI protocol states → embodiment

The gateway's `characterState` (docs/PROTOCOL_V1.md §6) maps to the following:

| Protocol state | Embodiment | Notes |
|---|---|---|
| `sleeping` | Curled in the den or an edge nap, pupils as closed lines, breathing 6–8 s, occasional arm-tip dream twitch, rare dream color (I-17). | |
| `idle` | Idle life (§2). | |
| `listening` | §4.5 listen. | |
| `acknowledging` | §4.5 acknowledge. | |
| `thinking` | Thinking row above. **Escalation:** after 4 s, it also picks up and fiddles with a pebble (or an imaginary one). After 10 s, it drifts slightly lower and the cloud bands slow (patient, not stuck). **Never a spinner, dots, or progress ring.** | Latency becomes personality (the Anki lesson). |
| `toolRunning` | **Its arms reach offscreen** (1–3 arms extend past an edge toward the glow, top-right) and tug as if working something out there, while the eyes watch that edge. On completion the arms come back, sometimes with a tiny glint. | This is the best use of offscreen space: the tool happens "out in the world". |
| `speaking` | Near the glass. The mantle pulses gently with the TTS amplitude or word boundaries; the siphon puffs on phrase starts; one or two arms make soft, slow "shaping" gestures; the skin holds a faint warm tone. **No mouth, no lip-sync.** The voice seems to come from the water around it. | See §9 for voice. |
| `happy` | Happiness (§5.2). | |
| `success` | Happiness + a **star-flare bloom** and one slow roll. If a tool ran, the reaching arm returns and curls proudly. | |
| `confused` | Confusion (§5.2), then an arm reaches toward the viewer: "say that again?" | If `followUpExpected`, it stays at the glass in listening-ready posture. |
| `error` | Pales to cool slate, papillae bristle, backs off 10%, then a whole-body **shake-off ripple** and a return to calm within 3 s. Undramatic. | Uses `.failure` haptic (from the response). |
| `disconnected` | It's present but looks toward the top-right where **the glow is missing**. It occasionally drifts to that edge and touches it, and the skin carries a faint cool tint. Otherwise its idle life continues normally. Not sad, not alarming. | When connectivity returns, the glow fades back in and it turns toward it with a curious flush. |

**Answer text:** the answer's `text` appears as a **single caption line at the bottom edge** in
small type. It fades in as speaking starts and fades out 2 s after. It isn't a bubble, isn't attached
to the creature, and isn't a chat log. It's required for accessibility and noisy places. Long answers
scroll *once*, slowly.

---

## 6. Long-term familiarity

### 6.1 Principles

- Familiarity is **earned by presence over days, not by volume**. Tapping 500 times in a day ≈ opening it
  briefly on one day.
- **It never decreases.** Absence only affects the first few seconds of a greeting (§4.8), and even that
  is joyful re-acquaintance.
- **No visible meter, level, number, streak, badge, unlock toast, or notification.** The owner
  should notice changes, not be told about them.
- Nothing about familiarity is ever used to prompt a return.

### 6.2 Accrual

- **Daily presence credit:** a day counts if there were ≥ 2 sessions of ≥ 10 s, *or* 1 voice interaction.
  +1 credit per day, max.
- **Quality bonus:** up to +0.5 credit per day for strokes (affection) and completed voice exchanges. It's capped.
- `familiarity = f(totalCredits)`, a concave curve (fast early, slow later):

| Tier | Credits (≈ days of use) | Name (internal only) |
|---|---|---|
| T0 | 0 | Stranger |
| T1 | 2 | Acquainted |
| T2 | 5 | Familiar |
| T3 | 14 | Bonded |
| T4 | 45 | Kin |

Transitions are **blended over ~2 days** (parameters interpolate), never switched overnight.

### 6.3 What changes (and what never does)

| Aspect | Stranger | Acquainted | Familiar | Bonded | Kin |
|---|---|---|---|---|---|
| Noticing latency on open | 600–900 ms | 500–700 | 400–600 | 300–450 | 250–350 |
| Resting distance | mid-water | mid-water | closer | near the glass | near the glass, sometimes rests *against* it |
| Look-at-you (I-18) frequency | 1/3 min | 1/2.5 min | 1/2 min | 1/1.5 min | 1/min, with slow blinks |
| Tap reaction | flinch + retreat 10% | flinch | small flinch + look | leans toward the tap, sometimes touches the glass there | touches the tap point, `.click` |
| Offscreen trips | rare (watches you) | occasional | normal | normal + returns with finds | normal; sleeps in view more often |
| Stroke reaction | stiffens, then allows | allows | melts | melts + arm wrap | melts + wrap + slow blink |
| Greeting after days | cautious inspect → bloom | inspect → bloom | short inspect → bloom | instant bloom | instant bloom + shows den |
| Owner-only quirks | — | — | quirk 1 appears | quirk 2 | quirk 3 |

**Owner-only quirks** (3 chosen by seed from a pool of ~8; each appears only when the owner is
"present", i.e. app active). Examples:
- A signature arm curl (a specific spiral) when it looks at you.
- Hums a tiny bubble chain (3 bubbles rising in a pattern) after happy moments.
- Rests its mantle on one arm like a chin, but octopus-shaped.
- Swaps its preferred peek edge to the one the owner pans toward most.
- Arranges den objects in a line when the owner visits in the morning.
- Mirrors the owner's crown-pan direction with a lazy arm wave.

**Rhythm learning (gentle):** it tracks the owner's typical open times (hour-of-day histogram, on device
only). Within ±20 min of a usual time, it's slightly more likely to be **near the glass on open**
("happened to be around"). If the owner doesn't come, *nothing happens*. It doesn't wait, sulk, or
notify.

**Never changes:** its temperament, its needs (it has none), and its respect for sleep and for being ignored.

---

## 7. The aliveness illusion (watchOS-honest)

### 7.1 What watchOS will not let us do (and we won't fake)

- **No continuous execution.** The app is suspended when not frontmost and may be terminated at any time.
  There's no background animation. (Only true active sessions such as workouts get extended runtime;
  using one to keep Tamago alive is forbidden by `AGENTS.md` and App Review.)
- **Frontmost duration is user-controlled.** By default a frontmost app returns to the clock face after
  **2 minutes**. The owner can set **"Return to Clock → After 1 hour"** per app. We may *mention* this once in
  help. We never nag.
- **Wrist-down (Always On / reduced luminance):** a frontmost app without an active session can update its
  UI **at most about once per minute**. Apple's guidance is to resolve animations to a **rested state** rather
  than freeze mid-motion. Whether Always On is available and how it behaves on *this* SE 3 must be verified
  on the device.
- **Complications (WidgetKit) don't animate.** They show timeline entries (static snapshots). Reloads are
  budgeted (roughly **40–70/day**, not guaranteed). Background refresh is limited to about **4/hour** and only
  if the app's complication is on the active face. **Tapping the complication opens the app.**
- **No push notifications** from the creature (a design choice, see §10).

### 7.2 Techniques

1. **Deterministic life simulation: `lifeState(at: Date)`**
   - A pure function of `(creatureSeed, date, familiarity, timezone)` returns *what Tamago is doing at that
     moment*: `{activity, location, pose, heldObject}`.
   - The day is divided into seeded activity blocks of 5–40 min: `restingInDen`, `exploringOffscreen`,
     `idleMidWater`, `edgeNap`, `tidyingDen`, `sleeping` (night window: 23:00–07:00 by default, ±`nocturnality`).
   - **No background execution is needed.** On open, the app computes the current block and *starts
     there*. The complication computes the same function for future entries. App and complication always
     agree, and both read as "it's been living".
   - Determinism means that reopening twice within a minute shows consistent continuity, not a
     re-roll. User interactions override the simulation for the rest of that session.
   - *Relation to D-114:* short gaps keep using the engine's bounded catch-up. For long gaps, where D-114
     "resets calmly", this proposes placing the creature at `lifeState(now)` instead, so a long absence
     reads as "it has been living", not "it was reset". It uses the same engine phases (resting/moving/
     peeking/offscreen) as output vocabulary.

2. **Resume in media res + noticing beat**
   - Never open to a centered, reset pose. Open mid-activity (half offscreen, mid-groom, asleep in the den).
   - Then play the **noticing beat** (§4.6–4.8): a delay, then attention shifts to you. This single trick
     sells "it was doing something before you looked" more than anything else.

3. **Traces of absence (bounded)**
   - While you were away, the simulation may have produced small, *non-collectible* changes: a new pebble or
     shell in the den (max 3 objects, the oldest silently replaced), a fading sucker print on the glass, a
     wisp of dissipating ink, particles settling. Objects have **no rarity, no count, no album**.
   - Generated deterministically (seeded by day), so they're consistent between app and complication.

4. **Complication continuity**
   - *Proposal extending D-105:* precompute **a full day of timeline entries** (e.g. every 15–30 min,
     48–96 entries) from `lifeState`. This needs no background refresh: WidgetKit simply advances through
     the entries. D-105's app-driven reload on mood change still applies and overrides pose entries
     (e.g. `offline`). It requires the Phase 6 App Group. Verify on device that watchOS honors multi-entry
     timelines for this complication.
   - Poses: asleep, peeking from an edge, tentacle-only at the edge, looking at you, in the den (eyes glint),
     exploring (empty water with ripples), thinking (only if a request is pending), disconnected (glow absent).
   - Tapping the complication opens the app **in the same pose** (shared via App Group), followed by the
     noticing beat. That continuity is the magic moment.

5. **Wrist-down rest and wrist-up wake (while frontmost)**
   - `isLuminanceReduced == true` → within ≤ 1 s, resolve to a rested pose: settle, eyes 60% squeezed,
     arms relaxed. Dim to the reduced-luminance palette (darker body, no bright flushes). Stop all
     animation timers.
   - Per-minute updates (if the system grants them): advance one tiny thing each minute (an arm curls
     differently, the eyes close a bit more, it drifts a few px toward the den), so a glance at a dimmed
     screen shows something *slightly different*. Five or more minutes down: pupils closed (asleep).
   - Wrist up → a wake beat: a half-second blink, then its attention comes to you. It doesn't restart
     from scratch.

6. **Evidence of a bigger world:** the Crown pan, peeks from unexpected edges, shadow passes, the glow, and
   tool arms reaching offscreen. The world outlives the screen.

7. **Time awareness:** it's sleepier at night and more active mid-day, following the energy curve. It
   notices how long you've been gone (§4.6–4.8).

8. **Performance budget (so the illusion survives battery reality)**
   - Current cap is **~12 fps** (D-102). Design all motion to read at 12 fps: slow eased arcs, amplitude
     over detail, no sub-frame jitter. *Proposal:* raise the cap to 20–30 fps **only** during
     interaction/AI states if SE 3 measurements (frame time, heat, battery) allow; keep calm idle at 12.
     Stop rendering entirely when not visible (already D-102/D-104).
   - The idle scheduler uses the render clock, not free-running timers. No timers survive view disappearance.
   - Procedural arms: ≤ 8 splines × ≤ 12 control points. Verify frame time on the SE 3.

---

## 8. Animation requirements (asset & pose list)

### 8.1 Recommended construction (for the renderer decision owner)

A **2.5D cut-out rig with procedural arms** covers nearly every behavior in this spec:

- **Mantle** (head/body): a single illustrated shape with a shading layer, animated by transform and a
  light mesh/bezier deformation (squash, stretch, lean, squeeze).
- **Eyes:** separate layers (eyeball, iris ring, pupil, lower lid) so every pupil or lid state is a swap
  or scale, not new art.
- **Arms:** **drawn procedurally** as tapered strokes along splines (root on the mantle, tip driven by
  per-arm noise + IK targets + drag/"current" forces, cascading phase offsets). Suckers are small dots
  along the underside, visible when an arm curls. This eliminates hundreds of arm drawings.
- **Skin:** overlay layers masked to the mantle (color flush gradient, speckle texture, cloud-band
  texture, spot pattern, papillae texture), animated by offset and opacity only.

This works with either SwiftUI `Canvas`/`TimelineView` or SpriteKit. The choice belongs to Opus
(DECISIONS.md open item 2). `Apple/Shared/SpriteAnimationClock.swift` still serves the few frame-based
effects (ink, mote, bubble pop).

### 8.2 Unique art required (artist list)

| ID | Asset | Variants / notes | Used by |
|---|---|---|---|
| A-01 | **Mantle, front 3/4** | base + shading + rim light; neutral warm white | everything |
| A-02 | Mantle, profile | for fly-by, tip-walk, left/right mirrored | I-23, O-06 |
| A-03 | Mantle, top-down / squeezed | for den squeeze and outside-glass | O-12, O-10 |
| A-04 | **Underside pose** (outside the glass) | suckers splayed, mantle soft-focused beyond | O-10 |
| A-05 | Eyeball + iris ring | ×2 eyes; faint iridescent ring | all |
| A-06 | **Pupil set** | round, bar, narrow slit, closed line; plus a round→bar morph if the renderer supports it | all |
| A-07 | Lower eyelid | one shape, scaled for 0–100% squeeze | I-04, tiredness, affection |
| A-08 | Arm style guide (not frames) | stroke width profile root→tip, sucker dot style, tip curl reference sheet, 8-arm silhouette references for star-flare / tuck / fan | procedural arms |
| A-09 | Skin overlays | peach flush radial gradient, rose flush, slate pallor, speckle texture, **cloud-band texture** (tileable), spot pattern, papillae texture + bumpy-silhouette edge map | §5 |
| A-10 | Sucker-print decal | 3 variants, soft-edged, for glass taste and the tap-point touch | I-07, §4.1 |
| A-11 | Ink cloud | procedural particles preferred; else an 8-frame sprite | O-11 |
| A-12 | Mote | 2-frame glow flicker | I-14 |
| A-13 | Pebble ×3, shell ×3 | tiny, readable at 40 mm | I-15, O-07, den |
| A-14 | **Den** | background crevice + foreground lip (so the creature can be "inside") | O-12, sleep |
| A-15 | Water | far gradient, mid particles (procedural dots), ripple ring | world |
| A-16 | Glow | soft radial light at the top-right edge | connection |
| A-17 | Bubble | 1 shape + pop frame | I-01, quirks |
| A-18 | **Complication renders** | static poses: asleep, peeking, tentacle-only, looking, den-eyes, empty water, thinking, disconnected. Sizes for circular, corner, rectangular, plus **monochrome/accented-safe silhouettes** and reduced-luminance versions | §7.2.4 |
| A-19 | App icon | original, derived from A-01 | — |

**Art direction constraints:** warm white body, never pure #FFFFFF on OLED black (use about #F3EFE8 with
cool shading); horizontal bar pupils; **no mouth, no eyebrows, no blush circles, no hands**; all 8 arms
are identical in design (character comes from motion). The body is legible at 40 mm (324×394 px),
with the creature at ~35–45% of screen width at rest. Test at arm's length.

### 8.3 Reuse matrix: transform/procedural vs unique art

| Behavior family | T | S | R | D | P | O | Unique art beyond base rig |
|---|---|---|---|---|---|---|---|
| Breathing, blink, pupil states | | ✓ | | | | | none (A-05..07 swaps) |
| Drift, settle, look-at-you, periscope, peeks | ✓ | | ✓ | | ✓ | | none (edge masking) |
| Stretch, groom, braid, inspect, tip-walk | | ✓ | | | ✓ | ✓ | none |
| Startle jet, fly-by, excitement hop | ✓ | ✓ | | | ✓ | | A-02 profile for fly-by |
| Upside-down hang, ceiling dangle | ✓ | | ✓ | | ✓ | | none (pupils counter-rotate) |
| All emotions (§5) | ✓ | ✓ | ✓ | light | ✓ | ✓ | only A-09 overlays |
| Glass taste, tap touch | | | | | ✓ | ✓ | A-10 decal |
| Den squeeze | ✓ | ✓ | | ✓ | ✓ | | A-03, A-14 |
| Outside the glass | | | | | | | **A-04 (unique)** |
| Ink escape | ✓ | | | | | ✓ | A-11 |
| Mote, pebble, finds | ✓ | | ✓ | | ✓ | | A-12, A-13 |
| Camouflage, dream color, shimmer, thinking clouds | | | | | | ✓ | A-09 |
| Tool running (arms offscreen) | | | | | ✓ | | none |
| Complication | | | | | | | **A-18 (unique static renders)** |

**Result:** ~90% of behaviors need no new drawings beyond the base rig and overlays. The genuinely unique
art is the underside pose, profile mantle, den, small props, overlays, and complication renders.

### 8.4 Motion principles for animators

- Ease everything; no linear moves. Water drag: arms lag the body by 80–200 ms, cascading root→tip.
- Squash/stretch ≤ 12% (≤ 25% only for jets).
- Arms never mirror each other exactly. Offset phases by golden-ratio fractions.
- Holds matter: after any noticeable action, hold 0.4–1 s before the next.
- In Reduce Motion: no jets, no fly-bys, no camouflage fades; transitions become cross-dissolves and
  slow drifts. Emotions stay (color and pupils carry them).

---

## 9. Sound + haptics

### 9.1 Principles

- **Haptics are rare and only ever answer the owner's own action.** Zero unsolicited haptics. Zero haptics
  while the app isn't in use. Max **1 haptic per user action**.
- **Sound is off by default** and respects the Watch's silent mode. The sound set is tiny and watery.
  There's no music, no jingles, and no "animalese" gibberish voice.
- The body is the primary channel. Haptics confirm; sound decorates.

### 9.2 Haptic vocabulary (WKHapticType)

| Moment | Haptic | Notes |
|---|---|---|
| Hold threshold reached → listening | `.start` | the only "start" cue |
| Speech captured (acknowledging) | `.click` | |
| Answer ready / speaking begins | none | the voice itself is the cue |
| Response `haptic` field | as sent by the gateway (`success`, `failure`, `notification`, `retry`, `click`, `none`) | protocol-driven, once per response |
| Listening cancelled | none | |
| Tap on body | none (T0–T3); `.click` at Kin when its arm meets your finger | |
| Ink escape | none | the visual says it |
| Crown | system detents off or lightest | no custom |
| Waking it up, greeting, familiarity changes | **none** | never reward-buzz |

### 9.3 Sound set (optional, ≤ 6 samples, each < 400 ms, quiet)

| Sound | When |
|---|---|
| soft **bloop** (low) | listening begins |
| tiny **pop** | acknowledging bubble |
| rising **burble** | success bloom |
| muffled **fizz** | ink escape |
| two soft **taps** | knock (O-14) |
| none | idle life: no idle sounds, ever |

### 9.4 The voice (TTS)

- The owner decided the Watch speaks answers. Use on-device speech synthesis with a consistent voice.
  A slightly slower rate (0.9×) and a slightly raised pitch (1.05–1.15×) can make it feel "from the water"
  without being cartoonish. The final choice is made by ear on the device.
- Drive the speaking animation from synthesis progress callbacks (word boundaries), falling back to a gentle
  periodic pulse if callbacks aren't available.
- The voice never says things the creature wouldn't: the **gateway system prompt** should avoid "As an AI
  assistant…", avoid emotional manipulation, and keep answers to 1–2 spoken sentences (already the direction in
  `Gateway/src/providers/ollama.js`).

---

## 10. Anti-patterns

### Feels like a **chatbot** if…
- A scrolling chat log, message bubbles, "typing…" dots, or a text field on screen.
- It greets with text ("Hi! How can I help you today?") or says "As an AI…".
- It speaks after every interaction, or narrates its own feelings aloud ("I'm so happy to see you!").
- Tapping it opens a menu of options.

### Feels like a **loading screen** if…
- Spinners, progress rings, pulsing dots, or shimmer placeholders during thinking.
- The creature freezes or plays the same 1-second loop while waiting.
- It shows "Thinking…" text, a percentage, or a timeout countdown.
- Latency isn't *performed*: the answer just pops in with no transition.

### Feels like a **cheap Tamagotchi clone** if…
- Hunger, hygiene, happiness, or health meters. Poop. Sickness. Death. Evolution stages chosen by care scores.
- Feeding buttons, a stats screen, levels, XP, coins, a shop, or cosmetic unlocks.
- Pixel-art beeps and 3-frame sprites as the final art.
- A kawaii face with blush circles and a smiling mouth. (See the criticism of Meta's Jolly: toddler-coded
  cuteness reads as infantilizing and as a way to lower users' guard.)

### Feels like an **annoying notification app** if…
- Any creature-initiated notification: "Tamago misses you", "Tamago is hungry", "Come see what Tamago found!".
- Streaks, daily rewards, login calendars, "don't break the chain".
- Haptic taps on the wrist when you're not using it.
- Guilt on return (sad pose, dust, "Where were you?"), or anything on departure (a pleading look, "Don't go"). The
  2025 HBS study found these tactics raise engagement through curiosity and *anger*, not enjoyment.
- Smart Stack or complication content designed to create urgency.

### Feels like a **looping GIF** if…
- The same idle clip repeats at a fixed interval, or you can predict the next action.
- Arms move in unison or in perfect symmetry.
- It always returns to the exact same center pose.
- No reaction latency (it responds within one frame, like a button).
- The app always opens to the same pose, regardless of time or absence.
- Tapping always produces the identical reaction.

---

## 11. First 5 minutes (storyboard)

*Assumes the app is installed and the gateway is configured on the iPhone. First launch ever.*

| Time | Screen | What the owner learns |
|---|---|---|
| 0:00 | Black-blue water, slow particles drifting. The den silhouette at the bottom-left. **No creature.** No text. | "Something lives here." |
| 0:03 | A single white arm tip slides in from the bottom edge, curls, presses the glass. **Sucker prints appear.** It withdraws. | "It's exploring *me*." |
| 0:08 | An eye peeks from the right edge. The bar pupil widens toward round as it finds the viewer. Holds 1.5 s. Retracts. | "It noticed me." (The alien pupil registers.) |
| 0:12 | It drifts in cautiously and stops at mid-water, 40% screen width, arms tucked. The freeze (I-22): perfectly still 4 s, eyes on you. | Slightly uncanny. Curiosity on both sides. |
| 0:20 | Owner taps it. A flinch: skin ripple, papillae spike, retreat 10%. Then *one arm* reaches toward where the finger was. | "It reacts like an animal, not a button." |
| 0:35 | If the owner hasn't discovered the hold gesture, a **single whisper caption** at the bottom edge fades in: "hold to talk". It fades after 4 s. It's shown on first run only (and again once after 3 days if never used). | The only text instruction in the whole experience. |
| 0:45 | Owner uses the talk trigger. `.start` haptic. Tamago *jets* to the glass, fanned arms, huge round pupils. Then the system dictation sheet opens and the owner says "Hi, who are you?". (V1: no mic permission prompt; dictation is a system feature, D-106.) | "It came to listen." |
| 0:52 | The sheet closes onto Tamago still in its listening pose. Pop. The mantle squeezes: `.click`. Lavender clouds roll across its skin; one arm turns something over. | "It's thinking," with no spinner. |
| 0:55 | Speaking: a gentle pulse, a short voice answer, and a one-line caption at the bottom. Then **the first-ever warm peach flush blooms** across its body. | The first time it shows color. That's memorable. |
| 1:10 | It relaxes back to mid-water, shorter hold on the glass. Idle begins: breathing, arm noise, a look back at the owner. | |
| 1:40 | A mote drifts by. Its eyes track it. An arm swipes, misses, and it looks at the arm as if offended. | Personality. |
| 2:15 | Owner turns the Crown: the window pans. The den comes into view, empty. It follows lazily and peeks into the new view. | "Its world is bigger than the screen." |
| 2:45 | It drifts off the left edge. One arm tip lingers, curls, and goes. Water only. 8 s later it peeks from the **top** edge (wrong-edge peek). | "It exists when I can't see it." |
| 3:20 | It returns with a small pebble, takes it to the den, and places it. | Its first possession. |
| 4:00 | Owner lowers their wrist. The screen dims; it settles, eyes squeezing half-shut (if Always On is available on this device). | |
| 4:40 | Owner raises the wrist: it's drifted 10 px toward the den. A blink, a noticing beat, and it looks up. | Continuity. |
| 5:00 | Owner leaves the app. **Nothing happens.** No "come back soon", no notification. | Respect. |

---

## 12. First week

| Day | Familiarity | What subtly changes | What the owner might notice |
|---|---|---|---|
| **Day 1** | Stranger | Watches you a lot, stays mid-water, flinches at taps, rare offscreen trips. First pebble in the den. | "It's shy." |
| **Day 2** | → Acquainted (blending) | The noticing beat is a little quicker. It looks at you slightly more often. The complication shows it asleep at night and peeking in the morning. | Opening from the complication continues the same pose. "It was actually peeking!" |
| **Day 3** | Acquainted | Flinch smaller. First **return with a find** (a shell). Its **favorite arm** becomes visible (it inspects with the same arm most times). | "It always uses that arm." |
| **Day 4** | Acquainted → Familiar | Rests closer to the glass. Takes more offscreen trips (comfortable). First **touch at the tap point** from inside the glass. | "It touched where I touched." |
| **Day 5** | Familiar | **Quirk 1** appears (e.g. the signature spiral curl when it looks at you). The stroke reaction becomes a full melt. | Something only *their* Tamago does. |
| **Day 6** | Familiar | Rhythm learning kicks in: at the owner's usual morning time, it's more often near the glass on open. The greeting after a night away gets a warm flush right away. | "It's like it knew I'd check." |
| **Day 7** | Familiar | Nothing announced. It sometimes dozes in view instead of retreating to the den (trust). If the owner skipped days 5–6, it re-acquaints with a single-arm inspect and then blooms: **no loss, no sadness**. | A creature that feels *theirs*. |

---

## 13. Behavior priority (implementation plan)

Ranked by contribution to believability per engineering hour. Each MUST item should be demoable on the
physical Watch before the next tier starts.

### MUST HAVE (the creature is believable)

1. **Base rig:** mantle + eyes (pupil set, lid) + **procedural arms** with per-arm noise and drag (A-01, A-05..A-08).
2. **L0 life layer:** breathing, arm-tip noise, pupil micro-drift, blink (I-01..I-04), with jitter. Never stops.
3. **Mood variables** (energy/arousal/valence/curiosity) with the stated half-lives + the circadian energy curve.
4. **Idle scheduler** with weights, cooldowns, no-repeat, stillness, and interruptibility. Ship with ~10
   behaviors: I-05, I-06, I-10, I-11, I-12, I-13, I-14, I-18, I-20, I-22.
5. **All protocol states embodied** (§5.3): listening, acknowledging, thinking (with escalation),
   toolRunning (arms offscreen), speaking, happy, success, confused, error, disconnected, sleeping.
   **No loading UI anywhere.**
6. **Talk trigger** (§4 input table; hold-anywhere if dictation can be presented from a gesture, else
   the in-scene shell control) + the summon/arrive beat **before** the dictation sheet and the listening
   pose **after** it (§4.5 V1) + haptics per §9.2 + the answer caption line.
7. **Tap + repeated taps** (§4.1–4.2), including the ink escape (O-11) and its short memory.
8. **Offscreen core:** drift exit (O-01), tentacle left behind (O-02), peek (O-03), wrong-edge peek (O-04),
   plus the "never empty > 12 s" and recall rules.
9. **Resume in media res** + **noticing beat** (§7.2.2) on top of the existing D-114 engine, plus the
   minutes/hours/days return behaviors (§4.6–4.8). **`lifeState(at:)`** for long gaps (§7.2.1) is MUST
   once Opus accepts the proposal; until then, D-114's calm reset followed by the noticing beat.
10. **Reduced-luminance rest pose** + per-minute tiny advance + wrist-up wake beat (§7.2.5). Verify on device.
11. **Complication:** D-105 mood snapshot with octopus poses (asleep / looking / busy-thinking /
    happy bloom / attention / offline, where the glow is absent) + open into the matching pose. The day-long
    `lifeState` pose timeline (§7.2.4) moves to SHOULD until the App Group and device tests exist.
12. **Guardrails as tests/review checklist:** no creature-initiated notifications, no unsolicited haptics,
    no meters, no streaks, no guilt states (§10).
13. **Reduce Motion + VoiceOver:** state descriptions ("Tamago is peeking from the left edge"),
    the accessible talk control.

### SHOULD HAVE (the creature is *someone*)

1. **Familiarity tiers** with blended parameters (§6.3), daily-credit accrual, no decay.
2. **Personality seed** (§1.2), including favorite arm and edge.
3. **Digital Crown world panning** + current reaction + follow (§4.4, O-18).
4. **Stroke/petting** reaction (§4.3).
5. Remaining idle behaviors: I-07 (with sucker decals), I-08, I-09, I-15, I-16, I-17, I-19, I-21, I-23, I-25.
6. Offscreen: O-05, O-06, O-07, O-08, O-09, O-12, O-13, O-14, O-15.
7. **The den** with up to 3 found objects + bounded traces of absence (§7.2.3).
8. **The glow** as the connectivity indicator + disconnected embodiment tied to it.
9. Owner-only quirks (3 per seed).
10. Optional sound set (§9.3), default off.
11. TTS tuning + word-boundary-driven speaking pulse.
12. Day-long `lifeState` pose timeline for the complication (§7.2.4), after the Phase 6 App Group.

### EXPERIMENTAL (prototype on device; keep only if it's clearly better and cheap on battery)

1. **Gravity-level pupils:** pupils stay horizontal as the wrist tilts, using device motion. It's a very
   octopus, very uncanny detail. Measure the battery cost; active app only.
2. **Mic-reactive arm tremble** while listening. Only possible with the V2 recorded-audio path (D-106);
   not possible with V1 system dictation.
3. **Too many arms** (O-16), **outside the glass** (O-10), **camouflage** (I-24): the eerie tier. Tune so it's never scary.
4. **Rhythm learning** (usual open times → near-the-glass bias).
5. Rapid-tap "catch game" at Bonded.
6. **Double-tap hardware gesture** as a talk alternative, only if the SE 3 supports it for third-party apps (verify).
7. Smart Stack widget with *relevance* limited to non-urgent contexts (e.g. morning), never urgency.

### LATER

1. Tamago reacting to **Mac-side events** (e.g. the gateway reports that a home service restarted, so the creature's
   arms return from offscreen holding a glint). This needs a protocol extension (v1.x, additive).
2. Seasonal or daylight-aware water color (sunrise/sunset tint from local time).
3. iPhone companion view of the den (read-only, no management UI).
4. Dedicated "charm" Watch mode (strapless second Watch): larger creature, longer Return-to-Clock guidance,
   no wrist assumptions. Never bypasses the passcode or wrist detection.
5. Cellular/remote presence (after the TLS/remote security design).
6. Multiple creature variants (color morphs) as a *seed*, never as purchasable cosmetics.

---

## Appendix A. State & persistence the engine needs (for Opus)

The data is tiny, persisted via App Group so the complication can read it:

| Field | Type | Notes |
|---|---|---|
| `creatureSeed` | UInt64 | generated at install; drives personality + life simulation |
| `familiarityCredits` | Double | §6.2; never decreases |
| `lastCreditDay` | date (local day) | one credit per day |
| `lastSeenAt` | Date | for §4.6–4.8 |
| `lastPose` | small enum + position | resume in media res; complication tap continuity |
| `denObjects` | [ObjectKind] max 3 | traces of absence |
| `openHourHistogram` | [UInt16] × 24 | rhythm learning; on device only, never sent to the gateway |
| `hintsShown` | bitset | "hold to talk" whisper |

Nothing here is sent to the Mac gateway. The creature's inner life is local.

## Appendix B. Checklist for reviewers (Codex / owner)

- [ ] Open the app 10 times across a day: it never opens to the same reset pose.
- [ ] Idle for 3 minutes: you can't predict the next behavior, and there are periods of stillness.
- [ ] Start talking from offscreen, from asleep, and mid-behavior: it arrives in ≤ 0.6 s.
- [ ] No spinner, dots, or progress UI exists anywhere in the app.
- [ ] No notification, haptic, or sound ever occurs without an owner action.
- [ ] Return after 2+ days: joyful re-acquaintance, nothing sad.
- [ ] Complication pose → tap → the app opens in the same pose, then the noticing beat.
- [ ] Wrist down: rests within 1 s; wrist up: wake beat, not a restart. (DEVICE_VERIFIED required.)
- [ ] Reduce Motion on: still expressive, no jets or fly-bys.

---

## Sources

- Meta Muse / Muse Charm / Jolly: [TechCrunch: Meta made a Tamagotchi-like wearable for its Muse AI agent](https://techcrunch.com/2026/09/23/meta-made-a-tamagotchi-like-wearable-for-its-muse-ai-agent/) ·
  [TechCrunch: Everything new coming to Muse](https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/) ·
  [TechCrunch: Muse Charm taps a newer trend](https://techcrunch.com/2026/09/24/metas-muse-charm-looks-like-a-tamagotchi-but-its-tapping-into-a-much-newer-trend/) ·
  [Techlicious](https://www.techlicious.com/blog/meta-muse-charm-tamagotchi-ai-wearable/) ·
  [NBC News](https://www.nbcnews.com/tech/tech-news/meta-muse-ai-agent-response-animated-avatar-cute-rcna599736) ·
  [The Gadgeteer](https://the-gadgeteer.com/2026/09/24/meta-muse-charm-ai-assistant-keychain/) ·
  [Dezeen](https://www.dezeen.com/2026/09/25/meta-debuts-tamagotchi-style-ai-agent/) ·
  [Axios](https://www.axios.com/2026/09/25/ai-doom-meta-muse-mascot) ·
  [Creative Bloq (critique)](https://www.creativebloq.com/ai/metas-new-ai-avatar-is-making-me-feel-infantilised) ·
  [Meta AI Research: Bringing Your Muse to Life](https://research.meta.ai/blog/bringing-your-muse-to-life) ·
  [Meta Connect 2026 announcements](https://www.meta.com/blog/meta-connect-2026-everything-we-announced/) ·
  [SSBCrack: childlike design controversy](https://news.ssbcrack.com/metas-new-ai-mascot-jolly-sparks-controversy-over-childlike-design/)
- Anki: [Design News: From Cozmo to Vector](https://www.designnews.com/testing-measurement/from-cozmo-to-vector-how-anki-designs-robots-with-emotional-intelligence) ·
  [Vector character design guide](https://randym32.github.io/Anki.Vector.Documentation/guides/Vector%20character%20design%20guide.html) ·
  [Kickstarter: Animating Vector](https://medium.com/kickstarter/animating-the-future-meet-the-cartoonists-giving-life-to-ankis-adorable-robot-vector-1def073de502)
- [Neko Atsume (Wikipedia)](https://en.wikipedia.org/wiki/Neko_Atsume) · [Kill Screen on Neko Atsume](https://killscreen.com/articles/cats-finally-take-over-the-world-with-mobile-game-neko-atsume)
- Casio Moflin: [designboom](https://www.designboom.com/technology/casio-ai-pet-robot-moflin-10-15-2024/) · [Casio](https://www.casio.com/us/moflin/)
- Manipulation research: [De Freitas et al., Emotional Manipulation by AI Companions (arXiv 2508.19258)](https://arxiv.org/pdf/2508.19258) ·
  [CHI 2025: Dark Side of AI Companionship taxonomy](https://dl.acm.org/doi/10.1145/3706598.3713429)
- Octopus biology: [Scientific American: The Mind of an Octopus](https://www.scientificamerican.com/article/the-mind-of-an-octopus/) ·
  [Two Oceans Aquarium: color and shape change](https://www.aquarium.co.za/news/how-does-an-octopus-change-its-colour-and-shape) ·
  [OctoNation: anatomy](https://octonation.com/octopus-anatomy/) ·
  [ScienceDaily: do octopus arms have a mind of their own?](https://www.sciencedaily.com/releases/2020/11/201102120027.htm)
- watchOS: [Apple: Designing your app for the Always On state](https://developer.apple.com/documentation/watchkit/designing_your_app_for_the_always_on_state) ·
  [Apple: Updating watchOS apps with timelines](https://developer.apple.com/documentation/watchos-apps/updating-watchos-apps-with-timelines) ·
  [WWDC21: What's new in watchOS 8](https://developer.apple.com/videos/play/wwdc2021/10002/) ·
  [WWDC22 notes: Complications and widgets reloaded](https://wwdcnotes.com/documentation/wwdcnotes/wwdc22-10050-complications-and-widgets-reloaded/) ·
  [iPhoneLife: Return to Clock](https://www.iphonelife.com/content/how-to-customize-return-to-clock-face-app-apple-watch)
- Procedural/idle animation: [Alan Zucconi: Introduction to Procedural Animations](https://www.alanzucconi.com/2017/04/17/procedural-animations/) ·
  [MoCap Online: Idle animation design guide](https://mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide) ·
  [Wikipedia: Secondary animation](https://en.wikipedia.org/wiki/Secondary_animation)

*Research note:* several articles (Dezeen, Axios, Creative Bloq) were blocked by this environment's
network policy. Their content is referenced via search-result summaries, not full reads.
