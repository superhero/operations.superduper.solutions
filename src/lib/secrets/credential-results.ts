// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { PrivateResultContract } from '../credential-results.ts';
import { VaultError, vaultLimits } from './types.ts';
export type AcquiredValue = { value: string; field: string };
export type AcquiredReference = { credentialId: string; label: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Used only inside the private executor. Raw leaves never become workflow values. */
export function prepareCredentialResults(contract: PrivateResultContract, status: number, input: unknown) {
  const responses = contract.responses.filter(item => item.status === status);
  if (!responses.length || !input || typeof input !== 'object') throw new VaultError('INVALID');
  const body = structuredClone(input), values: AcquiredValue[] = [], placements: { parent: Record<string, unknown> | unknown[]; key: string; index: number }[] = [];
  for (const response of responses) {
  const visit = (parent: unknown, depth: number) => {
    const segment = response.path[depth]!;
    if (segment === '*') {
      if (!Array.isArray(parent)) throw new VaultError('INVALID');
      if (parent.length > vaultLimits.records) throw new VaultError('LIMIT');
      for (const item of parent) visit(item, depth + 1);
      return;
    }
    if (!object(parent)) throw new VaultError('INVALID');
    // Unknown response fields have no reviewed classification and can contain new secrets.
    const allowed = response.parentFields[depth];
    if (!allowed) throw new VaultError('INVALID');
    for (const key of Object.keys(parent)) if (!allowed.includes(key)) delete parent[key];
    if (!Object.hasOwn(parent, segment)) { if (response.required[depth]) throw new VaultError('INVALID'); return; }
    const value = parent[segment];
    if (value === null) { if (!response.nullable[depth]) throw new VaultError('INVALID'); return; }
    if (depth !== response.path.length - 1) { visit(value, depth + 1); return; }
    if (typeof value !== 'string' || !value.isWellFormed()) throw new VaultError('INVALID');
    if (new TextEncoder().encode(value).byteLength > vaultLimits.secretBytes) throw new VaultError('LIMIT');
    if (!value || contract.masked && /^"?\*+"?$/.test(value)) { parent[segment] = null; return; }
    let index = values.findIndex(item => item.value === value);
    if (index < 0) { index = values.length; values.push({ value, field: response.path.filter(part => part !== '*').join('.') }); }
    placements.push({ parent, key: segment, index });
    // Remove the secret before awaiting storage; only the private values list retains it.
    parent[segment] = null;
  };
  visit(body, 0);
  }
  return { values, complete(references: readonly AcquiredReference[]) {
    if (references.length !== values.length || references.some(reference => !object(reference)
      || typeof reference.credentialId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(reference.credentialId)
      || typeof reference.label !== 'string' || Object.keys(reference).length !== 2)) throw new VaultError('INVALID');
    for (const item of placements) Object.defineProperty(item.parent, item.key, { value: structuredClone(references[item.index]), enumerable: true, writable: true, configurable: true });
    return body;
  } };
}
