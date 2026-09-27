#!/usr/bin/env node
// tamago brain <chat|inspect|memories|forget|status|reset>
// Talks to the brain directly (no Watch, no HTTP). Same database and reasoner
// configuration as the gateway's TAMAGO_PROVIDER=brain.

// node:sqlite is marked experimental on some Node versions; keep the CLI quiet.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w.message);
});

const { createBrain } = await import('../src/brain/orchestrator.js');
const { brainOptionsFromEnv } = await import('../src/brain/index.js');
const { rmSync, existsSync } = await import('node:fs');
const readline = await import('node:readline/promises');

const [, , area, cmd, ...args] = process.argv;
const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const USAGE = `usage: tamago brain <chat | inspect [--json] | memories [--all] | forget <id> | status | reset --yes>

env: TAMAGO_REASONER=ollama|deterministic  OLLAMA_URL  OLLAMA_MODEL | TAMAGO_FAST_MODEL  TAMAGO_SMART_MODEL
     TAMAGO_BRAIN_DB (default: <TAMAGO_STATE_DIR or ~/Library/Application Support/TamagoAI>/brain.sqlite)`;

if (area !== 'brain' || !cmd) {
  console.log(USAGE);
  process.exit(area ? 1 : 0);
}

let opts;
try {
  opts = brainOptionsFromEnv();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (cmd === 'reset') {
  if (!args.includes('--yes')) {
    console.error(`This deletes everything Tamago remembers (${opts.dbPath}). Re-run with --yes.`);
    process.exit(1);
  }
  for (const f of [opts.dbPath, `${opts.dbPath}-wal`, `${opts.dbPath}-shm`]) if (existsSync(f)) rmSync(f);
  console.log('Tamago brain reset.');
  process.exit(0);
}

const brain = await createBrain(opts);

function say(intent) {
  if (intent.speech !== null) return intent.speech;
  return `[nonverbal: ${intent.emotion} · ${intent.sound} · ${intent.behavior}${intent.haptic !== 'none' ? ` · haptic ${intent.haptic}` : ''}]`;
}

function printTrace(t) {
  if (!t) return console.log('No interactions yet.');
  const cls = t.steps.find((s) => s.name === 'classify');
  const ret = t.steps.find((s) => s.name === 'retrieve');
  const ses = t.steps.find((s) => s.name === 'session');
  const ctx = t.steps.find((s) => s.name === 'context');
  const gate = t.steps.find((s) => s.name === 'memory_gate');
  const out = [
    `INPUT        ${t.input}   ${dim(`(${t.at}, ${t.totalMs} ms)`)}`,
    `CLASSIFY     ${cls.kind}${cls.complexity === 'complex' ? ' (complex)' : ''}${cls.noStore ? ' · off the record' : ''} · keywords [${cls.keywords.join(', ')}]`,
    `ROUTE        ${t.route} → ${t.reasoner}`,
    `SESSION      ${ses.id.slice(0, 8)}${ses.newSession ? ' (new)' : ''} · ${ses.turnsInContext} recent turns in context`,
    `MEMORY IN    ${ret.memories.length ? '' : '(none)'}${ret.focusKeywords.length ? dim(`topic carried from earlier: ${ret.focusKeywords.join(', ')}`) : ''}`,
    ...ret.memories.map((m) => `             #${m.id} ${m.text} ${dim(`score ${m.score}`)}`),
    `RELATIONSHIP ${t.relationshipAfter.stage} · credits ${t.relationshipAfter.credits} · known ${t.relationshipAfter.daysKnown} days · ${t.relationshipAfter.meaningfulInteractions} interactions`,
    `WORLD        ${JSON.stringify(t.steps.find((s) => s.name === 'state').world)}`,
    ...(ctx ? [`CONTEXT      ${ctx.chars} chars · ${ctx.memories} memories · ${ctx.turns} turns`, dim(ctx.prompt.replace(/^/gm, '             '))] : []),
    `INTENT       ${JSON.stringify(t.intent, null, 2).replace(/\n/g, '\n             ')}`,
    `MEMORY GATE  ${gate.decisions.length ? '' : '(no candidates)'}`,
    ...gate.decisions.map((d) => `             ${d.decision.toUpperCase()} "${d.text}" ${dim(`(${d.source}: ${d.reason})`)}`),
    `MEMORY OPS   ${t.memoryOps.length ? t.memoryOps.map((o) => `${o.op}: ${o.text}`).join('; ') : '(none)'}`,
    `WATCH (V1)   ${JSON.stringify(t.v1)}`,
  ];
  console.log(out.join('\n'));
}

try {
  if (cmd === 'chat') {
    console.log(dim(`Tamago brain · reasoner ${brain.reasoner.name} · ${opts.dbPath}\n/inspect shows the last decision, /quit exits.\n`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'You > ' });
    rl.prompt();
    for await (const raw of rl) {
      const line = raw.trim();
      if (!process.stdin.isTTY) console.log(line);   // echo piped input so transcripts read naturally
      if (line === '/quit' || line === '/exit') break;
      if (line === '/inspect') printTrace(brain.lastTrace());
      else if (line) {
        try {
          const { intent, trace } = await brain.handle(line, { client: { device: 'cli' } });
          console.log(`Tamago > ${say(intent)}  ${dim(`(${trace.route}${trace.reasoner !== 'rule' ? ` · ${trace.reasoner}` : ''})`)}`);
        } catch (err) {
          console.log(`Tamago > ${dim(`[error: ${err.code ?? ''} ${err.message}]`)}`);
        }
      }
      rl.prompt();
    }
    rl.close();
  } else if (cmd === 'inspect') {
    const t = brain.lastTrace();
    if (args.includes('--json')) console.log(JSON.stringify(t, null, 2));
    else printTrace(t);
  } else if (cmd === 'memories') {
    const rows = brain.memories({ includeSuperseded: args.includes('--all') });
    if (!rows.length) console.log('Tamago remembers nothing yet.');
    for (const m of rows) {
      console.log(`#${m.id} [${m.type}] ${m.text} ${dim(`strength ${m.strength} · ${m.source}${m.superseded_by ? ` · superseded by #${m.superseded_by}` : ''}`)}`);
    }
  } else if (cmd === 'forget') {
    const id = Number(args[0]);
    if (!Number.isInteger(id)) throw new Error('usage: tamago brain forget <id>');
    console.log(brain.forget(id) ? `Forgot #${id}.` : `No memory #${id}.`);
  } else if (cmd === 'status') {
    const r = brain.relationship();
    console.log(`db ${opts.dbPath}\nreasoner ${brain.reasoner.name}${brain.reasoner.models ? ` ${JSON.stringify(brain.reasoner.models)}` : ''}` +
      `\nrelationship ${r.stage} (credits ${r.credits}, known ${r.daysKnown} days)\nmemories ${brain.memories().length}`);
  } else {
    console.log(USAGE);
    process.exitCode = 1;
  }
} finally {
  brain.close();
}
