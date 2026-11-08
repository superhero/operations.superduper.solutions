// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { nativeAccountReadMethods, nativeAccountReadWireParams } from '../src/lib/native-account-read.ts';
import { nativeAccountActionMethods } from '../src/lib/native-account-actions.ts';

/** Only the owned local HTTP service ever receives these generated test credentials. */
export async function seedNativeAccountBackend(home, options = {}) {
  const access = 'OWNED_ACCOUNT_ACCESS_' + randomBytes(24).toString('hex'), refresh = 'OWNED_ACCOUNT_REFRESH_' + randomBytes(24).toString('hex');
  const accountId = 'owned-account', requests = [], claims = { email: 'owned-account@example.test', 'https://api.openai.com/auth': {
    chatgpt_plan_type: 'pro', chatgpt_user_id: 'owned-user', chatgpt_account_id: accountId } };
  const idToken = [Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url'), Buffer.from('owned-signature').toString('base64url')].join('.');
  const f = { requests, accountId, access, refresh, idToken, allowedApiKeys: new Set(), actions: [], consumed: new Map() };
  const server = createServer(async (request, response) => {
    const parts = []; for await (const part of request) { parts.push(part); if (Buffer.concat(parts).length > 8192) { response.writeHead(413).end(); return; } }
    const url = new URL(request.url, 'http://fixture.invalid'), pathname = url.pathname;
    const authorized = request.headers.authorization === 'Bearer ' + access && request.headers['chatgpt-account-id'] === accountId
      || [...f.allowedApiKeys].some(key => request.headers.authorization === 'Bearer ' + key);
    requests.push({ method: request.method, path: pathname, query: Object.fromEntries(url.searchParams), authorized });
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (pathname === '/v1/models' && request.method === 'GET') return send(200, { object: 'list', data: [{ id: 'owned-account-model', object: 'model', created: 1, owned_by: 'fixture' }] });
    if (pathname === '/plugins/featured' && request.method === 'GET') return send(404, { error: 'No owned featured plugin fixture.' });
    if (!authorized) return send(401, { error: 'Owned fixture authentication required.' });
    if (await options.route?.({ request, url, body: Buffer.concat(parts), send, fixture: f })) return;
    if (request.method === 'POST' && pathname === '/api/codex/rate-limit-reset-credits/consume') {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')); f.actions.push({ method: 'consume', body, authorized });
      if (f.consumeStatus && f.consumeStatus !== 200) return send(f.consumeStatus, { error: f.actionError ?? 'Owned reset fixture failure.' });
      if (typeof body.redeem_request_id !== 'string' || !body.redeem_request_id.length || Object.keys(body).some(key => !['redeem_request_id', 'credit_id'].includes(key))) return send(400, { error: 'Invalid owned reset payload.' });
      const repeated = f.consumed.has(body.redeem_request_id); f.consumed.set(body.redeem_request_id, body);
      return send(200, { code: f.consumeCode ?? (repeated ? 'already_redeemed' : 'reset'), windows_reset: 1 });
    }
    if (request.method === 'POST' && pathname === '/api/codex/accounts/send_add_credits_nudge_email') {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')); f.actions.push({ method: 'email', body, authorized });
      if (!['credits', 'usage_limit'].includes(body.credit_type) || Object.keys(body).length !== 1) return send(400, { error: 'Invalid owned email payload.' });
      return send(f.emailStatus ?? 200, f.emailStatus && f.emailStatus !== 200 ? { error: f.actionError ?? 'Owned email fixture failure.' } : {});
    }
    if (request.method === 'GET' && pathname === '/api/codex/accounts/check') return send(200, { accounts: [{ id: accountId, workspace_backend_origin: 'https://chatgpt.com', account_routing_override: 'NO_CONSTRAINT' }] });
    if (request.method === 'GET' && pathname === '/api/codex/usage') return send(200, f.rateLimits ?? {
      account_id: accountId, user_id: 'owned-user', plan_type: 'pro', rate_limit: { allowed: true, limit_reached: false,
        primary_window: { used_percent: 42, limit_window_seconds: 3600, reset_after_seconds: 120, reset_at: 1735693200 } },
      rate_limit_reset_credits: { available_count: 1 }, rate_limit_upsell: { banner_type: 'owned_fixture', title: 'Owned account usage', ctas: [] }
    });
    if (request.method === 'GET' && pathname === '/api/codex/rate-limit-reset-credits') return send(200, { credits: [], available_count: 1 });
    if (request.method === 'GET' && pathname === '/api/codex/profiles/me') return send(200, f.profile ?? { stats: {
      lifetime_tokens: 12345, peak_daily_tokens: 2345, longest_running_turn_sec: 45, current_streak_days: 2, longest_streak_days: 7,
      daily_usage_buckets: [{ start_date: '2026-11-01', tokens: 2345 }] } });
    if (request.method === 'GET' && pathname === '/api/codex/workspace-messages') return send(f.messageStatus ?? 200, f.messages ?? { messages: [{
      message_id: 'owned-message', message_type: 'announcement', message_body: 'Owned workspace announcement', created_at: '2026-11-01T00:00:00Z', archived_at: null }] });
    if (request.method === 'POST' && pathname === '/api/codex/usage/thread_usage/query') {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')); return send(200, { threads: body.thread_ids.map(thread_id => ({ thread_id, estimated_usage_credits_micros: 42000000,
        estimated_usage_usd_micros: null, groups: [{ model: 'owned-account-model', reasoning_effort: 'medium', speed: 'standard', estimated_usage_credits_micros: 42000000,
          net_new_input_tokens: 80, cached_input_tokens: 20, input_tokens: 100, output_tokens: 40, total_tokens: 140 }] })) });
    }
    return send(404, { error: 'Unreviewed owned account route.' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port; f.origin = origin;
  await writeFile(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', OPENAI_API_KEY: null, tokens: {
    id_token: idToken, access_token: access, refresh_token: refresh, account_id: accountId }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
  await writeFile(join(home, 'config.toml'), 'chatgpt_base_url=' + JSON.stringify(origin) + '\nmodel="owned-account-model"\nmodel_provider="operations_account_fixture"\n[model_providers.operations_account_fixture]\nname="Owned account fixture"\nbase_url=' + JSON.stringify(origin + '/v1') + '\nwire_api="responses"\nrequires_openai_auth=true\n', { mode: 0o600 });
  f.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return f;
}

export async function nativeAccountSdkFixture(options = {}) {
  const owned = !options.home, directory = owned ? await mkdtemp(join(tmpdir(), 'operations-native-account-')) : dirname(options.home);
  const home = options.home ?? join(directory, 'home'), workspace = options.workspace ?? join(directory, 'workspace');
  if (owned) { await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 }); }
  let backend, child, number = 0; const pending = new Map(), calls = [];
  const f = { directory, home, workspace, calls };
  const fail = () => { for (const p of pending.values()) p.reject(new Error('Owned account SDK child closed.')); pending.clear(); };
  f.call = (method, params = {}) => {
    if (!['initialize', 'account/read', 'account/login/start', 'account/login/cancel', 'account/logout', 'account/gatewayOAuth/login', 'account/gatewayOAuth/cancel', ...nativeAccountReadMethods, ...nativeAccountActionMethods].includes(method)) throw new Error('Unreviewed account qualification method.');
    calls.push(method); const id = 'account_' + ++number;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('Owned account RPC timed out.')); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.send({ id, method, params: nativeAccountReadMethods.includes(method) ? nativeAccountReadWireParams(method, params) : params }); });
  };
  f.close = async () => { try { await child?.close(); } finally { fail(); await backend?.close(); if (owned) await rm(directory, { recursive: true, force: true }); } };
  try {
    backend = await seedNativeAccountBackend(home); f.backend = backend;
    if (options.anonymous) await rm(join(home, 'auth.json'));
    await options.seedRuntime?.({ home, workspace, backend });
    const runtime = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
      binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace, allowAccountRead: true }); f.runtime = runtime;
    child = await runtime.start(frame => { if (Object.hasOwn(frame, 'method')) {
      if (Object.hasOwn(frame, 'id')) child.send({ id: frame.id, error: { code: -32601, message: 'Account fixture interactions are unavailable.' } });
      else options.onNotification?.(frame); return;
    } const selected = pending.get(frame.id); if (!selected) return; pending.delete(frame.id);
      if (Object.hasOwn(frame, 'result')) selected.resolve(frame.result); else selected.reject(new Error('Owned account RPC failed: ' + String(frame.error?.message).replaceAll(home, '<owned-home>').slice(0, 400)));
    }, fail);
    const initialize = nativeInitializeParams();
    if (options.explicitGateway) initialize.capabilities.explicitGatewayOauth = true;
    await f.call('initialize', initialize); child.send({ method: 'initialized' }); return f;
  } catch (error) { await f.close(); throw error; }
}
