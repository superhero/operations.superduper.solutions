// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeUuid } from './native-runtime-contract.ts';
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeTurnWorkMethods = ['review/start', 'thread/compact/start'] as const;
export type NativeTurnWorkMethod = typeof nativeTurnWorkMethods[number];
export const isNativeTurnWorkMethod = (method: unknown): method is NativeTurnWorkMethod => nativeTurnWorkMethods.includes(method as NativeTurnWorkMethod);
export const nativeTurnWorkResultTypes = { 'review/start': 'ReviewStartResponse', 'thread/compact/start': 'ThreadCompactStartResponse' } as const;
const id = { type: 'string', minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$' };
const text = { type: 'string', minLength: 1, maxLength: 24576 };
export function nativeTurnWorkInputSchema(method: NativeTurnWorkMethod) {
  const properties: Record<string, Record<string, unknown>> = { threadId: { ...id, title: 'Thread ID' } };
  if (method === 'review/start') Object.assign(properties, {
    target: { type: 'object', additionalProperties: false, title: 'Review target', description: 'Use uncommittedChanges, baseBranch with branch, commit with sha and optional title, or custom with instructions.',
      properties: { type: { type: 'string', enum: ['uncommittedChanges', 'baseBranch', 'commit', 'custom'] }, branch: { ...text, maxLength: 256 }, sha: { ...text, maxLength: 128 }, title: { type: ['string', 'null'], maxLength: 2048 }, instructions: { ...text, 'x-native-multiline': true } }, required: ['type'] },
    delivery: { type: ['string', 'null'], enum: ['inline', null], title: 'Delivery', description: 'Inline review on this owned thread. Omission and null use the native inline default. SDK 0.163.0 rejects detached reviews on paginated threads; legacy history selection requires its experimental API.' }
  });
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'review/start' ? ['threadId', 'target'] : ['threadId'] };
}
export function nativeTurnWorkParams(method: NativeTurnWorkMethod, input: unknown) {
  if (!isNativeTurnWorkMethod(method)) throw new NativeCommandInputError('method', 'Unsupported native turn work.');
  if (method === 'review/start' && input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'delivery')?.value === 'detached')
    throw new NativeCommandInputError('delivery', 'Detached review is unavailable for paginated threads in SDK 0.163.0. Use inline delivery; the paired runtime keeps the experimental API disabled.');
  const params = nativeBoundedThreadParams(nativeTurnWorkInputSchema(method), input);
  if (typeof params.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(params.threadId)) throw new NativeCommandInputError('threadId', 'Use the owned native thread identifier.');
  if (nativeUuid(params.threadId)) params.threadId = (params.threadId as string).toLowerCase();
  if (method === 'review/start') {
    const target = params.target as Record<string, unknown>;
    const fields = target.type === 'uncommittedChanges' ? ['type'] : target.type === 'baseBranch' ? ['type', 'branch'] : target.type === 'commit' ? ['type', 'sha', ...(Object.hasOwn(target, 'title') ? ['title'] : [])] : ['type', 'instructions'];
    const offending = Object.keys(target).find(key => !fields.includes(key)) ?? fields.find(key => !Object.hasOwn(target, key));
    if (offending) throw new NativeCommandInputError('target.' + offending, 'Use the fields belonging to the selected review target.');
    for (const key of ['branch', 'sha']) if (Object.hasOwn(target, key) && /^(?:-|\s)|[\s\u0000-\u001f\u007f]/.test(target[key] as string))
      throw new NativeCommandInputError('target.' + key, 'Use a revision or branch without options, whitespace or control characters.');
    if (new TextEncoder().encode(JSON.stringify(params)).byteLength > 32768) throw new NativeCommandInputError('target', 'The review request must fit within 32 KiB.');
  }
  return params;
}
/** The native acknowledgement is provisional. Workflows return only after its matching terminal turn. */
export function nativeTurnWorkAcknowledgement(method: NativeTurnWorkMethod, value: unknown, threadId: string) {
  if (method === 'thread/compact/start') return nativeObject(value, []);
  const result = nativeObject(value, ['reviewThreadId', 'turn']);
  const turn = result.turn as Record<string, unknown> | undefined;
  if (result.reviewThreadId !== threadId || !turn || typeof turn.id !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(turn.id)
    || !Array.isArray(turn.items) || !['inProgress', 'completed'].includes(String(turn.status))) throw new Error('Review acknowledgement did not match the owned inline thread.');
  return result;
}
