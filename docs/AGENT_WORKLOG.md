# Agent Worklog — cross-agent audit trail

Every AI agent that modifies this repository appends an entry here before
checkpointing (see `AGENTS.md` §8). This file is a flat audit log, not a
handoff/task-assignment doc — see `docs/HANDOFF_LOG.md` for that.

---

### 2026-09-26T14:14:51-0400: Claude Code — full-bleed Watch stage fix

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `586e96b` (local HEAD at the start of this batch)
**Ending commit SHA:** `d98af5b` (pushed to `origin/claude/great-volta-ogpuw8`;
the branch was fast-forwarded from `586e96b` to `a93d896` mid-batch to catch
up with origin before this commit landed on top — see "Cross-agent impact")
**Files changed:**
- `Apple/WatchApp/TamagoWatchApp.swift` (production fix)
- `docs/AGENT_WORKLOG.md` (new, this file)
- `AGENTS.md` (new permanent rule, §8)
- `docs/HANDOFF_LOG.md` (own entry appended; also carries a conflict-resolution
  merge of Codex's uncommitted entries against upstream — see "Cross-agent
  impact")

**Root cause:** In `CharacterScreen` (`TamagoWatchApp.swift`), the full-bleed
black backdrop was applied as `.background(Color.black.ignoresSafeArea())`.
`.ignoresSafeArea()` there only extended the **background fill**, not the
`ZStack`'s own layout. The actual content — `CharacterView`, and therefore the
`GeometryReader` inside `CreatureIdleStage` that defines the creature's world —
was still measured and laid out inside the safe-area-inset rectangle. Because
both the true background and the inset content were solid black, the shrink
was visually undetectable; the creature's coordinate space was silently
confined to a smaller box floating inside the real screen.
`TabView`/`PageTabViewStyle`/page-indicator reservation were investigated and
ruled out by bisection (removing `TabView` entirely left the shrink almost
unchanged).

**Exact fix:**
```diff
-        .background(Color.black.ignoresSafeArea())
+        .background(Color.black)
+        .ignoresSafeArea()
```
`.ignoresSafeArea()` moved from the background modifier onto the `ZStack`
itself, so the content (not just its backdrop) is offered the full screen.

**Verification performed:**
- Instrumented `CreatureIdleStage`'s `GeometryReader` with a temporary debug
  label printing `geo.size` (`Text("DEBUG \(w)x\(h)")`), built and ran on the
  Apple Watch SE 3 (40mm) simulator (UDID `8B5287E9-BD6A-422A-B353-B8E3499AE31D`,
  watchOS 27 sim) via `xcodebuild -scheme TamagoWatch`.
- **BEFORE stage:** 158×131 pt
- **AFTER stage:** 162×197 pt
- **Target display (Apple Watch SE 3 40mm):** 162×197 pt — confirmed
  independently via the simulator control tool's own reported coordinate
  space on `attach`.
- Bisected by temporarily removing `TabView` (no fix applied yet): stage was
  158×138 pt — confirms `TabView` was not the cause.
- Confirmed the fix holds with `TabView` restored (production shape):
  162×197 pt.
- Removed all temporary debug instrumentation from `CreatureIdleStage.swift`
  before checkpointing; `git diff` against this file at checkpoint time is
  empty.
- Tapped the creature on-screen post-fix and observed it able to occupy
  positions (including near the very top edge) that were unreachable before
  the fix.
- **Swift tests:** 112/112 PASS (`xcodebuild test -scheme TamagoWatch
  -destination 'id=8B5287E9-BD6A-422A-B353-B8E3499AE31D'`; suites
  `SpriteAnimationClock`, `Protocol v1 fixtures`, `CreatureBehaviorEngine`,
  `CharacterStateMachine`).
- **Watch simulator build:** PASS (Debug, watchOS 27 simulator SDK).
- **Apple Watch SE 3 40mm simulator verification:** PASS — `SIMULATOR_VERIFIED_ONLY`
  per `AGENTS.md` §3. No physical-device evidence; not `DEVICE_VERIFIED`.

**Remaining system limitation:** the watchOS digital-time overlay is still
visible in the top-right corner. This is **not** a residual inset — the
measured stage is the full 162×197 pt after the fix. It is the system's own
compositing layer drawn on top of full-bleed app content (the same mechanism
full-screen games/video use on watchOS) and consumes no layout space. It
cannot be removed via public API and is not a bug.

**Known issues:** none introduced by this change. The creature's ordinary
wander range still self-limits to the inner 16%–84% of the (now-correct) stage
by design (`CreatureBehaviorEngine.territoryMin/Max`) — unrelated to this fix,
not touched.

**Cross-agent impact:** at the start of this batch, local `HEAD` (`586e96b`)
was 2 commits behind `origin/claude/great-volta-ogpuw8`. The working tree also
held uncommitted work belonging to a different agent (Codex): two appended
`docs/HANDOFF_LOG.md` entries ("Blender iterative-agent preflight" and
"TamagoAI V0.1 proportion blockout") and an untracked `3D/` directory
(Blender scenes, scripts, validation renders), explicitly marked by Codex as
"no staging, commit or push." To reach a pushable state without discarding
that work: (1) `git stash push -u` on exactly `docs/HANDOFF_LOG.md` and `3D/`
(left `Apple/WatchApp/TamagoWatchApp.swift` and the already-identical staged
`Assets/CharacterReference/octopus-v001/*` untouched); (2)
`git merge --ff-only origin/claude/great-volta-ogpuw8` (clean fast-forward,
no conflicts); (3) `git stash pop`, which produced one conflict in
`docs/HANDOFF_LOG.md` because both the incoming commits and Codex's stashed
entries appended at the same end-of-file location. Resolved by keeping both
sets of entries, concatenated (upstream's two Claude entries first, then
Codex's two entries), with no content dropped or altered from either side.
The `3D/` directory and its 16 files were restored byte-for-byte from the
stash. This agent did not author, review, or verify any of Codex's Blender
work — only mechanically preserved it through the reconciliation. The stash
(`stash@{0}`) was left in place as a redundant backup rather than dropped
(local policy denied the drop as an irreversible-destruction action); it is
safe to drop once the owner confirms the merge above is correct.

**Diagnostic instrumentation:** confirmed removed. The temporary
`Text("DEBUG ...")` overlay added to `CreatureIdleStage.swift` for
measurement was fully reverted; `git diff` shows no changes to that file.

**Hero image / README task (separate request, received mid-batch):**
initially blocked (see prior revision of this entry) because a pasted chat
image cannot be extracted to disk pixel-for-pixel with this agent's tools.
The owner then supplied the file at a concrete filesystem path
(`/private/tmp/claude-502/.../images/1.webp`), which resolved the blocker.

**Signed-by:** Claude Code

---

### 2026-09-26: Claude Code — README hero image

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `bd1a17c`
**Ending commit SHA:** `f4f6d0d`
**Files changed:**
- `docs/assets/tamagoai-hero.webp` (new — the supplied hero image, copied verbatim)
- `README.md` (restructured: hero image promoted near the top; existing content
  preserved and reorganized below it, plus a new Documentation section)
- `docs/AGENT_WORKLOG.md` (this entry)

**What was done:** the owner supplied an approved hero photo (an Apple Watch
held in hand, white octopus character on its screen) at
`/private/tmp/claude-502/-Volumes-Storage-Projects-TamaWatch/eca2bdf3-af21-4ef3-aef1-cb68198cb091/images/1.webp`.
- **Image was NOT modified.** Copied with `cp -p` (no format conversion, no
  recompression, no crop, no resize). Verified byte-identical via
  `shasum -a 256` on source and destination (both
  `8e67a177a85c95033f38659b08b0d2e86fd4ce3bc98eff472c95259c7a4fb9d6`).
- Original format was WebP (confirmed via `file` and `sips`: 1254×1254 px,
  130,416 bytes) — kept as `.webp` per the task's own instruction to preserve
  original format rather than force a PNG conversion.
- Stored at `docs/assets/tamagoai-hero.webp` (durable repo location, not a
  temp path).
- `README.md`: hero image inserted near the top via `<p align="center"><img
  src="docs/assets/tamagoai-hero.webp" ...></p>`, using a relative repo path
  (survives forks/clones) with alt text "TamagoAI white octopus companion
  inhabiting an Apple Watch". Opening is restrained (title + one line + hero +
  one line) before the pre-existing status callout and documentation. No
  installation instructions, architecture diagrams, badge walls, or AI
  marketing copy were placed above the hero. All pre-existing README content
  (status line, "how it works" flow diagram, layout tree, gateway quick start,
  principles) was preserved verbatim, just moved below the hero under
  headings. Added a new "Documentation" section linking `CREATURE_SPEC.md`,
  `ARCHITECTURE.md` (+ `TAMAGO_ARCHITECTURE.md` diagram), `DECISIONS.md`,
  `VISUAL_APPROVAL_GATE.md`, `DEVELOPMENT.md`, `HANDOFF_LOG.md`, and
  `PROTOCOL_V1.md` — none of these were linked from the README before.
- Confirmed `docs/assets/tamagoai-hero.webp` exists on disk and that
  `README.md`'s reference matches its filename and case exactly
  (`grep`/`find -iname` cross-check).

**Verification performed:** `git diff --check` (clean, see below). File
existence and case-sensitive path match confirmed by direct filesystem check
(above). **GitHub's actual rendered page was NOT viewed — this agent has no
browser access to a pushed GitHub page in this session — so visual rendering
of the hero (centering, sizing, mobile behavior) is explicitly NOT VERIFIED.**
The markdown/HTML used (`<p align="center"><img ... width="640"></p>`) is a
standard, widely-used GitHub-README pattern, but that is not a substitute for
having looked at the rendered result.

**Known issues:** none identified in the change itself. Rendering on
GitHub.com is unverified per above; the owner should sanity-check it after
push.

**Cross-agent impact:** none — only `docs/assets/`, `README.md`, and this
worklog were touched; no shared files from other agents' in-flight work were
involved in this batch.

**Signed-by:** Claude Code

---

### 2026-09-26T15:24:51-0400: Claude Code — Watch↔Mac connectivity, repo rebrand

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `581f9f5`
**Ending commit SHA:** `9d80098` (engineering), `11f0e53` (branding/hygiene)

**Scope:** a large, multi-part owner request covering engineering
(Watch↔Mac connectivity, haptics, speech), security/branding/repo hygiene,
and main-branch integration. Full technical detail for the engineering half
is in `docs/DECISIONS.md` D-115 — this entry summarizes and adds what D-115
doesn't cover (repo/branding actions, checkpoint list, what was explicitly
deferred).

**Files changed (engineering):**
- `Apple/Shared/GatewayTransport.swift` (new) — `GatewayClient`/`GatewayConfiguration`
- `Apple/Shared/Tests/TamagoSharedTests/GatewayClientTests.swift` (new, 10 tests)
- `Apple/Shared/Package.swift` — registers the new source file
- `Apple/Shared/CharacterInteractionController.swift` — adds `onEffects` hook
- `Apple/WatchApp/TamagoConnection.swift` (new) — effect executor, transport
  diagnostics, speech watchdog
- `Apple/WatchApp/HapticPlayer.swift` (new)
- `Apple/WatchApp/SpeechOutput.swift` (new)
- `Apple/WatchApp/GatewayReachabilityMonitor.swift` (new)
- `Apple/WatchApp/TamagoWatchApp.swift` — wires the above into `RootView`
- `Apple/WatchApp/DebugStateControlsView.swift` — "Live gateway" debug section
  + transport diagnostics display
- `docs/DECISIONS.md` (D-115), `docs/ARCHITECTURE.md` (security posture
  update), `docs/DEVELOPMENT.md` (testing recipe), `docs/HANDOFF_LOG.md`

**Files changed (branding/hygiene):** `README.md` (expanded: what it is, current
status, architecture, character philosophy, development, roadmap,
contributing), `.gitignore` (Python cache, `*.log`).

**GitHub/repo actions taken (not a file diff — recorded here per task's own
audit requirement):**
- Renamed the GitHub repository `CristoXD73/faucet-repo` → `CristoXD73/TamagoAI`
  via `gh repo rename TamagoAI --repo CristoXD73/faucet-repo`. Verified via
  `gh repo view` before and after. Confirmed logged in as the repo owner
  (`CristoXD73`, token scope includes `repo`) before acting — this is a
  real, public, mostly-but-not-fully-reversible action (GitHub redirects the
  old URL; the name itself doesn't revert on its own), taken because the
  owner explicitly named the exact target name and gave an explicit fallback
  instruction ("if not permitted, report as owner action") in the same
  message, which this agent treats as the required explicit permission for a
  GitHub account/settings change.
- Updated the local `origin` remote to the new URL (`git remote set-url`).
- Set repository description and 8 topics via `gh repo edit` (description:
  "A living AI companion for Apple Watch, with a Mac-powered local
  intelligence layer."; topics: apple-watch, watchos, swift, swiftui, ai,
  local-ai, companion, virtual-pet).
- Searched the full repo for "faucet" (case-insensitive, all text file
  types): only two hits, both historical `docs/HANDOFF_LOG.md`/`docs/DECISIONS.md`
  entries describing what the repo *was* named at an earlier point — left
  those untouched (rewriting historical log entries would falsify the
  record) and instead updated D-001's now-stale "still needs renaming" note
  to point at this entry.

**Work performed (engineering, condensed from D-115):** built the missing
Watch-side half of the Mac↔Watch loop — the Mac gateway and wire protocol
already existed and needed no changes. Added a pure-Foundation `GatewayClient`
that executes `CharacterStateMachine`'s existing `sendRequest`/`cancelRequest`
effects and never throws (synthesizes client-side error envelopes on any
transport failure, per PROTOCOL_V1 §8). Added one seam
(`CharacterInteractionController.onEffects`) so a single platform-layer
executor (`TamagoConnection`) can react to every effect from any call site.
Wired real haptics (`HapticPlayer`, direct `TamagoHaptic → WKHapticType` map)
and a `GatewayReachabilityMonitor` (20s health-check poll while the scene is
active, feeding the existing `.routeLost`/`.routeRestored` events). Found,
live against the real gateway, that `Gateway/src/protocol.js`'s
`buildOkResponse` defaults `speechText` to `text`, so essentially every
response enters `.speaking` — with speech disabled by default (its default
state; see below) this would have frozen the creature there forever without
a completion signal, so `SpeechOutput.onFinished` fires synchronously when
disabled, and a duration-estimate-based watchdog (D-106's own
never-implemented requirement) covers the "enabled but the delegate never
fires" case too.

**Tests/builds actually performed:**
- `swift test --package-path Apple/Shared` (host): 122/122 PASS, several times
  across the session, most recently after the speech-watchdog addition.
- `xcodebuild -scheme TamagoWatch build` (watchOS 27 simulator, SE 3 40mm):
  BUILD SUCCEEDED, several times across the session, most recently after the
  speech-watchdog addition.
- `xcodebuild test` (same scheme/simulator): attempted three times; each
  attempt hung or failed in Xcode's own diagnostics-collection phase
  (`simctl diagnose`), not in an actual test failure — most likely
  simulator/`testmanagerd` state left over from this session's extensive
  manual `simctl install`/`launch`/`terminate` cycling on the same device,
  worsened by also manually driving the simulator (taps/screenshots) while a
  test run was in flight the first time. A full `simctl shutdown`/`boot`
  between attempts did not resolve it. **Not resolved this session** — see
  "Known issues."
- **Live, manual, end-to-end verification** against the real gateway
  (`TAMAGO_ALLOW_NO_AUTH=1 npm start`) on the booted SE 3 40mm simulator,
  with full debug tracing (temporary `print` statements in
  `CharacterInteractionController.apply` and `TamagoConnection`, removed
  before commit): confirmed the exact expected sequence — `cancel` →
  `userActivated` → `transcript` → `sendRequest` effect → real HTTP request
  received by the gateway (matched by request ID in the gateway's own JSON
  log) → real response decoded → `.speaking` with the correct
  `pendingReaction` → the new speech-completion fix firing → settling on the
  gateway's actual answer. Repeated across the `ping`, `state happy`, and
  `state confused` mock commands. Round-trip times of 11–17ms observed and
  cross-checked against the gateway's own per-request log line.
- `Gateway`: `npm test` → 66/66 PASS (pre-existing suite, unchanged by this
  session — attributed to whoever wrote it, not claimed as this agent's own
  test-writing work).
- `git diff --check`: clean.

**Things NOT verified:**
- Anything on a physical Apple Watch. Everything above is
  `SIMULATOR_VERIFIED_ONLY` or `UNIT_TESTED_ONLY`.
- A physical Watch reaching a Mac over a real LAN address (only loopback,
  from the simulator, was exercised).
- Audible speech output — `SpeechOutput.isEnabled` defaults to `false`
  precisely because this session cannot hear simulator or device audio.
- Haptic *feel* — the WatchKit call is confirmed reached, not confirmed felt.
- `GatewayReachabilityMonitor`'s battery cost (task's own §22 ask) — no
  physical-device energy measurement was possible here.
- A clean, fully-automated `xcodebuild test` run on the watchOS simulator for
  this batch (see above) — host tests cover the identical pure-logic code
  that the simulator target compiles, and the manual E2E run exercised the
  platform-specific code the host can't (URLSession on watchOS, WatchKit,
  AVSpeechSynthesizer), but neither is a substitute for a clean automated
  simulator test-run confirmation.

**Known issues:**
- `xcodebuild test` unreliability on this simulator (see above). Recommended
  next step: a fresh simulator instance (`xcrun simctl create`) rather than
  continuing to reuse `8B5287E9-BD6A-422A-B353-B8E3499AE31D`, which has now
  been through many hours of install/launch/terminate/reboot cycles across
  this session.
- Bonjour/mDNS discovery, nonverbal creature sounds, and a
  session/memory layer beyond the gateway's existing request-ID dedupe were
  scoped but **not built** this pass — see D-115's "Not built this pass" for
  the reasoning (verifiability and asset-availability, not time alone).
- The `docs/tamagoai-presentation` branch (an earlier, now-superseded
  rebrand-only branch, last commit `77bf80e`) still exists on `origin` and
  was deliberately left untouched — it predates this branch's animation
  prototype and Watch-fix work and would regress the repo if merged as-is.
  Recommend the owner delete it once confirmed unneeded, or merge
  cherry-picked ideas manually; this agent did not decide that unilaterally.

**Cross-agent impact:** none of Codex's uncommitted `3D/` work or in-progress
`docs/HANDOFF_LOG.md` entries were touched or re-reconciled in this batch
(no new fast-forward was needed — this branch stayed at `581f9f5` plus this
batch's own commits, with `3D/` still present, untracked, exactly as Codex
left it). The GitHub repo rename and remote URL change affect every
collaborator/agent working against this remote going forward — anyone with
`faucet-repo` hardcoded in a local clone's remote will need to update it
(GitHub's redirect covers `git clone`/`fetch`/`push` against the old URL
too, per GitHub's own rename behavior, but a hardcoded API/webhook URL
elsewhere would not redirect).

**Checkpoint strategy (task §25):** this batch lands as two commits rather
than one: (1) engineering — transport, haptics, speech, their tests, and the
docs describing them; (2) branding/hygiene — README restructure and
`.gitignore`. The GitHub repo rename and metadata are not file-diff
commits; they're recorded here and in D-001's updated note.

**Signed-by:** Claude Code

---

### 2026-09-26T15:35:00-0400: Claude Code — main-branch integration

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8` → `main`
**Starting commit SHA (main, before):** `cb2167b` ("Initial commit" — a
one-line README; every commit on `claude/great-volta-ogpuw8` already
contained `cb2167b` as an ancestor, confirmed with
`git merge-base --is-ancestor origin/main HEAD` before acting)
**Ending commit SHA (main, after):** `01a1636`

**Work performed:** re-verified the ancestor relationship still held after
the two checkpoint commits above, then:
1. `git tag -a pre-main-integration-2026-09-26 cb2167b ...` and pushed it —
   a safety tag pointing at exactly what `main` was before this change, per
   the task's own "create a safety branch/tag before changing main"
   instruction. Recoverable at any time via that tag.
2. Re-ran `swift test` (122/122) and `npm test --prefix Gateway` (66/66)
   immediately before pushing, per "run tests/build verification before
   updating main."
3. `git push origin claude/great-volta-ogpuw8:main` — GitHub's own output
   confirmed this as a fast-forward (`cb2167b..01a1636`, not a `+`-prefixed
   forced update). No history was rewritten; `cb2167b` remains in `main`'s
   ancestry. **Not force-pushed**, and no other branch (`docs/tamagoai-
   presentation`, or anyone else's) was merged or touched.
4. Updated the local `main` branch pointer to match (`git branch -f main
   origin/main`) without checking it out — this session stayed on
   `claude/great-volta-ogpuw8` throughout.

**Verification:** `gh repo view` confirms `defaultBranchRef.name == "main"`
and that `main` now serves the full project (fetched and inspected
`origin/main`'s log directly). GitHub's own rendered page was not viewed —
no browser access from this session — so the *visual* result (e.g. whether
the README hero renders as intended) is **NOT VERIFIED**; only the git-level
outcome is confirmed.

**Known issues:** none introduced by this step itself. The pre-existing ones
(no `xcodebuild test` clean run this session; no physical-device
verification) are unchanged by moving them onto `main`.

**Cross-agent impact:** `main` is the repository's default branch — every
future clone, fork, and "visit the repo" now lands on the real project
instead of the placeholder initial commit. Any other agent or process with a
stale local `main` will need to fast-forward-pull to catch up (no rebase or
force-push means this is always a clean, non-destructive pull for anyone
downstream). The `docs/tamagoai-presentation` branch was deliberately left
alone (see the previous entry).

**Signed-by:** Claude Code

---

### 2026-09-26T18:48:07-0400: Claude Code — pairing, discovery, voice input, product README

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `23b3276`
**Ending commit SHAs:** `ae763a0` (gateway), `e95f53b` (watch), `8e3aed6`
(docs/rules), `7e00b97` (README/presentation), `f62c198` (README diagram),
`d3e4969` (test fix), plus the commit carrying this entry. `main` was then
fast-forwarded; see the entry after this one.

**Files changed:** Gateway: `src/{advertise,identity,pairing}.js` (new),
`src/{cli,config,server}.js`, `test/{config,pairing}.test.js`. Apple/Shared:
`ConnectionModel.swift` (new), `GatewayTransport.swift`, `TamagoProtocolV1.swift`,
`Package.swift`, tests (`ConnectionModelTests.swift` new,
`GatewayClientTests.swift`, `CharacterStateMachineTests.swift`). Apple/WatchApp:
`PairingStore/PairingView/VoiceInput/CreatureSoundPlayer.swift` (new),
`TamagoConnection`, `TamagoWatchApp`, `DebugStateControlsView`, `SpeechOutput`,
`CharacterView`, `CreatureIdleStage`; `GatewayReachabilityMonitor.swift`
removed. Docs: `DECISIONS.md` (D-116, D-115 note), `PROTOCOL_V1.md` (§14),
`ARCHITECTURE.md`, `DEVELOPMENT.md`, `ACCEPTANCE_TESTS.md`,
`TAMAGO_ARCHITECTURE.md`, `PRODUCT_PRESENTATION.md` (new), `AGENTS.md`,
`CLAUDE.md`, `README.md`, `docs/assets/body-brain-{light,dark}.svg` (new).

**Work performed:** full detail in D-116. In short:
- Checked Apple TN3135 directly. Watch-side Bonjour, NWConnection and
  NWPathMonitor are blocked on physical Watches, though the simulator allows
  them. So discovery is a fixed mDNS name (`tamagoai.local`) the gateway
  publishes via `dns-sd`, reached from the Watch with plain URLSession.
- Pairing: a persistent gateway identity and a 6-digit single-use code.
  `POST /v1/pair`. The Watch keeps the token in its Keychain per D-109.
- Hold-to-talk: WatchKit's system dictation (D-106), presented programmatically.
- Event-driven reachability replaces the 20 s poll, using D-107's backoff only
  while the Mac is missing.
- Found and fixed live: D-103's `ackBeatElapsed`/`reactionFinished` were never
  supplied, so every answer left the creature stuck. Offline now keeps idle
  life, per CREATURE_SPEC.
- Pure semantic-state / transport / sound-cue models, with tests.
- Speech and sound debug controls; placeholder tones exist in DEBUG only.
- DEBUG stage-size regression guard.
- README rebuilt visual-first; `PRODUCT_PRESENTATION.md` added and made
  mandatory reading.
- Aligned my first-pass choices to existing decisions after reading them:
  D-107 backoff and URLSession settings, and D-109 Keychain layout.

**Tests/builds actually run (by this agent):**
- `swift test` (host): 137/137.
- `xcodebuild test` on a freshly created SE 3 40 mm watchOS 27 simulator:
  first 128 passed / 9 failed; after the fix, **137/137, TEST SUCCEEDED**.
- `npm test` (Gateway): 79/79. `npm run fixtures`: no drift.
- `xcodebuild build`: Debug (simulator) and Release (generic watchOS
  simulator, unsigned) both succeed.
- `scripts/smoke.sh` against the live LAN gateway via `tamagoai.local`: pass.
- Live, SE 3 40 mm simulator against a LAN-mode gateway (`TAMAGO_HOST=0.0.0.0`,
  throwaway `TAMAGO_STATE_DIR`):
  - `tamagoai.local` resolves through the system resolver (`dscacheutil`), and
    the Watch reached it.
  - Pairing succeeded. It persisted across relaunch, re-verified after moving
    to the D-109 storage layout.
  - Hold → real system dictation sheet → suggestion → authenticated request →
    `thinking` (`slow 6000`) → reaction → idle.
  - Gateway stopped → `disconnected` with idle life → restarted → automatic
    recovery.
  - Unpaired LAN client: 401 with no token and with a guessed token. Reused
    code: 410.
- Speech: temporary instrumentation (removed) showed the synthesizer running
  ~3 s and its completion firing in the simulator.
- README: viewed the **rendered GitHub page** in the built-in browser on the
  pushed branch, in dark and light themes. All 5 images load (verified in the
  DOM). At 375 px width nothing overflows and there's no horizontal scroll.
  The Mermaid diagram looked cluttered, so it was replaced with an SVG and
  re-checked.

**Things NOT verified:** anything on a physical Apple Watch, which TN3135 says
is where networking can differ; `tamagoai.local` from a Watch proxied through
its iPhone; real dictation (the simulator has none, and its keystrokes don't
reach Scribble — debug suggestions stood in); audible speech or sounds, and
silent-mode behavior; haptic feel; energy use; Ollama against a real engine;
two gateways on one LAN (a known name-conflict limit); the pairing sheet's
visual design (pending owner review).

**Known issues / limitations:** plain-HTTP LAN security gaps (sniffing,
impersonation of `tamagoai.local`, no rotation or revocation), listed in
D-116. The spec wants `.start`/`.click` haptics, but the reducer emits `.click`
on activation (left for an owner haptic pass). The offline→idle-habitat routing
and the pairing sheet are flagged for owner review. `inactivityTimeout`/sleep
still has no production trigger (pre-existing, out of scope).

**Correction to my own earlier record:** my 15:24 entry above said
`xcodebuild test` hung because of simulator/`testmanagerd` state. That was
wrong. Nine `GatewayClientTests` were genuinely failing on watchOS (the
`URLProtocol` mock isn't honored there), and Xcode was collecting diagnostics
afterward. D-115's "watchOS 27 simulator" test claim for those tests was
therefore false until `d3e4969`.

**Cross-agent impact:** the gateway's default changed. Without `TAMAGO_TOKEN`
it no longer refuses to start; it creates and uses a persistent identity in
`~/Library/Application Support/TamagoAI/`. Anyone scripting the gateway should
read D-116. A LAN-mode gateway now advertises on the network. Codex's
untracked `3D/` was not touched. I created one extra simulator ("TamagoAI Test
SE3 40mm", `49DEDF60-8D9E-4977-8630-F1984F2E00ED`) for clean test runs and left
it for reuse.

**Signed-by:** Claude Code

---

### 2026-09-27T02:06:34+0000: Claude Code (cloud) — Tamago Brain milestone 1 (Brain A–D)

**Agent:** Claude Code (cloud session, no Xcode/Swift, no Ollama)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `146c480` (fast-forwarded from `a93d896` to origin before starting)
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:**
- New: `Gateway/src/brain/**` (orchestrator, response-schema, context-builder, session, maintenance,
  index, personality/{profile,behavior-policy}, routing/{intent-router,model-router},
  memory/{extractor,gate,store,retrieve}, relationship/model, world/state, reasoners/{ollama,deterministic},
  speech/composer, storage/database), `Gateway/bin/tamago.js`, `Gateway/test/brain.test.js`,
  `Gateway/test/brain-gateway.test.js`, `docs/BRAIN_ARCHITECTURE.md`,
  `Tests/Fixtures/protocol-v1/responses/ok-nonverbal.json`
- Modified: `Gateway/src/protocol.js` (nonverbal ok envelope), `Gateway/src/providers/mock.js`
  (`nonverbal` command), `Gateway/src/config.js` (`TAMAGO_PROVIDER=brain`), `Gateway/src/cli.js`
  (await brain readiness), `Gateway/test/fixture-cases.js`, `Tests/Fixtures/protocol-v1/manifest.json`
  (regenerated), `Gateway/package.json` (bin + `brain` script), `Gateway/.env.example`,
  `Gateway/mock/README.md`, `.gitignore` (`*.sqlite*`), `docs/PROTOCOL_V1.md` (§5.1), `docs/DECISIONS.md`
  (D-117), `docs/ACCEPTANCE_TESTS.md` (§K), `CLAUDE.md`, `docs/HANDOFF_LOG.md`, this file.

**Work performed:** turned the Mac gateway's "prompt + latest message" into the Tamago Brain per the owner's
architecture brief, keeping Protocol V1 as the external contract. Details: `docs/BRAIN_ARCHITECTURE.md`.

**Tests/builds actually performed (by me, in the cloud, Node v22.22.2):**
- `cd Gateway && npm test`: 101 tests, 101 pass (80 pre-existing + 1 new fixture case + 19 brain + 2
  brain-gateway). No pre-existing test was modified except adding the nonverbal fixture case.
- `npm run fixtures`: regenerated. The only new file is `ok-nonverbal.json`, and the manifest gained one entry.
- CLI transcript across a real process restart (`printf … | node bin/tamago.js brain chat`, twice), plus
  `inspect`, `memories` and `status`.
- Real gateway process `TAMAGO_PROVIDER=brain TAMAGO_ALLOW_NO_AUTH=1 node src/cli.js`, driven by curl: V1
  envelopes including the nonverbal one.

**Things NOT verified:** any real LLM (the Ollama reasoner is tested against a stubbed fetch only:
`UNVERIFIED_LOCAL_PROVIDER`); latency and quality on the owner's 16 GB Mac; the nonverbal envelope on the
physical Watch (I checked by reading `CharacterStateMachine.handle` that an empty `speechText` skips TTS; I
didn't run Swift); the Swift fixture tests against the new `ok-nonverbal.json` (not run: no toolchain; it
decodes as a normal `TamagoResponse` with empty strings); Node 26 on the owner's Mac (built-in
`node:sqlite`, expected to work).

**Known issues:** English-only rule patterns; the deterministic reasoner is a labeled fallback, not
intelligence; `node:sqlite` prints an ExperimentalWarning on Node 22 (the CLI suppresses it; the gateway log
shows it once); tools (Brain E) aren't built, and Tamago says so.

**Cross-agent impact:** the gateway default provider is still `mock`, so nothing changes unless
`TAMAGO_PROVIDER=brain`. The Swift fixture suite gains one fixture (`ok-nonverbal.json`). `PROTOCOL_V1` §5.1
documents empty `text`/`speechText` as a nonverbal reaction, which the current Watch client already handles.
No Apple sources were touched.

**Signed-by:** Claude Code (cloud)

### 2026-09-26T22:22:34-04:00: Claude Code — Storage-disk rule made binding and visible; Brain F blocked

**Agent:** Claude Code (local, owner's Mac, Opus 5.5)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `9d6148c`
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:** `AGENTS.md` (top callout + new §9 Storage), `CLAUDE.md` (top callout, reminder line),
`README.md` (one line in Development), `docs/LOCAL_ENVIRONMENT.md` (disk check, Ollama-on-Storage setup),
this file.

**Work performed:** the owner asked that every agent use the external `/Volumes/Storage` disk rather than
the internal SSD, and that the rule be visible on GitHub. It existed only in `docs/LOCAL_ENVIRONMENT.md`.
It's now a callout at the top of `AGENTS.md` and `CLAUDE.md`, plus a full path table in `AGENTS.md` §9
(builds, Ollama models via `OLLAMA_MODELS`, gateway state via `TAMAGO_STATE_DIR`, eval databases, temp
files). Paths stay out of source code; code defaults remain portable.
Brain F step 1 (environment check) stopped as instructed: Ollama is not installed.

**Tests/builds actually performed (by me):** `node --version` → v26.9.0; `which ollama` → not found (no
app, no `~/.ollama`, nothing on :11434); `df -h` → internal 21 GiB free (90% used), Storage 400 GiB free;
`du -sh` of CoreSimulator (2.6 GiB), Xcode DerivedData (524 MiB), `~/.npm` (142 MiB);
`cd Gateway && npm test` → 101/101 pass. Docs-only change; `git diff --check` clean.

**Things NOT verified:** the `launchctl setenv OLLAMA_MODELS` instructions (Ollama isn't installed yet);
the rendered GitHub callouts (RENDERED GITHUB PAGE NOT VERIFIED at time of writing).

**Known issues:** 524 MiB of Xcode GUI DerivedData remains on the internal disk; left for the owner to
decide (not deleted).

**Cross-agent impact:** new binding rule for all agents (`AGENTS.md` §9). No code touched.

**Signed-by:** Claude Code

### 2026-09-27T00:18:25-04:00: Claude Code — app icons; first physical iPhone install

**Agent:** Claude Code (local, owner's Mac, Opus 5.5)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `2d744cd`
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:** new `Apple/iPhoneApp/Assets.xcassets/` and `Apple/WatchApp/Assets.xcassets/` (AppIcon, 1024×1024
single-size), `Apple/Config/Tamago.xcconfig` (`ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`),
`Assets/CharacterReference/octopus-v001/PROVENANCE.md` (owner's icon exception), this file.

**Work performed:** the owner reported no app icon on the iPhone or the Watch; the project had no asset
catalog at all. At the owner's direction, `ref_hero_q34.jpg` (the image the owner sent, byte-identical)
became the icon, unchanged apart from scaling and centering on black. The Watch version is sized so the
whole octopus fits inside the circular mask. Built the `TamagoPhone` scheme (with the embedded Watch app) for
the owner's physical iPhone and installed it with `devicectl`.

**Tests/builds actually performed (by me):**
`xcodebuild build -scheme TamagoPhone -configuration Debug -destination 'platform=iOS,id=<owner iPhone>'
-derivedDataPath ../.build/DerivedData-device -allowProvisioningUpdates` → BUILD SUCCEEDED, signed with
automatic team profiles; both bundles contain `Assets.car` and `CFBundleIconName = AppIcon`;
`xcrun devicectl device install app` → installed on the owner's iPhone (the first attempt over Wi-Fi failed
with IXRemoteErrorDomain 6; the retry succeeded).

**Things NOT verified:** that the icon appears on the iPhone home screen (the owner hasn't confirmed yet);
the Watch app. Installing from the iPhone's Watch app spins, then nothing happens. Diagnosis: the Watch
isn't visible to Xcode (`devicectl`, `xcdevice`), so it isn't in the team provisioning profile (the profile
lists 2 devices, neither a Watch). The Watch binary was arm64-only (Debug `ONLY_ACTIVE_ARCH`).

**Known issues:** the Watch install is blocked on getting the Watch into a profile (portal registration of
its UDID) or on a TestFlight route; see HANDOFF.

**Cross-agent impact:** the project gains asset catalogs in the synchronized folders (no `.pbxproj` edit)
and one xcconfig line. Brain F is paused mid-run (the uncommitted `Gateway/scripts/brain-eval.js` isn't part
of this commit).

**Signed-by:** Claude Code

### 2026-09-27T00:29:19-04:00: Claude Code — Watch icon sizes, TestFlight readiness audit

**Agent:** Claude Code (local, owner's Mac, Opus 5.5)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `5073a2f`
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:** `Apple/WatchApp/Assets.xcassets/AppIcon.appiconset/*` (single-size replaced with every
watchOS role/size plus the 1024 marketing icon, all rendered from the same approved-art icon),
`Apple/WatchApp/Info.plist` (`NSLocalNetworkUsageDescription`), `Apple/Config/Tamago.xcconfig`
(`INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`), this file.

**Work performed:** the owner saw a generic placeholder for Tamago in the iPhone's Watch app. The Watch bundle
did contain the icon, but only as one 1024 image; the Watch app on iPhone relies on prerendered sizes
(companionSettings etc.), so every size is now explicit. TestFlight readiness audit of the built bundles:
versions match across app, Watch app and complication (0.1.0; the build number is set at archive time);
`WKApplication`, `WKCompanionAppBundleIdentifier` and `WKRunsIndependentlyOfCompanionApp` are present;
the complication is embedded; arm64 is the watchOS 27 standard arch (no arm64_32 needed); export compliance
is now declared; a local-network usage string was added for the Watch.
The owner confirmed that openPocketCine reached the Watch through TestFlight, and Xcode can't see the Watch,
so TestFlight is the install route (no Watch UDID needed).

**Tests/builds actually performed (by me):** Release `generic/platform=iOS` build → succeeded, only the
benign AppIntents metadata warnings; `assetutil --info` on the Watch `Assets.car` shows the sizes,
including 58/87 px companion icons; `plutil -p` shows the new keys; Debug device build, uninstall and
reinstall on the owner's iPhone; `xcodebuild archive ... CURRENT_PROJECT_VERSION=2` → ARCHIVE SUCCEEDED
(`.build/Archives/Tamago-0.1.0-2.xcarchive`, git-ignored, on Storage).

**Things NOT verified:** that the iPhone's Watch app now shows the icon (awaiting the owner); the TestFlight
upload (needs the App Store Connect app record); anything running on the Watch.

**Known issues:** none new.

**Cross-agent impact:** Watch icon asset layout changed; no Swift or `.pbxproj` edits.

**Signed-by:** Claude Code

### 2026-09-27T00:58:09-04:00: Claude Code — Brain F: real Ollama evaluation, 9 defects fixed, D-118

**Agent:** Claude Code (local, owner's Mac, Opus 5.5)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `9c9e24b`
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:** `Gateway/src/brain/` (orchestrator, memory/{gate,retrieve,store,extractor}, session,
routing/{intent-router,model-router}, personality/profile, speech/composer, reasoners/ollama header, index
defaults), `Gateway/test/brain.test.js` (+7 tests), new `Gateway/scripts/brain-eval.js`,
`Gateway/.env.example`, new `docs/BRAIN_EVAL.md`, `docs/BRAIN_ARCHITECTURE.md`, `docs/DECISIONS.md` (D-118),
`docs/ACCEPTANCE_TESTS.md` §K, `CLAUDE.md` map, `README.md` (test counts, one line), this file.

**Work performed:** installed Ollama 0.34.4 with the owner's go-ahead (`brew install ollama`), served on
127.0.0.1 only with models on `/Volumes/Storage/AI/ollama/models`, pulled `llama3.2:3b` (the owner's
choice: one model, "just for testing"). Wrote `scripts/brain-eval.js` (25-turn script through the real
orchestrator, database reset per run). Run 1 exposed 9 defects (see BRAIN_EVAL.md), including a **privacy
defect**: refused secrets and off-the-record sentences were kept verbatim as conversation turns and traces
and fed to later prompts. Fixed each with a test; runs 2 and 3 confirmed. Owner facts are now answered from
memory only (no guesses), live information is answered honestly by rule, forget also blanks the
conversation. Default model recorded in D-118. Labels flipped only for the brain reasoner with
`llama3.2:3b`; the legacy `providers/ollama.js` stays UNVERIFIED_LOCAL_PROVIDER.

**Tests/builds actually performed (by me):** `npm test` → 108/108 (was 101); three eval runs against the
real model (13/13, 11/11, 10/10 valid JSON on the first try; warm median ~1 s; Ollama RSS 2.3 GB); a throwaway
loopback gateway on :8788 driven by curl with V1 requests (incl. the nonverbal envelope); read the eval
database directly to confirm no secret text is stored.

**Things NOT verified:** any other model; long-term memory quality; the physical Watch; the legacy Ollama provider.

**Known issues:** the 3B model's general knowledge is shaky (octopus hearts half right); some replies lack
final punctuation (cosmetic). `.env.example` still says TAMAGO_TOKEN is required, which predates D-116's
identity token (not changed here).

**Cross-agent impact:** brain behavior changes (rule routes for `live_info` and unknown owner facts; the
persisted-turn format now includes placeholders). Protocol V1 unchanged. The LAN gateway on this Mac was
restarted with the new code (state in `/Volumes/Storage/AI/TamagoAI`, AGENTS.md §9).

**Signed-by:** Claude Code

### 2026-09-27T00:58:25-04:00: Claude Code — Swift fixture tests updated for the nonverbal reply (were failing)

**Agent:** Claude Code (local, owner's Mac, Opus 5.5)
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `c9c8add`
**Ending commit SHA:** the commit containing this entry (see `git log`)
**Files changed:** `Apple/Shared/Tests/TamagoSharedTests/ProtocolFixtureTests.swift`,
`Apple/Shared/Tests/TamagoSharedTests/CharacterStateMachineTests.swift`, this file.

**Work performed:** the cloud Brain milestone (`9d6148c`) added `responses/ok-nonverbal.json` and PROTOCOL_V1
§5.1 without running Swift (no toolchain there). On this Mac the Swift suite failed with 4 issues: the
manifest count (21 → 22), no expected values for the new fixture, and a rule "text is empty only for
accepted", which §5.1 relaxes for a nonverbal `ok`. The decoder itself was fine. Test-only fix, plus one new
test that runs the real fixture through `CharacterStateMachine` (reaction `happy`, haptic `click`, no `.speak`).

**Tests/builds actually performed (by me):** `swift test --scratch-path ../../.build/spm` → 138/138;
`xcodebuild test -scheme TamagoWatch` on the watchOS 27 simulator (TamagoAI Test SE3 40mm) → 138/138, TEST SUCCEEDED.

**Things NOT verified:** the nonverbal reply on the physical Watch.

**Known issues:** none.

**Cross-agent impact:** closes the "Swift fixture tests against ok-nonverbal.json" item the cloud session left
unverified; no production Swift touched.

**Signed-by:** Claude Code
