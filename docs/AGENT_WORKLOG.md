# Agent Worklog — cross-agent audit trail

Every AI agent that modifies this repository appends an entry here before
checkpointing (see `AGENTS.md` §8). This file is a flat audit log, not a
handoff/task-assignment doc — see `docs/HANDOFF_LOG.md` for that.

---

### 2026-09-26T14:14:51-0400: Claude Code — full-bleed Watch stage fix

**Agent:** Claude Code
**Branch:** `claude/great-volta-ogpuw8`
**Starting commit SHA:** `586e96b` (local HEAD at the start of this batch)
**Ending commit SHA:** see the commit that carries this file (recorded below
once known; the branch was fast-forwarded to `a93d896` mid-batch — see
"Cross-agent impact")
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
**NOT COMPLETED — blocked.** The owner supplied an approved hero photo
(Apple Watch held in hand, white octopus character on-screen) inline in the
chat. This agent has no tool that extracts a pasted chat image's original
file bytes to disk pixel-for-pixel; the only available fallback (screenshotting
the rendered chat) would recompress/crop the image, which the task's own
instructions explicitly prohibit ("do not crop," "do not compress it
aggressively," "use the supplied image exactly as provided"). No image file
was written, `README.md` was not modified, and nothing hero-related is part
of this commit. Needs the owner to place the original file on disk (or give a
path to it) before this can proceed. GitHub rendering was consequently never
attempted and is **NOT VERIFIED**.

**Signed-by:** Claude Code
