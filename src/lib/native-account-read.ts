// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { nativeUuid } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeAccountReadMethods = ['account/gatewayOAuth/read', 'account/rateLimits/read', 'account/usage/read', 'account/workspaceMessages/read'] as const;
export type NativeAccountReadMethod = typeof nativeAccountReadMethods[number];
export const isNativeAccountReadMethod = (method: unknown): method is NativeAccountReadMethod => nativeAccountReadMethods.includes(method as NativeAccountReadMethod);
export const nativeAccountReadNeedsChatgpt = (method: unknown) => isNativeAccountReadMethod(method) && method !== 'account/gatewayOAuth/read';
export const nativeAccountReadResultTypes = {
  'account/gatewayOAuth/read': 'GatewayOAuthReadResponse', 'account/rateLimits/read': 'GetAccountRateLimitsResponse',
  'account/usage/read': 'GetAccountTokenUsageResponse', 'account/workspaceMessages/read': 'GetWorkspaceMessagesResponse'
} as const;
export function nativeAccountReadInputSchema(method: NativeAccountReadMethod) {
  if (!isNativeAccountReadMethod(method)) throw new NativeCommandInputError('method', 'Unsupported account read.');
  const properties: Record<string, Record<string, unknown>> = method === 'account/rateLimits/read' ? {
    supportsLunaReserve: { type: 'boolean', enum: [false], default: false, title: 'Automatic Reserve fallback', description: 'Operations does not declare automatic Reserve fallback capability.' },
    excludeResetCreditDetails: { type: 'boolean', default: false, title: 'Exclude reset credit details', description: 'Keep the availability count but skip the separate credit-detail read.' }
  } : method === 'account/usage/read' ? { threadId: { type: ['string', 'null'], minLength: 1, maxLength: 36,
    title: 'Usage thread ID', description: 'Optional native thread UUID; the backend authorizes it against the active account. Omit for account-wide usage.' } } : {};
  return { type: 'object', additionalProperties: false as const, properties, required: [] as string[] };
}
export function nativeAccountReadParams(method: NativeAccountReadMethod, input: unknown): Record<string, unknown> {
  const params = nativeBoundedThreadParams(nativeAccountReadInputSchema(method), input ?? {});
  if (method === 'account/rateLimits/read') { params.supportsLunaReserve ??= false; params.excludeResetCreditDetails ??= false; }
  if (params.threadId != null && !nativeUuid(params.threadId)) throw new NativeCommandInputError('threadId', 'Use a native thread UUID.');
  return params;
}
export function nativeAccountReadWireParams(method: NativeAccountReadMethod, input: Record<string, unknown>) {
  return method === 'account/gatewayOAuth/read' || method === 'account/workspaceMessages/read' ? null : input;
}
