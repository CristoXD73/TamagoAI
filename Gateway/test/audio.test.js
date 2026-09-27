// POST /v1/audio (PROTOCOL_V1 §15, D-120): hold-to-talk audio, transcribed on
// the Mac, then an ordinary request. Stub transcriber; the real Apple
// SpeechAnalyzer helper runs only where it has been built (macOS).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway, TOKEN, ID } from './helpers.js';
import { createTranscriber, cleanTranscript, DEFAULT_TRANSCRIBER_PATH } from '../src/transcriber.js';
import { createMockProvider } from '../src/providers/mock.js';

const AUDIO = Buffer.from('fake m4a bytes');

function stubTranscriber(text) {
  const seen = [];
  return {
    seen,
    transcriber: {
      name: 'stub',
      async transcribe(file) {
        seen.push({ file, existed: existsSync(file), bytes: readFileSync(file).length });
        if (text instanceof Error) throw text;
        return text;
      },
    },
  };
}

function postAudio(base, { body = AUDIO, requestId = ID(1), token = TOKEN, contentType = 'audio/mp4', version } = {}) {
  return fetch(`${base}/v1/audio`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(requestId ? { 'x-tamago-request-id': requestId } : {}),
      ...(version ? { 'x-tamago-protocol-version': String(version) } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
}

test('audio: transcript becomes an ordinary request; transcript returned; temp file removed', async () => {
  const stub = stubTranscriber('ping');
  const gw = await startGateway({ transcriber: stub.transcriber });
  try {
    const r = await postAudio(gw.base);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.body.requestId, ID(1));
    assert.equal(r.body.transcript, 'ping');
    assert.ok(r.body.text.length > 0, 'the mock answered the transcript like any text request');
    assert.equal(stub.seen.length, 1);
    assert.equal(stub.seen[0].existed, true);
    assert.equal(stub.seen[0].bytes, AUDIO.length);
    assert.equal(existsSync(stub.seen[0].file), false, 'audio is deleted right after transcription');

    const again = await postAudio(gw.base);
    assert.equal(again.body.transcript, 'ping');
    assert.equal(stub.seen.length, 1, 'a retried requestId is answered from the dedupe cache, not re-transcribed');
  } finally {
    await gw.close();
  }
});

test('audio: nothing heard gets a spoken "I didn\'t catch that.", not silence or an error', async () => {
  const gw = await startGateway({ transcriber: stubTranscriber('').transcriber });
  try {
    const r = await postAudio(gw.base);
    assert.equal(r.status, 200);
    assert.equal(r.body.speechText, "I didn't catch that.");
    assert.equal(r.body.characterState, 'confused');
    assert.equal(r.body.transcript, '');
  } finally {
    await gw.close();
  }
});

test('audio: auth, headers, size and availability are enforced', async () => {
  const gw = await startGateway({ transcriber: stubTranscriber('ping').transcriber });
  try {
    assert.equal((await postAudio(gw.base, { token: null })).status, 401);
    assert.equal((await postAudio(gw.base, { requestId: null })).body.error.code, 'invalid_request');
    assert.equal((await postAudio(gw.base, { contentType: 'application/json' })).body.error.code, 'invalid_request');
    assert.equal((await postAudio(gw.base, { version: 2 })).body.error.code, 'unsupported_protocol');
    assert.equal((await postAudio(gw.base, { body: Buffer.alloc(0), requestId: ID(2) })).body.error.code, 'invalid_request');
    assert.equal((await postAudio(gw.base, { body: Buffer.alloc(1024 * 1024 + 1), requestId: ID(3) })).status, 413);
    const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
    assert.deepEqual(info.inputTypes, ['text', 'audio']);
  } finally {
    await gw.close();
  }
  const none = await startGateway();
  try {
    const r = await postAudio(none.base);
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'provider_unavailable');
    assert.deepEqual((await (await fetch(`${none.base}/v1/protocol`)).json()).inputTypes, ['text']);
  } finally {
    await none.close();
  }
});

test('audio: a transcriber failure is a structured provider_error', async () => {
  const gw = await startGateway({ transcriber: stubTranscriber(new Error('boom')).transcriber });
  try {
    const r = await postAudio(gw.base);
    assert.equal(r.body.status, 'error');
    assert.equal(r.body.error.code, 'provider_error');
  } finally {
    await gw.close();
  }
});

// Real on-device transcription: only where the macOS helper has been built
// (`npm run build:transcriber`) and `say` exists. Skipped elsewhere (CI, Linux).
test('audio: the real Apple SpeechAnalyzer helper transcribes a spoken phrase', {
  skip: !(existsSync(DEFAULT_TRANSCRIBER_PATH) && existsSync('/usr/bin/say')) && 'transcriber helper not built on this machine',
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tamago-say-'));
  try {
    const file = join(dir, 'q.aiff');
    execFileSync('/usr/bin/say', ['-o', file, "What's my dog's name?"]);
    const text = await createTranscriber({ binPath: DEFAULT_TRANSCRIBER_PATH }).transcribe(file);
    assert.match(text.toLowerCase(), /dog'?s name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('audio: punctuation runs from trailing silence are cleaned before the brain sees them', async () => {
  // Real transcripts from the owner's Watch, 2026-09-27.
  assert.equal(cleanTranscript("What's my dog?,,',',,,"), "What's my dog?");
  assert.equal(cleanTranscript('Can you tell me 10, fun, facts?,,,,,'), 'Can you tell me 10, fun, facts?');
  assert.equal(cleanTranscript("What's your name?"), "What's your name?");
  assert.equal(cleanTranscript(',,, '), '');
  const gw = await startGateway({ transcriber: stubTranscriber("ping,,',',,,").transcriber });
  try {
    assert.equal((await postAudio(gw.base)).body.transcript, 'ping');
  } finally {
    await gw.close();
  }
});

test('health: the Watch checking in warms the provider (never blocking the answer)', async () => {
  let warms = 0;
  const provider = { ...createMockProvider(), warm: async () => { warms += 1; return true; } };
  const gw = await startGateway({ provider });
  try {
    const r = await fetch(`${gw.base}/v1/health`);
    assert.equal(r.status, 200);
    assert.equal(warms, 1);
  } finally {
    await gw.close();
  }
});
