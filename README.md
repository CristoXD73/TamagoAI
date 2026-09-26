# TamagoAI

A Tamagotchi-style AI companion that lives on your Apple Watch.

<p align="center">
  <img src="docs/assets/tamagoai-hero.webp" alt="TamagoAI white octopus companion inhabiting an Apple Watch" width="640">
</p>

<p align="center"><strong>A living AI companion for Apple Watch.</strong></p>

---

> Status: **Phase 3 foundation.** Protocol, mock gateway, fixtures, docs, and a
> compiled Xcode project (placeholder Watch app, complication, iPhone companion,
> shared Swift package with passing tests) exist. Nothing has run on a physical
> Apple Watch. See [`docs/HANDOFF_LOG.md`](docs/HANDOFF_LOG.md).

## How it works

**The animated character is the interface.** The Watch is the face (animation,
touch, Digital Crown, mic, speaker, haptics, complication). A Mac mini at home
is the brain (local AI, tools, automation).

```text
 idle ─tap─▶ listening ─▶ thinking ─▶ (Mac gateway → local AI → tools) ─▶ speaking ─▶ reaction ─▶ idle
```

## Documentation

- [Creature specification](docs/CREATURE_SPEC.md) — behavior, personality, mood
- [Architecture](docs/ARCHITECTURE.md) ([diagram](docs/TAMAGO_ARCHITECTURE.md))
- [Decisions](docs/DECISIONS.md) — the running architecture decision log
- [Visual approval gate](docs/VISUAL_APPROVAL_GATE.md) — how character motion gets approved
- [Development guide](docs/DEVELOPMENT.md) — environment setup, commands
- [Handoff log](docs/HANDOFF_LOG.md) — latest task-by-task status
- [Protocol v1](docs/PROTOCOL_V1.md) — the Watch ⇄ Mac contract

## Layout

```text
AGENTS.md / CLAUDE.md     rules for every coding agent (read first)
THIRD_PARTY_NOTICES.md    MIT notices for adapted upstream code
docs/                     brief, architecture, decisions, protocol, reuse, tests, logs
  handoff/                original multi-agent handoff pack (historical, "TamaWatch")
Apple/
  AppleTamago.xcodeproj   Watch app, complication, iPhone companion, tests (D-101)
  Shared/                 local Swift package TamagoShared (protocol + sprite timing) + tests
  WatchApp/ iPhoneApp/ Complication/   placeholder sources
  Config/                 Tamago.xcconfig (placeholder identity)
Gateway/                  Mac gateway (Node ≥22, no dependencies)
  src/ test/ mock/ scripts/
Tests/Fixtures/protocol-v1/   JSON fixtures shared by gateway + Swift tests
scripts/smoke.sh          curl smoke test
```

## Quick start (gateway)

```sh
cd Gateway
npm test
TAMAGO_ALLOW_NO_AUTH=1 npm start      # http://127.0.0.1:8787, mock provider
curl -s localhost:8787/v1/health
curl -s localhost:8787/v1/request -H 'content-type: application/json' \
  -d '{"protocolVersion":1,"requestId":"3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c","inputType":"text","text":"state happy"}'
```

Mock commands are listed in `Gateway/mock/README.md`. The protocol is in `docs/PROTOCOL_V1.md`.

## Principles

Local AI first. No private APIs. No fake background modes. No secrets in Git.
No passcode bypass or wrist spoofing. Physical-device evidence beats assumptions.
