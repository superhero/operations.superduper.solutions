// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { request } from 'node:http';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { nativeUuid } from '../../src/lib/native-runtime-contract.ts';
import { dockerNativeApi, dockerNativeLimits as limits, dockerIdentity, dockerReadPath, sameDockerIdentity } from '../../src/lib/docker-native-contract.ts';

export class DockerHostError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const digest = value => createHash('sha256').update(value).digest('hex');
const version = value => typeof value === 'string' && /^1\.\d{1,3}$/.test(value) ? Number(value.slice(2)) : NaN;
/** No CLI, environment discovery, socket fallback or browser-selected path. */
export async function openDockerSocket(config) {
  if (process.platform !== 'linux' || !nativeUuid(config.hostId) || typeof config.socketPath !== 'string' || !isAbsolute(config.socketPath))
    throw new DockerHostError('DOCKER_UNAVAILABLE');
  const path = resolve(config.socketPath), generation = randomUUID();
  async function socketIdentity() {
    try {
      const metadata = await lstat(path);
      if (!metadata.isSocket() || metadata.isSymbolicLink() || metadata.mode & 0o002 || await realpath(path) !== path)
        throw new DockerHostError('DOCKER_AUTHORITY');
      return digest(JSON.stringify([path, metadata.dev, metadata.ino]));
    } catch (error) { throw error instanceof DockerHostError ? error : new DockerHostError('DOCKER_UNAVAILABLE'); }
  }
  await socketIdentity();
  async function json(pathname, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => { if (!settled) { settled = true; reject(error instanceof DockerHostError ? error : new DockerHostError('DOCKER_UNAVAILABLE')); } };
      const deadline = AbortSignal.timeout(limits.socketMs), cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const req = request({ socketPath: path, path: pathname, method: 'GET', agent: false,
        headers: { Accept: 'application/json', Connection: 'close' }, signal: cancellation }, res => {
        const media = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (res.statusCode === 101 || res.headers.upgrade || media?.startsWith('application/vnd.docker.')) {
          res.destroy(); fail(new DockerHostError('DOCKER_DUPLEX')); return;
        }
        if (media !== 'application/json') { res.destroy(); fail(new DockerHostError('DOCKER_UNAVAILABLE')); return; }
        const chunks = []; let size = 0;
        res.on('data', part => {
          size += part.length;
          if (size > limits.response) { res.destroy(); fail(new DockerHostError('LIMIT')); } else chunks.push(part);
        });
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          try {
            const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            const headers = Object.fromEntries(['content-type', 'api-version', 'docker-experimental', 'ostype', 'server']
              .filter(key => typeof res.headers[key] === 'string').map(key => [key, res.headers[key]]));
            settled = true; resolve({ status: res.statusCode, statusText: res.statusMessage ?? '', headers, body, mediaType: 'application/json' });
          } catch { fail(new DockerHostError('DOCKER_UNAVAILABLE')); }
        });
      });
      req.on('upgrade', (_res, socket) => { socket.destroy(); fail(new DockerHostError('DOCKER_DUPLEX')); });
      req.on('error', fail); req.end();
    });
  }
  async function authority(signal) {
    const socket = await socketIdentity(), reported = await json('/version', signal);
    if (reported.status !== 200 || !Number.isFinite(version(reported.body?.ApiVersion))
      || !Number.isFinite(version(reported.body?.MinAPIVersion)) || version(reported.body.MinAPIVersion) > version(dockerNativeApi)
      || version(reported.body.ApiVersion) < version(dockerNativeApi)) throw new DockerHostError('DOCKER_VERSION');
    const info = await json('/v' + dockerNativeApi + '/info', signal);
    if (info.status !== 200 || await socketIdentity() !== socket) throw new DockerHostError('DOCKER_AUTHORITY');
    return dockerIdentity({ hostId: config.hostId, generation, socket, apiVersion: dockerNativeApi, daemonId: info.body?.ID,
      configuration: digest(JSON.stringify([path, dockerNativeApi, limits.response, 'ContainerList', false])) });
  }
  async function read(expected, params, signal) {
    const before = await authority(signal);
    if (!sameDockerIdentity(expected, before)) throw new DockerHostError('DOCKER_AUTHORITY');
    const response = await json(dockerReadPath(params), signal);
    if (!sameDockerIdentity(before, await authority(signal))) throw new DockerHostError('DOCKER_AUTHORITY');
    if (response.status === 200 && !Array.isArray(response.body)) throw new DockerHostError('DOCKER_UNAVAILABLE');
    return response;
  }
  return { authority, read };
}
