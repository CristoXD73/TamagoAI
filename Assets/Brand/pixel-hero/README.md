# Tamago pixel hero (approved)

Approved by the owner, 2026-09-29: "Lets go with A keep it in our assets" (VISUAL_APPROVAL_GATE #14; prototype and
the two alternatives in `docs/prototypes/pixel-hero-v1/`).

- `tamago-pixel-hero.png`: 53 × 74, transparent, the master. Scale only by whole numbers with nearest-neighbour
  (`.interpolation(.none)` in SwiftUI, `image-rendering: pixelated` on the web).
- `@2x`, `@3x`, `@4x`, `@10x`: the same, pre-scaled.

Made by `tools/pixel/pixel_hero.py` (`faithful(crisp_eyes=True)`) from the approved front render. Palette in the
prototype's PROTOTYPE.md.
