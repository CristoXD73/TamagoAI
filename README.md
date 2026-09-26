# Apple Tamago

A Tamagotchi-style AI companion for Apple Watch. **The animated character is the
interface.** The Watch is the face (animation, touch, Digital Crown, mic,
speaker, haptics, complication). A Mac mini at home is the brain (local AI,
tools, automation).

```text
 idle ─tap─▶ listening ─▶ thinking ─▶ (Mac gateway → local AI → tools) ─▶ speaking ─▶ reaction ─▶ idle
```

> Status: **Phase 1 foundation.** Protocol, mock gateway, fixtures, and docs
> exist. The Watch app does not exist yet. Nothing here has run on an Apple
> Watch. See `docs/HANDOFF_LOG.md`.

## Layout

```text
AGENTS.md / CLAUDE.md     rules for every coding agent (read first)
THIRD_PARTY_NOTICES.md    MIT notices for adapted upstream code
docs/                     brief, architecture, decisions, protocol, reuse, tests, logs
  handoff/                original multi-agent handoff pack (historical, "TamaWatch")
Apple/
  Shared/                 Swift protocol models + sprite timing engine (not compiled yet)
  WatchApp/ iPhoneApp/ Complication/   placeholders, created locally in Xcode
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
