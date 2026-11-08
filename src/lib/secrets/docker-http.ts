// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { dockerHttpOperation, dockerHttpPrivatePaths } from "../docker-http.ts";
import { vaultVariablePlaceholder, type VaultVariableInput } from "./variables.ts";
import { VaultError, vaultLimits } from "./types.ts";
import type { Operation } from "../catalog.ts";
import type { PreparedRequest, InputValues } from "../operation-input.ts";
import type { AcquiredReference, AcquiredValue } from "./credential-results.ts";
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** A private ancestor may hold the entire config; a private leaf may hold only its key. */
export function assertDockerPrivateBindings(operation: Operation, values: InputValues, variables: readonly VaultVariableInput[]): void {
  for (const slot of dockerHttpPrivatePaths(operation)) {
    const raw = values[slot.key]; if (!raw) continue;
    let value: unknown = raw;
    if (raw !== vaultVariablePlaceholder) { try { value = JSON.parse(raw); } catch { continue; } }
    for (let depth = 0; depth <= slot.path.length; depth++) {
      if (value === vaultVariablePlaceholder && variables.some(variable => variable.key === slot.key
        && JSON.stringify(variable.path) === JSON.stringify(slot.path.slice(0, depth)))) break;
      if (value === undefined || value === null || value === "") break;
      if (depth === slot.path.length) throw new VaultError("PERMISSION");
      value = object(value) ? value[slot.path[depth]!] : undefined;
    }
  }
}
function decoded(value: string): string {
  const encoded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
/** Docker may echo the decoded AuthConfig, including its nested Basic auth value. */
export function dockerHttpRedactions(operation: Operation, request: PreparedRequest): string[] {
  const id = dockerHttpOperation(operation);
  if (!id) return [];
  const values: string[] = [];
  for (const [name, raw] of Object.entries(request.headers ?? {})) if (["x-registry-auth", "x-registry-config"].includes(name.toLowerCase())) {
    if (raw.length > vaultLimits.secretBytes) throw new VaultError("LIMIT");
    let root: unknown;
    try { root = JSON.parse(decoded(raw)); } catch { throw new VaultError("INVALID"); }
    if (!object(root)) throw new VaultError("INVALID");
    const pending: unknown[] = [root];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === "string") values.push(value);
      else if (value && typeof value === "object") {
        pending.push(...Object.values(value));
        if (object(value) && typeof value.auth === "string") try {
          const basic = decoded(value.auth), separator = basic.indexOf(":");
          if (separator >= 0) values.push(basic, basic.slice(0, separator), basic.slice(separator + 1));
        } catch { /* The provider handles an invalid nested auth value; its exact value is still redacted. */ }
      }
    }
  }
  const body = object(request.body) ? request.body as Record<string, unknown> : undefined;
  for (const slot of dockerHttpPrivatePaths(operation)) {
    let value = body?.[slot.key.slice("body:".length)];
    for (const part of slot.path) value = object(value) ? value[part] : undefined;
    if (typeof value === "string") {
      values.push(value); try { values.push(decoded(value)); } catch { /* A raw key is already included. */ }
    }
  }
  if (["SecretCreate", "SecretUpdate"].includes(id) && typeof body?.Data === "string")
    try { values.push(decoded(body.Data)); } catch { /* A binary secret has no UTF-8 reflection. Its encoded value stays private. */ }
  return values.filter(Boolean);
}

/** A successful registry check may issue no token, including the native 204 case. */
export function prepareDockerAuthResult(status: number, input: unknown) {
  if (status === 204) {
    if (input !== undefined && input !== null) throw new VaultError("INVALID");
    return { values: [] as AcquiredValue[], complete(references: readonly AcquiredReference[]) {
      if (references.length) throw new VaultError("INVALID"); return null;
    } };
  }
  if (status !== 200 || !object(input) || typeof input.Status !== "string"
    || input.IdentityToken !== undefined && (typeof input.IdentityToken !== "string" || !input.IdentityToken.isWellFormed())) throw new VaultError("INVALID");
  const token = input.IdentityToken as string | undefined;
  if (token && new TextEncoder().encode(token).byteLength > vaultLimits.secretBytes) throw new VaultError("LIMIT");
  const values: AcquiredValue[] = token ? [{ field: "IdentityToken", value: token }] : [];
  return { values, complete(references: readonly AcquiredReference[]) {
    if (references.length !== values.length) throw new VaultError("INVALID");
    const reference = references[0];
    if (token && (!reference || typeof reference.credentialId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference.credentialId)
      || typeof reference.label !== "string" || Object.keys(reference).sort().join(",") !== "credentialId,label")) throw new VaultError("INVALID");
    return { Status: input.Status, ...(token !== undefined ? { IdentityToken: token ? structuredClone(reference) : null } : {}) };
  } };
}
