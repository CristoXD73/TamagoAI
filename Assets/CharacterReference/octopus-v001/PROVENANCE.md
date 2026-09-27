# TamagoAI octopus — approved visual references (v001)

Provided by the project owner on 2026-09-26 as the **approved visual identity** of TamagoAI.
These images are visual ground truth: do not redesign, humanize, or restyle the character.

| File | Content |
|---|---|
| `ref_hero_q34.jpg` | 495×793, black background: hero 3/4 view (character facing screen-left) |
| `ref_turnaround_4view.webp` | 1983×793, black background: front, 3/4, near-profile, back |
| `ref_turnaround_14view_alpha.webp` | 2000×667 **with alpha**: 8-view turnaround + high front, high 3/4, underside, low 3/4, two crawl/spread poses |

- **Creator / tool / license:** _to be recorded by the owner_ (required before any public release,
  per `docs/UPSTREAM_REUSE.md` and `docs/CHARACTER_ASSET_PIPELINE.md`).
- These are **references**, not runtime assets. Don't import them into the Watch asset catalog. Production
  frames follow `docs/CHARACTER_ASSET_PIPELINE.md` and the art gap report in `docs/ANIMATION_PROTOTYPE_PLAN.md` §5.
- `tools/previz/` crops and warps these images **for preview only**.
- **App icon exception (owner, 2026-09-27):** the owner supplied `ref_hero_q34.jpg` as the app icon. The
  art is unchanged: it's only scaled and centered on a black 1024×1024 square
  (`Apple/iPhoneApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png`, `Apple/WatchApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png`;
  the Watch version is smaller so the whole octopus fits inside the circular mask). A final, purpose-drawn
  icon can replace these later.
