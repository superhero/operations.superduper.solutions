// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { timingSafeEqual } from 'node:crypto';
import { nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { dockerNativeProfile as profile, dockerNativeLimits as limits, dockerIdentity, dockerScope,
  dockerReadParams, sameDockerIdentity } from '../../src/lib/docker-native-contract.ts';
import { DockerHostError } from './runtime.mjs';

/** A separate origin/key authorizes one fixed Docker read, never a generic proxy. */
export function createDockerCompanion(config, runtime) {
  const url = new URL(config.publicOrigin), allowed = config.allowedOrigins;
  if (url.origin !== config.publicOrigin || url.protocol !== 'https:' || !/^[A-Za-z0-9_-]{43,256}$/.test(config.pairingKey)
    || !Array.isArray(allowed) || !allowed.length || allowed.length > 8 || allowed.some(value => {
      const origin = new URL(value); return origin.origin !== value || origin.protocol !== 'https:'
        && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
    })) throw new Error('Invalid Docker companion configuration.');
  const pairs = new Map(), controllers = new Set(), now = runtime.now ?? Date.now;
  let closed = false;
  const key = value => {
    const actual = Buffer.from(typeof value === 'string' ? value : ''), expected = Buffer.from('Bearer ' + config.pairingKey);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  async function handle(req, res) {
    const origin = req.headers.origin;
    const answer = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
        'Cross-Origin-Resource-Policy': 'cross-origin', ...(allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '0' } : {}) });
      res.end(JSON.stringify(value));
    };
    let controller;
    try {
      if (closed || !allowed.includes(origin) || !['/v1/docker/pair', '/v1/docker/read'].includes(req.url)) return answer(403, { error: 'PERMISSION' });
      if (req.method === 'OPTIONS') {
        const headers = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim());
        return req.headers['access-control-request-method'] === 'POST' && headers.every(value => ['authorization', 'content-type'].includes(value))
          ? answer(204, undefined) : answer(403, { error: 'PERMISSION' });
      }
      if (req.method !== 'POST' || !key(req.headers.authorization) || req.headers['content-type'] !== 'application/json') return answer(401, { error: 'PERMISSION' });
      if (controllers.size >= limits.pending) return answer(429, { error: 'LIMIT' });
      controller = new AbortController(); controllers.add(controller);
      res.once('close', () => { if (!res.writableFinished) controller.abort(); });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.requestMs)]);
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > limits.input) throw new DockerHostError('LIMIT'); parts.push(part); }
      const pairing = req.url === '/v1/docker/pair', input = nativeObject(JSON.parse(Buffer.concat(parts).toString('utf8')),
        pairing ? ['profile', 'scope'] : ['profile', 'scope', 'identity', 'params']);
      if (input.profile !== profile) throw new DockerHostError('PERMISSION');
      const scope = dockerScope(input.scope);
      for (const [id, pair] of pairs) if (pair.expiresAt <= now()) pairs.delete(id);
      if (pairing) {
        if (pairs.size >= limits.pairings && !pairs.has(scope.connectionId)) throw new DockerHostError('LIMIT');
        const identity = dockerIdentity(await runtime.authority(signal)), expiresAt = now() + limits.sessionMs;
        pairs.set(scope.connectionId, { identity, scope, origin, expiresAt });
        return answer(200, { profile, scope, identity, expiresAt });
      }
      const selected = pairs.get(scope.connectionId), identity = dockerIdentity(input.identity);
      if (!selected || selected.origin !== origin || selected.scope.fingerprint !== scope.fingerprint || !sameDockerIdentity(selected.identity, identity)) throw new DockerHostError('DOCKER_AUTHORITY');
      const response = await runtime.read(identity, dockerReadParams(input.params), signal);
      if (signal.aborted || closed || now() >= selected.expiresAt) throw new DockerHostError('DOCKER_AUTHORITY');
      return answer(200, { profile, scope, identity, response });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) answer(400, { error: error instanceof DockerHostError ? error.code : 'PERMISSION' });
    } finally { if (controller) controllers.delete(controller); }
  }
  return { handle, close() { closed = true; pairs.clear(); for (const controller of controllers) controller.abort(); controllers.clear(); } };
}
