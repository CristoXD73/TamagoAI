// relay/relay.js: Tamago hands work to Claude Code, Codex or "ChatGPT chat" (docs/RELAY_PLAN.md R2, D-129).
//
// A task: the owner's words, one agent, one allowlisted project. Changing tasks run on their own branch in a git
// worktree under $TAMAGO_RELAY_DIR (never the project's checkout, never main), branched from the project's base
// ('main' when it exists, else HEAD, or `base` in projects.json; F15); question-only tasks run read-only in the
// project. The agent runs headless in the background (R0 spike: claude -p stream-json / codex exec --json), its
// full output goes to the task's log on Storage, and the last ending line in its final message decides what's next:
//   ASK_OWNER: question | option | option   → the task waits for the owner (answer() resumes the same session)
//   RUN: command                             → how the owner can run what was made (recorded, NEVER executed; K7)
//   DONE: what was done                      → finished
// Every ending commits leftover changes on the task branch (Codex's work is always committed by the relay: its
// sandbox can't), and a limited/failed/stopped run that left no commits has its worktree and empty branch removed
// (F16, N10) — only when its base is known and nothing is left uncommitted (review SM1/SM2/G3). Each newsworthy
// ending is kept unannounced until Tamago has told the owner (news(), K2/N1).
// Usage figures (Claude's rate_limit_event, Codex's session files) are kept for "how much Claude is left?".
// The relay never pushes, merges or opens pull requests, and deletes only the empty branches it made itself.

import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { gist, clause, stripMarkdown, splitSentences, endSentence } from '../brain/speech/text.js';

const BASE_RULES = `You are working for the owner through Tamago, a voice relay. The owner is not at a keyboard.
- Work only in this directory, on the current branch. Never push, merge, open pull requests or delete branches.
- Ask only when the owner's choice changes what you would do; otherwise decide and say so at the end.
- When you truly need the owner, stop and end your final reply with exactly one line:
  ASK_OWNER: <question, at most 15 words> | <option A> | <option B>`;
const FINISH = `- If what you made can be run, add a line RUN: <command> before DONE (the owner runs it; nobody else will).
- End with one line:
  DONE: <what you did, at most 20 words>`;
export const RULES = `${BASE_RULES}
- Otherwise finish and commit your work on this branch with a short message (if you changed files).
${FINISH}`;
// F17 (live test 2026-10-01): Codex was told to commit, its sandbox couldn't, and its DONE line said so.
export const CODEX_RULES = `${BASE_RULES}
- Otherwise finish. Do not commit: the relay commits your work on this branch when you end (your sandbox can't).
${FINISH}`;
// K4/N5: ChatGPT got no contract, so only its last line (cut at 200 characters, markdown left in) was kept.
export const ANSWER_RULES = `You are answering the owner through Tamago, a voice relay. The owner reads your full answer on the phone.
- Answer fully in plain text, at most 200 words. Change no files.
- When you truly need the owner, end with exactly one line: ASK_OWNER: <question> | <option A> | <option B>
- Otherwise end with one line: DONE: <the answer in one sentence, at most 25 words>`;

const CLAUDE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(ls*)', 'Bash(npm test*)', 'Bash(node --test*)', 'Bash(python3 *)'];
// Review round 3 (R2S-R3G-5): a question task runs in the project's real checkout, so plan mode is not its only
// barrier: it is allowed reading tools only, and the writing ones are refused outright.
const CLAUDE_READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)', 'Bash(ls*)'];
const CLAUDE_WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash(git add *)', 'Bash(git commit *)', 'Bash(npm test*)', 'Bash(node --test*)', 'Bash(python3 *)'];
// Claude's error results carry no text of their own (review round 3, R2T-R3-H7).
const ERROR_KINDS = { error_max_turns: 'It hit its turn limit.', error_during_execution: 'It hit an error while working.' };
const TASK_LIMIT_MS = 30 * 60 * 1000;
export const AGENTS = ['claude', 'codex', 'chatgpt'];
export const AGENT_NAMES = { claude: 'Claude', codex: 'Codex', chatgpt: 'ChatGPT' };
export const ACTIVE = ['running', 'question'];
export const FINISHED = ['done', 'unclear', 'failed', 'limited', 'stopped', 'interrupted'];
const NEWS = ['question', 'done', 'unclear', 'failed', 'limited', 'interrupted'];
const HANDABLE = ['limited', 'failed', 'stopped', 'unclear', 'interrupted', 'question', 'running'];
// Review round 2 (X6): a task the owner stopped never hides the helper's current one.
const ENDED = ['limited', 'failed', 'unclear', 'interrupted'];
const TIDY_REMOVES = ['limited', 'failed', 'stopped', 'interrupted'];
export const RECENT_MS = 12 * 3600_000;   // status and handoff look back this far for finished tasks (N4, F13)
const ANSWER_MAX = 2000;
const KEEP_FINISHED = 50;   // finished tasks kept in tasks.json; running and waiting ones are never dropped (X10)
// Regenerable caches a run may leave in ignored folders; any other ignored file is work (X8).
const CACHES = /(^|\/)(node_modules|__pycache__|\.pytest_cache|\.mypy_cache|\.DS_Store)(\/|$)/;

// Words of a handoff request that never name a task (X6).
const HANDOFF_TALK = /^(give|hand|pass|move|switch|transfer|send|over|instead|claude|clawed|codex|chatgpt|chat|that|this|task|then|them|have|take|finish|continue|handle|please|tamago|rest|with|from|let's|lets)$/;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task';
const cleanEnv = () => ({ HOME: homedir(), USER: process.env.USER ?? '', PATH: process.env.PATH ?? '/usr/bin:/bin', TERM: 'dumb', LANG: 'en_US.UTF-8' });

/** One reading of a spoken or typed helper name, shared by the confirmation and the run (F20). */
export function normalizeAgent(spoken, fallback = null) {
  const a = String(spoken ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^(claude|claud|clawed|cloud|clod)$/.test(a)) return 'claude';
  if (/^(codex|codecs|codeks|codexs|codeex)$/.test(a)) return 'codex';
  if (/^(chatgpt|chatgbt|chatgpd|chat|gpt)$/.test(a)) return 'chatgpt';
  return fallback;
}

/** The line as a label reader sees it: markdown emphasis, quote/list/heading markers and backticks removed (F8). */
const plainLine = (l) => l.replace(/[*`]/g, '').replace(/^[\s>#-]+/, '').replace(/^_{2}(ASK_OWNER|DONE|RUN)_{2}/, '$1').trim();

// Review G8 (2026-10-01): a quoted ('> DONE: …') or fenced ending is something the helper is showing, not its own
// ending, and an ending followed by a lot of prose ("I could not finish…") isn't the last word either.
const TRAILING_MAX_LINES = 6;

/**
 * The ending of an agent's final message. The LAST "ASK_OWNER:" or "DONE:" line wins, bold or indented or not (F8),
 * if it isn't quoted or inside a ``` fence and at most a few lines of prose (run instructions) follow it (G8). A
 * "RUN: command" line is kept (K7). Without an ending: 'unclear', with a clean gist.
 */
export function readEnding(text) {
  const raw = String(text ?? '').split('\n');
  let fenced = false;
  const shown = raw.map((l) => {   // true for lines the helper only quotes or shows in a code fence
    if (/^\s*```/.test(l)) { fenced = !fenced; return true; }
    return fenced || /^\s*>/.test(l);
  });
  const lines = raw.map(plainLine);
  let run = null;
  lines.forEach((l, i) => {
    if (!shown[i] && /^RUN:\s*\S/.test(l)) run = raw[i].replace(/^[\s>#*_-]*RUN[*_]*:[*_]*\s*/, '').replace(/^`+|`+$/g, '').trim().slice(0, 200) || null;
  });
  let after = 0;   // prose lines after the candidate ending
  for (let i = lines.length - 1; i >= 0; i--) {
    if (shown[i] || !lines[i]) continue;
    if (!/^(ASK_OWNER|DONE|RUN):/.test(lines[i]) && ++after > TRAILING_MAX_LINES) break;
    const ask = /^ASK_OWNER:\s*(.+)$/.exec(lines[i]);
    if (ask) { const [question, ...options] = ask[1].split('|').map((s) => s.trim()).filter(Boolean); return { kind: 'question', question, options }; }
    const done = /^DONE:\s*(.+)$/.exec(lines[i]);
    if (done) return { kind: 'done', summary: done[1].trim(), ...(run ? { run } : {}) };
  }
  return { kind: 'unclear', summary: gist(answerOf(text), 200), ...(run ? { run } : {}) };
}

/** The final message without its ending lines, capped at ANSWER_MAX at a line or sentence end (K4/N5). */
export function answerOf(text, max = ANSWER_MAX) {
  const s = String(text ?? '').split('\n').filter((l) => !/^(ASK_OWNER|DONE|RUN):/.test(plainLine(l))).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  return `${(at > max * 0.6 ? cut.slice(0, at + 1) : cut).trim()}…`;
}

// K7/N7: Codex's "but the commit was blocked by filesystem permissions" was passed on, and became the commit
// message, after the relay had committed it. Clauses about the agent's own failed commit are dropped. Review round 2
// (L10): only a clause that IS that trouble ("the commit was blocked by …", "I couldn't commit because …"); work about
// commits ("so a failed commit keeps the worktree") stays.
const COMMIT_TROUBLE = /^(?:and |though )?(?:(?:i|we) )?(?:could ?n['o]?t|was unable to|were unable to|am unable to|unable to|failed to|can'?t|cannot|was ?n['o]?t able to) (?:git )?commit\b|^(?:and |though )?(?:the |my |our )?(?:git )?commit(?:ting)?\b.{0,30}\b(?:was|is|got|were|has been) (?:blocked|denied|refused|rejected|not allowed|prevented|not possible)\b|^(?:and |though )?(?:the |my |our )?(?:git )?commit (?:failed|did ?n['o]?t work)\b/i;
const TROUBLE_SPLIT = /,?\s+but\s+|;\s+|,\s+(?:though|however|although)\s+|,?\s+and\s+(?=(?:i |we )?(?:could ?n|was unable|unable|failed to|can'?t|cannot)\S*\s+(?:to\s+)?(?:git\s+)?commit\b|the commit\b)/i;

/** A DONE summary as Tamago may repeat it: markdown-free, sentence-bounded, without stale commit trouble. */
export function cleanSummary(s, max = 200) {
  const kept = splitSentences(stripMarkdown(s)).map((sen) => {
    const parts = sen.split(TROUBLE_SPLIT);
    const ok = parts.filter((part) => !COMMIT_TROUBLE.test(part.trim()));
    return ok.length === parts.length ? sen : ok.join(', ');
  }).filter(Boolean).map(endSentence);
  return gist(kept.join(' '), max);
}

/** Codex's own record of its limits: the newest `rate_limits` in its session files (a file read, costs nothing). */
export function codexUsage(sessionsDir = join(homedir(), '.codex', 'sessions')) {
  const files = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const p = join(d, e);
      if (depth < 3) walk(p, depth + 1);
      else if (e.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(sessionsDir, 0);
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const f of files.slice(0, 20)) {
    const lines = readFileSync(f, 'utf8').trim().split('\n').reverse();
    for (const l of lines) {
      if (!l.includes('"rate_limits"')) continue;
      try {
        const obj = JSON.parse(l);
        const find = (o) => (o && typeof o === 'object' ? (o.rate_limits ?? Object.values(o).map(find).find(Boolean)) : null);
        const r = find(obj);
        if (!r) continue;
        const win = (w) => w && { usedPct: Number(w.used_percent), resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null };
        return { fiveHour: win(r.primary), weekly: win(r.secondary), asOf: new Date(statSync(f).mtimeMs).toISOString(), source: 'codex session files' };
      } catch { /* keep looking */ }
    }
  }
  return null;
}

/** Is a process still there? (EPERM: it exists, it just isn't ours to signal.) */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

/**
 * @param {object} o
 * @param {boolean} [o.recover] F14: this is the gateway starting, so 'running' tasks whose owning process is gone
 *   are marked interrupted. Off for the CLI and evals, which must never touch a live gateway's tasks (review SM7).
 * @param {number} [o.killWaitMs] how long a handoff waits for the old helper to exit before SIGKILL (review SM6)
 */
export function createRelay({
  stateDir, relayDir = '/Volumes/Storage/AI/relay', projects = null, spawn = nodeSpawn, now = Date.now,
  git = (cwd, args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  claudeBin = 'claude', codexBin = 'codex', codexSessions, recover = false, killWaitMs = 5000,
} = {}) {
  const dir = join(stateDir, 'relay');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tasksFile = join(dir, 'tasks.json');
  const usageFile = join(dir, 'claude-usage.json');
  const projectsFile = join(stateDir, 'projects.json');
  const running = new Map();   // task id -> child process
  const closing = new Map();   // task id -> promise that resolves when that child has exited (SM6)
  const waiters = new Map();   // task id -> Set of settle() callbacks
  const iso = () => new Date(now()).toISOString();

  // projects.json: { "Name": "/path" } or { "Name": { "path": "/path", "base": "develop" } } (F15).
  const PROJECTS = projects ?? (() => {
    if (!existsSync(projectsFile)) {
      writeFileSync(projectsFile, JSON.stringify({ TamaWatch: '/Volumes/Storage/Projects/TamaWatch', Sandbox: join(relayDir, 'sandbox') }, null, 1));
    }
    return JSON.parse(readFileSync(projectsFile, 'utf8'));
  })();
  const pathOf = (name) => (typeof PROJECTS[name] === 'string' ? PROJECTS[name] : PROJECTS[name]?.path);
  const baseOf = (name) => {
    if (typeof PROJECTS[name] === 'object' && PROJECTS[name]?.base) return PROJECTS[name].base;
    try { git(pathOf(name), ['rev-parse', '--verify', '--quiet', 'refs/heads/main']); return 'main'; } catch { return 'HEAD'; }
  };

  // Never let a log write (disk unplugged, folder removed) throw inside a stream handler: that would take the
  // whole gateway down with it.
  const note = (file, data) => { try { appendFileSync(file, data); } catch { /* the task state still updates */ } };
  const load = () => { try { return JSON.parse(readFileSync(tasksFile, 'utf8')); } catch { return []; } };
  // Review round 2 (X10): only finished tasks are trimmed; a waiting question (kept "at any age", F10/N4), a running task
  // and a handoff in progress are never dropped, so their lock, worktree and question stay known.
  const trim = (tasks) => {
    const old = tasks.filter((t) => !ACTIVE.includes(t.state) && t.handedTo !== 'pending');
    const drop = new Set(old.slice(0, Math.max(0, old.length - KEEP_FINISHED)));
    return tasks.filter((t) => !drop.has(t));
  };
  const save = (tasks) => { try { writeFileSync(tasksFile, JSON.stringify(trim(tasks), null, 1), { mode: 0o600 }); } catch { /* see note() */ } };
  const update = (id, patch, { touch = true } = {}) => {
    const t = load(); const i = t.findIndex((x) => x.id === id);
    if (i < 0) return null;
    t[i] = { ...t[i], ...patch, ...(touch ? { updatedAt: iso() } : {}) };
    save(t);
    if (patch.state && patch.state !== 'running') for (const w of waiters.get(id) ?? []) w();
    return t[i];
  };
  const find = (id) => load().find((x) => x.id === id) ?? null;

  function matchProject(spoken) {
    const want = slug(spoken ?? '');
    const names = Object.keys(PROJECTS);
    return names.find((n) => slug(n) === want) ?? names.find((n) => want && (slug(n).startsWith(want) || want.includes(slug(n)))) ?? null;
  }

  function agentArgs(agent, task, { resume, message, readOnly }) {
    const rules = readOnly ? ANSWER_RULES : agent === 'codex' ? CODEX_RULES : RULES;
    if (agent === 'claude') {
      const args = ['-p', message, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', rules,
        '--permission-mode', readOnly ? 'plan' : 'acceptEdits', '--allowedTools', ...(readOnly ? CLAUDE_READ_TOOLS : CLAUDE_TOOLS),
        ...(readOnly ? ['--disallowedTools', ...CLAUDE_WRITE_TOOLS] : [])];
      if (resume) args.push('--resume', resume);
      return [claudeBin, args];
    }
    const sandbox = readOnly || agent === 'chatgpt' ? 'read-only' : 'workspace-write';
    // F18: a resume keeps the first run's sandbox (a question task never resumes with write access).
    if (resume) return [codexBin, ['exec', '--json', '-s', sandbox, '--skip-git-repo-check', 'resume', resume, message]];
    return [codexBin, ['exec', '--json', '-C', task.cwd, '-s', sandbox, '--skip-git-repo-check', `${rules}\n\n${readOnly ? 'Question' : 'Task'}: ${message}`]];
  }

  const g = (cwd, args) => { try { return String(git(cwd, args) ?? ''); } catch { return null; } };

  /**
   * The commit a task branch grew from, or null when it can't be known. Review SM1/G3 (2026-10-01): tasks written by
   * the old relay have no base/baseSha, and `HEAD..HEAD` counted their real commits as 0, so tidy() deleted them.
   * Without a recorded baseSha it is the merge-base with the recorded base or the project's base branch, never HEAD.
   */
  function baseFor(t) {
    if (t.baseSha) return t.baseSha;
    const ref = t.base && t.base !== 'HEAD' ? t.base : pathOf(t.project) && baseOf(t.project) !== 'HEAD' ? baseOf(t.project) : null;
    return ref ? g(t.cwd, ['merge-base', ref, 'HEAD'])?.trim() || null : null;
  }

  /**
   * After a run ends: leftover changes are committed on the task branch (F16), and a limited/failed/stopped/
   * interrupted run that left no commits has its worktree and empty branch removed (N10). Removal needs a known base,
   * a count of 0, nothing just committed, and a clean worktree after the commit attempt (SM1, SM2, G3: a failed
   * commit — index.lock, a pre-commit hook — must never be followed by `worktree remove --force`). Review round 2:
   * ignored files other than caches count as work (X8), and the count is of the task branch itself, with HEAD still on
   * it (X9: a detached HEAD at the base counted 0 while the branch held commits).
   */
  function tidy(t, message) {
    if (!t.branch || t.removed || !t.cwd || !existsSync(t.cwd)) return {};
    const out = {};
    // Review round 3 (R2S-R3S-1): the owner's status.showUntrackedFiles=no (or a submodule setting) must never hide a
    // run's new files from this check, or they would be removed with the worktree without ever being committed.
    const status = ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'];
    const changes = g(t.cwd, status);
    if (changes?.trim()) {
      const msg = message ?? `WIP (${AGENT_NAMES[t.agent] ?? t.agent}, ${t.state}): ${clause(t.text, 60)}`;
      if (g(t.cwd, ['add', '-A']) !== null && g(t.cwd, ['commit', '-q', '-m', msg]) !== null) out.committed = true;
      else out.uncommitted = true;
    }
    const base = baseFor(t);
    const ref = `refs/heads/${t.branch}`;
    const count = base ? Number(g(t.cwd, ['rev-list', '--count', `${base}..${ref}`])?.trim()) : NaN;
    out.commits = Number.isFinite(count) ? count : null;
    const onBranch = g(t.cwd, ['symbolic-ref', '-q', 'HEAD'])?.trim() === ref;
    const left = g(t.cwd, [...status, '--ignored']);
    const clean = changes !== null && left !== null && left.split('\n').filter(Boolean).every((l) => l.startsWith('!! ') && CACHES.test(l.slice(3)));
    if (out.commits === 0 && clean && onBranch && !out.committed && !out.uncommitted && TIDY_REMOVES.includes(t.state) && !t.handedTo) {
      const home = pathOf(t.project) ?? t.cwd;
      if (g(home, ['worktree', 'remove', '--force', t.cwd]) !== null) {
        g(home, ['branch', '-D', t.branch]);
        out.removed = true;
      }
    }
    return out;
  }

  /** Records an ending (state + fields), tidies the worktree, and leaves it for Tamago to announce. */
  function finish(cur, patch, message) {
    const merged = { ...cur, ...patch };
    const tidied = tidy(merged, message);
    return update(cur.id, { ...patch, ...(patch.state ? { announced: false, endedAt: iso() } : {}), ...tidied });
  }

  // F14: after a gateway restart no child is ours any more; a task left 'running' would hold the project lock forever.
  // Review SM7: only when this is the gateway starting (`recover`), and never for a task whose owning process is
  // still alive (another gateway or CLI on the same state dir). Past the 30-min watchdog nothing can still own it.
  // Review round 2 (X7): a handoff cut off between "pending" and the next helper's start (the gateway died while it
  // waited for the old helper) is repaired the same way, so its leftovers are committed and it is announced.
  const elsewhere = (pid) => Boolean(pid && pid !== process.pid && alive(pid));
  // Review round 3 (R2S-R3S-6): a live owner pid counts only within the watchdog's window; past it the pid may well be
  // reused, and nothing can still be running the task.
  const ownedElsewhere = (t) => elsewhere(t.owner) && now() - Date.parse(t.updatedAt ?? t.startedAt) < TASK_LIMIT_MS + 5 * 60_000;
  if (recover) {
    const all = load();
    for (const t of all) {
      if (t.state === 'running' && !t.handedTo) {
        if (!ownedElsewhere(t)) finish(t, { state: 'interrupted', result: 'The gateway restarted while it was working.' });
      } else if (t.handedTo === 'pending' && !elsewhere(t.handoffBy)) {
        const next = all.find((x) => x.handoffFrom === t.id);   // it died after the next task was saved
        if (next) update(t.id, { handedTo: next.id }, { touch: false });
        else {
          finish({ ...t, handedTo: null }, { handedTo: null, handoffBy: null, ...(t.state === 'stopped'
            ? { state: 'interrupted', result: 'The gateway stopped while handing it over.' } : { announced: false }) });
        }
      }
    }
  }

  function run(task, message, resume) {
    const [bin, args] = agentArgs(task.agent, task, { resume, message, readOnly: task.readOnly });
    const log = join(dir, `${task.id}.log`);
    note(log, `\n### ${iso()} ${resume ? 'resume' : 'start'}: ${bin} ${task.agent}\n`);
    const child = spawn(bin, args, { cwd: task.cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    running.set(task.id, child);
    closing.set(task.id, new Promise((resolve) => child.once('close', resolve)));
    let buf = '', lastText = '', session = task.session ?? null, lastErr = '', errText = '';
    // Review round 2 (X5): a spawn failure (helper not installed, task folder gone) is an 'error' event; unhandled, it
    // would take the gateway down. Handled, Node follows it with 'close' (code -2) and the run ends as failed.
    child.on('error', (err) => { lastErr = err.message; note(log, `${err.message}\n`); });
    let rejected = false, limitSaid = false, isError = false, resetsAt = null, resetText = null, errKind = null;
    const timer = setTimeout(() => { update(task.id, { state: 'failed', result: 'Took longer than 30 minutes; stopped.', announced: false }); child.kill('SIGTERM'); }, TASK_LIMIT_MS);
    timer.unref();   // a watchdog, not a reason to keep the gateway (or a test run) alive
    const limitWords = (s) => {
      const text = String(s ?? '');
      if (!/usage limit|rate limit|out of credits|hit your limit|limit reached|quota/i.test(text)) return false;
      // F11: keep the reset time ("Claude AI usage limit reached|1759406400", "… · resets Oct 2 at 12pm").
      const epoch = /limit reached\|(\d{10})/.exec(text)?.[1];
      if (epoch) resetsAt = new Date(Number(epoch) * 1000).toISOString();
      const said = /\bresets?\s+(?:at\s+|on\s+)?([^·\n.()"\\]{2,40})/i.exec(text)?.[1]?.trim();
      if (said) resetText = said;
      return true;
    };
    child.stdout.on('data', (d) => {
      note(log, d);
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'system' && e.session_id) session = e.session_id;
        if (e.type === 'thread.started' && e.thread_id) session = e.thread_id;
        if (e.type === 'rate_limit_event' && e.rate_limit_info) {
          const info = e.rate_limit_info;
          const u = info.unifiedWindows ?? {};
          const at = (s) => (s ? new Date(s * 1000).toISOString() : null);
          const w = (x) => x && { usedPct: Math.round(x.utilization * 100), resetsAt: at(x.resetsAt) };
          try {
            writeFileSync(usageFile, JSON.stringify({ fiveHour: w(u.five_hour), weekly: w(u.seven_day), status: info.status,
              resetsAt: at(info.resetsAt), asOf: iso(), source: 'Claude run' }));
          } catch { /* see note() */ }
          // F21: one rejected event doesn't make the run limited; it counts only if the run then ends without a
          // DONE/ASK_OWNER, and a later 'allowed' event clears it.
          rejected = /rejected|exceeded/i.test(info.status ?? '');
          if (rejected) {
            const full = [u.five_hour, u.seven_day].filter((x) => x && x.utilization >= 1 && x.resetsAt).map((x) => x.resetsAt);
            resetsAt = at(info.resetsAt ?? (full.length ? Math.max(...full) : null)) ?? resetsAt;
          }
        }
        if (e.type === 'result') { lastText = e.result ?? lastText; if (e.is_error) isError = true; }
        if (e.is_error && /^error/.test(e.subtype ?? '')) errKind = e.subtype;
        if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'text') lastText = c.text;
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') lastText = e.item.text;
        if (e.type === 'error' || e.type === 'turn.failed' || e.is_error) {
          isError = true;
          const said = [e.error, e.error?.message, e.message, e.result].find((x) => typeof x === 'string' && x.trim());
          if (said) errText = said;
          if (limitWords(JSON.stringify(e.error ?? e.message ?? e.result ?? ''))) limitSaid = true;
        }
      }
    });
    child.stderr.on('data', (d) => { note(log, d); lastErr = String(d).trim().split('\n').at(-1) || lastErr; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (running.get(task.id) === child) { running.delete(task.id); closing.delete(task.id); }
      const cur = find(task.id);
      if (!cur || cur.handedTo) return;   // handed over: the next helper works in this worktree now
      if (cur.state !== 'running') return finish(cur, {});   // stopped or timed out: the state is set, tidy only
      const end = readEnding(lastText);
      const answer = answerOf(lastText) || null;
      if (end.kind === 'unclear' && (limitSaid || (rejected && (code !== 0 || isError)))) {
        return finish(cur, { state: 'limited', session, resetsAt, resetText, answer, result: 'Out of usage for now.' });
      }
      // Review round 2 (L7): a run that ended normally means Claude isn't out, whatever a transient event said.
      if (end.kind !== 'unclear' && task.agent === 'claude') {
        try {
          const u = JSON.parse(readFileSync(usageFile, 'utf8'));
          if (/rejected|exceeded/i.test(u.status ?? '')) writeFileSync(usageFile, JSON.stringify({ ...u, status: 'allowed', asOf: iso() }));
        } catch { /* never seen, or see note() */ }
      }
      if (end.kind === 'question') {
        return update(task.id, { state: 'question', session, question: end.question, options: end.options, answer, announced: false });
      }
      if (end.kind === 'done') {
        // L10: never the owner's own request as what was done.
        const summary = cleanSummary(end.summary) || 'It gave no summary.';
        // K7/N7: the commit says what the owner asked for and what was done, never the agent's stale trouble.
        return finish(cur, { state: 'done', session, result: summary, run: end.run ?? null, answer }, `${clause(cur.text, 72)}\n\n${summary}`);
      }
      // L3: a failure's reason is the error (its error event, else stderr), never the agent's last narration. Review
      // round 3 (R2T-R3-H7): not even when the error has no text (Claude's error_max_turns): its kind, else the exit.
      const failed = code !== 0 || isError;
      const why = failed ? gist(errText, 160) || gist(lastErr, 160) || ERROR_KINDS[errKind] || (errKind ? 'It ended with an error.' : '')
        : end.summary || gist(lastErr, 160);
      return finish(cur, { state: failed ? 'failed' : 'unclear', session, run: end.run ?? null, answer,
        result: why || (code !== 0 ? `It exited with code ${code}.` : 'It ended with an error.') });
    });
  }

  function newTask({ agent, project, text, readOnly = false, reuse = null, handoffFrom = null, ignoreLock = null }) {
    if (!AGENTS.includes(agent)) throw new Error(`unknown agent ${agent}`);
    const name = matchProject(project);
    if (!name) throw new Error(`${project} isn't one of your projects (${Object.keys(PROJECTS).join(', ')})`);
    const tasks = load();
    const ro = readOnly || agent === 'chatgpt';
    if (!ro && tasks.some((t) => t.project === name && ACTIVE.includes(t.state) && !t.readOnly && !t.handedTo && t.id !== ignoreLock)) {
      throw new Error(`${name} already has a task going; finish or stop it first`);
    }
    const id = `${iso().slice(0, 10)}-${slug(text).slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`;
    let cwd = pathOf(name), branch = null, base = null, baseSha = null;
    if (!cwd || !existsSync(cwd)) throw new Error(`${name}'s folder isn't there (${cwd})`);
    if (!ro && reuse) {
      ({ cwd, branch, base, baseSha } = reuse);
    } else if (!ro) {
      base = baseOf(name);
      baseSha = g(cwd, ['rev-parse', base])?.trim() || null;
      branch = `tamago/${slug(text).slice(0, 24).replace(/-+$/, '')}-${id.slice(-4)}`;
      const wt = join(relayDir, 'worktrees', slug(name), basename(branch));
      mkdirSync(join(relayDir, 'worktrees', slug(name)), { recursive: true });
      git(cwd, ['worktree', 'add', '-q', '-b', branch, wt, baseSha ?? base]);
      cwd = wt;
    }
    const task = { id, agent, project: name, text, readOnly: ro, branch, base, baseSha, cwd, state: 'running', owner: process.pid, log: join(dir, `${id}.log`),
      startedAt: iso(), updatedAt: iso(), ...(handoffFrom ? { handoffFrom } : {}) };
    save([...tasks, task]);
    return task;
  }

  /**
   * The task "give it to Codex instead" means (K3): of the last 12 h, not already the target's, the one the owner's
   * words name ("give the agario game to Codex", review round 2 X6), else the newest one that ended without finishing
   * (limited, failed, …; never one the owner stopped), else the newest running or waiting one (review SM5: a newer
   * ChatGPT question, or Codex's own work elsewhere, no longer hides Claude's limited game).
   */
  function handable({ to = null, words = '' } = {}) {
    // Review round 3 (R2S-R3S-5): the 12-h window is for ended tasks; a waiting question (listed at any age) and a
    // running task (bounded by the watchdog) can always be handed over.
    const open = load().filter((t) => HANDABLE.includes(t.state) && !t.handedTo && (!to || t.agent !== to)
      && (ACTIVE.includes(t.state) || now() - Date.parse(t.updatedAt ?? t.startedAt) < RECENT_MS));
    const want = String(words).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((w) => w.length > 3 && !HANDOFF_TALK.test(w));
    if (want.length && open.length) {
      const score = open.map((t) => want.filter((w) => String(t.text).toLowerCase().includes(w)).length);
      const best = Math.max(...score);
      if (best > 0 && score.filter((n) => n === best).length === 1) return open[score.indexOf(best)];
    }
    return open.filter((t) => ENDED.includes(t.state)).at(-1) ?? open.at(-1) ?? null;
  }

  /** "… finished in the meantime, so I didn't …" for a confirmed task that is no longer active (SM5, X2). */
  const endedSince = (t, didnt) => `${AGENT_NAMES[t.agent] ?? t.agent}'s task "${clause(t.text, 50)}" ${t.handedTo ? 'was handed over'
    : t.state === 'done' ? 'finished' : `ended (${t.state})`} in the meantime, so I didn't ${didnt}.`;
  /** X1: a running task whose helper belongs to another live Tamago process (gateway or CLI on the same state dir). */
  const runsElsewhere = (t) => t.state === 'running' && !running.has(t.id) && ownedElsewhere(t);

  /** SM6: stops a helper and waits for it to exit (SIGKILL after killWaitMs), so two never share a worktree. */
  async function stopAndWait(id) {
    const child = running.get(id);
    if (!child) return;
    const closed = closing.get(id) ?? Promise.resolve();
    const within = async (p, ms) => {
      let timer;
      const r = await Promise.race([p.then(() => 'closed'), new Promise((res) => { timer = setTimeout(res, ms, 'timeout'); })]);
      clearTimeout(timer);
      return r;
    };
    child.kill('SIGTERM');
    if (await within(closed, killWaitMs) === 'timeout') {
      child.kill('SIGKILL');
      await within(closed, 2000);
    }
  }

  /** What the next helper reads: the owner's words verbatim plus a short baton (K3, N6; RELAY_PLAN §6). */
  function baton(prev, log, reused) {
    const who = AGENT_NAMES[prev.agent] ?? prev.agent;
    const how = { limited: 'ran out of usage', failed: `failed (${prev.result ?? 'no reason given'})`, stopped: 'was stopped',
      unclear: 'ended without a clear finish', interrupted: 'was cut off by a restart', question: 'was waiting for an answer',
      running: 'was still working' }[prev.state] ?? prev.state;
    return [
      `The owner's request, in their words: ${prev.text}`,
      `${who} had this task first and ${how}; it is yours now.`,
      prev.branch ? (reused
        ? `You continue on the same branch (${prev.branch}), in this folder. ${who}'s commits so far (uncommitted work was committed as WIP):\n${log || '(none)'}`
        : `${who} left no work behind; start fresh on this branch.`) : null,
      prev.question ? `${who} had asked the owner: ${prev.question}${prev.options?.length ? ` (${prev.options.join(' | ')})` : ''}. No answer yet.` : null,
      prev.result && prev.state !== 'limited' ? `${who}'s last words: ${gist(prev.result, 300)}` : null,
      prev.branch ? 'Check git status and run the tests before trusting this; do not redo finished work.' : null,
    ].filter(Boolean).join('\n');
  }

  return {
    projects: () => Object.keys(PROJECTS),
    matchProject,

    /** Starts a task in the background; returns it at once (settle() waits for an early ending). */
    start({ agent, project, text, readOnly = false }) {
      const task = newTask({ agent, project, text, readOnly });
      run(task, text, null);
      return task;
    },

    /**
     * K2: resolves with the task once it leaves 'running' (a limit hit 2.4 s in, live test 2026-10-01) or after
     * `ms`, whichever comes first, so "on it" is only said about a run that is still going.
     */
    settle(id, ms = 5000) {
      return new Promise((resolve) => {
        const cur = find(id);
        if (!cur || cur.state !== 'running') return resolve(cur);
        const set = waiters.get(id) ?? new Set();
        waiters.set(id, set);
        const done = () => { clearTimeout(timer); set.delete(done); if (!set.size) waiters.delete(id); resolve(find(id)); };
        const timer = setTimeout(done, ms);
        set.add(done);
      });
    },

    /** The owner's answer to a waiting question (for one helper or task): resumes the same session. */
    answer(text, { agent = null, id = null } = {}) {
      const waiting = load().filter((x) => x.state === 'question' && !x.handedTo);
      const t = id ? waiting.find((x) => x.id === id) : (agent ? waiting.filter((x) => x.agent === agent) : waiting).at(-1);
      if (!t) throw new Error(agent ? `${AGENT_NAMES[agent] ?? agent} isn't waiting for an answer` : 'no question is waiting');
      // X5: a resume in a folder that is gone (Storage unmounted, removed by hand) fails the task cleanly instead.
      if (!t.cwd || !existsSync(t.cwd)) {
        finish(t, { state: 'failed', result: `Its folder is gone (${t.cwd}).` });
        update(t.id, { announced: true }, { touch: false });
        throw new Error(`${AGENT_NAMES[t.agent] ?? t.agent}'s folder for "${clause(t.text, 50)}" is gone, so I couldn't pass that on.`);
      }
      update(t.id, { state: 'running', owner: process.pid, question: null, options: null, asked: [...(t.asked ?? []), { q: t.question, a: text }] });
      run({ ...t, state: 'running' }, `Owner answered by voice: ${text}\n(Your question was: ${t.question})`, t.session);
      return t;
    },

    /**
     * Hands a task to another helper with the original request and a baton (K3): `id` when the owner confirmed a
     * specific task (SM5: refused if it has ended since), else the one handable() picks. A running helper is stopped
     * and waited for before its leftovers are committed and the next one starts in the same worktree (SM6).
     */
    async handoff({ agent, id = null } = {}) {
      const to = normalizeAgent(agent);
      if (!to) throw new Error(`I don't know a helper called ${agent}.`);
      const prev = id ? find(id) : handable({ to });
      if (!prev || prev.handedTo) throw new Error('There is no unfinished helper task to hand over.');
      if (!HANDABLE.includes(prev.state)) throw new Error(endedSince(prev, 'hand it over'));
      if (prev.agent === to) throw new Error(`${AGENT_NAMES[to]} already has that task.`);
      if (to === 'chatgpt' && !prev.readOnly) throw new Error("ChatGPT only answers questions; it can't take build work. Codex or Claude can.");
      // X1: never start a second helper in a worktree whose helper another Tamago process is still running.
      if (runsElsewhere(prev)) throw new Error(`${AGENT_NAMES[prev.agent]}'s task "${clause(prev.text, 50)}" is running in another Tamago process, so I can't hand it over from here.`);
      const wasActive = ACTIVE.includes(prev.state);
      update(prev.id, { handedTo: 'pending', handoffBy: process.pid, handoffTo: to, ...(wasActive ? { state: 'stopped', endedAt: iso() } : {}), announced: true });
      await stopAndWait(prev.id);
      const reused = Boolean(prev.branch && !prev.removed && prev.cwd && existsSync(prev.cwd));
      let log = '';
      let baseSha = prev.baseSha ?? null;
      if (reused) {
        tidy({ ...prev, handedTo: 'pending' }, `WIP (${AGENT_NAMES[prev.agent]}, ${prev.state}, handed to ${AGENT_NAMES[to]}): ${clause(prev.text, 50)}`);
        baseSha = baseFor(prev);   // SM1: an old-format task's base is worked out once and passed on
        log = baseSha ? (g(prev.cwd, ['log', '--oneline', '-10', `${baseSha}..HEAD`]) ?? '').trim() : '(base unknown; see git log)';
      }
      let task;
      try {
        task = newTask({ agent: to, project: prev.project, text: prev.text, readOnly: prev.readOnly, handoffFrom: prev.id, ignoreLock: prev.id,
          reuse: reused ? { cwd: prev.cwd, branch: prev.branch, base: prev.base ?? null, baseSha } : null });
      } catch (err) { update(prev.id, { handedTo: null, handoffTo: null }); throw err; }
      update(prev.id, { handedTo: task.id });
      run(task, baton(prev, log, reused), null);
      return { task, from: prev };
    },

    /**
     * Stops the task the owner confirmed (`id`, review round 2 X2: refused if it has ended since), else the newest
     * running/waiting task, of one helper when named (F6). Never a task another live Tamago process is running (X1).
     */
    stop({ agent = null, id = null } = {}) {
      const t = id ? find(id) : load().filter((x) => ACTIVE.includes(x.state) && !x.handedTo && (!agent || x.agent === agent)).at(-1);
      if (!t) return null;
      if (!ACTIVE.includes(t.state) || t.handedTo) throw new Error(endedSince(t, 'stop anything'));
      if (runsElsewhere(t)) throw new Error(`${AGENT_NAMES[t.agent]}'s task "${clause(t.text, 50)}" is running in another Tamago process; stop it there.`);
      const u = update(t.id, { state: 'stopped', announced: true, endedAt: iso() });
      const child = running.get(t.id);
      if (child) child.kill('SIGTERM');
      else return finish(u, {});   // a waiting question has no process: tidy now
      return u;
    },

    /** Latest tasks, newest last. */
    tasks: (n = 5) => load().slice(-n),
    handable,

    /** Endings the owner hasn't been told about yet (K2/N1); questions first. */
    news: () => load().filter((t) => t.announced === false && NEWS.includes(t.state) && !t.handedTo)
      .sort((a, b) => (a.state === 'question' ? 0 : 1) - (b.state === 'question' ? 0 : 1)),
    /** Marks endings as told; a waiting question also records when the owner last heard it (review G2). */
    markAnnounced(ids) {
      const set = new Set(ids);
      const t = load();
      let changed = false;
      for (const x of t) {
        if (!set.has(x.id)) continue;
        if (x.announced === false) { x.announced = true; changed = true; }
        if (x.state === 'question') { x.heardAt = iso(); changed = true; }
      }
      if (changed) save(t);
    },

    usage() {
      let claude = null;
      try { claude = JSON.parse(readFileSync(usageFile, 'utf8')); } catch { /* never seen */ }
      return { claude, codex: codexUsage(codexSessions) };
    },
  };
}
