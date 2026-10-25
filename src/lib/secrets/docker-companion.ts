// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from "../native-runtime-contract.ts";
import { dockerIdentity, dockerScope, dockerReadParams, sameDockerIdentity, sameDockerScope, dockerNativeOperationId, dockerNativeApi,
  dockerNativeProfile as profile, dockerNativeLimits as limits, type DockerHostIdentity, type DockerReadScope } from "../docker-native-contract.ts";
import { nativeHost } from "./native-runtime-config.ts";
import { VaultError, type VaultErrorCode } from "./types.ts";
import type { WorkflowResponse } from "../workflow-execution.ts";
export type DockerCompanionRuntime = { fetchRequest?: typeof fetch; now?: () => number };
type Pair = { scope: DockerReadScope; identity: DockerHostIdentity; expiresAt: number; host: string };
const failures: VaultErrorCode[] = ["PERMISSION", "LIMIT", "DOCKER_UNAVAILABLE", "DOCKER_VERSION", "DOCKER_AUTHORITY", "DOCKER_DUPLEX"];

/** Pairing credentials and daemon responses live only in the owning worker. */
export class DockerCompanionBroker {
  private readonly runtime: DockerCompanionRuntime;
  private readonly pairs = new Map<string, Pair>();
  private readonly controllers = new Map<AbortController, string>();
  constructor(runtime: DockerCompanionRuntime = {}) { this.runtime = runtime; }
  connected(id: string): boolean { return (this.pairs.get(id)?.expiresAt ?? 0) > (this.runtime.now ?? Date.now)(); }
  close(id: string): void { this.pairs.delete(id); for (const [controller, owner] of this.controllers) if (owner === id) controller.abort(); }
  clear(): void { this.pairs.clear(); for (const controller of this.controllers.keys()) controller.abort(); this.controllers.clear(); }
  private async request(host: string, key: string, path: string, scope: DockerReadScope, extra: Record<string, unknown>,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(key) || this.controllers.size >= limits.pending) throw new VaultError("PERMISSION");
    const controller = new AbortController(); this.controllers.set(controller, scope.connectionId);
    const cancellation = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.requestMs), ...(signal ? [signal] : [])]);
    try {
      await guard(); if (cancellation.aborted) throw new VaultError("CANCELLED");
      const body = JSON.stringify({ profile, scope, ...extra });
      if (new TextEncoder().encode(body).byteLength > limits.input) throw new VaultError("LIMIT");
      const response = await (this.runtime.fetchRequest ?? fetch)(nativeHost(host) + path, { method: "POST", redirect: "error", credentials: "omit",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body, signal: cancellation });
      if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw new VaultError("DOCKER_UNAVAILABLE");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
          if (size > limits.response + 65536) throw new VaultError("LIMIT"); chunks.push(part.value); }
      } finally { try { await reader.cancel(); } catch { /* Network may be closed already. */ } reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.includes(key)) throw new VaultError("REDACTED");
      const value: unknown = JSON.parse(text);
      if (!response.ok) {
        const error = nativeObject(value, ["error"]).error;
        throw new VaultError(failures.includes(error as VaultErrorCode) ? error as VaultErrorCode : "DOCKER_UNAVAILABLE");
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new VaultError("DOCKER_UNAVAILABLE");
      await guard(); if (cancellation.aborted) throw new VaultError("CANCELLED"); return value as Record<string, unknown>;
    } catch (error) { throw signal?.aborted || controller.signal.aborted ? new VaultError("CANCELLED")
      : error instanceof VaultError ? error : new VaultError("DOCKER_UNAVAILABLE"); }
    finally { this.controllers.delete(controller); }
  }
  async check(id: string, host: string, key: string, fingerprint: string, expected: DockerHostIdentity | undefined,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<Pair> {
    const scope = dockerScope({ connectionId: id, operation: dockerNativeOperationId, apiVersion: dockerNativeApi, fingerprint });
    for (const [id, pair] of this.pairs) if (pair.expiresAt <= (this.runtime.now ?? Date.now)()) this.pairs.delete(id);
    if (!this.pairs.has(id) && this.pairs.size >= 4) throw new VaultError("LIMIT");
    try {
      const data = nativeObject(await this.request(host, key, "/v1/docker/pair", scope, {}, guard, signal), ["profile", "scope", "identity", "expiresAt"]);
      const identity = dockerIdentity(data.identity), paired = dockerScope(data.scope), now = (this.runtime.now ?? Date.now)();
      if (data.profile !== profile || !sameDockerScope(paired, scope) || !Number.isSafeInteger(data.expiresAt)
        || (data.expiresAt as number) <= now || (data.expiresAt as number) > now + limits.sessionMs || expected && !sameDockerIdentity(expected, identity)) throw new VaultError("DOCKER_AUTHORITY");
      const pair = { scope, identity, host: nativeHost(host), expiresAt: data.expiresAt as number }; this.pairs.set(id, pair); return pair;
    } catch (error) { this.close(id); throw error; }
  }
  async read(id: string, host: string, key: string, fingerprint: string, expected: DockerHostIdentity, input: unknown,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<WorkflowResponse> {
    try {
      const params = dockerReadParams(input);
      let pair = this.pairs.get(id);
      if (!pair || !this.connected(id) || pair.scope.fingerprint !== fingerprint || pair.host !== nativeHost(host)
        || !sameDockerIdentity(pair.identity, expected)) pair = await this.check(id, host, key, fingerprint, expected, guard, signal);
      const data = nativeObject(await this.request(host, key, "/v1/docker/read", pair.scope, { identity: expected, params }, guard, signal), ["profile", "scope", "identity", "response"]);
      if (data.profile !== profile || !sameDockerScope(dockerScope(data.scope), pair.scope) || !sameDockerIdentity(expected, dockerIdentity(data.identity))
        || pair.expiresAt <= (this.runtime.now ?? Date.now)()) throw new VaultError("DOCKER_AUTHORITY");
      const response = nativeObject(data.response, ["status", "statusText", "headers", "body", "mediaType"]);
      if (!Number.isInteger(response.status) || (response.status as number) < 200 || (response.status as number) > 599
        || typeof response.statusText !== "string" || response.statusText.length > 256 || response.mediaType !== "application/json"
        || !response.headers || typeof response.headers !== "object" || Array.isArray(response.headers)
        || Object.entries(response.headers).some(([key, value]) => !["content-type", "api-version", "docker-experimental", "ostype", "server"].includes(key) || typeof value !== "string" || value.length > 4096)
        || response.status === 200 && !Array.isArray(response.body)) throw new VaultError("DOCKER_UNAVAILABLE");
      return { ...response } as WorkflowResponse;
    } catch (error) { this.close(id); throw error instanceof VaultError ? error : new VaultError("PERMISSION"); }
  }
}
