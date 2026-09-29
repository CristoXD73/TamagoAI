# Pixel hero v1: three takes (awaiting the owner)

Made by Claude Code, 2026-09-29, for the owner's brand character request: "make my octopus an
anthropomorphic brand character. We are gonna need a bunch of designs to use in different parts of the app.
Lets start with a pixel version of the hero … make three versions." Status: **A APPROVED** by the owner, 2026-09-29 ("Lets go with A keep it in our assets"); B and C not chosen
(VISUAL_APPROVAL_GATE #14). The master is in `Assets/Brand/pixel-hero/`. Still art; nothing is in the app.

| | What | Size (1×) | Anthropomorphic touches |
|---|---|---|---|
| **A Faithful** | The approved front render (`idle-front-v1`), reduced to pixels on a 13-colour pearl palette, outlined, eyes redrawn crisp | 53 × 74 | none: the octopus as approved |
| **B Mascot** | Chibi brand character: big head, big lidded glossy eyes, blush, closed smile, four stubby curling arms, one raised in a "hi" | 38 × 38 | face, blush, smile, a hand-like wave |
| **C Hero** | The approved art at 96 px, made a character: larger glossy eyes with catchlights, a small smile, a touch of blush, and the right arm raised in a wave | 82 × 102 | expressive eyes, smile, blush, a wave |

Files:
- `A-faithful.png`, `B-mascot.png`, `C-hero.png`: the real assets, 1×, transparent.
- `*@10x.png`: the same, enlarged for looking at.
- `review-dark.png`, `review-light.png`: the three together, on the app's dark background and on light.

Made by `tools/pixel/pixel_hero.py`, deterministic. B's shapes are drawn procedurally (lit ellipse head, tapering
tentacle tubes that curl at the tip). A and C start from the approved render. Eyes follow CREATURE_SPEC: glossy
dark spheres with a heavy upper lid, no pupil shape.

Palette: outline `#1E1E34`; pearl `#FFFFFF #F3EEEA #DED5D1 #BEB2B6 #8E8294`; sucker peach `#F8CCB6 #DA9E8A`; eye
`#0D0F19 #3A405C`; blush `#F69EA0`; mouth `#603648`.
