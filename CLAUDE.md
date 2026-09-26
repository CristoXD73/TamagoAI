# CLAUDE.md — Apple Tamago

**Read `AGENTS.md` first. Its rules are binding for Claude too.** This file only
adds Claude-specific notes.

## Orientation (read in order)

1. `AGENTS.md`: rules, prohibitions, verification labels
2. `docs/MASTER_BRIEF.md`: what we're building and who does what
3. Latest entry in `docs/HANDOFF_LOG.md`: where the last agent stopped
4. `docs/DECISIONS.md`: architecture decisions (Opus owns the Apple-side ones)
5. `docs/PROTOCOL_V1.md`: the Watch ⇄ Mac contract
6. Your role's section in `docs/handoff/TamaWatch_COMPLETE_HANDOFF.md`

## Repository map

| Path | What | Verified how |
|---|---|---|
| `Gateway/` | Node ≥22 Mac gateway, zero dependencies. `npm test`, `npm start`. | `UNIT_TESTED_ONLY` (CI + cloud) |
| `Tests/Fixtures/protocol-v1/` | JSON fixtures shared by gateway and Swift tests. Gateway ones are generated from the live mock (`npm run fixtures`). | drift-checked by gateway tests |
| `Apple/Shared/` | Pure-Foundation Swift: protocol models + sprite timing engine. | `UNVERIFIED` (never compiled) |
| `Apple/WatchApp`, `Apple/iPhoneApp`, `Apple/Complication` | Empty. Targets are created locally in Xcode by the architect. | n/a |
| `docs/` | Brief, architecture, decisions, protocol, reuse, tests, logs. | n/a |
| `scripts/smoke.sh` | curl smoke test against a running gateway. | manual |

## Commands

```sh
cd Gateway
npm test                               # all gateway tests, no network or Ollama needed
npm run fixtures                       # regenerate gateway-derived fixtures after protocol changes
TAMAGO_ALLOW_NO_AUTH=1 npm start       # loopback-only dev server on :8787
TAMAGO_TOKEN=$(openssl rand -hex 24) TAMAGO_HOST=0.0.0.0 npm start   # LAN, for a physical Watch
../scripts/smoke.sh                    # in another terminal
```

## Claude-specific reminders

- Cloud sessions have **no Xcode or Swift toolchain**. Don't claim Swift compiles.
- Don't generate an `.xcodeproj` in the cloud. The local architect owns targets.
- Premium Xcode time is scarce. Spend it on Apple-platform problems, not boilerplate.
- Before finishing, update `docs/HANDOFF_LOG.md`.
