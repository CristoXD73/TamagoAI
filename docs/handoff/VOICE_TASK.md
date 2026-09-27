# Task for Claude Code (cloud): a natural voice for Tamago

**Issued:** 2026-09-27 by Claude Code (local, owner's Mac), at the owner's request.
**Owner's words:** "find and implement better and natural voices. So it sounds just like when ChatGPT talks to you."
**Branch:** `claude/great-volta-ogpuw8` (always `git fetch origin claude/great-volta-ogpuw8 && git pull --ff-only origin claude/great-volta-ogpuw8` before starting and before every push).
**Starting point:** commit `c92ebe1` or later.

---

## 0. What "done" means (read this first)

By the end, the repository has:

1. A researched, sourced shortlist of **local, permissively licensed neural text-to-speech (TTS)** engines and voices that
   run on the owner's Mac mini (Apple M6, 16 GB), with a recommendation (`docs/VOICE_RESEARCH.md`).
2. A **Mac-side speech pipeline** in the gateway: the Mac turns Tamago's reply into natural-sounding audio with the
   chosen engine, and the Watch fetches and plays it. It's behind a clean interface, fully tested with a stub,
   and does nothing when no engine is installed.
3. An **additive** Protocol V1 extension (§16) so the Watch can get that audio, with the current Watch
   `AVSpeechSynthesizer` voice as the automatic fallback.
4. The **Watch-side Swift** changes to play that audio, written carefully but labeled `UNVERIFIED` (you have no
   Xcode). The local Claude on the owner's Mac compiles, tests and ships them.
5. A **setup + listening kit** the local agent runs on the Mac: install the engine and models to the Storage disk,
   generate the same Tamago lines in each candidate voice, and give the owner a page to pick one by ear.
6. Decision **D-121** recording the design, a worklog entry per commit, and a handoff entry with ONE next task.

You are **not** expected to pick the final voice. The owner picks by ear on the Watch. Your job is to make that
choice easy, fast and safe, and to have everything ready for the moment they choose.

---

## 1. Catch up (read in this order, binding)

1. `AGENTS.md`, all of it. In particular §2 (hard prohibitions: **no cloud AI provider credentials, local-AI-first**),
   §3 (verification labels), §8 (worklog before every commit), §9 (Storage disk: models live on `/Volumes/Storage`,
   never in the repo, never on the internal disk).
2. `CLAUDE.md`: repo map, commands, cloud limits (**no Xcode or Swift toolchain in the cloud: never claim Swift compiles**).
3. The latest entries at the bottom of `docs/HANDOFF_LOG.md` and `docs/AGENT_WORKLOG.md`: what just happened on
   the real Watch.
4. `docs/DEVICE_TEST_LOG.md`, the last three sections: the first physical Watch runs, including hold-to-talk.
5. `docs/DECISIONS.md`: **D-002** (zero-dependency Node gateway), **D-106** (voice input and TTS), **D-115/D-116**
   (transport, pairing), **D-117/D-118** (the brain, llama3.2:3b), **D-119** (answers are spoken + captioned),
   **D-120** (hold-to-talk; the transcriber helper you'll mirror).
6. `docs/PROTOCOL_V1.md`: §3 (request IDs, dedupe), §5 and §5.1 (response envelope, nonverbal replies),
   §14 (pairing), §15 (audio input, the pattern for an additive endpoint).
7. `docs/CREATURE_SPEC.md` §1 (personality) and **§9.4 (the voice)**: calm, curious, "from the water", never
   cartoonish, 1–2 spoken sentences. Your design changes where synthesis happens (Mac instead of Watch); record
   that in D-121.
8. Code you'll mirror or touch:
   - `Gateway/src/transcriber.js` + `Gateway/tools/transcribe/`: **the pattern to copy** (a local helper process
     outside npm, found via env/default path, absent means the feature is off).
   - `Gateway/src/server.js`: `/v1/request`, `/v1/audio`, dedupe map `recent`, `runProvider`, logging rules.
   - `Gateway/src/protocol.js`: `LIMITS`, `buildOkResponse`.
   - `Gateway/test/audio.test.js`: test style for helper-backed endpoints.
   - `Apple/WatchApp/SpeechOutput.swift`: current AVSpeechSynthesizer path (on by default, audio session off-main,
     `onFinished` contract).
   - `Apple/WatchApp/TamagoConnection.swift`: the `.speak` effect, caption, D-106 speech watchdog.
   - `Apple/Shared/GatewayTransport.swift`: `GatewayClient` (injectable `fetch`, never throws).

### Current state in one paragraph

The owner's Apple Watch SE 3 (watchOS 27) runs TamagoAI from TestFlight. It pairs with the Mac by IP address
(`tamagoai.local` doesn't resolve from the Watch yet). Hold the octopus → the Watch records → `POST /v1/audio` →
the Mac transcribes on-device (Apple SpeechAnalyzer helper) → the brain (llama3.2:3b via Ollama) answers → the
Watch shows a caption and speaks it with **`AVSpeechSynthesizer`'s default voice**. That voice is what the owner
wants replaced with something natural and warm, "like ChatGPT's voice mode". Gateway tests: 116/116. Swift: 140/140
(host). Everything else you need is in the documents above.

---

## 2. Guardrails (hard rules: breaking one means the work gets reverted)

**Privacy, product and legal**
- **Local only.** No cloud TTS or AI APIs of any kind (OpenAI, ElevenLabs, Google, Azure, AWS, Cartesia, etc.), no
  API keys, no accounts. Tamago's words and voice never leave the owner's Mac and Watch. (AGENTS.md §2)
- **"Like ChatGPT" means natural quality, not a copy.** Do **not** clone, imitate or fine-tune toward OpenAI's
  voices or any real person's voice. No voice cloning from reference recordings of anyone. Use the stock voices
  that ship with a model under its license.
- **Licenses:** the engine code and model weights must both be **permissive** (Apache-2.0, MIT, BSD, or similar)
  for code *and* weights. Anything non-commercial (for example CC-BY-NC weights, Coqui CPML) or unclear goes in
  the research table marked **"not eligible"**, with the reason. Record each adopted component in
  `THIRD_PARTY_NOTICES.md` and `docs/UPSTREAM_REUSE.md` (AGENTS.md §4).
- Never commit model files, voices, binaries or generated audio. Add ignore rules if needed. Models live on the owner's
  Mac under `/Volumes/Storage/AI/tts/` (AGENTS.md §9), configured by env var, never hardcoded in source.
- Logs stay **metadata-only**: request ID, byte counts, timings, engine/voice name. Never the reply text or audio.

**Architecture**
- **Gateway stays zero-npm-dependency** (D-002): Node built-ins only. The TTS engine runs as a separate local
  helper process, exactly like `tools/transcribe`. If the helper is missing, speech audio is simply unavailable
  and everything works as today.
- **Protocol V1 is extended additively only** (new optional response field + new endpoint). No V2, no breaking
  change, no renamed fields. Old Watch builds must keep working unchanged. Update `docs/PROTOCOL_V1.md` (§16),
  `Gateway/src/protocol.js`, `Apple/Shared/TamagoProtocolV1.swift` and fixtures (`cd Gateway && npm run fixtures`)
  together (AGENTS.md §1).
- **The text reply must not wait for audio.** The caption and the V1 response go out immediately; audio is
  synthesized in parallel and fetched by the Watch. A slow or failed synthesis must never delay or break the reply.
- **Fallback always:** if the audio isn't ready within a budget (propose ~2.5 s), fails, or is absent, the Watch
  speaks with `AVSpeechSynthesizer` as today. The D-106 speech watchdog and `onFinished` contract must still hold,
  so the creature never gets stuck in `.speaking`.
- Watch audio: activate or deactivate `AVAudioSession` **off the main thread** (the runtime flagged a hang risk;
  see `SpeechOutput.swift`). `.playback` / `.voicePrompt`. No background audio modes, no keep-alive tricks
  (AGENTS.md §2).
- Budgets to design for (the owner's Mac under load, also while gaming): synthesis of 1–2 sentences **≤ ~1 s**
  warm; audio ≤ ~60 KB per reply (AAC mono, 22–24 kHz); engine RAM ideally ≤ 1 GB, next to Ollama's 2.3 GB.

**Scope and process**
- **Don't touch:** character art, animation, `FloatingCreature.swift`, `tools/previz/`, `3D/`, `Assets/CharacterReference/`,
  the Xcode project file, the brain's reasoning/memory code, pairing/transport logic beyond what §16 needs.
- **Cloud honesty:** you can't run macOS, `say`, Swift, Xcode or the Watch. Label Swift `UNVERIFIED` (written, not
  compiled). Label gateway behavior `UNIT_TESTED_ONLY` unless you truly ran a real engine. **Nothing is
  `DEVICE_VERIFIED`** until the owner hears it on the Watch. Never claim another agent's results.
- `cd Gateway && npm test` green before **every** commit. New code needs tests (stub the TTS helper; tests needing a
  real engine must `skip` cleanly when it isn't installed, like the SpeechAnalyzer test in `audio.test.js`).
- Small, coherent commits. **An `AGENT_WORKLOG.md` entry before every commit** (AGENTS.md §8, signed, with a
  machine timestamp). Commit trailer per your environment. Push to `claude/great-volta-ogpuw8` only, after
  `pull --ff-only`. **No force push, no merge to main, no PR** unless the owner asks.
- **Downloads:** in the cloud you may download candidate engines or models *into your sandbox* to evaluate them.
  Never add a download step that runs automatically on the owner's Mac. Setup scripts must be run deliberately
  by the local agent, print what they download (source, size) first, and install to `/Volumes/Storage/AI/tts/`.

---

## 3. Step by step

### Step 1 — Research (write `docs/VOICE_RESEARCH.md`)
Survey local neural TTS options that run on Apple Silicon macOS, offline. At minimum evaluate: **Kokoro-82M**
(for example via `sherpa-onnx` or `kokoro-onnx`), **Piper**, **MeloTTS**, **Chatterbox**, **StyleTTS 2**, **Sesame CSM-1B**,
**Orpheus**, **F5-TTS**, **XTTS-v2**, plus the baseline: Apple's own voices (Watch `AVSpeechSynthesizer` today,
and what Enhanced/Premium voices exist on watchOS 27; cite Apple docs). For each, record: license (code **and**
weights), naturalness (cite published MOS/TTS-arena rankings or model cards; don't invent numbers), size on disk,
RAM, expected speed on an M-series CPU/GPU/ANE, how it runs without npm (single binary? Python venv? Swift/Core
ML?), English voices available, and eligibility under §2. Cite every claim with a source link. End with a
recommendation: **one primary engine, one lighter fallback, 3–5 candidate voices** for the owner's listening test.
Prefer an engine with a **prebuilt macOS arm64 binary and no Python**, if quality allows (for example the
`sherpa-onnx` offline TTS CLI).

### Step 2 — Design (append **D-121** to `docs/DECISIONS.md`, and write PROTOCOL_V1 §16)
Recommended shape (improve it if your research says so, and say why):
- The brain produces the reply as today. `runProvider`'s V1 body gets an optional
  `speechAudio: { "path": "/v1/speech/<requestId>", "format": "audio/mp4", "voice": "<id>" }` **only when a
  synthesizer is configured**. Synthesis starts in the background as soon as the text exists. It's keyed by
  request ID in a small in-memory cache (bounded entries, TTL ~2 min, deleted after first successful fetch or
  expiry).
- `GET /v1/speech/<requestId>`: bearer auth, UUID-validated ID (no path tricks), waits up to the budget for the
  pending synthesis, answers `200 audio/mp4` with `content-length`, or `404`/`503` with the standard error
  envelope. Never logs text.
- Both `/v1/request` and `/v1/audio` replies get it. Nonverbal replies (§5.1) get none.
- `GET /v1/protocol` advertises it (for example `outputTypes: ["text", "speech-audio"]`) only when available.
- D-121 must state: why the Mac and not the Watch synthesizes (watchOS has no third-party neural TTS; the Mac has
  headroom), the fallback, the privacy posture, the license outcome, and that **CREATURE_SPEC §9.4's
  "on-device synthesis" is superseded by "on the owner's own Mac", still local**, at the owner's request.

### Step 3 — Gateway implementation (Node built-ins only)
- `Gateway/src/tts.js`: `createSynthesizerFromEnv(env)` → `{ name, voice, synthesize(text, { signal }) → Buffer }` or
  `null`. Mirror `transcriber.js`: runs a helper via `execFile` with a timeout, writes into a private temp dir, and
  deletes it after. Env: `TAMAGO_TTS=off|<engine>`, `TAMAGO_TTS_COMMAND` (helper path), `TAMAGO_TTS_VOICE`,
  `TAMAGO_TTS_SPEED`, `TAMAGO_TTS_MODEL_DIR` (default suggestion `/Volumes/Storage/AI/tts`, via env only).
- The helper under `Gateway/tools/tts/` (a small shell script is fine): turns text into a WAV with the engine, then
  converts it to AAC m4a with macOS's built-in `afconvert` (mono, 22.05 or 24 kHz). Prints nothing but errors.
  Handles text safely (no shell injection: pass text via stdin or a temp file, **never** interpolated into a
  command line).
- Text prep before synthesis (a pure, tested function): the composer's final speech string, numbers and units read
  naturally, strip anything the composer missed (markdown, emoji), cap length.
- `server.js`: the cache, the background synthesis, `GET /v1/speech/:id`, the response field, protocol-info.
  `cli.js`: wire it and log `voiceOutput: <engine/voice> | unavailable`.
- Tests (`Gateway/test/speech.test.js`, stub synthesizer): field present only when configured; the text reply
  isn't delayed by a slow synthesis (assert timing with a slow stub); fetch returns the bytes once, then
  404/expiry; auth required; bad ID rejected; synthesis failure → 503 with error envelope, and the text reply
  unaffected; nonverbal → no field; dedupe/retry of the same request ID doesn't synthesize twice; nothing
  textual is logged (capture the logger). A real-engine test that skips when the helper or models are absent.
- `npm run fixtures` if the protocol-info fixture changes. Everything green.

### Step 4 — Watch side (Swift, **UNVERIFIED**, keep it small)
- `Apple/Shared/TamagoProtocolV1.swift`: optional `speechAudio` on `TamagoResponse` (decodes when absent; unknown
  fields still ignored). Add a fixture + expectations in `ProtocolFixtureTests.swift` (manifest count goes up).
- `Apple/Shared/GatewayTransport.swift`: `func speechAudio(path:) async -> Data?` using the same injectable
  `fetch` (so it's testable on the host with the existing `StubFetch`), with a short timeout. Add tests to
  `GatewayClientTests.swift`.
- New `Apple/WatchApp/AudioReplyPlayer.swift` (or extend `SpeechOutput`): given a response with `speechAudio`,
  fetch → play with `AVAudioPlayer` (session off-main, `.playback`/`.voicePrompt`) → call the **same**
  `onFinished` → deactivate off-main. If fetching takes longer than the budget, or anything fails: fall back to
  `AVSpeechSynthesizer` with the same text. Keep the caption behavior and the D-106 watchdog (its estimate should
  use the audio's real duration when known).
- The `.speak(text:)` effect carries only text today. Get the audio path to the player **without changing
  `CharacterStateMachine`** (for example TamagoConnection remembers the latest response's `speechAudio` by
  request ID). Explain the choice in D-121.
- Mark every Swift file you touch with a `VERIFICATION: UNVERIFIED (written in the cloud, not compiled)` note for
  the local agent to replace.

### Step 5 — Setup and listening kit (for the local agent to run on the Mac)
- `Gateway/tools/tts/setup.sh`: installs the chosen engine binary and models into `/Volumes/Storage/AI/tts/`.
  Prints each download (URL, size, license) and asks before downloading. Verifies checksums. Never touches the
  internal disk beyond tiny caches. Idempotent.
- `Gateway/scripts/voice-samples.js` (or `.sh`): generates the **same 6 Tamago lines** in every candidate voice,
  at 2 speeds each, into `/Volumes/Storage/AI/tts/samples/`, plus a simple local `index.html` listing them for the
  owner to compare. Suggested lines, mixing Tamago's register:
  - "Hi."
  - "Pixel."
  - "I can't check that yet."
  - "Some sea slugs can photosynthesize like plants."
  - "Your favorite color is orange."
  - "I didn't catch that."
- Document the local steps in `docs/DEVELOPMENT.md` (a short "Natural voice" section) and in the handoff.

### Step 6 — Wrap up
- `docs/VOICE_RESEARCH.md`, D-121, PROTOCOL_V1 §16, notices, DEVELOPMENT section, README test counts if changed.
- A final `docs/HANDOFF_LOG.md` entry: branch, commits, commands run, results, what's unverified, and **ONE next
  task** for the local agent. Expected: "run `setup.sh`, generate samples, owner picks a voice by ear, compile +
  test the Swift, ship a TestFlight build, record in DEVICE_TEST_LOG".

---

## 4. Report back (to the owner, plain language)

Branch, commit SHAs, pushed yes/no, clean tree yes/no; the research table (top 5) and your recommendation with
licenses; what you implemented and its labels; test counts; exactly what the local agent must run on the Mac;
what the owner will hear and choose; everything still unverified. No invented benchmarks: if you didn't measure
it, say "from <source>" or "not measured".
