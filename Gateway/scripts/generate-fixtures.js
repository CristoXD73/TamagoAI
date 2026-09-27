// Regenerates the server-derived fixtures and the manifest in
// Tests/Fixtures/protocol-v1/. Client-synthesized fixtures are hand-written and
// left untouched. Run: npm run fixtures
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startGateway, post } from '../test/helpers.js';
import {
  FIXTURE_TIMEOUT_MS,
  REQUEST_FIXTURES,
  RAW_REQUEST_FIXTURES,
  RESPONSE_CASES,
  SPEECH_CASES,
  stubSynthesizer,
  CLIENT_FIXTURE_DESCRIPTIONS,
} from '../test/fixture-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../Tests/Fixtures/protocol-v1');
const write = (rel, data) => {
  mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  writeFileSync(path.join(ROOT, rel), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};

const manifest = [];

for (const [file, body] of Object.entries(REQUEST_FIXTURES)) {
  write(`requests/${file}`, body);
  manifest.push({ path: `requests/${file}`, kind: 'request', source: 'client' });
}
for (const [file, raw] of Object.entries(RAW_REQUEST_FIXTURES)) {
  write(`requests/${file}`, raw);
  manifest.push({ path: `requests/${file}`, kind: 'request', source: 'client', note: 'raw, not valid JSON' });
}

const gw = await startGateway({ timeoutMs: FIXTURE_TIMEOUT_MS });
try {
  for (const c of RESPONSE_CASES) {
    const res = await post(gw.base, c.raw ?? c.body, { raw: c.raw !== undefined, token: c.noAuth ? null : undefined });
    if (res.status !== c.httpStatus) throw new Error(`${c.file}: expected HTTP ${c.httpStatus}, got ${res.status}`);
    write(`responses/${c.file}`, res.body);
    manifest.push({
      path: `responses/${c.file}`,
      kind: 'response',
      source: 'gateway',
      httpStatus: c.httpStatus,
      description: c.description,
    });
  }
  const info = await (await fetch(`${gw.base}/v1/protocol`)).json();
  write('responses/protocol-info.json', info);
  manifest.push({
    path: 'responses/protocol-info.json',
    kind: 'protocolInfo',
    source: 'gateway',
    httpStatus: 200,
    description: 'GET /v1/protocol',
  });
} finally {
  await gw.close();
}

const speechGw = await startGateway({ timeoutMs: FIXTURE_TIMEOUT_MS, synthesizer: stubSynthesizer() });
try {
  for (const c of SPEECH_CASES) {
    const res = await post(speechGw.base, c.body);
    if (res.status !== c.httpStatus) throw new Error(`${c.file}: expected HTTP ${c.httpStatus}, got ${res.status}`);
    write(`responses/${c.file}`, res.body);
    manifest.push({ path: `responses/${c.file}`, kind: 'response', source: 'gateway', httpStatus: c.httpStatus, description: c.description });
  }
} finally {
  await speechGw.close();
}

for (const [file, description] of Object.entries(CLIENT_FIXTURE_DESCRIPTIONS)) {
  manifest.push({ path: `client/${file}`, kind: 'response', source: 'client-synthesized', httpStatus: null, description });
}

write('manifest.json', { protocolVersion: 1, generatedBy: 'Gateway/scripts/generate-fixtures.js', fixtures: manifest });
console.log(`wrote ${manifest.length} manifest entries to ${ROOT}`);
