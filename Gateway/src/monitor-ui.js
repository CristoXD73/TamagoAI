// monitor-ui.js: the owner's live dashboard at http://127.0.0.1:8788 (TAMAGO_MONITOR=1).
//
// A browser view of what monitor.js prints: each conversation as chat bubbles
// with every hop timed (audio arrived → heard → answered → voice made → Watch
// fetched it), the Mac's parts (gateway, Ollama, voice) and when the Watch last
// checked in. The last voice clips can be replayed and a test message sent as
// if from the Watch.
//
// It shows the owner's words, so it is bound to 127.0.0.1 only, checks the Host
// header (no DNS rebinding) and the Origin of every POST, and keeps everything in
// memory: recent events and clips vanish when the gateway stops. Owner's request,
// 2026-09-27: "set up a local host with proper looking UI".

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const MAX_EVENTS = 300;
const MAX_CLIPS = 20;
const PAGE = new URL('./monitor-ui.html', import.meta.url);
const ART = new URL('../../Apple/WatchApp/Assets.xcassets/Creature.imageset/Creature.jpg', import.meta.url);

/**
 * @param {object} opts
 * @param {number} opts.port                  loopback port, default 8788
 * @param {string} opts.gatewayUrl            e.g. http://127.0.0.1:8787, for the test box
 * @param {string|null} opts.authToken        the gateway's token (never sent to the page)
 * @param {object} opts.info                  static facts for the header (brain, voices, address)
 * @param {() => string|null} [opts.pairingCode] the current code, if a window is open
 * @param {string} [opts.ollamaUrl]
 */
export function createMonitorUI({ port = 8788, gatewayUrl, authToken, info, pairingCode = () => null, ollamaUrl = 'http://127.0.0.1:11434' }) {
  const events = [];
  const clips = new Map();       // requestId -> Buffer (memory only)
  const clients = new Set();
  const status = { ollama: 'checking', gateway: 'checking', watchSeenAt: null, watchFrom: null };
  let art = null;

  function push(e) {
    const event = { ...e };
    if (event.audio) {
      clips.set(event.requestId, event.audio);
      while (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value);
      event.clip = true;
      delete event.audio;
    }
    if (['health', 'audio_in', 'text_in', 'voice_fetch'].includes(event.kind) && event.from && !isLoopback(event.from)) {
      status.watchSeenAt = event.at;
      status.watchFrom = event.from;
      broadcast('status', snapshot());
    }
    if (event.kind === 'health') return;   // shown as "last seen", not in the feed
    events.push(event);
    if (events.length > MAX_EVENTS) events.shift();
    broadcast('event', event);
  }

  function snapshot() {
    return { ...status, ...info, pairingCode: pairingCode(), now: Date.now() };
  }

  function broadcast(type, data) {
    const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  async function probe() {
    const ok = async (url) => {
      try { return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok ? 'up' : 'down'; } catch { return 'down'; }
    };
    const [ollama, gateway] = await Promise.all([ok(`${ollamaUrl}/api/version`), ok(`${gatewayUrl}/v1/health?monitor=1`)]);
    if (ollama !== status.ollama || gateway !== status.gateway) {
      status.ollama = ollama;
      status.gateway = gateway;
    }
    broadcast('status', snapshot());
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });

  async function handle(req, res) {
    const host = String(req.headers.host ?? '');
    const bound = server.address().port;
    if (host !== `127.0.0.1:${bound}` && host !== `localhost:${bound}`) return res.writeHead(421).end('Wrong host.');
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      // Read on every visit: a small file, and edits show on reload without restarting Tamago.
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(readFileSync(PAGE));
    }
    if (req.method === 'GET' && url.pathname === '/octopus.jpg') {
      try { art ??= readFileSync(ART); } catch { return res.writeHead(404).end(); }
      return res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' }).end(art);
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ status: snapshot(), events })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/clip/')) {
      const clip = clips.get(url.pathname.slice('/clip/'.length));
      if (!clip) return res.writeHead(404).end();
      return res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': clip.length, 'cache-control': 'no-store' }).end(clip);
    }
    if (req.method === 'POST' && url.pathname === '/api/say') {
      const origin = String(req.headers.origin ?? '');
      if (origin !== `http://${host}`) return res.writeHead(403).end('Cross-origin request refused.');
      const body = JSON.parse(await readSmall(req));
      const text = String(body?.text ?? '').trim().slice(0, 500);
      if (!text) return res.writeHead(400).end('Empty.');
      const r = await fetch(`${gatewayUrl}/v1/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ protocolVersion: 1, requestId: randomUUID(), inputType: 'text', text, client: { route: 'monitor' } }),
      });
      return res.writeHead(r.status, { 'content-type': 'application/json' }).end(await r.text());
    }
    return res.writeHead(404).end();
  }

  let timer = null;
  return {
    push,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        timer = setInterval(probe, 5000);
        probe();
        resolve(`http://127.0.0.1:${server.address().port}`);
      });
    }),
    close: () => new Promise((resolve) => {
      clearInterval(timer);
      for (const res of clients) res.end();
      server.close(resolve);
    }),
  };
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1';
}

function readSmall(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { s += c; if (s.length > 4096) req.destroy(); });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
