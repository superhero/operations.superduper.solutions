// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { credentialObject } from "./bindings.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { validateJiraInput, validateJiraMetadata, jiraHost, jiraSiteUrl, jiraUuid, jiraOAuthProfile, jiraOAuthScope,
  type JiraOAuthInput, type JiraOAuthTask, type JiraOAuthSite } from "./jira-config.ts";
import { VaultError, type ApprovedOperation, type JiraOAuthMetadata, type HttpConnectionReference } from "./types.ts";

type HostConfiguration = { profile: string; hostId: string; publicOrigin: string; clientId: string; redirectUri: string;
  fingerprint: string; audience: string; scope: string };
export type JiraCompanionState = { profile: "atlassian-jira-3lo-v1"; oauth: JiraOAuthMetadata; origin: string;
  accessKeyId: string; accessKeyHash: string; connectionId: string; capability: string; disconnected?: true };
export type JiraCompanionRuntime = { now?: () => number; applicationOrigin?: () => string; fetchRequest?: typeof fetch };
type Pending = { input: JiraOAuthInput; descriptor: ApprovedOperation; replace?: HttpConnectionReference; configuration: HostConfiguration;
  claim: string; accessKey: string; accessKeyHash: string; task: JiraOAuthTask; sites?: JiraOAuthSite[]; origin: string };
const encoder = new TextEncoder();
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function jiraAccessKeyHash(value: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new VaultError("INVALID");
  return hash(value);
}
export function validateJiraState(encoded: string, expected?: JiraOAuthMetadata): JiraCompanionState {
  try {
    const state = credentialObject(JSON.parse(encoded)), oauth = validateJiraMetadata(state.oauth);
    if (Object.keys(state).some(key => !["profile", "oauth", "origin", "accessKeyId", "accessKeyHash", "connectionId", "capability", "disconnected"].includes(key))
      || state.profile !== jiraOAuthProfile || !jiraUuid(state.accessKeyId) || !jiraUuid(state.connectionId)
      || typeof state.accessKeyHash !== "string" || !/^[a-f0-9]{64}$/.test(state.accessKeyHash)
      || typeof state.capability !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state.capability)
      || state.disconnected !== undefined && state.disconnected !== true || typeof state.origin !== "string"
      || new URL(state.origin).origin !== state.origin || expected && canonicalPolicyValue(oauth) !== canonicalPolicyValue(expected)) throw new Error();
    jiraHost(oauth.host, state.origin);
    return { ...state, oauth } as JiraCompanionState;
  } catch { throw new VaultError("AUTHORIZATION"); }
}
export class JiraCompanionBroker {
  private pending = new Map<string, Pending>();
  private controllers = new Set<AbortController>();
  private generation = 0;
  private readonly now: () => number;
  private readonly applicationOrigin: () => string;
  private readonly runtime: JiraCompanionRuntime;
  constructor(runtime: JiraCompanionRuntime = {}) {
    this.runtime = runtime;
    this.now = runtime.now ?? Date.now; this.applicationOrigin = runtime.applicationOrigin ?? (() => globalThis.location?.origin ?? "");
  }
  clear(): void {
    this.generation++; for (const controller of this.controllers) controller.abort(); this.controllers.clear();
    const pending = [...this.pending.values()]; this.pending.clear();
    // Cancellation is best effort on the already approved host. The local claim
    // is discarded immediately; unreachable host tasks expire within five minutes.
    for (const item of pending) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
      void this.request(item.input.host, item.accessKey, "/v1/jira/authorizations/" + item.task.id, controller.signal,
        { method: "DELETE", configuration: item.configuration.fingerprint, claim: item.claim }).catch(() => {}).finally(() => clearTimeout(timer));
    }
  }
  pendingInput(id: string): Pending {
    const pending = this.pending.get(id);
    if (!pending || pending.task.expiresAt <= this.now() || pending.origin !== this.applicationOrigin()) throw new VaultError("AUTHORIZATION");
    return pending;
  }
  assertState(state: JiraCompanionState): void {
    validateJiraMetadata(state.oauth);
    if (state.origin !== this.applicationOrigin() || state.disconnected) throw new VaultError("AUTHORIZATION");
    jiraHost(state.oauth.host, state.origin);
  }
  private async operation<T>(signal: AbortSignal | undefined, guard: () => Promise<void>, action: (signal: AbortSignal) => Promise<T>, duration = 15000): Promise<T> {
    const controller = new AbortController(), generation = this.generation;
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); this.controllers.add(controller);
    const timer = setTimeout(abort, duration);
    try {
      await guard(); if (controller.signal.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      const value = await action(controller.signal);
      await guard(); if (controller.signal.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      return value;
    } catch (error) {
      if (signal?.aborted || generation !== this.generation) throw new VaultError("CANCELLED");
      throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION");
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); this.controllers.delete(controller); }
  }
  private async request(host: string, key: string, path: string, signal: AbortSignal, options: {
    body?: unknown; method?: string; configuration?: string; claim?: string; capability?: string; limit?: number;
  } = {}): Promise<Record<string, unknown>> {
    const response = await (this.runtime.fetchRequest ?? globalThis.fetch)(host + path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"), signal, redirect: "error",
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { Authorization: "Bearer " + key, Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(options.configuration ? { "X-Operations-Companion": options.configuration } : {}),
        ...(options.claim ? { "X-Operations-Claim": options.claim } : {}),
        ...(options.capability ? { "X-Operations-Connection": options.capability } : {}) },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    if (!response.ok || response.redirected || response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      || options.configuration && response.headers.get("X-Operations-Companion") !== options.configuration) throw new VaultError("AUTHORIZATION");
    const reader = response.body?.getReader(); if (!reader) throw new VaultError("AUTHORIZATION");
    const chunks: Uint8Array[] = []; let length = 0;
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new VaultError("CANCELLED")); });
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) abort();
      while (true) {
        const item = await Promise.race([reader.read(), aborted]); if (item.done) break;
        length += item.value.byteLength; if (length > (options.limit ?? 65536)) throw new VaultError("LIMIT"); chunks.push(item.value);
      }
      const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const result = credentialObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      if (options.configuration === undefined && result.fingerprint !== response.headers.get("X-Operations-Companion")) throw new VaultError("AUTHORIZATION");
      return result;
    } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async begin(inputValue: JiraOAuthInput, descriptor: ApprovedOperation, key: string, guard: () => Promise<void>,
    replace?: HttpConnectionReference, signal?: AbortSignal): Promise<JiraOAuthTask> {
    const origin = this.applicationOrigin(), input = validateJiraInput(inputValue, origin), accessKeyHash = await jiraAccessKeyHash(key);
    for (const [id, pending] of this.pending) if (pending.task.expiresAt <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 8) throw new VaultError("LIMIT");
    return this.operation(signal, guard, async signal => {
      const raw = await this.request(input.host, key, "/v1/jira/config", signal);
      if (Object.keys(raw).sort().join(",") !== "audience,clientId,fingerprint,hostId,profile,publicOrigin,redirectUri,scope"
        || raw.profile !== jiraOAuthProfile || raw.audience !== "api.atlassian.com" || raw.scope !== jiraOAuthScope
        || raw.publicOrigin !== input.host || !jiraUuid(raw.hostId) || typeof raw.clientId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(raw.clientId)
        || raw.redirectUri !== input.host + "/oauth/jira/callback" || typeof raw.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(raw.fingerprint)) throw new VaultError("AUTHORIZATION");
      const configuration = raw as HostConfiguration, claim = random();
      const started = await this.request(input.host, key, "/v1/jira/authorizations", signal,
        { body: { challenge: await hash(claim) }, configuration: configuration.fingerprint });
      if (Object.keys(started).sort().join(",") !== "authorizationUrl,expiresAt,fingerprint,id" || !jiraUuid(started.id)
        || started.fingerprint !== configuration.fingerprint || !Number.isSafeInteger(started.expiresAt)
        || (started.expiresAt as number) <= this.now() || (started.expiresAt as number) > this.now() + 300000 || typeof started.authorizationUrl !== "string") throw new VaultError("AUTHORIZATION");
      const url = new URL(started.authorizationUrl);
      const expected = { audience: "api.atlassian.com", client_id: configuration.clientId, scope: jiraOAuthScope,
        redirect_uri: configuration.redirectUri, response_type: "code", prompt: "consent" };
      if (url.origin !== "https://auth.atlassian.com" || url.pathname !== "/authorize" || url.hash || url.username || url.password
        || [...url.searchParams].length !== 7 || new Set([...url.searchParams.keys()]).size !== 7
        || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("state") ?? "")
        || Object.entries(expected).some(([name, value]) => url.searchParams.get(name) !== value)) throw new VaultError("AUTHORIZATION");
      const task = started as JiraOAuthTask;
      this.pending.set(task.id, { input, descriptor: structuredClone(descriptor), configuration, claim, accessKey: key, accessKeyHash, task, origin,
        ...(replace ? { replace: { ...replace } } : {}) });
      return structuredClone(task);
    });
  }
  async poll(id: string, guard: () => Promise<void>, signal?: AbortSignal): Promise<{ phase: "waiting" | "choose-site"; sites?: JiraOAuthSite[] }> {
    const pending = this.pendingInput(id);
    return this.operation(signal, guard, async signal => {
      const result = await this.request(pending.input.host, pending.accessKey, "/v1/jira/authorizations/" + id, signal,
        { configuration: pending.configuration.fingerprint, claim: pending.claim });
      if (result.phase === "choose-site") {
        if (Object.keys(result).sort().join(",") !== "phase,sites" || !Array.isArray(result.sites) || !result.sites.length || result.sites.length > 128) throw new VaultError("AUTHORIZATION");
        const sites = result.sites.map(value => {
          const site = credentialObject(value);
          if (Object.keys(site).sort().join(",") !== "id,name,url" || !jiraUuid(site.id) || typeof site.name !== "string"
            || !site.name.trim() || site.name.length > 120 || /[\u0000-\u001f\u007f]/.test(site.name)) throw new VaultError("AUTHORIZATION");
          return { id: site.id, name: site.name, url: jiraSiteUrl(site.url) };
        });
        if (new Set(sites.map(site => site.id)).size !== sites.length) throw new VaultError("AUTHORIZATION");
        pending.sites = sites; return { phase: "choose-site", sites: structuredClone(sites) };
      }
      if (result.phase !== "waiting" && result.phase !== "exchanging") throw new VaultError("AUTHORIZATION");
      return { phase: "waiting" };
    });
  }
  async select(id: string, cloudId: string, guard: () => Promise<void>, signal?: AbortSignal): Promise<JiraCompanionState> {
    const pending = this.pendingInput(id);
    if (!pending.sites?.some(site => site.id === cloudId && site.url === pending.descriptor.origin)) throw new VaultError("PERMISSION");
    return this.operation(signal, guard, async signal => {
      const result = await this.request(pending.input.host, pending.accessKey, "/v1/jira/authorizations/" + id + "/select", signal,
        { configuration: pending.configuration.fingerprint, claim: pending.claim, body: { cloudId } });
      if (Object.keys(result).sort().join(",") !== "accountId,capability,clientId,cloudId,fingerprint,hostId,id,profile,redirectUri,scope,siteUrl"
        || !jiraUuid(result.id) || typeof result.capability !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.capability)) throw new VaultError("AUTHORIZATION");
      const oauth = validateJiraMetadata({ profile: result.profile, host: pending.input.host, configuration: result.fingerprint, hostId: result.hostId,
        clientId: result.clientId, redirectUri: result.redirectUri, scope: result.scope, cloudId: result.cloudId, siteUrl: result.siteUrl, accountId: result.accountId });
      if (oauth.cloudId !== cloudId || oauth.siteUrl !== pending.descriptor.origin || oauth.configuration !== pending.configuration.fingerprint
        || oauth.clientId !== pending.configuration.clientId || oauth.hostId !== pending.configuration.hostId) throw new VaultError("AUTHORIZATION");
      return { profile: jiraOAuthProfile, oauth, origin: pending.origin, accessKeyId: pending.input.accessKeyId, accessKeyHash: pending.accessKeyHash,
        connectionId: result.id, capability: result.capability };
    });
  }
  forget(id: string): void { this.pending.delete(id); }
  async cancel(id: string): Promise<void> {
    const pending = this.pending.get(id); this.pending.delete(id); if (!pending) return;
    await this.operation(undefined, async () => {}, signal => this.request(pending.input.host, pending.accessKey, "/v1/jira/authorizations/" + id, signal,
      { method: "DELETE", configuration: pending.configuration.fingerprint, claim: pending.claim })).then(() => {});
  }
  async remove(state: JiraCompanionState, key: string, guard: () => Promise<void>): Promise<void> {
    const { disconnected: _disconnected, ...active } = state; this.assertState(active);
    await this.operation(undefined, guard, signal => this.request(state.oauth.host, key, "/v1/jira/connections/" + state.connectionId, signal,
      { method: "DELETE", configuration: state.oauth.configuration, capability: state.capability })).then(() => {});
  }
  async execute(state: JiraCompanionState, key: string, expand: string | undefined, guard: () => Promise<void>, signal?: AbortSignal) {
    this.assertState(state);
    if (await jiraAccessKeyHash(key) !== state.accessKeyHash) throw new VaultError("AUTHORIZATION");
    return this.operation(signal, guard, async signal => {
      const requestId = crypto.randomUUID(), result = await this.request(state.oauth.host, key, "/v1/jira/connections/" + state.connectionId + "/myself", signal,
        { configuration: state.oauth.configuration, capability: state.capability, body: { requestId, ...(expand ? { expand } : {}) }, limit: 8 * 1024 * 1024 + 65536 });
      if (Object.keys(result).sort().join(",") !== "accountId,cloudId,fingerprint,requestId,response" || result.requestId !== requestId
        || result.cloudId !== state.oauth.cloudId || result.accountId !== state.oauth.accountId || result.fingerprint !== state.oauth.configuration) throw new VaultError("AUTHORIZATION");
      const response = credentialObject(result.response);
      if (!["body,headers,status,statusText", "body,headers,redacted,status,statusText"].includes(Object.keys(response).sort().join(","))
        || !Number.isSafeInteger(response.status) || (response.status as number) < 200 || (response.status as number) > 599
        || response.statusText !== "" || canonicalPolicyValue(response.headers) !== '{"content-type":"application/json"}'
        || response.redacted !== undefined && response.redacted !== true) throw new VaultError("AUTHORIZATION");
      return response as unknown as import("../workflow-execution.ts").WorkflowResponse & { redacted?: boolean };
    });
  }
}
