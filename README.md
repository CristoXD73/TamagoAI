<div align="center">

# TamagoAI

### A living local-AI companion for Apple Watch

**The character is the interface.** TamagoAI turns an Apple Watch into the face of a small autonomous AI creature, while a Mac at home provides the local brain, tools, and automation.

![watchOS](https://img.shields.io/badge/watchOS-27+-black?logo=apple)
![Swift](https://img.shields.io/badge/Swift-SwiftUI-orange?logo=swift)
![Local AI](https://img.shields.io/badge/AI-local--first-blueviolet)
![Status](https://img.shields.io/badge/status-active%20development-yellow)

</div>

> **Active development:** the protocol, gateway, Watch/iPhone project, complication, simulator path, signing and automated tests are working. The final octopus artwork and physical-Watch validation are still in progress.

## What is TamagoAI?

TamagoAI is a Tamagotchi-inspired AI companion designed around a simple idea: **instead of opening an AI app, the AI appears to live on your wrist.**

The Apple Watch handles the creature's presence — animation, touch, Digital Crown, microphone, speaker, haptics and complications. A Mac mini can provide the heavier local-AI inference, tools and automation without trying to run a full model on the Watch.

```text
                  ┌──────────────────────────────┐
                  │          Mac mini            │
                  │  Local AI · tools · gateway  │
                  └──────────────┬───────────────┘
                                 │
                          Protocol V1
                                 │
                  ┌──────────────▼───────────────┐
                  │        Apple Watch           │
                  │   TamagoAI's face + senses   │
                  └──────────────────────────────┘

 idle → listening → thinking → speaking → reaction → idle
```

## The creature

TamagoAI is being designed as an octopus-like AI companion with organic, slightly alien behavior rather than a static mascot. The character system is being separated into behavior, world movement, expression and rendering so final artwork can evolve without rewriting its brain.

Planned/active character behaviors include:

- autonomous wandering and quiet idle life
- blinking, looking, breathing and subtle organic motion
- reacting to touch without abandoning autonomous behavior
- swimming/crawling beyond the Watch display
- disappearing offscreen and returning later
- peeking through any edge of the display
- state-driven expressions for listening, thinking, speaking and reactions

## Visual preview

> **Coming next:** simulator captures, final octopus renders and short GIFs of TamagoAI wandering, peeking and reacting. These will be updated as the character art evolves.

<!-- Future media lives under docs/media/ so README links remain stable. -->

## Architecture

| Layer | Responsibility |
| --- | --- |
| **TamagoWatch** | watchOS UI, character, interaction, haptics and device experience |
| **TamagoComplication** | WidgetKit complication surface |
| **TamagoPhone** | iPhone companion and Watch integration |
| **TamagoShared** | Swift protocol models, character state and reusable logic |
| **Gateway** | Small Node.js bridge between the Apple clients and AI provider |
| **Local AI** | Mac-hosted model/provider and future tool execution |

The wire protocol is intentionally independent of the character renderer. A provider failure, timeout or duplicate request is handled by the gateway rather than leaking provider internals into the Watch experience.

## Repository layout

```text
AGENTS.md / CLAUDE.md       agent/development rules
docs/                       architecture, protocol, decisions and handoff log
Apple/
  AppleTamago.xcodeproj     Watch app, complication, iPhone companion + tests
  Shared/                   TamagoShared Swift package + tests
  WatchApp/                 Watch experience and character renderer
  iPhoneApp/                iPhone companion
  Complication/             WidgetKit complication
  Config/                   project configuration
Gateway/                    Node.js local gateway
Tests/Fixtures/protocol-v1/ shared protocol fixtures
scripts/                    smoke/integration helpers
```

## Current verification

The current development line has been verified with:

- **93/93 Swift tests passing** on the host and Apple Watch SE 3 40 mm simulator
- **66/66 Gateway tests passing**
- successful generic signed builds for the Watch and iPhone targets
- simulator build/install path for watchOS 27
- deterministic protocol fixtures shared between Swift and the gateway
- request IDs, timeout handling, duplicate-request suppression and sanitized errors
- logs designed not to contain the user's text

Physical Apple Watch validation remains intentionally separate from simulator/build verification.

## Local gateway quick start

Requires Node.js 22 or newer.

```sh
cd Gateway
npm test
TAMAGO_ALLOW_NO_AUTH=1 npm start
```

Then, from another shell:

```sh
curl -s localhost:8787/v1/health
```

The no-auth mode is deliberately restricted to local development. Normal gateway startup requires authentication.

## Development philosophy

- **Local-first AI.** Keep the expensive intelligence at home when practical.
- **Character-first UX.** The companion itself is the interface, not decoration around conventional app chrome.
- **Watch-aware engineering.** Battery, GPU/CPU cost and lifecycle constraints matter.
- **Deterministic foundations.** Protocol behavior and character logic should be testable even when the visible behavior feels spontaneous.
- **No private-API tricks.** Work with watchOS rather than pretending its lifecycle limitations do not exist.
- **No secrets in Git.** Credentials stay out of the repository and logs.
- **Evidence over assumptions.** Simulator, signed-build and physical-device results are labeled separately.

## Documentation

Start here if you are exploring or contributing:

- `docs/MASTER_BRIEF.md` — product and architecture brief
- `docs/PROTOCOL_V1.md` — Watch ↔ gateway protocol
- `docs/DECISIONS.md` — architectural decisions and trade-offs
- `docs/UPSTREAM_REUSE.md` — upstream review/reuse record
- `docs/HANDOFF_LOG.md` — chronological engineering handoffs and verification
- `THIRD_PARTY_NOTICES.md` — third-party attribution and licenses

## Roadmap

**Now:** living-character behavior, simulator iteration, final octopus asset pipeline and physical Apple Watch pairing/validation.

**Next:** richer touch/voice interaction, WatchConnectivity, local provider integration, TTS/haptics, complication behavior and real-device performance/battery tuning.

**Later:** deeper local tools and automations while preserving a lightweight Watch client.

## Media & project page

The README is intentionally designed to evolve with the product. Screenshots, GIFs, architecture visuals and final character artwork will live under a stable `docs/media/` structure so the project page can be refreshed continuously without turning documentation into a one-off launch artifact.

## Credits

TamagoAI contains adapted sprite frame-timing work from **WatchPet** under the MIT License. See `THIRD_PARTY_NOTICES.md` and `docs/UPSTREAM_REUSE.md` for exact provenance. No WatchPet or Codex artwork is included.

---

<div align="center">

**TamagoAI — a tiny AI presence that lives on your wrist.**

`Apple Watch` · `watchOS` · `SwiftUI` · `local AI` · `AI companion` · `Tamagotchi` · `Ollama-ready architecture`

</div>
