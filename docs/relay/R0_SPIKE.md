# Relay R0 spike: real headless runs on the owner's Mac (2026-09-27)

Claude Code, owner's Mac. Throwaway repo in `/Volumes/Storage/AI/relay-spike/scratch`: a Python `add()` that
subtracts, plus a test. Raw outputs are in `/Volumes/Storage/AI/relay-spike/out/`, not in this repo.
Every agent was launched with a clean environment (`env -i HOME USER PATH TERM`) and `stdin` from `/dev/null`,
as the gateway will launch them. Verification label: **LOCAL_VERIFIED** (this Mac, real subscriptions).

## Claude Code 2.1.283

- **Start:**
  ```
  claude -p "<task>" --output-format stream-json --verbose --append-system-prompt-file relay-rules.md
    --permission-mode acceptEdits --allowedTools "Bash(python3 *)" "Bash(git add *)" "Bash(git commit *)" …
  ```
  Default model: `claude-sonnet-5`.
- **Fix task:** fixed, tested and committed on the branch, then ended with the agreed line `DONE: …`.
  18 s wall, 7 turns, reported cost $0.11 (subscription, not billed).
- **Stream:** one JSON object per line.
  - `system/init` carries `session_id` and `model`.
  - `assistant` messages carry text and `tool_use` blocks.
  - The final `result` carries `subtype`, `is_error`, `num_turns`, `duration_ms`, `total_cost_usd`, `session_id`
    and `result` (the final text).
- **Credits, reported proactively.** `rate_limit_event` carries `rate_limit_info`: `status` (`allowed_warning`
  seen), `rateLimitType`, `utilization`, `resetsAt`, and `unifiedWindows.five_hour` / `seven_day`, each with
  `utilization` and `resetsAt`.
  - Seen: five-hour 0.65 (reset 10:00), weekly 0.58.
  - The relay can hand off **before** an agent runs dry.
- **Questions.** Told the owner must choose, it replied in one turn, ending exactly
  `ASK_OWNER: What should calc.py be renamed to? | e.g. arithmetic.py | e.g. math_ops.py`.
  - When the answer didn't change the code, it reasonably went ahead without asking.
  - The relay rules must say when asking is required.
- **Resume.** `claude -p --resume <session_id> "Owner answered by voice: floats too."` kept the same session and
  context: 1 turn, then `DONE: …`.

## Codex CLI 0.157.1

- **Start:** `codex exec --json -C <repo> -s workspace-write "<rules + task>"`. The rules go in the prompt; there's
  no system-prompt flag.
- **Fix task:** fixed and tested (33 s), but **could not commit**: in `workspace-write` the sandbox makes `.git`
  read-only.
  - It correctly asked in the agreed format (`ASK_OWNER: Can you enable repository write …`).
  - **Decision for R2:** the relay commits Codex's work itself, after the run, on the task branch, with Codex's
    `DONE:` text as the message. This is safer than widening the sandbox.
- **Stream:** `thread.started` (`thread_id` = the session id for `codex exec resume`), then `item.started` /
  `item.completed` (`agent_message`, `command_execution`, `file_change`), then `turn.completed` with token usage,
  or `turn.failed` / `error`. It prints "Reading additional input from stdin..." to stderr, which is harmless.
- **Credits** are not in the JSON stream. The session file
  (`~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread_id>.jsonl`) has `rate_limits`: `primary` (five-hour window)
  and `secondary` (weekly), each with `used_percent`, `window_minutes` and `resets_at`, plus `credits`.
  - Seen: **primary 97 % used** (resets 13:49), weekly 37 %.
  - The relay reads the newest one after each run.
- **ChatGPT safe route (decision 1)** works: `codex exec --json --skip-git-repo-check -s read-only "<question>"`
  gave a plain two-sentence answer in 7.3 s.

## Not captured

- **The actual "usage limit reached" failure of either agent.** Neither ran dry, and spending the owner's credits
  to force it was not worth it.
  - The proactive usage numbers above cover the handoff trigger, e.g. hand off at ≥ 95 % or when an agent reports
    it is limited.
  - The reactive failure will be captured the first time it happens naturally: R2 logs any unrecognized ending
    on the dashboard.

## OpenClaw 2026.9.5 (installed and running here)

- **What it is:** a multi-channel chat assistant platform (chat channels, agents, approvals, cron, its own browser,
  an ACP bridge, `attach` for Claude Code).
- **Overlap:** it overlaps with the relay only loosely.
- **Why not build on it:**
  - It would put a large third-party gateway on the Watch's critical path.
  - It would break the gateway's zero-dependency rule.
  - Tamago's Watch protocol, brain and privacy rules are custom.
- **Recommendation:** build the small relay in the gateway as planned. Revisit later only if the owner wants
  Tamago reachable from chat apps too, e.g. as an OpenClaw channel.

## Changes to the plan from this spike

1. Handoff triggers become **proactive**: Claude's `rate_limit_event` and Codex's `rate_limits`, with reactive
   failure sorting as the backstop.
2. The relay commits Codex's work, since Codex's sandbox can't write `.git`.
3. The relay rules add: "Ask only when the owner's choice changes what you'd do; otherwise decide and say so in
   DONE."
