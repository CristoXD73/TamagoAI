// The owner's live view (TAMAGO_MONITOR=1, monitor.js): every hop of a
// conversation reaches the monitor with its words, while the JSON logger stays
// metadata-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGateway, TOKEN, ID } from './helpers.js';
import { createConsoleMonitor, createMonitorLogger } from '../src/monitor.js';

test('monitor: sees heard text, the answer and the voice; the logger never sees words', async () => {
  const events = [];
  const logs = [];
  const logger = { info: (o) => logs.push(o), warn: (o) => logs.push(o), error: (o) => logs.push(o) };
  const transcriber = { name: 'stub', transcribe: async () => 'what is my secret' };
  const synthesizer = { engine: 'stub', voice: 'v', synthesize: async () => Buffer.from('m4a') };
  const gw = await startGateway({ transcriber, synthesizer, logger, monitor: (e) => events.push(e) });
  try {
    await fetch(`${gw.base}/v1/health`);
    const r = await fetch(`${gw.base}/v1/audio`, {
      method: 'POST',
      headers: { 'content-type': 'audio/mp4', 'x-tamago-request-id': ID(7), authorization: `Bearer ${TOKEN}` },
      body: Buffer.from('audio'),
    }).then((x) => x.json());
    await fetch(`${gw.base}${r.speechAudio.path}`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((x) => x.arrayBuffer());
    await fetch(`${gw.base}/v1/request`, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' });

    const kinds = events.map((e) => e.kind);
    for (const k of ['health', 'audio_in', 'heard', 'reply', 'voice_ready', 'voice_fetch', 'auth_failed']) {
      assert.ok(kinds.includes(k), `monitor saw ${k} (got ${kinds.join(', ')})`);
    }
    assert.equal(events.find((e) => e.kind === 'heard').text, 'what is my secret');
    assert.equal(events.find((e) => e.kind === 'reply').text, r.text);
    assert.equal(events.find((e) => e.kind === 'voice_fetch').status, 200);

    const logged = JSON.stringify(logs);
    assert.ok(!logged.includes('secret'), 'the JSON log never holds what was heard');
    assert.ok(!logged.includes(r.text), 'the JSON log never holds the answer');
  } finally {
    await gw.close();
  }
});

test('monitor: a throwing monitor never breaks a request', async () => {
  const gw = await startGateway({ monitor: () => { throw new Error('boom'); } });
  try {
    const r = await fetch(`${gw.base}/v1/request`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: 1, requestId: ID(8), inputType: 'text', text: 'ping' }),
    });
    assert.equal(r.status, 200);
  } finally {
    await gw.close();
  }
});

test('console monitor: readable lines; check-ins from the same Watch shown once a minute', () => {
  const lines = [];
  const show = createConsoleMonitor({ write: (l) => lines.push(l), color: false });
  show({ kind: 'health', from: '192.168.0.9', at: 0 });
  show({ kind: 'health', from: '192.168.0.9', at: 30_000 });
  show({ kind: 'heard', requestId: ID(1), text: 'hello', ms: 400, at: 1 });
  show({ kind: 'reply', requestId: ID(1), text: 'Hi.', characterState: 'happy', ms: 900, at: 2 });
  show({ kind: 'mystery', at: 3 });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Watch checked in/);
  assert.match(lines[1], /Heard: “hello”/);
  assert.match(lines[2], /Tamago: “Hi\.”.*happy/);
});

test('monitor logger: info goes only to the file; warnings reach the terminal', () => {
  const file = [];
  const shown = [];
  const log = createMonitorLogger({ monitor: (e) => shown.push(e), appendLine: (l) => file.push(l) });
  log.info({ event: 'request', requestId: ID(1) });
  log.warn({ event: 'lan_bind', message: 'LAN' });
  assert.equal(file.length, 2);
  assert.deepEqual(shown.map((e) => e.message), ['LAN']);
});

test('dashboard: loopback page, live events with clips, Host and Origin checks, test messages', async () => {
  const gw = await startGateway();
  const { createMonitorUI } = await import('../src/monitor-ui.js');
  const ui = createMonitorUI({ port: 0, gatewayUrl: gw.base, authToken: TOKEN, info: { brain: 'mock' } });
  const url = await ui.listen();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Tamago Live/);

    ui.push({ kind: 'voice_ready', requestId: ID(3), at: 1, audio: Buffer.from('m4a!') });
    ui.push({ kind: 'health', from: '192.168.0.50', at: 2 });
    const clip = await fetch(`${url}/clip/${ID(3)}`);
    assert.equal(Buffer.from(await clip.arrayBuffer()).toString(), 'm4a!');

    // The first SSE frame carries the backlog (without the audio bytes) and the Watch's last check-in.
    const ctrl = new AbortController();
    const es = await fetch(`${url}/events`, { signal: ctrl.signal });
    const reader = es.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    const hello = JSON.parse(first.split('data: ')[1]);
    assert.equal(hello.events.length, 1);
    assert.equal(hello.events[0].clip, true);
    assert.equal(hello.events[0].audio, undefined);
    assert.equal(hello.status.watchFrom, '192.168.0.50');

    // DNS rebinding and cross-site posts are refused.
    const port = new URL(url).port;
    const { request } = await import('node:http');
    const status = await new Promise((resolve) => {
      request({ host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } }, (r) => { r.resume(); resolve(r.statusCode); }).end();
    });
    assert.equal(status, 421);
    const cross = await fetch(`${url}/api/say`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{"text":"hi"}' });
    assert.equal(cross.status, 403);

    const said = await fetch(`${url}/api/say`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: '{"text":"ping"}' });
    assert.equal(said.status, 200);
    assert.equal((await said.json()).status, 'ok');
  } finally {
    await ui.close();
    await gw.close();
  }
});
