# Brain F — real-model evaluation on the owner's Mac

Recorded by Claude Code on **2026-09-27** from real runs on the owner's Mac. Decision: **D-118**.
Architecture: [`BRAIN_ARCHITECTURE.md`](BRAIN_ARCHITECTURE.md).

## Setup

| Item | Value |
|---|---|
| Mac | Mac mini, Apple M6, **16 GB** RAM, macOS 27.0 |
| Node | v26.9.0 (built-in `node:sqlite`) |
| Ollama | **0.34.4** (Homebrew), `ollama serve` bound to `127.0.0.1:11434` only; models in `/Volumes/Storage/AI/ollama/models` (AGENTS.md §9) |
| Model | **`llama3.2:3b`** (id `a80c4f17acd5`, 2.0 GB) as both fast and smart |
| Why one model | The owner chose it for this phase: "just for testing", a stronger model comes later. The table below is therefore one model; compare the next one with the same script. |
| Script | `cd Gateway && TAMAGO_REASONER=ollama TAMAGO_FAST_MODEL=<model> TAMAGO_BRAIN_DB=/Volumes/Storage/AI/tamago-eval/<model>.sqlite node scripts/brain-eval.js --out <file.json>` (the database is deleted first; 25 turns incl. a process restart) |

The script covers the milestone (learn → restart → recall → "Thanks."), pronoun follow-up, facts with
accents, a preference, small talk, a complex "why", a secret, "don't remember that", a changed fact,
forget, a tool request, live information (weather, "is it running?"), and "what do you know about me?".

## Results

| | Run 1 (milestone-1 code) | Run 3 (after the fixes below) |
|---|---|---|
| Turns / reaching the model | 25 / 13 | 25 / 10 (live-info and unknown facts now handled by rule). Run 2, between the two fix rounds: 11 model turns, 11/11 valid |
| Valid JSON on the first try | **13/13** (no repair needed) | **10/10** |
| Errors / timeouts | 0 | 0 |
| Model turn latency, warm (min · median · max) | 790 · 993 · 1164 ms | 726 · 1004 · 1252 ms |
| Cold model load | 1.5 s (`load_duration`) | — |
| Ollama resident memory (peak) | 2.36 GB (model 2.2 GB, all on GPU) | 2.30 GB |
| Composer changes (assistant-isms caught) | 0 | 0 (the model didn't produce any) |
| Invented facts | **5**: "No" (is it running), "Rain" (weather), "I display owner's schedule, photos, and notes", "Teal" after the owner changed it to orange, "Teal" after forget | **0 about the owner or the world it can't see** |
| Stayed in character | Mostly; said "Owner's name is unknown" aloud | Yes: "I am calm.", "I sit and watch", "I don't know" |
| Wrong general knowledge | "Two hearts pump blue blood, one pumps red." | "…to pump blue-green blood and extra blood to their gills." (half right) |

One outlier: the first model call of run 2 took 4.6 s (the model had likely been reloaded; not investigated).
All replies are short enough for the Watch without the composer shortening them.

Raw runs (not committed; they sit with the eval databases): `/Volumes/Storage/AI/tamago-eval/run{1,2,3}-llama3.2-3b.json`.

### Through the gateway (Protocol V1)

A throwaway loopback gateway (`TAMAGO_PROVIDER=brain`, port 8788, eval database) answered real V1 requests
with the model: "My dog is named Pixel." → `Got it.`; "What is my dog's name?" → `Pixel`; "Thanks." →
the nonverbal envelope (`text: ""`, `characterState: happy`, `haptic: click`); weather → `I can't check that
yet.`; "Why do octopuses change color?" → `Octopuses change color to hide, communicate, or express emotions.`

## Defects found and fixed (each has a test in `Gateway/test/brain.test.js`)

| Defect (reproduced with the real model) | Fix |
|---|---|
| **Privacy:** a refused secret ("my wifi password is …") and an off-the-record sentence were still stored verbatim as conversation turns (7 days) and in traces, and fed back into later prompts | Such text is persisted only as `(private, not kept)` / `(off the record)`; traces redact it; a secret never reaches a model, even without an extractable fact |
| "Forget what I told you about X" removed the memory but the model recovered it from the conversation ("Teal") | Forget also blanks matching turns and Tamago's replies to them |
| Made-up live information: "Is it running right now?" → "No", weather → "Rain" | New deterministic `live_info` kind → "I can't check that yet." (no model) |
| After "my favorite color is orange now", the model repeated its earlier "Teal" from the conversation | Simple "what/where/who is my…" questions are answered from memory only: no matching memory → "I don't know that yet." by rule; a match → the model sees the memories without the older conversation |
| "What do you know about me?" → "You have a cat" (a dog) | Uses the strongest stored facts; none → "Not much yet." |
| Tamago said "Owner's name…" aloud | Prompt: talk to the owner as "you"; the composer rewrites a leftover "owner's" → "your" |
| "Lucía" stored as "Luc", "José" as "Jos" | Unicode-aware extractor and keywords |
| "orange now" stored with the time word | Trailing "now / anymore / these days" dropped from changed values |
| "How are you today?" routed to the smart model | Small-talk "how…you" isn't complex |

## Not verified

- Any other model (only `llama3.2:3b` was pulled, by the owner's choice).
- Quality over days of real use; memory growth; the relationship model over real days.
- The physical Watch path (TestFlight pending; see HANDOFF).
- The legacy `TAMAGO_PROVIDER=ollama` provider (`src/providers/ollama.js`): not run; still `UNVERIFIED_LOCAL_PROVIDER`.
