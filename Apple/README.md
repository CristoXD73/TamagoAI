# Apple/

Structure decided in `docs/DECISIONS.md` **D-101** (Phase 3, Xcode 27.0).

| Path | What | Status |
|---|---|---|
| `AppleTamago.xcodeproj` | Xcode project, file-system-synchronized folders. Shared schemes `TamagoWatch` (Watch app + complication; Test runs `TamagoTests`) and `TamagoPhone`. | builds: `SIMULATOR_VERIFIED_ONLY` |
| `Shared/` | Local Swift package **`TamagoShared`** (pure Foundation, Swift 6). Sources stay at `Shared/*.swift`; tests in `Shared/Tests/TamagoSharedTests/`. | `UNIT_TESTED_ONLY` |
| `WatchApp/` | `TamagoWatch` target (watchOS 27.0). Placeholder screen only. `Info.plist` holds `NSAllowsLocalNetworking` (D-107). | launch: `SIMULATOR_VERIFIED_ONLY` |
| `Complication/` | `TamagoComplication` WidgetKit extension, embedded in the Watch app. Static placeholder. | build only |
| `iPhoneApp/` | `TamagoPhone` target (iOS 27.0), embeds the Watch app. Placeholder screen only. | build only |
| `Config/Tamago.xcconfig` | Placeholder bundle prefix `com.example.appletamago`, empty team. Put real values in git-ignored `Config/Local.xcconfig`. | n/a |

Targets: `TamagoWatch`, `TamagoComplication`, `TamagoPhone`, and `TamagoTests`
(a hostless watchOS unit-test bundle compiled from the same files as the
package's own `TamagoSharedTests`).

Adding a Swift file to `WatchApp/`, `iPhoneApp/`, `Complication/` or `Shared/`
needs **no project edit**. Put pure logic (state machine, snapshot mapping,
transport contracts) in `Shared/` so it's testable on the host.

```sh
# from the repo root
(cd Apple/Shared && swift test --scratch-path ../../.build/spm)
(cd Apple && xcodebuild test -project AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination 'platform=watchOS Simulator,id=8B5287E9-BD6A-422A-B353-B8E3499AE31D' \
  -derivedDataPath ../.build/DerivedData)
```

Fixture tests read `Tests/Fixtures/protocol-v1/` in place via `#filePath`. That
works on the host and in the simulator, **not** on a physical device.
