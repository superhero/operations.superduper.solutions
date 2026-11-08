// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeBoundedThreadParams } from './native-stored-thread.ts';
import { nativeObject } from './native-runtime-contract.ts';
export const nativeGatewayOAuthScope = 'codex-gateway-oauth';
export const nativeGatewayOAuthNotification = 'account/gatewayOAuth/changed';
export const nativeGatewayOAuthMethods = ['account/gatewayOAuth/login', 'account/gatewayOAuth/cancel'] as const;
export type NativeGatewayOAuthMethod = typeof nativeGatewayOAuthMethods[number];
export const isNativeGatewayOAuthMethod = (method: unknown): method is NativeGatewayOAuthMethod => nativeGatewayOAuthMethods.includes(method as NativeGatewayOAuthMethod);
export const nativeGatewayOAuthInputSchema = () => ({ type: 'object', additionalProperties: false as const, properties: {} as Record<string, Record<string, unknown>>, required: [] as string[] });
export const nativeGatewayOAuthParams = (input: unknown) => nativeBoundedThreadParams(nativeGatewayOAuthInputSchema(), input ?? {});
export const nativeGatewayOAuthResultTypes = { 'account/gatewayOAuth/login': 'GatewayOAuthLoginResponse', 'account/gatewayOAuth/cancel': 'GatewayOAuthCancelResponse' } as const;
export type NativeGatewayOAuthProgress = { kind: 'gateway-login'; providerId: string; authUrl: string };
export function nativeGatewayOAuthUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 8192 || !value.isWellFormed() || /[\u0000-\u0020\u007f]/.test(value)) throw new Error('Invalid gateway sign-in URL.');
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Invalid gateway sign-in URL.');
  return url.href;
}
export function nativeGatewayOAuthState(value: unknown) {
  const state = nativeObject(value, ['providerId', 'providerName', 'required', 'status', 'error']);
  if (typeof state.providerId !== 'string' || !state.providerId.length || state.providerId.length > 192
    || typeof state.providerName !== 'string' || state.providerName.length > 512 || typeof state.required !== 'boolean'
    || state.status !== null && !['notReady', 'started', 'succeeded', 'failed'].includes(String(state.status))
    || state.error !== null && typeof state.error !== 'string') throw new Error('Invalid gateway sign-in state.');
  return { providerId: state.providerId, required: state.required, status: state.status };
}
