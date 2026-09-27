#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createGateway, GATEWAY_VERSION } from './server.js';
import { createPairingWindow, PAIRING_DEFAULTS } from './pairing.js';
import { pickLanIPv4, startAdvertising, WELL_KNOWN_HOST } from './advertise.js';

const logger = {
  info: (o) => console.log(JSON.stringify({ level: 'info', t: new Date().toISOString(), ...o })),
  warn: (o) => console.warn(JSON.stringify({ level: 'warn', t: new Date().toISOString(), ...o })),
  error: (o) => console.error(JSON.stringify({ level: 'error', t: new Date().toISOString(), ...o })),
};

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
const server = createGateway({ ...config, pairing, logger });

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
    authRequired: config.authToken !== null,
    gatewayId: config.gatewayId,
  });

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
    server.close(() => process.exit(0));
  });
}
