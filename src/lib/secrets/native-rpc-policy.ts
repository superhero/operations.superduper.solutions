// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import { nativeRpcOperation, scopeNativeRpcSchema } from "../native-rpc.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { VaultError } from "./types.ts";

export type ApprovedNativeOperation = { protocol: "json-rpc"; fingerprint: string; operation: Operation; document: Record<string, unknown> };

/** A native model approval is separate from HTTP credential/destination approval.
 * Only schema storage publishes this fingerprint; it does not authorize execution. */
export async function approvedNativeOperation(operation: Operation, document: Record<string, unknown>): Promise<ApprovedNativeOperation>
{
  try {
    const sanitized = JSON.parse(canonicalPolicyValue(operation)) as Operation;
    const source = JSON.parse(canonicalPolicyValue(document)) as Record<string, unknown>;
    const canonical = nativeRpcOperation(source, sanitized.id);
    const scoped = scopeNativeRpcSchema(source, canonical.rpc!.method);
    if (canonicalPolicyValue(sanitized) !== canonicalPolicyValue(canonical)
      || canonicalPolicyValue(source) !== canonicalPolicyValue(scoped)) throw new VaultError("PERMISSION");
    const value = { protocol: "json-rpc" as const, operation: canonical, document: scoped };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPolicyValue(value)));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const freeze = (value: unknown): void => {
      if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    };
    const descriptor = { ...value, fingerprint }; freeze(descriptor); return descriptor;
  } catch { throw new VaultError("PERMISSION"); }
}

export async function validateApprovedNativeOperation(descriptor: ApprovedNativeOperation): Promise<ApprovedNativeOperation>
{
  try {
    const snapshot = JSON.parse(canonicalPolicyValue(descriptor)) as ApprovedNativeOperation;
    const approved = await approvedNativeOperation(snapshot.operation, snapshot.document);
    if (canonicalPolicyValue(approved) !== canonicalPolicyValue(snapshot)) throw new VaultError("PERMISSION");
    return approved;
  } catch { throw new VaultError("PERMISSION"); }
}
