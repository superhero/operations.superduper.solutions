// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash, randomUUID, webcrypto } from 'node:crypto';

export const fixtureScope = 'atproto rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app%23bsky_appview';
const hash = value => createHash('sha256').update(value).digest('base64url');
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers });
/** Independent provider: verifies actual ES256 signatures, PKCE, key binding,
 * one-use codes/refresh tokens, per-origin nonces and fresh proof IDs. */
export function atprotoProvider(applicationOrigin = 'https://operations.example.com') {
  const f = { applicationOrigin, pds: 'https://pds.example.com', issuer: 'https://auth.example.com',
    did: 'did:plc:' + 'a'.repeat(24), handle: 'alice.example.com', scope: fixtureScope,
    privateValues: [], calls: [], proofs: [], pars: new Map(), codes: new Map(), tokens: new Map(), refresh: new Map(),
    seen: new Set(), expiredAccess: new Set(), tokenCalls: 0, refreshCalls: 0, resources: 0, nonceChallenges: 0, nonce: true,
    resourceFailure: false, refreshFailure: false, wrongSubject: false, legacyType: false, stalePds: false,
    badMetadata: false, echo: false, onToken: undefined, ttl: 3600 };
  const serverNonce = 'as-nonce-' + randomUUID(), resourceNonce = 'rs-nonce-' + randomUUID();
  f.metadata = () => ({ issuer: f.issuer, authorization_endpoint: f.issuer + '/authorize', token_endpoint: f.badMetadata ? 'https://untrusted.example.com/token' : f.issuer + '/token',
    pushed_authorization_request_endpoint: f.issuer + '/par', revocation_endpoint: f.issuer + '/revoke', require_pushed_authorization_requests: true,
    authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], dpop_signing_alg_values_supported: ['ES256'], scopes_supported: fixtureScope.split(' ') });
  const didDocument = () => ({ '@context': ['https://www.w3.org/ns/did/v1'], id: f.did, alsoKnownAs: ['at://' + f.handle],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: f.stalePds ? 'https://moved.example.com' : f.pds }] });
  async function proof(request, nonce, access) {
    const encoded = request.headers.get('DPoP'); assert.ok(encoded, 'A DPoP proof is required');
    const parts = encoded.split('.'); assert.equal(parts.length, 3);
    const head = JSON.parse(Buffer.from(parts[0], 'base64url')), body = JSON.parse(Buffer.from(parts[1], 'base64url'));
    assert.equal(head.typ, 'dpop+jwt'); assert.equal(head.alg, 'ES256'); assert.equal(head.jwk.d, undefined);
    const key = await webcrypto.subtle.importKey('jwk', head.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.ok(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(parts[2], 'base64url'), Buffer.from(parts.slice(0, 2).join('.'))), 'Invalid ES256 signature');
    const url = new URL(request.url); url.search = ''; url.hash = '';
    assert.equal(body.htu, url.href); assert.equal(body.htm, request.method);
    assert.ok(Math.abs(body.iat * 1000 - Date.now()) < 300000); assert.ok(typeof body.jti === 'string' && body.jti.length >= 16);
    assert.ok(!f.seen.has(body.jti), 'A proof must not be replayed'); f.seen.add(body.jti);
    const thumb = hash(JSON.stringify({ crv: head.jwk.crv, kty: head.jwk.kty, x: head.jwk.x, y: head.jwk.y }));
    if (access) { assert.equal(body.ath, hash(access)); assert.equal(f.tokens.get(access)?.thumb, thumb); }
    else assert.equal(body.ath, undefined);
    f.proofs.push({ thumb, url: request.url, method: request.method, nonce: body.nonce, jti: body.jti });
    if (f.nonce && body.nonce !== nonce) { f.nonceChallenges++; return { challenge: json({ error: 'use_dpop_nonce' }, access ? 401 : 400,
      { 'DPoP-Nonce': nonce, 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"' }) }; }
    return { thumb };
  }
  f.consent = (authorizationUrl, deny = false) => {
    const url = new URL(authorizationUrl), par = f.pars.get(url.searchParams.get('request_uri')); assert.ok(par);
    if (deny) return { state: par.state, iss: f.issuer, error: 'access_denied' };
    const code = 'ATPROTO_PRIVATE_CODE_' + randomUUID(); f.privateValues.push(code); f.codes.set(code, par);
    return { state: par.state, iss: f.issuer, code };
  };
  f.fetch = async (input, init) => {
    const request = input instanceof Request && !init ? input : new Request(input, init), url = new URL(request.url);
    f.calls.push({ url: url.href, method: request.method, credentials: request.credentials, redirect: request.redirect, referrerPolicy: request.referrerPolicy });
    if (url.href === applicationOrigin + '/oauth/bluesky-client-metadata.json') return json({ client_id: url.href, client_name: 'Operations fixture',
      application_type: 'web', redirect_uris: [applicationOrigin + '/?operations_oauth_callback=bluesky'], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: fixtureScope, dpop_bound_access_tokens: true });
    if (url.hostname === 'plc.directory' && decodeURIComponent(url.pathname.slice(1)) === f.did) return json(didDocument());
    if (url.hostname === f.handle && url.pathname === '/.well-known/atproto-did') return new Response(f.did, { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname === '/xrpc/com.atproto.identity.resolveHandle' && url.searchParams.get('handle') === f.handle) return json({ did: f.did });
    if ([f.pds, 'https://moved.example.com'].includes(url.origin) && url.pathname === '/.well-known/oauth-protected-resource') return json({ resource: url.origin, authorization_servers: [f.issuer] });
    if (url.origin === f.issuer && url.pathname === '/.well-known/oauth-authorization-server') return json(f.metadata());
    if (url.origin === f.issuer && ['/par', '/token', '/revoke'].includes(url.pathname)) {
      assert.equal(request.method, 'POST'); assert.equal(request.headers.get('Authorization'), null);
      const verified = await proof(request, serverNonce); if (verified.challenge) return verified.challenge;
      const body = new URLSearchParams(await request.text()); assert.equal(body.has('client_secret'), false);
      if (url.pathname === '/par') {
        assert.equal(body.get('code_challenge_method'), 'S256'); assert.equal(body.get('scope'), fixtureScope); assert.ok(body.get('code_challenge'));
        const uri = 'urn:ietf:params:oauth:request_uri:' + randomUUID(); f.pars.set(uri, { state: body.get('state'), challenge: body.get('code_challenge'),
          client: body.get('client_id'), redirect: body.get('redirect_uri'), thumb: verified.thumb });
        return json({ request_uri: uri, expires_in: 300 }, 201, { 'DPoP-Nonce': serverNonce });
      }
      if (url.pathname === '/revoke') return new Response(null, { status: 204 });
      let grant;
      if (body.get('grant_type') === 'authorization_code') {
        f.tokenCalls++; grant = f.codes.get(body.get('code')); assert.ok(grant); f.codes.delete(body.get('code'));
        assert.equal(hash(body.get('code_verifier')), grant.challenge); assert.equal(body.get('redirect_uri'), grant.redirect);
      } else {
        assert.equal(body.get('grant_type'), 'refresh_token'); f.refreshCalls++; grant = f.refresh.get(body.get('refresh_token'));
        assert.ok(grant, 'A refresh token cannot be reused'); f.refresh.delete(body.get('refresh_token'));
        if (f.refreshFailure) throw new TypeError('Synthetic interrupted rotation');
      }
      assert.equal(verified.thumb, grant.thumb); assert.equal(body.get('client_id'), grant.client);
      if (f.onToken) await f.onToken();
      const access = 'ATPROTO_PRIVATE_ACCESS_' + randomUUID(), refresh = 'ATPROTO_PRIVATE_REFRESH_' + randomUUID();
      f.privateValues.push(access, refresh); f.tokens.set(access, grant); f.refresh.set(refresh, grant);
      return json({ access_token: access, refresh_token: refresh, token_type: f.legacyType ? 'Bearer' : 'DPoP', expires_in: f.ttl,
        scope: f.scope, sub: f.wrongSubject ? 'did:plc:' + 'b'.repeat(24) : f.did }, 200, { 'DPoP-Nonce': serverNonce });
    }
    if (url.origin === f.pds && url.pathname === '/xrpc/app.bsky.actor.getPreferences') {
      const auth = request.headers.get('Authorization'); assert.ok(auth?.startsWith('DPoP ')); const access = auth.slice(5); assert.ok(f.tokens.has(access));
      assert.equal(request.headers.get('atproto-proxy'), 'did:web:api.bsky.app#bsky_appview');
      const verified = await proof(request, resourceNonce, access); if (verified.challenge) return verified.challenge;
      f.resources++; if (f.expiredAccess.has(access)) return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'DPoP error="invalid_token"' });
      if (f.resourceFailure) return json({ error: 'InvalidToken' }, 401);
      return json({ preferences: [], ...(f.echo ? { [access]: encodeURIComponent(access) } : {}) }, 200, { 'DPoP-Nonce': resourceNonce });
    }
    throw new Error('Unexpected synthetic provider route: ' + url.origin + url.pathname);
  };
  return f;
}
