# Relay plan: talk to Tamago, and it runs Claude, Codex or ChatGPT on your projects

**Status:** PLAN (2026-09-27, Claude Code on the owner's Mac). Nothing here is built yet. The owner's
decisions (section 9) come first, then phases R0–R6 in order. Every phase ends with tests and a worklog entry.

**Owner's goal (2026-09-27):**
- Speak to the Watch; Tamago passes the work to Claude, ChatGPT or Codex and keeps projects moving.
- It relays short questions back to the owner.
- It notices when an AI has run out of credits and asks to transfer the task.
- It reads what the last AI was doing and passes the baton efficiently.

---

## 1. The shape of it

```
 Watch (voice) ──▶ Mac gateway ──▶ Tamago brain (local, fast) ──▶ Relay
      ▲                                                              │
      │   short spoken questions / updates                           ├─▶ Claude Code  (claude -p, stream-json)
      └──────────────────── inbox ◀─────────────── Relay ◀───────────┼─▶ Codex CLI    (codex exec --json)
                                                                     └─▶ "ChatGPT"    (see decision 1)
```

- **Tamago's brain stays small, fast and local.** It understands what you said, routes it, confirms it back,
  shortens questions and summarizes progress.
- **The heavy work is done by the big agents**, running headless on this Mac under your subscriptions.
  - They work inside a project folder on their own branch.
  - They report through the relay.
  - The relay records everything they print.
- **The live dashboard (D-122) becomes mission control.** It shows tasks, which agent holds each one, the agent's
  live output, questions waiting for you, and every handoff.

## 2. A stronger brain, honestly sized for this Mac

This Mac has **16 GB of RAM**, shared with Kokoro, speech recognition, Xcode and the agents themselves.
- That caps a comfortable local model at about 8B parameters (about 5–6 GB at 4-bit).
- 30B+ models don't fit. "Much stronger" therefore comes from two layers:

| Layer | What | Speed | Used for |
|---|---|---|---|
| **Local brain** | upgrade `llama3.2:3b` → an 8B-class model (candidates: `qwen3:8b`, `llama3.1:8b`, `gemma3` ~9B class), picked by measurement | ~1–3 s | chat, routing your commands, confirmations, shortening questions, status summaries |
| **Big brain on call** | Claude or Codex answer a hard question in read-only mode, announced first ("Let me ask Claude.") | ~5–30 s | hard questions, anything needing real reasoning or code knowledge |

**How the local model is picked:**
- Candidates run through `npm run brain-eval` (docs/BRAIN_EVAL.md), plus a new relay test set: 40 spoken commands
  such as "tell Claude to fix the widget on TamaWatch", "what's Codex doing", "stop it", "use option two".
- The winner is the one that understands commands best within a 3 s median answer time and 6 GB of RAM.
- The choice is recorded as a D-entry.

## 3. What you can say (voice grammar)

| You say | Tamago does |
|---|---|
| "Tell Claude to fix the iPhone widget on TamaWatch." | repeats it back in ≤ 12 words: "Claude, TamaWatch: fix the iPhone widget. Go?" → "Go" starts it |
| "Ask Codex why the build failed." | same, read-only |
| "What's Claude doing?" / "How's it going?" | one-sentence status from the live output: "Editing the widget view. Tests next." |
| "Use option two." / "Yes, merge it." | answers the waiting question and resumes the agent |
| "Pause it." / "Stop it." | pauses (keeps the session to resume) / stops |
| "Hand it to Codex." | handoff now (baton, §6) |
| "What's waiting for me?" | reads the inbox, newest first |

**Confirmation step:** every new task and every irreversible step (push, pull request, merge, delete, anything
leaving this Mac) needs a spoken "go". Misheard speech is the biggest risk, so Tamago always repeats back before acting.

## 4. Running the agents (adapters)

One adapter per agent. Each one:
- spawns the CLI headless;
- streams its JSON output into the task log;
- keeps the session id so the run can be resumed;
- sorts the ending into done / question / out of credits / error.

| Agent | Start | Resume | Guardrails |
|---|---|---|---|
| **Claude Code** | `claude -p "<prompt>" --output-format stream-json --verbose --append-system-prompt-file <relay rules>` in the project dir | `claude -p --resume <session> "<answer>"` | normal permission mode with an allowed-tools list; **never** `--dangerously-skip-permissions` |
| **Codex CLI** | `codex exec --json -C <project dir> -s workspace-write "<prompt>"` | `codex exec resume <session> "<answer>"` | `-s workspace-write`, or `read-only` for questions |
| **"ChatGPT classic"** | decision 1 | | |

Every task:
- runs on its own branch `tamago/<task-slug>`, in a git worktree under the project, never on `main`;
- holds a per-project lock, so only one agent writes at a time;
- has time and turn limits.

Projects are an **allowlist** (`$TAMAGO_STATE_DIR/projects.json`: name, path, default agent, the spoken names
it answers to). The agents get no secrets they weren't given for the task.

## 5. Questions back to you (short on purpose)

- **How an agent asks.** The relay rules (appended system prompt) tell every agent: when you need the owner, stop and end your
  reply with one line:
  `ASK_OWNER: <question, ≤ 15 words> | <option A> | <option B> | <option C>`.
- **What the relay does with it.**
  - It detects the line and stores the question.
  - It uses the local brain to trim anything longer to ≤ 15 spoken words and ≤ 3 options.
  - The agent's session is kept for resuming.
- **How you hear it.**
  - Tamago speaks it the next time you raise the Watch and open Tamago, with a notification haptic.
  - The dashboard shows the full version.
- **How your answer gets back.** You answer by voice. The relay resumes that agent's session with the answer plus
  the full question it came from.
- **Agents with nothing to ask** just keep working. Tamago never reads you raw logs.

**Why not live tool calls:** a blocking "ask" tool breaks when you take an hour to answer. End-and-resume works the
same for Claude and Codex, survives Mac restarts and uses no credits while waiting.

**Getting questions to the Watch:**
- **R3:** the Watch checks `GET /v1/inbox` whenever Tamago opens. This is an additive Protocol V1 §17, like
  §15/§16; it needs your OK.
- **R5:** a complication badge.
- **Later:** real push notifications. They need APNs set up in the developer account and an entitlement in the
  app (decision 4).

## 6. Out of credits → the baton

**Detecting it.** Each adapter sorts every ending (exit code, error text, final JSON) into one of:
`done`, `question`, `usage_limit` (with the reset time when the message gives one), `auth`, `network`, `crash`.

- The exact usage-limit messages of Claude Code and Codex are **captured on this Mac in R0**, not guessed. The
  patterns live in a config file.
- Any unrecognised failure shows on the dashboard, so a new pattern can be added.

The relay remembers "Claude unavailable until 3:00 PM" and doesn't send it new work before then.

**Asking to transfer:** "Claude ran out until 3 PM. Hand TamaWatch widget to Codex?"
- "Yes" transfers the task.
- "Wait" parks it and resumes Claude at the reset time.
- Automatic transfer is off by default (decision 2).

**The baton** is a single Markdown file per handoff, built mostly **deterministically**, so it's exact and
cheap. The **incoming agent**, the strongest model in the chain, does the reading and judging itself.

```
# Baton: <task> (handoff 2 of this task) — from Claude Code to Codex, 2026-09-27 15:02
## The task         owner's words verbatim + the confirmed goal + "done when"
## Owner's answers  every question and answer so far
## Where things are repo, branch, base commit; commits made (git log base..HEAD); uncommitted diff stat;
                    last test command and its result
## What the last agent was doing   its last plan/todo list, its last 3 messages, its last 10 tool actions,
                    the last error; why it stopped (usage limit, reset 3 PM)
## Your first steps read AGENTS.md; check the state above (git status, run the tests) before trusting it;
                    don't redo finished items; continue from the first unfinished one; worklog entry at the end
## Full record      paths to the complete raw logs, if you need more
```

The baton is capped at about 8k tokens. The full raw logs stay on Storage for the incoming agent to open if needed.
This matches the repo's own handoff habit (AGENT_WORKLOG / HANDOFF_LOG) and makes them automatic.

**Adopting a session the relay didn't start**, such as an interactive session like this one: later (R4+). The
relay reads that agent's session file (Claude Code keeps them in `~/.claude/projects/`, Codex in
`~/.codex/sessions/`) plus the git state to build the same baton. The format is verified in R0.

## 7. Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| **R0** | Spike + decisions (1 session) | Claude and Codex run headless on a scratch repo, from the gateway: streaming output, session ids, resume, a real usage-limit message captured (or the documented one), timings. Check whether the installed **OpenClaw** already does part of this (reuse policy, `docs/UPSTREAM_REUSE.md`). | a short spike report with real outputs; section 9 answered |
| **R1** | Stronger local brain | 3 candidate models measured, winner chosen (D-entry); relay intents in the router with the 40-command test set | ≥ 38/40 commands routed right; median ≤ 3 s |
| **R2** | Relay core | projects allowlist, tasks/runs in the brain database, Claude + Codex adapters, worktree per task, lock, limits; **Tasks** panel on the dashboard; driven from the dashboard box first | a real small task done end-to-end by each agent from a typed command |
| **R3** | Questions | `ASK_OWNER` rule, question trimming, answer → resume; Protocol V1 §17 `GET /v1/inbox`; the Watch speaks waiting questions on open | ask → spoken on the Watch → voice answer → agent continues |
| **R4** | Credits + baton | failure sorting, availability table, baton builder, transfer prompt, park-and-resume at reset | a forced "out of credits" (fake adapter) hands a half-done task to the other agent, which finishes it without redoing work |
| **R5** | Watch polish | status on open, complication badge for waiting questions, haptics; push notifications if decision 4 says so | owner can run a task a whole day from the Watch |
| **R6** | Always on | launchd agents for the gateway and Ollama, started after `/Volumes/Storage` mounts | survives a restart with no terminal |

Each phase:
- is unit-tested with fake agents (no credits spent);
- then gets one real run;
- is shown on the dashboard;
- has worklog + handoff entries.

## 8. Safety rules (binding for the relay)

- **Scope.** Only allowlisted projects; only the task's own branch/worktree; never `main`.
- **Spoken "go".** Needed for push, pull requests, merges, deleting files outside the task, anything using the
  App Store Connect key, and anything sent off this Mac.
- **Agent permissions.** Agents keep their normal permission systems (no skip-permissions flags). Codex runs
  sandboxed (`workspace-write` / `read-only`).
- **Where things run.** The gateway stays on the home LAN. The dashboard stays loopback-only. No agent output
  is sent anywhere but the owner's Watch and screen.
- **What's stored.** Agent transcripts and batons are stored on `/Volumes/Storage` (AGENTS.md §9), never in a
  repo. Words spoken to Tamago follow the existing privacy rules.
- **Budgets.** Per-task time and turn limits. The dashboard shows what each run used.

## 9. Owner decisions needed before R0

1. **"ChatGPT classic".** There is no ChatGPT command-line tool.
   - (a) *Recommended:* use Codex CLI in read-only "just answer" mode. Same ChatGPT account, no extra cost.
   - (b) An OpenAI API key, billed per use separately from your subscription.
2. **When an agent runs out of credits.** Ask every time (*recommended*) or transfer automatically.
3. **Projects the relay may touch.** Start with TamaWatch only (*recommended*), or a list.
4. **Push notifications for questions.** Later, after R3 works with "on open" (*recommended*), or now. Now means an APNs key and an
   app entitlement change.
5. **Protocol V1 §17 `GET /v1/inbox`.** Additive, the same kind as §15/§16; older Watch builds ignore it. Needs your OK.
