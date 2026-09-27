// PROTOCOL_V1 §16 / D-121: natural voice from the Mac. Stub synthesizer for the
// gateway; fake engine binaries for the helper script. A real engine runs only
// where setup.sh installed one (TAMAGO_TTS_MODEL_DIR + macOS afconvert).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway, post, textRequest, TOKEN, ID } from './helpers.js';
import {
  createSynthesizer, createSynthesizerFromEnv, prepareSpeechText, DEFAULT_TTS_COMMAND, EXCLUDED_VOICES,
} from '../src/tts.js';
import { validateResponse } from '../src/protocol.js';

const AUDIO = Buffer.from('fake aac bytes for tamago');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stubSynth({ delayMs = 0, fail = false, audio = AUDIO } = {}) {
  const calls = [];
  return {
    calls,
    synthesizer: {
      name: 'kokoro', engine: 'kokoro', voice: 'af_heart',
      async synthesize(text, { signal } = {}) {
        calls.push(text);
        await sleep(delayMs);
        if (signal?.aborted) throw new Error('aborted');
        if (fail) throw Object.assign(new Error('engine exploded'), { code: 'tts_failed' });
        return audio;
      },
      async check() { return { ok: true }; },
    },
  };
}

function getSpeech(base, path, { token = TOKEN } = {}) {
  return fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => ({
    status: r.status,
    type: r.headers.get('content-type'),
    length: r.headers.get('content-length'),
    buf: Buffer.from(await r.arrayBuffer()),
  }));
}

test('speech: speechAudio appears only when a synthesizer is configured; protocol advertises it', async () => {
  const plain = await startGateway();
  try {
    const r = await post(plain.base, textRequest('ping', ID(1)));
    assert.equal(r.body.speechAudio, undefined);
    assert.deepEqual((await (await fetch(`${plain.base}/v1/protocol`)).json()).outputTypes, ['text']);
  } finally {
    await plain.close();
  }
  const { synthesizer } = stubSynth();
  const gw = await startGateway({ synthesizer });
  try {
    const r = await post(gw.base, textRequest('ping', ID(2)));
    assert.equal(r.status, 200);
    assert.deepEqual(validateResponse(r.body), []);
    assert.deepEqual(r.body.speechAudio, { path: `/v1/speech/${ID(2)}`, format: 'audio/mp4', voice: 'af_heart' });
    assert.equal(r.body.speechText, 'pong', 'the text reply is unchanged');
    assert.deepEqual((await (await fetch(`${gw.base}/v1/protocol`)).json()).outputTypes, ['text', 'speech-audio']);
  } finally {
    await gw.close();
  }
});

test('speech: a slow synthesis never delays the text reply; the fetch waits for it', async () => {
  const { synthesizer } = stubSynth({ delayMs: 800 });
  const gw = await startGateway({ synthesizer });
  try {
    const t0 = Date.now();
    const r = await post(gw.base, textRequest('ping', ID(3)));
    assert.ok(Date.now() - t0 < 400, `text reply took ${Date.now() - t0} ms`);
    const a = await getSpeech(gw.base, r.body.speechAudio.path);
    assert.equal(a.status, 200);
    assert.equal(a.type, 'audio/mp4');
    assert.equal(Number(a.length), AUDIO.length);
    assert.deepEqual(a.buf, AUDIO);
  } finally {
    await gw.close();
  }
});

test('speech: served once, then 404; expires after its TTL', async () => {
  let t = Date.now();
  const now = () => t;
  const { synthesizer } = stubSynth();
  const gw = await startGateway({ synthesizer, now });
  try {
    const r = await post(gw.base, textRequest('ping', ID(4)));
    await sleep(20);
    assert.equal((await getSpeech(gw.base, r.body.speechAudio.path)).status, 200);
    const again = await getSpeech(gw.base, r.body.speechAudio.path);
    assert.equal(again.status, 404);
    assert.equal(JSON.parse(again.buf).error.code, 'not_found');

    const r2 = await post(gw.base, textRequest('ping', ID(5)));
    await sleep(20);
    t += 3 * 60 * 1000;
    assert.equal((await getSpeech(gw.base, r2.body.speechAudio.path)).status, 404, 'expired after 2 min');
  } finally {
    await gw.close();
  }
});

test('speech: auth required; only request UUIDs are accepted as paths', async () => {
  const { synthesizer } = stubSynth();
  const gw = await startGateway({ synthesizer });
  try {
    await post(gw.base, textRequest('ping', ID(6)));
    assert.equal((await getSpeech(gw.base, `/v1/speech/${ID(6)}`, { token: null })).status, 401);
    assert.equal((await getSpeech(gw.base, `/v1/speech/${ID(6)}`, { token: 'wrong' })).status, 401);
    const bad = await getSpeech(gw.base, '/v1/speech/not-a-uuid');
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.buf).error.code, 'invalid_request');
    assert.equal((await getSpeech(gw.base, '/v1/speech/%2e%2e%2fgateway.json')).status, 400);
    assert.equal((await fetch(`${gw.base}/v1/speech/${ID(6)}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status, 405);
    assert.equal((await getSpeech(gw.base, `/v1/speech/${ID(6).toUpperCase()}`)).status, 200, 'IDs compare case-insensitively');
  } finally {
    await gw.close();
  }
});

test('speech: synthesis failure → 503 envelope for the audio, text reply unaffected', async () => {
  const { synthesizer } = stubSynth({ fail: true });
  const gw = await startGateway({ synthesizer });
  try {
    const r = await post(gw.base, textRequest('ping', ID(7)));
    assert.equal(r.status, 200);
    assert.equal(r.body.text, 'pong');
    const a = await getSpeech(gw.base, r.body.speechAudio.path);
    assert.equal(a.status, 503);
    const env = JSON.parse(a.buf);
    assert.equal(env.error.code, 'provider_unavailable');
    assert.equal(env.requestId, ID(7));
  } finally {
    await gw.close();
  }
});

test('speech: not ready within the wait budget → 503 (the Watch falls back to its own voice)', async () => {
  const { synthesizer } = stubSynth({ delayMs: 1000 });
  const gw = await startGateway({ synthesizer, speechWaitMs: 100 });
  try {
    const r = await post(gw.base, textRequest('ping', ID(8)));
    const t0 = Date.now();
    const a = await getSpeech(gw.base, r.body.speechAudio.path);
    assert.equal(a.status, 503);
    assert.ok(Date.now() - t0 < 700, 'the fetch gave up at the budget');
  } finally {
    await gw.close();
  }
});

test('speech: nonverbal and error replies carry no speechAudio; nothing is synthesized for them', async () => {
  const stub = stubSynth();
  const gw = await startGateway({ synthesizer: stub.synthesizer });
  try {
    const nv = await post(gw.base, textRequest('nonverbal', ID(9)));
    assert.equal(nv.body.speechAudio, undefined);
    const err = await post(gw.base, textRequest('state error', ID(10)));
    assert.equal(err.body.status, 'error');
    assert.equal(err.body.speechAudio, undefined);
    assert.equal(stub.calls.length, 0);
  } finally {
    await gw.close();
  }
});

test('speech: a retried requestId synthesizes once and returns the same speechAudio', async () => {
  const stub = stubSynth({ delayMs: 50 });
  const gw = await startGateway({ synthesizer: stub.synthesizer });
  try {
    const [a, b] = await Promise.all([post(gw.base, textRequest('ping', ID(11))), post(gw.base, textRequest('ping', ID(11)))]);
    assert.deepEqual(a.body, b.body);
    await sleep(80);
    assert.equal(stub.calls.length, 1);
  } finally {
    await gw.close();
  }
});

test('speech: hold-to-talk replies (/v1/audio) get speechAudio too, including "I didn\'t catch that."', async () => {
  const stub = stubSynth();
  const transcriber = (text) => ({ name: 'stub', transcribe: async () => text });
  const postAudio = (base, id) => fetch(`${base}/v1/audio`, {
    method: 'POST', body: Buffer.from('fake m4a'),
    headers: { 'content-type': 'audio/mp4', 'x-tamago-request-id': id, authorization: `Bearer ${TOKEN}` },
  }).then((r) => r.json());
  const gw = await startGateway({ synthesizer: stub.synthesizer, transcriber: transcriber('ping') });
  try {
    const r = await postAudio(gw.base, ID(12));
    assert.equal(r.transcript, 'ping');
    assert.equal(r.speechAudio.path, `/v1/speech/${ID(12)}`);
  } finally {
    await gw.close();
  }
  const quiet = await startGateway({ synthesizer: stub.synthesizer, transcriber: transcriber('') });
  try {
    const r = await postAudio(quiet.base, ID(13));
    assert.equal(r.speechText, "I didn't catch that.");
    assert.equal(r.speechAudio.path, `/v1/speech/${ID(13)}`);
  } finally {
    await quiet.close();
  }
});

test('speech: logs carry request IDs, sizes and timings, never the words', async () => {
  const lines = [];
  const logger = { info: (o) => lines.push(o), warn: (o) => lines.push(o), error: (o) => lines.push(o) };
  const { synthesizer } = stubSynth();
  const gw = await startGateway({ synthesizer, logger });
  try {
    const r = await post(gw.base, textRequest('ping', ID(14)));
    await sleep(20);
    await getSpeech(gw.base, r.body.speechAudio.path);
  } finally {
    await gw.close();
  }
  const all = JSON.stringify(lines);
  assert.match(all, /speech_synth/);
  assert.match(all, new RegExp(ID(14)));
  assert.doesNotMatch(all, /pong|ping/, 'no reply or request text in logs');
});

// ---------------------------------------------------------------- tts.js

test('prepareSpeechText: spoken, clean, capped', () => {
  assert.equal(prepareSpeechText('It is **24°C** and 60% humid 🌤️'), 'It is 24 degrees Celsius and 60 percent humid');
  assert.equal(prepareSpeechText('See https://example.com, e.g. the docs.'), 'See a link, for example the docs.');
  assert.equal(prepareSpeechText('`code` & [link](http://x)'), 'code and link');
  assert.equal(prepareSpeechText('🐙🐙'), '');
  assert.equal(prepareSpeechText(''), '');
  const long = `${'Octopuses have three hearts. '.repeat(20)}`;
  const capped = prepareSpeechText(long, 100);
  assert.ok(capped.length <= 100);
  assert.match(capped, /hearts\.$/);
});

test('createSynthesizer: text travels in a private temp file, never argv; temp dir removed', async () => {
  let seen;
  const execFileImpl = (cmd, args, opts, cb) => {
    const textFile = args[args.indexOf('--text-file') + 1];
    const out = args[args.indexOf('--out') + 1];
    seen = { cmd, args, text: readFileSync(textFile, 'utf8'), textFile, modelDir: opts.env.TAMAGO_TTS_MODEL_DIR, timeout: opts.timeout };
    writeFileSync(out, AUDIO);
    cb(null, '', '');
  };
  const s = createSynthesizer({ command: '/fake/tamago-tts', engine: 'kokoro', voice: 'af_heart', speed: 0.9, modelDir: '/models', execFileImpl });
  const audio = await s.synthesize('Some sea slugs can photosynthesize like plants.');
  assert.deepEqual(audio, AUDIO);
  assert.equal(seen.text, 'Some sea slugs can photosynthesize like plants.');
  assert.ok(!seen.args.some((a) => a.includes('sea slugs')), 'reply text is not on the command line');
  assert.deepEqual(seen.args.slice(0, 6), ['--engine', 'kokoro', '--voice', 'af_heart', '--speed', '0.9']);
  assert.equal(seen.modelDir, '/models');
  assert.equal(existsSync(seen.textFile), false, 'temp text removed');
});

test('createSynthesizer: failures, empty and oversized output are errors; OpenAI-named voices refused', async () => {
  const failing = createSynthesizer({ command: 'x', engine: 'kokoro', voice: 'af_heart', execFileImpl: (c, a, o, cb) => cb(new Error('exit 1'), '', 'missing model.onnx') });
  await assert.rejects(failing.synthesize('hi'), (e) => e.code === 'tts_failed' && /missing model/.test(e.message));
  assert.equal((await failing.check()).ok, false);
  const empty = createSynthesizer({ command: 'x', engine: 'kokoro', voice: 'af_heart', execFileImpl: (c, a, o, cb) => { writeFileSync(a[a.indexOf('--out') + 1], ''); cb(null, '', ''); } });
  await assert.rejects(empty.synthesize('hi'), /no audio/);
  const huge = createSynthesizer({ command: 'x', engine: 'kokoro', voice: 'af_heart', execFileImpl: (c, a, o, cb) => { writeFileSync(a[a.indexOf('--out') + 1], Buffer.alloc(300 * 1024)); cb(null, '', ''); } });
  await assert.rejects(huge.synthesize('hi'), /too large/);
  for (const v of EXCLUDED_VOICES) assert.throws(() => createSynthesizer({ command: 'x', engine: 'kokoro', voice: v }), /OpenAI/);
});

test('createSynthesizerFromEnv: off by default, validated when on', () => {
  assert.equal(createSynthesizerFromEnv({}), null);
  assert.equal(createSynthesizerFromEnv({ TAMAGO_TTS: 'off' }), null);
  assert.equal(createSynthesizerFromEnv({ TAMAGO_TTS: 'kokoro', TAMAGO_TTS_COMMAND: '/nope/tamago-tts' }), null, 'no helper → unavailable');
  assert.throws(() => createSynthesizerFromEnv({ TAMAGO_TTS: 'openai' }), /Unknown TAMAGO_TTS/);
  assert.throws(() => createSynthesizerFromEnv({ TAMAGO_TTS: 'kokoro', TAMAGO_TTS_SPEED: '5' }), /SPEED/);
  const s = createSynthesizerFromEnv({ TAMAGO_TTS: 'kokoro', TAMAGO_TTS_COMMAND: DEFAULT_TTS_COMMAND });
  assert.equal(s.voice, 'af_heart');
  assert.throws(() => createSynthesizerFromEnv({ TAMAGO_TTS: 'kokoro', TAMAGO_TTS_VOICE: 'af_nova' }), /OpenAI/);
});

// ---------------------------------------------------------------- the helper script, with fake engine binaries

function fakeInstall() {
  const dir = mkdtempSync(join(tmpdir(), 'tamago-tts-fake-'));
  const bin = join(dir, 'fakebin');
  mkdirSync(bin);
  // fake afconvert: copies input to output
  writeFileSync(join(bin, 'afconvert'), '#!/usr/bin/env bash\ncp "$1" "$2"\n');
  chmodSync(join(bin, 'afconvert'), 0o755);
  const sherpa = join(dir, 'models-root', 'sherpa-onnx', 'bin');
  mkdirSync(sherpa, { recursive: true });
  // fake sherpa-onnx-offline-tts: records argv (one per line), writes a fake wav
  writeFileSync(join(sherpa, 'sherpa-onnx-offline-tts'), `#!/usr/bin/env bash
for a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/argv.txt"
for a in "$@"; do case "$a" in --output-filename=*) printf 'RIFFfake' > "\${a#--output-filename=}";; esac; done
`);
  chmodSync(join(sherpa, 'sherpa-onnx-offline-tts'), 0o755);
  for (const [m, files] of [['kokoro-multi-lang-v1_0', ['model.onnx', 'voices.bin', 'tokens.txt']], ['kitten-nano-en-v0_1-fp16', ['model.fp16.onnx', 'voices.bin', 'tokens.txt']]]) {
    const md = join(dir, 'models-root', 'models', m);
    mkdirSync(join(md, 'espeak-ng-data'), { recursive: true });
    for (const f of files) writeFileSync(join(md, f), 'x');
  }
  const run = (args, text = 'hello') => new Promise((resolve) => {
    const tf = join(dir, 'in.txt');
    writeFileSync(tf, text);
    execFile('bash', [DEFAULT_TTS_COMMAND, ...args.map((a) => (a === '@TEXT' ? tf : a))], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TAMAGO_TTS_MODEL_DIR: join(dir, 'models-root'), TMPDIR: dir },
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  return { dir, run, argv: () => readFileSync(join(dir, 'argv.txt'), 'utf8').trimEnd().split('\n'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('helper: kokoro voice → speaker id, speed → length scale, text is one argv element, AAC written', async () => {
  const f = fakeInstall();
  try {
    const out = join(f.dir, 'out.m4a');
    const r = await f.run(['--engine', 'kokoro', '--voice', 'af_heart', '--speed', '0.8', '--text-file', '@TEXT', '--out', out],
      '--output-filename=/tmp/pwned Hi; rm -rf ~ $(whoami)');
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, '', 'prints nothing on success');
    const argv = f.argv();
    assert.ok(argv.includes('--sid=3'), argv.join(' '));
    assert.ok(argv.includes('--kokoro-length-scale=1.250'));
    assert.ok(argv.some((a) => a.startsWith('--kokoro-data-dir=') && a.endsWith('espeak-ng-data')));
    assert.equal(argv.at(-1), 'output-filename=/tmp/pwned Hi; rm -rf ~ $(whoami)', 'text passed verbatim as one element, leading dashes stripped');
    assert.equal(argv.filter((a) => a.startsWith('--output-filename=')).length, 1);
    assert.equal(readFileSync(out, 'utf8'), 'RIFFfake');
  } finally {
    f.cleanup();
  }
});

test('helper: kitten engine, --check, and refusals', async () => {
  const f = fakeInstall();
  try {
    const out = join(f.dir, 'k.m4a');
    assert.equal((await f.run(['--engine', 'kitten', '--voice', 'expr-voice-4-f', '--text-file', '@TEXT', '--out', out])).code, 0);
    assert.ok(f.argv().includes('--sid=5'));
    assert.ok(f.argv().includes('--kitten-length-scale=1.000'));
    assert.equal((await f.run(['--engine', 'kokoro', '--voice', 'af_heart', '--check'])).code, 0);
    const nova = await f.run(['--engine', 'kokoro', '--voice', 'af_nova', '--check']);
    assert.notEqual(nova.code, 0);
    assert.match(nova.stderr, /excluded/);
    const unknown = await f.run(['--engine', 'kokoro', '--voice', 'zz_nobody', '--text-file', '@TEXT', '--out', out]);
    assert.match(unknown.stderr, /unknown kokoro voice/);
    assert.match((await f.run(['--engine', 'elevenlabs', '--voice', 'x', '--check'])).stderr, /unknown --engine/);
    rmSync(join(f.dir, 'models-root', 'models', 'kokoro-multi-lang-v1_0', 'voices.bin'));
    assert.match((await f.run(['--engine', 'kokoro', '--voice', 'af_heart', '--check'])).stderr, /missing .*voices\.bin/);
  } finally {
    f.cleanup();
  }
});

// Real engine: only on a Mac where tools/tts/setup.sh installed the models.
const realDir = process.env.TAMAGO_TTS_MODEL_DIR;
test('helper: real Kokoro synthesis on this machine', {
  skip: !(realDir && existsSync(join(realDir, 'sherpa-onnx', 'bin', 'sherpa-onnx-offline-tts')) && existsSync('/usr/bin/afconvert'))
    && 'no local engine (run Gateway/tools/tts/setup.sh on the Mac and export TAMAGO_TTS_MODEL_DIR)',
}, async () => {
  const s = createSynthesizer({ command: DEFAULT_TTS_COMMAND, engine: 'kokoro', voice: 'af_heart', modelDir: realDir, timeoutMs: 30_000 });
  const t0 = Date.now();
  const audio = await s.synthesize('Some sea slugs can photosynthesize like plants.');
  assert.ok(audio.length > 1000);
  assert.equal(audio.subarray(4, 8).toString('latin1'), 'ftyp', 'an MP4 container');
  console.log(`# real kokoro: ${audio.length} bytes in ${Date.now() - t0} ms`);
});
