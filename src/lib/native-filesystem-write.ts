// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, isNativeFilesystemWriteMethod, type NativeFilesystemWriteMethod } from './native-runtime-contract.ts';
import { nativeFilesystemReadLimits, nativeReadFileBytes } from './native-filesystem-read.ts';

export const nativeFilesystemWriteLimits = { fileBytes: nativeFilesystemReadLimits.fileBytes, treeEntries: 256, treeBytes: 4 * 1024 * 1024, depth: 16 } as const;
export function nativeFilesystemWriteInputSchema(method: NativeFilesystemWriteMethod): { type: string; additionalProperties: false; properties: Record<string, Record<string, unknown>>; required: string[] } {
  const path = { type: 'string', minLength: 1, maxLength: 4096, title: 'Workspace path', description: 'Path inside the paired workspace, excluding private runtime and configuration paths.' };
  const recursive = { type: ['boolean', 'null'], title: 'Recursive', description: 'Create/remove defaults to true when omitted or null; directory copying requires true.' };
  return { type: 'object', additionalProperties: false, properties: method === 'fs/copy' ? {
    sourcePath: { ...path, title: 'Source path' }, destinationPath: { ...path, title: 'Destination path' }, recursive: { ...recursive, type: 'boolean', default: false }
  } : { path, ...(method === 'fs/writeFile' ? {
    dataBase64: { type: 'string', maxLength: Math.ceil(nativeFilesystemWriteLimits.fileBytes / 3) * 4, title: 'File contents (base64)', description: 'Canonical base64, up to 32 KiB decoded. Existing contents are replaced.' }
  } : { recursive, ...(method === 'fs/remove' ? { force: { type: ['boolean', 'null'], title: 'Ignore missing paths', description: 'Defaults to true when omitted or null.' } } : {}) }) },
  required: method === 'fs/copy' ? ['sourcePath', 'destinationPath'] : method === 'fs/writeFile' ? ['path', 'dataBase64'] : ['path'] };
}
export function nativeFilesystemWriteParams(method: NativeFilesystemWriteMethod, value: unknown): Record<string, unknown> {
  if (!isNativeFilesystemWriteMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid filesystem mutation.');
  const item = nativeObject(value, Object.keys(value)), schema = nativeFilesystemWriteInputSchema(method);
  if (Object.keys(item).some(key => !Object.hasOwn(schema.properties, key)) || schema.required.some(key => !Object.hasOwn(item, key))) throw new Error('Unsupported or missing filesystem parameter.');
  for (const key of method === 'fs/copy' ? ['sourcePath', 'destinationPath'] : ['path']) {
    const path = item[key];
    if (typeof path !== 'string' || !path || !path.isWellFormed() || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) throw new Error('A valid workspace path is required.');
  }
  for (const key of ['recursive', 'force']) if (Object.hasOwn(item, key) && typeof item[key] !== 'boolean' && (item[key] !== null || method === 'fs/copy')) throw new Error('Invalid filesystem option.');
  if (method === 'fs/writeFile') nativeReadFileBytes(item);
  return structuredClone(item);
}
