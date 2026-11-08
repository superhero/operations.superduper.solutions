// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeRuntimeLimits, isNativeStandaloneMethod, isNativeFilesystemReadMethod, isNativeFilesystemWriteMethod, isNativeSectionMethod, type NativeStandaloneMethod } from './native-runtime-contract.ts';
import { nativeFilesystemWriteInputSchema, nativeFilesystemWriteParams } from './native-filesystem-write.ts';
import type { InputSchema } from './catalog.ts';
import { nativeFilesystemReadInputSchema, nativeFilesystemReadParams } from './native-filesystem-read.ts';
import { nativeJsonTypes } from './native-mcp-tool.ts';
import { nativeSectionInputSchema, nativeSectionParams } from './native-section-contract.ts';
import { isNativeMcpReadMethod, nativeMcpReadInputSchema, nativeMcpReadParams } from './native-mcp-read.ts';

type Property = Record<string, unknown>;
/** Finite standalone requests; mutation dispatch cannot be cached or replayed. Directory inputs are resolved by the companion. */
export function nativeQueryInputSchema(method: NativeStandaloneMethod): { type: string; additionalProperties: false; properties: Record<string, Property>; required: string[] } {
  if (!isNativeStandaloneMethod(method)) throw new Error('Unsupported native metadata method.');
  if (isNativeFilesystemReadMethod(method)) return nativeFilesystemReadInputSchema(method);
  if (isNativeFilesystemWriteMethod(method)) return nativeFilesystemWriteInputSchema(method);
  if (isNativeSectionMethod(method)) return nativeSectionInputSchema(method);
  if (isNativeMcpReadMethod(method)) return nativeMcpReadInputSchema(method);
  const cursor = { type: ['string', 'null'], maxLength: 2048, title: 'Cursor', description: 'Opaque cursor returned by the previous page.' };
  const limit = { type: ['integer', 'null'], minimum: 0, maximum: 64, default: 8, title: 'Page size', description: 'At most 64 entries per bounded metadata request; defaults to 8.' };
  const directory = { type: ['string', 'null'], maxLength: 4096, title: 'Working directory', description: 'A directory inside the companion workspace. Relative paths resolve from its root.' };
  const properties: Record<string, Property> = method === 'model/list' ? { cursor, limit,
    includeHidden: { type: ['boolean', 'null'], title: 'Include hidden models' } }
    : method === 'permissionProfile/list' ? { cursor, limit, cwd: directory }
    : method === 'hooks/list' ? { cwds: { type: 'array', maxItems: 8, default: [], title: 'Working directories',
      description: directory.description, items: { type: 'string', maxLength: 4096 } } }
    : method === 'app/list' ? { cursor, limit, forceRefetch: { type: 'boolean', default: false, title: 'Refetch app metadata' } }
    : method === 'app/installed' ? { forceRefresh: { type: 'boolean', default: false, title: 'Refresh installed snapshot', description: 'May start the companion\'s configured connector runtime to refresh its tool inventory.' } }
    : method === 'app/read' ? { appIds: { type: 'array', default: [], maxItems: 100, title: 'App IDs', items: { type: 'string', maxLength: 512 } },
      includeTools: { type: 'boolean', default: false, title: 'Include public tool summaries' } } : {};
  return { type: 'object', additionalProperties: false, properties, required: method === 'app/read' ? ['appIds'] : [] };
}

export function nativeQueryFieldSchema(value: Property, depth = 0): InputSchema {
  if (Array.isArray(value.type) && value.type.length === nativeJsonTypes.length && nativeJsonTypes.every(type => (value.type as unknown[]).includes(type)))
    return { ...value, type: 'json', nullable: true } as InputSchema;
  const types = Array.isArray(value.type) ? value.type.filter(t => t !== 'null') : [value.type];
  if (depth > 8 || types.length !== 1 || !['string', 'integer', 'boolean', 'array', 'object'].includes(String(types[0]))) throw new Error('Unsupported native metadata input.');
  return { ...value, type: types[0] as InputSchema['type'], ...(Array.isArray(value.type) && value.type.includes('null') ? { nullable: true } : {}),
    ...(value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties)
      ? { properties: Object.fromEntries(Object.entries(value.properties).map(([key, schema]) => [key, nativeQueryFieldSchema(schema as Property, depth + 1)])) } : {}),
    ...(value.items && typeof value.items === 'object' && !Array.isArray(value.items) ? { items: nativeQueryFieldSchema(value.items as Property, depth + 1) } : {}) } as InputSchema;
}

export function nativeQueryParams(method: NativeStandaloneMethod, value: unknown): Record<string, unknown> {
  if (isNativeFilesystemReadMethod(method)) return nativeFilesystemReadParams(method, value);
  if (isNativeFilesystemWriteMethod(method)) return nativeFilesystemWriteParams(method, value);
  if (isNativeSectionMethod(method)) return nativeSectionParams(method, value);
  if (isNativeMcpReadMethod(method)) return nativeMcpReadParams(method, value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid metadata parameters.');
  const item = nativeObject(value, Object.keys(value)), allowed = nativeQueryInputSchema(method).properties;
  if (Object.keys(item).some(key => !Object.hasOwn(allowed, key))) throw new Error('Unsupported metadata parameter.');
  for (const key of ['cursor', 'cwd']) if (Object.hasOwn(item, key) && item[key] !== null
    && (typeof item[key] !== 'string' || !(item[key] as string).isWellFormed() || /[\u0000-\u001f\u007f]/.test(item[key] as string)
      || (item[key] as string).length > (key === 'cursor' ? 2048 : 4096))) throw new Error('Invalid metadata text input.');
  if (Object.hasOwn(item, 'includeHidden') && item.includeHidden !== null && typeof item.includeHidden !== 'boolean') throw new Error('Invalid model visibility option.');
  for (const key of ['forceRefresh', 'forceRefetch', 'includeTools']) if (Object.hasOwn(item, key) && typeof item[key] !== 'boolean') throw new Error('Invalid app metadata option.');
  if (method === 'app/read' && (!Array.isArray(item.appIds) || item.appIds.length > 100 || item.appIds.some(id => typeof id !== 'string'
    || !id.isWellFormed() || id.length > 512 || /[\u0000-\u001f\u007f]/.test(id)))) throw new Error('App reads require at most 100 text app IDs.');
  if (Object.hasOwn(item, 'limit') && item.limit !== null && (!Number.isSafeInteger(item.limit) || (item.limit as number) < 0 || (item.limit as number) > 64)) throw new Error('Invalid metadata page size.');
  if (Object.hasOwn(item, 'cwds') && (!Array.isArray(item.cwds) || item.cwds.length > 8 || item.cwds.some(path => typeof path !== 'string'
    || !path.isWellFormed() || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)))) throw new Error('Invalid metadata directories.');
  const params = structuredClone(item);
  if (method === 'model/list' || method === 'permissionProfile/list' || method === 'app/list') params.limit ??= 8;
  if (method === 'hooks/list') params.cwds ??= [];
  if (method === 'app/installed') params.forceRefresh ??= false;
  if (method === 'app/list') params.forceRefetch ??= false;
  if (method === 'app/read') params.includeTools ??= false;
  if (new TextEncoder().encode(JSON.stringify(params)).byteLength > nativeRuntimeLimits.frame / 2) throw new Error('Metadata parameters exceed the native frame budget.');
  return params;
}
