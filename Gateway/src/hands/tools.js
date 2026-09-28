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

export function createTools({ exec = defaultExec, apps = installedApps, folders = FOLDERS } = {}) {
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

  return T;
}

/** Ollama's tool format. */
export function toolSchemas(tools) {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name, description: t.description + (t.risk === 'confirm' ? ' (Tamago asks the owner first.)' : ''),
      parameters: { type: 'object', properties: t.params, required: Object.keys(t.params) },
    },
  }));
}
