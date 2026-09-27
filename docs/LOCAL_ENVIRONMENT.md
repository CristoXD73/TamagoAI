# Local Environment

Recorded by Claude Opus (local Xcode architect) on **2026-09-26** from real
command output on the owner's Mac. Update this file when anything below changes.

## Host

| Item | Value | Source |
|---|---|---|
| macOS | 27.0 (build 26A428), arm64 | `sw_vers`, `uname -m` |
| Xcode | **27.0 (build 27A266a)** at `/Applications/Xcode.app/Contents/Developer` | `xcodebuild -version`, `xcode-select -p` |
| Swift | **Apple Swift 6.4** (swiftlang-6.4.0.34.1, clang-2100.3.34.1), swift-driver 1.168.6 | `swift --version` |
| git | 2.55.0 | `git --version` |
| Node / npm | v26.9.0 / 11.19.1 (gateway requires ≥22) | `node --version`, `npm --version` |
| XcodeGen / Tuist | not installed (not needed, see D-101) | `which xcodegen tuist` |

## SDKs (`xcodebuild -showsdks`)

| Platform | SDK |
|---|---|
| iOS | 27.0 (`iphoneos27.0`) |
| iOS Simulator | 27.0 (`iphonesimulator27.0`) |
| watchOS | 27.0 (`watchos27.0`) |
| watchOS Simulator | 27.0 (`watchsimulator27.0`) |

Simulator runtimes: iOS 27.0 (24A434), watchOS 27.0 (24R362).

Notable SDK facts checked directly in the installed watchOS 27.0 SDK (they
drive decisions in `DECISIONS.md`):

- `Speech.framework` is **absent** from the watchOS SDK (no `SFSpeechRecognizer` on the Watch).
- `AVSpeechSynthesizer` (+ delegate `didFinish`/`didCancel`), `AVAudioRecorder`,
  and `AVAudioSession.activate(options:completionHandler:)` are available.
- SwiftUI: `TimelineView` with `.animation(minimumInterval:paused:)`,
  `TimelineView.Context.cadence` (`live` / `seconds` / `minutes`),
  `EnvironmentValues.isLuminanceReduced`, `accessibilityReduceMotion`, `ScenePhase`.
- WatchKit: `WKApplication.applicationState`; `frontmostTimeoutExtended` is
  deprecated since watchOS 7 with the message "No longer supported".
- WidgetKit on watchOS: `accessoryCorner`, `accessoryCircular`,
  `accessoryRectangular`, `accessoryInline`, `widgetURL`, `WidgetCenter.reloadTimelines(ofKind:)`,
  `RelevanceConfiguration`, `WidgetPushHandler`.
- WatchConnectivity: `sendMessageData(_:replyHandler:errorHandler:)`,
  `updateApplicationContext`, `transferUserInfo`, `transferFile`, `isReachable`,
  `isCompanionAppInstalled`.
- `SpriteKit`, `FoundationModels`, `Network` frameworks are present (see D-102, D-106 for why they are not used).

## Simulators

| Device | UUID | Notes |
|---|---|---|
| **Apple Watch SE 3 (40mm), watchOS 27.0** | **`8B5287E9-BD6A-422A-B353-B8E3499AE31D`** | **Primary target.** Not paired with an iPhone simulator. |
| Apple Watch SE 3 (44mm) | `880C10A8-6C6C-40A8-91FC-AB18AD49F3E2` | |
| Apple Watch Series 12 (42/46mm), Ultra 4 (49mm) | see `xcrun simctl list` | paired with iPhone simulators |
| iPhone 18 Pro / Pro Max / 17 / 17e / Air | see `xcrun simctl list` | iOS 27.0 |

## Physical devices

| Device | Status |
|---|---|
| Apple Watch SE 3, 40 mm, GPS, 64 GB, watchOS 27.0 | **Not connected to Xcode.** `xcrun devicectl list devices` → "No devices found." |
| iPhone | Not connected to Xcode. Model / iOS build not yet recorded. |
| Apple Developer team in Xcode | Not configured in the project (no `DEVELOPMENT_TEAM` committed; see D-101). |

`DEVICE_VERIFIED` is therefore **not available** for anything yet.

## Repository and storage

| Item | Value |
|---|---|
| Repository path | `/Volumes/Storage/Projects/TamaWatch` (external volume, intentional) |
| Branch at start of Phase 3 | `claude/great-volta-ogpuw8` |
| Internal SSD (`/`) | 228 GiB, ~33 GiB available at start of Phase 3 |
| `/Volumes/Storage` | 931 GiB, ~401 GiB available |
| `~/Library/Developer/Xcode/DerivedData` | did not exist at start of Phase 3 |
| `~/Library/Developer/CoreSimulator` | 192 MiB at start of Phase 3 |

Storage rule: project source, assets, and relocatable project data stay on
`/Volumes/Storage`. Xcode.app, SDKs, simulator runtimes, signing data and the
Keychain stay where Apple put them. Command-line builds in this repo pass
`-derivedDataPath` pointing at `/Volumes/Storage/Projects/TamaWatch/.build/`
(git-ignored) so build products do not grow the internal SSD; the simulator
device data itself still lives in `~/Library/Developer/CoreSimulator`.

This is a binding rule for every agent: `AGENTS.md` §9 has the full path table.

### Check on 2026-09-26 (Claude Code, before Brain F)

| Item | Value | Source |
|---|---|---|
| Internal SSD (`/`) | 228 GiB, **21 GiB available (90% used)** | `df -h /` |
| `/Volumes/Storage` | 931 GiB, **400 GiB available** | `df -h /Volumes/Storage` |
| `~/Library/Developer/CoreSimulator` | 2.6 GiB | `du -sh` |
| `~/Library/Developer/Xcode/DerivedData` | 524 MiB (from Xcode GUI builds, not the command line) | `du -sh` |
| `~/.npm` | 142 MiB | `du -sh` |
| `/Volumes/Storage/AI` | exists, empty | `ls` |
| Ollama | **not installed** | `which ollama` |

### Ollama on the Storage disk

Models are gigabytes each, so they must not land in the default `~/.ollama/models`
(internal). Point the Ollama server at the Storage disk **before the first pull**:

```sh
mkdir -p /Volumes/Storage/AI/ollama/models
# Ollama menu-bar app: set the variable for GUI apps, then quit and reopen Ollama
launchctl setenv OLLAMA_MODELS /Volumes/Storage/AI/ollama/models
# or run the server by hand instead of the app
OLLAMA_MODELS=/Volumes/Storage/AI/ollama/models ollama serve
```

`launchctl setenv` lasts until logout or restart; set it again after a reboot
(or use the Ollama app's own model-location setting if your version has one).
Check with `ollama list` after a pull that `/Volumes/Storage/AI/ollama/models` grew
and `~/.ollama/models` did not.

Gateway state and brain databases on this Mac:

```sh
export TAMAGO_STATE_DIR=/Volumes/Storage/AI/TamagoAI       # identity + brain.sqlite
TAMAGO_BRAIN_DB=/Volumes/Storage/AI/tamago-eval/<model>.sqlite npm run brain -- chat   # eval runs
```
