// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createGithubArchiveCompanion } from './host.mjs';
export async function runGithubArchiveCompanion(environment = process.env) {
  const handle = await open(environment.OPERATIONS_GITHUB_ARCHIVE_PAIRING_KEY_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
  let pairingKey;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.mode & 0o077 || metadata.uid !== process.getuid?.() || metadata.size > 512)
      throw new Error('An owner-only archive pairing key file is required.');
    pairingKey = (await handle.readFile('utf8')).trim();
  } finally { await handle.close(); }
  const hostname = environment.OPERATIONS_GITHUB_ARCHIVE_LISTEN_HOST ?? '127.0.0.1';
  const companion = createGithubArchiveCompanion({ publicOrigin: environment.OPERATIONS_GITHUB_ARCHIVE_PUBLIC_ORIGIN, pairingKey,
    allowedOrigins: JSON.parse(environment.OPERATIONS_GITHUB_ARCHIVE_ALLOWED_ORIGINS ?? '[]'),
    storageOrigins: JSON.parse(environment.OPERATIONS_GITHUB_ARCHIVE_STORAGE_ORIGINS ?? '[]') });
  const tls = environment.OPERATIONS_GITHUB_ARCHIVE_TLS_KEY_FILE && environment.OPERATIONS_GITHUB_ARCHIVE_TLS_CERT_FILE
    ? { key: await readFile(environment.OPERATIONS_GITHUB_ARCHIVE_TLS_KEY_FILE), cert: await readFile(environment.OPERATIONS_GITHUB_ARCHIVE_TLS_CERT_FILE) } : undefined;
  if (!tls && (environment.OPERATIONS_GITHUB_ARCHIVE_TRUSTED_TLS_PROXY !== '1' || !['127.0.0.1', '::1'].includes(hostname))) throw new Error('Trusted HTTPS is required.');
  const server = (tls ? httpsServer : httpServer)(tls ?? {}, (req, res) => { void companion.handle(req, res); });
  server.on('upgrade', (_req, socket) => socket.destroy()); server.maxConnections = 16;
  server.requestTimeout = 25000; server.headersTimeout = 10000;
  const port = Number(environment.OPERATIONS_GITHUB_ARCHIVE_PORT ?? 8449);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid archive companion port.');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
  return { server, async close() { companion.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await runGithubArchiveCompanion();
  const close = () => { void service.close().finally(() => process.exit()); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
