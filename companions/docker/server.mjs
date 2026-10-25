// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDockerCompanion } from './host.mjs';
import { openDockerSocket } from './runtime.mjs';

export async function runDockerCompanion(environment = process.env) {
  const file = environment.OPERATIONS_DOCKER_PAIRING_KEY_FILE, metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.mode & 0o077 || metadata.uid !== process.getuid?.() || metadata.size > 512)
    throw new Error('An owner-only Docker pairing key file is required.');
  const pairingKey = (await readFile(file, 'utf8')).trim(), hostname = environment.OPERATIONS_DOCKER_LISTEN_HOST ?? '127.0.0.1';
  const runtime = await openDockerSocket({ hostId: environment.OPERATIONS_DOCKER_HOST_ID, socketPath: environment.OPERATIONS_DOCKER_SOCKET });
  const companion = createDockerCompanion({ publicOrigin: environment.OPERATIONS_DOCKER_PUBLIC_ORIGIN, pairingKey,
    allowedOrigins: JSON.parse(environment.OPERATIONS_DOCKER_ALLOWED_ORIGINS ?? '[]') }, runtime);
  const tls = environment.OPERATIONS_DOCKER_TLS_KEY_FILE && environment.OPERATIONS_DOCKER_TLS_CERT_FILE
    ? { key: await readFile(environment.OPERATIONS_DOCKER_TLS_KEY_FILE), cert: await readFile(environment.OPERATIONS_DOCKER_TLS_CERT_FILE) } : undefined;
  if (!tls && (environment.OPERATIONS_DOCKER_TRUSTED_TLS_PROXY !== '1' || !['127.0.0.1', '::1'].includes(hostname))) throw new Error('Trusted HTTPS is required.');
  const server = (tls ? httpsServer : httpServer)(tls ?? {}, (req, res) => { void companion.handle(req, res); });
  server.on('upgrade', (_req, socket) => socket.destroy()); server.maxConnections = 32;
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  const port = Number(environment.OPERATIONS_DOCKER_PORT ?? 8447);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Docker companion port.');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
  return { server, async close() { companion.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await runDockerCompanion(); const close = () => { void service.close().finally(() => process.exit()); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
