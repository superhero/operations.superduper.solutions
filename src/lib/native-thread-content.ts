// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { nativeBoundedThreadParams, nativeStoredThreadMetadataSchema } from './native-stored-thread.ts';
import { NativeCommandInputError } from './native-command.ts';
import { nativeJsonTypes } from './native-mcp-tool.ts';
import { assertNativeJsonByteBudget } from './native-input-budget.ts';

export const nativeThreadContentMethods = ['thread/attachment/add', 'thread/attachment/remove', 'thread/goal/set',
  'thread/goal/clear', 'thread/inject_items', 'thread/revert'] as const;
export type NativeThreadContentMethod = typeof nativeThreadContentMethods[number];
export const isNativeThreadContentMethod = (method: unknown): method is NativeThreadContentMethod => nativeThreadContentMethods.includes(method as NativeThreadContentMethod);
export const isNativeThreadContentPairedMethod = (method: unknown): method is 'thread/attachment/add' | 'thread/attachment/remove' | 'thread/goal/clear' => method === 'thread/attachment/add' || method === 'thread/attachment/remove' || method === 'thread/goal/clear';
export const isNativeThreadAttachmentMutation = (method: unknown) => method === 'thread/attachment/add' || method === 'thread/attachment/remove';
export const nativeThreadContentResultTypes = {
  'thread/attachment/add': 'ThreadAttachmentAddResponse', 'thread/attachment/remove': 'ThreadAttachmentRemoveResponse',
  'thread/goal/set': 'ThreadGoalSetResponse', 'thread/goal/clear': 'ThreadGoalClearResponse',
  'thread/inject_items': 'ThreadInjectItemsResponse', 'thread/revert': 'ThreadRevertResponse'
} as const;
type Schema = Record<string, unknown>;
const bad = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
export function nativeThreadContentInputSchema(method: NativeThreadContentMethod) {
  if (!isNativeThreadContentMethod(method)) return bad('method', 'Unsupported thread content method.');
  const properties: Record<string, Schema> = { threadId: { type: 'string', minLength: 1, maxLength: 192, title: 'Owned thread ID' } };
  const required = ['threadId'];
  if (isNativeThreadAttachmentMutation(method)) {
    properties.attachmentType = { type: 'string', minLength: 1, maxLength: 128, title: 'Attachment type' };
    properties.identityKey = { type: 'string', minLength: 1, maxLength: 1024, title: 'Identity key' };
    required.push('attachmentType', 'identityKey');
    if (method === 'thread/attachment/add') { properties.payload = { type: [...nativeJsonTypes], title: 'Attachment payload', description: 'Bounded JSON stored under this stable thread-local identity. An existing attachment keeps its original payload.' }; required.push('payload'); }
  }
  if (method === 'thread/goal/set' || method === 'thread/goal/clear') properties.origin = { type: ['string', 'null'], enum: ['user', 'automatic', null], title: 'Goal provenance', description: 'User records an explicit user mutation; automatic or omitted provenance does not supply user authorization.' };
  if (method === 'thread/goal/set') Object.assign(properties, {
    objective: { type: ['string', 'null'], minLength: 1, maxLength: 8192, title: 'Goal objective' },
    status: { type: ['string', 'null'], enum: ['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete', null], title: 'Goal status' },
    tokenBudget: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER, title: 'Goal token budget', description: 'Omit to preserve the current budget; null clears it. Active goals can start an agent turn immediately.' }
  });
  if (method === 'thread/inject_items') { properties.items = { type: 'array', minItems: 1, maxItems: 16, items: { type: [...nativeJsonTypes] }, title: 'History items', description: 'Raw native Responses API items. This edits model-visible history without running a tool or starting a user turn.' }; required.push('items'); }
  if (method === 'thread/revert') { properties.beforeTurnId = { type: 'string', minLength: 1, maxLength: 192, title: 'First removed turn ID', description: 'Remove this turn and all later history. Files are unchanged.' }; required.push('beforeTurnId'); }
  return { type: 'object', additionalProperties: false as const, properties, required };
}
export function nativeThreadContentParams(method: NativeThreadContentMethod, value: unknown): Record<string, unknown> {
  const schema = nativeThreadContentInputSchema(method);
  let input: Record<string, unknown>;
  try { input = nativeObject(value, Object.keys(value as object)); } catch { return bad('params', 'Use only the declared plain thread fields.'); }
  for (const key of Object.keys(input)) if (!Object.hasOwn(schema.properties, key)) return bad(key, 'Unsupported thread content field.');
  const opaque = method === 'thread/attachment/add' ? 'payload' : method === 'thread/inject_items' ? 'items' : undefined;
  const special = (key: string) => key === opaque || method === 'thread/goal/set' && key === 'objective';
  const fields = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !special(key)));
  const params = nativeBoundedThreadParams({ ...schema, properties: fields, required: schema.required.filter(key => !special(key)) },
    Object.fromEntries(Object.entries(input).filter(([key]) => !special(key))));
  if (method === 'thread/goal/set' && Object.hasOwn(input, 'objective')) {
    const objective = input.objective;
    if (objective !== null && (typeof objective !== 'string' || !objective.isWellFormed() || !objective.trim() || objective.length > 8192
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(objective))) return bad('objective', 'Use a nonempty goal objective up to 8192 characters.');
    params.objective = objective;
  }
  let nodes = 0;
  function json(value: unknown, field: string, depth = 0): void {
    if (++nodes > 4096 || depth > 24) return bad(field, 'Thread JSON exceeds its complexity limit.');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value === 'string' && value.isWellFormed()) return;
    if (Array.isArray(value)) {
      if (value.length > 4096 || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1
        || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !Object.hasOwn(item, 'value'))
        || Array.from({ length: value.length }, (_, i) => i).some(i => !Object.hasOwn(value, i))) return bad(field, 'Use a dense plain JSON array.');
      for (const item of value) json(item, field, depth + 1); return;
    }
    if (value && typeof value === 'object') {
      let object: Record<string, unknown>;
      try { object = nativeObject(value, Object.keys(value)); } catch { return bad(field, 'Use plain own JSON fields.'); }
      for (const [key, item] of Object.entries(object)) { if (!key.isWellFormed()) return bad(field, 'Use valid Unicode JSON keys.'); json(item, field, depth + 1); } return;
    }
    return bad(field, 'Use finite plain JSON values.');
  }
  if (opaque) {
    if (!Object.hasOwn(input, opaque)) return bad(opaque, 'This field is required.');
    if (opaque === 'items' && (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 16)) return bad(opaque, 'Supply one to sixteen native history items.');
    json(input[opaque], opaque); params[opaque] = structuredClone(input[opaque]);
  }
  assertNativeJsonByteBudget(params, 32768, NativeCommandInputError, opaque ?? 'params', 'Thread content parameters must fit 32 KiB.');
  return params;
}
export function nativeThreadContentResultSchema(method: NativeThreadContentMethod, document: Record<string, unknown>) {
  const definitions = document.definitions as { v2?: Record<string, unknown> } | undefined;
  const raw = definitions?.v2?.[nativeThreadContentResultTypes[method]];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Thread content result schema is unavailable.');
  const result = structuredClone(raw) as { properties?: Record<string, unknown> };
  if (method === 'thread/revert') result.properties = { ...result.properties, thread: nativeStoredThreadMetadataSchema(document) };
  return result;
}
