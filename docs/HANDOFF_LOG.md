# Handoff Log

One entry per agent task, newest at the bottom. Copy the template.

<details><summary>Entry template</summary>

```text
### YYYY-MM-DD HH:MM: <Agent>: <one-line task>
Branch:
Commit(s):
Files changed:
Upstream source reused: None | repo, file, commit, license, local destination
Tests run (exact commands):
Passed:
Failed:
Physical-device evidence (+ label):
Unverified:
Known risks:
Next recommended task (ONE bounded step):
Do not redo:
```
</details>

---

### 2026-09-26: Claude Code Cloud: Phase 1 repository foundation

**Branch:** `claude/great-volta-ogpuw8`

**Commit:** `77ed46e3c582ca0d87ab53bf7d3f4cd691f4fdcb` (foundation). This log entry lands in the commit right after it.

**Starting state:** the repo `faucet-repo` had a single commit containing a one-line
`README.md`. Replaced entirely. Project renamed to **Apple Tamago** per the owner
(the GitHub repo name itself is unchanged; the owner can rename it in settings).

**Files created**
- Root: `README.md`, `AGENTS.md`, `CLAUDE.md`, `THIRD_PARTY_NOTICES.md`, `.gitignore`
- `docs/`: `MASTER_BRIEF.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PROTOCOL_V1.md`,
  `UPSTREAM_REUSE.md`, `ACCEPTANCE_TESTS.md`, `DEVICE_TEST_LOG.md`, `HANDOFF_LOG.md`,
  `handoff/TamaWatch_COMPLETE_HANDOFF.md` (owner's original pack, verbatim)
- `Gateway/`: `package.json`, `.env.example`, `src/{protocol,server,config,cli}.js`,
  `src/providers/{provider,mock,ollama}.js`, `test/*.test.js` (6 files) + helpers,
  `scripts/generate-fixtures.js`, `mock/README.md`
- `Tests/Fixtures/protocol-v1/`: `manifest.json`, 5 request fixtures, 12
  gateway response fixtures, 4 client-synthesized fixtures
- `Apple/Shared/TamagoProtocolV1.swift`, `Apple/Shared/SpriteAnimationClock.swift`,
  README placeholders for `Apple/{WatchApp,iPhoneApp,Complication}`
- `scripts/smoke.sh`, `.github/workflows/gateway.yml`

**Upstream source reused**
- WatchPet: https://github.com/lkuczborski/WatchPet @ `d52a77a1d15374b1443a46e26ddba11920d3b894`, MIT.
  `WatchPet/Views/PetAvatarView.swift` (sprite timing engine) **adapted** into
  `Apple/Shared/SpriteAnimationClock.swift`. Attribution is in the file header and `THIRD_PARTY_NOTICES.md`.
- Q007: https://github.com/chris-jk/Q007 @ `d422082ed1f419eef01ea15fd8d8266367410b24`, MIT.
  Reviewed only. **No code copied.**
- No artwork from either project. Full matrix: `docs/UPSTREAM_REUSE.md`.

**Tests run**
```sh
cd Gateway && npm test                 # node --test, Node v22.22.2
cd Gateway && npm run fixtures         # regenerated fixtures, then re-ran npm test
TAMAGO_TOKEN=… TAMAGO_PORT=18787 node src/cli.js  &  scripts/smoke.sh   # real process + curl
node src/cli.js                        # without token → refuses to start (exit 1)
TAMAGO_ALLOW_NO_AUTH=1 TAMAGO_HOST=0.0.0.0 node src/cli.js   # → refuses (exit 1)
git grep for keys/tokens/team IDs/private IPs   # none found
```

**Passed** (`UNIT_TESTED_ONLY`, 66/66): protocol parsing and normalization,
request-ID validation and echo (body + `X-Request-Id`), malformed JSON, schema
violations, unsupported protocol version, auth missing/wrong/wrong-scheme, the
MockProvider's deterministic outputs, provider exception (message not leaked),
provider unavailable, out-of-contract provider output rejected, timeout
(including a provider that ignores abort), duplicate requestId → one provider
call, 413/404/405, logs contain IDs but not user text, config safety, the Ollama
adapter against a stubbed fetch, every fixture valid, and gateway fixtures identical to live mock output.
Smoke test against the real CLI process: health, protocol, ping, state happy, tool jellyfin, state error (502).

**Failed:** none outstanding. One test bug was found and fixed during the session
(a default parameter masked `undefined`). It was not a gateway defect.

**Impossible in Cloud (therefore UNVERIFIED)**
- Any Swift compilation. There's no toolchain, and download.swift.org is blocked by the proxy.
  Both `Apple/Shared/*.swift` files are **never compiled**.
- Xcode, simulator, signing, physical Watch/iPhone, WatchConnectivity,
  Always-On / reduced luminance, complication, voice, TTS, haptics.
- `OllamaProvider` against real Ollama: `UNVERIFIED_LOCAL_PROVIDER`.
- Gateway on the owner's Mac mini and reachability from the Watch over the LAN.
- GitHub Actions workflow: written but hasn't run yet (it runs on push to GitHub).

**Known risks**
- Plain HTTP on the LAN. watchOS ATS / local-network behavior for `http://<mac>.local`
  is unknown for watchOS 27 and must be decided and tested (DECISIONS open item 8).
- Enums are duplicated in JS and Swift. The fixtures are the guard; Swift tests must decode them.
- `happy` was added to the state list (see D-004). Opus may merge it with `success` visually.

**Next recommended task (Claude Opus in Xcode, Phase 3):** see the
instructions below. It's one session of architecture decisions written to
`docs/DECISIONS.md`, plus compiling `Apple/Shared` with fixture-decoding tests.

**Do not redo:** repo structure, agent rules, upstream audit, protocol v1,
gateway, mock provider, fixtures, gateway tests, CI for the gateway.

#### Exact instructions for Claude Opus in Xcode

1. Owner first: fill in `docs/LOCAL_ENVIRONMENT.md` (Phase 2 commands in the
   handoff pack) and confirm that Xcode sees the Watch and the iPhone.
2. Read `AGENTS.md`, `docs/MASTER_BRIEF.md`, `docs/PROTOCOL_V1.md`,
   `docs/UPSTREAM_REUSE.md`, `docs/DECISIONS.md` (the "Open, for Opus" list), and this entry.
3. Report Xcode/Swift versions, the watchOS 27 SDK, and device visibility before you edit anything.
4. Decide open items 1–10 in `docs/DECISIONS.md` using the entry format there.
   Include the ATS / local-network decision for plain HTTP to the Mac on the LAN.
   Get owner approval for bundle IDs and the team.
5. Create the minimal targets (or a local Swift package for `Apple/Shared`) and
   **compile** `TamagoProtocolV1.swift` and `SpriteAnimationClock.swift`. Fix anything
   that doesn't compile, keeping the WatchPet attribution header.
6. Add a Swift unit-test target that decodes **every** JSON file listed in
   `Tests/Fixtures/protocol-v1/manifest.json` (skip `requests/malformed.txt`,
   and assert that it fails to decode), plus frame-math tests for `SpriteAnimationClock`.
   Label the results `UNIT_TESTED_ONLY` / `SIMULATOR_VERIFIED_ONLY` honestly.
7. Leave feature implementation (Stage A character slice) to Sonnet. Append a
   HANDOFF_LOG entry.

To give Swift a live server: `cd Gateway && TAMAGO_ALLOW_NO_AUTH=1 npm start`
(simulator, loopback) or
`TAMAGO_TOKEN=$(openssl rand -hex 24) TAMAGO_HOST=0.0.0.0 npm start` (physical
Watch on the same Wi-Fi; keep the token out of Git).
