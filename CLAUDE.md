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
| `Apple/Shared/` | Local Swift package `TamagoShared`: protocol models + sprite timing engine, tests in `Tests/`. | `UNIT_TESTED_ONLY` (host + watchOS simulator) |
| `Apple/AppleTamago.xcodeproj` | Targets `TamagoWatch`, `TamagoComplication`, `TamagoPhone`, `TamagoTests` (D-101). | builds: `SIMULATOR_VERIFIED_ONLY` |
| `Apple/WatchApp`, `Apple/iPhoneApp`, `Apple/Complication` | Placeholder sources (synchronized folders). | Watch launch: `SIMULATOR_VERIFIED_ONLY` |
| `Apple/Config/Tamago.xcconfig` | Placeholder bundle prefix, empty team; real values go in git-ignored `Local.xcconfig`. | n/a |
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

# Apple (from the repo root, local Mac with Xcode 27 only)
cd Apple/Shared && swift test --scratch-path ../../.build/spm          # host, fastest
cd Apple && xcodebuild test -project AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../.build/DerivedData                                # SE 3 40 mm
```

## Claude-specific reminders

- Cloud sessions have **no Xcode or Swift toolchain**. Don't claim Swift compiles.
- Don't edit `Apple/AppleTamago.xcodeproj` in the cloud. Adding Swift files to the
  synchronized folders needs no project edit.
- Keep `-derivedDataPath` under the repo's `.build/` (external volume).
- Premium Xcode time is scarce. Spend it on Apple-platform problems, not boilerplate.
- Before finishing, update `docs/HANDOFF_LOG.md`.
