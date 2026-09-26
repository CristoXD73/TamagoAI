import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

export const SERVICE_TYPE = '_tamagoai._tcp';
/**
 * A fixed mDNS hostname, published alongside the Bonjour service. A physical
 * Apple Watch may not use Bonjour APIs (NWBrowser/NetService) at all — Apple
 * TN3135 classes them as low-level networking, blocked for ordinary watchOS
 * apps — but URLSession resolves `.local` names through the system resolver,
 * which is ordinary high-level networking. So the Watch reaches
 * `http://tamagoai.local:<port>` without ever typing an IP address.
 */
export const WELL_KNOWN_HOST = 'tamagoai.local';

function isIPv4(family) {
  return family === 'IPv4' || family === 4;
}

/** The LAN IPv4 to publish: the bound address, else en0, else any non-internal. */
export function pickLanIPv4(boundHost, ifaces = networkInterfaces()) {
  if (boundHost && /^\d+\.\d+\.\d+\.\d+$/.test(boundHost) && boundHost !== '0.0.0.0') return boundHost;
  const candidates = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (isIPv4(a.family) && !a.internal) candidates.push({ name, address: a.address });
    }
  }
  candidates.sort((a, b) => (a.name === 'en0' ? -1 : b.name === 'en0' ? 1 : a.name.localeCompare(b.name)));
  return candidates[0]?.address ?? null;
}

export function dnsSdArgs({ port, ip, gatewayId }) {
  return ['-P', 'TamagoAI', SERVICE_TYPE, 'local', String(port), WELL_KNOWN_HOST, ip, `id=${gatewayId}`, 'proto=1'];
}

/**
 * Publishes the service + `tamagoai.local` → ip through macOS's own
 * `/usr/bin/dns-sd` (no npm dependency). Records vanish when the child exits,
 * which is how the Watch-side "Mac went away" signal stays honest.
 */
export function startAdvertising({ port, ip, gatewayId, logger, spawnImpl = spawn }) {
  const child = spawnImpl('/usr/bin/dns-sd', dnsSdArgs({ port, ip, gatewayId }), { stdio: ['ignore', 'ignore', 'pipe'] });
  child.on('error', (err) => logger.warn({ event: 'advertise_failed', message: err.message }));
  child.stderr?.on('data', (d) => logger.warn({ event: 'advertise_stderr', message: String(d).trim() }));
  logger.info({ event: 'advertising', host: WELL_KNOWN_HOST, ip, port, serviceType: SERVICE_TYPE });
  return { ip, stop: () => child.kill('SIGTERM') };
}
