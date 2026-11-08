// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultError, type VaultCredential } from './types.ts';
import { nativeObject, nativeUuid } from '../native-runtime-contract.ts';
import { managedAtprotoSecrets } from './atproto-state.ts';
import { managedGitlabSecrets } from './gitlab-oauth.ts';
import { validateJiraState } from './jira-companion.ts';

export function validateNativePrivateValues(value: unknown, connections: readonly { id: string }[]): Record<string, string[]> {
  try {
    const rows = nativeObject(value, Object.keys(value as object));
    if (Object.keys(rows).length > 32) throw new Error();
    for (const [id, values] of Object.entries(rows)) {
      if (!nativeUuid(id) || !connections.some(connection => connection.id === id) || !Array.isArray(values)
        || Object.getPrototypeOf(values) !== Array.prototype || Reflect.ownKeys(values).length !== values.length + 1
        || Object.values(Object.getOwnPropertyDescriptors(values)).some(field => !Object.hasOwn(field, 'value'))
        || values.length > 256 || values.some(value => typeof value !== 'string' || !value || !value.isWellFormed() || value.length > 8192)
        || new Set(values).size !== values.length || new TextEncoder().encode(JSON.stringify(values)).byteLength > 32768) throw new Error();
    }
    return structuredClone(rows) as Record<string, string[]>;
  } catch { throw new VaultError('INVALID'); }
}
const importedValues = (records: readonly VaultCredential[]) => records.flatMap(record => Object.values(record.nativePrivateValues ?? {}).flat());
const variants = (value: string): string[] => {
  const result = [value];
  try { result.push(encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)); } catch { /* Retain malformed legacy raw values. */ }
  return result;
};
/** Short imported values use token boundaries in metadata, preserving IDs and hashes. */
export const nativeCredentialTokens = (records: readonly VaultCredential[]): string[] => [...new Set(importedValues(records).filter(value => value.length < 8).flatMap(variants))];

/** Native input/result guards must include secrets inside managed encrypted states. */
export function nativeCredentialSecrets(records: readonly VaultCredential[]): string[] {
  const values = records.flatMap(record => {
    const raw = record.oauthState ?? '', secrets = [record.value, ...managedGitlabSecrets(raw), ...managedAtprotoSecrets(raw),
      ...Object.values(record.nativePrivateValues ?? {}).flat().filter(value => value.length >= 8)];
    try { secrets.push(validateJiraState(raw).capability); } catch { /* Other credential/state formats have no Jira capability. */ }
    return secrets;
  }).filter(Boolean).flatMap(variants);
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}
