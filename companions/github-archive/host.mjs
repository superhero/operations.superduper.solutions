// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { timingSafeEqual } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { githubArchiveAddress, githubArchiveLimit, githubArchiveProfile } from '../../src/lib/github-archive.ts';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sameKey = (actual, expected) => typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected)
  && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
function origin(value, httpsOnly = true) {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.protocol !== 'https:'
    && (httpsOnly || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('PERMISSION');
  return value;
}
function storageOrigins(input) {
  if (!Array.isArray(input) || !input.length || input.length > 8 || new Set(input).size !== input.length) throw new Error('PERMISSION');
  return input.map(value => origin(value));
}
async function read(address, headers, signal, limit, runtime) {
  if (signal?.aborted) throw new Error('CANCELLED');
  return new Promise((resolve, reject) => {
    const request = (runtime.request ?? httpsRequest)(address, { method: 'GET', headers, signal,
      rejectUnauthorized: true, maxHeaderSize: 16384 }, response => {
      const parts = []; let size = 0;
      const length = response.headers['content-length'];
      if (length !== undefined && (typeof length !== 'string' || !/^[0-9]+$/.test(length) || Number(length) > limit)) {
        response.destroy(); request.destroy(new Error('LIMIT')); return;
      }
      response.on('data', part => {
        size += part.length;
        if (size > limit) { response.destroy(); request.destroy(new Error('LIMIT')); } else parts.push(part);
      });
      response.on('error', reject); response.on('aborted', () => reject(new Error('NETWORK')));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(parts) }));
    });
    request.on('error', reject); request.end();
  });
}
/** The only authenticated hop is api.github.com. Signed locations never leave this host. */
export async function forwardGithubArchive(input, allowedStorageOrigins, signal, runtime = {}) {
  const allowed = storageOrigins(allowedStorageOrigins);
  if (!object(input) || Object.keys(input).sort().join(',') !== 'address,authorization,fingerprint,profile'
    || input.profile !== githubArchiveProfile || typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint)
    || typeof input.authorization !== 'string' || input.authorization.length > 17000 || !/^Bearer [\x21-\x7e]+$/.test(input.authorization)) throw new Error('PERMISSION');
  githubArchiveAddress(input.address);
  const envelope = (status, body = null) => ({ profile: githubArchiveProfile, fingerprint: input.fingerprint, status, body });
  const first = await read(input.address, { authorization: input.authorization, accept: 'application/vnd.github+json' }, signal, 4096, runtime);
  if (first.status !== 302) {
    if (Number.isInteger(first.status) && first.status >= 400 && first.status <= 599) return envelope(first.status);
    throw new Error('NETWORK');
  }
  const location = first.headers.location;
  if (typeof location !== 'string' || location.length > 8192 || /[\x00-\x20\x7f\\]/.test(location)) throw new Error('NETWORK');
  const target = new URL(location);
  if (target.href !== location || target.protocol !== 'https:' || target.username || target.password || target.hash
    || target.origin === 'https://api.github.com' || !allowed.includes(target.origin)) throw new Error('PERMISSION');
  // No Authorization, cookies, referer or caller-controlled headers on storage.
  const archive = await read(location, { accept: 'application/octet-stream' }, signal, githubArchiveLimit, runtime);
  if (archive.status !== 200) {
    if (Number.isInteger(archive.status) && archive.status >= 400 && archive.status <= 599) return envelope(archive.status);
    throw new Error('NETWORK');
  }
  const media = archive.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (!['application/gzip', 'application/x-gzip', 'application/octet-stream'].includes(media)
    || archive.bytes[0] !== 0x1f || archive.bytes[1] !== 0x8b) throw new Error('NETWORK');
  return envelope(200, { kind: 'workflow-file', version: 1, name: 'migration.tar.gz', mediaType: 'application/gzip',
    size: archive.bytes.length, base64: archive.bytes.toString('base64') });
}
export function createGithubArchiveCompanion(config, runtime = {}) {
  const publicOrigin = origin(config.publicOrigin), allowed = config.allowedOrigins, storage = storageOrigins(config.storageOrigins);
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(config.pairingKey) || !Array.isArray(allowed) || !allowed.length || allowed.length > 8
    || allowed.some(value => origin(value, false) !== value || value === publicOrigin)) throw new Error('Invalid GitHub archive companion configuration.');
  const controllers = new Set(); let closed = false;
  async function handle(req, res) {
    const browserOrigin = req.headers.origin;
    const answer = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
        ...(allowed.includes(browserOrigin) ? { 'Access-Control-Allow-Origin': browserOrigin, 'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '0' } : {}) });
      res.end(value === undefined ? undefined : JSON.stringify(value));
    };
    let controller;
    try {
      if (closed || req.headers.host !== new URL(publicOrigin).host || !allowed.includes(browserOrigin) || req.url !== '/v1/github/migration-archive')
        return answer(403, { error: 'PERMISSION' });
      if (req.method === 'OPTIONS') {
        const requested = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        return req.headers['access-control-request-method'] === 'POST' && requested.every(value => ['authorization', 'content-type'].includes(value))
          ? answer(204) : answer(403, { error: 'PERMISSION' });
      }
      if (req.method !== 'POST' || !sameKey(req.headers.authorization, 'Bearer ' + config.pairingKey) || req.headers['content-type'] !== 'application/json')
        return answer(401, { error: 'PERMISSION' });
      if (controllers.size >= 4) return answer(429, { error: 'LIMIT' });
      controller = new AbortController(); controllers.add(controller);
      res.once('close', () => { if (!res.writableFinished) controller.abort(); });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      const parts = []; let size = 0;
      for await (const part of req) { size += part.length; if (size > 32768) throw new Error('LIMIT'); parts.push(part); }
      const result = await forwardGithubArchive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))), storage, signal, runtime);
      if (signal.aborted || closed) throw new Error('PERMISSION');
      answer(200, result);
    } catch { if (!res.headersSent && !res.destroyed) answer(400, { error: 'PERMISSION' }); }
    finally { if (controller) controllers.delete(controller); }
  }
  return { handle, close() { closed = true; for (const controller of controllers) controller.abort(); controllers.clear(); } };
}
