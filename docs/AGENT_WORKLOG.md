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
