# Tamago's hands: controlling the Mac by voice

**Status:** stage 1 built 2026-09-28 (Claude Code on the owner's Mac): tool loop, 15 tools, spoken confirmation,
audit log. Stages 2–3 are planned. Decision: D-128. Related: [TAMAGO_SELF.md](TAMAGO_SELF.md) (what Tamago knows
about itself), [RELAY_PLAN.md](RELAY_PLAN.md) (Claude/Codex doing real work).

**Owner, 2026-09-28:**
- "help me make tamago able to fully control my pc as it is my local ai model, does it have to be agentic?"
- "go and document well as you go".

## 1. Yes, it's agentic, in three tiers

Talking needs no tools. Doing things needs **tools** plus a **loop**: the model picks a tool, the gateway runs
it, the model sees the result, then it answers or picks the next tool. Gemma 4 12B and Qwen 3.5 9B (D-125) both
support tool calling through Ollama's `/api/chat` `tools` field, so the brain stays the same model.

| Tier | Example | Who does it | Status |
|---|---|---|---|
| **1. Direct actions** | "open Steam", "volume to 30", "what's using my memory?", "lock the screen" | Tamago's local model, choosing from a fixed list of tools | **built (stage 1)** |
| **2. Your routines** | "run movie night", "clean my downloads" | Tamago runs the owner's macOS Shortcuts by name (`list_shortcuts` / `run_shortcut`) | built as two tools; a spoken "go" is needed |
| **3. Real work** | "fix the widget on TamaWatch", anything multi-step | handed to Claude Code / Codex (relay R2), which have their own tools and permissions | planned (RELAY_PLAN.md) |

Why not "the local model drives the mouse and keyboard"? A 9–12B model is reliable on clear single steps and
unreliable on long open-ended ones. Screen-driving would be slow and error-prone at this size. Tier 3 lends
Tamago Claude's hands for that. On a 32–48 GB Mac, a 27–31B local model could take more of tier 3 itself (see
the model table in the owner conversation, 2026-09-28).

## 2. How a command flows

```
"Tamago, open Steam"  →  gateway  →  intent router: kind "hands" (an imperative about the Mac)
                                   →  hands agent (src/hands/agent.js)
                                        Ollama /api/chat with tools, think:false, ≤ 4 steps
                                        ├─ safe tool      → runs now (src/hands/tools.js), result back to the model
                                        └─ confirm tool   → NOT run: Tamago asks "Quit Safari? Say yes to go."
                                   →  reply in Tamago's voice (Watch: ≤ 2 sentences; phone: full)
"yes"                              →  the pending action runs (rule, no model), "Done. Safari's closed."
"no" / anything else / 60 s       →  cancelled, nothing happens
```

Every tool call is written to the audit log `$TAMAGO_STATE_DIR/logs/hands.log`: time, tool, arguments, outcome.
It's on the Storage disk, owner-only.

## 3. The tools (stage 1)

Every tool is a fixed program with checked arguments, run with `execFile` (never a shell). Nothing takes
free-form commands.

| Tool | What it does | Risk |
|---|---|---|
| `open_app(name)` | opens an installed app (must exist in /Applications, /System/Applications or ~/Applications) | safe |
| `quit_app(name)` | asks a running app to quit (like ⌘Q; the app can still ask to save) | **confirm** |
| `running_apps()` | lists open apps | safe |
| `set_volume(percent)` / `change_volume(step)` / `mute(on)` | output volume | safe |
| `lock_screen()` | turns the displays off (`pmset displaysleepnow`); locked if the Mac asks for a password on wake | safe |
| `system_status()` | memory used, top memory apps, CPU load, disk free on the internal disk and Storage, uptime | safe |
| `battery_and_power()` | power source and, on a laptop, battery | safe |
| `find_files(query)` | Spotlight search limited to the home folder and /Volumes/Storage, top 10 names | safe (read-only) |
| `open_url(url)` | opens an http(s) link in the default browser | safe |
| `open_folder(place)` | opens Downloads, Desktop, Documents, Games, Projects… in Finder | safe |
| `start_game_mode()` | summons Console Mode (Big Picture) | safe |
| `list_shortcuts()` | the owner's macOS Shortcuts | safe |
| `run_shortcut(name)` | runs one of them | **confirm** |

Not in stage 1: **media keys** (play/pause). Scripting Music or Spotify makes macOS show a one-time Automation
permission dialog, which would block while the owner is away. Add it when they're at the Mac to click Allow.
`quit_app` sends the standard Quit event, which macOS allows without that dialog.

**Never, whatever is asked** (not tools at all): delete or empty the Trash, `sudo` / admin password, payments,
passwords, security or privacy settings, sending messages or email, installing software, anything touching
another computer. Asked for these, Tamago says it can't, and why, in one sentence.

## 4. Safety rules (binding)

1. **Allowlist only.** The model can call only the tools above. Arguments are validated before anything runs.
   Unknown tools or bad arguments are refused and reported back to the model.
2. **Spoken confirmation** for anything that can lose work or run the owner's own automations (`confirm` tools).
   Tamago says exactly what it will do, and only a clear "yes / go / do it" runs it, within 60 s.
3. **At most 4 tool steps per request, 10 s per tool.** No background jobs, nothing left running.
4. **Kill switch:**
   - "Tamago, stop" / "cancel" drops any pending action.
   - `TAMAGO_HANDS=off` turns the hands off entirely (the brain then answers "I can't do that yet", as before).
5. **Audit log** of every call and outcome (§2).
6. **Who can command it:** the paired Watch and phone, and the Mac-only dashboard, the same as for talking
   (bearer token over the home LAN, D-116). Nothing here is reachable from the internet.
7. **Privacy:** tool results stay on the Mac. File names from `find_files` go to the local model only.

## 5. Build log

- **Stage 1 (2026-09-28):**
  - `src/hands/tools.js` (registry and validation), `src/hands/agent.js` (Ollama tool loop, pending
    confirmation), router kind `hands`, orchestrator hook, audit log, `TAMAGO_HANDS`.
  - Tests: `test/hands.test.js`, with a stubbed model and a stubbed exec; nothing runs on the Mac in tests.
  - Live check on the owner's Mac with Gemma: see §6.
- **Stage 2 (next):** a dashboard panel with every action and the pending confirmation; per-Shortcut "always
  allowed" list; hands in the 40-command eval set.
- **Stage 3:** relay R2 (Claude/Codex) for real work.

## 6. Verification record

Filled in as it's verified, with labels from AGENTS.md.

**2026-09-28, LOCAL_VERIFIED** (the owner's Mac, Gemma 4 12B, through the real gateway `/v1/request`; the owner away).

| Said | Tamago | Time |
|---|---|---|
| "what apps are open?" | "Claude, Console Mode, Google Chrome, Jellyfin, Siri AI, and Terminal are open. That's quite a busy workspace." | 5.8 s |
| "open calculator" | "Calculator is open. I'm ready to crunch some numbers." (it opened) | 3.8 s |
| "how much space is left?" | "You have 384 GB of storage free. The internal disk has 14 GB left." | 4.0 s |
| "close calculator" | "Quit Calculator? Say yes to go." (nothing ran yet) | 2.1 s |
| "yes" | "Calculator is closing." (it closed; rule, no model) | 0.3 s |
| "delete my downloads folder" | "I can't do that yet." (rule; no tool exists) | 0.0 s |
| "empty the trash" | "I cannot do that yet. I do not have permission to touch the trash." | 6.6 s |
| "how are you?" | normal conversation (not the hands) | 4.6 s |

- The first request after a restart took 14.9 s while the model loaded.
- **Fixed during the check:**
  - `running_apps` listed system processes (Dock, loginwindow, Siri…). It now lists only apps in the app folders.
  - Replies were too poetic for actions ("The numbers are waiting for you now"). The prompt now asks for the plain
    fact first.
- **Known:** `system_status`'s "biggest memory users" reads resident memory, which undercounts compressed apps; the
  total used is right.

## 7. Helpers: what passes between the owner and Claude/Codex/ChatGPT (2026-10-01)

These changes followed the relay live test ([relay/LIVE_TEST_2026-10-01.md](relay/LIVE_TEST_2026-10-01.md),
findings K1–K8, N1–N10, F1–F23). Label: **UNIT_TESTED_ONLY** (`test/relay-fidelity.test.js`).

**Rule first, model second.** When the words are clear, the hands handle helper talk without the model, and the
reply is the relay tools' own words:

| The owner says | Handled by | Tamago |
|---|---|---|
| a reply while a helper waits ("Build here", "Do it with curses", "tell Codex use curses") | rule → `relay.answer` | "Told Codex: Build here." It's forwarded only if it's plausibly the answer (§7.1). |
| "How are the helpers doing?", "Is Claude done?", "Did Codex build the game yet?" | rule → `relay_status` | every waiting or running task with its age, then recent finished ones |
| "What did ChatGPT say about…?", "What did Codex build?" | rule → `relay_result` | gist spoken; the helper's full answer lands on the phone (long answer, no model) |
| "Give it to Codex instead" | rule → `relay_handoff` (confirm) | "Give Claude's task "…" to Codex? Say yes to go." |
| "Stop Claude" | rule → `relay_stop {agent}` (confirm) | "Stop Claude's task "…"? Say yes to go." |
| new work ("build me…", "ask ChatGPT why…") | model → `relay_start` (confirm) | "Claude, Sandbox: … Say yes to go." (the owner's words, one clause) |

**Tools added or changed:** `relay_result {agent?}`, `relay_handoff {agent}`, `relay_status {agent?, include_older?}`,
`relay_stop {agent?}`, `relay_answer {answer, agent?}`. Parameters marked `optional` aren't `required` in the Ollama
schema. Tool results can carry `screen` (fuller text for the screen and phone, never spoken) and `detail` (a long
answer, delivered through the existing D-127 path: the orchestrator stores it, and `detail()` returns it).

**Truthful start (K2).** After "yes", `relay_start` waits up to 5 s for an early ending, so the "yes" reply can take
up to 5 s longer. If the run is already limited or failed, Tamago says so, with the reason and reset time, and offers
the other coding helper. The next "yes" hands the task over.

**News (K2/N1, R3 without push).** Each ending is stored unannounced. On the owner's next interaction of any kind,
the orchestrator tells it first: "Codex has a question: …", "Codex finished: …", "Claude ran out of usage on … until
Fri 12:00 PM.". It's spoken only while it fits the 140-character speech limit, and the fuller text goes on screen.
A confirmation waiting for "yes" is never pushed aside; the news waits a turn. Status and result mark what they
reported as told. After the review of these fixes (same day, ids SM/R/G in the live-test report):
- a reply waiting for "yes" never carries a helper's **question** (the owner's yes would go to the wrong one; SM8,
  G10), and a reply that has a long answer for the phone carries no news (R6);
- news never replaces the reply: when the whole line doesn't fit, a short form naming the task is spoken with the
  reply's first sentence, or the news waits a turn (R7);
- a question is spoken as the question, cut at a word, with the options on screen (R8);
- a ChatGPT answer told as news goes to the phone as a long answer, like "what did ChatGPT say?" (R5).

### 7.1 Answers to a waiting helper (F1–F5, F10)

- **Never forwarded:**
  - forbidden, forget, off-the-record, private, thanks and greeting utterances;
  - stop and handoff phrasings ("Stop Codex", "Cancel the task", "Give it to Claude instead"): the stop/handoff
    rule handles them, unless the reply is exactly one of the options (SM3, R2, G1);
  - Mac commands of any wording ("open Safari", "Volume 30", "Game mode on"), unless they name the waiting helper;
  - new work: "tell Claude to make a snake game", "build me…", "a new app…" (G2);
  - status or result questions;
  - questions: ending in "?" or opening with a wh-word, is/are/can/could/did/does, "do you", "will you" (G2).
- **Forwarded:**
  - statements and affirmations, including "Do it with curses", "Have it start small" and build words about the
    work at hand ("Build the game here");
  - option matches, as whole words; a short option ("Yes", "No", "Go") only at the start of the reply (SM4);
  - addressed replies ("Codex: …", "tell Codex …").
- **A question the owner hasn't heard yet** takes only an option or an addressed reply. Anything else is
  conversation, and the question is told as news on that same turn.
- **A heard question takes unaddressed replies for 12 h after the owner last heard it** (news or status record
  `heardAt`). After that only options and addressed replies reach it (G2: a 3-day-old question captured "Volume
  30"). It stays listed in status, at any age.
- **Several questions waiting**, even from one helper: the reply goes to the helper it names (if only one of its
  tasks waits) or whose option it matches. Otherwise Tamago asks "For Claude or Codex?", or by task when one helper
  has several ("For Claude's "snake game" or Claude's "widget"?"), and holds the reply for 60 s (SM9).
- **A pending confirmation** is answered only by a short, plain "no". "No, build here" goes to the helper, but only
  as an option or addressed reply, and a reply naming a helper that isn't waiting never goes to another one (G6).

### 7.2 Routing and guardrails (K5, F7, F19, F22, N2, N3)

- **"helpers" routes to the hands.**
- **The safety net** (the model only *offered* a helper) proposes a task only when:
  - the owner's words open like a request ("build…", "can you…", "tell Claude to…", "I want…"), not a plain
    statement (G9);
  - they aren't about work already done or a wish to see it ("Give me the game Codex made", "I want to see the
    game"; G9);
  - the model's reply contains a real offer phrase.
- **Build work never goes to ChatGPT**, but asking ChatGPT *how* to build something stays a read-only ChatGPT
  question (G5).
- **Helper output is never data for the model** (G7): `relay_status` gives it Tamago's own words and task ids only,
  and any action tool the model calls after a relay read in the same turn waits for a yes.
- **When Claude's own report says it's out** (`rejected`, or 100 % or more with a future reset), new coding work goes
  to Codex and Tamago says why. The prompt also says never to call `helpers_usage` before giving work.
- **Building software doesn't trip the send/pay/install guardrails** when the send/pay/install is inside what is
  built ("a script that sends an email", "an email feature"). In a clause of its own ("…and email my boss", "Email
  my boss that I will fix the bug") it stays forbidden (G4).
- **Handoffs carry the confirmed task's id** (SM5): "yes" hands over the task the confirmation named, or says it
  ended meanwhile. "Give it to X" picks a task that ended unfinished before a running one, never X's own.

### 7.3 Speech (K1, K8, F23, N8)

- **The composer protects a trailing "Say yes to go."** and the sentence before it, which says what "yes" does;
  earlier sentences are dropped first (R3).
- **Sentences split only at . ! ? followed by a space** (`src/brain/speech/text.js`).
- **A one-line reply keeps its leading number.**
- **Underscores stay on screen** and are spoken as spaces.
- **The hands prompt forbids inventing next steps.** After a status or result read, the tool's words are used as
  they are.

