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

Existing Stage A character behavior (D-114) predates this gate. It stays as is and isn't expanded until the
replacement animations are approved. Engineering-only fixes to it remain allowed.
