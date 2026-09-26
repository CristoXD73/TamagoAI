# TamagoAI

A Tamagotchi-style AI companion that lives on your Apple Watch.

<p align="center">
  <img src="docs/assets/tamagoai-hero.webp" alt="TamagoAI white octopus companion inhabiting an Apple Watch" width="640">
</p>

<p align="center"><strong>A living AI companion for Apple Watch.</strong></p>

---

## What it is

TamagoAI isn't a chatbot squeezed onto a tiny screen. A small white
octopus-like creature lives on the watch face — it wanders, notices a tap,
glances around, and sometimes drifts off the edge of the display before
peeking back in. The character *is* the interface: no chat bubbles, no
loading spinners, no status bar. Talking to the AI behind it is meant to feel
like reaching for something that's already there, not opening an app.

## How it works

The Watch is the face; a Mac at home is the brain.

```text
 idle ─tap─▶ listening ─▶ thinking ─▶ (Mac gateway → local AI → tools) ─▶ speaking ─▶ reaction ─▶ idle
```

The Apple Watch owns the character, touch, Digital Crown, mic, speaker,
haptics and complication. A Mac on the same network runs a small local
gateway that talks to a local AI provider — nothing is sent to a third-party
cloud AI service.

## Current status

**Experimental, pre-hardware.** What's real today:

- **Mac gateway** — request/response protocol, request IDs, timeouts,
  duplicate-request protection, bearer-token auth, and a provider abstraction
  (deterministic mock + an Ollama adapter for local models). 66 passing tests.
- **Watch app** — the character's state machine, its autonomous idle
  behavior (wandering, edge peeks, blinking, touch reactions), and a real
  HTTP client wired to that state machine's existing effect contract. 122
  passing Swift tests (host + watchOS simulator).
- **The Watch ↔ Mac loop is real**, not just documented: a debug-only
  harness drives an actual request through to the gateway's mock provider and
  back, observed round-trip in the simulator. There is no production
  voice-input trigger yet — see [Roadmap](#roadmap).
- **Full-bleed display** — the creature's stage correctly spans the entire
  Apple Watch SE 3 (40 mm) display (162×197 pt), not a smaller inset region.

**Nothing here has been verified on a physical Apple Watch.** Every claim
above is `SIMULATOR_VERIFIED_ONLY` or `UNIT_TESTED_ONLY` — see
[`AGENTS.md`](AGENTS.md) for what those labels mean and
[`docs/HANDOFF_LOG.md`](docs/HANDOFF_LOG.md) for the latest task-by-task
detail.

## Architecture

A pure Swift state machine (`CharacterStateMachine`) owns what the character
is doing; a separate, independent engine drives its autonomous idle-life
movement. Neither talks to the network directly — they emit effects that a
thin platform layer executes (HTTP request, haptic, speech). The Mac gateway
is a dependency-free Node service in front of a swappable AI provider. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the
[visual diagram](docs/TAMAGO_ARCHITECTURE.md) for the full picture, and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for why it's built this way.

## Character & interaction philosophy

TamagoAI is not Siri with an octopus skin, and it is not a virtual pet with
stats to manage. Its behavior — how it moves, when it reacts, what it sounds
like — follows a written spec ([`docs/CREATURE_SPEC.md`](docs/CREATURE_SPEC.md))
and an approval process: no new user-visible animation or interaction ships
without an approved visual prototype first
([Visual Approval Gate](docs/VISUAL_APPROVAL_GATE.md)). The approved
character reference art is the visual ground truth for everything the
creature looks like.

## Development

```sh
# Mac gateway — no dependencies, mock AI provider built in
cd Gateway && npm test
TAMAGO_ALLOW_NO_AUTH=1 npm start      # http://127.0.0.1:8787

# Shared Swift package — pure logic, runs on the host, no simulator needed
swift test --package-path Apple/Shared --scratch-path .build/spm
```

Full Xcode/watchOS setup, building the Watch target, and testing the live
Watch ↔ Mac loop end-to-end are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). Mock provider commands are
listed in [`Gateway/mock/README.md`](Gateway/mock/README.md).

## Documentation

- [Creature specification](docs/CREATURE_SPEC.md) — behavior, personality, mood
- [Architecture](docs/ARCHITECTURE.md) ([diagram](docs/TAMAGO_ARCHITECTURE.md))
- [Decisions](docs/DECISIONS.md) — the running architecture decision log
- [Visual approval gate](docs/VISUAL_APPROVAL_GATE.md) — how character motion gets approved
- [Development guide](docs/DEVELOPMENT.md) — environment setup, commands
- [Handoff log](docs/HANDOFF_LOG.md) — latest task-by-task status
- [Agent worklog](docs/AGENT_WORKLOG.md) — cross-agent audit trail
- [Protocol v1](docs/PROTOCOL_V1.md) — the Watch ⇄ Mac contract

## Roadmap

Roughly in order: verification on a physical Apple Watch; a real voice-input
trigger for the character (behind the Visual Approval Gate); owner-approved
speech and creature-sound output; final character artwork replacing the
current procedural placeholder; Bonjour/local-network discovery so the Watch
doesn't need a manually configured Mac address.

## Contributing & experimental status

TamagoAI is a personal, experimental project built openly with AI coding
agents under the owner's direction — see [`AGENTS.md`](AGENTS.md) for the
rules every agent (human or AI) follows here. It isn't accepting outside
contributions yet.

## Layout

```text
AGENTS.md / CLAUDE.md     rules for every coding agent (read first)
THIRD_PARTY_NOTICES.md    MIT notices for adapted upstream code
docs/                     brief, architecture, decisions, protocol, reuse, tests, logs
  handoff/                original multi-agent handoff pack (historical, "TamaWatch")
Apple/
  AppleTamago.xcodeproj   Watch app, complication, iPhone companion, tests (D-101)
  Shared/                 local Swift package TamagoShared (protocol, sprite timing, transport) + tests
  WatchApp/ iPhoneApp/ Complication/   placeholder sources
  Config/                 Tamago.xcconfig (placeholder identity)
Gateway/                  Mac gateway (Node ≥22, no dependencies)
  src/ test/ mock/ scripts/
Tests/Fixtures/protocol-v1/   JSON fixtures shared by gateway + Swift tests
scripts/smoke.sh          curl smoke test
```

## Principles

Local AI first. No private APIs. No fake background modes. No secrets in Git.
No passcode bypass or wrist spoofing. Physical-device evidence beats assumptions.
