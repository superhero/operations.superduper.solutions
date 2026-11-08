// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { NativeCommandInputError } from './native-command.ts';
import type { NativeAccountResult } from './native-account.ts';

export const nativeAccountActionScope = 'codex-account-actions';
export const nativeAccountActionApprovalMethod = 'operations/accountAction/requestApproval';
export const nativeAccountActionMethods = ['account/rateLimitResetCredit/consume', 'account/sendAddCreditsNudgeEmail'] as const;
export type NativeAccountActionMethod = typeof nativeAccountActionMethods[number];
export const isNativeAccountActionMethod = (method: unknown): method is NativeAccountActionMethod => nativeAccountActionMethods.includes(method as NativeAccountActionMethod);
export const nativeAccountActionResultTypes = { 'account/rateLimitResetCredit/consume': 'ConsumeAccountRateLimitResetCreditResponse',
  'account/sendAddCreditsNudgeEmail': 'SendAddCreditsNudgeEmailResponse' } as const;
export type NativeAccountActionNotice = { kind: 'account-action-approval'; token: string; method: NativeAccountActionMethod; params: Record<string, unknown>; account: NativeAccountResult };
export function nativeAccountActionInputSchema(method: NativeAccountActionMethod) {
  if (!isNativeAccountActionMethod(method)) throw new NativeCommandInputError('method', 'Unsupported account action.');
  const properties: Record<string, Record<string, unknown>> = method === 'account/rateLimitResetCredit/consume' ? {
    idempotencyKey: { type: 'string', minLength: 1, maxLength: 2048, title: 'Idempotency key', description: 'One logical reset attempt. A UUID is recommended; reuse the same value when retrying that attempt.' },
    creditId: { type: ['string', 'null'], minLength: 1, maxLength: 2048, title: 'Reset credit ID', description: 'Optional opaque reset-credit identifier. Omit to let the backend select the next available credit.' }
  } : { creditType: { type: 'string', enum: ['credits', 'usage_limit'], title: 'Credit type', description: 'The type of credit requested in the email to the workspace owner.' } };
  return { type: 'object', additionalProperties: false as const, properties, required: [method === 'account/rateLimitResetCredit/consume' ? 'idempotencyKey' : 'creditType'] };
}
export function nativeAccountActionParams(method: NativeAccountActionMethod, value: unknown): Record<string, unknown> {
  const params = nativeBoundedThreadParams(nativeAccountActionInputSchema(method), value);
  return method === 'account/rateLimitResetCredit/consume'
    ? { idempotencyKey: params.idempotencyKey, ...(Object.hasOwn(params, 'creditId') ? { creditId: params.creditId } : {}) }
    : { creditType: params.creditType };
}
export function nativeAccountActionResult(method: NativeAccountActionMethod, value: unknown) {
  if (!isNativeAccountActionMethod(method)) throw new Error('Unsupported account action result.');
  const key = method === 'account/rateLimitResetCredit/consume' ? 'outcome' : 'status';
  const result = nativeObject(value, [key]);
  const allowed = key === 'outcome' ? ['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'] : ['sent', 'cooldown_active'];
  if (typeof result[key] !== 'string' || !allowed.includes(result[key])) throw new Error('Invalid native account action result.');
  return { ...result };
}
