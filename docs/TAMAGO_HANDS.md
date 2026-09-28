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
