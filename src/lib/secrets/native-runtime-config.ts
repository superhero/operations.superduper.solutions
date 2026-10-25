// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeIdentity, nativeObject, nativeRuntimeProfile, nativeUuid, type NativeRuntimeIdentity } from "../native-runtime-contract.ts";
import { VaultError, type VaultCredential } from "./types.ts";
import { canonicalPolicyValue } from "./policy.ts";
export type NativeRuntimeReference = { id: string; revision: number; fingerprint: string };
export type NativeWorkflowBinding = { runtime: NativeRuntimeReference; fingerprint: string };
export function validateNativeBinding(value: unknown): NativeWorkflowBinding {
  try {
    const item = nativeObject(value, ["runtime", "fingerprint"]);
    if (typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new Error();
    return { runtime: validateNativeReference(item.runtime), fingerprint: item.fingerprint };
  } catch { throw new VaultError("INVALID"); }
}
export type NativeRuntimeConnection = NativeRuntimeReference & { profile: typeof nativeRuntimeProfile; label: string; host: string;
  pairingKeyId: string; keyHash: string; identity: NativeRuntimeIdentity; modelFingerprint: string; accountType: "none" | "apiKey" | "chatgpt";
  workflowFingerprint?: string };
export type NativeRuntimeInput = { label: string; host: string; pairingKeyId: string };
export function nativeHost(value: unknown): string {
  try {
    if (typeof value !== "string" || value.length > 2048 || /[\\\s]/.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { throw new VaultError("PERMISSION"); }
}
export const nativeReference = ({ id, revision, fingerprint }: NativeRuntimeReference): NativeRuntimeReference => ({ id, revision, fingerprint });
export function validateNativeReference(value: unknown): NativeRuntimeReference {
  try {
    const item = nativeObject(value, ["id", "revision", "fingerprint"]);
    if (!nativeUuid(item.id) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1
      || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new Error();
    return { ...item } as NativeRuntimeReference;
  } catch { throw new VaultError("INVALID"); }
}
export function validateNativeInput(value: unknown): NativeRuntimeInput {
  try {
    const item = nativeObject(value, ["label", "host", "pairingKeyId"]);
    if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 120 || /[\u0000-\u001f\u007f]/.test(item.label)
      || !nativeUuid(item.pairingKeyId)) throw new Error();
    return { label: item.label.trim(), host: nativeHost(item.host), pairingKeyId: item.pairingKeyId };
  } catch { throw new VaultError("INVALID"); }
}
export function validateNativeConnection(value: unknown): NativeRuntimeConnection {
  try {
    const item = nativeObject(value, ["id", "revision", "fingerprint", "profile", "label", "host", "pairingKeyId", "keyHash", "identity", "modelFingerprint", "accountType",
      ...(value && typeof value === "object" && Object.hasOwn(value, "workflowFingerprint") ? ["workflowFingerprint"] : [])]);
    validateNativeReference({ id: item.id, revision: item.revision, fingerprint: item.fingerprint });
    validateNativeInput({ label: item.label, host: item.host, pairingKeyId: item.pairingKeyId });
    if (item.profile !== nativeRuntimeProfile || item.host !== nativeHost(item.host) || !["none", "apiKey", "chatgpt"].includes(String(item.accountType))
      || ![item.keyHash, item.modelFingerprint, ...(item.workflowFingerprint !== undefined ? [item.workflowFingerprint] : [])]
        .every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) throw new Error();
    return { ...item, identity: nativeIdentity(item.identity) } as NativeRuntimeConnection;
  } catch { throw new VaultError("INVALID"); }
}
export async function nativeHash(value: unknown): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPolicyValue(value)))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function storedNativeConnections(records: readonly VaultCredential[]): NativeRuntimeConnection[] {
  const connections = records.flatMap(record => (record.nativeConnections ?? []).map(value => {
    const connection = validateNativeConnection(value);
    if (connection.pairingKeyId !== record.id) throw new VaultError("INVALID");
    return connection;
  }));
  if (connections.length > 32 || new Set(connections.map(item => item.id)).size !== connections.length) throw new VaultError("LIMIT");
  return connections;
}
