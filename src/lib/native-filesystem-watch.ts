// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeRuntimeLimits } from './native-runtime-contract.ts';

export const nativeFilesystemWatchScope = 'codex-filesystem-watch';
export const nativeFilesystemWatchMethods = ['fs/watch', 'fs/unwatch'] as const;
export type NativeFilesystemWatchMethod = typeof nativeFilesystemWatchMethods[number];
export const isNativeFilesystemWatchMethod = (value: unknown): value is NativeFilesystemWatchMethod => nativeFilesystemWatchMethods.includes(value as NativeFilesystemWatchMethod);
export const nativeFilesystemWatchLimits = { watches: 8, changedPaths: 128, earlyEvents: 8, pending: nativeRuntimeLimits.pending } as const;
export function nativeFilesystemWatchInputSchema(method: NativeFilesystemWatchMethod) {
  return { type: 'object', additionalProperties: false, properties: {
    watchId: { type: 'string', title: 'Watch ID', description: 'An ID owned by this runtime connection.', minLength: 1, maxLength: 192 },
    ...(method === 'fs/watch' ? { path: { type: 'string', title: 'Workspace path', description: 'A non-recursive workspace file or directory watch.', minLength: 1, maxLength: 4096 } } : {})
  }, required: method === 'fs/watch' ? ['watchId', 'path'] : ['watchId'] };
}
/** The raw SDK params remain referenced; the transport timestamp is outside them. */
export function nativeFilesystemWatchNotificationSchema() {
  return { type: 'object', additionalProperties: false, properties: {
    method: { type: 'string', const: 'fs/changed' }, params: { $ref: '#/definitions/v2/FsChangedNotification' },
    emittedAtMs: { type: 'integer', minimum: 0 }
  }, required: ['method', 'params'] };
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v.isWellFormed() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
export function nativeFilesystemWatchParams(method: NativeFilesystemWatchMethod, value: unknown): { watchId: string; path?: string } {
  const item = nativeObject(value, method === 'fs/watch' ? ['watchId', 'path'] : ['watchId']);
  if (!nativeFilesystemWatchMethods.includes(method) || !text(item.watchId, 192) || method === 'fs/watch' && !text(item.path, 4096)) throw new Error('Invalid native watch parameters.');
  return method === 'fs/watch' ? { watchId: item.watchId, path: item.path as string } : { watchId: item.watchId };
}
export function nativeFilesystemChange(value: unknown): { watchId: string; changedPaths: string[] } {
  const item = nativeObject(value, ['watchId', 'changedPaths']);
  if (!text(item.watchId, 192) || !Array.isArray(item.changedPaths) || !item.changedPaths.length
    || item.changedPaths.length > nativeFilesystemWatchLimits.changedPaths || item.changedPaths.some(path => !text(path, 4096))
    || new TextEncoder().encode(JSON.stringify(item)).byteLength > nativeRuntimeLimits.frame) throw new Error('Invalid native filesystem notification.');
  return { watchId: item.watchId, changedPaths: [...item.changedPaths] as string[] };
}
/** The pinned transport timestamps server notifications outside params. */
export function nativeFilesystemChangeFrame(value: unknown): { method: 'fs/changed'; params: ReturnType<typeof nativeFilesystemChange>; emittedAtMs?: number } {
  const timestamped = !!value && typeof value === 'object' && Object.hasOwn(value, 'emittedAtMs');
  const item = nativeObject(value, timestamped ? ['method', 'params', 'emittedAtMs'] : ['method', 'params']);
  if (item.method !== 'fs/changed' || timestamped && (!Number.isSafeInteger(item.emittedAtMs) || (item.emittedAtMs as number) < 0)) throw new Error('Invalid filesystem notification envelope.');
  return { method: 'fs/changed', params: nativeFilesystemChange(item.params), ...(timestamped ? { emittedAtMs: item.emittedAtMs as number } : {}) };
}
export type NativeFilesystemWatchValue = { protocol: 'json-rpc'; result: { path: string }; notification?: ReturnType<typeof nativeFilesystemChangeFrame> };
export type NativeFilesystemWatchCallback = (value: NativeFilesystemWatchValue) => void;
export function nativeFilesystemWatchResult(value: unknown): { path: string } {
  const item = nativeObject(value, ['path']);
  if (!text(item.path, 4096)) throw new Error('Invalid native watch acknowledgement.');
  return { path: item.path };
}
export function isNativeFilesystemWatchValue(value: unknown): value is NativeFilesystemWatchValue {
  try {
    const notified = !!value && typeof value === 'object' && Object.hasOwn(value, 'notification');
    const item = nativeObject(value, notified ? ['protocol', 'result', 'notification'] : ['protocol', 'result']);
    if (item.protocol !== 'json-rpc') return false;
    nativeFilesystemWatchResult(item.result); if (notified) nativeFilesystemChangeFrame(item.notification); return true;
  } catch { return false; }
}
