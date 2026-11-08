// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeAccountActionMethod, type NativeAccountActionMethod } from './native-account-actions.ts';
import { isNativeGatewayOAuthMethod, type NativeGatewayOAuthMethod } from './native-gateway-oauth.ts';
import { isNativeAccountAuthMethod, type NativeAccountAuthMethod } from './native-account-auth.ts';
import { isNativeAccountReadMethod, type NativeAccountReadMethod } from './native-account-read.ts';
import { nativeObject, isNativeStandaloneMethod, type NativeStandaloneMethod } from './native-runtime-contract.ts';
import { isNativeWorkflowMethod, type NativeWorkflowMethod } from './native-agent-contract.ts';
import { nativeMcpOAuthMethod } from './native-mcp-oauth.ts';
import { nativeInitializeMethod } from './native-initialize.ts';
import { nativeFeedbackMethod } from './native-feedback-contract.ts';
import { isNativeFilesystemWatchMethod, type NativeFilesystemWatchMethod } from './native-filesystem-watch.ts';
import { isNativeCommandMethod, type NativeCommandMethod } from './native-command.ts';
import { nativeWindowsSandboxReadinessMethod, isNativeWindowsSandboxReadinessMethod } from './native-windows-sandbox.ts';
import { isNativePluginShareMethod, type NativePluginShareMethod } from './native-plugin-share.ts';
import { isNativePluginInstallMethod, type NativePluginInstallMethod } from './native-plugin-install.ts';
import { isNativeMarketplaceMethod, type NativeMarketplaceMethod } from './native-marketplace.ts';
import { isNativePluginReadMethod, type NativePluginReadMethod } from './native-plugin-read.ts';
import { isNativeConfigurationReadMethod, type NativeConfigurationReadMethod } from './native-configuration-read.ts';

import { isNativeConfigurationControlMethod, type NativeConfigurationControlMethod } from './native-configuration-control.ts';
import { isNativeConfigurationWriteMethod, type NativeConfigurationWriteMethod } from './native-configuration-write.ts';
import { isNativeMigrationMethod, type NativeMigrationMethod } from './native-migration.ts';
import { isNativeStoredThreadReadMethod, type NativeStoredThreadReadMethod } from './native-stored-thread.ts';

import { isNativeThreadContentPairedMethod } from './native-thread-content.ts';
import { isNativeThreadLifecycleMethod, type NativeThreadLifecycleMethod } from './native-thread-lifecycle.ts';

export const nativeAccountReadMethod = 'account/read';
export const isNativePairedRead = (method: unknown): method is typeof nativeAccountReadMethod | typeof nativeInitializeMethod | NativeStandaloneMethod =>
  method === nativeAccountReadMethod || method === nativeInitializeMethod || isNativeStandaloneMethod(method);
export const isNativePairedOperation = (method: unknown): method is typeof nativeAccountReadMethod | typeof nativeInitializeMethod | typeof nativeFeedbackMethod | typeof nativeMcpOAuthMethod | NativeStandaloneMethod | NativeFilesystemWatchMethod | NativeCommandMethod | NativeMarketplaceMethod | NativePluginInstallMethod | NativePluginShareMethod | typeof nativeWindowsSandboxReadinessMethod | NativePluginReadMethod | NativeConfigurationReadMethod | NativeConfigurationControlMethod | NativeConfigurationWriteMethod | NativeMigrationMethod | NativeStoredThreadReadMethod | NativeThreadLifecycleMethod | NativeAccountReadMethod | NativeAccountAuthMethod | NativeGatewayOAuthMethod | NativeAccountActionMethod | 'thread/attachment/add' | 'thread/attachment/remove' | 'thread/goal/clear' =>
  isNativeAccountActionMethod(method) || isNativeGatewayOAuthMethod(method) || isNativeAccountAuthMethod(method) || isNativeAccountReadMethod(method) || isNativePairedRead(method) || method === nativeMcpOAuthMethod || method === nativeFeedbackMethod || isNativeFilesystemWatchMethod(method) || isNativeCommandMethod(method) || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method) || isNativeWindowsSandboxReadinessMethod(method) || isNativePluginReadMethod(method) || isNativeConfigurationReadMethod(method) || isNativeConfigurationControlMethod(method) || isNativeConfigurationWriteMethod(method) || isNativeMigrationMethod(method) || isNativeStoredThreadReadMethod(method) || isNativeThreadLifecycleMethod(method) && method !== 'thread/fork' || isNativeThreadContentPairedMethod(method);
export const isNativeWorkflowOperation = (method: unknown): method is NativeWorkflowMethod | typeof nativeAccountReadMethod | typeof nativeInitializeMethod | typeof nativeFeedbackMethod | NativeStandaloneMethod | NativeFilesystemWatchMethod | NativeCommandMethod | NativeConfigurationReadMethod | NativeConfigurationControlMethod =>
  isNativePairedOperation(method) || isNativeWorkflowMethod(method);
export function nativeAccountInputSchema() {
  return { type: 'object', additionalProperties: false, properties: {
    refreshToken: { type: 'boolean', enum: [false], default: false }
  }, required: [] as string[] };
}
// The pinned Rust GetAccountResponse serializes workspaceRouting even though
// the public schema exporter omits that experimental field. Treat it as account
// metadata only; it never supplies an HTTP destination or execution authority.
export function nativeAccountWorkflowResultSchema(source: unknown) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid native account result schema.');
  const original = source as Record<string, unknown>;
  if (original.type !== 'object' || !original.properties || typeof original.properties !== 'object' || Array.isArray(original.properties)) throw new Error('Invalid native account result schema.');
  // A concrete projection keeps optional public fields connectable. The exact
  // source union remains in wireResult and the runtime validator below.
  return { ...structuredClone(original), properties: { ...structuredClone(original.properties),
    account: { type: ['object', 'null'], additionalProperties: false, properties: {
      type: { type: 'string', enum: ['apiKey', 'chatgpt'] }, email: { type: ['string', 'null'] },
      planType: { type: 'string', enum: [...plans] }
    }, required: ['type'] },
    workspaceRouting: { type: ['object', 'null'], additionalProperties: false, properties: {
      chatgptAccountId: { type: 'string' }, backendOrigin: { type: 'string' },
      accountRoutingOverride: { type: 'string', enum: ['NO_CONSTRAINT', 'us', 'us_cr'] }
    }, required: ['chatgptAccountId', 'backendOrigin', 'accountRoutingOverride'] }
  } };
}
export function nativeAccountParams(value: unknown): { refreshToken: false } {
  const params = nativeObject(value, ['refreshToken']);
  if (params.refreshToken !== false) throw new Error('This paired account read does not authorize credential refresh.');
  return { refreshToken: false };
}

// Public account variants and PlanType in the pinned 0.163.0 wire schema.
const plans = new Set(['free', 'go', 'plus', 'pro', 'prolite', 'promax', 'team', 'self_serve_business_prolite',
  'self_serve_business_usage_based', 'business', 'ent26', 'enterprise_cbp_automation', 'enterprise_cbp_usage_based',
  'enterprise', 'edu', 'edu_plus', 'edu_pro', 'unknown']);
export type NativeAccountRouting = { chatgptAccountId: string; backendOrigin: string; accountRoutingOverride: 'NO_CONSTRAINT' | 'us' | 'us_cr' };
export type NativeAccountResult = { requiresOpenaiAuth: boolean; workspaceRouting?: NativeAccountRouting | null; account?: null | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string } };
/** Account reads never publish internal auth variants or unclassified extra fields. */
export function publicNativeAccountResult(value: unknown): NativeAccountResult {
  const present = !!value && typeof value === 'object' && Object.hasOwn(value, 'account');
  const routingPresent = !!value && typeof value === 'object' && Object.hasOwn(value, 'workspaceRouting');
  const result = nativeObject(value, ['requiresOpenaiAuth', ...(present ? ['account'] : []), ...(routingPresent ? ['workspaceRouting'] : [])]);
  if (typeof result.requiresOpenaiAuth !== 'boolean') throw new Error('Invalid native account response.');
  const metadata: NativeAccountResult = { requiresOpenaiAuth: result.requiresOpenaiAuth };
  if (routingPresent) {
    if (result.workspaceRouting === null) metadata.workspaceRouting = null;
    else {
      const routing = nativeObject(result.workspaceRouting, ['chatgptAccountId', 'backendOrigin', 'accountRoutingOverride']);
      if (['chatgptAccountId', 'backendOrigin'].some(key => typeof routing[key] !== 'string' || !(routing[key] as string).isWellFormed()
        || /[\u0000-\u001f\u007f]/.test(routing[key] as string)) || !['NO_CONSTRAINT', 'us', 'us_cr'].includes(String(routing.accountRoutingOverride))) throw new Error('Invalid native account routing metadata.');
      metadata.workspaceRouting = { ...routing } as NativeAccountRouting;
    }
  }
  if (!present) return metadata;
  if (result.account === null) return { ...metadata, account: null };
  const account = result.account;
  if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('Invalid native account.');
  if ((account as Record<string, unknown>).type === 'apiKey') {
    nativeObject(account, ['type']); return { ...metadata, account: { type: 'apiKey' } };
  }
  const item = nativeObject(account, ['type', 'email', 'planType']);
  if (item.type !== 'chatgpt' || item.email !== null && (typeof item.email !== 'string' || !item.email.isWellFormed())
    || typeof item.planType !== 'string' || !plans.has(item.planType)) throw new Error('Unsupported native account.');
  return { ...metadata, account: { type: 'chatgpt', email: item.email as string | null, planType: item.planType } };
}
