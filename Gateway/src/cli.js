#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createGateway, GATEWAY_VERSION } from './server.js';
import { createPairingWindow, PAIRING_DEFAULTS } from './pairing.js';
import { createTranscriberFromEnv } from './transcriber.js';
import { createSynthesizerFromEnv } from './tts.js';
import { pickLanIPv4, startAdvertising, WELL_KNOWN_HOST } from './advertise.js';
import { createConsoleMonitor, createMonitorLogger } from './monitor.js';
import { createMonitorUI } from './monitor-ui.js';
import { defaultStateDir } from './identity.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// TAMAGO_MONITOR=1: the owner's live view (monitor.js) takes the terminal and
// the metadata-only JSON log moves to <state dir>/logs/gateway.log.
// The dashboard (monitor-ui.js, 127.0.0.1 only) is created once the gateway listens; until then events only print.
let dashboard = null;
const printLine = process.env.TAMAGO_MONITOR === '1' ? createConsoleMonitor() : null;
const monitor = printLine ? (e) => { printLine(e); dashboard?.push(e); } : null;
let logger;
if (monitor) {
  const logDir = join(defaultStateDir(process.env), 'logs');
  mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const logFile = join(logDir, 'gateway.log');
  logger = createMonitorLogger({ monitor, appendLine: (l) => { try { appendFileSync(logFile, `${l}\n`); } catch { /* disk full or unmounted */ } } });
} else {
  logger = {
    info: (o) => console.log(JSON.stringify({ level: 'info', t: new Date().toISOString(), ...o })),
    warn: (o) => console.warn(JSON.stringify({ level: 'warn', t: new Date().toISOString(), ...o })),
    error: (o) => console.error(JSON.stringify({ level: 'error', t: new Date().toISOString(), ...o })),
  };
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`tamagoai-gateway: ${err.message}`);
  process.exit(1);
}

if (config.host === '0.0.0.0' || config.host === '::') {
  logger.warn({
    event: 'lan_bind',
    message: 'Listening on all interfaces. Keep this on your trusted home LAN; never port-forward it to the internet.',
  });
}

if (config.provider.ready) {
  try {
    await config.provider.ready();
  } catch (err) {
    console.error(`tamagoai-gateway: brain failed to start: ${err.message}`);
    process.exit(1);
  }
}

const pairing = config.pairingEnabled ? createPairingWindow() : null;
const transcriber = createTranscriberFromEnv(process.env);
const keepAudioDir = process.env.TAMAGO_KEEP_AUDIO_DIR || null;   // diagnostics only
// PROTOCOL_V1 §16 / D-121: natural voice from the Mac. Checked once at startup;
// if the helper or its models aren't in place, the Watch keeps its own voice.
let synthesizer = null;
let voiceOutput = 'unavailable (TAMAGO_TTS=off; see docs/DEVELOPMENT.md "Natural voice")';
try {
  synthesizer = createSynthesizerFromEnv(process.env);
  if (synthesizer) {
    const check = await synthesizer.check();
    if (check.ok) voiceOutput = `${synthesizer.engine}/${synthesizer.voice || 'default'}`;
    else {
      voiceOutput = `unavailable (${check.reason})`;
      synthesizer = null;
    }
  } else if (process.env.TAMAGO_TTS && process.env.TAMAGO_TTS !== 'off') {
    voiceOutput = 'unavailable (speech helper not found: TAMAGO_TTS_COMMAND)';
  }
} catch (err) {
  console.error(`tamagoai-gateway: ${err.message}`);
  process.exit(1);
}
const server = createGateway({ ...config, pairing, transcriber, keepAudioDir, synthesizer, logger, monitor });

let advertiser = null;
let ipWatch = null;

server.listen(config.port, config.host, () => {
  const port = server.address().port;
  logger.info({
    event: 'listening',
    gatewayVersion: GATEWAY_VERSION,
    host: config.host,
    port,
    provider: config.provider.name,
    voiceInput: transcriber ? transcriber.name : 'unavailable (npm run build:transcriber)',
    voiceOutput,
    authRequired: config.authToken !== null,
    gatewayId: config.gatewayId,
  });
  if (monitor) {
    const ip = pickLanIPv4(config.host);
    console.log([
      '',
      `  🐙 TamagoAI is listening${ip ? ` at http://${ip}:${port}` : ` on ${config.host}:${port}`}`,
      `     brain: ${config.provider.name}${process.env.OLLAMA_MODEL ? ` (${process.env.OLLAMA_MODEL})` : ''}`,
      `     voice in: ${transcriber ? transcriber.name : 'unavailable'}   voice out: ${voiceOutput}`,
      '     Words are shown here only, never saved. Ctrl-C stops Tamago.',
      '',
    ].join('\n'));
    const ui = createMonitorUI({
      port: Number(process.env.TAMAGO_MONITOR_PORT ?? 8788),
      gatewayUrl: `http://127.0.0.1:${port}`,
      authToken: config.authToken,
      pairingCode: () => (pairing?.isOpen ? pairing.code : null),
      info: {
        address: ip ? `${ip}:${port}` : `${config.host}:${port}`,
        brain: process.env.OLLAMA_MODEL ?? config.provider.name,
        voiceIn: transcriber ? transcriber.name : 'unavailable',
        voiceOut: voiceOutput,
      },
    });
    ui.listen().then(
      (url) => { dashboard = ui; console.log(`  📺 Live dashboard: ${url}   (this Mac only)\n`); },
      (err) => console.log(`  📺 Dashboard didn't start: ${err.message}\n`),
    );
  }

  if (config.advertise) {
    const advertiseCurrentIP = () => {
      const ip = pickLanIPv4(config.host);
      if (!ip) return logger.warn({ event: 'advertise_skipped', message: 'No LAN IPv4 address found.' });
      if (advertiser?.ip === ip) return;
      advertiser?.stop();
      advertiser = startAdvertising({ port, ip, gatewayId: config.gatewayId, logger });
    };
    advertiseCurrentIP();
    // The Mac's DHCP address can change; re-publish so tamagoai.local follows it.
    ipWatch = setInterval(advertiseCurrentIP, 60_000);
  }

  if (pairing) {
    const minutes = PAIRING_DEFAULTS.ttlMs / 60_000;
    const spaced = `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`;
    const where = config.advertise ? WELL_KNOWN_HOST : `${config.host}:${port}`;
    // Shown to the owner on their own terminal; deliberately not in the JSON log stream.
    console.log(`\n  TamagoAI pairing code: ${spaced}   (valid ${minutes} min, single use, gateway ${where})\n`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(ipWatch);
    advertiser?.stop();
    // Open dashboards and keep-alive sockets would otherwise hold the exit.
    dashboard?.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
