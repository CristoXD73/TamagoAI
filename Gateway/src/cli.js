#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createGateway, GATEWAY_VERSION } from './server.js';

const logger = {
  info: (o) => console.log(JSON.stringify({ level: 'info', t: new Date().toISOString(), ...o })),
  warn: (o) => console.warn(JSON.stringify({ level: 'warn', t: new Date().toISOString(), ...o })),
  error: (o) => console.error(JSON.stringify({ level: 'error', t: new Date().toISOString(), ...o })),
};

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`apple-tamago-gateway: ${err.message}`);
  process.exit(1);
}

if (config.host === '0.0.0.0' || config.host === '::') {
  logger.warn({
    event: 'lan_bind',
    message: 'Listening on all interfaces. Keep this on your trusted home LAN; never port-forward it to the internet.',
  });
}

const server = createGateway({ ...config, logger });
server.listen(config.port, config.host, () => {
  logger.info({
    event: 'listening',
    gatewayVersion: GATEWAY_VERSION,
    host: config.host,
    port: server.address().port,
    provider: config.provider.name,
    authRequired: config.authToken !== null,
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
