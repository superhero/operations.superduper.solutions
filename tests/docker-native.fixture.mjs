// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer, request } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { nativeTlsFixture } from './native-runtime.fixture.mjs';
import { openDockerSocket } from '../companions/docker/runtime.mjs';
import { createDockerCompanion } from '../companions/docker/host.mjs';
import { dockerNativeProfile, dockerNativeApi, dockerNativeOperationId } from '../src/lib/docker-native-contract.ts';

export async function dockerNativeFixture(options = {}) {
  const tls = await nativeTlsFixture(), directory = await mkdtemp(join(tmpdir(), 'ops-docker-'));
  const f = { directory, socketPath: join(directory, 'engine.sock'), hostId: randomUUID(), daemonId: randomUUID(), apiMax: '1.57', apiMin: '1.44',
    key: randomBytes(32).toString('base64url'), applicationOrigin: options.applicationOrigin ?? 'https://operations.test', engineRequests: [], requests: [],
    hold: false, duplex: false, media: 'application/json', status: 200, body: [{ Id: 'synthetic-container', Names: ['/synthetic'], State: 'running' }], held: [], aborted: 0 };
  let offset = 0; f.now = () => Date.now() + offset; f.advance = value => offset += value;
  const engine = httpServer((req, res) => {
    f.engineRequests.push({ method: req.method, path: req.url });
    const answer = (status, body, media = 'application/json') => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': media, 'Api-Version': f.apiMax }); res.end(JSON.stringify(body)); } };
    if (req.method !== 'GET') return answer(405, { message: 'Synthetic endpoint refuses mutations' });
    if (req.url === '/version') return answer(200, { ApiVersion: f.apiMax, MinAPIVersion: f.apiMin });
    if (req.url === '/v1.57/info') return answer(200, { ID: f.daemonId });
    if (req.url.startsWith('/v1.57/containers/json')) {
      res.once('close', () => { if (!res.writableFinished) f.aborted++; });
      const result = () => {
        if (f.duplex) { res.writeHead(101, { Connection: 'Upgrade', Upgrade: 'tcp', 'Content-Type': 'application/vnd.docker.raw-stream' }); res.end(); }
        else answer(f.status, f.body, f.media);
      };
      if (f.hold) f.held.push(result); else result(); return;
    }
    answer(404, { message: 'Not an allowed fixture route' });
  });
  await new Promise(resolve => engine.listen(f.socketPath, resolve));
  const runtime = await openDockerSocket({ hostId: f.hostId, socketPath: f.socketPath });
  let companion;
  const server = httpsServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    f.requests.push({ method: req.method, path: req.url, origin: req.headers.origin, authorized: !!req.headers.authorization, cookie: !!req.headers.cookie });
    void companion.handle(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  f.host = 'https://127.0.0.1:' + server.address().port;
  companion = createDockerCompanion({ publicOrigin: f.host, allowedOrigins: options.allowedOrigins ?? [f.applicationOrigin], pairingKey: f.key }, { ...runtime, now: f.now });
  f.fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers)); headers.origin ??= f.applicationOrigin;
    const req = request(url, { method: init.method ?? 'GET', headers, signal: init.signal, rejectUnauthorized: false }, res => {
      const chunks = []; res.on('data', part => chunks.push(part)); res.on('end', () => resolve(new Response(
        res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    }); req.on('error', reject); req.end(init.body);
  });
  f.runtime = { now: f.now, fetchRequest: f.fetch };
  f.scope = { connectionId: randomUUID(), operation: dockerNativeOperationId, apiVersion: dockerNativeApi, fingerprint: 'c'.repeat(64) };
  f.call = async (path, input = { profile: dockerNativeProfile, scope: f.scope }, headers = {}) => {
    const response = await f.fetch(f.host + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + f.key, ...headers }, body: JSON.stringify(input) });
    return { status: response.status, value: await response.json() };
  };
  f.close = async () => { companion.close(); server.closeAllConnections(); engine.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => engine.close(resolve))]);
    await tls.close(); await rm(directory, { recursive: true, force: true }); };
  return f;
}
