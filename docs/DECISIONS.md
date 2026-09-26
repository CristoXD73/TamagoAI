# Decisions

Format for each entry: **Decision · Reason · Alternatives · Risks · Device
verification required · Fallback.** Owner of Apple-side decisions: Claude Opus
in Xcode (Phase 3). Physical-device results can overturn any entry.

---

## Made in Phase 1 (Claude Code Cloud)

### D-001 Project name: "Apple Tamago"
- **Decision:** the owner renamed the project from "TamaWatch" to "Apple Tamago".
  Code identifiers use `Tamago` / `TAMAGO_`.
- **Note:** the GitHub repository is still named `faucet-repo`. The owner can rename it in GitHub settings.

### D-002 Gateway runtime: Node ≥22, zero dependencies
- **Reason:** runs identically in the cloud sandbox, CI, and on the Mac mini; no supply chain; built-in `node:test`.
- **Alternatives:** Swift (Vapor/Hummingbird): shared models with the Watch, but untestable in the cloud and heavier. Python/FastAPI: extra deps.
- **Risk:** protocol enums are duplicated in JS and Swift. Mitigated by shared fixtures and drift tests.
- **Fallback:** port to Swift later if model sharing becomes valuable. The protocol stays the same.

### D-003 Protocol v1 is HTTP+JSON request/response, text input only
- **Reason:** smallest thing that proves the loop. Voice is transcribed on the device.
- **Alternatives:** WebSocket/streaming, audio upload. Deferred (see PROTOCOL_V1 §13).
- **Device verification:** Watch → Mac over LAN (Phase 9).

### D-004 Gateway only sends *reaction* states
- `idle | happy | success | confused | error`. The Watch owns `listening`,
  `thinking`, `speaking`, etc. Unknown states decode as `idle`.
- `happy` was added (it isn't in the handoff's state list) because the handoff's
  own examples use `characterState: "happy"`. It is distinct from `success`
  (task done). Opus may merge them into one state visually.

### D-005 Same envelope for success and error
- **Reason:** the UI pipeline always gets text, speechText, state, and haptic, and branches on `status` / `error.code`.
- Client-synthesized errors (`gateway_unavailable`, `disconnected`, client
  `timeout`) use the same envelope (`Tests/Fixtures/protocol-v1/client/`).

### D-006 Gateway dedupes by requestId; client drops stale responses
- Makes direct/relay races and double-sends harmless. Retries need a new ID.

### D-007 No Xcode project generated in the cloud
- It couldn't be validated there. `Apple/Shared/*.swift` are pure-Foundation
  sources for Opus to place (app target, local Swift package, or shared group).
- **Superseded by D-101** (Phase 3): the project now exists and was built locally.

### D-008 WatchPet sprites and all upstream art excluded
- The sprites come from the Codex app bundle and aren't covered by WatchPet's MIT license.
  Stage A uses original placeholder art.

---


## Made in Phase 3 (Claude Opus, local Xcode 27.0 / watchOS 27.0 SDK)

Resolves the Phase 1 "Open, for Opus" list (items 1–10 → D-101…D-110; the
upstream review is D-111). SDK facts quoted here were checked in the installed
SDK, not recalled; see `docs/LOCAL_ENVIRONMENT.md`. Nothing below is
`DEVICE_VERIFIED`. Every "device verification required" line is a test for the
owner on the SE 3 40 mm.

### D-101 Project and target structure

- **Decision:**
  - One hand-maintained Xcode project, `Apple/AppleTamago.xcodeproj`
    (objectVersion 77, **file-system-synchronized folders**, so adding a Swift
    file needs no project edit and diffs stay small).
  - Targets:

    | Target | Platform | Product / bundle ID | Sources |
    |---|---|---|---|
    | `TamagoWatch` | watchOS 27.0 | "Tamago" · `$(TAMAGO_BUNDLE_PREFIX).watchkitapp` | `Apple/WatchApp/` |
    | `TamagoComplication` | watchOS 27.0 WidgetKit extension, embedded in the Watch app | `$(TAMAGO_BUNDLE_PREFIX).watchkitapp.widget` (see D-113: the literal suffix `.complication` is rejected by Apple's bundle-ID registration API) | `Apple/Complication/` |
    | `TamagoPhone` | iOS 27.0, embeds the Watch app | "Tamago" · `$(TAMAGO_BUNDLE_PREFIX)` | `Apple/iPhoneApp/` |

  - Shared code is a **local Swift package, `Apple/Shared` → library `TamagoShared`**
    (swift-tools 6.2, Swift 6 language mode), linked by all three targets. Sources
    stay at `Apple/Shared/*.swift` so every existing path reference remains valid.
  - Unit tests live in the package (`TamagoSharedTests`, Swift Testing). They
    run on the host (`swift test`) **and** on the watchOS simulator (package
    scheme). The `TamagoWatch` scheme's Test action also runs them. App-hosted
    test targets are **deferred** until an app target contains logic that
    can't live in the package.
  - The Watch app is a single-target watchOS app (`WKApplication`),
    `WKRunsIndependentlyOfCompanionApp = YES` (the direct route to the Mac must
    work without the iPhone app running), and `WKCompanionAppBundleIdentifier` = the iOS app.
  - Deployment targets: **watchOS 27.0 / iOS 27.0**. The owner's Watch runs 27.0,
    watchOS 27 pairs only with iOS 27, and only 27.0 runtimes are installed, so a
    lower floor couldn't be tested.
  - App targets use `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` (current Xcode
    template default); the package stays nonisolated and `Sendable`.
  - Signing and identity live in `Apple/Config/Tamago.xcconfig`:
    `TAMAGO_BUNDLE_PREFIX = com.example.appletamago` (**placeholder**) and an empty
    `DEVELOPMENT_TEAM`. It optionally includes the git-ignored
    `Apple/Config/Local.xcconfig`, where the owner sets the real prefix and team. No
    team ID is ever committed.
- **Reason:** simplest structure current Xcode supports cleanly. Synchronized
  folders remove most of the reason for a generator. The package makes the
  pure logic testable without a simulator and forces the UI/model separation that AGENTS §5 asks for.
- **Alternatives:** XcodeGen/Tuist (rejected: an extra tool that isn't installed,
  another source of truth, and Q007's `project.yml` carries a foreign team ID);
  shared group compiled into each target (rejected: no host tests, duplicate
  compilation, easy to leak UIKit/SwiftUI into models); separate widget + watch
  "extension" targets (the old two-target Watch layout is obsolete).
- **Risks:** hand-authored `project.pbxproj`. It was verified by `xcodebuild`
  (see HANDOFF_LOG), but opening it in the Xcode GUI the first time may
  normalize it. Commit that diff separately. Bundle prefix and team need **owner approval** before device install.
- **Device verification required:** signed install of Watch app + complication
  on the SE 3 via the iOS app (or standalone Watch install), with the owner's team.
- **Fallback:** if the hand-authored project gives the GUI trouble, recreate
  targets from Xcode templates with the same names and folders. The package and sources don't change.

### D-102 Character renderer: SwiftUI `TimelineView(.animation)` + per-frame images + `SpriteAnimationClock`

- **Decision:**
  - `CharacterView` = `TimelineView(.animation(minimumInterval: 1.0 / 12, paused: !isLive))`.
    Each tick computes `SpriteAnimationClock.frame(in: sequence, elapsed: context.date - stateEnteredAt, reduceMotion: !isLive)`
    and shows one `Image` from the asset catalog. Pixel art uses `.interpolation(.none)`;
    everything else uses `.resizable().scaledToFit()` inside the full-screen safe area.
  - `isLive = scenePhase == .active && !isLuminanceReduced && !accessibilityReduceMotion && context.cadence == .live`.
    When not live, the schedule is **paused** and the view shows
    `sequence.lowPowerFrame`, a static low-power pose.
  - Art is **one image per frame** in an asset catalog, named from `(state, row, column)`
    by a small `CharacterArt` table in the Watch target. No sprite-sheet cropping.
  - ~12 fps cap for character animation. Frame durations in the art table are
    ≥ 80 ms. Transitions between states cut on the next frame (the clock restarts
    at `stateEnteredAt`). No cross-fades in V1.
  - Rendering state is **derived**, never stored: it reads the state machine
    (D-103) and the environment. It holds no timers of its own.
- **Reason:** `TimelineView` is the documented SwiftUI mechanism. The `.animation`
  schedule has a `paused:` parameter (verified in the SDK), and `Context.cadence`
  (`live`/`seconds`/`minutes`) tells the view when the system has throttled it.
  Timing stays in a pure, unit-tested function. Per-frame images avoid decoding and
  holding a whole sheet in memory to show one cell.
- **Alternatives:** SpriteKit `SpriteView` (present on watchOS 27 but heavier:
  its own render loop, harder to pause correctly with scene phase, and harder to unit-test;
  keep as fallback). SwiftUI `.phaseAnimator`/`keyframeAnimator` (good for tweened
  motion, not frame-by-frame art; may be used for small secondary motion such as
  a bob or a squash). `WKInterfaceImage` animated images (WatchKit storyboard era, rejected).
  WatchPet's `.periodic(by: 0.12)` (rejected: can't pause).
- **Risks:** frame pacing and memory on the SE 3 are unknown. The cadence
  the system gives `TimelineView` under reduced luminance must be observed.
- **Device verification required:** 15 min active animation (heat/battery, AC J);
  frames advance smoothly at the chosen cap; wrist-down → static pose, no ticks;
  raise → resumes; 40 mm layout doesn't clip.
- **Fallback:** `SpriteView` with `isPaused` bound to `!isLive`, driven by the same art table.

### D-103 Canonical character state machine

- **Decision:** one pure reducer, `CharacterStateMachine`, in `TamagoShared`,
  owned by a single `@MainActor @Observable InteractionController` on the Watch.
  Views read it; nothing else stores character state.
  - **State** = `TamagoCharacterState` (the existing wire enum is the canonical
    visual state) **plus** `activeRequestID: String?` and `enteredAt: Date`. No
    parallel booleans (`isListening`, `isLoading`, …).
  - **`happy` stays separate from `success`.** Both are already in protocol v1,
    and the gateway sends each for different reasons (social vs. task completion).
    Merging them would be a protocol change for no gain. Stage A art may reuse the
    same frames for both.
  - `sleeping` is an **app-local** long-idle pose (e.g. 10 min without
    interaction while active). It is **not** how reduced luminance is shown.
    Reduced luminance, inactive scene, and Reduce Motion are **render modes**
    (D-102), never states.
  - The pack's "curious / looking around" is an idle *animation variant* chosen
    by the art table. "Needs attention" is a complication mood (D-105), not a state.
  - Events → transitions (anything not listed is ignored, and debug builds log it):

    | From | Event | To | Effects |
    |---|---|---|---|
    | `idle`, `sleeping`, `disconnected`, any reaction | `userActivated` | `listening` | haptic `.click` / start capture |
    | `idle` | `inactivityTimeout` | `sleeping` | — |
    | `sleeping` | any user input | `idle` | — |
    | `listening` | `transcript(text)` (non-empty) | `acknowledging` | new `requestId`; **send request now** |
    | `listening` | `transcript("")` / `cancel` | `idle` | — |
    | `acknowledging` | `ackBeatElapsed` (~0.6 s, from the art) | `thinking` | — |
    | `thinking` | `toolProgress(id)` (future) | `toolRunning` | — |
    | `acknowledging`, `thinking`, `toolRunning` | `response(r)` where `r.answers(active)` and `r.status == .accepted` | `thinking` | — |
    | `acknowledging`, `thinking`, `toolRunning` | `response(r)` where `r.answers(active)`, final, `speechText` non-empty | `speaking` | play `r.haptic`, speak |
    | `acknowledging`, `thinking`, `toolRunning` | same, `speechText` empty | reaction(`r`) | play `r.haptic` |
    | `speaking` | `speechFinished` / `speechCancelled` / speech watchdog | reaction(`r`) | — |
    | `happy`, `success`, `confused`, `error` | `reactionFinished` (`SpriteAnimationClock.isFinished` or ≤ 2.5 s hold) | `idle` | clear `activeRequestID` |
    | any | `cancel` (Crown/back/tap-to-stop) or scene → `.background` | `idle` | cancel request task, stop speech, clear `activeRequestID` |
    | `idle`, `sleeping` | `routeLost` | `disconnected` | — |
    | `disconnected` | `routeRestored` | `idle` | — |

    `reaction(r)` is `r.characterState` if it's a reaction state. `idle` → `idle`.
    A client-synthesized `gateway_unavailable`/`disconnected` envelope → `disconnected`.
  - **Stale protection is inside the reducer:** a `response` event whose
    `requestId` doesn't match `activeRequestID` is dropped, whatever the current state.
    Because `cancel` clears `activeRequestID`, a late answer after a cancel is also dropped.
    This is testable without UI (Sonnet adds reducer tests to `TamagoSharedTests`).
  - `followUpExpected == true`: after the reaction, go to `idle` and show a
    "tap to answer" affordance. We do **not** auto-reopen capture (D-106: system
    dictation can't be opened without a user gesture in SwiftUI).
  - The reducer returns **effects** (`sendRequest`, `cancelRequest`, `speak`,
    `stopSpeech`, `playHaptic`, `updateComplicationSnapshot`). The controller
    executes them. The reducer does no I/O and reads no clock; time is passed in with events.
- **Reason:** one source of truth, exhaustive `switch`, deterministic unit
  tests, and stale-response rejection in exactly one place.
- **Alternatives:** separate enums per concern (UI phase + network phase):
  rejected, because they drift. Letting views own timers: rejected (battery,
  tests). Merging `happy`/`success`: rejected above.
- **Risks:** the transition table will grow (tool progress, follow-ups). Keep
  additions in the reducer and its tests.
- **Device verification required:** repeated request/cancel cycles never leave the
  character stuck (AC B, "Transitions deterministic").
- **Fallback:** none needed. This is a pure data structure. Change the table here first.

### D-104 watchOS lifecycle, reduced luminance, and persistence

- **Decision:**
  - Read `@Environment(\.scenePhase)`, `@Environment(\.isLuminanceReduced)`, and
    `@Environment(\.accessibilityReduceMotion)` at the root view only, and derive the render mode from them (D-102).
  - `.active` → live animation. `.inactive` (includes wrist-down while
    frontmost, and system alerts) → pause the timeline, show the low-power pose,
    **keep** the in-flight request and speech running. `.background` → cancel
    the request task, stop speech, reducer → `idle`, persist the snapshot.
  - **No keep-alive of any kind.** No `WKExtendedRuntimeSession` (its sessions
    are for specific use cases such as self-care, mindfulness, physical therapy,
    and smart alarm; using one to stay frontmost would be a fake background mode). No
    workout session, no silent audio, no location. `frontmostTimeoutExtended`
    is deprecated as "No longer supported" in the SDK and must not be used.
  - **Return to Clock** is the owner's per-app setting (Watch app → General →
    Return to Clock). The app doesn't try to influence it. Document the owner's choice in `DEVICE_TEST_LOG.md`.
  - **Always-On:** the app does nothing special beyond honoring `isLuminanceReduced`.
    Whether SE 3 shows the app while wrist-down, and at what cadence, is
    **UNKNOWN until observed** on the device.
  - **Persistence:** a tiny `Codable` `CompanionSnapshot` { `mood`, `lastReachableAt`,
    `lastInteractionAt`, `updatedAt` } in `UserDefaults` (later the App Group
    suite, D-105). Transient states (`listening`, `acknowledging`, `thinking`,
    `toolRunning`, `speaking`) are **never** restored. Relaunch starts in `idle`,
    or `disconnected` if the last probe failed. No conversation history.
- **Reason:** matches what the SDK exposes without inventing capabilities.
  Cancelling on `.background` avoids half-finished conversations resuming minutes later.
- **Alternatives:** background `URLSession` to finish requests after suspension
  (rejected for V1: a 2–25 s interactive request isn't a download, and the result
  can't be spoken while suspended anyway). `@SceneStorage` (unnecessary; the snapshot is tiny).
- **Risks:** on some watchOS versions `.inactive` can be short before `.background`,
  and the answer is lost. Acceptable in V1: the user asks again.
- **Device verification required:** AC section C in full (active, screen
  inactivity, wrist lower/raise, Crown dismissal, cover-to-sleep, reopen, Return
  to Clock, reduced luminance). Record the observed `scenePhase` sequence.
- **Fallback:** if `.inactive` is observed to kill in-flight requests anyway,
  cancel on `.inactive` too and say so in the UI.

### D-105 Complication (WidgetKit)

- **Decision:**
  - `TamagoComplication` extension, one `StaticConfiguration` widget, kind `"TamagoCompanion"`.
  - Families, in priority order: `accessoryCircular` (the character face), `accessoryCorner`,
    `accessoryRectangular` (face + short status), `accessoryInline` (text only).
  - It shows a **mood snapshot**, not live state. Rich state maps as follows:
    `sleeping`→`resting`; `idle`→`ready`; `listening/acknowledging/thinking/toolRunning/speaking`→`busy`;
    `happy/success`→`happy`; `confused/error`→`attention`; `disconnected`→`offline`.
    The Watch writes `CompanionSnapshot` to a shared **App Group** `UserDefaults`
    suite and calls `WidgetCenter.shared.reloadTimelines(ofKind:)` **only when the mood changes**.
  - Timeline: a single entry, policy `.never` (reloads are app-driven). If
    `updatedAt` is older than 6 h, show `resting` rather than a stale `busy`.
  - `widgetURL(URL(string: "tamago://open"))` opens the app. Reduced luminance:
    honor `isLuminanceReduced` and `widgetRenderingMode` (`accented`/`vibrant`) with
    a simplified, dimmer face. **No animation claims.**
- **Reason:** WidgetKit renders snapshots on the system's schedule and budget.
  An App Group is the documented way to share state between an app and its widget extension.
- **Alternatives:** ClockKit (deprecated path). Push-driven widget updates
  (`WidgetPushHandler` exists, but it's a server feature, over-scoped for V1).
  `RelevanceConfiguration` (Smart Stack relevance, later).
- **Risks:** App Group entitlements need the owner's team, so they **aren't in
  the Phase 3 project** (added in Phase 6). Reload budget and latency are unknown on device.
- **Device verification required:** AC section D (selectable, recognizable,
  offline state, tap-to-launch, update timing).
- **Fallback:** without an App Group, the complication shows a static "Tamago"
  face that launches the app (the current Phase 3 placeholder does exactly this).

### D-106 Voice input and TTS

- **Decision (V1):**
  - **Speech input = system dictation** through the standard SwiftUI text
    input (a `TextField`/text-entry button that the user taps, choosing
    dictation). `listening` is shown while the system input sheet is up.
    `transcript` is the returned text. An empty result or a dismissed sheet → `cancel`.
    The app needs no microphone permission for this path.
  - **TTS = on-Watch `AVSpeechSynthesizer`**, one long-lived instance owned by a
    `SpeechOutput` `@MainActor` object. Its delegate (`didFinish`/`didCancel`) emits
    `speechFinished`/`speechCancelled`. A watchdog (estimated duration + 3 s)
    emits `speechFinished` if the delegate never fires, so `speaking` can't get stuck.
    System voice for the device language. No custom voices in V1.
  - **Path to local AI (V2, not now):** record audio on the Watch
    (`AVAudioRecorder`/`AVAudioEngine`, `NSMicrophoneUsageDescription`), upload it
    to the Mac, transcribe locally (e.g. whisper.cpp). This needs protocol v2
    (`inputType: "audio"`, excluded by PROTOCOL_V1 §13) and a new Decision entry.
    Mac-generated TTS audio similarly waits for v2.
- **Reason:** `Speech.framework` does **not exist** in the watchOS 27 SDK (checked),
  so on-Watch `SFSpeechRecognizer` isn't an option. System dictation is the only
  reliable speech-to-text on the Watch today, and protocol v1 is text-only. Local
  TTS has the lowest latency and no audio transfer.
- **Alternatives:** audio upload now (rejected: protocol change, mic permission,
  larger payloads, more failure modes). Mac TTS (rejected for V1: latency and
  audio plumbing). On-Watch `FoundationModels` (present in the SDK) for replies:
  rejected, because the Mac is the brain.
- **Risks:** the system input sheet covers the character (less "character-first").
  Dictation may use Apple servers, depending on device and language. TTS routing
  (built-in speaker vs. AirPods) and volume must be observed.
- **Device verification required:** AC section E in full.
- **Fallback:** if dictation UX is unacceptable on device, move to recorded
  audio + Mac STT (protocol v2) as described above.

### D-107 Transport abstraction

- **Decision:** (to be implemented by Sonnet in Phases 9–10, not now)

  ```swift
  public enum TamagoRoute: String, Sendable { case direct, relay, remote }

  public protocol TamagoTransport: Sendable {
      var route: TamagoRoute { get }
      /// Cheap reachability probe (GET /v1/health for direct; WCSession.isReachable for relay).
      func probe() async -> Bool
      /// Always returns an envelope; transport failures become the client-synthesized
      /// envelopes in Tests/Fixtures/protocol-v1/client/. Throws only CancellationError.
      func send(_ request: TamagoRequest) async throws(CancellationError) -> TamagoResponse
  }
  ```

  - **Request IDs:** created once per logical request by the state machine
    (`listening → acknowledging`). The same ID is reused only for the single
    direct→relay fallback below (gateway dedupe makes that safe). A user retry always gets a new ID.
  - **Cancellation:** the controller holds the one `Task` for the active
    request and cancels it on `cancel`/background. `URLSession.data(for:)` observes
    task cancellation. The relay maps cancellation to ignoring the reply (WC
    messages can't be recalled). A late reply is dropped by the reducer (D-103).
  - **Timeouts:** `URLSessionConfiguration.ephemeral`, `timeoutIntervalForRequest = 25`
    (gateway 20 s + 5), `timeoutIntervalForResource = 30`, `waitsForConnectivity = false`,
    no cookies, no cache. Probe timeout 3 s. Relay timeout 30 s.
  - **Stale-response rejection:** in the reducer (`TamagoResponse.answers(_:)` +
    `activeRequestID`), never in views or transports.
  - **Route selection (`TransportRouter`, an `actor`):** try `direct` first
    unless it failed within the last 60 s. If `direct` fails **before any HTTP
    response** (connection refused, DNS failure, no route; not a timeout) and
    `relay` is reachable, send the **same** request once via relay. Never fall back
    after an HTTP response or a timeout. **No automatic retry loops.** Health probes
    back off 5 s → 15 s → 60 s (cap) and run only while `scenePhase == .active`.
  - **Concurrency:** `DirectTransport` is a `final class … : Sendable` with only
    immutable state (base URL, token provider, `URLSession`). `TransportRouter`
    is an `actor` (route health, backoff). `InteractionController` and the state
    machine are `@MainActor`. Protocol models are `Sendable` value types (already true).
  - **ATS / plain HTTP on the LAN:** the Watch (and iPhone) `Info.plist` sets
    `NSAppTransportSecurity.NSAllowsLocalNetworking = YES`, **not**
    `NSAllowsArbitraryLoads`. The Watch target already carries this key.
  - No sockets, streaming, or `Network.framework`. watchOS restricts low-level
    networking, and v1 is request/response.
- **Reason:** keeps the UI pipeline to one envelope type (D-005), makes the
  race between routes harmless (D-006), and gives each piece of mutable state one owner.
- **Alternatives:** throwing transport errors up to the UI (rejected: every view
  would need error mapping). A persistent WebSocket (rejected: not needed, battery, restrictions).
- **Risks (highest in the project):** watchOS may proxy Watch traffic through the
  paired iPhone. Whether `http://<mac>.local:8787` resolves and connects from the
  Watch (over the iPhone proxy or directly over Wi-Fi), and whether
  `NSAllowsLocalNetworking` alone is enough, is **UNVERIFIED** until tested on device. An IP-address
  base URL is the first fallback to try.
- **Device verification required:** AC section F (Watch side), including Wi-Fi
  only with the iPhone off/out of range.
- **Fallback:** if direct LAN HTTP proves unreliable on watchOS, make `relay` the
  default route and keep `direct` for when it's proven.

### D-108 WatchConnectivity responsibilities

- **Decision:**

  | Channel | Direction | Carries | Why this channel |
  |---|---|---|---|
  | `sendMessageData(_:replyHandler:errorHandler:)` | Watch → iPhone | **relay requests**: exact protocol-v1 request JSON; the reply is the exact protocol-v1 response JSON | interactive, needs `isReachable`, wakes the iOS app in the background, one reply per request |
  | `sendMessage(_:replyHandler:)` | iPhone → Watch | **gateway token provisioning** only, user-initiated from the iPhone config screen while both apps are active; the Watch stores it in the Keychain and replies with an ack (no echo of the secret) | live, not persisted by WC |
  | `updateApplicationContext` | iPhone → Watch | **non-secret config**: gateway base URL, display name, relay enabled, preferred route, `configVersion` | latest-wins state, delivered when possible |
  | `transferUserInfo` | — | not used in V1 | queued, persisted delivery isn't needed for anything yet |
  | `transferFile` | — | not used in V1 (later: art packs, audio for protocol v2) | |
  | `transferCurrentComplicationUserInfo` | — | not used; complication data originates on the Watch | |

  - The iPhone is a **relay and configuration companion**, not the brain. It
    performs exactly the HTTP request the Watch would have made, with its own copy
    of the token, and returns the gateway's envelope unchanged (or a
    client-synthesized one on failure). It never inspects or rewrites answers.
  - A single `@MainActor` connectivity object per side owns `WCSession`; delegate
    callbacks hop to it. It activates once at app launch. On iOS it reactivates in `sessionDidDeactivate`.
- **Reason:** each channel's delivery semantics match one job. The Q007 pattern
  of pushing secrets through `applicationContext` is rejected.
- **Risks:** `sendMessage` requires reachability, and the iOS app wake-up latency is unknown.
- **Device verification required:** AC section G on a physical Watch + iPhone (simulator pairs don't count).
- **Fallback:** if relay latency is too high, surface `disconnected` rather than hang.

### D-109 Security and configuration boundaries

- **Decision:**
  - **Keychain (both devices):** the gateway bearer token only, as a
    generic password (service `<bundle prefix>.gateway`, account `token`),
    `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, `kSecAttrSynchronizable = false`.
    The wrapper checks every `OSStatus` (adapting Q007 Q1, D-111).
  - **iPhone owns configuration:** gateway URL, token entry, a connection test,
    and relay toggle. The Watch UI only shows status and never needs a settings form.
  - **Synced to the Watch:** the non-secret config via application context,
    and the token via user-initiated `sendMessage` into the Watch Keychain.
  - **Never on the Watch:** provider API keys, model selection, Ollama URL,
    tool definitions, agent loops.
  - **Never in source control:** tokens, `.env`, `DEVELOPMENT_TEAM`/team IDs,
    real bundle prefix (in `Local.xcconfig`), provisioning profiles,
    certificates, personal hostnames/IPs. `.gitignore` covers `Apple/Config/Local.xcconfig`.
  - No passcode bypass, no wrist-detection spoofing, no private APIs. The token's
    accessibility class means a Watch that was never unlocked since reboot can't
    authenticate; that is accepted.
- **Reason:** smallest secret surface consistent with direct transport. The
  Watch must hold the token to talk to the Mac without the phone.
- **Alternatives:** Watch holds no token and always relays (rejected: makes the
  iPhone mandatory, contradicting the primary route). Token in
  `applicationContext`/`UserDefaults` (rejected: stored in plaintext).
- **Risks:** token rotation needs a re-send from the iPhone. Plain HTTP on the LAN
  exposes the token to LAN sniffing (accepted V1 risk, ARCHITECTURE §Security).
- **Device verification required:** token survives relaunch/reboot (after first
  unlock). A locked-since-boot Watch fails with an auth/config error, not a crash.
- **Fallback:** manual token entry on the Watch (text input) if WC provisioning fails.

### D-110 Deferred on purpose

Not decided in Phase 3 and not blocking Sonnet's Stage A: final art style and
frame counts, idle-variant scheduling, haptic tuning, Siri/App Intents (Q007 Q7,
later), cellular/remote TLS design (Phase 14, needs its own decision before any
off-LAN exposure).

### D-111 Review of Cloud's upstream-reuse decisions (against the watchOS 27 SDK)

| # | Cloud decision | Phase 3 verdict |
|---|---|---|
| W1 | ADAPT sprite timing → `SpriteAnimationClock` | **Approved.** Compiles under Swift 6.4, 21 tests (`UNIT_TESTED_ONLY`, host + SE 3 40 mm simulator). One defect fixed: NaN/±∞ elapsed trapped and long elapsed overflowed 32-bit `Int` (see file header). |
| W2 | REFERENCE_ONLY `TimelineView(.periodic 0.12)` | **Amended:** use `.animation(minimumInterval:paused:)` + `cadence` (D-102). `.periodic` can't pause. |
| W3 | REWRITE_FROM_CONCEPT sheet-cell cropping | **Amended:** one image per frame from the asset catalog, no cropping (D-102). `.interpolation(.none)` idea kept. |
| W4, W6, W7, W11, W12 | REJECT | **Approved.** |
| W5 | REFERENCE_ONLY crown debounce | **Approved** (for later Crown interactions). |
| W8, W9 | REFERENCE_ONLY lenient enums / request-ID guard | **Approved;** both are realized in `TamagoProtocolV1.swift` and D-103. |
| W10 | REWRITE_FROM_CONCEPT bridge → Gateway | **Approved** (done in Phase 1). |
| Q1 | ADAPT Keychain wrapper (deferred) | **Approved** with D-109 parameters; do it in Phase 9/10, with header + notices. |
| Q2 | REWRITE_FROM_CONCEPT TTS | **Approved** (D-106: delegate + watchdog). |
| Q3 | REWRITE_FROM_CONCEPT WatchConnectivity | **Approved;** use `sendMessageData` for relay payloads (D-108). |
| Q4, Q5, Q8, Q11 | REJECT | **Approved.** |
| Q6 | REFERENCE_ONLY TextField dictation | **Promoted to the V1 voice path** (D-106): `Speech.framework` is absent on watchOS 27. |
| Q7, Q9 | REFERENCE_ONLY | **Approved** (later phases). |
| Q10 | REFERENCE_ONLY XcodeGen `project.yml` | **Rejected as a tool** (D-101). Its `WKCompanionAppBundleIdentifier`/`WKRunsIndependentlyOfCompanionApp` settings are used. |


### D-112 Checkpoint A: completion identity repair (D-103 clarification)

- **Decision:** `ackBeatElapsed`, `speechFinished`, `speechCancelled`, and
  `reactionFinished` carry the request ID captured when the corresponding
  work starts. The reducer rejects mismatched IDs before applying D-103's
  existing transition table. No wire-protocol change and no new async work.
- **Reason:** Checkpoint A reproduced an old speech completion advancing a
  newer request's speaking state. State-only guards cannot distinguish them.
- **Alternatives:** relying solely on future task cancellation (insufficient:
  queued callbacks may still arrive); a second state machine (unnecessary).
- **Risks:** future effect executors must capture the originating ID, never
  look up the current ID when a callback arrives. Transcript/capture identity
  remains a responsibility to settle when capture is implemented; Stage A
  has no asynchronous capture source.
- **Device verification required:** cancellation during real speech and a new
  interaction, once speech exists. Current reducer coverage is UNIT_TESTED_ONLY.
- **Fallback:** none; keep identity validation in the canonical reducer.
- **Existing D-103 semantics restored:** offline error envelopes resolve to
  disconnected; idle/disconnected terminal responses clear request identity;
  reaction completion preserves follow-up intent until a new interaction or
  explicit cancellation/background reset.

### D-113 Complication bundle-identifier repair: the literal suffix `.complication` is unregistrable

- **Decision:** `TamagoComplication`'s `PRODUCT_BUNDLE_IDENTIFIER` changes from
  `$(TAMAGO_BUNDLE_PREFIX).watchkitapp.complication` to
  `$(TAMAGO_BUNDLE_PREFIX).watchkitapp.widget`. Nothing else about the target
  changes: same `com.apple.product-type.app-extension` product type, same
  `com.apple.widgetkit-extension` extension point, same embedding in
  `TamagoWatch`, same `WKCompanionAppBundleIdentifier`/team/signing style.
- **Reason:** every generic signed build of `TamagoWatch` (which embeds the
  complication) failed with `xcodebuild: error: Failed Registering Bundle
  Identifier` + `No profiles for '...complication' were found`, reproduced
  three times against three different `TAMAGO_BUNDLE_PREFIX` values
  (`com.example.appletamago`, `com.cristoxd73.tamawatch`,
  `com.cristoxd73.tamawatch.c73x926`) and once more after renaming the Watch
  app's own suffix from `.watchkitapp` to `.watch`. The unified system log
  (`log show`, `IDEProvisioningLedgerEntry`) shows Xcode's own bundle-ID
  lookup (`GET .../bundleIds?filter[identifier]=<id>,*`) returning
  `"total": 0` (the identifier is globally unclaimed) immediately before the
  create call is rejected with `409 ENTITY_ERROR.ATTRIBUTE.INVALID`,
  `resultCode: 9400`, `"An App ID with Identifier '<id>' is not available.
  Please enter a different string."` — for every identifier ending in the
  literal path segment `complication`, and for no other identifier in the
  project (base app, `.watchkitapp`, `.tests` all registered without
  incident). Changing only the trailing segment to `widget`, with the prefix
  and every other setting held constant, made the identical `TamagoWatch`
  generic signed build succeed immediately. This is Apple Developer Services
  API behavior, not a project misconfiguration and not a capability the
  target declares (no entitlements, no App Group, no Complications capability
  are configured anywhere in the project) — it reproduced identically whether
  or not the identifier contained the string `watchkitapp`, ruling out that
  substring as the cause.
- **Alternatives:** deleting the `TamagoComplication` target (rejected: the
  target is architecturally correct for watchOS 27 WidgetKit — see below —
  and the assignment that found this required not deleting it without proof
  the architecture itself was wrong, which it isn't); enrolling in the paid
  Apple Developer Program (rejected: unnecessary, this is a naming defect,
  not a Personal Team capability restriction — the same 409 reproduced
  regardless of prefix and is a bundle-ID string rule, not a team-tier gate).
- **Is the complication target architecture correct for watchOS 27?** Yes.
  `com.apple.product-type.app-extension` + `com.apple.widgetkit-extension` +
  `StaticConfiguration`/`TimelineProvider` (D-105) is the current,
  non-deprecated WidgetKit architecture; there is no separate legacy
  "WatchKit complication" target type in the watchOS 27 SDK to migrate away
  from. Nothing about D-105's design needed to change.
- **Risks:** if Apple's backend ever *does* accept `.complication`-suffixed
  identifiers (e.g., after an account/API change), this decision does not
  need to be revisited — `.watchkitapp.widget` remains valid and correct
  either way. If a future target intentionally wants an identifier ending in
  `complication`, expect the same registration failure and apply the same
  fix (rename the trailing segment).
- **Device verification required:** none beyond D-101's existing requirement
  (signed install on the SE 3). This is a provisioning-identifier fix, not a
  behavior change.
- **Fallback:** none needed; this is the fix.

### D-114 Stage A autonomous creature world and procedural octopus

- **Decision:** record Claude Sonnet's existing character pass, completed by
  Codex's interrupted-work audit. Keep `CharacterStateMachine` canonical for
  interaction state (D-103). An orthogonal, pure `CreatureBehaviorEngine`
  owns normalized world position and `resting`, `moving`, `peeking`, and
  `offscreen` phases; it drives the habitat only during interaction `idle`.
  This is not a second owner of interaction/request state or a protocol change.
- **Behavior:** seeded randomness, caller-supplied time, interpolated movement,
  four exit/return edges, separate blink/glance schedules, bounded hidden holds
  (2–5.5 seconds), and bounded catch-up after suspension. Visible taps approach
  the tapped territory; hidden taps shorten the return delay. Repeated attention
  is capped and decays. These engine rules are **UNIT_TESTED_ONLY**.
- **Ownership and rendering:** one `@MainActor @Observable`
  `CreatureBehaviorController`; no added timer, task, networking or keep-alive.
  The existing 12-fps-cap `TimelineView` triggers world advancement through
  `onChange`, outside body evaluation, only while idle and the environment is
  active/visible without reduced luminance or Reduce Motion. Unchanged world
  checkpoints are not republished. Cadence gates live drawing; non-live drawing
  uses the existing static idle low-power pose (D-104). Resuming may catch up
  elapsed logical time; long gaps reset calmly rather than replay indefinitely.
- **Art separation:** `CreatureIdleStage` maps world coordinates and clips to
  its viewport; `CreatureExpression` derives draw parameters; `CharacterFace`
  draws the intentional original procedural octopus silhouette. Other states
  retain their existing expression sequences using that silhouette. Final art
  remains deferred and can replace drawing without owning behavior. The hide
  margin is 0.45 viewport units, clearing the transformed 108-point placeholder
  on a 162-point viewport; this geometric bound is **UNIT_TESTED_ONLY**.
- **Debug:** forced behavior buttons, interaction previews, state label and
  launch-preview environment hook are behind `#if DEBUG` in the Watch UI.
  Forced commands are one-shot inputs to the same engine, not persistent modes.
- **Reason:** preserve the implemented autonomous character and its testable
  separation from future artwork while honoring lifecycle and battery limits.
- **Alternatives:** scripted animation sequences, per-behavior timers, a new
  rendering engine, or final-art integration are outside this pass.
- **Risks:** **UNVERIFIED** for post-audit UI runtime behavior, actual callback
  frequency, frame pacing, touches, lifecycle transitions and energy use. The
  seeded engine is replayable for identical input checkpoints/times, not a
  promise that different tick cadences produce identical random histories.
  Different artwork sizes require rechecking hide clearance.
- **Device verification required:** owner-led SE 3 checks of wander/exit/peek/
  return, repeated taps, DEBUG controls, non-idle states, wrist-down/resume,
  Reduce Motion, heat and battery, recorded in `DEVICE_TEST_LOG.md` before any
  `DEVICE_VERIFIED` claim. Claude's pre-audit visual result is
  **SIMULATOR_VERIFIED_ONLY**, reported in the owner's interruption transcript.
- **Fallback:** retain the static low-power pose when animation is unavailable;
  retain this procedural renderer until original final artwork is approved.
