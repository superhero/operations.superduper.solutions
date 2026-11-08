// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';

export const nativeInitializeMethod = 'initialize';
/** A workflow starts an Operations-owned connection, never a second client on an initialized child. */
export function nativeInitializeParams(value?: unknown) {
  const params = { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false, explicitGatewayOauth: true } };
  if (value !== undefined) {
    const input = nativeObject(value, ['clientInfo', 'capabilities']);
    const client = nativeObject(input.clientInfo, ['name', 'version']);
    const explicit = !!input.capabilities && typeof input.capabilities === 'object' && Object.hasOwn(input.capabilities, 'explicitGatewayOauth');
    const capabilities = nativeObject(input.capabilities, explicit ? ['experimentalApi', 'explicitGatewayOauth'] : ['experimentalApi']);
    if (client.name !== params.clientInfo.name || client.version !== params.clientInfo.version
      || capabilities.experimentalApi !== false || explicit && capabilities.explicitGatewayOauth !== true)
      throw new Error('The paired runtime requires the Operations client identity and public capabilities.');
  }
  return params;
}
export function nativeInitializeInputSchema() {
  return { type: 'object', additionalProperties: false, properties: {}, required: [] as string[] };
}
export type NativeInitializeResult = { codexHome: string; platformFamily: string; platformOs: string; userAgent: string };
/** These are the complete public fields of the pinned InitializeResponse. */
export function publicNativeInitializeResult(value: unknown): NativeInitializeResult {
  const result = nativeObject(value, ['codexHome', 'platformFamily', 'platformOs', 'userAgent']);
  if (Object.values(result).some(field => typeof field !== 'string' || !field.length || !field.isWellFormed() || /[\u0000-\u001f\u007f]/.test(field))
    || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(result.codexHome as string)) throw new Error('Invalid native initialization result.');
  return { ...result } as NativeInitializeResult;
}
