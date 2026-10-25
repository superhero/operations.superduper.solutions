// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { credentialObject } from "./bindings.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { gitlabIssuer, validateGitlabInput, validateGitlabMetadata, validateGitlabRedirect,
  type GitlabOAuthInput, type GitlabOAuthTask, type GitlabOAuthCallback } from "./gitlab-config.ts";
import { VaultError, vaultLimits, type ApprovedOperation, type GitlabOAuthMetadata, type HttpConnectionReference } from "./types.ts";

export type GitlabTokenState = { profile: "gitlab-public-pkce-v1"; oauth: GitlabOAuthMetadata; username: string;
  accessToken: string; refreshToken: string; expiresAt: number; refreshPending?: true };
export type GitlabOAuthRuntime = { now?: () => number; applicationOrigin?: () => string; fetchRequest?: typeof fetch };
export type GitlabPending = { id: string; state: string; verifier: string; input: GitlabOAuthInput;
  descriptor: ApprovedOperation; expiresAt: number; fingerprint: string; replace?: HttpConnectionReference };
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const token = (value: unknown): string => {
  if (typeof value !== "string" || value.length < 16 || value.length > 4096 || /[^\x21-\x7e]/.test(value)) throw new VaultError("AUTHORIZATION");
  return value;
};
export function managedGitlabSecrets(value: string): string[] {
  try {
    const state = JSON.parse(value);
    return state?.profile === "gitlab-public-pkce-v1" ? [state.accessToken, state.refreshToken].filter(item => typeof item === "string" && item.length > 0) : [];
  } catch { return []; }
}
export function validateGitlabTokenState(value: string, oauth?: GitlabOAuthMetadata): GitlabTokenState {
  try {
    const state = credentialObject(JSON.parse(value)), metadata = validateGitlabMetadata(state.oauth);
    if (Object.keys(state).length !== (state.refreshPending === undefined ? 6 : 7) || state.refreshPending !== undefined && state.refreshPending !== true || state.profile !== "gitlab-public-pkce-v1" || typeof state.username !== "string"
      || !/^[a-zA-Z0-9_.-]{1,128}$/.test(state.username) || !Number.isSafeInteger(state.expiresAt) || (state.expiresAt as number) <= 0
      || oauth && canonicalPolicyValue(metadata) !== canonicalPolicyValue(oauth)) throw new VaultError("AUTHORIZATION");
    return { profile: "gitlab-public-pkce-v1", oauth: metadata, username: state.username, accessToken: token(state.accessToken),
      refreshToken: token(state.refreshToken), expiresAt: state.expiresAt as number, ...(state.refreshPending === true ? { refreshPending: true as const } : {}) };
  } catch { throw new VaultError("AUTHORIZATION"); }
}

/** OAuth code/verifier and refresh values never leave the vault worker. */
export class GitlabOAuthBroker {
  private pending = new Map<string, GitlabPending>();
  private refreshes = new Map<string, Promise<GitlabTokenState>>();
  private refreshed = new Map<string, { previous: string; next: GitlabTokenState }>();
  private controllers = new Set<AbortController>();
  private generation = 0;
  private readonly runtime: GitlabOAuthRuntime;
  constructor(runtime: GitlabOAuthRuntime = {}) { this.runtime = runtime; }
  now(): number { return (this.runtime.now ?? Date.now)(); }
  applicationOrigin(): string {
    const origin = this.runtime.applicationOrigin?.() ?? globalThis.location?.origin;
    if (!origin || origin === "null") throw new VaultError("PERMISSION"); return origin;
  }
  clear(): void {
    this.generation++; this.pending.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear(); this.refreshes.clear(); this.refreshed.clear();
  }
  invalidateTokenCache(): void { this.refreshed.clear(); }
  assertMetadata(oauth: GitlabOAuthMetadata): void { validateGitlabMetadata(oauth); validateGitlabRedirect(oauth.redirectUri, this.applicationOrigin()); }
  async begin(value: unknown, descriptor: ApprovedOperation, replace?: HttpConnectionReference): Promise<GitlabOAuthTask> {
    const generation = this.generation, input = validateGitlabInput(value, this.applicationOrigin());
    for (const [id, pending] of this.pending) if (pending.expiresAt <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 8) throw new VaultError("LIMIT");
    const id = crypto.randomUUID(), state = random(), verifier = random(), expiresAt = this.now() + 300000;
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalPolicyValue({ input, descriptor, id, state, ...(replace ? { replace } : {}) })))), byte => byte.toString(16).padStart(2, "0")).join("");
    if (generation !== this.generation) throw new VaultError("CANCELLED");
    this.pending.set(id, { id, state, verifier, input, descriptor: structuredClone(descriptor), expiresAt, fingerprint, ...(replace ? { replace: { ...replace } } : {}) });
    const url = new URL("/oauth/authorize", gitlabIssuer);
    for (const [name, entry] of Object.entries({ client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", state,
      scope: "read_user", code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(name, entry);
    return { id, state, authorizationUrl: url.href, expiresAt, fingerprint };
  }
  cancel(id: string): void { this.pending.delete(id); }
  take(id: string, value: GitlabOAuthCallback): { pending: GitlabPending; code: string } {
    const callback = credentialObject(value), pending = this.pending.get(id); this.pending.delete(id);
    if (!pending || pending.expiresAt <= this.now() || callback.state !== pending.state
      || Object.keys(callback).some(key => !["state", "code", "error"].includes(key)) || callback.error !== undefined
      || typeof callback.code !== "string" || !callback.code || callback.code.length > 4096 || /[^\x21-\x7e]/.test(callback.code)) throw new VaultError("AUTHORIZATION");
    validateGitlabInput(pending.input, this.applicationOrigin());
    return { pending, code: callback.code };
  }
  private async operation<T>(signal: AbortSignal | undefined, guard: () => Promise<void>, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController(), generation = this.generation;
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    this.controllers.add(controller); const timer = setTimeout(abort, 15000);
    try {
      await guard(); if (controller.signal.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      const result = await action(controller.signal);
      await guard(); if (controller.signal.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      return result;
    } catch (error) {
      if (signal?.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION");
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.controllers.delete(controller); }
  }
  private async json(path: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await (this.runtime.fetchRequest ?? globalThis.fetch)(gitlabIssuer + path, {
      ...init, signal, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
    });
    if (!response.ok || response.redirected || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new VaultError("AUTHORIZATION");
    const reader = response.body?.getReader(); if (!reader) throw new VaultError("AUTHORIZATION");
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        length += item.value.byteLength; if (length > 65536) throw new VaultError("LIMIT"); chunks.push(item.value);
      }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return credentialObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async tokens(parameters: URLSearchParams, input: Pick<GitlabOAuthInput, "clientId" | "redirectUri">,
    signal: AbortSignal, expected?: GitlabOAuthMetadata): Promise<GitlabTokenState> {
    const response = await this.json("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: parameters }, signal);
    const accessToken = token(response.access_token), refreshToken = token(response.refresh_token);
    if (String(response.token_type).toLowerCase() !== "bearer" || !Number.isSafeInteger(response.expires_in) || (response.expires_in as number) <= 0
      || response.scope !== undefined && response.scope !== "read_user") throw new VaultError("AUTHORIZATION");
    const user = await this.json("/api/v4/user", { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } }, signal);
    const accountId = typeof user.id === "number" && Number.isSafeInteger(user.id) ? String(user.id) : user.id;
    const oauth = validateGitlabMetadata({ profile: "gitlab-public-pkce-v1", clientId: input.clientId, redirectUri: input.redirectUri, scope: "read_user", accountId });
    if (expected && canonicalPolicyValue(expected) !== canonicalPolicyValue(oauth) || typeof user.username !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(user.username)) throw new VaultError("AUTHORIZATION");
    const state: GitlabTokenState = { profile: "gitlab-public-pkce-v1", oauth, username: user.username, accessToken, refreshToken,
      expiresAt: this.now() + Math.min(7200, response.expires_in as number) * 1000 };
    if (encoder.encode(JSON.stringify(state)).byteLength > vaultLimits.secretBytes) throw new VaultError("LIMIT");
    return state;
  }
  async exchange(pending: GitlabPending, code: string, signal: AbortSignal | undefined, guard: () => Promise<void>): Promise<GitlabTokenState> {
    return this.operation(signal, guard, async requestSignal => {
      if (pending.expiresAt <= this.now()) throw new VaultError("AUTHORIZATION");
      return this.tokens(new URLSearchParams({ client_id: pending.input.clientId, redirect_uri: pending.input.redirectUri,
        grant_type: "authorization_code", code, code_verifier: pending.verifier }), pending.input, requestSignal);
    });
  }
  async ensure(id: string, state: GitlabTokenState, signal: AbortSignal | undefined, guard: () => Promise<void>,
    persist: (state: GitlabTokenState) => Promise<void>): Promise<GitlabTokenState> {
    this.assertMetadata(state.oauth);
    const refreshKey = id + canonicalPolicyValue(state.oauth);
    const inFlight = this.refreshes.get(refreshKey); if (inFlight) return inFlight;
    const cached = this.refreshed.get(refreshKey);
    if (cached?.previous === state.refreshToken && cached.next.expiresAt > this.now() + 30000) return cached.next;
    if (state.refreshPending) throw new VaultError("AUTHORIZATION");
    if (state.expiresAt > this.now() + 30000) return state;
    const refresh = this.operation(signal, guard, async requestSignal => {
      // A durable lease prevents reusing a one-use refresh credential after an interrupted exchange.
      await persist({ ...state, refreshPending: true });
      if (requestSignal.aborted) throw new VaultError("CANCELLED");
      const next = await this.tokens(new URLSearchParams({ client_id: state.oauth.clientId, redirect_uri: state.oauth.redirectUri,
        grant_type: "refresh_token", refresh_token: state.refreshToken }), state.oauth, requestSignal, state.oauth);
      await guard(); if (requestSignal.aborted) throw new VaultError("CANCELLED"); await persist(next);
      if (this.refreshed.size >= 128) this.refreshed.delete(this.refreshed.keys().next().value!);
      this.refreshed.set(refreshKey, { previous: state.refreshToken, next }); return next;
    });
    this.refreshes.set(refreshKey, refresh);
    try { return await refresh; } finally { if (this.refreshes.get(refreshKey) === refresh) this.refreshes.delete(refreshKey); }
  }
}
