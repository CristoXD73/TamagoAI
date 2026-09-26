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

### D-008 WatchPet sprites and all upstream art excluded
- The sprites come from the Codex app bundle and aren't covered by WatchPet's MIT license.
  Stage A uses original placeholder art.

---

## Open, for Opus (Phase 3)

Each needs an entry in the format above.

1. **Targets / structure:** Watch app, iPhone app, WidgetKit extension, shared
   code (local SwiftPM package for `Apple/Shared`?), test targets, and whether XcodeGen adds value.
   Bundle IDs and team: **owner approval required.**
2. **Renderer:** SwiftUI `TimelineView` + frame images vs. SpriteKit vs. other.
   How `SpriteAnimationClock` is driven. Behavior when `scenePhase != .active`
   and under `isLuminanceReduced`.
3. **State machine:** canonical states (see PROTOCOL_V1 §6), transient states,
   allowed transitions, cancellation → idle, requestId ownership, and the complication snapshot mapping.
4. **Lifecycle / persistence:** what survives suspension, and where the snapshot for the complication lives (App Group?).
5. **Complication:** families, timeline/reload strategy, deep link, reduced-luminance visuals.
6. **Voice in:** system dictation via text input (Q007's approach) vs.
   on-device `SFSpeechRecognizer` vs. recording audio for the Mac. Permissions and cancellation.
7. **TTS:** local `AVSpeechSynthesizer` (delegate-driven end of `speaking`) vs. Mac-generated audio.
8. **Transport:** `TamagoTransport` protocol, URLSession config, timeouts (client
   ≈ gateway + 5 s), actor isolation, route selection, backoff, and **ATS / local-network settings for plain HTTP on the LAN (watchOS 27).**
9. **WatchConnectivity:** `sendMessage`+reply for relay requests,
   `applicationContext` for non-secret config, and how the token gets to the Watch (never plaintext context).
10. **Security:** Keychain accessibility class for the gateway token; what never lives on the Watch.
