// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, isNativeFilesystemReadMethod, type nativeFilesystemReadMethods } from './native-runtime-contract.ts';
type Method = typeof nativeFilesystemReadMethods[number];
export const nativeFilesystemReadLimits = { fileBytes: 32 * 1024, entries: 256, roots: 4, matches: 50 } as const;
export function nativeFilesystemReadInputSchema(method: Method): { type: string; additionalProperties: false; properties: Record<string, Record<string, unknown>>; required: string[] } {
  const path = { type: 'string', minLength: 1, maxLength: 4096, title: 'Workspace path', description: 'Absolute or relative path inside the paired workspace; the credential home is excluded.' };
  return { type: 'object', additionalProperties: false, properties: method === 'fuzzyFileSearch' ? {
    query: { type: 'string', maxLength: 256, title: 'Search query' },
    roots: { type: 'array', maxItems: nativeFilesystemReadLimits.roots, default: ['.'], title: 'Search roots', items: { type: 'string', minLength: 1, maxLength: 4096 } },
    cancellationToken: { type: ['string', 'null'], maxLength: 128, title: 'Cancellation token' }
  } : { path }, required: method === 'fuzzyFileSearch' ? ['query', 'roots'] : ['path'] };
}
export function nativeFilesystemReadParams(method: Method, value: unknown): Record<string, unknown> {
  if (!isNativeFilesystemReadMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid filesystem read.');
  const item = nativeObject(value, Object.keys(value)), allowed = nativeFilesystemReadInputSchema(method).properties;
  if (Object.keys(item).some(key => !Object.hasOwn(allowed, key))) throw new Error('Unsupported filesystem parameter.');
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.isWellFormed() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  if (method === 'fuzzyFileSearch') {
    if (!text(item.query, 256) || !Array.isArray(item.roots) || item.roots.length > nativeFilesystemReadLimits.roots
      || item.roots.some(root => !text(root, 4096) || !root) || item.cancellationToken != null && !text(item.cancellationToken, 128)) throw new Error('Invalid workspace search.');
  } else if (!text(item.path, 4096) || !item.path) throw new Error('A workspace path is required.');
  return structuredClone(item);
}
/** Decode the SDK's canonical bytes before checking known credential echoes. */
export function nativeReadFileBytes(value: unknown): Uint8Array {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'dataBase64')) throw new Error('Invalid file response.');
  const data = (value as Record<string, unknown>).dataBase64;
  if (typeof data !== 'string' || data.length > Math.ceil(nativeFilesystemReadLimits.fileBytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Invalid or oversized file bytes.');
  const decoded = atob(data);
  if (btoa(decoded) !== data || decoded.length > nativeFilesystemReadLimits.fileBytes) throw new Error('Invalid or oversized file bytes.');
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}
