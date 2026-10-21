// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { JsonValue } from "../catalog.ts";
import { processingDefinition, processWorkflowValue, validateProcessingData, validateProcessingValue, type ProcessingData, type ProcessingKind } from "../workflow-processing.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { VaultError, type VaultCredential } from "./types.ts";
import { isVaultVariableReference } from "./variables.ts";

export type PrivateExpression = { kind: "credential"; id: string } | { kind: "literal"; value: JsonValue }
  | { kind: "array"; items: PrivateExpression[] } | { kind: "object"; entries: Record<string, PrivateExpression> }
  | { kind: "process"; type: "transform" | "filter"; data: ProcessingData; value: PrivateExpression; key?: PrivateExpression; parameters?: Record<string, PrivateExpression> };
export type PrivateProcessingReference = { vaultProcessing: PrivateExpression; referenceToken: string };
export function isPrivateProcessingReference(value: unknown, token: string): value is PrivateProcessingReference {
  return !!value && typeof value === "object" && Object.keys(value).length === 2 && Object.hasOwn(value, "vaultProcessing")
    && (value as PrivateProcessingReference).referenceToken === token;
}
export function containsPrivateValue(value: unknown, token: string, depth = 0): boolean {
  if (depth > 40) throw new Error("Private processing exceeds the structure limit.");
  return isVaultVariableReference(value, token) || isPrivateProcessingReference(value, token)
    || !!value && typeof value === "object" && Object.values(value).some(entry => containsPrivateValue(entry, token, depth + 1));
}
export function privateExpressionFor(value: unknown, token: string): PrivateExpression {
  if (isVaultVariableReference(value, token)) return { kind: "credential", id: value.vaultVariable };
  if (isPrivateProcessingReference(value, token)) return value.vaultProcessing;
  if (!containsPrivateValue(value, token)) { validateProcessingValue(value); return { kind: "literal", value: structuredClone(value) }; }
  if (Array.isArray(value)) return { kind: "array", items: value.map(item => privateExpressionFor(item, token)) };
  return { kind: "object", entries: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, privateExpressionFor(entry, token)])) };
}
export function validatePrivateExpression(value: unknown): PrivateExpression {
  try {
    const serialized = canonicalPolicyValue(value);
    if (new TextEncoder().encode(serialized).length > 1_000_000) throw new VaultError("LIMIT");
    let count = 0;
    function visit(value: any, depth: number): PrivateExpression {
      if (++count > 1000 || depth > 24 || !value || typeof value !== "object" || Array.isArray(value)) throw new VaultError("INVALID");
      const keys = (names: string[]) => { if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) throw new VaultError("INVALID"); };
      if (value.kind === "credential") {
        keys(["kind", "id"]);
        if (typeof value.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id)) throw new VaultError("INVALID");
        return value;
      }
      if (value.kind === "literal") { keys(["kind", "value"]); validateProcessingValue(value.value); return value; }
      if (value.kind === "array") {
        keys(["kind", "items"]);
        if (!Array.isArray(value.items)) throw new VaultError("INVALID");
        return { kind: "array", items: value.items.map((item: unknown) => visit(item, depth + 1)) };
      }
      if (value.kind === "object") {
        keys(["kind", "entries"]);
        if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw new VaultError("INVALID");
        return { kind: "object", entries: Object.fromEntries(Object.entries(value.entries).map(([name, entry]) => [name, visit(entry, depth + 1)])) };
      }
      if (value.kind !== "process" || !["transform", "filter"].includes(value.type)) throw new VaultError("INVALID");
      keys(["kind", "type", "data", "value", ...(Object.hasOwn(value, "key") ? ["key"] : []), ...(Object.hasOwn(value, "parameters") ? ["parameters"] : [])]);
      const data = validateProcessingData(value.type, value.data);
      let parameters: Record<string, PrivateExpression> | undefined;
      if (Object.hasOwn(value, "parameters")) {
        const fields = processingDefinition(value.type, data).parameters.filter(field => field.connectable);
        if (!value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)
          || Object.keys(value.parameters).some(name => !fields.some(field => field.name === name))) throw new VaultError("INVALID");
        parameters = Object.fromEntries(Object.entries(value.parameters).map(([name, entry]) => [name, visit(entry, depth + 1)]));
      }
      return { kind: "process", type: value.type, data, value: visit(value.value, depth + 1),
        ...(Object.hasOwn(value, "key") ? { key: visit(value.key, depth + 1) } : {}), ...(parameters ? { parameters } : {}) };
    }
    return visit(JSON.parse(serialized), 0);
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("INVALID"); }
}

/** Only the vault execution worker calls this with decrypted records. */
export async function resolvePrivateExpression(expression: PrivateExpression, credentials: readonly VaultCredential[], derived: string[] = []): Promise<unknown> {
  const collected = new Set(derived);
  let collectedSize = derived.reduce((size, value) => size + value.length, 0);
  const collect = (value: unknown, depth = 0) => {
    if (depth > 40) throw new VaultError("LIMIT");
    if (typeof value === "string" && value && !collected.has(value)) {
      collectedSize += value.length;
      if (collected.size >= 10000 || collectedSize > 4_000_000) throw new VaultError("LIMIT");
      collected.add(value); derived.push(value);
    }
    else if (value && typeof value === "object") for (const entry of Object.values(value)) collect(entry, depth + 1);
  };
  async function resolve(value: PrivateExpression): Promise<unknown> {
    let result: unknown;
    if (value.kind === "credential") {
      const selected = credentials.filter(credential => credential.id === value.id);
      if (selected.length !== 1) throw new VaultError("PERMISSION");
      result = selected[0]!.value;
    }
    else if (value.kind === "literal") return structuredClone(value.value);
    else if (value.kind === "array") result = await Promise.all(value.items.map(resolve));
    else if (value.kind === "object") result = Object.fromEntries(await Promise.all(Object.entries(value.entries).map(async ([key, entry]) => [key, await resolve(entry)])));
    else result = await processWorkflowValue(value.type, value.data, await resolve(value.value), value.key ? await resolve(value.key) : undefined,
      value.parameters ? Object.fromEntries(await Promise.all(Object.entries(value.parameters).map(async ([name, entry]) => [name, await resolve(entry)]))) : undefined);
    collect(result);
    return result;
  }
  try { return await resolve(validatePrivateExpression(expression)); }
  catch (error) { throw error instanceof VaultError ? error : new VaultError("INVALID"); }
}
export async function checkPrivateAssertion(expression: PrivateExpression, data: ProcessingData, credentials: readonly VaultCredential[], parameters?: Record<string, PrivateExpression>): Promise<boolean> {
  try {
    if (parameters !== undefined && (!parameters || typeof parameters !== "object" || Array.isArray(parameters)
      || Object.keys(parameters).some(name => name !== "expected"))) throw new VaultError("INVALID");
    const resolved = parameters === undefined ? undefined : Object.fromEntries(await Promise.all(Object.entries(parameters)
      .map(async ([name, value]) => [name, await resolvePrivateExpression(value, credentials)])));
    return await processWorkflowValue("assert", validateProcessingData("assert", data), await resolvePrivateExpression(expression, credentials), undefined, resolved) as boolean;
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("INVALID"); }
}
