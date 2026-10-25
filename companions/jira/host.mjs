// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

export const jiraCompanionProfile = 'atlassian-jira-3lo-v1';
const issuer = 'https://auth.atlassian.com', gateway = 'https://api.atlassian.com';
const scope = 'read:jira-user offline_access', tokenLimit = 16384, responseLimit = 8 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= tokenLimit && !/[^\x21-\x7e]/.test(value);
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const allowedHeaders = ['authorization', 'content-type', 'x-operations-companion', 'x-operations-claim', 'x-operations-connection'];
class CompanionError extends Error { constructor(status = 403) { super('The Jira connection is unavailable. Connect again or check the companion configuration.'); this.status = status; } }
function requireObject(value, keys) {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw new CompanionError(400);
  return value;
}
function origin(value, loopback = false) {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.protocol !== 'https:'
    && !(loopback && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new CompanionError(400);
  return value;
}
function siteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/.test(url.hostname) || url.hostname === 'your-domain.atlassian.net') throw new CompanionError();
  return url.origin;
}
function scrub(value, secrets) {
  const sensitive = [...new Set(secrets.filter(Boolean).flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))].sort((a, b) => b.length - a.length);
  const text = value => { for (const secret of sensitive) value = value.split(secret).join('[redacted]'); return value; };
  const visit = (value, depth = 0) => {
    if (depth > 40) throw new CompanionError(502);
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), visit(item, depth + 1)]));
    return value;
  };
  return visit(value);
}
async function jsonBody(response, limit, signal) {
  const reader = response.body?.getReader(); if (!reader) throw new CompanionError(502);
  const chunks = []; let length = 0, empty = 0;
  let abort;
  const cancelled = new Promise((_resolve, reject) => { abort = () => reject(new CompanionError(502)); });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    while (true) {
      const { value, done } = await Promise.race([reader.read(), cancelled]); if (done) break;
      if (!value.length && ++empty > 1024) throw new CompanionError(502);
      length += value.length; if (length > limit) throw new CompanionError(413); chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Fixed-profile confidential client. No arbitrary URL, method or token relay. */
export async function createJiraCompanion(input, runtime) {
  const config = structuredClone(input), store = runtime.store, now = runtime.now ?? Date.now;
  const publicOrigin = origin(config.publicOrigin, true);
  if (!uuid(config.hostId) || !secret(config.clientId) || config.clientId.length > 256 || !secret(config.clientSecret)
    || !/^[A-Za-z0-9_-]{43}$/.test(config.accessKey) || !Array.isArray(config.operationsOrigins) || !config.operationsOrigins.length
    || config.operationsOrigins.length > 16 || config.operationsOrigins.some(value => origin(value, true) !== value)) throw new CompanionError(400);
  const redirectUri = publicOrigin + '/oauth/jira/callback';
  const fingerprint = hash(JSON.stringify({ profile: jiraCompanionProfile, publicOrigin, hostId: config.hostId, clientId: config.clientId,
    secret: hash(config.clientSecret), key: hash(config.accessKey), operationsOrigins: [...config.operationsOrigins].sort(), redirectUri, scope }));
  const configuration = { profile: jiraCompanionProfile, hostId: config.hostId, publicOrigin, clientId: config.clientId, redirectUri,
    fingerprint, audience: 'api.atlassian.com', scope };
  const pending = new Map(), queues = new Map(), controllers = new Set();
  let closed = false;
  const fixedSecrets = [config.clientSecret, config.accessKey];
  for (const record of await store.list()) {
    if (!uuid(record.id) || record.fingerprint !== fingerprint || record.origin && !config.operationsOrigins.includes(record.origin)
      || record.grantExpiresAt <= now()) await store.remove(record.id);
  }
  const guard = task => { if (closed || pending.get(task.id) !== task || task.expiresAt <= now()) throw new CompanionError(); };
  function expire() {
    for (const [id, task] of pending) if (task.expiresAt <= now()) { task.controller?.abort(); pending.delete(id); }
  }
  const timer = setInterval(expire, 30000); timer.unref?.();
  async function serialized(id, action) {
    const previous = queues.get(id) ?? Promise.resolve(), current = previous.catch(() => {}).then(action);
    queues.set(id, current);
    try { return await current; } finally { if (queues.get(id) === current) queues.delete(id); }
  }
  async function provider(address, init, limit = 65536, externalSignal) {
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => controller.abort(); externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted || closed) abort();
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await (runtime.fetchRequest ?? fetch)(address, { ...init, signal: controller.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (controller.signal.aborted || response.redirected || response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CompanionError(502);
      const body = await jsonBody(response, limit, controller.signal);
      return { status: response.status, ok: response.ok, body };
    } finally { clearTimeout(timeout); externalSignal?.removeEventListener('abort', abort); controllers.delete(controller); }
  }
  async function tokens(parameters, previous, signal) {
    const result = await provider(issuer + '/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }) }, 65536, signal);
    const body = result.body;
    if (!result.ok || !object(body) || !secret(body.access_token) || !secret(body.refresh_token)
      || previous && body.refresh_token === previous.refreshToken || body.token_type !== undefined && String(body.token_type).toLowerCase() !== 'bearer'
      || !Number.isSafeInteger(body.expires_in) || body.expires_in < 1 || typeof body.scope !== 'string'
      || !body.scope.split(' ').includes('read:jira-user') || body.scope.split(' ').some(value => !['read:jira-user', 'offline_access'].includes(value))) throw new CompanionError(401);
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: now() + Math.min(86400, body.expires_in) * 1000 };
  }
  async function sites(token, signal) {
    const result = await provider(gateway + '/oauth/token/accessible-resources', { method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token.accessToken } }, 512 * 1024, signal);
    if (!result.ok || !Array.isArray(result.body) || result.body.length > 128) throw new CompanionError(401);
    const found = new Map();
    for (const item of result.body) {
      if (!Array.isArray(item.scopes) || !item.scopes.includes('read:jira-user')) continue;
      if (!uuid(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || /[\u0000-\u001f\u007f]/.test(item.name)) throw new CompanionError();
      const url = siteUrl(item.url), previous = found.get(item.id);
      if (previous && previous.url !== url) throw new CompanionError();
      const name = scrub(item.name, [...fixedSecrets, token.accessToken, token.refreshToken]);
      found.set(item.id, { id: item.id, name, url });
    }
    if (!found.size) throw new CompanionError(401);
    return [...found.values()];
  }
  async function myself(token, site, expand, signal) {
    const url = new URL(gateway + '/ex/jira/' + site.id + '/rest/api/3/myself');
    if (expand) url.searchParams.set('expand', expand);
    return provider(url.href, { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + token.accessToken } }, responseLimit, signal);
  }
  function account(result, secrets) {
    const id = result.body?.accountId;
    if (!result.ok || !object(result.body) || typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id)
      || result.body.active === false || scrub(id, secrets) !== id) throw new CompanionError(401);
    return id;
  }
  function claim(task, request, requestOrigin) {
    const value = request.headers.get('X-Operations-Claim');
    if (!task || task.origin !== requestOrigin || !/^[A-Za-z0-9_-]{43}$/.test(value ?? '') || !equal(hash(value), task.challenge)) throw new CompanionError();
    guard(task); return task;
  }
  const headers = requestOrigin => ({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'X-Operations-Companion': fingerprint, ...(requestOrigin ? { 'Access-Control-Allow-Origin': requestOrigin, Vary: 'Origin',
      'Access-Control-Expose-Headers': 'X-Operations-Companion' } : {}) });
  const reply = (value, status, requestOrigin) => Response.json(value, { status, headers: headers(requestOrigin) });
  async function handle(request) {
    let requestOrigin;
    try {
      if (closed) throw new CompanionError(503);
      const url = new URL(request.url); if (url.origin !== publicOrigin) throw new CompanionError(400);
      if (request.method === 'GET' && url.pathname === '/oauth/jira/complete') {
        const script = "document.getElementById('close').addEventListener('click',()=>window.close());window.close();";
        const integrity = createHash('sha256').update(script).digest('base64');
        return new Response('<!doctype html><meta charset="utf-8"><title>Jira sign-in complete</title><p>Return to Operations to select your Jira site.</p><button id="close" type="button">Close this sign-in window</button><script>' + script + '</script>', {
          headers: { ...headers(), 'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; script-src 'sha256-" + integrity + "'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
      }
      if (request.method === 'GET' && url.pathname === '/oauth/jira/callback') {
        expire();
        const state = url.searchParams.get('state'), task = [...pending.values()].find(value => value.state === state && value.phase === 'waiting');
        if (task) {
          delete task.state; task.phase = 'exchanging'; task.controller = new AbortController();
          try {
            const entries = [...url.searchParams];
            if (entries.some(([key]) => !['state', 'code', 'error', 'error_description'].includes(key)) || new Set(entries.map(([key]) => key)).size !== entries.length
              || url.searchParams.has('error') || !secret(url.searchParams.get('code')) || url.searchParams.get('code').length > 4096) throw new CompanionError();
            task.tokens = await tokens({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirectUri }, undefined, task.controller.signal);
            guard(task); task.sites = await sites(task.tokens, task.controller.signal); guard(task); task.phase = 'choose-site';
          } catch { task.phase = 'failed'; delete task.tokens; delete task.sites; }
        }
        return new Response(null, { status: 303, headers: { ...headers(), Location: publicOrigin + '/oauth/jira/complete' } });
      }
      const incoming = request.headers.get('Origin');
      if (!incoming || !config.operationsOrigins.includes(incoming)) throw new CompanionError();
      requestOrigin = incoming;
      if (request.method === 'OPTIONS') {
        const requested = (request.headers.get('Access-Control-Request-Headers') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
        if (!['GET', 'POST', 'DELETE'].includes(request.headers.get('Access-Control-Request-Method')) || requested.some(name => !allowedHeaders.includes(name))) throw new CompanionError();
        return new Response(null, { status: 204, headers: { ...headers(requestOrigin), 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': allowedHeaders.join(', '), 'Access-Control-Max-Age': '300' } });
      }
      if (!equal(request.headers.get('Authorization'), 'Bearer ' + config.accessKey)) throw new CompanionError();
      if (url.search || url.hash) throw new CompanionError(400);
      if (request.method === 'POST' && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CompanionError(415);
      if (request.method === 'GET' && url.pathname === '/v1/jira/config') return reply(configuration, 200, requestOrigin);
      if (request.headers.get('X-Operations-Companion') !== fingerprint) throw new CompanionError(409);
      expire();
      if (request.method === 'POST' && url.pathname === '/v1/jira/authorizations') {
        const body = requireObject(await jsonBody(request, 4096, request.signal), ['challenge']);
        if (!/^[a-f0-9]{64}$/.test(body.challenge ?? '') || pending.size >= 64 || [...pending.values()].filter(value => value.origin === requestOrigin).length >= 8) throw new CompanionError(429);
        const task = { id: randomUUID(), state: random(), origin: requestOrigin, challenge: body.challenge, expiresAt: now() + 300000, phase: 'waiting' };
        pending.set(task.id, task);
        const authorization = new URL(issuer + '/authorize');
        for (const [key, value] of Object.entries({ audience: 'api.atlassian.com', client_id: config.clientId, scope,
          redirect_uri: redirectUri, state: task.state, response_type: 'code', prompt: 'consent' })) authorization.searchParams.set(key, value);
        return reply({ id: task.id, authorizationUrl: authorization.href, expiresAt: task.expiresAt, fingerprint }, 201, requestOrigin);
      }
      const pendingPath = /^\/v1\/jira\/authorizations\/([a-f0-9-]{36})(?:\/(select))?$/.exec(url.pathname);
      if (pendingPath) {
        const task = claim(pending.get(pendingPath[1]), request, requestOrigin);
        if (request.method === 'DELETE' && !pendingPath[2]) { task.controller?.abort(); pending.delete(task.id); if (task.result) await store.remove(task.result.id); return reply({ removed: true }, 200, requestOrigin); }
        if (request.method === 'GET' && !pendingPath[2]) return reply({ phase: task.phase, ...(task.phase === 'choose-site' ? { sites: task.sites } : {}) }, 200, requestOrigin);
        if (request.method === 'POST' && pendingPath[2] === 'select') return await serialized(task.id, async () => {
          guard(task);
          const body = requireObject(await jsonBody(request, 4096, request.signal), ['cloudId']);
          if (task.phase !== 'choose-site' || !uuid(body.cloudId)) throw new CompanionError();
          const site = task.sites.find(item => item.id === body.cloudId); if (!site) throw new CompanionError();
          const result = await myself(task.tokens, site, undefined, request.signal); guard(task);
          const accountId = account(result, [...fixedSecrets, task.tokens.accessToken, task.tokens.refreshToken]);
          const capability = random(), record = { id: randomUUID(), fingerprint, origin: requestOrigin, site, accountId, tokens: task.tokens,
            capabilityHash: hash(capability), grantExpiresAt: now() + 90 * 86400000 };
          task.result = { id: record.id, capability };
          await store.put(record);
          try { guard(task); } catch (error) { await store.remove(record.id); throw error; }
          task.phase = 'connected'; delete task.tokens; delete task.sites;
          return reply({ id: record.id, capability, fingerprint, profile: jiraCompanionProfile, hostId: config.hostId, clientId: config.clientId,
            redirectUri, scope, cloudId: site.id, siteUrl: site.url, accountId }, 201, requestOrigin);
        });
        throw new CompanionError(405);
      }
      const connectionPath = /^\/v1\/jira\/connections\/([a-f0-9-]{36})(?:\/(myself))?$/.exec(url.pathname);
      if (connectionPath) return await serialized(connectionPath[1], async () => {
        let record = await store.get(connectionPath[1]); const capability = request.headers.get('X-Operations-Connection');
        if (!record && request.method === 'DELETE' && !connectionPath[2]) return reply({ removed: true }, 200, requestOrigin);
        if (!record || record.fingerprint !== fingerprint || record.origin !== requestOrigin
          || !/^[A-Za-z0-9_-]{43}$/.test(capability ?? '') || !equal(hash(capability), record.capabilityHash)) throw new CompanionError(401);
        if (request.method === 'DELETE' && !connectionPath[2]) { await store.remove(record.id); return reply({ removed: true }, 200, requestOrigin); }
        if (record.invalid || record.tokens?.refreshPending || record.grantExpiresAt <= now()) throw new CompanionError(401);
        if (request.method !== 'POST' || connectionPath[2] !== 'myself') throw new CompanionError(405);
        const body = requireObject(await jsonBody(request, 4096, request.signal), ['requestId', 'expand']);
        if (!uuid(body.requestId) || body.expand !== undefined && (typeof body.expand !== 'string' || body.expand.length > 128
          || body.expand.split(',').some(value => !['groups', 'applicationRoles'].includes(value)))) throw new CompanionError(400);
        const secrets = [...fixedSecrets, capability, record.tokens.accessToken, record.tokens.refreshToken];
        if (record.tokens.expiresAt <= now() + 30000) {
          record = { ...record, tokens: { ...record.tokens, refreshPending: true } }; await store.put(record);
          const fresh = await tokens({ grant_type: 'refresh_token', refresh_token: record.tokens.refreshToken }, record.tokens, request.signal);
          secrets.push(fresh.accessToken, fresh.refreshToken);
          const available = await sites(fresh, request.signal);
          if (!available.some(site => site.id === record.site.id && site.url === record.site.url)) throw new CompanionError(401);
          record = { ...record, tokens: fresh, grantExpiresAt: now() + 90 * 86400000 };
        }
        const result = await myself(record.tokens, record.site, body.expand, request.signal);
        if (result.ok && account(result, secrets) !== record.accountId) { await store.put({ ...record, invalid: true }); throw new CompanionError(401); }
        if (!result.ok && [401, 403].includes(result.status)) record.invalid = true;
        await store.put(record);
        const safe = scrub(result.body, secrets);
        return reply({ requestId: body.requestId, fingerprint, cloudId: record.site.id, accountId: record.accountId,
          response: { status: result.status, statusText: '', headers: { 'content-type': 'application/json' }, body: safe,
            ...(JSON.stringify(safe) !== JSON.stringify(result.body) ? { redacted: true } : {}) } }, 200, requestOrigin);
      });
      throw new CompanionError(404);
    } catch (error) {
      return reply({ error: 'jira_connection_unavailable' }, error instanceof CompanionError ? error.status : 502, requestOrigin);
    }
  }
  return { configuration: structuredClone(configuration), handle,
    async close() { closed = true; clearInterval(timer); for (const controller of controllers) controller.abort(); for (const task of pending.values()) task.controller?.abort(); pending.clear(); await Promise.allSettled([...queues.values()]); await store.close(); } };
}
