# Visual Approval Gate (character motion)

**Owner rule, effective 2026-09-26.** Binding for every agent (see `AGENTS.md` §7).

No new **user-visible character** animation, movement pattern, expression, transition, pose or
interaction behavior goes from written spec straight into production code.

```text
IDEA → VISUAL PROTOTYPE → HUMAN REVIEW → REVISION (if needed) → APPROVAL
     → PRODUCTION IMPLEMENTATION → SIMULATOR COMPARISON (against the approved prototype)
```

## What counts as a visual prototype

An animated GIF, a short MP4, a storyboard/contact sheet, or a keyframe sequence, whichever communicates the
motion best. It must use the **approved character art** (`Assets/CharacterReference/`) at **Apple Watch SE 3
40 mm scale** (324 × 394 device px) on the black full-bleed world. Prototypes live in
`docs/prototypes/<batch>/`. The preview rig is `tools/previz/`.

## Gated vs exempt

| Gated (needs approval first) | Exempt (engineering-only) |
|---|---|
| New or changed creature animation, pose, expression, timing, transition | Safe-area / full-bleed rendering fixes |
| New movement pattern (wander, exits, peeks…) | Networking, protocol, gateway |
| New interaction reaction (tap, Crown, voice embodiment) | Performance, memory, battery work that keeps visuals identical |
| Changing which art/pose a state uses | Tests, CI, build/signing |
| Visible UI chrome on the character screen | **Removing** debug UI, labels, page dots, cards |

If unsure, treat it as gated.

## Status labels (per animation)

`IDEA` → `PROTOTYPE_READY_FOR_REVIEW` → `REVISION_REQUESTED` → `APPROVED` → `IN_PRODUCTION` →
`SIMULATOR_MATCHED` (→ `DEVICE_VERIFIED` only with owner evidence in `DEVICE_TEST_LOG.md`).

Only the **owner** can set `APPROVED`. An agent may never infer approval from silence, from another agent,
or from the prototype having been committed.

## After approval

The approving note is recorded in the register below. Then an engineering handoff is written using the
template in `ANIMATION_PROTOTYPE_PLAN.md` §6. The implementation is accepted only after a simulator capture
is compared side by side with the approved prototype, and the owner signs off.

## Register

| ID | Animation | Prototype | Status | Owner note |
|---|---|---|---|---|
| 01 | Breathing Idle | storyboard `animation-v1/storyboards/sb01` | PROTOTYPE_READY_FOR_REVIEW | |
| 02 | Eyes-First Curiosity | storyboard `sb02` | PROTOTYPE_READY_FOR_REVIEW | |
| 03 | Tentacle-First Exploration | storyboard `sb03` | PROTOTYPE_READY_FOR_REVIEW | |
| 04 | Slow Wander | storyboard `sb04` | PROTOTYPE_READY_FOR_REVIEW | |
| 05 | Edge Inspection (first motion test) | **MP4 + GIF** `animation-v1/05_edge_inspection/` + `sb05` | PROTOTYPE_READY_FOR_REVIEW | |
| 06 | Full Exit | storyboard `sb06` | PROTOTYPE_READY_FOR_REVIEW | |
| 07 | Peek Return | storyboard `sb07` | PROTOTYPE_READY_FOR_REVIEW | |
| 08 | Wrong-Edge Return | storyboard `sb08` | PROTOTYPE_READY_FOR_REVIEW | |
| 09 | Touch Reaction | storyboard `sb09` | PROTOTYPE_READY_FOR_REVIEW | |
| 10 | Glass Moment | storyboard `sb10` | PROTOTYPE_READY_FOR_REVIEW | |
| 11 | Hero float (approved art, ±2.5 pt bob, ~4.8 s) | none needed: owner's explicit instruction, 2026-09-27 | **APPROVED (owner direction)** | "use a high quality picture of my octopus suspended in that black and give it a light floating up and down animation where it barely moves" (D-119). Replaces the procedural creature on screen for now. |
| 12 | Front idle loop (Codex 2D cutout animation, 10 s: float, breathing, sway, arm waves) | `docs/prototypes/idle-front-v1/` | **APPROVED (owner direction)** | "heres an idle animation its a 2d image animation, make sure to change our mascot for this" (2026-09-27, D-124). Replaces #11 on the Watch and the iPhone app. |
| 13 | Waiting signs: B three dots under the tentacles, D ripples from the head (owner picks in Settings) | preview page (4 options, 2026-09-27) | **APPROVED (owner direction)** | "B and D keep both and we will make it so you can pick" (D-126). |
| 14 | Pixel hero, three takes: A faithful, B chibi mascot, C hero with a face and a wave (brand character, still art) | `docs/prototypes/pixel-hero-v1/` | **A APPROVED** (B, C not chosen) | Owner, 2026-09-29: "Lets go with A keep it in our assets." Master in `Assets/Brand/pixel-hero/`. |
| 15 | Other universes: sticker, foam, shipping cardboard (brand still art) | `docs/prototypes/universes-v1/` | PROTOTYPE_READY_FOR_REVIEW | Owner, 2026-09-29: "imagine our main octopus reimagined in different universes … a sticker … made of foam … made of brown shipping cardboard box". |
| 16 | Owner's universe set: neon, ink, stone and moss, velvet, sprout, metal, x-ray, cardboard (brand still art) | `Assets/Brand/universes/` | **APPROVED (owner-provided)** | "Add this to our assets collection", then "These too" (2026-09-29). Creator and licence still to be recorded by the owner before public use. |
| 17 | Startup sequence: the eight universes flick faster and faster, land on the hero, idle float begins (with sound) | `docs/prototypes/startup-v1/` | PROTOTYPE_READY_FOR_REVIEW | Owner, 2026-09-29: "do a motion design where they all transform … until it becomes our original hero … Show me v1". |

Existing Stage A character behavior (D-114) predates this gate. It stays as is and isn't expanded until the
replacement animations are approved. Engineering-only fixes to it remain allowed.
