# Apple/

| Folder | Status |
|---|---|
| `Shared/` | Pure-Foundation Swift intended for a shared module used by all targets. **Never compiled** (`UNVERIFIED`). Compile it, then add unit tests that decode `Tests/Fixtures/protocol-v1/**`. |
| `WatchApp/` | Empty. watchOS app target, created in Xcode by the local architect. |
| `iPhoneApp/` | Empty. iOS companion (gateway config, token in Keychain, WatchConnectivity relay). Comes later. |
| `Complication/` | Empty. WidgetKit complication extension. Comes later. |

No `.xcodeproj` was generated in the cloud on purpose: it couldn't be
validated there. Claude Opus in Xcode decides the target layout (plain Xcode
project vs. XcodeGen vs. local Swift package for `Shared/`) and records it in
`docs/DECISIONS.md`. It may move these folders if current Xcode templates
prefer another structure.

Files in `Shared/`:

- `TamagoProtocolV1.swift`: Codable models for protocol v1, with
  forward-compatible enum decoding and a `answers(_:)` stale-response guard.
- `SpriteAnimationClock.swift`: deterministic intro+loop frame timing, adapted
  from WatchPet (MIT; see header and `THIRD_PARTY_NOTICES.md`). Contains no art.
