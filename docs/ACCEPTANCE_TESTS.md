# Acceptance Tests

Every item carries exactly one label: `DEVICE_VERIFIED` · `SIMULATOR_VERIFIED_ONLY`
· `UNIT_TESTED_ONLY` · `UNVERIFIED`. No "should work". Platform-sensitive items
need physical-device evidence in `DEVICE_TEST_LOG.md` before V1 exits.

Status as of **CODEX CHECKPOINT A (2026-09-26, local Xcode 27.0)**. Anything not listed as done is `UNVERIFIED`.

## A. Build and signing
| Item | Status |
|---|---|
| Watch app builds | SIMULATOR_VERIFIED_ONLY (live character + debug harness; SE 3 40 mm watchOS 27.0 simulator, Phase 4) |
| iPhone companion builds | SIMULATOR_VERIFIED_ONLY (placeholder; iOS 27.0 simulator build, embeds the Watch app; not launched) |
| Complication extension builds | SIMULATOR_VERIFIED_ONLY (build + embedding only; never added to a face) |
| Unit tests build (Swift) | UNIT_TESTED_ONLY (93 tests: host `swift test` + SE 3 40 mm simulator) |
| `Apple/Shared/*.swift` compiles | UNIT_TESTED_ONLY (Swift 6.4, zero warnings with `-warnings-as-errors`) |
| Signed dev app installs on physical Watch | UNVERIFIED (no team configured, Watch not connected) |
| App launches | SIMULATOR_VERIFIED_ONLY (character screen + debug tab on SE 3 40 mm simulator) |
| No secrets committed | UNIT_TESTED_ONLY: manual grep at Phase 1; `.gitignore` covers env and signing files |

## B. Character engine
| Item | Status |
|---|---|
| idle / listening / thinking / speaking / success / error / disconnected render | SIMULATOR_VERIFIED_ONLY (SE 3 40 mm; all 12 wire states, screenshotted via the debug harness) |
| Sprite frame timing (`SpriteAnimationClock`) | UNIT_TESTED_ONLY (21 clock tests; hardware timing unverified) |
| `CharacterStateMachine` transitions deterministic | UNIT_TESTED_ONLY (50 reducer/controller tests: original 40 plus 10 Checkpoint A regressions and adversarial tests) |
| Stale response can't overwrite current state | UNIT_TESTED_ONLY (request-ID guards on responses and completion callbacks, including cancel/background followed by a new request) |
| View disappearance stops expensive animation | UNVERIFIED (explicit page-selection and appearance gates added; runtime hidden-page tick counting and manual swipe remain unobserved) |
| `.background` doesn't corrupt state on reopen | SIMULATOR_VERIFIED_ONLY (D-104: driven to `.thinking`, backgrounded via the watch face, reopened → `.idle`, screenshotted) |
| 40 mm layout doesn't clip | SIMULATOR_VERIFIED_ONLY (all 12 states inspected at default text size; listening ripple/label collision repaired; screenshots in `screenshots/checkpoint-a/`) |

## C. Persistence / frontmost (physical device only)
Active animation · screen inactivity · wrist lower/raise · Crown dismissal ·
cover-to-sleep · reopen · Return to Clock · any Always-On / reduced-luminance
behavior · no high-FPS assumption while inactive. **All UNVERIFIED.**

## D. Complication
Selectable · recognizable character · broad state · offline state · tap
launches app · no continuous-animation claim · update timing observed. **All UNVERIFIED.**

## E. Voice
Permission · start · cancel · empty input · repeated inputs · interruption
recovery · TTS audible · speaking-state sync · audio session release. **All UNVERIFIED.**

## F. Direct networking (Watch side)
| Item | Gateway side (Phase 1) | Watch side |
|---|---|---|
| Health check | UNIT_TESTED_ONLY | UNVERIFIED |
| Protocol version check | UNIT_TESTED_ONLY | UNVERIFIED |
| Request ID echo | UNIT_TESTED_ONLY | UNVERIFIED |
| Timeout | UNIT_TESTED_ONLY (504) | UNVERIFIED |
| Cancellation | n/a in v1 | UNVERIFIED |
| Malformed JSON | UNIT_TESTED_ONLY (400) | UNVERIFIED |
| 5xx response | UNIT_TESTED_ONLY (502/503) | UNVERIFIED |
| Unauthorized | UNIT_TESTED_ONLY (401) | UNVERIFIED |
| Duplicate request | UNIT_TESTED_ONLY (dedupe) | UNVERIFIED |
| Stale response | n/a (client rule) | UNVERIFIED |
| Physical Watch → Mac mock gateway | | UNVERIFIED |
| Physical Watch → real local AI | | UNVERIFIED |

## G. iPhone relay
WC activates · config syncs · relay request works · same request ID returned ·
direct route disabled during test · iPhone unavailable handled · delayed relay
response can't overwrite newer request · verified on physical Watch + iPhone. **All UNVERIFIED.**

## H. Gateway
| Item | Status |
|---|---|
| One-command startup (`npm start`) | UNIT_TESTED_ONLY (started and smoke-tested in the cloud sandbox) |
| Health endpoint | UNIT_TESTED_ONLY |
| Deterministic mock provider | UNIT_TESTED_ONLY |
| One local AI adapter (Ollama) | UNVERIFIED_LOCAL_PROVIDER (stub-fetch unit tests only) |
| Provider failure → structured error | UNIT_TESTED_ONLY |
| Tests run without Ollama | UNIT_TESTED_ONLY |
| Secrets from env, not Git | UNIT_TESTED_ONLY (config tests: token from `TAMAGO_TOKEN` or the owner-only identity file, never the repo; no-auth only on loopback) |
| Request logs have IDs | UNIT_TESTED_ONLY |
| Sensitive content not logged | UNIT_TESTED_ONLY |
| Runs on the owner's Mac mini | UNVERIFIED |

## I. Security
| Item | Status |
|---|---|
| No passcode bypass / wrist spoofing / private APIs / fake background sessions | UNVERIFIED (Checkpoint A source audit found no prohibited APIs/modes; no hardware observation) |
| Keychain for sensitive client config | UNVERIFIED |
| No raw Ollama exposed publicly | Gateway defaults to loopback; Ollama stays on its own loopback port. UNVERIFIED on owner's network |
| TLS/auth plan before remote/cellular | Stated in `ARCHITECTURE.md`; design not yet written |
| Separate authorization design for privileged tools | Not started |

## J. Battery sanity
15 min active animation · 15 min repeated requests · no runaway heat · no
aggressive offline retry · animation pauses when hidden · no hidden high-rate
timers. **All UNVERIFIED.**


Checkpoint A scope: PASS for the existing character/debug slice. Automatic
acknowledgment, speech and reaction completion drivers remain absent by the
Stage A boundary; debug states intentionally hold. This is not physical-device
acceptance. Release ignores `TAMAGO_PREVIEW_STATE` and shows no debug page:
SIMULATOR_VERIFIED_ONLY. See HANDOFF_LOG for commands, defects and remaining gaps.

## K. Tamago Brain (Mac, D-117)
| Item | Status |
|---|---|
| Learns a stated fact, survives a restart, recalls it | UNIT_TESTED_ONLY (deterministic reasoner) |
| "Thanks." → nonverbal V1 envelope | UNIT_TESTED_ONLY (+ real gateway process, curl) |
| Secrets / "don't remember" never stored, and Tamago says so | UNIT_TESTED_ONLY |
| Forget by voice and CLI | UNIT_TESTED_ONLY |
| Familiarity by days, never decreasing | UNIT_TESTED_ONLY |
| Aborted interaction commits nothing | UNIT_TESTED_ONLY |
| Ollama structured outputs, repair, fallback | UNIT_TESTED_ONLY (stubbed) · real: UNVERIFIED_LOCAL_PROVIDER |
| Latency/quality of real local models on the owner's Mac | UNVERIFIED (Brain F) |
| Nonverbal envelope on the physical Watch (no speech, haptic plays) | UNVERIFIED |

