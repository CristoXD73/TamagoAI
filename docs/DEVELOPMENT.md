# Developing TamagoAI

Read [AGENTS.md](../AGENTS.md), [MASTER_BRIEF.md](MASTER_BRIEF.md), the latest
[HANDOFF_LOG.md](HANDOFF_LOG.md) entry and [DECISIONS.md](DECISIONS.md) first.
Work within the assigned stage. Coordinate with the character/UI owner before
editing their active files. Existing names `Tamago` / `AppleTamago` remain the
code/project identifiers; this guide does not rename them.

## Prerequisites and map

Use the repository's recorded Xcode 27 / watchOS 27 simulator environment and
Swift tools ≥6.2; see [LOCAL_ENVIRONMENT.md](LOCAL_ENVIRONMENT.md) for exact
validated versions. Full Xcode is needed for Apple targets. Use Node ≥22 per
D-002 (the current package manifest has a looser ≥20 floor). The Gateway has no
third-party npm dependencies. `ffmpeg` is optional for media; no automatic
software installation is required. Simulator work needs no signing changes.

| Path | Purpose |
|---|---|
| `Apple/WatchApp/` | Watch presentation and interaction |
| `Apple/Shared/` | Pure shared Swift models, timing and tests |
| `Apple/iPhoneApp/`, `Apple/Complication/` | Companion and WidgetKit sources |
| `Apple/AppleTamago.xcodeproj` | Existing shared schemes and targets |
| `Gateway/` | Node gateway, mock/local adapters and tests |
| `Tests/Fixtures/protocol-v1/` | Cross-language protocol fixtures |
| `Assets/` | Character originals, approved exports and references |
| `docs/media/` | Final reviewed documentation media |
| `docs/` | Decisions, protocol, acceptance and evidence logs |

## Tests (repository root)

```sh
swift test --package-path Apple/Shared --scratch-path .build/spm -Xswiftc -warnings-as-errors
npm test --prefix Gateway
```

These are **UNIT_TESTED_ONLY** when they pass; they do not verify UI, hardware,
or a real Ollama engine. Host tests read repository fixtures in place. Report
unrelated failures without changing production code to conceal them. During
parallel work choose a unique ignored scratch path, e.g. `.build/support-spm`,
to avoid another agent's build lock.

## Build and launch a Watch simulator

Commands below are a recipe (**UNVERIFIED** by this support pass), not a claim
of a new simulator run. Select an available Watch UDID instead of copying a
machine-specific ID from old logs. Do not interrupt a simulator another agent
is using.

```sh
xcodebuild -version
xcrun simctl list devices available
export TAMAGO_SIM_UDID='REPLACE_WITH_WATCH_SIMULATOR_UDID'
xcodebuild build -project Apple/AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination "platform=watchOS Simulator,id=$TAMAGO_SIM_UDID" \
  -derivedDataPath .build/DerivedData
```

Open Simulator, boot the selected device if it is currently shut down, then
wait for boot. Skip `boot` for an already booted device:

```sh
open -a Simulator
xcrun simctl boot "$TAMAGO_SIM_UDID"
xcrun simctl bootstatus "$TAMAGO_SIM_UDID" -b
xcrun simctl install "$TAMAGO_SIM_UDID" .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app
export TAMAGO_SIM_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' .build/DerivedData/Build/Products/Debug-watchsimulator/Tamago.app/Info.plist)"
xcrun simctl launch "$TAMAGO_SIM_UDID" "$TAMAGO_SIM_BUNDLE_ID"
```

The bundle ID is read locally from the build, never changed or published. For
the scheme's existing simulator tests:

```sh
xcodebuild test -project Apple/AppleTamago.xcodeproj -scheme TamagoWatch \
  -destination "platform=watchOS Simulator,id=$TAMAGO_SIM_UDID" \
  -derivedDataPath .build/DerivedData
```

If CoreSimulator is unavailable in a restricted session, report that limitation;
do not change signing, provisioning, targets or deployment settings. Physical
deployment is a separate owner-led task.

## After the Mac restarts: `scripts/tamago-up.sh` and the live dashboard (D-123)

Nothing starts Tamago at login yet. After a restart, run from the repository root:

```sh
scripts/tamago-up.sh
```

It checks `/Volumes/Storage` is mounted, starts Ollama (loopback, models on Storage) if needed and runs the LAN
gateway in that terminal with the owner's settings: brain + `llama3.2:3b`, on-device transcription, Kokoro
`af_heart` at 0.9×. The Watch stays paired (same token). Every setting can be overridden from the environment.

With `TAMAGO_MONITOR=1` (the script sets it) you get:

- **the terminal**: one line per hop: 🎤 voice arrived, 👂 heard "…", 🐙 Tamago "…", 🔊 voice made, 📲 Watch fetched it;
- **the dashboard**: <http://127.0.0.1:8788> (this Mac only). It shows:
  - conversations as chat bubbles with each hop timed;
  - when the Watch last checked in, and the gateway, Ollama and voice status;
  - the open pairing code;
  - ▶ replay of recent voice clips;
  - a box to send a test message as if from the Watch.

The words stay in memory and on screen only. The JSON log (metadata only) goes to `$TAMAGO_STATE_DIR/logs/gateway.log`.
Ctrl-C stops the gateway and leaves Ollama running.

## The Watch ↔ Mac loop (D-115, D-116)

Two gateway modes:

| Mode | Command (from `Gateway/`) | Auth | Discovery |
|---|---|---|---|
| **Paired / LAN** (the real product path) | `TAMAGO_HOST=0.0.0.0 npm start` | persistent token, obtained by pairing | publishes `tamagoai.local` + `_tamagoai._tcp` |
| **Loopback dev** | `TAMAGO_ALLOW_NO_AUTH=1 npm start` | none, `127.0.0.1` only | none |

In LAN mode the gateway prints a 6-digit **pairing code** (10 min, single use).
Its identity lives in `~/Library/Application Support/TamagoAI/gateway.json`
(`TAMAGO_STATE_DIR` overrides the directory, e.g. for a throwaway test).
Restarting keeps the same token, so a paired Watch stays paired. Moving that
file aside unpairs every Watch.

**On a Watch (simulator or device):** an unpaired app offers pairing on first
launch. Enter the code there, or hold on the creature and it asks. After that,
**hold ≥ 0.45 s anywhere on the creature** to talk: system dictation opens, the
text goes to the Mac, and the creature reacts. The Watch finds the Mac at
`http://tamagoai.local:8787`. Nobody types an address.

```sh
# check discovery from the Mac itself (same resolver path URLSession uses)
dscacheutil -q host -a name tamagoai.local
curl -s http://tamagoai.local:8787/v1/health
```

**Simulator limits and DEBUG launch hooks.** The simulator has no dictation, and
`simctl`/automation keystrokes don't reach the Watch's Scribble canvas. These
DEBUG-only environment variables (`SIMCTL_CHILD_…` on `xcrun simctl launch`)
bridge that without changing what's being tested:

| Variable | Effect |
|---|---|
| `TAMAGO_DEBUG_PAIRING_CODE=123456` | calls the same `pair(code:)` the pairing sheet uses |
| `TAMAGO_DEBUG_SUGGESTIONS="ping,state happy"` | the real system dictation sheet shows these as suggestions to tap |
| `TAMAGO_GATEWAY_URL` / `TAMAGO_GATEWAY_TOKEN` | developer override of the gateway (e.g. `http://127.0.0.1:8787` for loopback dev mode) |
| `TAMAGO_PREVIEW_STATE=<state>` | jump to a character state (screenshots) |

```sh
SIMCTL_CHILD_TAMAGO_DEBUG_PAIRING_CODE=394879 \
  xcrun simctl launch "$TAMAGO_SIM_UDID" "$TAMAGO_SIM_BUNDLE_ID"
SIMCTL_CHILD_TAMAGO_DEBUG_SUGGESTIONS="state happy,slow 6000" \
  xcrun simctl launch "$TAMAGO_SIM_UDID" "$TAMAGO_SIM_BUNDLE_ID"
```

The Debug tab (swipe left from the creature, DEBUG builds only) shows
**Diagnostics** first: semantic creature state, link phase, discovery, paired
Mac, gateway URL, provider, last request ID and round trip, speech, dictation,
last transport error, and **Stage W×H ✓/✗** (the full-screen invariant, AGENTS.md §5).
It also has the talk trigger, live gateway commands, pairing and unpairing,
the "Hello. I'm Tamago." speech test with rate/pitch, and creature-sound tests
(DEVELOPMENT PLACEHOLDER tones, since no approved assets exist).
`Gateway/mock/README.md` lists the mock provider's commands; `slow <ms>` is
useful for seeing `thinking`.

**Physical Watch:** everything above is `SIMULATOR_VERIFIED_ONLY`. Apple TN3135
warns that the simulator never enforces watchOS's networking restrictions. Test
on hardware both on Wi-Fi and with the paired iPhone's Wi-Fi *and* Bluetooth off
in Settings (D-116, device verification list).

## Assets, protocol and evidence

Follow [CHARACTER_ASSET_PIPELINE.md](CHARACTER_ASSET_PIPELINE.md) for source and
processed art, including the future Watch asset-catalog import. Follow
[MEDIA_CAPTURE_GUIDE.md](MEDIA_CAPTURE_GUIDE.md) for demos. No final art is supplied
by this support pass. The compact [architecture diagram](TAMAGO_ARCHITECTURE.md)
is ready for later README embedding.

[PROTOCOL_V1.md](PROTOCOL_V1.md) is the wire contract. Protocol changes require
both language definitions and regenerated fixtures (`npm run fixtures --prefix
Gateway`) together; ordinary documentation changes do not require regeneration.

**SIMULATOR_VERIFIED_ONLY** means built and observed in Simulator, not hardware.
**DEVICE_VERIFIED** requires a human observation on the physical Watch/iPhone
recorded in [DEVICE_TEST_LOG.md](DEVICE_TEST_LOG.md). Compilation alone establishes
neither. Use all five labels precisely as defined in [AGENTS.md](../AGENTS.md).
Append exact commands, outcomes, untested scope and one bounded next task to the
handoff log after meaningful work. Never infer physical behavior from a GIF.

## Xcode Cloud: every Apple change reaches TestFlight by itself

Set up once by the owner in Xcode (Apple only allows creating the first workflow there). The repo side is
ready: `Apple/ci_scripts/ci_post_clone.sh` writes the git-ignored `Apple/Config/Local.xcconfig` from two
workflow environment variables, so no bundle ID or team ID is ever committed.

1. Open `Apple/AppleTamago.xcodeproj` in Xcode → **Integrate → Create Workflow…** (or the Report navigator's
   Cloud tab). Choose the **TamagoPhone** app (it carries the Watch app).
2. When asked, **grant access to GitHub** for `CristoXD73/TamagoAI`.
3. Edit the workflow:
   - **Environment variables: none needed.** The post-clone script uses Xcode Cloud's built-in `CI_BUNDLE_ID`
     (the TamagoPhone bundle ID *is* the prefix) and `CI_TEAM_ID`. `TAMAGO_BUNDLE_PREFIX` / `TAMAGO_TEAM_ID`
     workflow variables still override them if you ever set them.
   - **Start Conditions:** *Branch Changes* on `claude/great-volta-ogpuw8`, with **Files and Folders** limited to
     `Apple/` (docs and gateway pushes don't spend build hours). Keep **manual start** too.
   - **Actions:** *Archive*, platform iOS, scheme **TamagoPhone**, deployment preparation **TestFlight (Internal
     Testing Only)**. Optionally *Test*, scheme **TamagoWatch**, an Apple Watch SE 3 (40 mm) simulator.
   - **Post-Actions:** *TestFlight Internal Testing* → group **Owner**.
4. **Build numbers:** local uploads used 0.1.0 builds 2–6; the version is now **0.1.1**, so Xcode Cloud's own
   numbering (1, 2, …) is unique within it. Bump `MARKETING_VERSION` again before switching back to local uploads.
5. Budget: the membership includes 25 compute hours a month; one archive of this project is a few minutes.

Local archives (`xcodebuild archive … CURRENT_PROJECT_VERSION=<n>`, then `-exportArchive` with
`destination=upload`) keep working alongside it.

## Natural voice: the Mac speaks for Tamago (D-121, PROTOCOL_V1 §16)

The gateway can synthesize each reply with a local neural voice (Kokoro-82M via sherpa-onnx; KittenTTS as the
lighter fallback). The Watch fetches and plays it, and falls back to its own voice on any problem. It's local
only: no cloud, no keys, no cloning. Research and licenses: [`VOICE_RESEARCH.md`](VOICE_RESEARCH.md).
**Status: UNVERIFIED** until it's run on the Mac and heard on the Watch.

```sh
cd Gateway
tools/tts/setup.sh                      # asks before each download; installs to /Volumes/Storage/AI/tts (≈ 450 MB est.)
tools/tts/setup.sh --kitten             # also the lighter fallback engine
tools/tts/setup.sh --selftest           # check the install, time one clip

export TAMAGO_TTS_MODEL_DIR=/Volumes/Storage/AI/tts
npm run voice-samples                   # 6 lines × every installed voice × 2 speeds, with times and sizes
open /Volumes/Storage/AI/tts/samples/index.html   # listen, press "Choose this one", tell your agent the line

TAMAGO_TTS=kokoro TAMAGO_TTS_VOICE=af_heart TAMAGO_TTS_SPEED=1.0 npm start   # the gateway prints "voice output: …"
```

- `TAMAGO_TTS=off` (default) turns it off, and replies carry no `speechAudio`. `say` uses an Apple voice
  instead (personal-use baseline).
- Budgets to check with the samples:
  - ≤ ~1 s synthesis for a short reply
  - ≤ ~60 KB per reply
  - ≤ 1 GB engine RAM
  - the Watch waits at most 2.5 s for the audio
- Each reply is one helper process, so the time includes loading the model. If that alone blows the 1 s budget,
  the next step is a persistent engine process, not a different voice.
- Logs show `speech_synth` with the request ID, engine, voice, bytes and milliseconds. They never include text or
  audio.
