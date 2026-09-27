#!/usr/bin/env node
// Voice samples for the owner to choose Tamago's voice by ear (D-121,
// docs/VOICE_RESEARCH.md). Renders the same six lines with every installed
// candidate voice at two speeds, through the exact helper the gateway uses,
// and measures synthesis time and file size for each clip. Then it writes a
// local listening page. Zero dependencies; nothing leaves the Mac.
//
//   TAMAGO_TTS_MODEL_DIR=/Volumes/Storage/AI/tts node scripts/voice-samples.js
//   open /Volumes/Storage/AI/tts/samples/index.html
//
// Options: --out <dir> (default $TAMAGO_TTS_MODEL_DIR/samples), --no-say (skip Apple voices).
// Each clip is one fresh helper process, so every time includes loading the model
// (the same cost the gateway pays per reply today).

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createSynthesizer, DEFAULT_TTS_COMMAND, EXCLUDED_VOICES } from '../src/tts.js';

export const LINES = [
  'Hi.',
  'Pixel.',
  "I can't check that yet.",
  'Some sea slugs can photosynthesize like plants.',
  'Your favorite color is orange.',
  "I didn't catch that.",
];
export const SPEEDS = [1.0, 0.9];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const modelDir = process.env.TAMAGO_TTS_MODEL_DIR;
const command = process.env.TAMAGO_TTS_COMMAND ?? DEFAULT_TTS_COMMAND;
const outDir = option('--out') ?? (modelDir ? join(modelDir, 'samples') : undefined);
if (!outDir) {
  console.error('Set TAMAGO_TTS_MODEL_DIR (owner: /Volumes/Storage/AI/tts) or pass --out <dir>. Samples never go in the repo.');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const voices = readFileSync(join(here, '..', 'tools', 'tts', 'voices.tsv'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l) => {
    const [engine, voice, , label, notes] = l.split('\t');
    return { engine, voice, label, notes: notes ?? '' };
  })
  .filter((v) => !EXCLUDED_VOICES.has(v.voice));

// Apple Premium/Enhanced English voices, if the owner downloaded any (personal-use baseline).
if (!flag('--no-say') && process.platform === 'darwin') {
  try {
    const { stdout } = await promisify(execFile)('/usr/bin/say', ['-v', '?']);
    for (const line of stdout.split('\n')) {
      const m = line.match(/^(.+?\((?:Premium|Enhanced)\))\s+(en_[A-Z]{2})/);
      if (m) voices.push({ engine: 'say', voice: m[1].trim(), label: `Apple ${m[1].trim()} (${m[2]})`, notes: 'baseline · personal use only' });
    }
  } catch { /* no say: skip */ }
}

const safe = (s) => s.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const results = [];
for (const v of voices) {
  const probe = createSynthesizer({ command, engine: v.engine, voice: v.voice, modelDir });
  const ready = await probe.check();
  if (!ready.ok) {
    console.log(`skip ${v.engine}/${v.voice}: not installed`);
    continue;
  }
  for (const speed of SPEEDS) {
    const synth = createSynthesizer({ command, engine: v.engine, voice: v.voice, speed, modelDir, timeoutMs: 30_000 });
    for (const [i, line] of LINES.entries()) {
      const file = `${safe(v.engine)}_${safe(v.voice)}_${speed.toFixed(1)}_${i + 1}.m4a`;
      const started = process.hrtime.bigint();
      try {
        const audio = await synth.synthesize(line);
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        writeFileSync(join(outDir, file), audio);
        results.push({ ...v, speed, line, file, ms: Math.round(ms), bytes: audio.length });
        console.log(`${v.engine}/${v.voice} ×${speed.toFixed(1)} #${i + 1}: ${Math.round(ms)} ms, ${audio.length} bytes`);
      } catch (err) {
        results.push({ ...v, speed, line, file: null, error: err.message });
        console.log(`${v.engine}/${v.voice} ×${speed.toFixed(1)} #${i + 1}: FAILED ${err.message}`);
      }
    }
  }
}

writeFileSync(join(outDir, 'results.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
writeFileSync(join(outDir, 'index.html'), renderPage(results));
console.log(`\n${results.filter((r) => r.file).length} clips → ${join(outDir, 'index.html')}`);
if (!results.length) console.log('No voices installed. Run tools/tts/setup.sh first.');

function renderPage(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.engine}|${r.voice}|${r.speed}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const cards = [...groups.values()].map((g) => {
    const v = g[0];
    const ok = g.filter((r) => r.file);
    const env = v.engine === 'say' ? `TAMAGO_TTS=say TAMAGO_TTS_VOICE="${v.voice}"` : `TAMAGO_TTS=${v.engine} TAMAGO_TTS_VOICE=${v.voice}`;
    const choice = `${env} TAMAGO_TTS_SPEED=${v.speed.toFixed(1)}`;
    return `<section class="card">
  <header><h2>${esc(v.label)} <span class="speed">×${v.speed.toFixed(1)}</span></h2>
  <p class="meta">${esc(v.engine)} · ${esc(v.voice)} · ${esc(v.notes)}${ok.length ? ` · median ${median(ok.map((r) => r.ms))} ms, ${Math.round(median(ok.map((r) => r.bytes)) / 1024)} KB` : ''}</p></header>
  <ol>${g.map((r) => `<li><span class="line">${esc(r.line)}</span>${r.file ? `<audio controls preload="none" src="${esc(r.file)}"></audio><span class="num">${r.ms} ms · ${Math.round(r.bytes / 102.4) / 10} KB</span>` : `<span class="err">failed</span>`}</li>`).join('')}</ol>
  <button type="button" data-choice="${esc(choice)}">Choose this one</button>
</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tamago voice samples</title>
<style>
:root { --bg:#fbfaf7; --fg:#1d1d1f; --muted:#6e6e73; --card:#fff; --line:#e5e3dd; --accent:#0a7c86; }
@media (prefers-color-scheme: dark) { :root { --bg:#111; --fg:#f2f2f2; --muted:#a1a1a6; --card:#1c1c1e; --line:#2c2c2e; --accent:#5ac8d8; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.45 -apple-system, system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 96px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; } h2 { font-size: 1.05rem; margin: 0; }
.intro, .meta, .num { color: var(--muted); } .meta { margin: 4px 0 8px; font-size: .9rem; }
.grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-top: 20px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
.speed { color: var(--accent); font-weight: 600; }
ol { padding-left: 20px; margin: 0 0 12px; } li { margin-bottom: 10px; }
.line { display:block; } audio { width: 100%; height: 32px; } .num { font-size: .8rem; } .err { color: #c0392b; }
button { font: inherit; border: 1px solid var(--accent); color: var(--accent); background: none; border-radius: 999px; padding: 6px 14px; cursor: pointer; }
button[aria-pressed="true"] { background: var(--accent); color: var(--bg); }
#pick { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card); border-top: 1px solid var(--line); padding: 12px 16px; font-size: .9rem; }
code { overflow-wrap: anywhere; }
</style></head>
<body><main>
<h1>Tamago voice samples</h1>
<p class="intro">Listen with the Watch's speaker in mind: short, warm, calm. Every clip was made on this Mac by the same helper the gateway uses, with stock voices only (no cloning, no voices named after other products). Times include loading the model for each clip. Nothing here is uploaded anywhere.</p>
<div class="grid">
${cards || '<p>No voices installed. Run <code>Gateway/tools/tts/setup.sh</code>.</p>'}
</div>
</main>
<div id="pick">Your choice: <code id="choice">none yet</code>. Tell your agent this line.</div>
<script>
document.querySelectorAll('button[data-choice]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('button[data-choice]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
  document.getElementById('choice').textContent = b.dataset.choice;
}));
</script>
</body></html>
`;
}
