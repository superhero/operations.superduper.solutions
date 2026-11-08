// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeBoundedThreadParams, nativeStoredThreadMetadataSchema } from './native-stored-thread.ts';
import { NativeCommandInputError } from './native-command.ts';
import { assertNativeJsonByteBudget } from './native-input-budget.ts';
export const nativeThreadLifecycleMethods = ['thread/archive', 'thread/delete', 'thread/fork', 'thread/unarchive',
  'thread/unsubscribe', 'thread/metadata/update', 'thread/name/set', 'thread/section/move'] as const;
export type NativeThreadLifecycleMethod = typeof nativeThreadLifecycleMethods[number];
export const isNativeThreadLifecycleMethod = (method: unknown): method is NativeThreadLifecycleMethod => nativeThreadLifecycleMethods.includes(method as NativeThreadLifecycleMethod);
export const nativeThreadLifecycleResultTypes = {
  'thread/archive': 'ThreadArchiveResponse', 'thread/delete': 'ThreadDeleteResponse', 'thread/fork': 'ThreadForkResponse',
  'thread/unarchive': 'ThreadUnarchiveResponse', 'thread/unsubscribe': 'ThreadUnsubscribeResponse',
  'thread/metadata/update': 'ThreadMetadataUpdateResponse', 'thread/name/set': 'ThreadSetNameResponse', 'thread/section/move': 'ThreadSectionMoveResponse'
} as const;
type Property = Record<string, unknown>;
const invalid = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
export function nativeThreadLifecycleInputSchema(method: NativeThreadLifecycleMethod) {
  if (!isNativeThreadLifecycleMethod(method)) return invalid('method', 'Unsupported thread lifecycle method.');
  const properties: Record<string, Property> = { threadId: { type: 'string', minLength: 1, maxLength: 192, title: 'Owned thread ID' } };
  const nullable = (title: string, maxLength = 192): Property => ({ type: ['string', 'null'], minLength: 1, maxLength, title });
  if (method === 'thread/fork') Object.assign(properties, {
    model: nullable('Model', 128), lastTurnId: nullable('Last included turn ID'),
    ephemeral: { type: 'boolean', default: false, title: 'Ephemeral fork' },
    excludeTurns: { type: 'boolean', default: true, title: 'Exclude returned history', description: 'Clone history but return metadata only; turn/item pages can read the cloned history.' }
  });
  if (method === 'thread/name/set') properties.name = { type: 'string', minLength: 1, maxLength: 200, title: 'Thread name' };
  if (method === 'thread/metadata/update') properties.gitInfo = { type: 'object', title: 'Git metadata', additionalProperties: false,
    description: 'Patch sha, branch or originUrl. Omitted fields stay unchanged; null clears a field.',
    properties: { sha: nullable('Commit', 512), branch: nullable('Branch', 512), originUrl: nullable('Remote URL', 2048) } };
  if (method === 'thread/section/move') Object.assign(properties, { sectionId: nullable('Destination section ID'), beforeThreadId: nullable('Insert before thread ID') });
  return { type: 'object', additionalProperties: false as const, properties,
    required: ['threadId', ...(method === 'thread/name/set' ? ['name'] : method === 'thread/metadata/update' ? ['gitInfo'] : method === 'thread/section/move' ? ['sectionId'] : [])] };
}
export function nativeThreadLifecycleParams(method: NativeThreadLifecycleMethod, value: unknown) {
  const params = nativeBoundedThreadParams(nativeThreadLifecycleInputSchema(method), value);
  if (method === 'thread/fork') {
    params.ephemeral ??= false; params.excludeTurns ??= true;
    if (params.ephemeral && !params.excludeTurns) return invalid('excludeTurns', 'Ephemeral paginated forks require excludeTurns=true.');
  }
  if (method === 'thread/section/move' && params.sectionId === null && params.beforeThreadId != null) return invalid('beforeThreadId', 'Insert-before requires a destination section.');
  if (method === 'thread/metadata/update') {
    const info = params.gitInfo as Record<string, unknown>;
    if (!Object.keys(info).length) return invalid('gitInfo', 'Supply at least one Git metadata field.');
    if (typeof info.originUrl === 'string') {
      let valid = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s?#]+$/.test(info.originUrl);
      try {
        const url = new URL(info.originUrl);
        valid = ['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) && !url.password && !url.search && !url.hash
          && (!['http:', 'https:'].includes(url.protocol) || !url.username);
      } catch { /* SCP-style remotes are handled above. */ }
      if (!valid) return invalid('gitInfo', 'gitInfo.originUrl requires a Git remote without passwords, HTTP userinfo, query strings or fragments.');
    }
  }
  assertNativeJsonByteBudget(params, 16384, NativeCommandInputError, 'params', 'Thread lifecycle parameters must fit 16 KiB.');
  return params;
}
export function nativeThreadLifecycleResultSchema(method: NativeThreadLifecycleMethod, document: Record<string, unknown>) {
  const definitions = document.definitions as { v2?: Record<string, unknown> } | undefined;
  const raw = definitions?.v2?.[nativeThreadLifecycleResultTypes[method]];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Thread lifecycle result schema is unavailable.');
  const result = structuredClone(raw) as { properties?: Record<string, unknown> };
  if (method === 'thread/fork' || method === 'thread/unarchive' || method === 'thread/metadata/update') result.properties = {
    ...result.properties, thread: nativeStoredThreadMetadataSchema(document) };
  if (method === 'thread/fork') Object.assign(result.properties!, {
    runtimeWorkspaceRoots: { type: 'array', items: { $ref: '#/definitions/v2/AbsolutePathBuf' } },
    activePermissionProfile: { anyOf: [{ $ref: '#/definitions/v2/ActivePermissionProfile' }, { type: 'null' }] },
    multiAgentMode: { $ref: '#/definitions/v2/MultiAgentMode' }
  });
  return result;
}
