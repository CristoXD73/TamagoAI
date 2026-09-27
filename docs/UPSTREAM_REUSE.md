# Upstream Reuse Analysis

Audited by Claude Code Cloud on 2026-09-26 by cloning both repositories and
reading the source. Nothing was compiled (no Swift toolchain in the cloud).
**Reviewed against the watchOS 27 SDK in Phase 3: see `DECISIONS.md` D-111** for
the approved/amended verdict on every row below.

| Upstream | Repository | Commit audited | License |
|---|---|---|---|
| WatchPet | https://github.com/lkuczborski/WatchPet | `d52a77a1d15374b1443a46e26ddba11920d3b894` (2026-05-15) | MIT, © 2026 Łukasz Kuczborski |
| Q007 | https://github.com/chris-jk/Q007 | `d422082ed1f419eef01ea15fd8d8266367410b24` (2026-03-17) | MIT, © 2026 cannappy.org |

Actions: `COPY` · `ADAPT` · `REWRITE_FROM_CONCEPT` · `REFERENCE_ONLY` · `REJECT`

**Result:** exactly one upstream piece has been brought in: WatchPet's sprite
timing engine, adapted into `Apple/Shared/SpriteAnimationClock.swift`. No Q007
code was copied. No assets from either project were copied.

---

## Key findings

### WatchPet

- **Animation mechanism:** `TimelineView(.periodic(from: .now, by: 0.12))` ticks
  about 8 Hz. A pure function maps *elapsed time since the state changed* to a
  sprite-sheet cell (`row`, `column`). Each state plays an **intro** (the state's row
  repeated ×3) and then falls back to the idle **loop**. Rendering uses
  `AsyncImage` of the whole sheet, scaled ×8/×9 and offset to the cell, then
  `.clipped()`. Reduce Motion shows the first frame.
- **Frame states:** `CodexAvatarState` (idle, running, waiting, review, failed,
  waving, jumping, running-left/right) mapped to fixed rows of Codex's 8×9
  sheet, with 120–280 ms per frame.
- **Generic:** the timing engine (`CodexSpriteAnimation`, `SpriteFrame`,
  `AnimationFrame`, `AnimationSequence`) is fully generic once the Codex
  state→row table is removed. The crown-with-debounced-commit pattern in
  `PetDashboardView` is also generic.
- **Codex-specific:** the models (`CodexPet`, `CodexMirrorState`, `CodexThread`),
  the store's `/select-pet` and optimistic-selection logic, the whole 1743-line
  bridge (reads Codex's `app.asar`, `~/.codex` session JSONL, and an Electron
  remote-debugging port), and the pet list.
- **Polling:** `CodexPetStore.startPolling()` loops forever at `pollAfterMs`
  (≥500 ms, default 1–1.5 s) with no scene-phase awareness. That's fine for a demo
  and wrong for us: battery drain, and it keeps running while inactive. Our model
  is request/response, with no polling.
- **LAN/localhost:** defaults to `http://127.0.0.1:47873/state`. A real Watch
  needs `WATCHPET_HOST=0.0.0.0` and the Mac's LAN IP typed into a TextField. There's
  no auth at all. The bridge binds openly on the LAN.
- **Assets:** sprites are **extracted at runtime from the installed Codex app
  bundle** or from `~/.codex/pets`. They are OpenAI's art, not in the WatchPet
  repo, and not covered by WatchPet's MIT license. **Do not use.** WatchPet's own
  app icons are also excluded.
- **Also note:** `AsyncImage` reloads from the network per view and has no
  explicit caching. For bundled original art use `Image` from the asset catalog;
  this belongs to the renderer decision.

### Q007

- **Voice input:** there's no speech recognition code. `VoiceInputView` is a
  `TextField` that relies on the **system dictation / Scribble** input sheet.
  That's actually a useful, low-risk V1 path to evaluate, because it needs no
  microphone entitlement. Whether it feels "character-first" enough is Opus's call.
- **TTS:** `SpeechService` is 19 lines: `AVSpeechSynthesizer`, hard-coded
  `en-US`, no audio session setup, no delegate, and no completion callback (so it
  can't drive a `speaking → idle` transition).
- **WatchConnectivity:** a singleton `WCSession` activated in `init`, with
  `applicationContext` plus `sendMessage(replyHandler: nil)` used only to push **API
  keys**. There's no request relay and no reply handler. Callbacks hop via
  `DispatchQueue.main`. The iOS side re-activates in `sessionDidDeactivate`
  (correct).
- **Credentials:** the iOS app stores provider API keys in **UserDefaults in
  plaintext** and sends them to the Watch through `applicationContext`. The
  Watch writes them to the Keychain (`kSecAttrAccessibleWhenUnlocked`). **Reject
  this pattern.** Our secret is a gateway token, kept in the Keychain on both
  devices.
- **Keychain:** a small, sensible generic-password wrapper, but it ignores
  `SecItemAdd`/`SecItemDelete` status codes and is keyed by `AIProviderType`.
- **Persistence:** JSON file in Documents with `print` on failure and
  force-unwrapped `urls(...).first!`. That's trivial; rewrite to fit our state model.
- **AI service:** direct HTTPS clients for Anthropic, OpenAI, and other providers,
  with keys on the Watch. This is the opposite of our architecture.
- **Project:** XcodeGen `project.yml` with watchOS 10 / iOS 17 targets. It
  **contains the upstream author's `DEVELOPMENT_TEAM` ID**, which must not be carried
  over. There's also a fastlane/TestFlight workflow (out of scope).
- **App Intents:** `AskAIIntent` / `SendMessageIntent` / `Q007Shortcuts`. This
  pattern is useful later for "Hey Siri, ask Tamago…", but not needed for the
  first vertical slice.

---

## Component matrix

### WatchPet

| # | FILE | PURPOSE | ACTION | RATIONALE | LICENSE ACTION | LOCAL DESTINATION | LOCAL XCODE VERIFICATION REQUIRED |
|---|---|---|---|---|---|---|---|
| W1 | `WatchPet/Views/PetAvatarView.swift` → `CodexSpriteAnimation`, `SpriteFrame`, `AnimationFrame`, `AnimationSequence` | Time → sprite-frame mapping (intro + loop, reduce-motion) | **ADAPT (done)** | Pure, generic, testable, and saves real work. Codex row table removed; public API; loop-less sequences; `lowPowerFrame`. | Header attribution + MIT text in `THIRD_PARTY_NOTICES.md` | `Apple/Shared/SpriteAnimationClock.swift` | **Yes**: compile, unit-test frame math, and confirm it fits the renderer Opus picks |
| W2 | `PetAvatarView.swift` → `PetAvatarView` body (`TimelineView(.periodic … 0.12)`) | Drives the clock from SwiftUI | **REFERENCE_ONLY** | Good pattern, but cadence and inactive/reduced-luminance behavior must be designed against watchOS 27 (e.g. pause the timeline when not active). | None (not copied) | Opus decision → `docs/DECISIONS.md` | **Yes**: on device, including wrist-down / Always-On |
| W3 | `PetAvatarView.swift` → `SpriteSheetCellView` | Crops a sheet cell via scaled image + offset + clip | **REWRITE_FROM_CONCEPT** | The concept (offset/clip, `.interpolation(.none)` for pixel art) is useful. `AsyncImage` over the network is wrong for bundled art. | None if rewritten; notice if copied | future `Apple/WatchApp/…/CharacterView.swift` | **Yes**: 40 mm layout, memory, frame pacing |
| W4 | `PetAvatarView.swift` → `FallbackPetAvatar` | Gradient + initials placeholder | **REJECT** | Codex styling; we need original placeholder art. | — | — | — |
| W5 | `WatchPet/Views/PetDashboardView.swift` | Full-screen layout, `digitalCrownRotation` with 90 ms debounced commit, long-press settings sheet | **REFERENCE_ONLY** | The crown debounce and `focusable`/`@FocusState` pattern are worth copying *conceptually*. The layout math is tuned to Codex's status bubble. | None (not copied) | future Watch root view | **Yes**: Crown behavior on device |
| W6 | `WatchPet/Views/PetSwitcherView.swift` | List of pets + bridge URL TextField | **REJECT** (V1) | Pet switching isn't in scope. A settings TextField on the Watch is worse than configuring on the iPhone. | — | — | — |
| W7 | `WatchPet/Views/Color+Hex.swift` | Hex color helper | **REJECT** | Trivial; use the asset catalog. | — | — | — |
| W8 | `WatchPet/Models/CodexPet.swift` | Codex mirror models, lenient enum decoding | **REFERENCE_ONLY** | Lenient `init(from:)` for unknown enum values is reused as a *pattern* in `TamagoProtocolV1.swift` (written independently). | None | — | Compile |
| W9 | `WatchPet/Stores/CodexPetStore.swift` | Polling store, optimistic selection with request-ID guard | **REFERENCE_ONLY** | The `selectionRequestID` stale-response guard is the same idea we need. Endless polling is rejected. | None | Opus: state/transport design | **Yes** |
| W10 | `bridge/codex-pet-bridge.js` | Node bridge: Codex scraping, `/state`, `/avatars`, `/select-pet` | **REWRITE_FROM_CONCEPT (done)** | "Tiny zero-dependency Node server on the Mac" was a good idea. Everything else is Codex scraping. Our gateway (`Gateway/`) is a fresh implementation with auth, versioning, and structured errors. | None (no code copied) | `Gateway/` | No (gateway is unit-tested in cloud) |
| W11 | Codex pet sprites (runtime-extracted), `Assets.xcassets` icons, `docs/watchpet-screenshot.png` | Art | **REJECT** | Codex sprites are OpenAI's and not in the MIT grant. Icons and screenshot belong to WatchPet. Use original art. | Do not redistribute | — | — |
| W12 | `WatchPet.xcodeproj` | Project | **REJECT** | Opus defines our targets. | — | — | — |

### Q007

| # | FILE | PURPOSE | ACTION | RATIONALE | LICENSE ACTION | LOCAL DESTINATION | LOCAL XCODE VERIFICATION REQUIRED |
|---|---|---|---|---|---|---|---|
| Q1 | `Q007 Watch App/Services/KeychainService.swift` | Generic-password save/load/delete | **ADAPT (deferred to Xcode)** | Useful ~40 lines. Must be re-keyed (gateway token, not provider keys), check `OSStatus`, and pick accessibility (`AfterFirstUnlockThisDeviceOnly` is likely right for a token). Not written in cloud because the Security framework can't be compiled here and the token design is Opus's call. | If adapted: header + add to `THIRD_PARTY_NOTICES.md` (Q007 text already there) | `Apple/Shared/KeychainStore.swift` | **Yes**: compile; device test incl. locked-Watch behavior |
| Q2 | `Q007 Watch App/Services/SpeechService.swift` | AVSpeechSynthesizer TTS | **REWRITE_FROM_CONCEPT** | Too small to be worth attribution and missing what we need: delegate-driven `didFinish`/`didCancel` to leave `speaking`, voice selection, cancellation, audio-session behavior. | None if rewritten | `Apple/WatchApp/…/SpeechOutput.swift` | **Yes**: audible on device, speaker vs. AirPods, interruption |
| Q3 | `Q007 Watch App/Services/WatchConnectivityManager.swift` + `Q007 iOS App/Services/PhoneConnectivityManager.swift` | WCSession activation + key sync | **REWRITE_FROM_CONCEPT** | Activation boilerplate is standard. We need a different contract: `sendMessage` with `replyHandler` carrying a protocol-v1 request/response, `applicationContext` for non-secret config, and **never** secrets in plaintext. Also move to Swift concurrency. | None if rewritten | `Apple/WatchApp/…/PhoneRelayTransport.swift`, `Apple/iPhoneApp/…/RelayService.swift` | **Yes**: physical Watch + iPhone only |
| Q4 | `Q007 Watch App/Services/PersistenceService.swift` | JSON-file conversation store | **REJECT** | Trivial and chat-shaped. Our persisted state (last character state, config) is different and tiny. | — | — | — |
| Q5 | `Q007 Watch App/Services/AIService.swift`, `Models/AIProvider.swift` | Cloud provider clients + model lists | **REJECT** | Cloud-first, keys on the Watch. The Watch only speaks protocol v1 to our gateway. | — | — | — |
| Q6 | `Q007 Watch App/Views/VoiceInputView.swift` | TextField → system dictation | **REFERENCE_ONLY** | Documents the "use system dictation via text input" route as a V1 voice candidate for Opus to evaluate. | None | Opus decision | **Yes**: dictation UX on watchOS 27 device |
| Q7 | `Q007 Watch App/Intents/*` | App Intents / Shortcuts | **REFERENCE_ONLY** (later) | Good pattern for Siri. Rewrite against our transport when voice + transport work. | None | later | **Yes** |
| Q8 | `Q007 Watch App/ViewModels/ChatViewModel.swift`, `Views/*` (chat list, bubbles, settings, setup) | Chat UI | **REJECT** | We're character-first, not chat-first. | — | — | — |
| Q9 | `Q007 iOS App/Views/PhoneHomeView.swift` | Key entry UI | **REFERENCE_ONLY** | The idea of an iPhone screen that configures the Watch fits. Content differs (gateway URL + token + test). | None | later iPhone app | Yes |
| Q10 | `project.yml` (XcodeGen), `Shared/WatchConnectivityConstants.swift` | Target layout | **REFERENCE_ONLY** | Shows a working watchOS + iOS split with `WKCompanionAppBundleIdentifier` / `WKRunsIndependentlyOfCompanionApp`. **Contains the upstream author's team ID; don't copy.** Whether to use XcodeGen at all is Opus's decision. | None | Opus decision | Yes |
| Q11 | `fastlane/`, `.github/workflows/testflight.yml`, icons | Release + art | **REJECT** | Out of scope; not our art. | — | — | — |

---

## Local voice engine (D-121): downloaded on the owner's Mac, not redistributed

No source, binaries or weights from these projects are in this repository. `Gateway/tools/tts/setup.sh`
downloads them (after printing URL, size and license, and asking) to `$TAMAGO_TTS_MODEL_DIR`
(owner: `/Volumes/Storage/AI/tts`). `Gateway/tools/tts/tamago-tts` only *invokes* the prebuilt CLI as a child
process. Full comparison: `docs/VOICE_RESEARCH.md`.

| Component | Repository | License | Role | How used |
|---|---|---|---|---|
| sherpa-onnx (`sherpa-onnx-offline-tts`, prebuilt macOS universal2) | https://github.com/k2-fsa/sherpa-onnx | Apache-2.0 | Runtime | Invoked as a CLI by the helper |
| Kokoro-82M v1.0 (`kokoro-multi-lang-v1_0`) | https://huggingface.co/hexgrad/Kokoro-82M | Apache-2.0 (weights) | Primary voice model | Loaded by sherpa-onnx; voices named after OpenAI voices refused |
| KittenTTS nano (`kitten-nano-en-v0_1-fp16`) | https://github.com/KittenML/KittenTTS | Apache-2.0 | Lighter fallback model | Loaded by sherpa-onnx |
| espeak-ng data (bundled inside the model packages) | https://github.com/espeak-ng/espeak-ng | GPL-3.0 | Phonemizer used by the sherpa-onnx runtime | Not linked into or shipped by our code; only on the owner's Mac. Revisit if Tamago is ever distributed with the engine |

## Attribution records

```text
Source repository: https://github.com/lkuczborski/WatchPet
Source file:       WatchPet/Views/PetAvatarView.swift (CodexSpriteAnimation + frame structs)
Source commit:     d52a77a1d15374b1443a46e26ddba11920d3b894
License:           MIT
Local file:        Apple/Shared/SpriteAnimationClock.swift
Nature of modification: removed Codex state/row mapping; generalized to data-driven
                   sequences; public, UI-free API; loop-less sequences; lowPowerFrame;
                   helpers renamed (durationMs); Phase 3: NaN/infinity/overflow-safe
                   elapsed handling. Verification: UNIT_TESTED_ONLY (Phase 3, Xcode 27.0).
Copyright notice preserved: yes (file header + THIRD_PARTY_NOTICES.md)
```

## Rule for future reuse

Before reusing more upstream code, check: Does it save meaningful work? Is the
API still right on watchOS 27? Is it better than a small clean rewrite? Can we
test it? Does it drag in cloud or provider assumptions? Are its assets
redistributable? If any of the API, test, or asset answers is unclear, don't
copy. When you do copy, add the header, `THIRD_PARTY_NOTICES.md` entry, and a
row here.
