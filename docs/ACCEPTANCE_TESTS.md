# Acceptance Tests

Every item carries exactly one label: `DEVICE_VERIFIED` · `SIMULATOR_VERIFIED_ONLY`
· `UNIT_TESTED_ONLY` · `UNVERIFIED`. No "should work". Platform-sensitive items
need physical-device evidence in `DEVICE_TEST_LOG.md` before V1 exits.

Status as of **Phase 1 (2026-09-26)**. Anything not listed as done is `UNVERIFIED`.

## A. Build and signing
| Item | Status |
|---|---|
| Watch app builds | UNVERIFIED (doesn't exist yet) |
| iPhone companion builds | UNVERIFIED |
| Complication extension builds | UNVERIFIED |
| Unit tests build (Swift) | UNVERIFIED |
| `Apple/Shared/*.swift` compiles | UNVERIFIED (never compiled) |
| Signed dev app installs on physical Watch | UNVERIFIED |
| App launches | UNVERIFIED |
| No secrets committed | UNIT_TESTED_ONLY: manual grep at Phase 1; `.gitignore` covers env and signing files |

## B. Character engine
| Item | Status |
|---|---|
| idle / listening / thinking / speaking / success / error / disconnected render | UNVERIFIED |
| Sprite frame timing (`SpriteAnimationClock`) | UNVERIFIED (not compiled; needs Swift unit tests) |
| Transitions deterministic | UNVERIFIED |
| Stale response can't overwrite current state | UNVERIFIED on Watch; protocol support: `TamagoResponse.answers(_:)` (not compiled) |
| View disappearance stops expensive animation | UNVERIFIED |
| 40 mm layout doesn't clip | UNVERIFIED |

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
| Secrets from env, not Git | UNIT_TESTED_ONLY (config tests; refuses to start without token) |
| Request logs have IDs | UNIT_TESTED_ONLY |
| Sensitive content not logged | UNIT_TESTED_ONLY |
| Runs on the owner's Mac mini | UNVERIFIED |

## I. Security
| Item | Status |
|---|---|
| No passcode bypass / wrist spoofing / private APIs / fake background sessions | Rule in `AGENTS.md`; UNVERIFIED in code (no app code yet) |
| Keychain for sensitive client config | UNVERIFIED |
| No raw Ollama exposed publicly | Gateway defaults to loopback; Ollama stays on its own loopback port. UNVERIFIED on owner's network |
| TLS/auth plan before remote/cellular | Stated in `ARCHITECTURE.md`; design not yet written |
| Separate authorization design for privileged tools | Not started |

## J. Battery sanity
15 min active animation · 15 min repeated requests · no runaway heat · no
aggressive offline retry · animation pauses when hidden · no hidden high-rate
timers. **All UNVERIFIED.**
