# Handoff Log

One entry per agent task, newest at the bottom. Copy the template.

<details><summary>Entry template</summary>

```text
### YYYY-MM-DD HH:MM: <Agent>: <one-line task>
Branch:
Commit(s):
Files changed:
Upstream source reused: None | repo, file, commit, license, local destination
Tests run (exact commands):
Passed:
Failed:
Physical-device evidence (+ label):
Unverified:
Known risks:
Next recommended task (ONE bounded step):
Do not redo:
```
</details>

---

### 2026-09-26: Claude Code Cloud: Phase 1 repository foundation

**Branch:** `claude/great-volta-ogpuw8`

**Commit:** `77ed46e3c582ca0d87ab53bf7d3f4cd691f4fdcb` (foundation). This log entry lands in the commit right after it.

**Starting state:** the repo `faucet-repo` had a single commit containing a one-line
`README.md`. Replaced entirely. Project renamed to **Apple Tamago** per the owner
(the GitHub repo name itself is unchanged; the owner can rename it in settings).

**Files created**
- Root: `README.md`, `AGENTS.md`, `CLAUDE.md`, `THIRD_PARTY_NOTICES.md`, `.gitignore`
- `docs/`: `MASTER_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PROTOCOL_V1.md`,
  `UPSTREAM_REUSE.md`, `ACCEPTANCE_TESTS.md`, `DEVICE_TEST_LOG.md`, `HANDOFF_LOG.md`,
  `handoff/TamaWatch_COMPLETE_HANDOFF.md` (owner's original pack, verbatim)
- `Gateway/`: `package.json`, `.env.example`, `src/{protocol,server,config,cli}.js`,
  `src/providers/{provider,mock,ollama}.js`, `test/*.test.js` (6 files) + helpers,
  `scripts/generate-fixtures.js`, `mock/README.md`
- `Tests/Fixtures/protocol-v1/`: `manifest.json`, 5 request fixtures, 12
  gateway response fixtures, 4 client-synthesized fixtures
- `Apple/Shared/TamagoProtocolV1.swift`, `Apple/Shared/SpriteAnimationClock.swift`,
  README placeholders for `Apple/{WatchApp,iPhoneApp,Complication}`
- `scripts/smoke.sh`, `.github/workflows/gateway.yml`

**Upstream source reused**
- WatchPet: https://github.com/lkuczborski/WatchPet @ `d52a77a1d15374b1443a46e26ddba11920d3b894`, MIT.
  `WatchPet/Views/PetAvatarView.swift` (sprite timing engine) **adapted** into
  `Apple/Shared/SpriteAnimationClock.swift`. Attribution is in the file header and `THIRD_PARTY_NOTICES.md`.
- Q007: https://github.com/chris-jk/Q007 @ `d422082ed1f419eef01ea15fd8d8266367410b24`, MIT.
  Reviewed only. **No code copied.**
- No artwork from either project. Full matrix: `docs/UPSTREAM_REUSE.md`.

**Tests run**
```sh
cd Gateway && npm test                 # node --test, Node v22.22.2
cd Gateway && npm run fixtures         # regenerated fixtures, then re-ran npm test
TAMAGO_TOKEN=… TAMAGO_PORT=18787 node src/cli.js  &  scripts/smoke.sh   # real process + curl
node src/cli.js                        # without token → refuses to start (exit 1)
TAMAGO_ALLOW_NO_AUTH=1 TAMAGO_HOST=0.0.0.0 node src/cli.js   # → refuses (exit 1)
git grep for keys/tokens/team IDs/private IPs   # none found
```

**Passed** (`UNIT_TESTED_ONLY`, 66/66): protocol parsing and normalization,
request-ID validation and echo (body + `X-Request-Id`), malformed JSON, schema
violations, unsupported protocol version, auth missing/wrong/wrong-scheme, the
MockProvider's deterministic outputs, provider exception (message not leaked),
provider unavailable, out-of-contract provider output rejected, timeout
(including a provider that ignores abort), duplicate requestId → one provider
call, 413/404/405, logs contain IDs but not user text, config safety, the Ollama
adapter against a stubbed fetch, every fixture valid, and gateway fixtures identical to live mock output.
Smoke test against the real CLI process: health, protocol, ping, state happy, tool jellyfin, state error (502).

**Failed:** none outstanding. One test bug was found and fixed during the session
(a default parameter masked `undefined`). It was not a gateway defect.

**Impossible in Cloud (therefore UNVERIFIED)**
- Any Swift compilation. There's no toolchain, and download.swift.org is blocked by the proxy.
  Both `Apple/Shared/*.swift` files are **never compiled**.
- Xcode, simulator, signing, physical Watch/iPhone, WatchConnectivity,
  Always-On / reduced luminance, complication, voice, TTS, haptics.
- `OllamaProvider` against real Ollama: `UNVERIFIED_LOCAL_PROVIDER`.
- Gateway on the owner's Mac mini and reachability from the Watch over the LAN.
- GitHub Actions workflow: written but hasn't run yet (it runs on push to GitHub).

**Known risks**
- Plain HTTP on the LAN. watchOS ATS / local-network behavior for `http://<mac>.local`
  is unknown for watchOS 27 and must be decided and tested (DECISIONS open item 8).
- Enums are duplicated in JS and Swift. The fixtures are the guard; Swift tests must decode them.
- `happy` was added to the state list (see D-004). Opus may merge it with `success` visually.

**Next recommended task (Claude Opus in Xcode, Phase 3):** see the
instructions below. It's one session of architecture decisions written to
`docs/DECISIONS.md`, plus compiling `Apple/Shared` with fixture-decoding tests.

**Do not redo:** repo structure, agent rules, upstream audit, protocol v1,
gateway, mock provider, fixtures, gateway tests, CI for the gateway.

#### Exact instructions for Claude Opus in Xcode

1. Owner first: fill in `docs/LOCAL_ENVIRONMENT.md` (Phase 2 commands in the
   handoff pack) and confirm that Xcode sees the Watch and the iPhone.
2. Read `AGENTS.md`, `docs/MASTER_BRIEF.md`, `docs/PROTOCOL_V1.md`,
   `docs/UPSTREAM_REUSE.md`, `docs/DECISIONS.md` (the "Open, for Opus" list), and this entry.
3. Report Xcode/Swift versions, the watchOS 27 SDK, and device visibility before you edit anything.
4. Decide open items 1–10 in `docs/DECISIONS.md` using the entry format there.
   Include the ATS / local-network decision for plain HTTP to the Mac on the LAN.
   Get owner approval for bundle IDs and the team.
5. Create the minimal targets (or a local Swift package for `Apple/Shared`) and
   **compile** `TamagoProtocolV1.swift` and `SpriteAnimationClock.swift`. Fix anything
   that doesn't compile, keeping the WatchPet attribution header.
6. Add a Swift unit-test target that decodes **every** JSON file listed in
   `Tests/Fixtures/protocol-v1/manifest.json` (skip `requests/malformed.txt`,
   and assert that it fails to decode), plus frame-math tests for `SpriteAnimationClock`.
   Label the results `UNIT_TESTED_ONLY` / `SIMULATOR_VERIFIED_ONLY` honestly.
7. Leave feature implementation (Stage A character slice) to Sonnet. Append a
   HANDOFF_LOG entry.

To give Swift a live server: `cd Gateway && TAMAGO_ALLOW_NO_AUTH=1 npm start`
(simulator, loopback) or
`TAMAGO_TOKEN=$(openssl rand -hex 24) TAMAGO_HOST=0.0.0.0 npm start` (physical
Watch on the same Wi-Fi; keep the token out of Git).

---

### 2026-09-26: Claude Opus (local Xcode architect): Phase 3 architecture + compiled Xcode foundation

**Branch:** `claude/great-volta-ogpuw8`

**Commit:** `39ab886` (all work). This log entry lands in the commit right after it.

**Environment:** Xcode 27.0 (27A266a), Swift 6.4, watchOS/iOS 27.0 SDKs, macOS 27.0 arm64.
Full record: `docs/LOCAL_ENVIRONMENT.md`. Physical Watch/iPhone **not connected**.

**Architecture decisions** (`docs/DECISIONS.md` D-101…D-111; all Phase 1 open items resolved)
- D-101 Targets: one Xcode project (synchronized folders) with `TamagoWatch`,
  `TamagoComplication`, `TamagoPhone`, and `TamagoTests`. `Apple/Shared` is a local
  Swift package `TamagoShared`. watchOS/iOS 27.0. No XcodeGen. Placeholder bundle
  prefix `com.example.appletamago`, no team (owner sets both in git-ignored `Apple/Config/Local.xcconfig`).
- D-102 Renderer: SwiftUI `TimelineView(.animation(minimumInterval: 1/12, paused: !isLive))`
  + one asset-catalog image per frame + `SpriteAnimationClock`. When not live
  (inactive, reduced luminance, Reduce Motion, cadence ≠ live), it pauses and shows `lowPowerFrame`. SpriteKit is the fallback.
- D-103 State machine: a pure reducer in `TamagoShared` over `TamagoCharacterState`
  + `activeRequestID`, with effects out. Full transition table. **`happy` stays
  separate from `success`.** Stale responses are dropped inside the reducer. Render modes are not states.
- D-104 Lifecycle: `.inactive` pauses animation but keeps the request and speech;
  `.background` cancels to `idle`. No keep-alive of any kind
  (`frontmostTimeoutExtended` is "No longer supported" in the SDK). Return to Clock
  is the owner's setting. Transient states are never restored.
- D-105 Complication: mood snapshot (6 moods) via App Group, single-entry
  `.never` timeline, reloaded only on mood change, `tamago://open`. App Group
  deferred to Phase 6 (needs the team).
- D-106 Voice: **`Speech.framework` is absent from the watchOS 27 SDK**, so V1 input is
  system dictation via text input. TTS is `AVSpeechSynthesizer` with delegate + watchdog.
  Audio → Mac STT is a protocol v2 item.
- D-107 Transport: `TamagoTransport.send` always returns an envelope and throws only
  `CancellationError`. `TransportRouter` actor: direct first, one same-ID relay
  fallback only on pre-HTTP connection failure, no retry loops. 25/30 s timeouts.
  `NSAllowsLocalNetworking` (already in the Watch `Info.plist`).
- D-108 WC: `sendMessageData` for relay (exact v1 JSON both ways). Token only via
  user-initiated `sendMessage` into the Watch Keychain. `applicationContext` for
  non-secret config. `transferUserInfo`/`transferFile` unused in V1.
- D-109 Security: token in the Keychain (`AfterFirstUnlockThisDeviceOnly`,
  non-synchronizable) on both devices. The iPhone owns config. Never commit team/prefix/token/IPs.
- D-111 Upstream: W1 approved (with a fix), W2/W3 amended, Q6 promoted to the V1
  voice path, Q10 rejected as a tool. All other rows approved.

**Targets created** (in `Apple/AppleTamago.xcodeproj`)

| Target | Type | Result |
|---|---|---|
| `TamagoWatch` | watchOS 27 app, "Tamago", `…watchkitapp`, runs independently | builds; launches on SE 3 40 mm sim: **SIMULATOR_VERIFIED_ONLY** |
| `TamagoComplication` | watchOS WidgetKit extension in `Tamago.app/PlugIns` | builds + embedded: **SIMULATOR_VERIFIED_ONLY** (never placed on a face) |
| `TamagoPhone` | iOS 27 app, embeds `Watch/Tamago.app` | builds for iPhone 17 sim: **SIMULATOR_VERIFIED_ONLY** (not launched) |
| `TamagoTests` | hostless watchOS unit-test bundle (same files as the package's `TamagoSharedTests`) | 43/43 pass |

**Files changed**
- New: `docs/LOCAL_ENVIRONMENT.md`, `Apple/AppleTamago.xcodeproj/` (pbxproj + 2 shared schemes),
  `Apple/Config/Tamago.xcconfig`, `Apple/Shared/Package.swift`,
  `Apple/Shared/Tests/TamagoSharedTests/{FixtureLoader,ProtocolFixtureTests,SpriteAnimationClockTests}.swift`,
  `Apple/WatchApp/{TamagoWatchApp.swift,Info.plist}`, `Apple/Complication/{TamagoComplication.swift,Info.plist}`,
  `Apple/iPhoneApp/TamagoPhoneApp.swift`
- Modified: `Apple/Shared/SpriteAnimationClock.swift` (defect fix, see below),
  `Apple/Shared/TamagoProtocolV1.swift` (header comment only), `docs/DECISIONS.md`,
  `docs/ACCEPTANCE_TESTS.md`, `docs/PROTOCOL_V1.md` (status cell only),
  `docs/UPSTREAM_REUSE.md`, `CLAUDE.md`, `README.md`, `Apple/**/README.md`, `.gitignore`
- **Not touched:** `Gateway/`, `Tests/Fixtures/`, Protocol V1 wire format.

**Swift compilation:** both Cloud files compiled **unmodified** under Swift 6.4 /
Swift 6 language mode with zero warnings (`-warnings-as-errors`). `TamagoProtocolV1.swift`
logic is unchanged and passes every fixture. **One genuine defect was found in
`SpriteAnimationClock`** and demonstrated by a test before fixing it: `Int(elapsed * 1000)`
crashed (`Fatal error: Double value cannot be converted to Int because it is either
infinite or NaN`) and would overflow 32-bit `Int` (arm64_32 Watch) after ~24.8 days
elapsed. Fixed minimally: non-finite/negative → start, and loop phase computed in `Double`.
Timing semantics are otherwise unchanged.

**Protocol defects found:** none. Swift decodes all 21 manifest entries exactly
as the gateway produces them. Swift enums match `protocol-info.json` exactly.

**Build commands (exact, from the repo root)**
```sh
(cd Apple && xcodebuild build -project AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../.build/DerivedData)
(cd Apple && xcodebuild build -project AppleTamago.xcodeproj -scheme TamagoPhone \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ../.build/DerivedData)
xcrun simctl boot 8B5287E9-BD6A-422A-B353-B8E3499AE31D
xcrun simctl install 8B5287E9-BD6A-422A-B353-B8E3499AE31D .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app
xcrun simctl launch 8B5287E9-BD6A-422A-B353-B8E3499AE31D com.example.appletamago.watchkitapp
```

**Test commands (exact) and results**
```sh
(cd Apple/Shared && swift test --scratch-path ../../.build/spm -Xswiftc -warnings-as-errors)   # host macOS
(cd Apple && xcodebuild test -project AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../.build/DerivedData)                                                   # SE 3 40 mm
(cd Apple/Shared && xcodebuild test -scheme TamagoShared \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../../.build/DerivedData)                                                # package scheme, SE 3 40 mm
(cd Gateway && npm test)                                                                    # regression check only
```
- Swift: **43/43 passed** in each of the three runs (Swift Testing; 22 protocol
  tests incl. parameterized cases over all 21 fixtures, 21 `SpriteAnimationClock`
  tests). `UNIT_TESTED_ONLY`.
- Gateway: 66/66 on local Node v26.9.0 (unchanged code).
- Simulator: SE 3 40 mm (watchOS 27.0) builds, runs the tests, and launches the
  placeholder app ("Tamago / protocol v1 · idle", which proves `TamagoShared` links). `SIMULATOR_VERIFIED_ONLY`.

**Warnings:** no compiler warnings in any target. The only build-log warning is
Apple's `appintentsmetadataprocessor: Metadata extraction skipped, no AppIntents.framework dependency found` (informational).

**Upstream source reused:** none new. W1 (WatchPet sprite timing) was modified
further (the fix), and its header + `UPSTREAM_REUSE.md` attribution record are updated.

**Unverified (`UNVERIFIED`)**
- Everything on the physical Watch/iPhone: signing, install, Always-On/reduced
  luminance, scene-phase sequence, Return to Clock, complication on a face, voice,
  TTS, haptics, WatchConnectivity, LAN HTTP from the Watch (the highest risk; D-107).
- The iPhone app was built but not launched. The complication was never rendered on a face.
- The hand-authored `project.pbxproj` has only been exercised by `xcodebuild`. The
  first open in the Xcode GUI may rewrite it (commit that normalization separately).
- Fixture tests read the repo via `#filePath`. They won't run on a physical device (by design).

**Storage:** DerivedData and SwiftPM build products go to `/Volumes/Storage/Projects/TamaWatch/.build/`
(485 MB, git-ignored). `~/Library/Developer/Xcode/DerivedData` stays at 32 KB. Internal
SSD growth: the SE 3 40 mm simulator's device data after first boot (+1.1 GiB in
`~/Library/Developer/CoreSimulator/Devices/8B52…`) plus ~0.3 GiB of temp files.
Internal free space went from ~33 GiB to ~30 GiB (df, includes unrelated system activity).
Nothing was relocated or symlinked.

**Known risks:** LAN HTTP/`.local` from watchOS (D-107). System dictation UX
covers the character (D-106). App Group + signing need the owner's team (D-101/D-105).

**Next recommended task (Claude Sonnet, Phase 4 Stage A, ONE bounded step):**
1. Owner first: create `Apple/Config/Local.xcconfig` with the real
   `TAMAGO_BUNDLE_PREFIX` and `DEVELOPMENT_TEAM`, and connect the SE 3 + iPhone to Xcode.
2. Sonnet: implement `CharacterStateMachine` (pure reducer, D-103 table, effects
   out) in `Apple/Shared/` with Swift Testing reducer tests (stale-response drop,
   cancel → idle, each reaction → idle). Then build `CharacterView` in `Apple/WatchApp/`
   exactly per D-102 with **original placeholder frames** (a few simple shapes per
   state in an asset catalog) and a debug control to step through idle / listening /
   thinking / speaking / success / error / disconnected. No networking, voice, TTS,
   or complication work.
3. Stop when it's installed on the physical Watch and the owner has run the
   AC C checks and recorded results in `DEVICE_TEST_LOG.md`.

**Do not redo:** D-101…D-111, the Xcode project/targets, the package layout,
the fixture and clock tests, the clock fix, `docs/LOCAL_ENVIRONMENT.md`.

---

### 2026-09-26: Claude Sonnet (local Xcode): Phase 4 Stage A — character comes alive

**Branch:** `claude/great-volta-ogpuw8`

**Commits:** `eacf5ff` (Xcode-normalized project file, no manual edits), plus the commit right after this log entry (all Stage A work).

**Scope:** exactly D-103 (state machine) + D-102 (renderer) + the part of D-104
that's reachable without voice/transport (pause animation when not live;
reset to idle on background). No microphone, speech, TTS, AI requests,
transport, WatchConnectivity, complication content, or final art — per the assignment.

**1. `CharacterStateMachine` (`Apple/Shared/CharacterStateMachine.swift`)**
- Pure reducer implementing D-103's transition table exactly: `CharacterState`
  (`visual`, `activeRequestID`, `enteredAt`, `followUpExpected`, and an
  internal `pendingReaction` for the `speaking → reaction` handoff — not a
  competing boolean, just the one piece of data `speechFinished` needs, set
  once and consumed once), `CharacterEvent`, `CharacterEffect`, and
  `CharacterStateMachine.reduce(_:event:now:)`. No I/O, no clock reads —
  `now` is passed in. An event with no legal transition from the current
  state returns the state unchanged with no effects (`#if DEBUG` prints which
  event was dropped and from where).
- `CharacterInteractionController` (`Apple/Shared/CharacterInteractionController.swift`):
  the `@MainActor @Observable` owner D-103 specifies. Stage A scope only —
  it applies events through the reducer and records the resulting effects;
  nothing executes them yet (no transport/speech/haptics exist).
- Added a public initializer to `TamagoResponse` (`TamagoProtocolV1.swift`).
  It only had `Codable`'s synthesized `init(from:)` before, so no module
  outside `TamagoShared` could construct one in-process. This isn't a wire
  change (no field, encoding, or enum changed) — it's the piece PROTOCOL_V1
  §8's client-synthesized envelopes and Stage A's debug harness both need.
  `protocolVersion` is hardcoded to `TamagoProtocol.version` inside it.
- **Tests** (`Apple/Shared/Tests/TamagoSharedTests/CharacterStateMachineTests.swift`,
  60 new `@Test`s, several parameterized over `TamagoCharacterState.allCases`):
  every legal transition in D-103's table; illegal transitions from every
  applicable state (asserts the *exact same* `CharacterState` value comes
  back, not just the same `visual`); `cancel`/`backgrounded` from all 12
  states always → idle with both effects; the three stale-response shapes
  (mismatched ID, no active request, late response after a `cancel` already
  cleared the ID — the specific case D-103 calls out); `toolProgress`/`response`
  ID matching is case-insensitive like `TamagoResponse.answers(_:)`;
  `reactionFinished` only legal from the four reaction moods; the
  `speaking → reaction` handoff resolves to the mood the *response* carried,
  not a fixed one; two full request-ID-threaded paths (with and without a
  speaking detour); `reduce` is a pure function (same inputs → equal outputs).

**2. `CharacterView` — original placeholder character (`Apple/WatchApp/`)**
- No art assets exist yet, so a "frame" is a small set of procedural draw
  parameters (`CharacterExpression.swift`) instead of an asset-catalog image —
  the one deliberate departure from D-102's literal wording. `CharacterView`
  still drives it with exactly the decided timing:
  `TimelineView(.animation(minimumInterval: 1/12, paused: !environmentIsLive))`,
  and inside the closure, `liveNow = environmentIsLive && context.cadence == .live`
  feeds `SpriteAnimationClock.frame(reduceMotion: !liveNow)` — unchanged from
  Phase 3. Swapping in real per-frame images later only touches
  `CharacterArt`/`CharacterView`, not the state machine or the clock.
  `environmentIsLive` reads `scenePhase`, `isLuminanceReduced`,
  `accessibilityReduceMotion` at this one place (D-102/D-104).
- `CharacterArt.swift`: a distinct `AnimationSequence` + expression loop per
  `TamagoCharacterState` (all 12), still built from
  `SpriteAnimationClock.row(...)` — no separate timer anywhere.
- The character is an original rounded-blob creature (SwiftUI shapes + SF
  Symbols only — no upstream/WatchPet/Codex art or code). Idle breathes and
  blinks; listening widens its eyes with an expanding ripple; thinking looks
  side to side with an orbiting dot; speaking's mouth flaps; happy/success
  bounce/pop with a sparkle/checkmark badge; confused rocks with a "?";
  error shows X eyes, a frown, and a fast shake; disconnected goes flat and
  grey; sleeping breathes slowly with a "Z". Screenshots of all 12 in
  `docs/screenshots/phase4-stage-a/`.
- One real compile issue: `Shape`'s `path(in:)` is a nonisolated protocol
  requirement, but the app target's `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`
  (D-101) made every new type MainActor-isolated by default, which the
  compiler correctly rejected as an isolation conflict on the four custom
  `Shape`s. Fixed by marking those four structs `nonisolated`.

**3. Debug state controls (`Apple/WatchApp/DebugStateControlsView.swift`, `#if DEBUG`-gated)**
- A List (second page of a `TabView`) with a button per state. `debugGoTo(_:)`
  never bypasses the reducer — it composes whatever *legal* event sequence
  reaches the target from a clean `cancel`, so pressing a button exercises
  the exact same `CharacterStateMachine` a real interaction would. Reaction
  states and `.speaking` stay put until the developer taps something else
  (no auto-timer for `reactionFinished`/`speechFinished` — those come from
  real TTS/hold-timing in a later phase, out of scope here). Compiles out of
  Release builds entirely (can't become production architecture by accident).
- Added a `TAMAGO_PREVIEW_STATE` launch-environment hook (also `#if DEBUG`)
  so every state could be screenshotted without touch injection into the
  simulator (not available in this environment):
  `SIMCTL_CHILD_TAMAGO_PREVIEW_STATE=<state> xcrun simctl launch <udid> <bundle-id>`.

**4. Lifecycle (D-104, in scope for Stage A)**
- Animation pausing is covered by `CharacterView`'s `environmentIsLive` above.
- Added `.onChange(of: scenePhase)` in `RootView`: scene → `.background` calls
  `controller.apply(.backgrounded)` (→ idle; no request/speech to cancel yet,
  but this alone means relaunch can never resume stuck in a transient state).
  `.inactive` is left alone (already just pauses the animation).
- **Verified on-device** (SE 3 40 mm simulator): drove the app to `.thinking`,
  brought the watch face (`com.apple.Mandrake`) to the foreground (backgrounds
  our app), relaunched — character was `.idle`, not stuck in `.thinking`.
  Screenshots: `docs/screenshots/phase4-stage-a/lifecycle-*.png`.

**Test commands and results**
```sh
(cd Apple/Shared && swift test --scratch-path ../../.build/spm -Xswiftc -warnings-as-errors)
(cd Apple && xcodebuild test -project AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../.build/DerivedData)
(cd Apple && xcodebuild build -project AppleTamago.xcodeproj -scheme TamagoPhone \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath ../.build/DerivedData)
(cd Gateway && npm test)
```
- Swift: **83/83 passed** (43 existing + 60 new), host and SE 3 40 mm
  simulator, zero compiler warnings (`-warnings-as-errors`) in every target.
- Gateway: 66/66 (unaffected; ran anyway as a sanity check — no protocol wire
  change, only an additive Swift initializer).
- `TamagoWatch` and `TamagoPhone` both build clean. `TamagoPhone` build
  unchanged from Phase 3 (not part of this stage).

**Simulator result:** installed and launched on **Apple Watch SE 3 (40 mm),
watchOS 27.0** (`8B5287E9-BD6A-422A-B353-B8E3499AE31D`). All 12
`TamagoCharacterState` values render distinctly, no clipping at 40 mm, page
dots confirm the debug tab exists. `SIMULATOR_VERIFIED_ONLY` throughout —
**no physical Watch available this session; nothing here is `DEVICE_VERIFIED`.**

**Warnings:** none.

**Unresolved / left for later phases**
- The debug tab's own rendering (the List itself) was exercised only through
  its wiring (`debugGoTo` unit-tested, screenshots taken via the launch-env
  hook that calls the same method) — I couldn't swipe to page 2 without touch
  injection in this environment. Low risk: it's a plain SwiftUI `List`.
- `reactionFinished`/`ackBeatElapsed`/`speechFinished` have no automatic timer
  yet (by design — those need real TTS completion / hold-timing, which need
  voice+TTS, out of scope here). The debug harness triggers them manually.
- `CompanionSnapshot` persistence (D-104) isn't implemented; not needed yet
  since a fresh process always starts at `CharacterState.initial` anyway.
- Everything physical: Always-On/reduced-luminance cadence, wrist raise/lower,
  Crown, cover-to-sleep, Return to Clock — all still `UNVERIFIED`, need the
  real SE 3.

**Storage:** `.build/` grew from 485 MB to 507 MB (git-ignored, on
`/Volumes/Storage`). Simulator device data unchanged at 1.1 GiB (already
existed from Phase 3). Internal SSD free space ~29 GiB (was ~30 GiB at the
end of Phase 3) — incidental, nothing relocated.

**Next recommended task (Codex, Phase 5 — BUILD_REVIEW):** review this
branch's Stage A commits against `docs/DECISIONS.md` D-102/D-103/D-104 and
`AGENTS.md`. Specifically check: (1) the reducer's exhaustiveness and that no
path lets a stale response slip through, (2) that `CharacterExpression`/
`CharacterArt` contain no upstream-derived art or code, (3) that
`#if DEBUG`-gated code cannot reach a Release build. Do not build the voice
loop or transport yet — that's Sonnet's Phase 6/7/9 per `MASTER_BRIEF.md`.

**Do not redo:** `CharacterStateMachine`/`CharacterInteractionController` and
their tests, `CharacterExpression`/`CharacterArt`/`CharacterView`, the debug
harness, the `TamagoResponse` public initializer, the D-104 background-reset wiring.
