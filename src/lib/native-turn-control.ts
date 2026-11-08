// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeUuid } from './native-runtime-contract.ts';
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeTurnControlMethods = ['turn/interrupt', 'turn/steer'] as const;
export type NativeTurnControlMethod = typeof nativeTurnControlMethods[number];
export const isNativeTurnControlMethod = (method: unknown): method is NativeTurnControlMethod => nativeTurnControlMethods.includes(method as NativeTurnControlMethod);
export const nativeTurnControlResultTypes = { 'turn/interrupt': 'TurnInterruptResponse', 'turn/steer': 'TurnSteerResponse' } as const;
const ownedId = { type: 'string', minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$' };
export function nativeTurnControlInputSchema(method: NativeTurnControlMethod) {
  const range = { type: 'object', additionalProperties: false, properties: { start: { type: 'integer', minimum: 0, maximum: 65536 }, end: { type: 'integer', minimum: 0, maximum: 65536 } }, required: ['start', 'end'] };
  const text = { type: 'object', additionalProperties: false, properties: { type: { type: 'string', enum: ['text'] }, text: { type: 'string', minLength: 1, maxLength: 24576, 'x-native-multiline': true },
    text_elements: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false, properties: { byteRange: range, placeholder: { type: ['string', 'null'], maxLength: 2048 } }, required: ['byteRange'] } } }, required: ['type', 'text'] };
  const properties: Record<string, Record<string, unknown>> = method === 'turn/interrupt' ? {
    threadId: { ...ownedId, title: 'Thread ID' }, turnId: { type: 'string', maxLength: 192, title: 'Turn ID', description: 'Owned active turn. Empty cancels startup on the owned pending thread.' }
  } : {
    threadId: { ...ownedId, title: 'Thread ID' }, expectedTurnId: { ...ownedId, title: 'Expected turn ID', description: 'Must match the active turn owned by this runtime connection.' },
    input: { type: 'array', minItems: 1, maxItems: 16, items: text, title: 'Input', description: 'Reviewed text input, like turn/start. Optional text_elements retain UTF-8 byte ranges and placeholders. Media, skill and mention inputs are outside the current text-only agent profile.' },
    clientUserMessageId: { type: ['string', 'null'], maxLength: 192, title: 'Client message ID', description: 'Optional native message correlation value; omission and null are retained.' }
  };
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'turn/interrupt' ? ['threadId', 'turnId'] : ['threadId', 'expectedTurnId', 'input'] };
}
export function nativeTurnControlParams(method: NativeTurnControlMethod, input: unknown) {
  if (!isNativeTurnControlMethod(method)) throw new NativeCommandInputError('method', 'Unsupported turn control.');
  const params = nativeBoundedThreadParams(nativeTurnControlInputSchema(method), input);
  for (const key of ['threadId', method === 'turn/interrupt' ? 'turnId' : 'expectedTurnId']) {
    const value = params[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,192}$/.test(value) && !(key === 'turnId' && value === '')) throw new NativeCommandInputError(key, 'Use the owned native identifier.');
    if (nativeUuid(value)) params[key] = value.toLowerCase();
  }
  if (method === 'turn/steer') {
    if (!(params.input as unknown[]).length || new TextEncoder().encode(JSON.stringify(params)).byteLength > 49152) throw new NativeCommandInputError('input', 'Use one to sixteen text items within 48 KiB.');
    for (const item of params.input as { text: string; text_elements?: { byteRange: { start: number; end: number } }[] }[]) {
      const bytes = new TextEncoder().encode(item.text);
      for (const element of item.text_elements ?? []) {
        const { start, end } = element.byteRange;
        try {
          if (start > end || end > bytes.length) throw new Error();
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, start));
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, end));
        } catch { throw new NativeCommandInputError('input', 'Text element ranges must use complete UTF-8 characters within their text.'); }
      }
    }
  }
  return params;
}
export function nativeTurnControlResult(method: NativeTurnControlMethod, value: unknown, params: Record<string, unknown>) {
  const result = nativeObject(value, method === 'turn/interrupt' ? [] : ['turnId']);
  if (method === 'turn/steer' && result.turnId !== params.expectedTurnId) throw new Error('Steering acknowledged a different turn.');
  return { ...result };
}
