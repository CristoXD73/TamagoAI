# Developing TamagoAI

Read [AGENTS.md](../AGENTS.md), [MASTER_BRIEF.md](MASTER_BRIEF.md), the latest
[HANDOFF_LOG.md](HANDOFF_LOG.md) entry and [DECISIONS.md](DECISIONS.md) first.
Work within the assigned stage. Coordinate with the character/UI owner before
editing their active files. Existing names `Tamago` / `AppleTamago` remain the
code/project identifiers; this guide does not rename them.

## Prerequisites and map

Use the repository's recorded Xcode 27 / watchOS 27 simulator environment and
Swift tools ≥6.2; see [LOCAL_ENVIRONMENT.md](LOCAL_ENVIRONMENT.md) for exact
validated versions. Full Xcode is needed for Apple targets. Use Node ≥22 per
D-002 (the current package manifest has a looser ≥20 floor). The Gateway has no
third-party npm dependencies. `ffmpeg` is optional for media; no automatic
software installation is required. Simulator work needs no signing changes.

| Path | Purpose |
|---|---|
| `Apple/WatchApp/` | Watch presentation and interaction |
| `Apple/Shared/` | Pure shared Swift models, timing and tests |
| `Apple/iPhoneApp/`, `Apple/Complication/` | Companion and WidgetKit sources |
| `Apple/AppleTamago.xcodeproj` | Existing shared schemes and targets |
| `Gateway/` | Node gateway, mock/local adapters and tests |
| `Tests/Fixtures/protocol-v1/` | Cross-language protocol fixtures |
| `Assets/` | Character originals, approved exports and references |
| `docs/media/` | Final reviewed documentation media |
| `docs/` | Decisions, protocol, acceptance and evidence logs |

## Tests (repository root)

```sh
swift test --package-path Apple/Shared --scratch-path .build/spm -Xswiftc -warnings-as-errors
npm test --prefix Gateway
```

These are **UNIT_TESTED_ONLY** when they pass; they do not verify UI, hardware,
or a real Ollama engine. Host tests read repository fixtures in place. Report
unrelated failures without changing production code to conceal them. During
parallel work choose a unique ignored scratch path, e.g. `.build/support-spm`,
to avoid another agent's build lock.

## Build and launch a Watch simulator

Commands below are a recipe (**UNVERIFIED** by this support pass), not a claim
of a new simulator run. Select an available Watch UDID instead of copying a
machine-specific ID from old logs. Do not interrupt a simulator another agent
is using.

```sh
xcodebuild -version
xcrun simctl list devices available
export TAMAGO_SIM_UDID='REPLACE_WITH_WATCH_SIMULATOR_UDID'
xcodebuild build -project Apple/AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination "platform=watchOS Simulator,id=$TAMAGO_SIM_UDID" \
  -derivedDataPath .build/DerivedData
```

Open Simulator, boot the selected device if it is currently shut down, then
wait for boot. Skip `boot` for an already booted device:

```sh
open -a Simulator
xcrun simctl boot "$TAMAGO_SIM_UDID"
xcrun simctl bootstatus "$TAMAGO_SIM_UDID" -b
xcrun simctl install "$TAMAGO_SIM_UDID" .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app
export TAMAGO_SIM_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app/Info.plist)"
xcrun simctl launch "$TAMAGO_SIM_UDID" "$TAMAGO_SIM_BUNDLE_ID"
```

The bundle ID is read locally from the build, never changed or published. For
the scheme's existing simulator tests:

```sh
xcodebuild test -project Apple/AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination "platform=watchOS Simulator,id=$TAMAGO_SIM_UDID" \
  -derivedDataPath .build/DerivedData
```

If CoreSimulator is unavailable in a restricted session, report that limitation;
do not change signing, provisioning, targets or deployment settings. Physical
deployment is a separate owner-led task.

## Testing the Watch ↔ Mac loop (D-115)

The Watch app now has a real HTTP client (`Apple/Shared/GatewayTransport.swift`,
`Apple/WatchApp/TamagoConnection.swift`) that executes
`CharacterStateMachine`'s `sendRequest`/`cancelRequest` effects against a real
gateway — see D-115. There is no production voice-input trigger yet (that
needs its own approved visual prototype per the Visual Approval Gate), so the
proof path is the DEBUG-only harness:

```sh
# Terminal 1 — start the gateway with the deterministic mock provider
cd Gateway && TAMAGO_ALLOW_NO_AUTH=1 npm start

# Terminal 2 — build, install, launch on a booted Watch simulator
# (the simulator reaches the gateway via 127.0.0.1, which only works from the
# simulator — a physical Watch needs TAMAGO_GATEWAY_URL set to the Mac's LAN
# address instead)
xcodebuild -scheme TamagoWatch -configuration Debug \
  -destination "id=$TAMAGO_SIM_UDID" -derivedDataPath .build/DerivedData build
xcrun simctl install "$TAMAGO_SIM_UDID" .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app
xcrun simctl launch "$TAMAGO_SIM_UDID" "$TAMAGO_SIM_BUNDLE_ID"
```

On the Watch, open the Debug tab (swipe from the character screen) → "Live
gateway" section → tap any command (`ping`, `state happy`, …). The gateway's
own log line and the Watch's "Transport diagnostics" section should show the
same request ID and a real round-trip time. `Gateway/src/providers/mock.js`
documents every command the mock provider understands.

## Assets, protocol and evidence

Follow [CHARACTER_ASSET_PIPELINE.md](CHARACTER_ASSET_PIPELINE.md) for source and
processed art, including the future Watch asset-catalog import. Follow
[MEDIA_CAPTURE_GUIDE.md](MEDIA_CAPTURE_GUIDE.md) for demos. No final art is supplied
by this support pass. The compact [architecture diagram](TAMAGO_ARCHITECTURE.md)
is ready for later README embedding.

[PROTOCOL_V1.md](PROTOCOL_V1.md) is the wire contract. Protocol changes require
both language definitions and regenerated fixtures (`npm run fixtures --prefix
Gateway`) together; ordinary documentation changes do not require regeneration.

**SIMULATOR_VERIFIED_ONLY** means built and observed in Simulator, not hardware.
**DEVICE_VERIFIED** requires a human observation on the physical Watch/iPhone
recorded in [DEVICE_TEST_LOG.md](DEVICE_TEST_LOG.md). Compilation alone establishes
neither. Use all five labels precisely as defined in [AGENTS.md](../AGENTS.md).
Append exact commands, outcomes, untested scope and one bounded next task to the
handoff log after meaningful work. Never infer physical behavior from a GIF.
