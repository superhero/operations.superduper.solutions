// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { nativeIdentity, nativeObject, nativeScope, sameNativeIdentity, nativeRuntimeProfile as profile,
  nativeRuntimeVersion as version, nativeRuntimeLimits as limits } from '../../src/lib/native-runtime-contract.ts';

/** Browser access is paired before an owned stdio child can start. No proxy or
 * arbitrary-method surface is exposed by the read-only pairing profile. */
export function createCodexCompanion(config, runtime) {
  const publicUrl = new URL(config.publicOrigin);
  if (publicUrl.protocol !== 'https:' || publicUrl.origin !== config.publicOrigin || !/^[A-Za-z0-9_-]{43,256}$/.test(config.pairingKey)
    || !Array.isArray(config.allowedOrigins) || !config.allowedOrigins.length || config.allowedOrigins.length > 8
    || config.allowedOrigins.some(value => {
      const origin = new URL(value); return origin.origin !== value || origin.protocol !== 'https:'
        && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
    })) throw new Error('Invalid native companion configuration.');
  const now = runtime.now ?? Date.now, tickets = new Map(), unpaired = new Set();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: limits.frame, perMessageDeflate: false });
  const stopping = new Set();
  let active, closed = false;
  const headers = origin => ({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
    'Cross-Origin-Resource-Policy': 'cross-origin', ...(config.allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '0' } : {}) });
  const equalKey = input => {
    const value = Buffer.from(typeof input === 'string' ? input : ''), expected = Buffer.from('Bearer ' + config.pairingKey);
    return value.length === expected.length && timingSafeEqual(value, expected);
  };
  function prune() { for (const [id, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(id); }
  async function handle(incoming, outgoing) {
    const origin = incoming.headers.origin;
    const answer = (status, value) => { outgoing.writeHead(status, headers(origin)); outgoing.end(JSON.stringify(value)); };
    try {
      if (closed || !config.allowedOrigins.includes(origin) || incoming.url !== '/v1/codex/tickets') return answer(403, { error: 'native_access_denied' });
      if (incoming.method === 'OPTIONS') {
        const requested = String(incoming.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim());
        if (incoming.headers['access-control-request-method'] !== 'POST' || requested.some(value => !['authorization', 'content-type'].includes(value))) return answer(403, { error: 'native_access_denied' });
        return answer(204, undefined);
      }
      if (incoming.method !== 'POST' || !equalKey(incoming.headers.authorization) || incoming.headers['content-type'] !== 'application/json') return answer(401, { error: 'native_access_denied' });
      prune(); if (active || tickets.size >= limits.tickets) return answer(409, { error: 'native_runtime_busy' });
      let size = 0; const parts = [];
      for await (const part of incoming) { size += part.length; if (size > 4096) throw new Error(); parts.push(part); }
      const input = nativeObject(JSON.parse(Buffer.concat(parts).toString('utf8')), ['profile', 'version', 'scope']);
      if (input.profile !== profile || input.version !== version) throw new Error();
      const scope = nativeScope(input.scope), identity = nativeIdentity(await runtime.authority());
      const ticket = randomBytes(32).toString('base64url'), expiresAt = now() + limits.ticketMs;
      tickets.set(ticket, { scope, identity, expiresAt, origin });
      return answer(200, { ticket, expiresAt, identity });
    } catch { if (!outgoing.headersSent) answer(400, { error: 'native_request_unavailable' }); else outgoing.destroy(); }
  }
  function upgrade(request, socket, head) {
    if (closed || request.method !== 'GET' || request.url !== '/v1/codex/socket' || !config.allowedOrigins.includes(request.headers.origin)
      || request.headers['sec-websocket-protocol'] || active || unpaired.size >= limits.unpaired) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => attach(ws, request.headers.origin));
  }
  function attach(ws, origin) {
    unpaired.add(ws); let child, ticket, expiry, heartbeat, initializing = false, initialized = false, accepting = false, expiresAt = 0;
    let queued = 0, sequence = Promise.resolve();
    const pending = new Map();
    let pairingTimer = setTimeout(() => ws.close(1008, 'Pairing required'), limits.pairingMs);
    const send = frame => {
      const text = JSON.stringify(frame);
      if (text.length > limits.frame || ws.bufferedAmount > limits.frame || ws.readyState !== 1) throw new Error();
      ws.send(text);
    };
    let stopped;
    const stop = () => stopped ??= (async () => {
      clearTimeout(pairingTimer); clearTimeout(expiry); clearInterval(heartbeat); unpaired.delete(ws); pending.clear();
      try { await child?.close(); } finally { if (active?.ws === ws) active = undefined; }
    })();
    ws.once('close', () => {
      const work = stop(); stopping.add(work);
      void work.then(() => stopping.delete(work), () => { closed = true; });
    }); ws.on('error', () => { ws.terminate(); });
    ws.on('pong', () => { if (active?.ws === ws) active.alive = true; });
    const receive = frame => {
      try {
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error();
        if (Object.hasOwn(frame, 'method')) {
          // Pairing has no interactive approval or login surface. Never expose a
          // server-initiated request as a client operation or auto-approve it.
          if (Object.hasOwn(frame, 'id')) child.send({ id: frame.id, error: { code: -32601, message: 'Interaction unavailable in this profile.' } });
          else if (frame.method === 'account/updated') ws.close(1008, 'Account authority changed');
          return;
        }
        if (!pending.has(frame.id) || (Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error'))) throw new Error();
        const method = pending.get(frame.id); pending.delete(frame.id);
        if (method === 'initialize' && Object.hasOwn(frame, 'result')) initializing = true;
        send(frame);
      } catch { ws.close(1008, 'Native protocol unavailable'); }
    };
    ws.on('message', (bytes, binary) => {
      if (binary || bytes.length > limits.frame || ++queued > limits.pending + 2) { ws.close(1008, 'Native protocol unavailable'); return; }
      sequence = sequence.then(() => handleFrame(bytes)).finally(() => { queued--; });
    });
    async function handleFrame(bytes) {
      if (ws.readyState !== 1) return;
      try {
        const frame = JSON.parse(bytes.toString('utf8'));
        if (!ticket) {
          nativeObject(frame, ['type', 'ticket']); prune(); const selected = tickets.get(frame.ticket); tickets.delete(frame.ticket);
          if (frame.type !== 'pair' || !selected || selected.origin !== origin || selected.expiresAt <= now() || active
            || !sameNativeIdentity(selected.identity, await runtime.authority())) throw new Error();
          if (active) throw new Error();
          ticket = selected; active = { ws, alive: true }; unpaired.delete(ws); clearTimeout(pairingTimer);
          child = await runtime.start(receive, () => ws.close(1011, 'Native runtime stopped'));
          if (ws.readyState !== 1 || !sameNativeIdentity(ticket.identity, await runtime.authority())) { await child.close(); throw new Error(); }
          expiresAt = now() + limits.sessionMs;
          send({ type: 'paired', profile, identity: ticket.identity, scope: ticket.scope, expiresAt });
          accepting = true; expiry = setTimeout(() => ws.close(1008, 'Pairing expired'), limits.sessionMs);
          heartbeat = setInterval(() => {
            if (active?.ws !== ws || !active.alive) { ws.terminate(); return; }
            active.alive = false; ws.ping();
            void runtime.authority().then(identity => { if (!sameNativeIdentity(ticket.identity, identity)) ws.close(1008, 'Runtime authority changed'); }, () => ws.close(1008, 'Runtime authority unavailable'));
          }, 15000);
          return;
        }
        if (!accepting || now() >= expiresAt || !sameNativeIdentity(ticket.identity, await runtime.authority())) throw new Error();
        if (frame.type === 'cancel') {
          nativeObject(frame, ['type', 'id']); if (!pending.has(frame.id)) throw new Error();
          ws.close(1000, 'Owned request cancelled'); return;
        }
        if (frame.method === 'initialized') {
          nativeObject(frame, ['method']); if (!initializing || initialized) throw new Error();
          initialized = true; child.send({ method: 'initialized' }); return;
        }
        nativeObject(frame, ['id', 'method', 'params']);
        if (!(Number.isSafeInteger(frame.id) && frame.id >= 0 || typeof frame.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(frame.id))
          || pending.has(frame.id) || pending.size >= limits.pending) throw new Error();
        if (frame.method === 'initialize') {
          if (initializing || initialized || pending.size) throw new Error();
          nativeObject(frame.params, ['clientInfo', 'capabilities']); nativeObject(frame.params.clientInfo, ['name', 'version']);
          nativeObject(frame.params.capabilities, ['experimentalApi']);
          if (frame.params.clientInfo.name !== 'operations' || frame.params.clientInfo.version !== '1' || frame.params.capabilities.experimentalApi !== false) throw new Error();
        } else {
          if (!initialized || frame.method !== ticket.scope.method) throw new Error();
          nativeObject(frame.params, ['refreshToken']); if (frame.params.refreshToken !== false) throw new Error();
        }
        pending.set(frame.id, frame.method); child.send(frame);
      } catch { ws.close(1008, 'Native access denied'); }
    }
  }
  return { handle, upgrade, async close() {
    closed = true; tickets.clear();
    await Promise.all([...sockets.clients].map(ws => new Promise(resolve => {
      if (ws.readyState === 3) resolve(); else { ws.once('close', resolve); ws.terminate(); }
    })));
    await Promise.all(stopping);
    await new Promise(resolve => sockets.close(resolve));
  } };
}
