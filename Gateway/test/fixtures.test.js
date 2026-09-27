import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startGateway, post } from './helpers.js';
import { parseRequest, validateResponse } from '../src/protocol.js';
import {
  FIXTURE_TIMEOUT_MS,
  REQUEST_FIXTURES,
  RAW_REQUEST_FIXTURES,
  RESPONSE_CASES,
  SPEECH_CASES,
  stubSynthesizer,
  CLIENT_FIXTURE_DESCRIPTIONS,
} from './fixture-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Tests/Fixtures/protocol-v1');
const readJson = (...p) => JSON.parse(readFileSync(path.join(ROOT, ...p), 'utf8'));

let gw;
before(async () => {
  gw = await startGateway({ timeoutMs: FIXTURE_TIMEOUT_MS });
});
after(() => gw.close());

test('request fixtures match their definitions', () => {
  for (const [file, body] of Object.entries(REQUEST_FIXTURES)) {
    assert.deepEqual(readJson('requests', file), body, file);
  }
  for (const [file, raw] of Object.entries(RAW_REQUEST_FIXTURES)) {
    assert.equal(readFileSync(path.join(ROOT, 'requests', file), 'utf8'), raw, file);
  }
});

test('valid request fixtures parse', () => {
  for (const file of ['valid-text.json', 'valid-minimal.json']) {
    assert.doesNotThrow(() => parseRequest(readJson('requests', file)), file);
  }
});

for (const c of RESPONSE_CASES) {
  test(`response fixture ${c.file} matches live mock gateway`, async () => {
    const res = await post(gw.base, c.raw ?? c.body, { raw: c.raw !== undefined, token: c.noAuth ? null : undefined });
    assert.equal(res.status, c.httpStatus);
    assert.deepEqual(readJson('responses', c.file), res.body, `${c.file} drifted; run npm run fixtures`);
  });
}

for (const c of SPEECH_CASES) {
  test(`response fixture ${c.file} matches a gateway with a stub synthesizer`, async () => {
    const speechGw = await startGateway({ timeoutMs: FIXTURE_TIMEOUT_MS, synthesizer: stubSynthesizer() });
    try {
      const res = await post(speechGw.base, c.body);
      assert.equal(res.status, c.httpStatus);
      assert.deepEqual(readJson('responses', c.file), res.body, `${c.file} drifted; run npm run fixtures`);
      assert.ok(res.body.speechAudio, 'speechAudio present');
    } finally {
      await speechGw.close();
    }
  });
}

test('protocol-info fixture matches GET /v1/protocol', async () => {
  const live = await (await fetch(`${gw.base}/v1/protocol`)).json();
  assert.deepEqual(readJson('responses', 'protocol-info.json'), live);
});

test('every response and client fixture is a structurally valid envelope', () => {
  for (const dir of ['responses', 'client']) {
    for (const file of readdirSync(path.join(ROOT, dir))) {
      if (file === 'protocol-info.json') continue;
      assert.deepEqual(validateResponse(readJson(dir, file)), [], `${dir}/${file}`);
    }
  }
});

test('client fixtures are exactly the documented set', () => {
  assert.deepEqual(readdirSync(path.join(ROOT, 'client')).sort(), Object.keys(CLIENT_FIXTURE_DESCRIPTIONS).sort());
});

test('manifest lists every fixture file', () => {
  const manifest = readJson('manifest.json');
  const listed = new Set(manifest.fixtures.map((f) => f.path));
  for (const dir of ['requests', 'responses', 'client']) {
    for (const file of readdirSync(path.join(ROOT, dir))) {
      assert.ok(listed.has(`${dir}/${file}`), `${dir}/${file} missing from manifest`);
    }
  }
  assert.equal(listed.size, manifest.fixtures.length, 'no duplicates');
});
