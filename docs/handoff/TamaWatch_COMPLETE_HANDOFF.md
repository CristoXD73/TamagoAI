# TamaWatch — Complete Multi-Agent Handoff Pack

This file combines all documents in the handoff pack.



---

# FILE: 00_READ_ME_FIRST.md

# TamaWatch Agent Handoff Pack — Read Me First

This pack is designed so multiple coding agents can collaborate **without all trying to finish the entire project independently**.

The project is intentionally split into bounded roles:

- **Claude Code Cloud** — GitHub-native setup, upstream repository analysis, protocol/server groundwork, documentation, tests, clean PRs.
- **Claude Opus in Xcode** — senior watchOS/Swift architecture, hard Apple-platform decisions, lifecycle, persistence, Always-On/foreground behavior, audio/networking architecture.
- **Claude Sonnet in Xcode** — primary Swift implementer for the Watch app, iPhone companion, complication, voice path, and transport once architecture is approved.
- **Codex** — independent build repair, regression review, concurrency/network review, targeted fixes, tests, and second-opinion auditing.
- **Human owner** — owns product decisions, physical-device testing, Apple signing, merge approval, and final acceptance.

The operating rule is simple:

> **No agent is allowed to treat "I wrote the code" as equivalent to "the feature works."**

For watchOS-specific features, the physical Apple Watch is the authority.

---

## Recommended reading order

Every agent should read:

1. `01_MASTER_PROJECT_BRIEF.md`
2. `02_CHRONOLOGICAL_EXECUTION_PLAN.md`
3. The handoff file written for that agent
4. `07_UPSTREAM_REUSE_MATRIX.md`
5. `08_ACCEPTANCE_TEST_PLAN.md`

Every agent must finish by updating:

- `09_HANDOFF_LOG_TEMPLATE.md` or the repository's actual `docs/HANDOFF_LOG.md`

---

## Project philosophy

The product is not "ChatGPT on a tiny screen."

The product is a **persistent animated AI companion** whose personality is expressed through:

- animation
- state
- voice
- haptics
- glanceable complication state
- very low-friction interaction

The Apple Watch is the **face and interaction endpoint**.

The user's Mac mini is the **AI brain and tool host**.

---

## Critical anti-waste rule

Do not spend expensive premium-model time on:

- project boilerplate
- copying open-source files blindly
- pretty colors
- naming
- trivial compile errors
- broad refactors without evidence
- speculative watchOS hacks
- features that cannot yet be tested end-to-end

Use premium time for:

- architecture
- Apple API constraints
- concurrency/lifecycle bugs
- transport decisions
- audio behavior
- physical-device issues

---

## Current upstreams worth studying

### WatchPet
Repository: `lkuczborski/WatchPet`

Useful because it already demonstrates:

- SwiftUI watchOS app
- animated pet rendering
- sprite-sheet concepts
- full-screen pet UI
- Digital Crown interaction
- local bridge architecture

### Q007
Repository: `chris-jk/Q007`

Useful because it already demonstrates:

- watchOS + iOS companion structure
- voice-first interaction
- WatchConnectivity
- TTS
- Keychain
- persistence
- AI service abstractions
- App Intents / Siri concepts

Both were confirmed as MIT-licensed at planning time.

Do not assume every third-party graphic asset loaded by those projects is also freely redistributable.

---

## The first milestone that matters

Before building a large AI system, prove this on the real Watch:

1. App launches.
2. Animated character fills the Watch nicely.
3. Character can switch between states.
4. App behaves acceptably when active/inactive.
5. A complication can show the character/state.
6. Voice interaction works.
7. Watch sends one request to the Mac.
8. Mac returns one structured response.
9. Character reacts and speaks.
10. The flow works repeatedly without getting stuck.

Everything after that becomes much safer to expand.


---

# FILE: 01_MASTER_PROJECT_BRIEF.md

# TamaWatch — Master Project Brief

## 1. End goal

Build a premium Tamagotchi-style AI companion for Apple Watch.

The experience should feel like a small living digital character rather than a miniature chat application.

The user may eventually dedicate a second Apple Watch entirely to this role and carry it without a wrist strap, like a charm/pocket companion. A GPS + Cellular model may also be purchased later so the companion can reach the home AI without depending on the iPhone when away from Wi‑Fi.

The Apple Watch should provide:

- display
- touch
- Digital Crown
- microphone
- speaker
- haptics
- local character rendering
- network client
- complication/widget presence
- lightweight state persistence

The Mac mini at home should provide:

- local AI inference
- optional speech-to-text
- optional text-to-speech
- tools/actions
- automation
- logging
- authentication
- model abstraction
- future integration with other local systems such as ÖccultKVM

---

## 2. Hardware known at project start

Current physical test Watch:

- Apple Watch SE 3
- 40 mm aluminum
- GPS
- 64 GB storage
- watchOS 27.0 at the beginning of the project

Current Watch is not cellular.

Important: **do not assume Always-On behavior from generic documentation alone. Verify the exact device/settings physically.** The project should support the maximum persistence watchOS legitimately allows, but should never rely on undocumented hacks.

Development environment:

- Apple-silicon Mac mini
- Xcode must be used for signing, build, simulator, and real-device deployment
- iPhone paired with the Watch
- Apple Developer account available for signing development builds

---

## 3. Product experience

### 3.1 Character-first UI

The character is the main interface.

The default screen should be visually dominated by the animated companion.

Text is secondary.

Target states:

- deep idle / sleeping
- idle / breathing
- curious / looking around
- listening
- acknowledgement / heard you
- thinking
- executing a tool
- speaking
- happy / success
- confused
- error
- disconnected
- needs attention

The UI should not feel like a list of chat bubbles.

---

### 3.2 Voice-first flow

Ideal interaction:

1. User opens or wakes the app.
2. Character is already present.
3. User taps/presses a simple interaction target.
4. Character immediately enters `listening`.
5. Voice is captured.
6. Request is routed to the Mac AI.
7. Character enters `thinking`.
8. AI result returns.
9. Character enters `speaking`.
10. Response is spoken and optionally shown in concise text.
11. Success/error haptic is played.
12. Character returns naturally to idle.

The app must avoid unnecessary navigation.

---

## 4. Persistence goals

The user wants the companion to feel "always there."

watchOS imposes real limits, so design across three surfaces.

### Surface A — full active app

This is the rich mode.

Allow:

- smooth animation
- touch
- Digital Crown
- microphone
- speaker
- haptics
- network requests
- full character state transitions

### Surface B — frontmost/inactive/reduced-luminance state

When the app remains visible but watchOS reduces activity:

- gracefully reduce animation
- settle character into a low-power pose
- do not assume continuous high-FPS animation
- do not run aggressive timers in the background
- resume fluid animation on return to active state

Physical testing is mandatory.

### Surface C — complication / WidgetKit

The complication is the persistent fallback surface.

It should:

- show recognizable character art/state
- reflect broad state such as sleeping, idle, thinking, ready, attention, offline
- open the full app when tapped
- not pretend to support continuously animated video

---

## 5. Off-wrist dedicated-device goal

A future Watch may be carried in a pocket/charm enclosure without being worn.

Important restrictions:

- the app must not attempt to bypass the Watch passcode
- the app must not spoof wrist detection
- the app must not use private Apple APIs
- device-level security choices remain user configuration

If the owner chooses to disable the passcode on a dedicated Watch, that is outside the app and must not be implemented as a hack.

---

## 6. Connectivity architecture

The Watch UI must not depend on one network route.

Create a transport abstraction.

Desired long-term routing:

1. direct Watch → Mac gateway on trusted Wi‑Fi
2. Watch → paired iPhone → Mac gateway
3. future cellular Watch → secure remote endpoint → home gateway

V1 only needs:

- direct local Wi‑Fi route
- iPhone relay fallback

Cellular readiness is architectural, not a V1 requirement.

---

## 7. Local AI architecture

Preferred topology:

```text
Apple Watch
   ↓
TransportRouter
   ├── DirectTransport
   └── PhoneRelayTransport
          ↓
      iPhone app
          ↓
      Mac Gateway
          ↓
  Local AI provider
          ↓
 Tools / local services
```

The Watch should not know what model is behind the gateway.

The Watch should not parse provider-specific output.

---

## 8. Mac Gateway responsibilities

The Mac Gateway should own:

- protocol versioning
- request IDs
- authentication
- model/provider selection
- local LLM integration
- future tool execution
- timeout handling
- structured errors
- logging
- health endpoint
- compatibility negotiation
- optional STT/TTS

The gateway should support a deterministic mock provider so the Watch can be developed even when the AI stack is unavailable.

---

## 9. Watch responsibilities

The Watch should own:

- character rendering
- character state machine
- microphone interaction
- local TTS if selected
- haptics
- user interaction
- local UI state
- cached configuration
- transport selection
- complication snapshot state

The Watch should not own:

- Ollama model selection
- provider credentials
- tool orchestration
- complex agent loops

---

## 10. Protocol philosophy

Keep protocol v1 small.

Example conceptual request:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "inputType": "text",
  "text": "Turn Jellyfin back on."
}
```

Example conceptual response:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "status": "ok",
  "text": "Jellyfin is back online.",
  "speechText": "Jellyfin is back online.",
  "characterState": "happy",
  "haptic": "success",
  "followUpExpected": false
}
```

Possible lifecycle states:

- accepted
- listening
- uploading
- thinking
- tool_running
- speaking
- complete
- error

Do not make protocol v1 huge.

---

## 11. Repository architecture

Suggested structure:

```text
TamaWatch/
├── README.md
├── CLAUDE.md
├── AGENTS.md
├── docs/
│   ├── MASTER_BRIEF.md
│   ├── EXECUTION_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── UPSTREAM_REUSE.md
│   ├── ACCEPTANCE_TESTS.md
│   ├── DEVICE_TEST_LOG.md
│   └── HANDOFF_LOG.md
├── Apple/
│   ├── WatchApp/
│   ├── iPhoneApp/
│   ├── Complication/
│   └── Shared/
├── Gateway/
│   ├── src/
│   ├── test/
│   └── mock/
└── scripts/
```

The local Xcode architect may adjust this if current Xcode/watchOS templates strongly prefer another organization.

---

## 12. Upstream reuse strategy

### WatchPet

Repository:
`lkuczborski/WatchPet`

Use as reference/adaptation source for:

- pet renderer
- sprite animation
- full-screen watch layout
- Digital Crown interaction
- simple local bridge pattern

Do not blindly fork the whole project.

### Q007

Repository:
`chris-jk/Q007`

Use as reference/adaptation source for:

- Watch/iPhone target layout
- WatchConnectivity
- speech/TTS
- Keychain
- persistence
- App Intents
- service abstraction

Do not preserve its cloud-provider-first architecture as the heart of TamaWatch.

TamaWatch is local-AI-first.

---

## 13. Engineering rules

1. Physical device beats assumptions.
2. No private APIs.
3. No fake background modes.
4. No secrets in Git.
5. No passcode bypass.
6. No wrist-detection spoofing.
7. Do not claim hardware verification without human evidence.
8. Prefer small PRs.
9. Keep model/network code separate from animation.
10. Document every reused upstream file.
11. Use original/licensed artwork.
12. Treat battery as a product constraint.
13. Prefer robust state machines over ad-hoc booleans.
14. Every async request needs cancellation and stale-response protection.

---

## 14. V1 definition

V1 is complete only when:

- signed app installs on the real Watch
- character animates
- core states work
- active/inactive behavior has been observed
- complication works and launches app
- voice input works
- Mac receives a request
- deterministic mock response works
- one real local AI request works
- response drives state/haptic/speech
- iPhone companion can configure gateway
- WatchConnectivity relay works physically
- offline/error states are graceful
- no credentials are committed
- setup is documented

---

## 15. Not V1

Do not spend early effort on:

- App Store launch
- perfect final artwork
- dozens of AI providers
- full cellular deployment
- cloud hosting
- camera features
- health features
- giant memory system
- dozens of tools
- private/custom watch face APIs
- jailbreak methods
- complex on-Watch agent frameworks


---

# FILE: 02_CHRONOLOGICAL_EXECUTION_PLAN.md

# TamaWatch — Chronological Multi-Agent Execution Plan

This schedule is designed around:

- approximately five valuable hours of Claude local/Xcode use
- Claude Code Cloud for repository-native groundwork
- small targeted Codex usage
- physical Apple Watch validation between stages

The order matters.

Do not jump ahead just because an agent offers to build more.

---

# Phase 0 — GitHub landing zone

**Actor:** Human owner  
**Premium AI time:** none

Create a new private GitHub repository.

Suggested temporary name:

`TamaWatch`

Do not add credentials.

Add the handoff documents from this pack.

Connect the repository to Claude Code Cloud.

### Exit condition

Claude Code Cloud can clone and read the repository.

---

# Phase 1 — Claude Code Cloud bootstrap

**Actor:** Claude Code Cloud  
**Recommended model:** Sonnet/default capable coding model  
**Goal:** make the repository useful before expensive local Swift work begins

Give Cloud:

`03_CLAUDE_CODE_CLOUD_HANDOFF.md`

Cloud should:

- create clean repository structure
- add `CLAUDE.md` and `AGENTS.md`
- audit WatchPet and Q007
- produce exact reuse matrix
- copy/adapt only justified MIT source
- preserve attribution
- avoid unverified third-party sprite assets
- create protocol v1 draft
- create deterministic Mac Gateway mock
- write gateway tests
- create fixture JSON for Watch-side tests
- create `HANDOFF_LOG.md`
- create `DEVICE_TEST_LOG.md`
- add CI only for work Cloud can honestly test

### Cloud must NOT

- claim Watch app builds on Linux/cloud
- fabricate Xcode signing
- say WatchConnectivity is tested
- say Always-On behavior is tested
- implement ten speculative watchOS features at once

### Exit condition

A PR exists with:

- docs
- protocol
- mock gateway
- tests
- upstream reuse plan
- no false hardware claims

---

# Phase 2 — Local environment capture

**Actor:** Human owner

On the Mac mini run:

```bash
pwd
sw_vers
uname -m
xcodebuild -version
xcode-select -p
swift --version
git --version
node --version 2>/dev/null || true
npm --version 2>/dev/null || true
```

Put output into:

`docs/LOCAL_ENVIRONMENT.md`

Open Xcode.

Confirm:

- developer account signed in
- Watch visible
- iPhone visible
- simulator runtimes available

Do not use premium Claude time yet if Xcode itself is not ready.

---

# Phase 3 — Opus architecture session

**Actor:** Claude Opus in Xcode  
**Time target:** 30–45 minutes

Give Opus:

`04_CLAUDE_OPUS_ARCHITECT_HANDOFF.md`

Its job is not feature implementation.

It must decide:

- target structure
- deployment targets
- state model
- renderer strategy
- Watch lifecycle strategy
- complication strategy
- direct networking architecture
- WatchConnectivity architecture
- voice capture path
- TTS path
- persistence boundaries
- concurrency model
- what upstream code should actually be reused

Write decisions into:

`docs/DECISIONS.md`

### Exit condition

There is a clear design with reasons and fallbacks.

---

# Phase 4 — Sonnet physical vertical slice

**Actor:** Claude Sonnet in Xcode  
**Time target:** 45–60 minutes

Give Sonnet:

`05_CLAUDE_SONNET_SWIFT_HANDOFF.md`

Run only **Stage A** of that document.

Build:

- Watch target
- full-screen character
- simple original placeholder animation
- state machine
- debug state controls

States:

- idle
- listening
- thinking
- speaking
- success
- error

No networking yet.

No AI yet.

No elaborate settings.

Install on physical Watch.

### Human tests

- animation
- screen active/inactive
- wrist raise/lower
- Crown
- cover-to-sleep
- relaunch
- any Always-On behavior available on this exact device/settings
- app persistence/Return to Clock behavior

Write results to:

`docs/DEVICE_TEST_LOG.md`

### Exit condition

A stable animated companion exists on the real Watch.

---

# Phase 5 — Codex review #1

**Actor:** Codex  
**Budget:** small

Give Codex:

`06_CODEX_HANDOFF.md`

Set mode:

`BUILD_REVIEW`

Codex runs:

- xcodebuild simulator checks
- unit tests
- concurrency warnings
- state-machine tests
- lifecycle review
- secret scan

Codex fixes only reproducible problems.

### Exit condition

Clean build or a precise unresolved issue list.

---

# Phase 6 — Sonnet complication/persistence surface

**Actor:** Claude Sonnet  
**Time target:** 30–40 minutes

Build WidgetKit complication.

Requirements:

- recognizable character
- broad state snapshot
- tap launches app
- no fake continuous animation
- shared cached state through supported mechanisms
- appropriate reduced-luminance design

Physical test on a real watch face.

### Exit condition

The Tamagotchi remains glanceable even when the app is not frontmost.

---

# Phase 7 — Sonnet voice loop without network

**Actor:** Claude Sonnet  
**Time target:** 40–50 minutes

Implement:

tap → voice capture/dictation → fake local answer → speaking state → TTS → idle

Do this **before networking**.

Test:

- permission
- cancellation
- empty input
- repeated input
- interruption
- speaker
- haptics
- UI state recovery

### Exit condition

A complete fake conversation works entirely on the Watch.

---

# Phase 8 — Cloud gateway hardening

**Actor:** Claude Code Cloud

Now that Swift models are real, update Cloud-side protocol/server work.

Tasks:

- align protocol fixtures with Swift Codable models
- add `/health`
- add version negotiation
- add request IDs
- add malformed-response fixtures
- add timeout fixtures
- add deterministic provider
- add local-AI provider abstraction
- add an Ollama-compatible adapter if useful
- add environment-based auth configuration
- never commit secrets
- add tests that do not require Ollama

### Exit condition

Gateway is deterministic and testable with or without local AI.

---

# Phase 9 — Sonnet direct Watch-to-Mac transport

**Actor:** Claude Sonnet  
**Time target:** 40–50 minutes

Implement direct transport using high-level Apple networking.

Requirements:

- URLSession
- cancellation
- timeout
- health check
- version check
- request ID
- stale-response rejection
- structured error mapping
- no aggressive retry loop

Test:

physical Watch → Mac mock gateway → Watch

Then:

physical Watch → Mac gateway → local AI → Watch

### Exit condition

One real local AI question completes end-to-end.

---

# Phase 10 — Sonnet iPhone companion + relay

**Actor:** Claude Sonnet  
**Time target:** 45–60 minutes

Build only after direct path works.

iPhone app responsibilities:

- gateway URL config
- connection test
- secure token storage
- sync config to Watch
- relay request when direct path unavailable
- diagnostics

TransportRouter order:

1. direct transport
2. iPhone relay
3. offline state

Physically test WatchConnectivity.

### Exit condition

With direct route intentionally disabled:

Watch → iPhone → Mac → iPhone → Watch

works.

---

# Phase 11 — Codex concurrency/network audit

**Actor:** Codex  
**Budget:** small

Set mode:

`TRANSPORT_AUDIT`

Review:

- duplicate responses
- stale request completion
- cancellation
- actor isolation
- MainActor usage
- relay/direct races
- timeouts
- network retries
- JSON failure
- secrets
- retained tasks
- hidden timers

### Exit condition

No known race that can make an old answer overwrite a new interaction.

---

# Phase 12 — Opus reserve

**Actor:** Claude Opus  
**Use remaining premium time only when necessary**

Use Opus for:

- stubborn watchOS lifecycle issue
- difficult signing/entitlement problem
- nontrivial concurrency architecture bug
- audio session issue
- incorrect transport abstraction
- unexpected physical-device behavior

Do not use Opus for cosmetics.

---

# Phase 13 — Sonnet polish

Only after end-to-end flow works.

Improve:

- transition timing
- facial/character expressiveness
- haptic vocabulary
- low-power pose
- 40 mm optimization
- Crown interaction
- accessibility
- compact response text
- animation caching
- battery behavior

---

# Phase 14 — Cellular readiness

Do not require cellular hardware yet.

Verify architecture does not assume:

- LAN-only hostnames
- permanent iPhone availability
- WatchConnectivity as the only route

Before exposing anything remotely:

- TLS
- authentication
- rate limits
- narrow gateway exposure
- no direct raw Ollama exposure

Cellular deployment is a later secure-networking stage.

---

# Suggested use of the five Claude local hours

Approximate allocation:

| Work | Model | Time |
|---|---|---:|
| Architecture adjudication | Opus | 35 min |
| Physical Watch vertical slice | Sonnet | 55 min |
| Complication/persistence | Sonnet | 35 min |
| Voice/TTS loop | Sonnet | 45 min |
| Direct transport | Sonnet | 45 min |
| iPhone relay | Sonnet | 50 min |
| Difficult-bug reserve | Opus | 15–30 min |

The goal is to finish the five hours with **a working physical vertical slice**, not the most lines of code.


---

# FILE: 03_CLAUDE_CODE_CLOUD_HANDOFF.md

# Handoff — Claude Code Cloud

## Your role

You are the **repository foundation and integration agent**.

You are working in a GitHub-connected remote sandbox.

You are **not** the final watchOS implementer.

Your work should make the next local Xcode agents dramatically faster and safer.

---

## Read first

Read:

- `01_MASTER_PROJECT_BRIEF.md`
- `02_CHRONOLOGICAL_EXECUTION_PLAN.md`
- `07_UPSTREAM_REUSE_MATRIX.md`
- `08_ACCEPTANCE_TEST_PLAN.md`

If the repository already contains `CLAUDE.md`, follow it.

---

## Primary mission

Prepare a clean repository that lets local Claude/Codex immediately focus on real Apple-device work.

Your highest-value tasks are:

1. repository organization
2. upstream-source analysis
3. protocol design
4. deterministic Mac Gateway mock
5. tests
6. documentation
7. reusable Swift source extraction only when clearly justified

---

## Upstream repositories

Study:

### WatchPet
`https://github.com/lkuczborski/WatchPet`

Relevant areas:

- `WatchPet/Views/PetAvatarView.swift`
- `WatchPet/Views/PetDashboardView.swift`
- `WatchPet/Views/PetSwitcherView.swift`
- Models
- Stores
- `bridge/`

Questions to answer:

- what animation mechanism is actually used?
- how are frame states represented?
- what code is generic enough to reuse?
- what is tied specifically to Codex?
- what can be rewritten smaller?
- what uses polling?
- what assumes localhost/LAN?
- what is safe to adapt under MIT?

### Q007
`https://github.com/chris-jk/Q007`

Relevant areas:

- `Q007 Watch App/Services/AIService.swift`
- `KeychainService.swift`
- `PersistenceService.swift`
- `SpeechService.swift`
- `WatchConnectivityManager.swift`
- Intents
- ViewModels
- `Q007 iOS App`
- `Shared`

Questions:

- what is reusable without keeping cloud-provider architecture?
- how is WatchConnectivity activated?
- how are credentials moved/stored?
- how does TTS work?
- what APIs are likely to require local watchOS 27 verification?
- what source should be adapted vs rewritten?

---

## Deliverable 1 — repository structure

Create or normalize:

```text
docs/
Apple/
Gateway/
Tests/
scripts/
```

Do not manufacture a giant Xcode project if the cloud environment cannot validate it.

It is acceptable to leave Xcode project generation to the local architect.

---

## Deliverable 2 — agent instruction files

Create:

- `CLAUDE.md`
- `AGENTS.md`

These must contain:

- bounded-role rule
- no-secrets rule
- no-private-API rule
- no fake background modes
- physical-device verification labels
- handoff logging
- small PR expectation
- upstream attribution requirement

---

## Deliverable 3 — upstream reuse report

Create:

`docs/UPSTREAM_REUSE.md`

For every relevant component:

| Upstream | File | Action | Reason | License action | Needs local verification |
|---|---|---|---|---|---|

Allowed actions:

- COPY
- ADAPT
- REWRITE_FROM_CONCEPT
- REFERENCE_ONLY
- REJECT

Do not copy entire repos into ours.

Do not import pet sprite assets merely because source code is MIT.

---

## Deliverable 4 — protocol v1

Create:

`docs/PROTOCOL_V1.md`

Keep it intentionally small.

Define:

### Request
- protocolVersion
- requestId
- input type
- text
- optional capability metadata

### Response
- protocolVersion
- requestId
- status
- text
- speechText
- characterState
- haptic
- followUpExpected
- error code/message where needed

Define exact enum strings.

Avoid provider-specific fields.

Add JSON fixtures under:

`Tests/Fixtures/`

Include:

- success
- thinking/accepted
- tool success
- timeout representation
- malformed payload
- unsupported protocol version
- gateway unavailable
- auth failure

---

## Deliverable 5 — deterministic Mac Gateway

Implement a minimal gateway that can run in the cloud sandbox.

Preferred characteristics:

- simple
- dependency-light
- documented
- testable
- no credentials required
- deterministic mock provider

Required endpoints or equivalents:

- health
- version/protocol info
- request endpoint

The mock provider should map predictable prompts to predictable responses.

Example:

`ping` → `pong`

`state happy` → response with `characterState = happy`

This is for Swift client development.

Do not make Ollama mandatory for tests.

---

## Deliverable 6 — provider interface

Define a clean provider abstraction.

Example conceptual interface:

```text
AIProvider
  generate(request) -> structured result
```

Create:

- MockProvider
- optional OllamaProvider adapter

Ollama provider can remain `UNVERIFIED_LOCAL_PROVIDER` in Cloud.

Do not claim it was tested against the user's Mac.

---

## Deliverable 7 — automated tests

Tests should verify:

- protocol encoding/decoding
- request IDs
- malformed body handling
- unsupported protocol version
- provider exception
- timeout behavior
- auth missing
- deterministic mock behavior

If adding CI, CI must test only what the Cloud environment can honestly execute.

---

## Deliverable 8 — handoff documentation

Create:

`docs/HANDOFF_LOG.md`

End your work with:

- branch name
- commit hash
- files created
- files adapted from upstream
- exact upstream commit/revision if possible
- tests run
- tests passed
- tests not possible
- next local-Xcode task

---

## Forbidden scope

Do not:

- "finish" TamaWatch
- invent an Xcode signing setup
- claim simulator/device success
- claim WatchConnectivity success
- claim Always-On success
- add App Store configuration
- add cloud AI provider keys
- expose a public home-server endpoint
- build complex agent memory
- add 10 features because they seem useful

---

## Definition of success

You succeed when the next local agent can open the repository and immediately say:

> "The boring repository, protocol, mock-server, fixtures, attribution, and basic integration groundwork are already organized, so I can spend my limited Xcode time on the actual Watch."


---

# FILE: 04_CLAUDE_OPUS_ARCHITECT_HANDOFF.md

# Handoff — Claude Opus in Xcode

## Your role

You are the **senior watchOS/Swift architect**.

You are not the bulk implementer.

Your job is to make the difficult decisions correctly before Sonnet spends time writing the application.

Target this session at roughly **30–45 minutes**.

---

## Read first

Read:

- `01_MASTER_PROJECT_BRIEF.md`
- `02_CHRONOLOGICAL_EXECUTION_PLAN.md`
- repository `CLAUDE.md`
- `docs/UPSTREAM_REUSE.md`
- `docs/PROTOCOL_V1.md`
- latest `docs/HANDOFF_LOG.md`
- `docs/LOCAL_ENVIRONMENT.md`

Inspect the actual Xcode project if Cloud created one.

Inspect the current SDK, not just memory of older watchOS releases.

---

## First action

Before changing code, report:

1. Xcode version
2. Swift version
3. Watch deployment target
4. current targets/schemes
5. whether the physical Watch is visible
6. files you expect to modify
7. decisions you intend to make
8. things you will deliberately leave to Sonnet

---

## Decision 1 — project/target structure

Decide the exact structure for:

- Watch app
- iPhone companion
- complication WidgetKit extension
- shared Swift models
- test targets

Prefer the simplest structure current Xcode supports cleanly.

Decide whether XcodeGen adds value or unnecessary complexity.

Do not use a generator merely because Q007 uses one.

---

## Decision 2 — character rendering

Evaluate:

### Option A
SwiftUI + TimelineView + image/frame changes

### Option B
SpriteKit embedded inside SwiftUI

### Option C
another public Apple animation approach

Criteria:

- smoothness on 40 mm Watch
- active rendering
- reduced-luminance behavior
- memory
- battery
- ease of state transition
- ability to test
- compatibility with original sprite/animation assets

Write the chosen strategy and rejected alternatives to `docs/DECISIONS.md`.

Do not optimize for theoretical maximum FPS if watchOS will throttle inactive updates.

---

## Decision 3 — character state machine

Define one canonical state enum.

Example:

```swift
enum CharacterState {
    case sleeping
    case idle
    case listening
    case acknowledging
    case thinking
    case toolRunning
    case speaking
    case success
    case confused
    case error
    case disconnected
}
```

Decide:

- which states are transient
- allowed transitions
- how network response IDs prevent stale state
- how cancellation returns to idle
- how complication maps rich state to a small snapshot set

Keep UI state separate from network implementation.

---

## Decision 4 — lifecycle / persistence

Inspect current watchOS APIs.

Decide:

- scene phase handling
- reduced-luminance handling
- whether TimelineView is appropriate
- which animation stops when inactive
- how state survives app suspension
- what can and cannot remain live

Important:

Do not promise indefinite high-refresh animation.

Do not add fake background modes.

Do not claim behavior until human physical testing reports it.

---

## Decision 5 — complication

Specify:

- WidgetKit extension
- complication families to support first
- shared state mechanism
- update strategy
- deep-link/open-app behavior
- reduced-luminance visual behavior

Treat the complication as a **state snapshot**, not a miniature live game engine.

---

## Decision 6 — voice

Choose the initial Watch voice path.

Questions:

- speech recognition locally through supported APIs?
- record audio and send to Mac?
- hybrid?
- what permissions are required?
- how does cancellation work?
- what is easiest for V1?

Also choose TTS strategy:

### Option A
Watch local speech synthesis

### Option B
Mac-generated audio streamed/downloaded

For V1, prefer reliability and low latency over custom voices.

---

## Decision 7 — transport

Define protocol:

```swift
protocol TamaTransport {
    func healthCheck() async throws -> ...
    func send(_ request: ...) async throws -> ...
}
```

Implementations later:

- DirectTransport
- PhoneRelayTransport
- future RemoteTransport

Decide:

- cancellation model
- timeout
- actor isolation
- request ID handling
- stale-response protection
- route selection

No persistent low-level socket architecture unless clearly justified by current watchOS requirements.

---

## Decision 8 — WatchConnectivity

Specify exactly what uses:

- `sendMessage`
- application context
- background transfer

Do not treat them as interchangeable.

The relay path is secondary to direct transport, not the whole architecture.

Physical Watch/iPhone testing is required.

---

## Decision 9 — settings/security

Decide:

- what config lives on iPhone
- what is synced to Watch
- what belongs in Keychain
- what never belongs on Watch
- how gateway auth tokens are represented

Do not modify user signing/bundle IDs without approval.

---

## Required output

Write:

`docs/DECISIONS.md`

Include for each decision:

- decision
- reason
- alternatives considered
- risks
- device verification required
- rollback/fallback

Also update:

`docs/HANDOFF_LOG.md`

---

## You may create

A minimal project skeleton if necessary to validate architecture.

Do not spend the session implementing:

- polished views
- final artwork
- multiple providers
- full gateway
- cellular networking
- broad settings UI

---

## Success condition

Sonnet should be able to start implementing without needing to revisit fundamental architecture every 20 minutes.


---

# FILE: 05_CLAUDE_SONNET_SWIFT_HANDOFF.md

# Handoff — Claude Sonnet in Xcode

## Your role

You are the **primary Swift/watchOS implementer**.

You execute the approved architecture.

Do not independently redesign the whole project.

Read `docs/DECISIONS.md` before each session.

---

# Stage A — Physical Watch character vertical slice

## Goal

Get a real animated character running reliably on the real Apple Watch before networking/AI.

## Implement

- Watch app target
- root character screen
- canonical `CharacterState`
- character renderer chosen by Opus
- original placeholder art/assets
- debug control to force:
  - idle
  - listening
  - thinking
  - speaking
  - success
  - error
- basic haptic mapping if trivial

## Do not implement yet

- AI
- gateway
- WatchConnectivity
- settings app
- cloud
- cellular
- complex persistence

## Test

Simulator:

- clean build
- no layout clipping at 40 mm size
- state transitions

Physical Watch:

- launch
- animation
- inactivity
- wrist lower/raise
- Crown
- app reopen
- cover-to-sleep
- any Always-On/reduced-luminance behavior available on actual device
- Return to Clock settings as configured by the owner

Record exact observations.

---

# Stage B — WidgetKit complication

## Goal

Keep character visually present even when app is not frontmost.

## Implement

- WidgetKit complication extension
- shared compact character snapshot model
- broad state mapping
- deep link/open app
- placeholder
- offline state
- reduced-luminance-friendly visuals

## Do not

- fake continuous animation
- poll rapidly
- assume complication updates are immediate

## Physical test

- add complication
- trigger state change
- observe eventual update
- tap complication
- verify app launch

---

# Stage C — Voice loop with fake response

## Goal

Prove microphone/TTS interaction independently of networking.

## Flow

```text
idle
→ user starts input
→ listening
→ capture input
→ local fake "thinking"
→ speaking
→ TTS
→ idle
```

## Requirements

- permission flow
- cancellation
- empty input
- repeated interactions
- interruption recovery
- audio session cleanup
- haptic acknowledgement

Use Q007 only as an implementation reference where still appropriate for current SDK.

Do not copy stale APIs without compiling.

---

# Stage D — Direct Watch → Mac transport

Implement the Opus-approved transport protocol.

## Requirements

- URLSession/high-level API
- typed Codable models
- health check
- protocol version
- request ID
- timeout
- cancellation
- stale-response rejection
- structured error mapping

## Important state rule

If request A is started, then request B starts, a late response for A must never overwrite B's state.

Test this explicitly.

## Network retry rule

Do not create a battery-draining rapid reconnect loop.

Use deliberate backoff.

---

# Stage E — iPhone companion

## iPhone app responsibilities

- gateway address
- connection test
- auth token entry/storage
- send config to Watch
- diagnostics
- relay path

The iPhone app should not become the primary AI brain.

---

# Stage F — WatchConnectivity relay

Use the approved design.

Requirements:

- preserve request ID
- preserve cancellation semantics where possible
- distinguish direct route vs relay in diagnostics
- route result back to same Watch request
- friendly unreachable state

Test physically.

Do not claim final verification from simulator alone.

---

# Stage G — character polish

Only after full round trip works.

Improve:

- idle breathing
- eye movement
- listening reaction
- thinking loop
- speaking loop
- success burst
- error personality
- transitions
- Crown behavior
- haptic vocabulary
- text layout
- reduced-luminance pose

Optimization:

- predecode/cache assets where reasonable
- avoid hidden high-rate timers
- suspend expensive work when inactive
- measure memory/CPU rather than guessing

---

## Swift engineering requirements

Use modern Swift concurrency.

Prefer:

- async/await
- actors where shared mutable state warrants them
- `@MainActor` for UI state
- explicit Task cancellation
- typed errors

Avoid:

- nested callback pyramids
- global mutable state
- scattered booleans for lifecycle
- timers that never invalidate
- force unwraps in network paths

---

## Handoff after each stage

Update `docs/HANDOFF_LOG.md` with:

- stage
- branch/commit
- files changed
- simulator tests
- physical tests
- exact failures
- verification labels

Use:

- DEVICE_VERIFIED
- SIMULATOR_VERIFIED_ONLY
- UNIT_TESTED_ONLY
- UNVERIFIED

Never write "works on Watch" unless the human actually tested it.


---

# FILE: 06_CODEX_HANDOFF.md

# Handoff — Codex

## Your role

You are the **independent relay runner, reviewer, and repair agent**.

You are not the primary product architect.

Do not rewrite working architecture just because you prefer another style.

Read:

- `01_MASTER_PROJECT_BRIEF.md`
- `02_CHRONOLOGICAL_EXECUTION_PLAN.md`
- `docs/DECISIONS.md`
- `docs/HANDOFF_LOG.md`
- repository `AGENTS.md`

---

# Mode: BUILD_REVIEW

Use after the first physical Watch vertical slice.

## Tasks

1. Show current branch.
2. Show dirty/clean status.
3. Preserve uncommitted user/Claude work.
4. Identify schemes.
5. Run supported `xcodebuild` checks.
6. Run unit tests.
7. inspect compiler warnings.
8. inspect Swift concurrency warnings.
9. inspect lifecycle/state-machine logic.
10. inspect accidental secrets or hard-coded personal data.

## Fix only

- reproducible compile failures
- reproducible tests
- clear lifecycle bugs
- obvious resource leaks
- obvious race bugs

## Do not

- redesign UI
- add features
- rename targets
- alter signing
- change protocol without coordination

---

# Mode: TRANSPORT_AUDIT

Use after direct + iPhone relay paths exist.

## Attack these cases

### Race 1
Request A starts.
Request B starts.
Response A arrives late.

Expected:
A is ignored if B is current.

### Race 2
Direct route and phone relay are both attempted.

Expected:
Only one response completes the logical request.

### Race 3
User cancels during network request.

Expected:
Task cancels and state exits gracefully.

### Race 4
Watch becomes inactive while response arrives.

Expected:
State is preserved safely and UI updates when appropriate.

### Race 5
Gateway sends malformed JSON.

Expected:
structured error state.

### Race 6
Gateway is unreachable.

Expected:
no tight retry loop.

### Race 7
Phone is not reachable.

Expected:
fallback/offline state, no crash.

### Race 8
Same request ID appears twice.

Expected:
duplicate is rejected/ignored.

---

# Security audit

Search for:

- hard-coded IPs
- API keys
- auth tokens
- bundle signing material
- private certificates
- public-tunnel secrets
- sensitive logging

Hard-coded development defaults are acceptable only if clearly non-secret and documented.

---

# Battery sanity audit

Look for:

- unbounded timers
- 60 Hz work while invisible
- constant health polling
- retry loops
- continuous networking
- animation work that survives view disappearance

---

# Output format

Do not simply say "looks good."

Produce:

## Reproduced defects
- defect
- command/test
- evidence

## Fixed defects
- file
- change
- reason

## Unverified concerns
- concern
- why not verified

## Commands run
Exact commands.

## Verification level
For each area:

- UNIT_TESTED_ONLY
- SIMULATOR_VERIFIED_ONLY
- DEVICE_VERIFIED only if human evidence already exists

Update `docs/HANDOFF_LOG.md`.


---

# FILE: 07_UPSTREAM_REUSE_MATRIX.md

# TamaWatch — Upstream Reuse Matrix

The purpose is to reuse groundwork deliberately, not turn the project into a fragile mash-up.

---

## WatchPet

Repository:

`https://github.com/lkuczborski/WatchPet`

License at planning time:

MIT

Known relevant structure:

- `WatchPet/Views/PetAvatarView.swift`
- `WatchPet/Views/PetDashboardView.swift`
- `WatchPet/Views/PetSwitcherView.swift`
- `WatchPet/Models`
- `WatchPet/Stores`
- `bridge/`

### Initial decisions

| Component | Action | Why |
|---|---|---|
| PetAvatarView | ADAPT | useful animation/frame-rendering groundwork |
| PetDashboardView | REFERENCE_ONLY | useful full-screen layout ideas but Codex-specific state |
| PetSwitcherView | REFERENCE_ONLY / ADAPT SMALL PIECES | Crown interaction useful |
| Codex bridge | REWRITE_FROM_CONCEPT | local bridge idea is useful, but our gateway has different responsibilities |
| Codex session parsing | REJECT | not relevant to local-AI companion |
| Codex pet assets | DO NOT REDISTRIBUTE BY DEFAULT | source-code license does not prove sprite redistribution rights |

---

## Q007

Repository:

`https://github.com/chris-jk/Q007`

License at planning time:

MIT

Known relevant Watch services:

- `AIService.swift`
- `KeychainService.swift`
- `PersistenceService.swift`
- `SpeechService.swift`
- `WatchConnectivityManager.swift`

Known project structure:

- `Q007 Watch App`
- `Q007 iOS App`
- `Shared`

### Initial decisions

| Component | Action | Why |
|---|---|---|
| WatchConnectivityManager | ADAPT / REWRITE | valuable starting point; must verify current watchOS behavior |
| SpeechService | ADAPT | TTS groundwork |
| KeychainService | ADAPT | credential-storage pattern |
| PersistenceService | ADAPT | lightweight state storage |
| iPhone companion structure | REFERENCE_ONLY | useful target split |
| App Intents | DEFER/REFERENCE | valuable later, not needed for first vertical slice |
| AIService provider clients | REJECT FOR CORE | project is local-AI-first, not cloud-provider-first |
| provider picker UI | REJECT FOR V1 | unnecessary complexity |

---

## Required attribution record

If source is copied/adapted, create an entry:

```text
Source repository:
Source file:
Source commit:
License:
Local file:
Nature of modification:
Copyright notice preserved:
```

Keep the original MIT license notices required by the license.

---

## Decision rule

Before reusing source, ask:

1. Does it reduce meaningful work?
2. Is the API still appropriate on watchOS 27?
3. Is the code more valuable than a smaller clean rewrite?
4. Can we test it?
5. Does it drag in cloud/provider assumptions we do not want?
6. Are its assets legally redistributable?

If answer 2, 4, or 6 is unclear, do not blindly copy.

---

## Apple APIs are the authority

Upstream projects are references.

Current Xcode/SDK behavior wins when an upstream implementation is stale or deprecated.


---

# FILE: 08_ACCEPTANCE_TEST_PLAN.md

# TamaWatch — Acceptance Test Plan

Every result must be labeled:

- `DEVICE_VERIFIED`
- `SIMULATOR_VERIFIED_ONLY`
- `UNIT_TESTED_ONLY`
- `UNVERIFIED`

Do not use vague wording such as "should work."

---

# A. Build and signing

- [ ] Watch app builds.
- [ ] iPhone companion builds.
- [ ] complication extension builds.
- [ ] unit tests build.
- [ ] signed development app installs on physical Watch.
- [ ] app launches.
- [ ] no secrets committed.

---

# B. Character engine

- [ ] idle animation
- [ ] listening state
- [ ] thinking state
- [ ] speaking state
- [ ] success state
- [ ] error state
- [ ] disconnected state
- [ ] transitions are deterministic
- [ ] stale response cannot overwrite current state
- [ ] view disappearance stops expensive animation
- [ ] 40 mm layout does not clip essential content

---

# C. Persistence/frontmost behavior

Physical device only for final verdict.

- [ ] active animation observed
- [ ] screen inactivity observed
- [ ] wrist lower/raise observed
- [ ] Crown dismissal behavior recorded
- [ ] cover-to-sleep behavior recorded
- [ ] reopen behavior recorded
- [ ] Return to Clock configuration tested
- [ ] any available Always-On/reduced-luminance behavior documented
- [ ] app does not assume high FPS while inactive

---

# D. Complication

- [ ] complication is selectable
- [ ] recognizable character shown
- [ ] broad state shown
- [ ] offline state shown
- [ ] tap launches full app
- [ ] no claim of continuous animation
- [ ] state update timing observed

---

# E. Voice

- [ ] permission flow
- [ ] start capture
- [ ] cancel
- [ ] empty input
- [ ] repeated inputs
- [ ] interruption recovery
- [ ] TTS audible
- [ ] speaking state synchronized reasonably
- [ ] audio session releases correctly

---

# F. Direct networking

- [ ] health check
- [ ] protocol version check
- [ ] request ID
- [ ] timeout
- [ ] cancellation
- [ ] malformed JSON
- [ ] 500 response
- [ ] unauthorized response
- [ ] duplicate response
- [ ] stale response
- [ ] physical Watch reaches Mac mock gateway
- [ ] physical Watch reaches real local AI

---

# G. iPhone relay

- [ ] WatchConnectivity session activates
- [ ] config syncs
- [ ] relay request works
- [ ] response returns with same request ID
- [ ] direct route intentionally disabled during test
- [ ] iPhone unavailable handled gracefully
- [ ] delayed relay response cannot overwrite newer request
- [ ] physical Watch+iPhone used for final verification

---

# H. Gateway

- [ ] one-command startup
- [ ] health endpoint
- [ ] deterministic mock provider
- [ ] one local AI adapter
- [ ] provider failure → structured error
- [ ] tests run without Ollama
- [ ] secrets from env/config not Git
- [ ] request logs have IDs
- [ ] sensitive content not unnecessarily logged

---

# I. Security

- [ ] no passcode bypass
- [ ] no wrist-detection spoofing
- [ ] no private Apple APIs
- [ ] no fake workout/location/audio background session
- [ ] Keychain used for sensitive client config where appropriate
- [ ] no raw Ollama endpoint exposed publicly
- [ ] TLS/auth plan exists before cellular/remote stage
- [ ] future privileged tool actions have separate authorization design

---

# J. Battery sanity

Not a laboratory benchmark.

Record observed battery percentage and device temperature subjectively.

- [ ] 15 min active animation
- [ ] 15 min repeated requests
- [ ] no obvious runaway heat
- [ ] no aggressive retry loop while offline
- [ ] animation pauses/reduces when hidden
- [ ] no hidden persistent high-rate timers

---

# V1 exit gate

V1 is not complete until platform-sensitive features have physical-device evidence.


---

# FILE: 09_HANDOFF_LOG_TEMPLATE.md

# TamaWatch — Handoff Log

Use one entry per agent task.

---

## Entry template

### Date / time
YYYY-MM-DD HH:MM

### Agent
Claude Code Cloud / Claude Opus / Claude Sonnet / Codex / Human

### Assigned task
One concise sentence.

### Branch
`branch-name`

### Commit(s)
`hash`

### Files changed
- file
- file

### Upstream source reused
If none, write `None`.

If used:
- repository
- file
- commit
- license
- local destination

### Tests run
Exact commands.

### Passed
- item

### Failed
- item

### Physical-device evidence
- item
- verification label

### Unverified
- item

### Known risks
- item

### Next recommended task
One bounded next step.

### Do not redo
List work that is already complete so the next agent does not waste time.


---

# FILE: 10_COPY_PASTE_PROMPTS.md

# Copy-Paste Prompts for Each Agent

These are short launcher prompts.

Attach or place the full handoff documents in the repository. Do not paste the entire project history into every session if the agent can read the repo.

---

# Claude Code Cloud — first session

```text
You are the GitHub/repository foundation agent for TamaWatch.

Before doing anything, read:
- 01_MASTER_PROJECT_BRIEF.md
- 02_CHRONOLOGICAL_EXECUTION_PLAN.md
- 03_CLAUDE_CODE_CLOUD_HANDOFF.md
- 07_UPSTREAM_REUSE_MATRIX.md
- 08_ACCEPTANCE_TEST_PLAN.md

Your scope is Phase 1 only.

Do not attempt to finish the Apple Watch app.
Do not claim Xcode, simulator, WatchConnectivity, Always-On, signing, or physical-device verification.

Audit WatchPet and Q007, build the repository/documentation/protocol/mock-gateway/test foundation, preserve MIT attribution, and prepare a clean PR for the local Xcode agents.

Before editing, summarize:
1. what you will do,
2. files you expect to create/change,
3. what you will explicitly not do.

At the end, update the handoff log with exact tests and verification limits.
```

---

# Claude Opus — architecture session

```text
You are the senior watchOS architect for TamaWatch.

Read:
- 01_MASTER_PROJECT_BRIEF.md
- 02_CHRONOLOGICAL_EXECUTION_PLAN.md
- 04_CLAUDE_OPUS_ARCHITECT_HANDOFF.md
- docs/UPSTREAM_REUSE.md
- docs/PROTOCOL_V1.md
- docs/LOCAL_ENVIRONMENT.md
- docs/HANDOFF_LOG.md

Your scope is architecture adjudication, not bulk implementation.

Inspect the actual Xcode/Swift/watchOS SDK available locally. Decide the target structure, renderer, state machine, lifecycle, persistence/Always-On strategy, complication architecture, voice path, TTS path, transport abstraction, WatchConnectivity role, and concurrency model.

Write decisions with reasons and fallbacks to docs/DECISIONS.md.

Do not spend this session polishing views or building unrelated features.
```

---

# Claude Sonnet — Stage A

```text
You are the primary Swift implementer for TamaWatch.

Read:
- 01_MASTER_PROJECT_BRIEF.md
- 02_CHRONOLOGICAL_EXECUTION_PLAN.md
- 05_CLAUDE_SONNET_SWIFT_HANDOFF.md
- docs/DECISIONS.md
- docs/HANDOFF_LOG.md

Execute Stage A only: get the character vertical slice running on the real Apple Watch.

Do not add networking, AI, WatchConnectivity, or broad settings yet.

Build a clean state-driven character surface with manual debug state switching for idle/listening/thinking/speaking/success/error.

Compile, run in simulator, then guide the human through physical Watch testing.

Update the handoff log and clearly label what was device-verified vs simulator-only.
```

---

# Codex — first review

```text
You are the independent build/review agent for TamaWatch.

Read:
- 01_MASTER_PROJECT_BRIEF.md
- 02_CHRONOLOGICAL_EXECUTION_PLAN.md
- 06_CODEX_HANDOFF.md
- AGENTS.md
- docs/DECISIONS.md
- docs/HANDOFF_LOG.md

Mode: BUILD_REVIEW.

Do not redesign the architecture.

First show branch and git status. Preserve all existing work. Reproduce problems before fixing them. Run build/tests, inspect concurrency/lifecycle/state-machine issues, and fix only concrete defects.

End with exact commands, results, changed files, unresolved issues, and verification labels.
```

---

# Codex — transport audit

```text
You are the independent transport/concurrency auditor for TamaWatch.

Read the project brief, Codex handoff, decisions, protocol, and latest handoff log.

Mode: TRANSPORT_AUDIT.

Focus only on:
- stale responses,
- duplicate request completion,
- direct-vs-relay races,
- cancellation,
- actor/MainActor correctness,
- timeouts,
- malformed responses,
- network backoff,
- retained tasks,
- secrets.

Add focused tests where possible.

Do not add features or redesign the UI.
```
