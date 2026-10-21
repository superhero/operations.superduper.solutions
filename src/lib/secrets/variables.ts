// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError } from "./types.ts";
import { validatePrivateExpression, type PrivateExpression } from "./processing.ts";

/** Local references only; these are never decrypted by the workflow runner. */
export type VaultVariableInput = { key: string; path: string[] } &
  ({ credentialId: string; expression?: never } | { expression: PrivateExpression; credentialId?: never });
export const vaultVariablePlaceholder = "[Vault variable]";
export type VaultVariableReference = { vaultVariable: string; referenceToken: string };
export function isVaultVariableReference(value: unknown, token: string): value is VaultVariableReference {
  return !!value && typeof value === "object" && Object.keys(value).length === 2 &&
    Object.hasOwn(value, "referenceToken") && (value as VaultVariableReference).referenceToken === token &&
    Object.hasOwn(value, "vaultVariable") && typeof (value as VaultVariableReference).vaultVariable === "string";
}
function plainArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype)
    throw new VaultError("INVALID");
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new VaultError("INVALID");
  return Array.from({ length: value.length }, (_, index) => {
    const property = properties[String(index)];
    if (!property || !property.enumerable || !("value" in property)) throw new VaultError("INVALID");
    return property.value as unknown;
  });
}
export function validateVaultVariableInputs(value: unknown): VaultVariableInput[] {
  const inputs = plainArray(value, 5000);
  if (!inputs.length) throw new VaultError("INVALID");
  const seen = new Set<string>();
  return inputs.map(value => {
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== 3)
      throw new VaultError("INVALID");
    const properties = Object.getOwnPropertyDescriptors(value);
    const source = Object.hasOwn(properties, "expression") ? "expression" : "credentialId";
    if (["key", "path", source].some(key => !properties[key]?.enumerable || !("value" in properties[key]!))) throw new VaultError("INVALID");
    const key: unknown = properties.key!.value, credentialId: unknown = properties.credentialId?.value;
    const path = plainArray(properties.path!.value, 40);
    if (typeof key !== "string" || !key || key.length > 2048 || source === "credentialId" && (typeof credentialId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(credentialId)) ||
      path.some(part => typeof part !== "string" || part.length > 2048)) throw new VaultError("INVALID");
    const identity = JSON.stringify([key, path]);
    if (seen.has(identity)) throw new VaultError("INVALID");
    seen.add(identity);
    return source === "credentialId" ? { key, path: path as string[], credentialId: credentialId as string }
      : { key, path: path as string[], expression: validatePrivateExpression(properties.expression!.value) };
  });
}
