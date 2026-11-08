// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { awsGetBodyProfile, awsGetBodyOperation, awsGetBodyRegion, awsGetBodyInput, awsGetBodyResponseLimit } from "../aws-get-body-contract.ts";
import { nativeHost } from "./native-runtime-config.ts";
import { VaultError, type ApprovedOperation, type VaultCredential } from "./types.ts";
export type AwsGetBodyRelayInput = { host: string; pairingKeyId: string };
export type AwsGetBodyRelay = AwsGetBodyRelayInput & { keyHash: string };
export function validateAwsGetBodyRelay(value: unknown, stored = true): AwsGetBodyRelay {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VaultError("INVALID");
  const item = value as Record<string, unknown>, keys = ["host", "pairingKeyId", ...(stored ? ["keyHash"] : [])];
  if (Object.keys(item).length !== keys.length || Object.keys(item).some(key => !keys.includes(key))
    || typeof item.pairingKeyId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(item.pairingKeyId)
    || stored && (typeof item.keyHash !== "string" || !/^[a-f0-9]{64}$/.test(item.keyHash))) throw new VaultError("INVALID");
  const host = nativeHost(item.host);
  if (host !== item.host) throw new VaultError("INVALID");
  return { host, pairingKeyId: item.pairingKeyId, ...(stored ? { keyHash: item.keyHash as string } : {}) } as AwsGetBodyRelay;
}
export const awsGetBodyEligible = (descriptor: ApprovedOperation): boolean => descriptor.operation.id === awsGetBodyOperation
  && descriptor.operation.awsRest === "aws-rest-v1" && descriptor.operation.method === "GET";
export async function awsGetBodyKeyHash(value: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(value)) throw new VaultError("INVALID");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function resolveAwsGetBodyKey(relay: AwsGetBodyRelay, records: readonly VaultCredential[]): Promise<string> {
  const selected = records.filter(record => record.id === relay.pairingKeyId);
  if (selected.length !== 1 || selected[0]!.kind !== "secret" || selected[0]!.oauthState
    || await awsGetBodyKeyHash(selected[0]!.value) !== relay.keyHash) throw new VaultError("PERMISSION");
  return selected[0]!.value;
}
/** Runs only inside the vault worker, after signing and the ordinary guards. */
export async function fetchAwsGetBody(descriptor: ApprovedOperation, relay: AwsGetBodyRelay, records: readonly VaultCredential[],
  address: string, init: RequestInit, fetchRequest: typeof fetch, guard: () => void | Promise<void>): Promise<Response> {
  if (!awsGetBodyEligible(descriptor) || init.method !== "GET" || !(init.body instanceof Uint8Array)) throw new VaultError("PERMISSION");
  awsGetBodyRegion(address);
  const body = awsGetBodyInput(new TextDecoder("utf-8", { fatal: true }).decode(init.body)), key = await resolveAwsGetBodyKey(relay, records);
  await guard(); if (init.signal?.aborted) throw new VaultError("CANCELLED");
  const response = await fetchRequest(relay.host + "/v1/efs/account-preferences", { method: "POST", redirect: "error", credentials: "omit",
    cache: "no-store", referrerPolicy: "no-referrer", ...(init.signal ? { signal: init.signal } : {}),
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ profile: awsGetBodyProfile, fingerprint: descriptor.fingerprint, address, headers: Object.fromEntries(new Headers(init.headers)), body }) });
  await guard(); if (init.signal?.aborted) throw new VaultError("CANCELLED");
  if (response.status !== 200 || response.redirected || response.headers.get("Content-Type")?.split(";")[0] !== "application/json")
    throw new VaultError("NETWORK");
  const reader = response.body?.getReader(); if (!reader) throw new VaultError("NETWORK");
  const chunks: Uint8Array[] = []; let length = 0;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new VaultError("CANCELLED")); });
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (init.signal?.aborted) throw new VaultError("CANCELLED");
      const part = await Promise.race([reader.read(), cancelled]); if (part.done) break;
      length += part.value.length; if (length > awsGetBodyResponseLimit + 65536) throw new VaultError("LIMIT"); chunks.push(part.value);
    }
  } finally { init.signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  await guard(); if (init.signal?.aborted) throw new VaultError("CANCELLED");
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).sort().join(",") !== "body,fingerprint,headers,profile,status,statusText"
    || result.profile !== awsGetBodyProfile || result.fingerprint !== descriptor.fingerprint || !Number.isInteger(result.status)
    || (result.status as number) < 200 || (result.status as number) > 599 || (result.status as number) >= 300 && (result.status as number) < 400
    || typeof result.statusText !== "string" || !/^[\x20-\x7e]{0,128}$/.test(result.statusText)
    || typeof result.body !== "string" || new TextEncoder().encode(result.body).length > awsGetBodyResponseLimit
    || !result.headers || typeof result.headers !== "object" || Array.isArray(result.headers)
    || Object.keys(result.headers).some(key => !["content-type", "x-amzn-requestid"].includes(key))
    || Object.values(result.headers).some(value => typeof value !== "string" || value.length > 1024 || /[\r\n]/.test(value))) throw new VaultError("NETWORK");
  return new Response([204, 205].includes(result.status as number) ? null : result.body,
    { status: result.status as number, statusText: result.statusText, headers: result.headers as Record<string, string> });
}
