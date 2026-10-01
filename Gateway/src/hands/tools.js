// hands/tools.js: what Tamago's hands can do on the owner's Mac (docs/TAMAGO_HANDS.md, D-128).
//
// An allowlist. Every tool is a fixed macOS program run with execFile (never a shell), and every argument is
// validated before anything runs. `risk: 'confirm'` tools are never run by the model directly: the agent asks
// the owner first (agent.js). Tools return { ok, say, data }: `say` is a short fact for the model to phrase,
// `data` is extra detail it may use. Nothing here deletes, sends, pays, installs or changes settings.

import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { AGENT_NAMES, ACTIVE, FINISHED, RECENT_MS, normalizeAgent } from '../relay/relay.js';
import { clause, cutWords, endSentence, splitSentences } from '../brain/speech/text.js';

const HOME = homedir();
const APP_DIRS = ['/Applications', '/System/Applications', '/System/Applications/Utilities', join(HOME, 'Applications'),
  '/Volumes/Storage/Games/Emulators'];
const FOLDERS = {
  downloads: join(HOME, 'Downloads'), desktop: join(HOME, 'Desktop'), documents: join(HOME, 'Documents'),
  pictures: join(HOME, 'Pictures'), music: join(HOME, 'Music'), home: HOME, applications: '/Applications',
  storage: '/Volumes/Storage', games: '/Volumes/Storage/Games', projects: '/Volumes/Storage/Projects',
  screenshots: join(HOME, 'Pictures', 'Console Mode'),
};

/** Runs a fixed program; resolves { code, out, err }. Never rejects, never uses a shell. */
export function defaultExec(file, args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: String(stdout), err: String(stderr) });
    });
  });
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\.app$/, '').replace(/[^a-z0-9]+/g, '');

/** Installed apps: { name, path }. Top level of each app folder only. */
export function installedApps(dirs = APP_DIRS) {
  const apps = [];
  for (const dir of dirs) {
    let entries = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const e of entries) if (e.endsWith('.app')) apps.push({ name: e.slice(0, -4), path: join(dir, e) });
  }
  return apps;
}

/** Best match for a spoken app name ("steam", "the calculator", "dolphin emulator"). */
export function matchApp(spoken, apps) {
  const want = norm(String(spoken).replace(/^(the|my)\s+/i, '').replace(/\s+(app|application|emulator)$/i, ''));
  if (!want) return null;
  return apps.find((a) => norm(a.name) === want)
    ?? apps.find((a) => norm(a.name).startsWith(want))
    ?? apps.find((a) => want.length >= 4 && norm(a.name).includes(want))
    ?? null;
}

/** Apps the owner opened (in the app folders), from `ps`; no Automation permission needed. System
 *  background processes (Dock, loginwindow, Siri…) live elsewhere and are left out. */
async function runningApps(exec, dirs = APP_DIRS) {
  const { out } = await exec('/bin/ps', ['-axo', 'comm=']);
  const names = new Set();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    const m = /^(.*)\/([^/]+)\.app\/Contents\/MacOS\/[^/]+$/.exec(line);
    if (!m || /\.app\/Contents\/.+\.app\//.test(line)) continue;           // helpers nested inside an app
    if (!dirs.some((d) => m[1] === d)) continue;                              // only the app folders
    if (/helper|agent|daemon|service|extension|crashpad|updater|uninstaller/i.test(m[2])) continue;
    names.add(m[2]);
  }
  return [...names].sort();
}

const q = (s) => `"${String(s).replace(/[\\"]/g, '')}"`;   // for AppleScript string literals (quotes stripped)

function int(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new Error('not a number');
  return Math.min(max, Math.max(min, n));
}

const ago = (iso, now) => {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

/** "3:00 PM" today, "Fri 12:00 PM" this week, "Oct 9, 3:00 PM" later (F9: reset times had no day). */
export function when(iso, now = Date.now()) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (Math.abs(d - now) < 6 * 86400_000) return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * When an agent's own report says it's out (status 'rejected', or a window at ≥ 100 %) with a reset still ahead:
 * the ISO time it comes back, else null (N2, F9). A reset in the past means it's back. Only a rejection with no
 * reset time of its own falls back to the windows still ahead (review R1: a passed five-hour reset made Claude
 * "out until" the weekly reset, at 60 %, for days).
 */
export function outUntil(u, now = Date.now()) {
  if (!u) return null;
  const ahead = (w) => w && w.resetsAt && Date.parse(w.resetsAt) > now;
  const times = [u.fiveHour, u.weekly].filter((w) => ahead(w) && w.usedPct >= 100).map((w) => Date.parse(w.resetsAt));
  if (/rejected|exceeded/i.test(u.status ?? '')) {
    if (u.resetsAt && Date.parse(u.resetsAt) > now) times.push(Date.parse(u.resetsAt));
    else if (!u.resetsAt && !times.length) times.push(...[u.fiveHour, u.weekly].filter(ahead).map((w) => Date.parse(w.resetsAt)));
  }
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

/** "Claude: 35% of its five-hour window left (resets 10:00 AM), 42% of the week left. As of 2 h ago." */
export function describeUsage(name, u, now = Date.now()) {
  if (!u) return `I haven't seen ${name}'s numbers yet.`;
  const age = Date.parse(u.asOf) < now - 15 * 60000 ? ` As of ${ago(u.asOf, now)}.` : '';
  // F9/N3: "rejected" or a full window leads, with the day it comes back.
  const out = outUntil(u, now);
  if (out) return `${name} is out until ${when(out, now)}.${age}`;
  const live = (w) => w && Number.isFinite(w.usedPct) && (!w.resetsAt || Date.parse(w.resetsAt) > now);   // past windows dropped
  const part = (w, label) => live(w) ? `${Math.max(0, 100 - w.usedPct)}% of ${label} left${w.resetsAt ? ` (resets ${when(w.resetsAt, now)})` : ''}` : null;
  const bits = [part(u.fiveHour, 'its five-hour window'), part(u.weekly, 'the week')].filter(Boolean);
  const stale = [u.fiveHour, u.weekly].some((w) => w && !live(w));
  return `${name}: ${bits.join(', ') || (stale ? 'its windows have reset since its last numbers' : 'no figures yet')}.${age}`;
}

const who = (x) => AGENT_NAMES[x.agent] ?? x.agent;
const what = (x, max = 50) => `"${clause(x.text, max)}"`;
// R10: a known reset that has passed is "should be back now", never the old time as if still to come.
const untilOf = (x, now) => (x.resetsAt ? (Date.parse(x.resetsAt) > now ? ` until ${when(x.resetsAt, now)}` : ' (it should be back now)')
  : x.resetText ? ` (it says it resets ${x.resetText})` : '');
const coding = (x) => x.branch && !x.readOnly;
const where = (x) => (x.commits > 0 || x.committed ? ` It's committed on branch ${x.branch}.`
  : x.uncommitted ? ` Its changes are on branch ${x.branch}, not committed.` : '');
const runLine = (x) => (x.run && x.cwd ? ` Run it: cd ${x.cwd} && ${x.run}` : '');

/**
 * One task in plain words: `say` is spoken (Watch), `screen` adds what's only useful to read (the run command, K7).
 * Exported for tests.
 */
export function describeTask(x, now = Date.now()) {
  let say;
  switch (x.state) {
    case 'running': say = `${who(x)} is working on ${what(x)} (started ${ago(x.startedAt, now)}).`; break;
    case 'question': say = `${who(x)} asks: ${x.question}${x.options?.length ? ` Options: ${x.options.join(' or ')}` : ''} (asked ${ago(x.updatedAt ?? x.startedAt, now)}).`; break;
    // K7: what was built and where it is, spoken short (the quoted task goes on the screen).
    case 'done': say = coding(x) ? `${who(x)} finished: ${endSentence(x.result)}${where(x)}` : `${who(x)} answered: ${endSentence(x.result)}`; break;
    case 'unclear': say = `${who(x)} ended ${what(x)} without a clear finish: ${endSentence(x.result)}${coding(x) ? where(x) : ''}`; break;
    case 'limited': say = `${who(x)} ran out of usage on ${what(x)}${untilOf(x, now)}.`; break;
    case 'failed': say = `${who(x)}'s task ${what(x)} failed: ${endSentence(x.result ?? 'no reason given')}${coding(x) ? where(x) : ''}`; break;
    case 'stopped': say = `${who(x)}'s task ${what(x)} was stopped.${coding(x) ? where(x) : ''}`; break;
    case 'interrupted': say = `${who(x)}'s task ${what(x)} was cut off when the gateway restarted.`; break;
    default: say = `${who(x)}'s task ${what(x)}: ${x.state}.`;
  }
  const extra = coding(x) && ['done', 'unclear'].includes(x.state) ? runLine(x) : '';
  const screen = x.state === 'done' && coding(x) ? `${who(x)} finished ${what(x)}: ${endSentence(x.result)}${where(x)}` : say;
  return { say, screen: `${screen}${extra}` };
}

/** A read-only helper's whole answer, for the phone (K6/N9), when it says more than the spoken line (R4, R5). */
function answerDetail(x, spoken) {
  if (!['done', 'unclear'].includes(x.state) || !x.answer || x.answer.length <= String(spoken ?? '').length + 20) return null;
  return `${who(x)}'s answer to "${x.text}":\n\n${x.answer}`;
}

/**
 * The short volunteered line about an ending the owner hasn't heard yet (K2/N1), its fuller screen text, its kind
 * (the task state: a question never rides on a reply waiting for "yes", SM8/G10), a `short` form that names the
 * task (R7: spoken with the reply's first sentence when the whole line doesn't fit) and, for a read-only answer,
 * the whole answer for the phone (R5).
 */
export function describeNews(x, now = Date.now()) {
  const full = describeTask(x, now).screen;
  const other = x.agent === 'claude' ? 'Codex' : x.agent === 'codex' ? 'Claude' : null;
  const base = { kind: x.state };
  switch (x.state) {
    case 'question': {
      // R8: the question itself, cut at a word; the options stay on screen (never "yes or no?" alone).
      const q = String(x.question ?? '');
      return { ...base, speech: `${who(x)} has a question: ${endSentence(cutWords(q, 100))}`, text: `${who(x)} asks: ${q}${x.options?.length ? ` Options: ${x.options.join(' | ')}.` : ''} Just say your answer.` };
    }
    case 'done': {
      const line = coding(x) ? `${who(x)} finished: ${endSentence(x.result)}` : `${who(x)} answered: ${endSentence(x.result)}`;
      const short = coding(x) ? `${who(x)} finished ${what(x, 40)}.` : `${who(x)} has an answer for ${what(x, 40)}.`;
      const detail = coding(x) ? null : answerDetail(x, line);
      return { ...base, speech: line.length <= 110 ? line : short, short, text: full, ...(detail ? { detail } : {}) };
    }
    case 'limited': return { ...base, speech: `${who(x)} ran out of usage on ${what(x, 40)}${untilOf(x, now)}.`, short: `${who(x)} ran out of usage on ${what(x, 30)}.`, text: `${full}${other ? ` Say "give it to ${other}" to hand it over.` : ''}` };
    case 'unclear': {
      const detail = coding(x) ? null : answerDetail(x, '');
      return { ...base, speech: `${who(x)} stopped on ${what(x, 40)} without a clear finish.`, short: `${who(x)} stopped on ${what(x, 30)}.`, text: full, ...(detail ? { detail } : {}) };
    }
    case 'failed': return { ...base, speech: `${who(x)}'s task ${what(x, 40)} failed.`, short: `${who(x)}'s task ${what(x, 30)} failed.`, text: full };
    default: return { ...base, speech: describeTask(x, now).say, short: `${who(x)}'s task ${what(x, 30)}: ${x.state}.`, text: full };
  }
}

export function createTools({ exec = defaultExec, apps = installedApps, folders = FOLDERS, relay = null, now = Date.now, startWaitMs = 5000 } = {}) {
  const T = {};
  const def = (name, description, params, risk, run, confirmText) => {
    T[name] = { name, description, params, risk, run, confirmText };
  };

  def('open_app', 'Open an app installed on the Mac, by name.', { name: { type: 'string', description: 'app name, e.g. "Steam"' } },
    'safe', async ({ name }) => {
      const app = matchApp(name, apps());
      if (!app) return { ok: false, say: `There's no app called ${name} on this Mac.` };
      const r = await exec('/usr/bin/open', ['-a', app.path]);
      return r.code === 0 ? { ok: true, say: `${app.name} is opening.` } : { ok: false, say: `${app.name} didn't open.` };
    });

  def('quit_app', 'Quit a running app (it may still ask to save).', { name: { type: 'string', description: 'app name' } },
    'confirm', async ({ name }) => {
      const open = await runningApps(exec);
      const app = matchApp(name, open.map((n) => ({ name: n })));
      if (!app) return { ok: false, say: `${name} isn't running.` };
      const r = await exec('/usr/bin/osascript', ['-e', `quit app ${q(app.name)}`]);
      return r.code === 0 ? { ok: true, say: `${app.name} is closing.` } : { ok: false, say: `${app.name} didn't close.` };
    }, ({ name }) => `Quit ${name}?`);

  def('running_apps', 'List the apps that are open right now.', {}, 'safe', async () => {
    const open = await runningApps(exec);
    return { ok: true, say: open.length ? `Open: ${open.join(', ')}.` : 'No apps are open.', data: open };
  });

  def('set_volume', 'Set the Mac output volume, 0 to 100 percent.', { percent: { type: 'number', description: '0-100' } },
    'safe', async ({ percent }) => {
      const p = int(percent, 0, 100);
      const r = await exec('/usr/bin/osascript', ['-e', `set volume output volume ${p}`]);
      return r.code === 0 ? { ok: true, say: `Volume is at ${p}.` } : { ok: false, say: "The volume didn't change." };
    });

  def('change_volume', 'Turn the volume up or down by a step (positive = louder).', { step: { type: 'number', description: 'e.g. 10 or -10' } },
    'safe', async ({ step }) => {
      const s = int(step, -100, 100);
      const cur = await exec('/usr/bin/osascript', ['-e', 'output volume of (get volume settings)']);
      const now = Number(cur.out.trim());
      if (!Number.isFinite(now)) return { ok: false, say: "I couldn't read the volume (the output may not have one)." };
      const p = Math.min(100, Math.max(0, now + s));
      await exec('/usr/bin/osascript', ['-e', `set volume output volume ${p}`]);
      return { ok: true, say: `Volume is at ${p}.` };
    });

  def('mute', 'Mute or unmute the Mac.', { on: { type: 'boolean', description: 'true = mute, false = unmute' } },
    'safe', async ({ on }) => {
      const m = on !== false && on !== 'false';
      await exec('/usr/bin/osascript', ['-e', `set volume output muted ${m}`]);
      return { ok: true, say: m ? 'Muted.' : 'Sound is back on.' };
    });

  def('lock_screen', 'Turn the displays off and lock the Mac (a password is needed to wake it if the Mac asks for one).', {},
    'safe', async () => {
      const r = await exec('/usr/bin/pmset', ['displaysleepnow']);
      return r.code === 0 ? { ok: true, say: 'The screens are off.' } : { ok: false, say: "The screens didn't turn off." };
    });

  def('system_status', "How the Mac is doing: memory, what's using it, CPU load, free disk space, uptime.", {},
    'safe', async () => {
      const [mem, vm, ps, load, dfRoot, dfStorage, up] = await Promise.all([
        exec('/usr/sbin/sysctl', ['-n', 'hw.memsize']), exec('/usr/bin/vm_stat', []),
        exec('/bin/ps', ['-axmo', 'rss=,comm=']), exec('/usr/sbin/sysctl', ['-n', 'vm.loadavg']),
        exec('/bin/df', ['-g', '/']), exec('/bin/df', ['-g', '/Volumes/Storage']), exec('/usr/bin/uptime', []),
      ]);
      const totalGB = Number(mem.out) / 2 ** 30;
      const page = Number(/page size of (\d+)/.exec(vm.out)?.[1] ?? 16384);
      const pages = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(vm.out)?.[1] ?? 0);
      const usedGB = ((pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * page) / 2 ** 30;
      const top = ps.out.trim().split('\n').slice(0, 4).map((l) => {
        const [rss, ...cmd] = l.trim().split(/\s+/);
        return `${basename(cmd.join(' ')).replace(/\.app.*$/, '')} ${(Number(rss) / 2 ** 20).toFixed(1)} GB`;
      });
      const free = (r) => r.out.trim().split('\n')[1]?.split(/\s+/)[3];
      const status = {
        memory: `${usedGB.toFixed(1)} of ${totalGB.toFixed(0)} GB in use`, topMemory: top,
        cpuLoad: load.out.trim().replace(/[{}]/g, '').trim(),
        freeInternalGB: free(dfRoot), freeStorageGB: free(dfStorage),
        uptime: /up (.*?),\s+\d+ user/.exec(up.out)?.[1] ?? up.out.trim(),
      };
      return { ok: true, say: `Memory ${status.memory}; biggest: ${top.slice(0, 2).join(', ')}. Internal disk ${status.freeInternalGB} GB free, Storage ${status.freeStorageGB} GB free.`, data: status };
    });

  def('battery_and_power', 'Power source and battery level.', {}, 'safe', async () => {
    const r = await exec('/usr/bin/pmset', ['-g', 'batt']);
    const pct = /(\d+)%/.exec(r.out)?.[1];
    const src = /'([^']+)'/.exec(r.out)?.[1] ?? 'unknown';
    return { ok: true, say: pct ? `On ${src}, battery at ${pct}%.` : `On ${src} (no battery).` };
  });

  def('find_files', 'Find files by name in the home folder and on the Storage drive (read-only).', { query: { type: 'string', description: 'part of the file name' } },
    'safe', async ({ query }) => {
      const qy = String(query ?? '').trim().slice(0, 80);
      if (qy.length < 2) return { ok: false, say: 'That search is too short.' };
      const r = await exec('/usr/bin/mdfind', ['-onlyin', HOME, '-onlyin', '/Volumes/Storage', '-name', qy], { timeoutMs: 8000 });
      const hits = r.out.split('\n').filter((p) => p && !/\/Library\/|\/\.|node_modules|DerivedData|\.build\//.test(p)).slice(0, 10);
      return { ok: true, say: hits.length ? `Found ${hits.length}: ${hits.map((p) => basename(p)).join(', ')}.` : `Nothing named like "${qy}".`, data: hits };
    });

  def('open_url', 'Open a web link (http or https) in the default browser.', { url: { type: 'string' } },
    'safe', async ({ url }) => {
      const u = String(url ?? '').trim();
      if (!/^https?:\/\/[^\s"']+$/i.test(u)) return { ok: false, say: "That isn't a web link I can open." };
      const r = await exec('/usr/bin/open', [u]);
      return r.code === 0 ? { ok: true, say: 'Opened it in the browser.' } : { ok: false, say: "The link didn't open." };
    });

  def('open_folder', `Open a folder in Finder: ${Object.keys(FOLDERS).join(', ')}.`, { place: { type: 'string', description: Object.keys(FOLDERS).join(' | ') } },
    'safe', async ({ place }) => {
      const key = norm(place);
      const path = folders[key] ?? Object.entries(folders).find(([k]) => k.startsWith(key))?.[1];
      if (!path || !existsSync(path)) return { ok: false, say: `I don't know a folder called ${place}.` };
      await exec('/usr/bin/open', [path]);
      return { ok: true, say: `${basename(path)} is open in Finder.` };
    });

  def('start_game_mode', 'Start game mode (Console Mode: Steam Big Picture on the TV screen).', {}, 'safe', async () => {
    const r = await exec('/usr/bin/open', ['-a', 'Console Mode']);
    return r.code === 0 ? { ok: true, say: 'Game mode is starting.' } : { ok: false, say: "Game mode didn't start." };
  });

  def('list_shortcuts', "List the owner's macOS Shortcuts.", {}, 'safe', async () => {
    const r = await exec('/usr/bin/shortcuts', ['list']);
    const names = r.out.split('\n').map((s) => s.trim()).filter(Boolean);
    return { ok: true, say: names.length ? `Shortcuts: ${names.slice(0, 20).join(', ')}.` : 'There are no Shortcuts yet.', data: names };
  });

  def('run_shortcut', "Run one of the owner's macOS Shortcuts by name.", { name: { type: 'string' } },
    'confirm', async ({ name }) => {
      const list = (await exec('/usr/bin/shortcuts', ['list'])).out.split('\n').map((s) => s.trim()).filter(Boolean);
      const hit = list.find((s) => norm(s) === norm(name)) ?? list.find((s) => norm(s).includes(norm(name)));
      if (!hit) return { ok: false, say: `There's no Shortcut called ${name}.` };
      const r = await exec('/usr/bin/shortcuts', ['run', hit], { timeoutMs: 30_000 });
      return r.code === 0 ? { ok: true, say: `${hit} ran.` } : { ok: false, say: `${hit} didn't finish.` };
    }, ({ name }) => `Run your ${name} Shortcut?`);

  // ---- D-129: the helpers (Claude Code, Codex, ChatGPT chat) through the relay.
  // Live test 2026-10-01 (docs/relay/LIVE_TEST_2026-10-01.md): every helper fact Tamago repeats comes from these
  // tools, in these words; the hands speak them as-is (agent.js), so nothing is invented on the way.
  if (relay) {
    const settle = async (t) => (relay.settle && t?.id ? (await relay.settle(t.id, startWaitMs)) ?? t : t);
    const otherCoder = (a) => (a === 'claude' ? 'codex' : a === 'codex' ? 'claude' : null);
    /**
     * R11: when a helper is known to be out (its own usage report, or it just handed this very task over because it
     * ran out): the ISO time it comes back, '' when unknown, null when it isn't known to be out.
     */
    const outOf = (agent, s) => {
      const u = relay.usage?.() ?? {};
      const back = outUntil(agent === 'claude' ? u.claude : u.codex, now());
      if (back) return back;
      const from = s.handoffFrom ? relay.tasks(50).find((x) => x.id === s.handoffFrom) : null;
      if (from?.agent === agent && from.state === 'limited' && !(from.resetsAt && Date.parse(from.resetsAt) <= now())) return from.resetsAt ?? '';
      return null;
    };
    /** K2: what to say about a run a few seconds in; an early limit/failure offers the other coding helper. */
    const started = (s, lead) => {
      if (!s || s.state === 'running') return { ok: true, say: lead };
      relay.markAnnounced?.([s.id]);
      const other = otherCoder(s.agent);
      if (s.state === 'limited' || s.state === 'failed') {
        const back = s.agent === 'claude' ? outUntil(relay.usage?.()?.claude, now()) : null;   // F11: the reset time is kept
        const until = untilOf(s, now()) || (back ? ` until ${when(back, now())}` : '');
        // R3: one sentence of the reason, so the offer that "yes" answers is never pushed out of the spoken reply.
        const reason = endSentence(cutWords(splitSentences(s.result ?? '')[0] || 'no reason given', 80));
        const why = s.state === 'limited' ? `${who(s)} is out of usage${until}, so it didn't start.` : `${who(s)} stopped right away: ${reason}`;
        const otherBack = other ? outOf(other, s) : null;
        if (other && otherBack !== null) {
          return { ok: false, say: `${why} ${AGENT_NAMES[other]} is out too${otherBack ? ` until ${when(otherBack, now())}` : ''}.` };
        }
        return other ? { ok: false, say: `${why} Give it to ${AGENT_NAMES[other]}?`, propose: { tool: 'relay_handoff', args: { agent: other, id: s.id } } } : { ok: false, say: why };
      }
      const d = describeTask(s, now());
      const detail = s.readOnly ? answerDetail(s, d.say) : null;   // R5: ChatGPT finished within the wait
      return { ok: true, ...d, ...(detail ? { detail } : {}) };
    };
    const target = (agent) => relay.tasks(50).filter((x) => ACTIVE.includes(x.state) && !x.handedTo && (!agent || x.agent === agent)).at(-1);

    def('helpers_usage', 'Can Tamago reach Claude, Codex and ChatGPT, and how much of their usage is left. Only when the owner asks.', {}, 'safe', async () => {
      const u = relay.usage();
      const say = `I can hand work to Claude and Codex, and ask ChatGPT. ${describeUsage('Claude', u.claude, now())} ${describeUsage('Codex (and ChatGPT)', u.codex, now())}`;
      return { ok: true, say, data: u };
    });
    def('relay_start', `Give a NEW task to a helper: claude or codex change code, chatgpt only answers. Projects: ${relay.projects().join(', ')}.`,
      { agent: { type: 'string', description: 'claude | codex | chatgpt' }, project: { type: 'string', description: relay.projects().join(' | ') },
        task: { type: 'string', description: "the owner's request, in their words" },
        question_only: { type: 'boolean', description: 'true when the owner only wants an answer, no changes' } },
      'confirm', async ({ agent, project, task, question_only }) => {
        const a = normalizeAgent(agent, 'claude');
        try {
          const t = relay.start({ agent: a, project, text: String(task ?? '').slice(0, 500), readOnly: question_only === true || question_only === 'true' });
          return started(await settle(t), `${AGENT_NAMES[a] ?? a} is on it${t.branch ? `, on its own branch of ${t.project}` : ''}. Ask me how it's going anytime.`);
        } catch (err) { return { ok: false, say: err.message }; }
      }, ({ agent, project, task }) => `${AGENT_NAMES[normalizeAgent(agent, 'claude')]}, ${project}: ${clause(task, 80)}.`);
    def('relay_status', "What the helpers are doing: every running or waiting task, then the ones finished in the last 12 hours.",
      { agent: { type: 'string', description: 'claude | codex | chatgpt, or empty for all', optional: true },
        include_older: { type: 'boolean', description: 'true only when the owner asks about older tasks', optional: true } },
      'safe', async ({ agent, include_older } = {}) => {
        const a = normalizeAgent(agent);
        const all = relay.tasks(50).filter((x) => !x.handedTo && (!a || x.agent === a));
        // N4/F10/F13: every waiting or running task (any age) first, then recent finished ones, newest first.
        const active = all.filter((x) => ACTIVE.includes(x.state)).sort((x, y) => (x.state === 'question' ? 0 : 1) - (y.state === 'question' ? 0 : 1));
        const recent = all.filter((x) => FINISHED.includes(x.state) && (include_older === true || now() - Date.parse(x.updatedAt ?? x.startedAt) < RECENT_MS)).reverse().slice(0, 3);
        const shown = [...active, ...recent];
        if (!shown.length) return { ok: true, say: all.length ? `Nothing from ${a ? AGENT_NAMES[a] : 'the helpers'} in the last 12 hours.` : 'No helper tasks yet.' };
        relay.markAnnounced?.(shown.map((x) => x.id));
        const d = shown.map((x) => describeTask(x, now()));
        // G7: the model gets Tamago's own words and ids only, never a helper's answer, question text or run command
        // as data (a helper's output must not be able to steer Tamago's next tool call).
        return { ok: true, say: d.map((x) => x.say).join(' '), screen: d.map((x) => x.screen).join('\n'),
          data: shown.map((x) => ({ id: x.id, agent: x.agent, state: x.state })) };
      });
    // K6/N9: "What did ChatGPT say?" started a new task (reworded as "What did you say…"); it reads the answer now.
    def('relay_result', "Read back what a helper answered or built (its latest finished task). The gist is spoken; the full answer goes to the phone.",
      { agent: { type: 'string', description: 'claude | codex | chatgpt', optional: true } }, 'safe', async ({ agent } = {}) => {
        const a = normalizeAgent(agent);
        const x = relay.tasks(50).filter((t) => FINISHED.includes(t.state) && !t.handedTo && (!a || t.agent === a)).at(-1);
        if (!x) return { ok: false, say: a ? `${AGENT_NAMES[a]} hasn't finished anything yet.` : 'No helper has finished anything yet.' };
        relay.markAnnounced?.([x.id]);
        const d = describeTask(x, now());
        // R4: a long answer for the phone only when there is one (done/unclear, longer than what is spoken); a limited
        // or failed run's last words are never presented as its answer, and a removed worktree is never a folder.
        const real = ['done', 'unclear'].includes(x.state) && x.answer && x.answer.length > d.say.length + 20;
        const head = coding(x)
          ? [`${who(x)}: "${x.text}"`, endSentence(x.result ?? ''), x.branch && (x.commits > 0 || x.committed) ? `Committed on branch ${x.branch}.` : null,
            x.cwd && !x.removed ? `Folder: ${x.cwd}` : null, x.run && !x.removed ? `Run it: cd ${x.cwd} && ${x.run}` : null].filter(Boolean).join('\n')
          : `${who(x)}'s answer to "${x.text}":`;
        return { ok: true, say: d.say, screen: d.screen, ...(real ? { detail: `${head}\n\n${x.answer}` } : {}), data: { id: x.id, state: x.state } };
      });
    // K3/N6: "give it to Codex instead" sent Codex only those words. It now carries the original request.
    // SM5: the task named in the confirmation is the task handed over (`id`, filled in when the yes is held).
    def('relay_handoff', 'Hand the latest unfinished helper task (out of usage, failed, stopped, unclear or waiting) to another helper, with the original request and what was done so far.',
      { agent: { type: 'string', description: 'claude | codex (chatgpt only for question tasks)' },
        id: { type: 'string', description: 'the task id, when known', optional: true } }, 'confirm', async ({ agent, id }) => {
        try {
          const { task, from } = await relay.handoff({ agent: normalizeAgent(agent, String(agent ?? '')), id: id ?? null });
          return started(await settle(task), `${AGENT_NAMES[task.agent]} has ${who(from)}'s task ${what(from, 50)} now${task.branch && task.branch === from.branch ? `, on the same branch` : ''}.`);
        } catch (err) { return { ok: false, say: err.message }; }
      }, ({ agent, id }) => {
        const prev = id ? relay.tasks(50).find((x) => x.id === id) : relay.handable?.({ to: normalizeAgent(agent) });
        const to = AGENT_NAMES[normalizeAgent(agent)] ?? agent;
        return prev ? `Give ${who(prev)}'s task ${what(prev, 80)} to ${to}?` : `Hand the last task to ${to}?`;
      });
    def('relay_answer', "Pass the owner's answer to the helper that asked a question.",
      { answer: { type: 'string' }, agent: { type: 'string', description: 'the helper that asked, if several are waiting', optional: true } }, 'safe', async ({ answer, agent }) => {
        try { const t = relay.answer(String(answer ?? ''), { agent: normalizeAgent(agent) }); return { ok: true, say: `Told ${AGENT_NAMES[t.agent]}: ${answer}.` }; }
        catch (err) { return { ok: false, say: err.message }; }
      });
    // F6: "Stop Claude" stopped the newest task, whichever helper had it.
    def('relay_stop', "Stop a helper's running or waiting task.", { agent: { type: 'string', description: 'claude | codex | chatgpt', optional: true } }, 'confirm', async ({ agent } = {}) => {
      const t = relay.stop({ agent: normalizeAgent(agent) });
      return t ? { ok: true, say: `Stopped ${who(t)}'s task ${what(t)}.` } : { ok: false, say: `${normalizeAgent(agent) ? AGENT_NAMES[normalizeAgent(agent)] : 'No helper'} has nothing running.` };
    }, ({ agent } = {}) => {
      const t = target(normalizeAgent(agent));
      return t ? `Stop ${who(t)}'s task ${what(t)}?` : `Stop ${AGENT_NAMES[normalizeAgent(agent)] ?? 'the helper'}'s task?`;
    });
  }

  return T;
}

/** Ollama's tool format. */
export function toolSchemas(tools) {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name, description: t.description + (t.risk === 'confirm' ? ' (Tamago asks the owner first.)' : ''),
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.params).map(([k, { optional, ...p }]) => [k, p])),
        required: Object.keys(t.params).filter((k) => !t.params[k].optional),
      },
    },
  }));
}
