<div align="center">

# TamagoAI

### A little AI that lives on your wrist.

Your Watch gives it a face. Your Mac gives it a brain.

![watchOS](https://img.shields.io/badge/watchOS-27+-black?logo=apple)
![Swift](https://img.shields.io/badge/Swift-SwiftUI-orange?logo=swift)
![Local AI](https://img.shields.io/badge/AI-local--first-blueviolet)
![Status](https://img.shields.io/badge/status-growing-yellow)

</div>

## Meet TamagoAI

TamagoAI isn't a chatbot squeezed onto a tiny screen. It's a small presence that lives on your Apple Watch.

It wanders. It watches. It reacts when you reach for it. Sometimes it swims out of sight and comes back somewhere else. The goal is simple: make interacting with AI feel a little less like opening software and a little more like having something there with you.

> TamagoAI is still growing. The Watch app, local gateway and core behavior system are already running in development. The final octopus artwork and real-Watch validation are coming next.

## It feels alive

The character is the interface.

There isn't meant to be a dashboard between you and TamagoAI. The creature itself tells you what it's doing through movement, expression, sound and haptics.

It can quietly float around the screen, notice a tap, look somewhere new, disappear beyond the edge of the display and peek back in later. Its behavior is intentionally a little unpredictable — but never random enough to feel broken.

**Right now we're teaching it how to move. Next, we give it its final body.**

## Small Watch. Bigger brain.

The Apple Watch handles the part you see and touch: the character, microphone, speaker, Digital Crown, haptics and complication.

A Mac at home can handle the heavier work: local AI, memory, tools and automations.

```text
      Apple Watch                         Mac

   TamagoAI's face   ←────────→   TamagoAI's brain
   touch · voice                  local AI · tools
   motion · haptics               memory · automation
```

That split lets the Watch stay lightweight while giving the companion room to become much more capable over time.

## TamagoAI in motion

**Visuals are coming next.** This section will become the living part of the project page: short simulator clips, GIFs of TamagoAI wandering and peeking, the final octopus artwork, and eventually the companion running on a real Apple Watch.

<!-- Stable media paths live under docs/media/. -->

### Wander

TamagoAI doesn't have to sit politely in the center of the screen. It has a world position and can explore the entire display.

### Disappear

It can swim or crawl completely out of view, stay away for a moment, then return from another edge.

### Notice you

Touch interrupts its little routine without wiping its personality. Repeated interaction can get a stronger response before it settles back into whatever it was doing.

### Think

Listening, thinking, speaking and reacting are character states — not loading screens.

## Built local-first

TamagoAI is designed so the heavier intelligence can live on hardware you control rather than forcing the Watch to behave like a tiny AI server.

The current architecture keeps the Watch experience separate from the AI provider. That means the character can keep evolving while the model, tools and local gateway evolve independently.

```text
Apple Watch
    │
    │  Tamago protocol
    ▼
Local gateway
    │
    ├── local AI
    ├── memory
    ├── tools
    └── automations
```

## Where it is today

TamagoAI is under active development, not a finished release.

The project currently has a working watchOS/iPhone Xcode project, Watch complication, shared Swift package, local Node gateway, protocol fixtures and automated tests. The development line has passed **93 Swift tests** and **66 gateway tests**, and the Watch target builds and runs through the Apple Watch SE 3 simulator workflow.

Physical Apple Watch testing is tracked separately so simulator success is never presented as real-device proof.

## For developers

The friendly face sits on top of a deliberately boring foundation. Behavior is separated from rendering, protocol behavior is deterministic, provider failures are contained by the gateway, and the final character artwork can be replaced without rebuilding its movement brain.

```text
Apple/
  AppleTamago.xcodeproj     Watch + iPhone project
  WatchApp/                 the creature you see
  Shared/                   state, protocol and reusable logic
  Complication/             glanceable Watch presence

Gateway/                    local Mac bridge
Tests/                      shared protocol fixtures
docs/                       architecture, decisions and engineering log
```

### Run the local gateway

Node.js 22 or newer:

```sh
cd Gateway
npm test
TAMAGO_ALLOW_NO_AUTH=1 npm start
```

Then:

```sh
curl -s localhost:8787/v1/health
```

The no-auth mode is for local development only. Normal startup requires authentication.

## Under the hood

If you want the engineering details rather than the tour:

- `docs/MASTER_BRIEF.md` — the product and architecture
- `docs/PROTOCOL_V1.md` — Watch ↔ gateway protocol
- `docs/DECISIONS.md` — decisions and trade-offs
- `docs/HANDOFF_LOG.md` — what has actually been built and verified
- `docs/UPSTREAM_REUSE.md` — upstream review and reuse
- `THIRD_PARTY_NOTICES.md` — attribution and licenses

## What's next

**Give it life.** Finish autonomous movement, touch reactions, offscreen behavior and the final octopus animation pipeline.

**Put it on the Watch.** Complete physical-device pairing and tune performance, battery use and haptics on real hardware.

**Give it a voice.** Connect richer voice interaction, local models, memory and tools.

**Let it grow.** Keep expanding what TamagoAI can do without turning the Watch experience into another menu-filled app.

## Made to keep changing

TamagoAI's look isn't locked. Screenshots, GIFs, character art and this page will change with the companion itself. Public media lives under `docs/media/` with stable filenames so we can keep replacing the visuals without rebuilding the documentation around them.

## Credits

TamagoAI contains adapted sprite frame-timing work from **WatchPet** under the MIT License. Exact provenance is documented in `THIRD_PARTY_NOTICES.md` and `docs/UPSTREAM_REUSE.md`. No WatchPet or Codex artwork is included.

---

<div align="center">

### TamagoAI

**A tiny presence with somewhere much bigger to grow.**

Apple Watch · watchOS · SwiftUI · local AI · AI companion · Tamagotchi

</div>
