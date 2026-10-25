// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import { scopeOperationSchema } from "../operation-report.ts";
import { dockerNativeReadOperation } from "../docker-native-model.ts";
import { dockerNativeProfile } from "../docker-native-contract.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { nativeHash } from "./native-runtime-config.ts";
import { VaultError } from "./types.ts";

export type ApprovedDockerOperation = { protocol: "docker-unix"; profile: typeof dockerNativeProfile; fingerprint: string;
  operation: Operation; document: Record<string, unknown> };
export async function approvedDockerOperation(operation: Operation, document: Record<string, unknown>): Promise<ApprovedDockerOperation> {
  try {
    const clean = JSON.parse(canonicalPolicyValue(operation)) as Operation;
    const source = JSON.parse(canonicalPolicyValue(document)) as Record<string, unknown>;
    const canonical = dockerNativeReadOperation(source, clean), scoped = scopeOperationSchema(source, clean.path, clean.method, true).schema;
    if (!canonical || canonicalPolicyValue(canonical) !== canonicalPolicyValue(clean) || canonicalPolicyValue(scoped) !== canonicalPolicyValue(source)
      || new TextEncoder().encode(JSON.stringify(source)).byteLength > 1024 * 1024) throw new Error();
    const value: Omit<ApprovedDockerOperation, "fingerprint"> = { protocol: "docker-unix", profile: dockerNativeProfile, operation: canonical, document: scoped };
    return { ...value, fingerprint: await nativeHash(value) };
  } catch { throw new VaultError("PERMISSION"); }
}
