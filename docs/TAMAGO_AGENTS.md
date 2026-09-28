# Tamago as a local agent: target architecture

**Status:** ARCHITECTURE, 2026-09-28 (Claude Code on the owner's Mac). Built parts are marked. It joins:
[TAMAGO_HANDS.md](TAMAGO_HANDS.md) (Mac control), [RELAY_PLAN.md](RELAY_PLAN.md) (Claude/Codex),
[TAMAGO_SELF.md](TAMAGO_SELF.md) (self-knowledge), [BRAIN_ARCHITECTURE.md](BRAIN_ARCHITECTURE.md) (memory,
personality).

**Owner, 2026-09-28:**
- The owner proposed this shape: a main reasoning LLM (20–30 GB), an agent router, and coding / memory / vision
  agents.
- "When im running agents im not gonna run games or xcode."
- "do the best with the current machine, and test it all yourself. We will switch once we have the 32gb."

## 1. The shape (the owner's diagram, with three changes)

```
                    LOCAL M6 AGENT
         ┌──────────────────────────────────┐
         │  ONE local model, multimodal      │  16 GB today: Gemma 4 12B (or Qwen 3.5 9B)
         │  (every agent borrows it)         │  32 GB later: a 27–30B model (Qwen 3.8 27B / Nemotron 30B)
         └────────────────┬─────────────────┘
                          │
         ┌────────────────▼─────────────────┐
         │  Router: rules first, model only  │  built: intent-router.js (+ hands routing)
         │  when unsure                      │
         └────────────────┬─────────────────┘
      ┌──────────────┬────┴─────────┬───────────────┬──────────────┐
  Talk / memory   Mac hands      Coding          Vision          Helpers
  (built)         (built)        agent           agent           Claude / Codex /
  SQLite memory   15 tools,      local git +     screenshots,    ChatGPT via
  + search,       confirm,       terminal tools  UI control,     the relay
  personality     audit log      + the relay     (camera: off)   (built, R2)   
```

**The three changes, and why:**
1. **One model, many toolboxes.** Separate coding, memory and vision models can't be loaded side by side. Gemma 4
   and Qwen 3.5 already read images, so one model plays every agent. Each agent is a set of tools plus its own
   instructions. The only extra model worth loading is a small embedding model (~0.3 GB) for memory search.
2. **Rules route first.** An LLM call to route each sentence costs seconds. Clear cases ("open Steam", "what time
   is it", "tell Claude to…") are routed by rules in about 1 ms, and the model is asked only when it's unclear.
3. **The coding agent is hybrid.** Local tools handle small jobs (git status, run the tests, read a file). Real
   coding goes to Claude Code / Codex through the relay, which on 16 GB is far stronger than a local 12B. On 32 GB,
   a local 27–30B model can take the medium jobs.

## 2. Memory budget

| | 16 GB (now) | 32 GB (next) |
|---|---|---|
| macOS + Chrome + Claude app | ~6–8 GB | ~6–8 GB |
| Main model | Gemma 4 12B, ~7.6 GB (Qwen 3.5 9B ~5.5 GB while Xcode runs) | 27–30B at 4-bit, ~17–20 GB |
| Model working memory (long agent context) | ~1 GB (4k context) | ~2–4 GB (16–32k context) |
| Voice, gateway, embeddings | ~1 GB | ~1 GB |
| Games / Xcode at the same time | model unloads (Console Mode, D-123/D-125) | not while agents run (owner) |

## 3. Build order on the current machine

| # | Piece | State |
|---|---|---|
| 1 | Talk, memory, personality, voice | built (D-118…D-127) |
| 2 | Mac hands (tier 1–2) | built (D-128) |
| 3 | Helpers: "tell Claude to…", usage figures, questions back, status | built (relay R2, D-129). Tests use fake agents; verified live on the Sandbox project |
| 4 | Local coding tools (git status, run tests, read a file) for small jobs | after 3 |
| 5 | Memory search with embeddings | after 4; measured against the current keyword search |
| 6 | Vision (screenshots, UI control) | needs the owner at the Mac to grant Screen Recording + Accessibility |
| 7 | Switch to 32 GB | re-run BRAIN_EVAL / relay-intent-eval on Qwen 3.8 27B and Nemotron 30B, then pick |

Every piece is tested by me on this Mac before it's called done. The record lives in each piece's own doc.

## 4. System 1 / System 2 (the owner's second diagram), measured 2026-09-28

**The proposal:**
- A fast 1–2B "System 1" decides the intent, the tool, easy or hard, and memory relevance, and checks each result.
- A 4–9B "System 2" takes the hard cases.

**What Tamago already has:**
- **System 0 (rules):** `intent-router.js` + `model-router.js`, about 1 ms. It already sorts easy from hard: time, memory,
  Mac commands and helper talk go to rules or tools, and only open conversation reaches a model.
- **System 2:** Gemma 4 12B, 39/40 on the command test, about 3 s.
- **The success check is deterministic:** every tool returns `ok` plus a plain sentence, and the confirm tools wait for a
  spoken yes. No model judges success.

**The measurement:**
- Qwen 3.5 2B ran the same 40 spoken commands as the other models (`relay-intent-eval.js`; raw run
  `/Volumes/Storage/AI/tamago-eval/r1/intent-qwen3.5-2b.json`).
- It understood **21/40** at 1.05 s median, the same as llama3.2:3b.
- It read every answer to a waiting question as a new task, "stop Claude" as pause, and small talk and facts as tasks.

**Verdict: not an improvement on 16 GB. Not adopted.**
1. **Too inaccurate to gate.** A 1 in 2 miss rate in front of Gemma turns right answers into wrong tools.
2. **Not fast enough to pay for itself.** 1 s per sentence adds latency on the hard path. The easy path is already 1 ms
   with rules.
3. **Memory.** A second model resident costs ~2.5 GB that Gemma needs, and Ollama swaps models on 16 GB.
4. **An LLM success check is weaker than the tool's own `ok`,** and that check already exists.

**Kept from the idea:**
- The layering itself: cheap first, big model only when needed. It is what the rules already do.
- New fixed phrases the models miss get rules, not a small model.

**Revisit on 32 GB:** a 2–4B model can stay loaded beside a 27–30B one. Re-run the same test; adopt it as the "unsure"
tier only at ≥36/40 and under 0.5 s.
