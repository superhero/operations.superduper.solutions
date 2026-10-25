// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, type BasicCredentialReference, type OAuth1CredentialReference, type AwsCredentialReference, type CredentialReference, type CredentialBinding, type CredentialExecutionContext, type HttpConnectionReference } from "./types.ts";
import { validateVaultVariableInputs, type VaultVariableInput } from "./variables.ts";
import { cloudflareSessionField } from "../cloudflare-upload.ts";
import type { OperationSecurity } from "../operation-security.ts";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new VaultError("INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length
    || Object.values(descriptors).some(item => !item.enumerable || !("value" in item))) throw new VaultError("INVALID");
  return Object.fromEntries(Object.entries(descriptors).map(([name, item]) => [name, item.value]));
}
export { object as credentialObject };

export function isBasicCredentialReference(value: unknown): value is BasicCredentialReference {
  try {
    const pair = object(value);
    return Object.keys(pair).length === 2 && Object.keys(pair).every(key => key === "username" || key === "password")
      && typeof pair.username === "string" && uuid.test(pair.username) && typeof pair.password === "string" && uuid.test(pair.password);
  } catch { return false; }
}

export const oauth1CredentialParts = ["consumerKey", "consumerSecret", "accessToken", "tokenSecret"] as const;
export function isOAuth1CredentialReference(value: unknown): value is OAuth1CredentialReference {
  try {
    const reference = object(value);
    return Object.keys(reference).length === 4 && oauth1CredentialParts.every(part => typeof reference[part] === "string" && uuid.test(reference[part]));
  } catch { return false; }
}
export function credentialReferenceIds(reference: CredentialReference): string[] {
  return typeof reference === "string" ? [reference] : isBasicCredentialReference(reference)
    ? [reference.username, reference.password] : isAwsCredentialReference(reference)
    ? [reference.accessKeyId, reference.secretAccessKey, ...(reference.sessionToken ? [reference.sessionToken] : [])]
    : oauth1CredentialParts.map(part => (reference as OAuth1CredentialReference)[part]);
}
export const awsCredentialParts = ["accessKeyId", "secretAccessKey", "sessionToken"] as const;
export function isAwsCredentialReference(value: unknown): value is AwsCredentialReference {
  try {
    const item = object(value);
    return Object.keys(item).length === (item.sessionToken === undefined ? 2 : 3)
      && Object.keys(item).every(key => awsCredentialParts.includes(key as typeof awsCredentialParts[number]))
      && [item.accessKeyId, item.secretAccessKey, ...(item.sessionToken === undefined ? [] : [item.sessionToken])]
        .every(id => typeof id === "string" && uuid.test(id));
  } catch { return false; }
}

/** An opaque worker-owned reference may be wired to the upload Authorization input. */
export function uploadSessionSelection(security: OperationSecurity | undefined, value: unknown): Pick<CredentialBinding, "alternative" | "credentials"> | undefined {
  if (typeof value !== "string" || !uuid.test(value)) return;
  const alternative = security?.findIndex(option => option.length === 1 && option[0]?.kind === "cloudflare-upload");
  if (alternative === undefined || alternative < 0) return;
  return { alternative, credentials: { [security![alternative]![0]!.name]: value } };
}
export { cloudflareSessionField };

/** A direct vault-to-header connection already selects a key. Retain that choice
 * when a reviewed schema starts declaring the matching API-key requirement. */
export function credentialSelectionForVariables(security: OperationSecurity | undefined, variables: readonly VaultVariableInput[] = []):
  Pick<CredentialBinding, "alternative" | "credentials"> | undefined {
  const candidates = (security ?? []).flatMap((option, alternative) => {
    if (!option.length || option.some(scheme => scheme.kind !== "apiKey" || !scheme.header)) return [];
    const entries = option.map(scheme => {
      const inputs = variables.filter(input => !input.path.length && input.key.toLowerCase() === `header:${scheme.header!.toLowerCase()}`);
      const source = inputs.length === 1 ? inputs[0] : undefined;
      const id = source?.credentialId ?? (source?.expression?.kind === "credential" ? source.expression.id : undefined);
      return [scheme.name, id] as const;
    });
    return entries.every(([, id]) => typeof id === "string" && uuid.test(id))
      ? [{ alternative, credentials: Object.fromEntries(entries) as Record<string, string> }] : [];
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Opaque local references only. The encrypted vault owns all actual authorization. */
export function validateHttpConnectionReference(value: unknown): HttpConnectionReference {
  const item = object(value);
  if (Object.keys(item).length !== 3 || Object.keys(item).some(key => !["id", "revision", "fingerprint"].includes(key))
    || typeof item.id !== "string" || !uuid.test(item.id) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1
    || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new VaultError("INVALID");
  return { id: item.id, revision: item.revision as number, fingerprint: item.fingerprint };
}

export function validateCredentialBinding(value: unknown): CredentialBinding {
  const item = object(value);
  if (Object.keys(item).length !== (item.connection === undefined ? 3 : 4) || Object.keys(item).some(key => !["alternative", "credentials", "fingerprint", "connection"].includes(key))
    || !Number.isSafeInteger(item.alternative) || (item.alternative as number) < 0 || (item.alternative as number) > 31
    || typeof item.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new VaultError("INVALID");
  const entries = Object.entries(object(item.credentials));
  if (item.connection !== undefined && entries.length || entries.length > 16 || entries.some(([scheme, id]) => !scheme.trim() || scheme.length > 128
    || !(typeof id === "string" ? uuid.test(id) : isBasicCredentialReference(id) || isOAuth1CredentialReference(id) || isAwsCredentialReference(id)))) throw new VaultError("INVALID");
  return { alternative: item.alternative as number, fingerprint: item.fingerprint,
    credentials: Object.fromEntries(entries.map(([name, reference]) => [name, typeof reference === "string" ? reference
      : object(reference) as BasicCredentialReference | OAuth1CredentialReference | AwsCredentialReference])),
    ...(item.connection === undefined ? {} : { connection: validateHttpConnectionReference(item.connection) }) };
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
