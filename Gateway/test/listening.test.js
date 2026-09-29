// Listening mode (PROTOCOL_V1 §19, D-130): chunks stored, transcribed, cleaned of fillers, joined into one
// transcript. Stub transcriber and stub model; a temp folder stands in for the Storage disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptPolished, createListening, createPolisher, removeFillers } from '../src/listening.js';
import { startGateway, TOKEN, ID } from './helpers.js';

const SESSION = '6f1c2a90-1b2c-4d3e-8f40-123456789abc';

function stubTranscriber(texts) {
  const seen = [];
  return {
    seen,
    name: 'stub',
    async transcribe(file, opts) {
      seen.push({ file, bytes: readFileSync(file).length, timeoutMs: opts?.timeoutMs });
      const t = texts.shift();
      if (t instanceof Error) throw t;
      return t ?? '';
    },
  };
}

test('fillers: sounds, stutters and comma-bound tics go; meaning and intentional repeats stay', () => {
  assert.equal(removeFillers('um so I was, uh, thinking we could go to the the store'), 'So I was thinking we could go to the store.'.replace(/\.$/, ''));
  assert.equal(removeFillers('I I think, you know, it works. Uh, yeah.'), 'I think it works. Yeah.');
  assert.equal(removeFillers('Hmm. Like, the build is, like, broken.'), 'The build is broken.');
  assert.equal(removeFillers('no no, that that is fine'), 'No no, that that is fine');
  assert.equal(removeFillers('I like the umbrella and erm the hummingbird'), 'I like the umbrella and the hummingbird');
  assert.equal(removeFillers('uh-huh, mhm'), 'Uh-huh, mhm');
  assert.equal(removeFillers('um uh er'), '');
});

test('the model only replaces the text when it still carries the words', () => {
  const before = 'So I was thinking we could go to the store tomorrow and grab some milk for the house';
  assert.equal(acceptPolished(before, 'So I was thinking we could go to the store tomorrow and grab some milk for the house.'),
    'So I was thinking we could go to the store tomorrow and grab some milk for the house.');
  assert.equal(acceptPolished(before, 'Going to the store.'), null, 'a summary is refused');
  assert.equal(acceptPolished(before, "Here is the cleaned transcript: So I was thinking we could go to the store tomorrow and grab some milk."), null);
  assert.equal(acceptPolished(before, `${before} and also I think you should buy eggs, bread, cheese and butter too`), null, 'additions are refused');
  assert.equal(acceptPolished(before, ''), null);
});

test('listening: chunks are kept, transcribed in order, cleaned, and joined into transcript.md', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'listen-'));
  try {
    const tr = stubTranscriber(['Um, so the the plan is simple.', 'We ship on Friday, uh, if the tests pass.', new Error('garbled')]);
    const polished = [];
    const polish = async (t) => { polished.push(t); return t.replace('We ship', 'We will ship'); };
    const l = createListening({ dir, transcriber: tr, polish, now: () => Date.parse('2026-09-29T14:03:00') });
    const t0 = Date.parse('2026-09-29T14:03:00');
    l.acceptChunk({ session: SESSION, seq: 1, startedAt: t0, audio: Buffer.from('aaa') });
    l.acceptChunk({ session: SESSION, seq: 2, startedAt: t0 + 60_000, audio: Buffer.from('bbbb') });
    l.acceptChunk({ session: SESSION, seq: 3, startedAt: t0 + 120_000, audio: Buffer.from('cc') });
    await l.idle();

    const [s] = l.sessions();
    assert.equal(s.session, SESSION);
    assert.equal(s.chunks, 3);
    assert.match(s.folder, /2026-09-29_1403_6f1c2a90$/);
    assert.equal(readFileSync(join(s.folder, 'chunk-000002.m4a'), 'utf8'), 'bbbb', 'the audio is kept');
    assert.equal(statSync(join(s.folder, 'chunk-000002.m4a')).mode & 0o777, 0o600);
    assert.equal(statSync(s.folder).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(s.folder, 'chunk-000002.raw.txt'), 'utf8').trim(), 'We ship on Friday, uh, if the tests pass.');
    assert.equal(tr.seen[0].timeoutMs, 180_000, 'long chunks get a long transcription timeout');
    assert.deepEqual(tr.seen.map((x) => x.bytes), [3, 4, 2], 'in the order they arrived');

    const md = readFileSync(join(s.folder, 'transcript.md'), 'utf8');
    assert.match(md, /\*\*14:03\*\* So the plan is simple\./);
    assert.match(md, /\*\*14:04\*\* We will ship on Friday if the tests pass\./, 'rules, then the model');
    assert.match(md, /\*\*14:05\*\* _\(couldn't transcribe this part; the audio is in chunk-000003\.m4a\)_/);
    assert.equal(polished.length, 2);
    assert.equal(l.transcript(SESSION).text, 'So the plan is simple.\nWe will ship on Friday if the tests pass.\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listening: a retried chunk replaces itself; a broken model falls back to the rules; end marks the stop time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'listen-'));
  try {
    const tr = stubTranscriber(['one two three four five, um, six', 'one two three four five, um, six']);
    let now = Date.parse('2026-09-29T09:00:00');
    const l = createListening({ dir, transcriber: tr, polish: async () => { throw new Error('Ollama down'); }, now: () => now });
    assert.equal(l.acceptChunk({ session: SESSION, seq: 0, startedAt: now, audio: Buffer.from('x') }).duplicate, false);
    assert.equal(l.acceptChunk({ session: SESSION, seq: 0, startedAt: now, audio: Buffer.from('xy') }).duplicate, true);
    await l.idle();
    now += 5 * 60_000;
    assert.deepEqual(l.end(SESSION), { session: SESSION, chunks: 1 });
    await l.idle();
    const md = readFileSync(join(l.sessions()[0].folder, 'transcript.md'), 'utf8');
    assert.match(md, /Started 09:00, stopped 09:05\./);
    assert.match(md, /\*\*09:00\*\* One two three four five six/);
    assert.throws(() => l.acceptChunk({ session: 'nope', seq: 0, audio: Buffer.from('x') }), /UUID/);
    assert.throws(() => l.acceptChunk({ session: SESSION, seq: -1, audio: Buffer.from('x') }), /whole number/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('polisher asks Ollama with thinking off and returns its text', async () => {
  let body;
  const polish = createPolisher({ model: 'gemma', fetchImpl: async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ message: { content: ' Clean. ' } }) }; } });
  assert.equal(await polish('um clean'), 'Clean.');
  assert.equal(body.think, false);
  assert.equal(body.messages[1].content, 'um clean');
  assert.equal(createPolisher({ model: undefined }), null);
});

test('HTTP: /v1/listen/chunk stores, sessions list, transcript, end; auth, validation and the feature flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'listen-'));
  const listening = createListening({ dir, transcriber: stubTranscriber(['Hello there, um, Tamago.']), polish: null });
  const gw = await startGateway({ listening });
  const chunk = (headers, body = Buffer.from('m4a')) => fetch(`${gw.base}/v1/listen/chunk`, {
    method: 'POST', body,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'audio/mp4', 'x-tamago-listen-session': SESSION, 'x-tamago-listen-seq': '7', 'x-tamago-listen-started-at': String(Date.parse('2026-09-29T10:00:00')), ...headers },
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const info = await fetch(`${gw.base}/v1/protocol`).then((r) => r.json());
    assert.ok(info.features.includes('listening'));
    assert.equal(info.limits.maxListenChunkBytes, 4 * 1024 * 1024);

    const r = await chunk({});
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.status, r.body.session, r.body.seq, r.body.stored, r.body.duplicate], ['ok', SESSION, 7, true, false]);
    assert.equal((await chunk({ authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await chunk({ 'x-tamago-listen-session': 'x' })).body.error.code, 'invalid_request');
    assert.equal((await chunk({ 'content-type': 'text/plain' })).body.error.code, 'invalid_request');
    assert.equal((await chunk({}, Buffer.alloc(0))).body.error.code, 'invalid_request');
    await listening.idle();

    const auth = { headers: { authorization: `Bearer ${TOKEN}` } };
    const list = await fetch(`${gw.base}/v1/listen/sessions`, auth).then((x) => x.json());
    assert.equal(list.sessions[0].session, SESSION);
    assert.equal(list.sessions[0].folder, undefined, 'no Mac paths over the network');
    const one = await fetch(`${gw.base}/v1/listen/sessions/${SESSION}`, auth).then((x) => x.json());
    assert.equal(one.text, 'Hello there Tamago.\n', 'rules drop the filler with its commas; the model pass restores punctuation');
    const end = await fetch(`${gw.base}/v1/listen/end`, { method: 'POST', headers: { ...auth.headers, 'content-type': 'application/json' }, body: JSON.stringify({ session: SESSION }) }).then((x) => x.json());
    assert.deepEqual([end.status, end.chunks], ['ok', 1]);
    assert.equal((await fetch(`${gw.base}/v1/listen/chunk`, auth)).status, 405);
  } finally {
    await gw.close();
    rmSync(dir, { recursive: true, force: true });
  }

  const off = await startGateway({});
  try {
    const r = await fetch(`${off.base}/v1/listen/chunk`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'audio/mp4' }, body: 'x' });
    assert.equal(r.status, 503);
    assert.ok(!(await fetch(`${off.base}/v1/protocol`).then((x) => x.json())).features.includes('listening'));
  } finally { await off.close(); }
  assert.ok(ID(1));
  assert.ok(!existsSync(dir));
});
