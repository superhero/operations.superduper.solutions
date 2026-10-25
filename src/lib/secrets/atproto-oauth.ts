// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { checkTokenSet, validateAtprotoState, managedAtprotoSecrets, type AtprotoState } from "./atproto-state.ts";
import { OAuthClient, type InternalStateData, type OAuthClientMetadataInput, type SessionStore } from "@atproto/oauth-client";
import { WebcryptoKey } from "@atproto/jwk-webcrypto";
import { credentialObject } from "./bindings.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { VaultError, type ApprovedOperation, type AtprotoOAuthMetadata, type HttpConnectionReference } from "./types.ts";
import { atprotoPath, atprotoProxy, atprotoScope, publicAtprotoUrl, validateAtprotoInput, validateAtprotoMetadata,
  type AtprotoOAuthInput, type AtprotoOAuthCallback, type AtprotoOAuthTask } from "./atproto-config.ts";

type RedirectUri = NonNullable<NonNullable<Parameters<OAuthClient["authorize"]>[1]>["redirect_uri"]>;
type Session = Parameters<SessionStore["set"]>[1];
export type AtprotoRuntime = { fetchRequest?: typeof fetch; applicationOrigin?: string };
type Guard = () => Promise<void>;
type Context = { controller: AbortController; guard: Guard; input: AtprotoOAuthInput; descriptor: ApprovedOperation;
  issuer?: string; endpoints: Set<string>; expectedDid?: string; saved?: AtprotoState; persist?: (state: AtprotoState) => Promise<void>;
  states: Map<string, InternalStateData>; session?: Session; refreshDispatched: boolean; nonceRetry: boolean; calls: number };
type Pending = { id: string; state: string; expiresAt: number; client: OAuthClient; context: Context; replace?: HttpConnectionReference };
const same = (a: unknown, b: unknown) => canonicalPolicyValue(a) === canonicalPolicyValue(b);
function identityPds(value: unknown): string {
  const info = credentialObject(value), doc = credentialObject(info.didDoc);
  if (!Array.isArray(doc.service)) throw new VaultError("AUTHORIZATION");
  const services = doc.service.map(credentialObject).filter(item => item.type === "AtprotoPersonalDataServer"
    && (item.id === "#atproto_pds" || item.id === String(doc.id) + "#atproto_pds"));
  if (services.length !== 1) throw new VaultError("AUTHORIZATION");
  const url = publicAtprotoUrl(services[0]!.serviceEndpoint);
  if (url.pathname !== "/" || url.search) throw new VaultError("AUTHORIZATION");
  return url.href;
}
function proofKey(key: WebcryptoKey): WebcryptoKey {
  // oauth-client0.8.10 uses Math.random for jti; strengthen uniqueness without
  // replacing its proof claims, nonce handling or JOSE signature implementation.
  const create = key.createJwt.bind(key);
  key.createJwt = (...args: Parameters<WebcryptoKey["createJwt"]>) => {
    const [header, payload, ...rest] = args;
    return create(header, header.typ === "dpop+jwt" ? { ...payload, jti: crypto.randomUUID() } : payload, ...rest);
  };
  return key;
}
async function restoreKey(jwk: JsonWebKey): Promise<WebcryptoKey> {
  const publicJwk = { ...jwk }; delete publicJwk.d; delete publicJwk.key_ops;
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const [privateKey, publicKey] = await Promise.all([crypto.subtle.importKey("jwk", jwk, algorithm, true, ["sign"]),
    crypto.subtle.importKey("jwk", publicJwk, algorithm, true, ["verify"])]);
  return proofKey(new WebcryptoKey(jwk as ConstructorParameters<typeof WebcryptoKey>[0], { privateKey, publicKey }));
}
async function bounded(response: Response, limit: number): Promise<Response> {
  if (response.status === 204) return response;
  const reader = response.body?.getReader(); if (!reader) throw new VaultError("NETWORK");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength;
      if (length > limit) throw new VaultError("LIMIT"); chunks.push(chunk.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** OAuth core owns PAR/PKCE, DID authority, ES256 proofs, nonces and token verification.
 * All private stores and network entry points belong to this vault-worker adapter. */
export class AtprotoOAuthBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly controllers = new Set<AbortController>();
  private readonly runtime: AtprotoRuntime;
  constructor(runtime: AtprotoRuntime = {}) { this.runtime = runtime; }
  clear(): void { for (const controller of this.controllers) controller.abort(); this.controllers.clear(); this.pending.clear(); }
  cancel(id: string): void { const task = this.pending.get(id); if (task) { task.context.controller.abort(); this.controllers.delete(task.context.controller); this.pending.delete(id); } }
  private metadata(value: unknown, context: Context) {
    const item = credentialObject(value), issuer = publicAtprotoUrl(item.issuer);
    if (issuer.pathname !== "/" || issuer.search || context.issuer && context.issuer !== issuer.href
      || item.require_pushed_authorization_requests !== true || item.authorization_response_iss_parameter_supported !== true
      || !Array.isArray(item.dpop_signing_alg_values_supported) || !item.dpop_signing_alg_values_supported.includes("ES256")
      || !Array.isArray(item.code_challenge_methods_supported) || !item.code_challenge_methods_supported.includes("S256")) throw new VaultError("AUTHORIZATION");
    for (const name of ["authorization_endpoint", "token_endpoint", "pushed_authorization_request_endpoint"]) {
      const url = publicAtprotoUrl(item[name]); if (url.origin !== issuer.origin || url.search) throw new VaultError("AUTHORIZATION");
      if (name !== "authorization_endpoint") context.endpoints.add(url.href);
    }
    if (item.revocation_endpoint) { const url = publicAtprotoUrl(item.revocation_endpoint); if (url.origin !== issuer.origin || url.search) throw new VaultError("AUTHORIZATION"); context.endpoints.add(url.href); }
    context.issuer = issuer.href;
    return item;
  }
  private async request(context: Context, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    await context.guard(); context.controller.signal.throwIfAborted();
    const request = new Request(input, { ...init, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
      signal: AbortSignal.any([context.controller.signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
    const url = publicAtprotoUrl(request.url), proof = request.headers.get("DPoP"), auth = request.headers.get("Authorization");
    if (++context.calls > 64 || request.headers.has("Cookie")) throw new VaultError("LIMIT");
    const resource = url.href === context.descriptor.origin + atprotoPath;
    if (proof || auth || request.method !== "GET") {
      if (resource) { if (request.method !== "GET" || !proof || !auth?.startsWith("DPoP ") || request.headers.get("atproto-proxy") !== atprotoProxy) throw new VaultError("PERMISSION"); }
      else if (request.method !== "POST" || !proof || auth || !context.endpoints.has(url.href)) throw new VaultError("PERMISSION");
    }
    let refreshing = false;
    if (request.method === "POST") {
      const body = await request.clone().text(); if (body.length > 32768) throw new VaultError("LIMIT");
      refreshing = new URLSearchParams(body).get("grant_type") === "refresh_token";
      if (refreshing) {
        if (!context.saved || !context.persist || context.refreshDispatched && !context.nonceRetry) throw new VaultError("AUTHORIZATION");
        if (!context.refreshDispatched) { context.saved = { ...context.saved, refreshPending: true }; await context.persist(context.saved); }
        context.refreshDispatched = true; context.nonceRetry = false;
      }
    }
    await context.guard();
    const response = await bounded(await (this.runtime.fetchRequest ?? globalThis.fetch)(request), resource ? 8 * 1024 * 1024 : 131072);
    await context.guard();
    if (response.redirected) throw new VaultError("PERMISSION");
    if (url.pathname === "/.well-known/oauth-authorization-server" && response.ok) this.metadata(await response.clone().json(), context);
    if (refreshing && [400, 401].includes(response.status) && response.headers.get("DPoP-Nonce")) {
      const value = await response.clone().json().catch(() => null);
      context.nonceRetry = value?.error === "use_dpop_nonce";
    }
    return response;
  }
  private async client(context: Context): Promise<OAuthClient> {
    const { input } = context;
    let metadata: OAuthClientMetadataInput;
    if (input.clientId.startsWith("http://localhost?")) metadata = { client_id: input.clientId, client_name: "Operations development",
      application_type: "native", redirect_uris: [input.redirectUri], response_types: ["code"], grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none", dpop_bound_access_tokens: true, scope: atprotoScope };
    else {
      const response = await this.request(context, input.clientId);
      metadata = await response.json() as OAuthClientMetadataInput;
      if (!response.ok || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
        || metadata.client_id !== input.clientId || metadata.token_endpoint_auth_method !== "none" || metadata.application_type !== "web"
        || metadata.dpop_bound_access_tokens !== true || metadata.scope !== atprotoScope || metadata.redirect_uris?.length !== 1
        || metadata.redirect_uris[0] !== input.redirectUri) throw new VaultError("AUTHORIZATION");
    }
    return new OAuthClient({ clientMetadata: metadata, responseMode: "query", allowHttp: false, handleResolver: "https://bsky.social",
      fetch: (input, init) => this.request(context, input, init),
      runtimeImplementation: { createKey: async algorithms => { if (!algorithms.includes("ES256")) throw new VaultError("AUTHORIZATION");
          const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
          return proofKey(await WebcryptoKey.fromKeypair(pair, crypto.randomUUID())); },
        getRandomValues: length => crypto.getRandomValues(new Uint8Array(length)),
        digest: async (bytes, algorithm) => new Uint8Array(await crypto.subtle.digest("SHA-" + algorithm.name.slice(3), bytes)) },
      stateStore: { get: key => context.states.get(key), set: (key, value) => { context.states.set(key, value); }, del: key => { context.states.delete(key); } },
      sessionStore: { get: key => context.session?.tokenSet.sub === key ? context.session : undefined,
        set: async (key, value) => {
          if (key !== context.expectedDid || value.tokenSet.sub !== key) throw new VaultError("AUTHORIZATION");
          const oauth = validateAtprotoMetadata({ profile: "atproto-public-dpop-v1", clientId: input.clientId, redirectUri: input.redirectUri,
            scope: atprotoScope, accountId: key, issuer: context.issuer, pds: context.descriptor.origin + "/" });
          checkTokenSet(value.tokenSet, oauth);
          const saved = validateAtprotoState(JSON.stringify({ oauth, jwk: value.dpopKey.jwk, tokenSet: value.tokenSet, refreshPending: false }));
          if (context.saved && (!same(saved.oauth, context.saved.oauth) || saved.jwk.d !== context.saved.jwk.d)) throw new VaultError("AUTHORIZATION");
          if (context.persist) await context.persist(saved); context.session = value; context.saved = saved;
        }, del: async () => { if (context.saved && context.persist) await context.persist({ ...context.saved, refreshPending: true }); delete context.session; } } });
  }
  private context(input: AtprotoOAuthInput, descriptor: ApprovedOperation, guard: Guard): Context {
    const context: Context = { input, descriptor, guard, controller: new AbortController(), endpoints: new Set(), states: new Map(), refreshDispatched: false, nonceRetry: false, calls: 0 };
    this.controllers.add(context.controller); return context;
  }
  async begin(raw: AtprotoOAuthInput, descriptor: ApprovedOperation, guard: Guard, replace?: HttpConnectionReference): Promise<AtprotoOAuthTask> {
    for (const [id, task] of this.pending) if (task.expiresAt <= Date.now()) this.cancel(id);
    if (this.pending.size >= 4) throw new VaultError("LIMIT");
    const input = validateAtprotoInput(raw, this.runtime.applicationOrigin ?? globalThis.location?.origin ?? ""), context = this.context(input, descriptor, guard);
    try {
      const client = await this.client(context), resolved = await client.oauthResolver.resolve(input.identifier);
      if (!resolved.identityInfo || identityPds(resolved.identityInfo).replace(/\/$/, "") !== descriptor.origin) throw new VaultError("PERMISSION");
      context.expectedDid = resolved.identityInfo.did; this.metadata(resolved.metadata, context);
      const url = await client.authorize(input.identifier, { scope: atprotoScope, redirect_uri: input.redirectUri as RedirectUri, signal: context.controller.signal });
      const [state] = context.states.keys(); if (!state || !url.searchParams.get("request_uri")) throw new VaultError("AUTHORIZATION");
      const id = crypto.randomUUID(), expiresAt = Date.now() + 300000;
      this.pending.set(id, { id, state, expiresAt, client, context, ...(replace ? { replace } : {}) });
      return { id, state, authorizationUrl: url.href, expiresAt, fingerprint: descriptor.fingerprint };
    } catch (error) { context.controller.abort(); this.controllers.delete(context.controller); throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION"); }
  }
  async complete(id: string, callback: AtprotoOAuthCallback, guard: (descriptor: ApprovedOperation) => Promise<void>) {
    const pending = this.pending.get(id); if (!pending) throw new VaultError("AUTHORIZATION"); this.pending.delete(id);
    const { context } = pending; context.guard = () => guard(context.descriptor);
    try {
      if (Date.now() >= pending.expiresAt || callback.state !== pending.state || callback.iss?.replace(/\/$/, "") !== context.issuer?.replace(/\/$/, "")
        || Object.keys(callback).some(key => !["state", "iss", "code", "error"].includes(key))
        || typeof callback.code !== "string" && typeof callback.error !== "string" || callback.code && callback.error
        || (callback.code?.length ?? 0) > 4096 || (callback.error?.length ?? 0) > 128) throw new VaultError("AUTHORIZATION");
      await context.guard(); await pending.client.callback(new URLSearchParams(callback as Record<string, string>), { redirect_uri: context.input.redirectUri as RedirectUri });
      if (!context.saved) throw new VaultError("AUTHORIZATION"); await context.guard(); return { pending, state: context.saved };
    } catch (error) { throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION"); }
    finally { context.controller.abort(); this.controllers.delete(context.controller); context.states.clear(); }
  }
  async execute(state: AtprotoState, descriptor: ApprovedOperation, guard: Guard, persist: (state: AtprotoState) => Promise<void>, signal?: AbortSignal) {
    if (state.refreshPending) throw new VaultError("AUTHORIZATION");
    const input = { identifier: state.oauth.accountId, label: "Bluesky", clientId: state.oauth.clientId, redirectUri: state.oauth.redirectUri };
    const context = this.context(input, descriptor, guard); context.saved = state; context.expectedDid = state.oauth.accountId; context.persist = persist;
    const abort = () => context.controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    try {
      context.session = { tokenSet: state.tokenSet, authMethod: { method: "none" }, dpopKey: await restoreKey(state.jwk) };
      const client = await this.client(context), resolved = await client.oauthResolver.resolve(state.oauth.accountId);
      if (resolved.identityInfo?.did !== state.oauth.accountId || identityPds(resolved.identityInfo).replace(/\/$/, "") !== descriptor.origin
        || resolved.metadata.issuer.replace(/\/$/, "") !== state.oauth.issuer.replace(/\/$/, "")) throw new VaultError("AUTHORIZATION");
      this.metadata(resolved.metadata, context);
      const session = await client.restore(state.oauth.accountId as Parameters<OAuthClient["restore"]>[0], false);
      const response = await session.fetchHandler(atprotoPath, { method: "GET", headers: { Accept: "application/json", "atproto-proxy": atprotoProxy } });
      await guard(); if (context.saved?.refreshPending || response.headers.get("Content-Type")?.split(";", 1)[0] !== "application/json") throw new VaultError("NETWORK");
      const body: unknown = await response.json(); await guard(); return { response, body, secrets: managedAtprotoSecrets(JSON.stringify(context.saved)) };
    } catch (error) { throw error instanceof VaultError ? error : new VaultError(signal?.aborted ? "CANCELLED" : "AUTHORIZATION"); }
    finally { signal?.removeEventListener("abort", abort); context.controller.abort(); this.controllers.delete(context.controller); }
  }
}
