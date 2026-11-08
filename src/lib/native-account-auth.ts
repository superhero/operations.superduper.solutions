// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { nativeUuid } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeAccountAuthMethods = ['account/login/start', 'account/login/cancel', 'account/logout'] as const;
export type NativeAccountAuthMethod = typeof nativeAccountAuthMethods[number];
export const isNativeAccountAuthMethod = (method: unknown): method is NativeAccountAuthMethod => nativeAccountAuthMethods.includes(method as NativeAccountAuthMethod);
export function nativeAccountAuthInputSchema(method: NativeAccountAuthMethod) {
  const properties: Record<string, Record<string, unknown>> = method === 'account/login/start' ? {
    type: { type: 'string', enum: ['apiKey', 'chatgpt', 'chatgptDeviceCode'], default: 'chatgptDeviceCode', title: 'Sign-in method' },
    credentialId: { type: 'string', minLength: 36, maxLength: 36, title: 'Saved API key ID', description: 'Select a saved vault value for API-key sign-in. Only its reference belongs in this workflow.' },
    appBrand: { type: ['string', 'null'], enum: ['codex', 'chatgpt', null], title: 'Browser sign-in brand' },
    codexStreamlinedLogin: { type: 'boolean', title: 'Streamlined browser sign-in' },
    useHostedLoginSuccessPage: { type: 'boolean', title: 'Hosted sign-in success page' }
  } : method === 'account/login/cancel' ? {
    loginId: { type: 'string', minLength: 36, maxLength: 36, title: 'Sign-in ID', description: 'Optional ID of this pairing’s pending sign-in. Omit to cancel its current owned attempt.' }
  } : {};
  return { type: 'object', additionalProperties: false as const, properties, required: [] as string[] };
}
export function nativeAccountAuthParams(method: NativeAccountAuthMethod, input: unknown): Record<string, unknown> {
  if (!isNativeAccountAuthMethod(method)) throw new NativeCommandInputError('method', 'Unsupported account authentication method.');
  const params = nativeBoundedThreadParams(nativeAccountAuthInputSchema(method), input ?? {});
  const uuid = (key: string) => { if (params[key] !== undefined && !nativeUuid(params[key])) throw new NativeCommandInputError(key, 'Use an owned native or saved vault UUID.'); };
  if (method === 'account/login/start') {
    params.type ??= 'chatgptDeviceCode';
    if (params.type === 'apiKey') {
      if (!nativeUuid(params.credentialId)) throw new NativeCommandInputError('credentialId', 'Choose the saved API key used for sign-in.');
      for (const key of ['appBrand', 'codexStreamlinedLogin', 'useHostedLoginSuccessPage']) if (Object.hasOwn(params, key))
        throw new NativeCommandInputError(key, 'Browser options require browser sign-in.');
    } else {
      if (Object.hasOwn(params, 'credentialId')) throw new NativeCommandInputError('credentialId', 'Only API-key sign-in uses a saved key.');
      if (params.type !== 'chatgpt') for (const key of ['appBrand', 'codexStreamlinedLogin', 'useHostedLoginSuccessPage']) if (Object.hasOwn(params, key))
        throw new NativeCommandInputError(key, 'Browser options require browser sign-in.');
    }
  } else if (method === 'account/login/cancel') uuid('loginId');
  return params;
}
