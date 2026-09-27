# Tamago Brain — Mac-side intelligence architecture

**Status (2026-09-27): Milestone 1 built (Brain A–D), Brain F done.** The logic is `UNIT_TESTED_ONLY` (108
gateway tests). The Ollama reasoner is **verified on the owner's Mac with `llama3.2:3b`** (Ollama 0.34.4,
2026-09-27): results, defects found and fixed in [`BRAIN_EVAL.md`](BRAIN_EVAL.md). Decisions: D-117, D-118.

> **The LLM is not Tamago. The LLM is one reasoning component inside Tamago.**
> Personality, memory, familiarity, routing and the Watch contract are deterministic code and data.
> Swapping the model changes how well Tamago *reasons*, never *who it is*.

## 1. Shape

```text
 Watch ──Protocol V1──▶ Gateway (auth, pairing, dedupe, timeouts)          [unchanged]
                           │  provider.generate(request)  (TAMAGO_PROVIDER=brain)
                           ▼
              ┌──────── Interaction Orchestrator ────────┐   src/brain/orchestrator.js
              │ classify → session → extract → retrieve  │
              │ → relationship/world → route             │
              │   rule ──────────────┐                   │
              │   fast/smart → Context Builder → Reasoner│   (Ollama | deterministic fallback)
              │ → validate TamagoIntent → Speech composer│
              │ → Memory write gate → commit → trace     │
              └──────────────┬───────────────────────────┘
                             ▼
                 TamagoIntent ──toV1Result──▶ V1 envelope (speech | nonverbal, reaction state, haptic)
```

The Watch still knows nothing about models, memory, tools or relationship math. Protocol V1 is unchanged,
except for one backward-compatible clarification: nonverbal replies (PROTOCOL_V1 §5.1), which the Watch
client already handled.

## 2. Modules (`Gateway/src/brain/`)

| Module | Role |
|---|---|
| `orchestrator.js` | Owns the lifecycle. Commits atomically (turns, memories, relationship, trace). **An aborted or timed-out interaction commits nothing.** |
| `response-schema.js` | **TamagoIntent**: `speech` (or `null` = silence), private `thought`, `emotion`, `energy`, `attention`, `sound`, `haptic`, `behavior`, `followUpExpected`, `memoryCandidates`, `tool`. It's a JSON schema for the model, validation (unknown enums are errors), and the mapping to V1. `sound`, `behavior`, `attention` and `thought` stay on the Mac (in the trace) until a protocol revision needs them. |
| `personality/profile.js` | The personality **as data** (temperament, communication, behavior flags). The model sees a compact prompt *generated* from it (< 1200 chars). |
| `personality/behavior-policy.js` | Deterministic replies that never need a model: gratitude and affirmation are nonverbal; greetings are watchful when "new" and brief once acquainted. |
| `routing/intent-router.js` | Deterministic classification: gratitude, affirmation, greeting, forget, tool_request, recall, question, statement. It also detects complexity, "don't remember" requests and pronouns, and extracts keywords. |
| `routing/model-router.js` | `rule` (no model) · `fast` · `smart` (complex *why/how* questions). |
| `context-builder.js` | A budgeted context of ≤ 1800 chars: memories, this conversation, relationship, now, route. When over budget it drops the oldest turns first, then the weakest memories. |
| `reasoners/ollama.js` | Ollama `/api/chat` with **structured outputs** (`format` = the intent schema). One repair attempt on invalid JSON, then a structured `provider_error`, never raw model text. Fast/smart model routing, and a health check. Verified with `llama3.2:3b` on the owner's Mac ([`BRAIN_EVAL.md`](BRAIN_EVAL.md)); other models unverified. |
| `reasoners/deterministic.js` | **Offline fallback and test double. Not intelligence.** It answers only from structured memories. Otherwise it says it doesn't know or reacts nonverbally. It's used automatically when Ollama is unreachable. |
| `memory/extractor.js` | Rule-based fact candidates from the owner's own words ("my X runs on Y", preferences, names, "remember that…"). |
| `memory/gate.js` | **The write gate.** It rejects: owner said "don't remember", secret-like content (passwords, keys, card numbers, long opaque strings), low confidence (rule < 0.7, model < 0.8), low importance per type (episodic needs 0.75). |
| `memory/store.js` | Dedupe (same key + value → reinforce, same key + new value → supersede, keyless near-duplicates → reinforce). |
| `memory/retrieve.js` | SQLite FTS5 (porter stemming) + importance/strength/recency. Returns **≤ 5 memories**, and the top style preferences always ride along. `forgetMatching()` supports "forget what I told you about X". |
| `relationship/model.js` | Deterministic familiarity (§5). |
| `world/state.js` | Time of day, the circadian energy curve (CREATURE_SPEC §2.1), last seen, reasoner availability. |
| `session.js` | Sessions close after 15 min idle. The last 6 turns go into context. Pronouns borrow the last *real* topic ("Thanks." carries none). |
| `maintenance.js` | Cheap housekeeping when a session closes: message retention (7 days), trace cap (50). **No background LLM.** |
| `storage/database.js` | One SQLite file via built-in `node:sqlite` (**zero npm dependencies**; needs Node ≥ 22.13, the owner has 26.9). Versioned migrations. |
| `index.js` | Env wiring shared by the gateway and the CLI. |

## 3. State layers

| Layer | Lifetime | Where |
|---|---|---|
| Immediate | one interaction | orchestrator locals + the `traces` row |
| Session | ≤ 15 min idle gaps; messages kept 7 days | `sessions`, `messages` |
| Long-term | until forgotten | `memories` (semantic, preference, episodic, procedural), `relationship` (one tiny row) |

`world_events` is reserved for provider/tool events (Brain E).

## 4. Memory

- **Types:** `semantic` (stable facts), `preference`, `episodic` (things that happened; high bar),
  `procedural` (how things are done; used by tools later). The relationship isn't a memory blob. It's
  one deterministic row.
- **Write path:** rule extractor and model proposals → **gate** (privacy, confidence, importance) →
  dedupe/supersede → store. The model can *propose*; it never writes directly.
- **Honesty:** Tamago never says "Got it" about something the gate refused ("I don't keep secrets like
  that." / "Okay. I won't keep that.").
- **Owner control:** say "forget what I told you about X", or use `tamago brain forget <id>` or
  `tamago brain reset --yes`.
- **Privacy:** the database lives in the owner's state directory (`~/Library/Application Support/TamagoAI/
  brain.sqlite`), is git-ignored, and nothing leaves the Mac. Gateway logs remain metadata-only.

## 5. Familiarity (never a meter, never decreases)

A day earns **1 presence credit** on its first interaction, plus a capped quality bonus of ≤ 0.5 per day.
Stages: `new` (0) → `recognizing` (2) → `familiar` (5) → `bonded` (14). **Absence changes nothing.**
Fifty interactions in one day don't buy familiarity (tested). Current effects: greetings go from
watchful to verbal, and learning a fact is acknowledged nonverbally once familiar. The same stage will
drive animation parameters on the Watch when a protocol revision carries it (CREATURE_SPEC §6).

## 6. Silence is first-class

`speech: null` is a valid, common outcome ("Thanks." → `pleased · soft_ack · settle` + haptic click). On
the wire it becomes a V1 nonverbal envelope (`text: ""`, `speechText: ""`, `characterState: happy`,
`haptic: click`). The speech composer also strips assistant filler ("Great question!", "Let me know if…",
"As an AI…"), emoji, markdown and URLs, and caps speech at 2 short sentences / 140 characters. Pure
filler becomes silence.

## 7. Use it

```sh
cd Gateway
npm test                                            # 108 tests, no model or network needed
npm run brain -- chat                               # talk to the brain in the terminal
npm run brain -- inspect                            # why did it answer that? (full decision trace)
npm run brain -- memories | status | forget <id> | reset --yes

# behind the Watch-facing gateway
TAMAGO_PROVIDER=brain npm start                                 # deterministic reasoner (no model)
TAMAGO_PROVIDER=brain TAMAGO_REASONER=ollama npm start          # Ollama, D-118 default llama3.2:3b (fast = smart)
TAMAGO_PROVIDER=brain TAMAGO_FAST_MODEL=llama3.2:3b TAMAGO_SMART_MODEL=<bigger> npm start
```

Verified transcript (deterministic reasoner, a process restart between the first line and the rest):

```text
You > Hey, my Jellyfin runs on this Mac.
Tamago > Got it.  (rule)
        — restart —
You > Where does my Jellyfin run?
Tamago > On this Mac.  (fast · deterministic)
You > Thanks.
Tamago > [nonverbal: pleased · soft_ack · settle · haptic click]  (rule)
```

`inspect` shows the classification, route, reasoner, session, retrieved memories with scores, relationship,
world, the exact model context, the full structured intent, gate decisions, memory operations, and the V1
envelope the Watch received.

## 8. What is deliberately not built yet

| Phase | Status | Notes |
|---|---|---|
| **A** Structured intelligence | ✅ built | orchestrator, TamagoIntent, profile, behavior policy, composer |
| **B** Sessions | ✅ built | idle sessions, pronoun topic carry-over, abort = no commit |
| **C** Memory | ✅ built | SQLite + FTS5, gate, dedupe/supersede, forget |
| **D** Familiarity | ✅ built | deterministic, day-based, never decreasing |
| **E** Tools | ❌ not started | Tamago answers honestly: "I can't do that yet." / "I can't check that yet." A model-requested `tool` is recorded, never executed. Next: registry + risk levels (0 read-only … 3 prohibited) + policy engine + confirmation + mock tools, then `jellyfin.status`. |
| **F** Real Ollama validation | ✅ done (`llama3.2:3b`) | [`BRAIN_EVAL.md`](BRAIN_EVAL.md): 34 model turns, all valid JSON first try, ~1 s warm, 2.3 GB; 9 defects fixed. Re-run `scripts/brain-eval.js` for the next model. |
| LLM consolidation | ❌ | Session summaries → episodic memories, when real transcripts show it's needed |
| Embeddings | ❌ | Only if FTS retrieval proves insufficient |
| Protocol V2 | ❌ intentionally | Only when the Watch needs a new semantic capability (e.g. carrying `behavior`/`sound`/familiarity for animation) |

## 9. Brain F — validation on the owner's Mac (16 GB)

**Done 2026-09-27 with `llama3.2:3b`: see [`BRAIN_EVAL.md`](BRAIN_EVAL.md).** The plan it followed, kept for the next model:

1. `ollama pull` 2–3 candidates (e.g. a ~3B fast model and a 7–8B smart model).
2. `TAMAGO_REASONER=ollama TAMAGO_FAST_MODEL=… TAMAGO_BRAIN_DB=/Volumes/Storage/AI/tamago-eval/<model>.sqlite
   node scripts/brain-eval.js --out <file>.json` (the milestone plus 24 everyday utterances; the database is reset
   first), or talk to it with `npm run brain -- chat`.
3. Record for each model: first-token and total latency (the `inspect` trace has `totalMs`), JSON validity
   rate (the `attempts` field), assistant-isms caught by the composer, invented facts, and RAM.
4. Pick fast/smart defaults, record them in DECISIONS, and flip `UNVERIFIED_LOCAL_PROVIDER` only with that evidence.
