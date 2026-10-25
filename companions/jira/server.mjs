// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createJiraCompanion } from './host.mjs';
import { openJiraStore } from './store.mjs';

/** Shared with native browser fixtures; no request URLs or credentials are logged. */
export async function handleJiraNodeRequest(companion, publicOrigin, incoming, outgoing) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 35000);
  incoming.on('aborted', () => controller.abort());
  outgoing.on('close', () => { if (!outgoing.writableFinished) controller.abort(); });
  try {
    if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) throw new Error();
    const bytes = []; let length = 0;
    for await (const chunk of incoming) { length += chunk.length; if (length > 8192) throw new Error(); bytes.push(chunk); }
    const method = incoming.method ?? 'GET', headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
    const request = new Request(publicOrigin + incoming.url, { method, headers, signal: controller.signal,
      ...(!['GET', 'HEAD'].includes(method) ? { body: Buffer.concat(bytes, length) } : {}) });
    const response = await companion.handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end('{"error":"jira_connection_unavailable"}');
  } finally { clearTimeout(timeout); }
}

export async function runJiraCompanion(environment = process.env) {
  const loadSecret = async name => {
    const filename = environment[name + '_FILE'];
    const value = filename ? (await readFile(filename, 'utf8')).trim() : environment[name];
    if (!value) throw new Error(); return value;
  };
  const config = { publicOrigin: environment.OPERATIONS_JIRA_PUBLIC_ORIGIN, hostId: environment.OPERATIONS_JIRA_HOST_ID,
    clientId: environment.OPERATIONS_JIRA_CLIENT_ID, clientSecret: await loadSecret('OPERATIONS_JIRA_CLIENT_SECRET'),
    accessKey: await loadSecret('OPERATIONS_JIRA_ACCESS_KEY'), operationsOrigins: JSON.parse(environment.OPERATIONS_JIRA_ALLOWED_ORIGINS ?? '[]') };
  const publicUrl = new URL(config.publicOrigin), loopback = publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  const tls = environment.OPERATIONS_JIRA_TLS_KEY_FILE && environment.OPERATIONS_JIRA_TLS_CERT_FILE
    ? { key: await readFile(environment.OPERATIONS_JIRA_TLS_KEY_FILE), cert: await readFile(environment.OPERATIONS_JIRA_TLS_CERT_FILE) } : undefined;
  if (!tls && !loopback && environment.OPERATIONS_JIRA_TRUSTED_TLS_PROXY !== '1') throw new Error();
  const store = await openJiraStore(environment.OPERATIONS_JIRA_DATA_DIRECTORY,
    await loadSecret('OPERATIONS_JIRA_STORAGE_KEY'), config.hostId);
  const companion = await createJiraCompanion(config, { store });
  const server = (tls ? httpsServer : httpServer)(tls ?? {}, (incoming, outgoing) => {
    void handleJiraNodeRequest(companion, config.publicOrigin, incoming, outgoing);
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  const port = Number(environment.OPERATIONS_JIRA_PORT ?? (publicUrl.port || (tls ? 8445 : 8085)));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  const hostname = environment.OPERATIONS_JIRA_LISTEN_HOST ?? '127.0.0.1';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, hostname, resolve); });
  const close = async () => { await companion.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return { server, close, publicOrigin: config.publicOrigin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runJiraCompanion().then(({ close }) => {
    process.stdout.write('Jira companion ready.\n');
    const stop = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }).catch(() => { process.stderr.write('Jira companion could not start. Check its private configuration and storage.\n'); process.exitCode = 1; });
}
