// relay/relay.js: Tamago hands work to Claude Code, Codex or "ChatGPT chat" (docs/RELAY_PLAN.md R2, D-129).
//
// A task: the owner's words, one agent, one allowlisted project. Changing tasks run on their own branch in a git
// worktree under $TAMAGO_RELAY_DIR (never the project's checkout, never main); question-only tasks run read-only in
// the project. The agent runs headless in the background (R0 spike: claude -p stream-json / codex exec --json), its
// full output goes to the task's log on Storage, and its last line decides what happens next:
//   ASK_OWNER: question | option | option   → the task waits for the owner (answer() resumes the same session)
//   DONE: what was done                      → finished (Codex's work is committed by the relay: its sandbox can't)
// Usage figures (Claude's rate_limit_event, Codex's session files) are kept for "how much Claude is left?".
// The relay never pushes, merges, opens pull requests or deletes branches; the agents are told the same.

import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

export const RULES = `You are working for the owner through Tamago, a voice relay. The owner is not at a keyboard.
- Work only in this directory, on the current branch. Never push, merge, open pull requests or delete branches.
- Ask only when the owner's choice changes what you would do; otherwise decide and say so at the end.
- When you truly need the owner, stop and end your final reply with exactly one line:
  ASK_OWNER: <question, at most 15 words> | <option A> | <option B>
- Otherwise finish, commit your work on this branch with a short message (if you changed files), and end with one line:
  DONE: <what you did, at most 20 words>`;

const CLAUDE_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git status*)', 'Bash(git diff*)', 'Bash(git log*)',
  'Bash(git add *)', 'Bash(git commit *)', 'Bash(ls*)', 'Bash(npm test*)', 'Bash(node --test*)', 'Bash(python3 *)'];
const TASK_LIMIT_MS = 30 * 60 * 1000;
const AGENTS = ['claude', 'codex', 'chatgpt'];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task';
const cleanEnv = () => ({ HOME: homedir(), USER: process.env.USER ?? '', PATH: process.env.PATH ?? '/usr/bin:/bin', TERM: 'dumb', LANG: 'en_US.UTF-8' });

/** "ASK_OWNER: q | a | b" / "DONE: text" at the end of an agent's reply. */
export function readEnding(text) {
  const lines = String(text ?? '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const ask = /^ASK_OWNER:\s*(.+)$/.exec(lines[i]);
    if (ask) { const [question, ...options] = ask[1].split('|').map((s) => s.trim()).filter(Boolean); return { kind: 'question', question, options }; }
    const done = /^DONE:\s*(.+)$/.exec(lines[i]);
    if (done) return { kind: 'done', summary: done[1].trim() };
  }
  return { kind: 'unclear', summary: lines.at(-1)?.slice(0, 200) ?? '' };
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

export function createRelay({
  stateDir, relayDir = '/Volumes/Storage/AI/relay', projects = null, spawn = nodeSpawn, now = Date.now,
  git = (cwd, args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  claudeBin = 'claude', codexBin = 'codex', codexSessions,
} = {}) {
  const dir = join(stateDir, 'relay');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tasksFile = join(dir, 'tasks.json');
  const usageFile = join(dir, 'claude-usage.json');
  const projectsFile = join(stateDir, 'projects.json');
  const running = new Map();   // task id -> child process

  const PROJECTS = projects ?? (() => {
    if (!existsSync(projectsFile)) {
      writeFileSync(projectsFile, JSON.stringify({ TamaWatch: '/Volumes/Storage/Projects/TamaWatch', Sandbox: join(relayDir, 'sandbox') }, null, 1));
    }
    return JSON.parse(readFileSync(projectsFile, 'utf8'));
  })();

  // Never let a log write (disk unplugged, folder removed) throw inside a stream handler: that would take the
  // whole gateway down with it.
  const note = (file, data) => { try { appendFileSync(file, data); } catch { /* the task state still updates */ } };
  const load = () => { try { return JSON.parse(readFileSync(tasksFile, 'utf8')); } catch { return []; } };
  const save = (tasks) => { try { writeFileSync(tasksFile, JSON.stringify(tasks.slice(-50), null, 1), { mode: 0o600 }); } catch { /* see note() */ } };
  const update = (id, patch) => { const t = load(); const i = t.findIndex((x) => x.id === id); if (i >= 0) { t[i] = { ...t[i], ...patch, updatedAt: new Date(now()).toISOString() }; save(t); return t[i]; } return null; };

  function matchProject(spoken) {
    const want = slug(spoken ?? '');
    const names = Object.keys(PROJECTS);
    return names.find((n) => slug(n) === want) ?? names.find((n) => want && (slug(n).startsWith(want) || want.includes(slug(n)))) ?? null;
  }

  function agentArgs(agent, task, { resume, message, readOnly }) {
    if (agent === 'claude') {
      const args = ['-p', message, '--output-format', 'stream-json', '--verbose', '--append-system-prompt', RULES,
        '--permission-mode', readOnly ? 'plan' : 'acceptEdits', '--allowedTools', ...CLAUDE_TOOLS];
      if (resume) args.push('--resume', resume);
      return [claudeBin, args];
    }
    const sandbox = readOnly || agent === 'chatgpt' ? 'read-only' : 'workspace-write';
    const prompt = agent === 'chatgpt' ? message : `${RULES}\n\nTask: ${message}`;
    return resume ? [codexBin, ['exec', '--json', 'resume', resume, message]] : [codexBin, ['exec', '--json', '-C', task.cwd, '-s', sandbox, '--skip-git-repo-check', prompt]];
  }

  function run(task, message, resume) {
    const [bin, args] = agentArgs(task.agent, task, { resume, message, readOnly: task.readOnly });
    const log = join(dir, `${task.id}.log`);
    note(log, `\n### ${new Date(now()).toISOString()} ${resume ? 'resume' : 'start'}: ${bin} ${task.agent}\n`);
    const child = spawn(bin, args, { cwd: task.cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    running.set(task.id, child);
    let buf = '', lastText = '', session = task.session ?? null, limited = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); update(task.id, { state: 'failed', result: 'Took longer than 30 minutes; stopped.' }); }, TASK_LIMIT_MS);
    timer.unref();   // a watchdog, not a reason to keep the gateway (or a test run) alive
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
          const u = e.rate_limit_info.unifiedWindows ?? {};
          const w = (x) => x && { usedPct: Math.round(x.utilization * 100), resetsAt: x.resetsAt ? new Date(x.resetsAt * 1000).toISOString() : null };
          writeFileSync(usageFile, JSON.stringify({ fiveHour: w(u.five_hour), weekly: w(u.seven_day), status: e.rate_limit_info.status, asOf: new Date(now()).toISOString(), source: 'Claude run' }));
          if (/rejected|limited|exceeded/i.test(e.rate_limit_info.status ?? '')) limited = true;
        }
        if (e.type === 'result') lastText = e.result ?? lastText;
        if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'text') lastText = c.text;
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') lastText = e.item.text;
        if (/usage limit|rate limit|out of credits/i.test(JSON.stringify(e.error ?? e.message ?? '')) && (e.type === 'error' || e.type === 'turn.failed' || e.is_error)) limited = true;
      }
    });
    child.stderr.on('data', (d) => note(log, d));
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(task.id);
      const cur = load().find((t) => t.id === task.id);
      if (!cur || cur.state === 'stopped' || cur.state === 'failed') return;
      const end = readEnding(lastText);
      if (limited) return update(task.id, { state: 'limited', session, result: 'Out of usage for now.' });
      if (end.kind === 'question') return update(task.id, { state: 'question', session, question: end.question, options: end.options });
      if (task.agent === 'codex' && !task.readOnly && end.kind === 'done') {
        try { git(task.cwd, ['add', '-A']); git(task.cwd, ['commit', '-q', '-m', end.summary]); } catch { /* nothing to commit */ }
      }
      update(task.id, { state: code === 0 || end.kind === 'done' ? 'done' : 'failed', session, result: end.summary || lastText.slice(0, 300) });
    });
  }

  return {
    projects: () => Object.keys(PROJECTS),
    matchProject,

    /** Starts a task in the background; returns it at once. */
    start({ agent, project, text, readOnly = false }) {
      if (!AGENTS.includes(agent)) throw new Error(`unknown agent ${agent}`);
      const name = matchProject(project);
      if (!name) throw new Error(`${project} isn't one of your projects (${Object.keys(PROJECTS).join(', ')})`);
      const tasks = load();
      if (tasks.some((t) => t.project === name && ['running', 'question'].includes(t.state) && !t.readOnly && !readOnly)) {
        throw new Error(`${name} already has a task going; finish or stop it first`);
      }
      const id = `${new Date(now()).toISOString().slice(0, 10)}-${slug(text).slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`;
      const ro = readOnly || agent === 'chatgpt';
      let cwd = PROJECTS[name], branch = null;
      if (!existsSync(cwd)) throw new Error(`${name}'s folder isn't there (${cwd})`);
      if (!ro) {
        branch = `tamago/${slug(text).slice(0, 24)}-${id.slice(-4)}`;
        const wt = join(relayDir, 'worktrees', slug(name), basename(branch));
        mkdirSync(join(relayDir, 'worktrees', slug(name)), { recursive: true });
        git(PROJECTS[name], ['worktree', 'add', '-q', '-b', branch, wt]);
        cwd = wt;
      }
      const task = { id, agent, project: name, text, readOnly: ro, branch, cwd, state: 'running', startedAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
      save([...tasks, task]);
      run(task, text, null);
      return task;
    },

    /** The owner's answer to the waiting question: resumes the same session. */
    answer(text) {
      const t = load().filter((x) => x.state === 'question').at(-1);
      if (!t) throw new Error('no question is waiting');
      update(t.id, { state: 'running', question: null, options: null });
      run({ ...t, state: 'running' }, `Owner answered by voice: ${text}`, t.session);
      return t;
    },

    stop() {
      const t = load().filter((x) => ['running', 'question'].includes(x.state)).at(-1);
      if (!t) return null;
      running.get(t.id)?.kill('SIGTERM');
      return update(t.id, { state: 'stopped' });
    },

    /** Latest tasks, newest last. */
    tasks: (n = 5) => load().slice(-n),

    usage() {
      let claude = null;
      try { claude = JSON.parse(readFileSync(usageFile, 'utf8')); } catch { /* never seen */ }
      return { claude, codex: codexUsage(codexSessions) };
    },
  };
}
