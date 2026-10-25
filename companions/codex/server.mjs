// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpsServer } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createCodexCompanion } from './host.mjs';
import { openCodexRuntime } from './runtime.mjs';

export async function runCodexCompanion(environment = process.env) {
  const pairingKey = (await readFile(environment.OPERATIONS_CODEX_PAIRING_KEY_FILE, 'utf8')).trim();
  const publicOrigin = environment.OPERATIONS_CODEX_PUBLIC_ORIGIN;
  const runtime = await openCodexRuntime({ runtimeId: environment.OPERATIONS_CODEX_RUNTIME_ID,
    executable: environment.OPERATIONS_CODEX_EXECUTABLE, binarySha256: environment.OPERATIONS_CODEX_BINARY_SHA256,
    home: environment.OPERATIONS_CODEX_HOME, workspace: environment.OPERATIONS_CODEX_WORKSPACE,
    allowAgent: environment.OPERATIONS_CODEX_ALLOW_AGENT === '1' });
  const companion = createCodexCompanion({ publicOrigin, pairingKey,
    allowedOrigins: JSON.parse(environment.OPERATIONS_CODEX_ALLOWED_ORIGINS ?? '[]'),
    allowAgent: environment.OPERATIONS_CODEX_ALLOW_AGENT === '1' }, runtime);
  const tls = environment.OPERATIONS_CODEX_TLS_KEY_FILE && environment.OPERATIONS_CODEX_TLS_CERT_FILE
    ? { key: await readFile(environment.OPERATIONS_CODEX_TLS_KEY_FILE), cert: await readFile(environment.OPERATIONS_CODEX_TLS_CERT_FILE) } : undefined;
  const hostname = environment.OPERATIONS_CODEX_LISTEN_HOST ?? '127.0.0.1';
  if (!tls && (environment.OPERATIONS_CODEX_TRUSTED_TLS_PROXY !== '1' || !['127.0.0.1', '::1'].includes(hostname))) throw new Error('Trusted HTTPS/WSS is required.');
  const server = (tls ? httpsServer : httpServer)(tls ?? {}, (request, response) => { void companion.handle(request, response); });
  server.on('upgrade', companion.upgrade); server.maxConnections = 32;
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 5000;
  const port = Number(environment.OPERATIONS_CODEX_PORT ?? '8446');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid companion port.');
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
  return { server, publicOrigin, async close() { await companion.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCodexCompanion().then(({ close }) => {
    process.stdout.write('Codex companion ready.\n');
    const stop = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }).catch(() => { process.stderr.write('Codex companion could not start. Check its private configuration, TLS and pinned runtime.\n'); process.exitCode = 1; });
}
