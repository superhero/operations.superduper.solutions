// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeUuid } from "./native-runtime-contract.ts";

export const dockerNativeProfile = "docker-unix-read-v1";
export const dockerNativeApi = "1.57";
export const dockerNativeOperationId = "docker:ContainerList";
export const dockerNativePath = "/v1.57/containers/json";
export const dockerNativeLimits = { input: 65536, response: 2 * 1024 * 1024, pending: 4, pairings: 64,
  requestMs: 15000, socketMs: 5000, sessionMs: 15 * 60 * 1000 } as const;
export type DockerHostIdentity = { hostId: string; generation: string; configuration: string; socket: string; daemonId: string; apiVersion: typeof dockerNativeApi };
export type DockerReadScope = { connectionId: string; operation: typeof dockerNativeOperationId; apiVersion: typeof dockerNativeApi; fingerprint: string };
export type DockerReadParams = { all?: boolean; limit?: number; size?: boolean; filters?: string };
export const dockerDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function dockerIdentity(value: unknown): DockerHostIdentity {
  const item = nativeObject(value, ["hostId", "generation", "configuration", "socket", "daemonId", "apiVersion"]);
  if (!nativeUuid(item.hostId) || !nativeUuid(item.generation) || !dockerDigest(item.configuration) || !dockerDigest(item.socket)
    || typeof item.daemonId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,191}$/.test(item.daemonId) || item.apiVersion !== dockerNativeApi) throw new Error("Invalid Docker host identity.");
  return { ...item } as DockerHostIdentity;
}
export function sameDockerIdentity(left: DockerHostIdentity, right: DockerHostIdentity): boolean {
  return (Object.keys(dockerIdentity(left)) as (keyof DockerHostIdentity)[]).every(key => left[key] === right[key]);
}
export function dockerScope(value: unknown): DockerReadScope {
  const item = nativeObject(value, ["connectionId", "operation", "apiVersion", "fingerprint"]);
  if (!nativeUuid(item.connectionId) || item.operation !== dockerNativeOperationId || item.apiVersion !== dockerNativeApi || !dockerDigest(item.fingerprint)) throw new Error("Unsupported Docker read scope.");
  return { ...item } as DockerReadScope;
}
export const sameDockerScope = (left: DockerReadScope, right: DockerReadScope): boolean =>
  left.connectionId === right.connectionId && left.operation === right.operation && left.apiVersion === right.apiVersion && left.fingerprint === right.fingerprint;
export function dockerReadParams(value: unknown): DockerReadParams {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Docker parameters.");
  const item = nativeObject(value, Object.keys(value));
  if (Object.keys(item).some(key => !["all", "limit", "size", "filters"].includes(key))) throw new Error("Unsupported Docker parameters.");
  for (const key of ["all", "size"]) if (item[key] !== undefined && typeof item[key] !== "boolean") throw new Error("Invalid Docker boolean.");
  if (item.limit !== undefined && (!Number.isSafeInteger(item.limit) || (item.limit as number) < -2147483648 || (item.limit as number) > 2147483647)) throw new Error("Invalid Docker limit.");
  if (item.filters !== undefined) {
    if (typeof item.filters !== "string" || new TextEncoder().encode(item.filters).byteLength > 16384) throw new Error("Invalid Docker filters.");
    const filters: unknown = JSON.parse(item.filters);
    if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).length > 64) throw new Error("Invalid Docker filters.");
    for (const [key, entries] of Object.entries(filters)) if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)
      || !Array.isArray(entries) || entries.length > 64 || entries.some(value => typeof value !== "string" || value.length > 1024)) throw new Error("Invalid Docker filters.");
  }
  return { ...item } as DockerReadParams;
}
export function dockerReadPath(input: DockerReadParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(dockerReadParams(input))) if (value !== undefined) query.set(key, String(value));
  return dockerNativePath + (query.size ? "?" + query.toString() : "");
}
