// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer, request } from 'node:https';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createCodexCompanion } from '../companions/codex/host.mjs';
import { nativeRuntimeProfile, nativeRuntimeVersion } from '../src/lib/native-runtime-contract.ts';

export async function nativeTlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-native-tls-'));
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', join(directory, 'key'), '-out', join(directory, 'cert')], { timeout: 10000, maxBuffer: 8192 });
  return { key: await readFile(join(directory, 'key')), cert: await readFile(join(directory, 'cert')),
    close: () => rm(directory, { recursive: true, force: true }) };
}
export async function nativeHostFixture(options = {}) {
  const tls = await nativeTlsFixture(), applicationOrigin = options.applicationOrigin ?? 'https://operations.test';
  const key = randomBytes(32).toString('base64url'); let offset = 0, host;
  const f = { key, applicationOrigin, starts: 0, stops: 0, frames: [], requests: [], sockets: [], hold: false, echo: false,
    identity: { runtimeId: randomUUID(), generation: randomUUID(), version: nativeRuntimeVersion,
      configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() }, now: () => Date.now() + offset,
    advance: ms => offset += ms, release: [] };
  const runtime = options.runtime ?? { now: f.now, authority: async () => structuredClone(f.identity),
    async start(receive, exited) {
      f.starts++; f.emit = receive; let stopped = false;
      return { send(frame) {
        f.frames.push(structuredClone(frame));
        if (!Object.hasOwn(frame, 'id')) return;
        const result = frame.method === 'initialize' ? { userAgent: 'codex/0.163.0' }
          : { account: options.account ?? null, requiresOpenaiAuth: true, ...(f.echo ? { echo: key } : {}) };
        const reply = () => { if (!stopped) receive({ id: frame.id, result }); };
        if (f.hold && frame.method === 'account/read') f.release.push(reply); else queueMicrotask(reply);
      }, async close() { if (!stopped) { stopped = true; f.stops++; exited(); } } };
    } };
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    f.requests.push({ path: req.url, method: req.method, origin: req.headers.origin, authorization: !!req.headers.authorization,
      cookie: !!req.headers.cookie, requestedHeaders: req.headers['access-control-request-headers'] ?? '' });
    void host.handle(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const publicOrigin = 'https://127.0.0.1:' + server.address().port;
  host = createCodexCompanion({ publicOrigin, pairingKey: key, allowedOrigins: options.allowedOrigins ?? [applicationOrigin] }, runtime);
  server.on('upgrade', (req, socket, head) => {
    f.sockets.push({ path: req.url, origin: req.headers.origin, protocol: req.headers['sec-websocket-protocol'], cookie: !!req.headers.cookie });
    host.upgrade(req, socket, head);
  });
  f.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers)); headers.origin ??= applicationOrigin;
    const req = request(url, { method: init.method ?? 'GET', headers, rejectUnauthorized: false, signal: init.signal }, res => {
      const chunks = []; res.on('data', part => chunks.push(part)); res.on('end', () => resolve(new Response(
        res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(init.body);
  });
  f.Socket = class extends WebSocket { constructor(url) { super(url, { origin: applicationOrigin, rejectUnauthorized: false }); } };
  f.runtime = { fetch: f.fetch, WebSocket: f.Socket, now: f.now, requestMs: 1000 };
  f.publicOrigin = publicOrigin; f.host = host; f.server = server;
  f.ticket = async (scope = { connectionId: randomUUID(), method: 'account/read', fingerprint: 'c'.repeat(64) }, headers = {}) => {
    const response = await f.fetch(publicOrigin + '/v1/codex/tickets', { method: 'POST', headers: {
      Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ profile: nativeRuntimeProfile, version: nativeRuntimeVersion, scope }) });
    return { status: response.status, value: response.status === 200 ? await response.json() : undefined };
  };
  f.socket = async (ticket, options = {}) => {
    const ws = new WebSocket(publicOrigin.replace('https:', 'wss:') + '/v1/codex/socket', { origin: applicationOrigin, rejectUnauthorized: false, ...options });
    const messages = [], waits = [];
    ws.on('message', data => { const value = JSON.parse(data.toString()); messages.push(value); for (const done of waits.splice(0)) done(); });
    ws.on('error', () => {});
    await new Promise(resolve => { ws.once('open', () => { if (ticket) ws.send(JSON.stringify({ type: 'pair', ticket })); resolve(); }); ws.once('error', resolve); });
    return { ws, messages, async next() {
      const count = messages.length;
      if (!count) await new Promise(resolve => { const timer = setTimeout(resolve, 1500); waits.push(() => { clearTimeout(timer); resolve(); }); ws.once('close', () => { clearTimeout(timer); resolve(); }); });
      return messages.shift();
    }, close: () => new Promise(resolve => { if (ws.readyState === 3) resolve(); else { ws.once('close', resolve); ws.close(); } }) };
  };
  f.close = async () => { await host.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); };
  return f;
}
