# Relay plan: talk to Tamago, and it runs Claude, Codex or ChatGPT on your projects

**Status:** R0 and R2 built. Parts of R3 and R4 were built without push on 2026-10-01; see §11. The rest of this
plan is still the plan. The owner answered
section 9 on 2026-09-27. Phases R0–R6 run in order, and every phase ends
with tests and a worklog entry.

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
- **The live dashboard (D-123) becomes mission control.** It shows tasks, which agent holds each one, the agent's
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
| **"ChatGPT chat"** (decision 1) | `codex exec --json -s read-only "<baton + question>"`: answers only, never edits | `codex exec resume` | read-only sandbox |

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
**R3 does both (owner approved, decisions 4–5):**
- **Protocol V1 §17 `GET /v1/inbox`:** the Watch checks it whenever Tamago opens.
- **Push notifications** with the question itself, so you don't have to open Tamago to know one is waiting:
  - The Mac sends them straight to Apple's push service (HTTP/2 and a signed token, zero dependencies).
  - Tapping one opens Tamago, which speaks the question.
  - They need an **APNs key** (the owner creates it at developer.apple.com → Keys, same place as before; stored in
    `/Volumes/Storage/AI/secrets/`).
  - They need the **Push Notifications capability** on the Watch app: an entitlement plus a project change, which
    the owner authorized with this decision.

**R5** adds a complication badge.

## 6. Out of credits → the baton

**Detecting it.** Each adapter sorts every ending (exit code, error text, final JSON) into one of:
`done`, `question`, `usage_limit` (with the reset time when the message gives one), `auth`, `network`, `crash`.

- The exact usage-limit messages of Claude Code and Codex are **captured on this Mac in R0**, not guessed. The
  patterns live in a config file.
- Any unrecognised failure shows on the dashboard, so a new pattern can be added.

The relay remembers "Claude unavailable until 3:00 PM" and doesn't send it new work before then.

**Proactive trigger (R0 spike, docs/relay/R0_SPIKE.md):** both agents report their usage while they work.
- Claude sends `rate_limit_event` (five-hour and weekly utilization, reset times).
- Codex's session file has `rate_limits` (`used_percent`, `resets_at`).
- The relay hands off **before** an agent runs dry, at ≥ 95 % or when an agent says it is limited. The failure
  sorting above is the backstop.

**Transfer is automatic (owner's decision 2).** Tamago tells you afterwards:
"Claude ran out until 3 PM. Codex has the widget task now."

**The chain:**
1. The agent you asked.
2. The other coding agent (Claude ⇄ Codex).
3. **ChatGPT chat** (decision 1). It shares Codex's allowance, so it's skipped when Codex is out (§6b).
   - It can't edit the project, so it gets the baton to think with: finish the plan, answer the open question,
     write the next steps.
   - Its answer is saved to the task and read to you in short.
   - When a coding agent's credits come back, the task resumes there with ChatGPT's notes added to the baton.
4. **Last, always there: Tamago's own brain** (§6b). It keeps the baton, answers "where are we?", and restarts the
   task when an agent's credits return.

**Supervision: the relay keeps an eye on whoever holds the task.**
- **What it watches for:**
  - no new output or commit for 10 minutes;
  - the same error 3 times;
  - tests that were passing and now fail;
  - edits outside the task's branch.
- **What it does:** it pauses and tells you in one sentence, or hands on if the agent died.
- **When an agent dies mid-run,** the relay first collects everything it can: its full output so far, the git
  state, its last plan. Then it builds the baton, so nothing is lost at any step of the chain.

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

## 6b. Who goes first: the order of the AIs (owner, 2026-09-27)

| Kind of task | 1st | 2nd | 3rd | Last (always there) |
|---|---|---|---|---|
| **Change the project** ("fix", "add", "rename", "update") | **Claude Code**: strongest at long coding work here, reads CLAUDE.md, reports its usage live | **Codex**: same repo, reads AGENTS.md; the relay commits for it | **ChatGPT chat** (Codex answer mode): can't edit; turns the baton into a plan and next steps | **Tamago's own brain** (Gemma / Qwen on this Mac): keeps the baton, tells you where things stand, restarts the task when an agent's credits come back |
| **Just a question** ("ask … why", "explain", "check") | **ChatGPT chat**: fastest (about 7 s), read-only | **Claude** read-only | **Codex** read-only | **Tamago's own brain**: answers what it can, says honestly what it can't |

**Rules for the order:**
- **If you name an agent,** it goes first, then the rest in the order above.
- **An agent is skipped** when its own usage report says ≥ 95 % used, or when it's marked out until a reset time.
- **ChatGPT chat shares Codex's allowance.** It runs through Codex, so when Codex is out, ChatGPT chat is out too.
  That's why the last stop is Tamago's own brain, which never runs out.
- **When everyone is out:**
  - Tamago says so in one sentence, with the earliest reset time: "Everyone's out. Claude's back at 10."
  - It parks the task and restarts it then, with the baton.
- **Every handoff is announced afterwards** (automatic transfer, decision 2). The dashboard shows the whole chain
  for each task.

## 7. Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| **R0** ✅ | Spike + decisions (done 2026-09-27, `docs/relay/R0_SPIKE.md`) | Claude and Codex run headless on a scratch repo, from the gateway: streaming output, session ids, resume, a real usage-limit message captured (or the documented one), timings. Check whether the installed **OpenClaw** already does part of this (reuse policy, `docs/UPSTREAM_REUSE.md`). | a short spike report with real outputs; section 9 answered |
| **R1** | Stronger local brain | 3 candidate models measured, winner chosen (D-entry); relay intents in the router with the 40-command test set | ≥ 38/40 commands routed right; median ≤ 3 s |
| **R2** ✅ | Relay core (built 2026-09-28, D-129) | projects allowlist, tasks/runs in the brain database, Claude + Codex adapters, worktree per task, lock, limits; **Tasks** panel on the dashboard; driven from the dashboard box first | a real small task done end-to-end by each agent from a typed command |
| **R3** | Questions | `ASK_OWNER` rule, question trimming, answer → resume; Protocol V1 §17 `GET /v1/inbox`; push notifications (APNs key + Watch entitlement); the Watch speaks waiting questions on open or from the notification | ask → push on the Watch → voice answer → agent continues |
| **R4** | Credits, baton, chain | failure sorting, availability table, baton builder, automatic transfer down the chain (Claude ⇄ Codex → ChatGPT chat), supervision watchdog, resume when credits return | a forced "out of credits" (fake adapters) walks a half-done task down the whole chain with nothing lost, and it comes back to a coding agent afterwards |
| **R5** | Watch polish | status on open, complication badge for waiting questions, haptics | owner can run a task a whole day from the Watch |
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

## 9. Owner decisions (answered 2026-09-27)

1. **ChatGPT: the safe route (owner, 2026-09-27).** "ChatGPT chat" is Codex CLI in read-only "just answer" mode:
   same ChatGPT account and models, no extra cost, within OpenAI's terms. The app-typing route was considered and
   declined: OpenAI's terms forbid automated extraction of output from ChatGPT.
2. **Out of credits: transfer automatically,** watch the next agent, and end the chain at ChatGPT chat with
   everything collected (§6).
3. **Projects:** the relay may change only folders on an allowlist. It starts with TamaWatch. Others are added
   by name when the owner asks ("add my Jellyfin project").
4. **Push notifications: now,** in R3.
5. **Protocol V1 §17 `GET /v1/inbox`: approved** ("Inbox and push now").

## 10. R2 verification record (2026-09-28, LOCAL_VERIFIED, the owner away)

Through the real gateway (`/v1/request`, as the phone sends it), Gemma 4 12B, real Claude Code runs, on a throwaway
`Sandbox` repo with two deliberately failing tests.

| Said | Tamago | What happened |
|---|---|---|
| "tell Claude to fix the failing tests in the Sandbox project" | "Claude, Sandbox: fix the failing tests. Say yes to go." | nothing ran yet |
| "yes" | "Claude is on it, on its own branch of Sandbox." | worktree `tamago/fix-the-failing-tests-he6c`; Claude fixed `add` and `greet`, committed, `DONE:` |
| "what's Claude doing?" | "Claude finished fixing bugs in calc.py and greet." | status from the task record |
| "hey are you able to speak to claude for me?" | "Yes, I can reach Claude with 63% of its five-hour window and 17% of its weekly usage left." | usage from Claude's own `rate_limit_event` |
| "tell Claude to rename the greet function in Sandbox, but I must choose the new name" → "yes" | Claude asked: "What should I rename greet() to?" | `ASK_OWNER` recorded; the task waits |
| "call it say_hello" | "Told Claude: call it say hello." (0.1 s, rule) | same session resumed; `greet` → `say_hello` in code and test, committed |
| "is Claude done?" | "Claude has finished both tasks." | |

`main` of the sandbox is untouched; both branches carry the agents' commits.

**Bugs found live and fixed:**
- A 20 s timeout on the first request after a restart: warm-up plus a 45 s limit.
- "Go? Say yes to go." (a doubled question) and a double period.
- `helpers_usage` not called for "can you talk to Claude": a prompt line.
- **The owner's answer went to plain conversation**, which claimed to have passed it on: the answer is now passed on
  by rule.
- A 30-minute answer window was too short: now 12 h.

## 11. Fidelity fixes after the live test (2026-10-01, UNIT_TESTED_ONLY)

The live test ([relay/LIVE_TEST_2026-10-01.md](relay/LIVE_TEST_2026-10-01.md)) showed the plumbing worked but the
information reaching the owner didn't. These fixes are in `Gateway/src/relay/relay.js`, `src/hands/{agent,tools}.js`
and `src/brain/orchestrator.js`. The per-finding table is in that report. Hands-side details:
[TAMAGO_HANDS.md](TAMAGO_HANDS.md) §7.

**What the relay now records per task:**
- `state`: running, question, done, **unclear**, failed, limited, stopped, **interrupted**. Tasks also get
  `handedTo` / `handoffFrom`.
- What the agent said: `result` (clean gist), `answer` (full final message, up to 2,000 characters), `run` (the
  `RUN:` line, never executed).
- Where the work is: `base` / `baseSha`, `commits`, `committed` / `uncommitted` / `removed`.
- `resetsAt` / `resetText` when it hit a limit.
- `announced`: whether Tamago has told the owner about the ending yet; `heardAt` for a waiting question (when the
  owner last heard it); `owner`, the pid of the process running it.

**R3 parts covered without push:**
- `ASK_OWNER` is read anywhere in the final message, markdown-tolerant. The answer resumes the same session with the
  question attached.
- The owner hears waiting questions, and every other ending, on their **next interaction** with Tamago. This is the
  news mechanism, a deterministic rule. Status lists waiting questions first, at any age.
- Answers are matched to the right helper (named, option match, or "For Claude or Codex?").
- **Not built:**
  - `GET /v1/inbox` (Protocol V1 §17 is a wire change, so the Watch would need it too);
  - APNs push and the Watch entitlement;
  - trimming questions with the local model (long questions are cut at a word; the options go on screen).

  Without these, Tamago can't reach the owner until the owner talks to it.

**R4 parts covered:**
- **Failure sorting:** done / question / limited (with reset time) / failed / unclear / interrupted.
- **A deterministic baton:** the owner's words verbatim, who had the task and why it stopped, the commits so far
  (uncommitted work committed as WIP first), the open question, and "check before trusting".
- **Handoff:** `relay_handoff`, on the same branch and worktree, after a spoken yes.
- **Claude out → Codex:** new coding work goes to Codex while Claude reports `rejected` or 100 % or more with a reset
  ahead.
- **Not built:** automatic transfer without a yes (owner decision 2), the whole chain down to ChatGPT, the supervision
  watchdog, and resuming when credits return.

**Hygiene:**
- Worktrees branch from the project's base: `main` when it exists, else HEAD, or `base` in `projects.json`. They
  start from main and never commit on it (§4).
- Every ending commits leftovers on the task branch.
- Empty worktrees and branches of failed runs are removed. That's the only branch deletion the relay does, and only
  for branches it made itself with zero commits counted from a known base (old tasks without `baseSha` use the
  merge-base with the project's base branch, or are never removed), with nothing just committed and a clean
  worktree after the commit attempt (review SM1, SM2, G3).
- Tasks still `running` when the **gateway** starts become `interrupted`, unless their owning process is still
  alive. The CLI and evals never do this (review SM7).
- A handoff stops the old helper and waits for it to exit (SIGKILL after 5 s) before committing its leftovers and
  starting the next one in the same worktree (review SM6).
- Codex is told not to commit; the relay does it, and the commit message is the task text plus the cleaned summary.
- A Codex resume keeps its sandbox flag. **UNVERIFIED** against the real CLI; check it on the first real resume.

