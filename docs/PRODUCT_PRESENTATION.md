# Product presentation — how TamagoAI shows itself

**Mandatory reading** (AGENTS.md) before changing the README, a website, a
landing page, or any public presentation of TamagoAI. Approved by the owner,
2026-09-26.

## The rule in one line

**Visual first. Personality first. Engineering second.** The repository's first
screen is a product reveal, not a developer manual.

## Principles

1. **Product landing experience before developer manual.** A stranger should
   meet the creature before they meet the build commands.
2. **Visual-first.** Large imagery carries the page. The approved hero leads,
   big and centered, with nothing crowding it.
3. **Sparse copy.** Short lines, with room around them. If a sentence can go,
   it goes. No walls of text, no feature bullet storms, no badge rows.
4. **Personality before architecture.** Say what it *is* and how it *feels*
   (curious, quiet, occasionally somewhere else) before how it's built.
5. **Motion only where the owner approved it.** Nothing in
   `docs/prototypes/` is final behavior until the
   [Visual Approval Gate](VISUAL_APPROVAL_GATE.md) register says `APPROVED`.
   If a prototype appears on a public page, label it as a prototype in plain words.
6. **Technical credibility stays, below the story.** Status, architecture,
   tests, development and roadmap remain complete and honest (verification
   labels included), under a clear "Building it" break.
7. **Never regress into a generic open-source template.** Don't open with
   installation steps, don't lead with badges, don't write generic AI marketing,
   and don't define TamagoAI mainly through another product ("a Tamagotchi-style…").

## Voice

- Core line: **"A little intelligence with a life of its own."**
- Positioning: **"TamagoAI is a living AI companion for Apple Watch. The Watch
  is its body. Your Mac is its brain."**
- Calm, specific, slightly wry. Never hype, never "revolutionary," never
  "your AI assistant."

## Assets

| Asset | Status | Use |
|---|---|---|
| `docs/assets/tamagoai-hero.webp` | **Owner-approved hero.** Use unchanged: no crop, recolor, overlay or regeneration. | The opening image. |
| `Assets/CharacterReference/octopus-v001/*` | **Owner-approved** character reference art (D-010) | Character sections. Don't restyle it. |
| `docs/prototypes/animation-v1/*` | `PROTOTYPE_READY_FOR_REVIEW`, **not approved** | Only with an explicit prototype label. |
| Architecture diagram (Mermaid) | Technical | The "body / brain" section, kept small and clean. |

Don't create new character art or animation for presentation purposes.

## Reference, not a source

Editorial product-launch pacing, such as Meta's presentation of Muse Charm, is
a **reference for rhythm only**: big visual, one line, breathing room, next beat.
Never copy its wording, artwork, branding, layout assets or any proprietary
material. We want the philosophy, not a clone.

## Verifying a presentation change

Markdown that parses isn't a page that works. After any change:

- check every relative asset path exists, with case-sensitive filenames;
- look at the actual rendered GitHub page (desktop width at minimum);
- if you can't view it, say **RENDERED GITHUB PAGE NOT VERIFIED** in your worklog entry.
