// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Owned OAuth/MCP authority. Codes, PKCE verifiers and tokens never enter receipts. */
export async function nativeMcpOAuthServer(home, { cimd = true, prefix = '' } = {}) {
  const tokens = { access: 'OWNED_MCP_ACCESS_' + randomUUID(), refresh: 'OWNED_MCP_REFRESH_' + randomUUID() };
  const codes = new Map(), f = { requests: [], registrations: 0, grants: 0, exchanges: 0, pkceVerified: 0, resourceReads: 0, tokens, deny: false, badState: false, badIssuer: false };
  let origin;
  const server = createServer((request, response) => { void handle(request, response).catch(() => { response.writeHead(500); response.end(); }); });
  const json = (response, value, status = 200, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)); };
  async function handle(request, response) {
    const url = new URL(request.url, origin), parts = [];
    for await (const part of request) { parts.push(part); if (parts.reduce((sum, p) => sum + p.length, 0) > 65536) throw new Error('Owned request too large.'); }
    const body = Buffer.concat(parts).toString('utf8'); f.requests.push({ method: request.method, path: url.pathname, authorized: request.headers.authorization === 'Bearer ' + tokens.access });
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) return json(response, {
      resource: origin + '/mcp', authorization_servers: [origin], scopes_supported: ['owned.read'], bearer_methods_supported: ['header']
    });
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server') || url.pathname.startsWith('/.well-known/openid-configuration')) return json(response, {
      issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', registration_endpoint: origin + '/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['owned.read'], client_id_metadata_document_supported: cimd,
      authorization_response_iss_parameter_supported: true
    });
    if (url.pathname === '/register') {
      const registration = JSON.parse(body); f.registrations++;
      return json(response, { client_id: 'owned-public-client', token_endpoint_auth_method: 'none', redirect_uris: registration.redirect_uris,
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201);
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams, redirect = new URL(q.get('redirect_uri'));
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname) || redirect.protocol !== 'http:' || q.get('code_challenge_method') !== 'S256') return json(response, { error: 'invalid_request' }, 400);
      const code = randomUUID(); f.grants++;
      codes.set(code, { challenge: q.get('code_challenge'), redirect: q.get('redirect_uri'), clientId: q.get('client_id') });
      redirect.searchParams.set('state', f.badState ? 'foreign-state' : q.get('state'));
      redirect.searchParams.set('iss', f.badIssuer ? 'https://foreign.invalid' : origin);
      if (f.deny) redirect.searchParams.set('error', 'access_denied'); else redirect.searchParams.set('code', code);
      response.writeHead(302, { location: redirect.href }); response.end(); return;
    }
    if (url.pathname === '/token') {
      const q = new URLSearchParams(body), grant = codes.get(q.get('code')); f.exchanges++;
      if (!grant || q.get('grant_type') !== 'authorization_code' || q.get('client_id') !== grant.clientId || q.get('redirect_uri') !== grant.redirect
        || createHash('sha256').update(q.get('code_verifier') ?? '').digest('base64url') !== grant.challenge) return json(response, { error: 'invalid_grant' }, 400);
      codes.delete(q.get('code')); f.pkceVerified++;
      return json(response, { access_token: tokens.access, refresh_token: tokens.refresh, token_type: 'Bearer', expires_in: 3600, scope: 'owned.read' });
    }
    if (url.pathname === '/mcp') {
      if (request.headers.authorization !== 'Bearer ' + tokens.access) return json(response, { error: 'unauthorized' }, 401,
        { 'www-authenticate': 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource", scope="owned.read"' });
      if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
      const frame = JSON.parse(body); if (!Object.hasOwn(frame, 'id')) { response.writeHead(202); response.end(); return; }
      let result;
      if (frame.method === 'initialize') result = { protocolVersion: frame.params.protocolVersion, capabilities: { resources: {}, tools: {} }, serverInfo: { name: 'owned-oauth-server', version: '1.0.0' } };
      if (frame.method === 'resources/list') result = { resources: [{ uri: 'owned:oauth-resource', name: 'Owned OAuth resource' }] };
      if (frame.method === 'resources/templates/list') result = { resourceTemplates: [] };
      if (frame.method === 'tools/list') result = { tools: [{ name: 'owned_echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] };
      if (frame.method === 'resources/read') { f.resourceReads++; result = { contents: [{ uri: frame.params.uri, text: 'Owned OAuth resource available.' }] }; }
      if (frame.method === 'tools/call') result = { content: [{ type: 'text', text: 'Owned authenticated tool.' }], isError: false };
      if (frame.method === 'ping') result = {};
      return json(response, { jsonrpc: '2.0', id: frame.id, ...(result ? { result } : { error: { code: -32601, message: 'Owned fixture method unavailable.' } }) });
    }
    json(response, { error: 'not_found' }, 404);
  }
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  try {
    await writeFile(join(home, 'config.toml'), 'mcp_oauth_credentials_store = "file"\n' + prefix
      + '\n[mcp_servers.oauth_fixture]\nurl = ' + JSON.stringify(origin + '/mcp') + '\nstartup_timeout_sec = 3\n', { mode: 0o600 });
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
  return Object.assign(f, { origin, async authorize(url) { const parsed = new URL(url); if (parsed.origin !== origin || parsed.pathname !== '/authorize') throw new Error('Unowned authorization URL.');
    const response = await fetch(parsed, { redirect: 'follow' }); await response.arrayBuffer(); return response.status; },
    async stored() { try { const value = await readFile(join(home, '.credentials.json'), 'utf8'); return { access: value.includes(tokens.access), refresh: value.includes(tokens.refresh) }; }
      catch (error) { if (error.code === 'ENOENT') return { access: false, refresh: false }; throw error; } },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
}
