// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeWindowsSandboxReadinessMethod, nativeWindowsSandboxReadinessResultTypes, isNativeWindowsSandboxReadinessMethod, nativeWindowsSandboxInputSchema, nativeWindowsSandboxParams } from './native-windows-sandbox.ts';
import { nativePluginShareMethods, nativePluginShareResultTypes, isNativePluginShareMethod, nativePluginShareInputSchema, nativePluginShareParams } from './native-plugin-share.ts';
import { nativePluginInstallMethods, nativePluginInstallResultTypes, isNativePluginInstallMethod, nativePluginInstallInputSchema, nativePluginInstallParams } from './native-plugin-install.ts';
import { nativeMarketplaceMethods, nativeMarketplaceResultTypes, isNativeMarketplaceMethod, nativeMarketplaceInputSchema, nativeMarketplaceParams } from './native-marketplace.ts';
import { nativePluginReadMethods, nativePluginReadResultTypes, isNativePluginReadMethod, nativePluginReadInputSchema, nativePluginReadParams } from './native-plugin-read.ts';
import { nativeTurnControlMethods, nativeTurnControlInputSchema, nativeTurnControlParams, nativeTurnControlResultTypes, isNativeTurnControlMethod } from './native-turn-control.ts';
import { nativeTurnWorkMethods, nativeTurnWorkInputSchema, nativeTurnWorkParams, nativeTurnWorkResultTypes, isNativeTurnWorkMethod } from './native-turn-work.ts';
import { nativeGuardianMethod, nativeGuardianInputSchema, nativeGuardianParams, type NativeGuardianDenialNotice, type NativeGuardianApprovalNotice } from './native-guardian.ts';
import { nativeAccountActionMethods, nativeAccountActionInputSchema, nativeAccountActionParams, nativeAccountActionResultTypes, isNativeAccountActionMethod, type NativeAccountActionNotice } from './native-account-actions.ts';
import { nativeGatewayOAuthMethods, nativeGatewayOAuthInputSchema, nativeGatewayOAuthParams, nativeGatewayOAuthResultTypes, isNativeGatewayOAuthMethod, type NativeGatewayOAuthProgress } from './native-gateway-oauth.ts';
import { nativeAccountAuthMethods, nativeAccountAuthInputSchema, nativeAccountAuthParams, isNativeAccountAuthMethod } from './native-account-auth.ts';
import { nativeAccountReadMethods, nativeAccountReadResultTypes, isNativeAccountReadMethod, nativeAccountReadInputSchema, nativeAccountReadParams } from './native-account-read.ts';
import { nativeObject, type NativeStandaloneMethod } from "./native-runtime-contract.ts";
import { nativeMcpOAuthMethod, nativeMcpOAuthInputSchema, nativeMcpOAuthParams, type NativeMcpOAuthNotice } from './native-mcp-oauth.ts';
import { nativeMcpToolMethod, nativeMcpToolInputSchema, nativeMcpToolParams } from './native-mcp-tool.ts';
import type { NativeFilesystemWatchMethod, NativeFilesystemWatchValue } from './native-filesystem-watch.ts';
import type { NativeCommandMethod, NativeCommandProgress, NativeCommandValue } from './native-command.ts';
import { nativeThreadShellMethod, nativeThreadShellInputSchema, nativeThreadShellParams, type NativeThreadShellNotice } from './native-thread-shell.ts';
import { nativeConfigurationReadMethods, isNativeConfigurationReadMethod, nativeConfigurationReadInputSchema, nativeConfigurationReadParams } from './native-configuration-read.ts';

import { nativeConfigurationControlMethods, isNativeConfigurationControlMethod, nativeConfigurationControlInputSchema, nativeConfigurationControlParams } from './native-configuration-control.ts';
import { nativeConfigurationWriteMethods, isNativeConfigurationWriteMethod, nativeConfigurationWriteInputSchema, nativeConfigurationWriteParams } from './native-configuration-write.ts';
import { nativeMigrationMethods, isNativeMigrationMethod, nativeMigrationInputSchema, nativeMigrationParams } from './native-migration.ts';
import { nativeThreadContentMethods, nativeThreadContentResultTypes, isNativeThreadContentMethod, nativeThreadContentInputSchema, nativeThreadContentParams } from './native-thread-content.ts';
import { nativeThreadLifecycleMethods, nativeThreadLifecycleResultTypes, isNativeThreadLifecycleMethod, nativeThreadLifecycleInputSchema, nativeThreadLifecycleParams } from './native-thread-lifecycle.ts';
import { nativeStoredThreadReadMethods, nativeStoredThreadReadResultTypes, isNativeStoredThreadReadMethod, nativeStoredThreadReadInputSchema, nativeStoredThreadReadParams } from './native-stored-thread.ts';

/** Reviewed public 0.163.0 methods, with separately granted private lifecycle controls. */
export const nativeWorkflowMethods = ["thread/start", "thread/resume", "turn/start", nativeMcpToolMethod, nativeMcpOAuthMethod, nativeThreadShellMethod, nativeWindowsSandboxReadinessMethod, ...nativeConfigurationReadMethods, ...nativePluginReadMethods, ...nativeMarketplaceMethods, ...nativePluginInstallMethods, ...nativePluginShareMethods, ...nativeConfigurationControlMethods, ...nativeConfigurationWriteMethods, ...nativeMigrationMethods, ...nativeStoredThreadReadMethods, ...nativeThreadLifecycleMethods, ...nativeThreadContentMethods, ...nativeAccountReadMethods, ...nativeAccountAuthMethods, ...nativeGatewayOAuthMethods, ...nativeAccountActionMethods, ...nativeTurnControlMethods, ...nativeTurnWorkMethods, nativeGuardianMethod] as const;
export type NativeWorkflowMethod = typeof nativeWorkflowMethods[number];
export const nativeAgentMethods = ["initialize", "account/read", ...nativeWorkflowMethods] as const;
export type NativeAgentMethod = typeof nativeAgentMethods[number];
export type NativeLoginKind = "apiKey" | "chatgpt" | "chatgptDeviceCode";
export type NativeDecision = "accept" | "decline" | "cancel";
export type NativeInteraction = { token: string; kind: "command" | "fileChange"; threadId: string; turnId: string;
  itemId: string; command?: string; cwd?: string; reason?: string };
export type NativeAgentProgress = { kind: "login"; login: "chatgpt"; loginId: string; authUrl: string }
  | { kind: "login"; login: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { kind: "approval"; interaction: NativeInteraction }
  | { kind: "running"; threadId: string; turnId: string } | NativeGuardianDenialNotice | NativeGuardianApprovalNotice | NativeAccountActionNotice | NativeGatewayOAuthProgress | NativeMcpOAuthNotice | NativeCommandProgress | NativeThreadShellNotice;
export type NativeProgressCallback = (progress: NativeAgentProgress) => void;
export type NativeRequest = { protocol: "json-rpc"; method: NativeWorkflowMethod | "account/read" | "initialize" | "feedback/upload" | NativeStandaloneMethod | NativeFilesystemWatchMethod | NativeCommandMethod; params: Record<string, unknown> };
export type NativeResponse = { protocol: "json-rpc"; result: unknown; notification?: NativeFilesystemWatchValue['notification'] };
export type NativeWorkflowValue = NativeFilesystemWatchValue | NativeCommandValue;
export type NativeWorkflowValueCallback = (value: NativeWorkflowValue) => void;
export type NativeExecutionResult = { request: NativeRequest; response: NativeResponse };
export type NativeRpcId = string | number;
export const nativeRpcId = (id: unknown): id is NativeRpcId => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)
  || Number.isSafeInteger(id) && (id as number) >= 0;
export const nativeOwnedId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,192}$/.test(id);
export const isNativeWorkflowMethod = (method: unknown): method is NativeWorkflowMethod => nativeWorkflowMethods.includes(method as NativeWorkflowMethod);
export const nativeWorkflowResultTypes: Record<NativeWorkflowMethod, string> = {
  "thread/start": "ThreadStartResponse", "thread/resume": "ThreadResumeResponse", "turn/start": "TurnCompletedNotification", [nativeMcpToolMethod]: "McpServerToolCallResponse", [nativeMcpOAuthMethod]: "McpServerOauthLoginCompletedNotification", [nativeThreadShellMethod]: "ThreadShellCommandResponse",
  'config/read': 'ConfigReadResponse', 'configRequirements/read': 'ConfigRequirementsReadResponse', 'experimentalFeature/list': 'ExperimentalFeatureListResponse', 'skills/list': 'SkillsListResponse',
  'experimentalFeature/enablement/set': 'ExperimentalFeatureEnablementSetResponse', 'skills/extraRoots/set': 'SkillsExtraRootsSetResponse', 'config/mcpServer/reload': 'McpServerRefreshResponse',
  'config/value/write': 'ConfigWriteResponse', 'config/batchWrite': 'ConfigWriteResponse', 'skills/config/write': 'SkillsConfigWriteResponse',
  'externalAgentConfig/detect': 'ExternalAgentConfigDetectResponse', 'externalAgentConfig/import': 'ExternalAgentConfigImportResponse',
  'externalAgentConfig/import/readHistories': 'ExternalAgentConfigImportHistoriesReadResponse', 'externalAgentConfig/import/recordHistory': 'ExternalAgentConfigImportHistoryRecordResponse',
  "account/login/start": "GetAccountResponse", "account/login/cancel": "CancelLoginAccountResponse", "account/logout": "LogoutAccountResponse",
  ...nativeMarketplaceResultTypes, ...nativePluginInstallResultTypes, ...nativePluginShareResultTypes, ...nativeWindowsSandboxReadinessResultTypes, ...nativePluginReadResultTypes, ...nativeStoredThreadReadResultTypes, ...nativeThreadLifecycleResultTypes, ...nativeThreadContentResultTypes, ...nativeAccountReadResultTypes, ...nativeGatewayOAuthResultTypes, ...nativeAccountActionResultTypes, ...nativeTurnControlResultTypes, ...nativeTurnWorkResultTypes,
  [nativeGuardianMethod]: 'ThreadApproveGuardianDeniedActionResponse'
};
/** The reviewed input subset; the complete pinned wire schema is retained too. */
export function nativeWorkflowInputSchema(method: NativeWorkflowMethod): { type: string; additionalProperties: false; properties: Record<string, Record<string, unknown>>; required: string[] } {
  if (method === nativeMcpToolMethod) return nativeMcpToolInputSchema();
  if (method === nativeMcpOAuthMethod) return nativeMcpOAuthInputSchema();
  if (method === nativeThreadShellMethod) return nativeThreadShellInputSchema();
  if (isNativeWindowsSandboxReadinessMethod(method)) return nativeWindowsSandboxInputSchema(method);
  if (isNativePluginShareMethod(method)) return nativePluginShareInputSchema(method);
  if (isNativePluginInstallMethod(method)) return nativePluginInstallInputSchema(method);
  if (isNativeMarketplaceMethod(method)) return nativeMarketplaceInputSchema(method);
  if (isNativePluginReadMethod(method)) return nativePluginReadInputSchema(method);
  if (isNativeConfigurationReadMethod(method)) return nativeConfigurationReadInputSchema(method);
  if (isNativeConfigurationControlMethod(method)) return nativeConfigurationControlInputSchema(method);
  if (isNativeConfigurationWriteMethod(method)) return nativeConfigurationWriteInputSchema(method);
  if (isNativeMigrationMethod(method)) return nativeMigrationInputSchema(method);
  if (isNativeTurnControlMethod(method)) return nativeTurnControlInputSchema(method);
  if (isNativeTurnWorkMethod(method)) return nativeTurnWorkInputSchema(method);
  if (method === nativeGuardianMethod) return nativeGuardianInputSchema();
  if (isNativeAccountActionMethod(method)) return nativeAccountActionInputSchema(method);
  if (isNativeGatewayOAuthMethod(method)) return nativeGatewayOAuthInputSchema();
  if (isNativeAccountAuthMethod(method)) return nativeAccountAuthInputSchema(method);
  if (isNativeAccountReadMethod(method)) return nativeAccountReadInputSchema(method);
  if (isNativeThreadContentMethod(method)) return nativeThreadContentInputSchema(method);
  if (isNativeThreadLifecycleMethod(method)) return nativeThreadLifecycleInputSchema(method);
  if (isNativeStoredThreadReadMethod(method)) return nativeStoredThreadReadInputSchema(method);
  return { type: "object", additionalProperties: false, properties: {
    ...(method !== "thread/start" ? { threadId: { type: "string", minLength: 1, maxLength: 192, pattern: "^[A-Za-z0-9_-]+$" } } : {}),
    ...(method === "turn/start" ? { input: { type: "array", minItems: 1, maxItems: 16, items: { type: "object", additionalProperties: false,
      properties: { type: { type: "string", enum: ["text"] }, text: { type: "string", minLength: 1, maxLength: 24576 } }, required: ["type", "text"] } } } : {}),
    model: { type: "string", minLength: 1, maxLength: 128 },
    ...(method !== 'turn/start' ? { approvalsReviewer: { type: 'string', enum: ['user', 'auto_review'], default: 'user', description: 'Human review is the default. AI review requires the companion owner\'s Guardian grant. A denied action needs a separate human confirmation before a retry is approved.' } } : {})
  }, required: method === "thread/start" ? [] : method === "thread/resume" ? ["threadId"] : ["threadId", "input"] };
}

/** No cwd, sandbox, provider, environment, config, history or credential overrides. */
export function nativeWorkflowParams(method: NativeWorkflowMethod, value: unknown): Record<string, unknown> {
  if (method === nativeMcpToolMethod) return nativeMcpToolParams(value);
  if (method === nativeMcpOAuthMethod) return nativeMcpOAuthParams(value);
  if (method === nativeThreadShellMethod) return nativeThreadShellParams(value);
  if (isNativeWindowsSandboxReadinessMethod(method)) return nativeWindowsSandboxParams(method, value);
  if (isNativePluginShareMethod(method)) return nativePluginShareParams(method, value);
  if (isNativePluginInstallMethod(method)) return nativePluginInstallParams(method, value);
  if (isNativeMarketplaceMethod(method)) return nativeMarketplaceParams(method, value);
  if (isNativePluginReadMethod(method)) return nativePluginReadParams(method, value);
  if (isNativeConfigurationReadMethod(method)) return nativeConfigurationReadParams(method, value);
  if (isNativeConfigurationControlMethod(method)) return nativeConfigurationControlParams(method, value);
  if (isNativeConfigurationWriteMethod(method)) return nativeConfigurationWriteParams(method, value);
  if (isNativeMigrationMethod(method)) return nativeMigrationParams(method, value);
  if (isNativeTurnControlMethod(method)) return nativeTurnControlParams(method, value);
  if (isNativeTurnWorkMethod(method)) return nativeTurnWorkParams(method, value);
  if (method === nativeGuardianMethod) return nativeGuardianParams(value);
  if (isNativeAccountActionMethod(method)) return nativeAccountActionParams(method, value);
  if (isNativeGatewayOAuthMethod(method)) return nativeGatewayOAuthParams(value);
  if (isNativeAccountAuthMethod(method)) return nativeAccountAuthParams(method, value);
  if (isNativeAccountReadMethod(method)) return nativeAccountReadParams(method, value);
  if (isNativeThreadContentMethod(method)) return nativeThreadContentParams(method, value);
  if (isNativeThreadLifecycleMethod(method)) return nativeThreadLifecycleParams(method, value);
  if (isNativeStoredThreadReadMethod(method)) return nativeStoredThreadReadParams(method, value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native parameters.");
  const item = value as Record<string, unknown>, keys = Object.keys(item);
  const allowed = method === "thread/start" ? ["model", 'approvalsReviewer'] : method === "thread/resume" ? ["threadId", "model", 'approvalsReviewer'] : ["threadId", "input", "model"];
  nativeObject(item, keys);
  if (keys.some(key => !allowed.includes(key)) || item.model !== undefined && (typeof item.model !== "string"
    || !item.model.trim() || item.model.length > 128 || /[\u0000-\u001f\u007f]/.test(item.model))) throw new Error("Unsupported native parameters.");
  if (method !== "thread/start" && !nativeOwnedId(item.threadId)) throw new Error("A native thread is required.");
  if (Object.hasOwn(item, 'approvalsReviewer') && (typeof item.approvalsReviewer !== 'string' || !['user', 'auto_review'].includes(item.approvalsReviewer))) throw new Error('Choose a supported approval reviewer.');
  if (method === "turn/start") {
    if (!Array.isArray(item.input) || !item.input.length || item.input.length > 16) throw new Error("Text input is required.");
    let bytes = 0;
    for (const input of item.input) {
      const text = nativeObject(input, ["type", "text"]);
      if (text.type !== "text" || typeof text.text !== "string" || !text.text.trim()) throw new Error("Only text input is supported.");
      bytes += new TextEncoder().encode(text.text).byteLength;
    }
    if (bytes > 24 * 1024) throw new Error("Native text input is too large.");
  }
  return structuredClone(item);
}
export function nativeLoginParams(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native login.");
  const item = value as Record<string, unknown>;
  const browser = item.type === 'chatgpt' ? ['appBrand', 'codexStreamlinedLogin', 'useHostedLoginSuccessPage'].filter(key => Object.hasOwn(item, key)) : [];
  nativeObject(item, item.type === "apiKey" ? ["type", "apiKey"] : ["type", ...browser]);
  if (!["apiKey", "chatgpt", "chatgptDeviceCode"].includes(String(item.type)) || item.type === "apiKey"
    && (typeof item.apiKey !== "string" || !item.apiKey.trim() || item.apiKey.length > 4096 || /[\u0000-\u001f\u007f]/.test(item.apiKey))) throw new Error("Unsupported native login.");
  if (item.type === 'chatgpt' && (item.appBrand !== undefined && item.appBrand !== null && !['codex', 'chatgpt'].includes(String(item.appBrand))
    || ['codexStreamlinedLogin', 'useHostedLoginSuccessPage'].some(key => Object.hasOwn(item, key) && typeof item[key] !== 'boolean'))) throw new Error('Unsupported browser sign-in options.');
  return { ...item };
}
