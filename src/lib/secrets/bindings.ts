// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, type CredentialBinding, type CredentialExecutionContext } from "./types.ts";
import { validateVaultVariableInputs } from "./variables.ts";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new VaultError("INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length
    || Object.values(descriptors).some(item => !item.enumerable || !("value" in item))) throw new VaultError("INVALID");
  return Object.fromEntries(Object.entries(descriptors).map(([name, item]) => [name, item.value]));
}

/** Opaque local references only. The encrypted vault owns all actual authorization. */
export function validateCredentialBinding(value: unknown): CredentialBinding {
  const item = object(value);
  if (Object.keys(item).length !== 3 || Object.keys(item).some(key => !["alternative", "credentials", "fingerprint"].includes(key))
    || !Number.isSafeInteger(item.alternative) || (item.alternative as number) < 0 || (item.alternative as number) > 31
    || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new VaultError("INVALID");
  const entries = Object.entries(object(item.credentials));
  if (entries.length > 16 || entries.some(([scheme, id]) => !scheme.trim() || scheme.length > 128
    || typeof id !== "string" || !uuid.test(id))) throw new VaultError("INVALID");
  return { alternative: item.alternative as number, fingerprint: item.fingerprint,
    credentials: Object.fromEntries(entries) as Record<string, string> };
}

/** Run/node IDs correlate UI invocations; authorization comes from the descriptor and binding. */
export function validateCredentialContext(value: unknown): CredentialExecutionContext {
  const item = object(value);
  if (Object.keys(item).length !== (item.variables === undefined ? 3 : 4) || Object.keys(item).some(key => !["binding", "runId", "nodeId", "variables"].includes(key))
    || typeof item.runId !== "string" || !uuid.test(item.runId)
    || typeof item.nodeId !== "string" || !item.nodeId || item.nodeId.length > 4096) throw new VaultError("INVALID");
  return { binding: validateCredentialBinding(item.binding), runId: item.runId, nodeId: item.nodeId,
    ...(item.variables === undefined ? {} : { variables: validateVaultVariableInputs(item.variables) }) };
}
