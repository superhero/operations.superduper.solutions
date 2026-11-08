// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeWindowsSandboxReadinessMethod, nativeWindowsSandboxParams } from './native-windows-sandbox.ts';
import { isNativePluginShareMethod, nativePluginShareParams } from './native-plugin-share.ts';
import { isNativePluginInstallMethod, nativePluginInstallParams } from './native-plugin-install.ts';
import { isNativeTurnControlMethod, nativeTurnControlParams } from './native-turn-control.ts';
import { isNativeAccountActionMethod, nativeAccountActionParams } from './native-account-actions.ts';
import { isNativeGatewayOAuthMethod, nativeGatewayOAuthParams } from './native-gateway-oauth.ts';
import { isNativeAccountAuthMethod, nativeAccountAuthParams } from './native-account-auth.ts';
import { isNativeAccountReadMethod, nativeAccountReadParams } from './native-account-read.ts';
import { isNativeThreadContentMethod, nativeThreadContentParams } from './native-thread-content.ts';
import { isNativeThreadLifecycleMethod, nativeThreadLifecycleParams } from './native-thread-lifecycle.ts';
import type { JsonValue, Operation } from "./catalog.ts";
import { InputValidationError, validateInputValue, type InputValues } from "./operation-input.ts";
import { isNativeWorkflowMethod, nativeWorkflowParams, type NativeRequest } from "./native-agent-contract.ts";
import { nativeRuntimeVersion, isNativeStandaloneMethod } from "./native-runtime-contract.ts";
import { nativeAccountReadMethod, nativeAccountParams } from "./native-account.ts";
import { nativeInitializeMethod, nativeInitializeParams } from "./native-initialize.ts";
import { nativeQueryParams } from "./native-query-contract.ts";
import { nativeFeedbackMethod, nativeFeedbackParams } from "./native-feedback-contract.ts";
import { isNativeFilesystemWatchMethod, nativeFilesystemWatchParams } from './native-filesystem-watch.ts';
import { nativeMcpOAuthMethod, nativeMcpOAuthParams } from './native-mcp-oauth.ts';
import { nativeMcpToolMethod, nativeMcpToolParams } from './native-mcp-tool.ts';
import { NativeMcpInputError } from './native-mcp-read.ts';
import { NativeSectionInputError } from './native-section-contract.ts';
import { isNativeCommandMethod, nativeCommandParams, NativeCommandInputError } from './native-command.ts';
import { nativeThreadShellMethod, nativeThreadShellParams } from './native-thread-shell.ts';
import { isNativeMarketplaceMethod, nativeMarketplaceParams } from './native-marketplace.ts';
import { isNativePluginReadMethod, nativePluginReadParams } from './native-plugin-read.ts';
import { isNativeConfigurationReadMethod, nativeConfigurationReadParams } from './native-configuration-read.ts';

import { isNativeConfigurationControlMethod, nativeConfigurationControlParams } from './native-configuration-control.ts';
import { isNativeConfigurationWriteMethod, nativeConfigurationWriteParams } from './native-configuration-write.ts';
import { isNativeMigrationMethod, nativeMigrationParams } from './native-migration.ts';
import { isNativeStoredThreadReadMethod, nativeStoredThreadReadParams } from './native-stored-thread.ts';

export function prepareNativeRequest(operation: Operation, values: InputValues): NativeRequest {
  const method = operation.rpc?.method;
  if (operation.protocol === "json-rpc" && operation.rpc?.version === nativeRuntimeVersion && (isNativeTurnControlMethod(method) || isNativeAccountActionMethod(method) || isNativeGatewayOAuthMethod(method) || isNativeAccountAuthMethod(method) || isNativeAccountReadMethod(method) || isNativeThreadContentMethod(method) || isNativeThreadLifecycleMethod(method) || isNativeStoredThreadReadMethod(method) || isNativeMigrationMethod(method) || isNativeConfigurationWriteMethod(method) || isNativeConfigurationControlMethod(method) || isNativeConfigurationReadMethod(method) || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method) || isNativeWindowsSandboxReadinessMethod(method) || isNativePluginReadMethod(method) || method === nativeThreadShellMethod || method === nativeMcpOAuthMethod || method === nativeMcpToolMethod || isNativeStandaloneMethod(method) || method === nativeFeedbackMethod || isNativeFilesystemWatchMethod(method) || isNativeCommandMethod(method)) && !operation.unavailableReason) {
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(values)) if (!operation.fields.some(field => field.key === key)) throw new InputValidationError(key, 'Unsupported native parameter.');
    for (const field of operation.fields) {
      const raw = values[field.key]; if (raw === undefined) continue;
      let value: JsonValue = raw;
      if (raw !== null && field.type !== 'string') {
        try { value = JSON.parse(raw); } catch { throw new InputValidationError(field.key, 'Enter valid JSON for this native parameter.'); }
      }
      validateInputValue(field, value); params[field.name] = value;
    }
    try { return { protocol: 'json-rpc', method, params: method === nativeMcpOAuthMethod ? nativeMcpOAuthParams(params) : method === nativeMcpToolMethod ? nativeMcpToolParams(params) : method === nativeFeedbackMethod ? nativeFeedbackParams(params)
      : isNativeTurnControlMethod(method) ? nativeTurnControlParams(method, params) : isNativeAccountActionMethod(method) ? nativeAccountActionParams(method, params) : isNativeGatewayOAuthMethod(method) ? nativeGatewayOAuthParams(params) : isNativeAccountAuthMethod(method) ? nativeAccountAuthParams(method, params) : isNativeAccountReadMethod(method) ? nativeAccountReadParams(method, params) : isNativeThreadContentMethod(method) ? nativeThreadContentParams(method, params) : isNativeThreadLifecycleMethod(method) ? nativeThreadLifecycleParams(method, params): isNativeStoredThreadReadMethod(method) ? nativeStoredThreadReadParams(method, params) : isNativeMigrationMethod(method) ? nativeMigrationParams(method, params) : isNativeConfigurationWriteMethod(method) ? nativeConfigurationWriteParams(method, params) : isNativeConfigurationControlMethod(method) ? nativeConfigurationControlParams(method, params) : isNativeWindowsSandboxReadinessMethod(method) ? nativeWindowsSandboxParams(method, params) : isNativePluginShareMethod(method) ? nativePluginShareParams(method, params) : isNativePluginInstallMethod(method) ? nativePluginInstallParams(method, params) : isNativeMarketplaceMethod(method) ? nativeMarketplaceParams(method, params) : isNativePluginReadMethod(method) ? nativePluginReadParams(method, params) : isNativeConfigurationReadMethod(method) ? nativeConfigurationReadParams(method, params) : method === nativeThreadShellMethod ? nativeThreadShellParams(params) : isNativeCommandMethod(method) ? nativeCommandParams(method, params) : isNativeFilesystemWatchMethod(method) ? nativeFilesystemWatchParams(method, params) : nativeQueryParams(method, params) }; }
    catch (error) {
      if (error instanceof NativeSectionInputError || error instanceof NativeMcpInputError || error instanceof NativeCommandInputError) throw new InputValidationError(error.field === 'params' ? 'params' : 'params:' + error.field, error.message);
      throw new InputValidationError('params', method === nativeFeedbackMethod ? 'Feedback requires a classification and bounded public inputs, diagnostics consent and workspace attachments.' : 'Native inputs must use the approved fields, bounded values and workspace paths.');
    }
  }
  if (operation.protocol === "json-rpc" && operation.rpc?.version === nativeRuntimeVersion && method === nativeInitializeMethod && !operation.unavailableReason) {
    if (Object.keys(values).length) throw new InputValidationError("params:clientInfo", "The paired runtime uses the Operations client identity and public capabilities.");
    return { protocol: "json-rpc", method, params: nativeInitializeParams() };
  }
  if (operation.protocol === "json-rpc" && operation.rpc?.version === nativeRuntimeVersion && method === nativeAccountReadMethod && !operation.unavailableReason) {
    if (Object.keys(values).some(key => key !== "params:refreshToken")) throw new InputValidationError("params:refreshToken", "Unsupported account parameter.");
    const raw = values["params:refreshToken"];
    if (raw !== undefined && (typeof raw !== "string" || raw.trim() !== "false")) throw new InputValidationError("params:refreshToken", "The paired account read requires false; credential refresh is a separate private action.");
    return { protocol: "json-rpc", method, params: nativeAccountParams({ refreshToken: false }) };
  }
  if (operation.protocol !== "json-rpc" || operation.rpc?.version !== nativeRuntimeVersion || !isNativeWorkflowMethod(method)) throw new Error("Unsupported native workflow method.");
  const params: Record<string, unknown> = {};
  for (const name of Object.keys(values)) if (!operation.fields.some(field => field.key === name)) throw new InputValidationError(name, "Unsupported native parameter.");
  for (const field of operation.fields) {
    const raw = values[field.key];
    if (raw === undefined) { if (field.required) throw new InputValidationError(field.key, `${field.label} is required.`); continue; }
    let value: JsonValue = raw;
    if (field.type === "array" || field.type === "object" || field.type === "json") {
      try { value = raw === null ? null : JSON.parse(raw); } catch { throw new InputValidationError(field.key, `${field.label}: enter valid JSON.`); }
    }
    validateInputValue(field, value); params[field.name] = value;
  }
  try { return { protocol: "json-rpc", method, params: nativeWorkflowParams(method, params) }; }
  catch { throw new InputValidationError(method === "turn/start" ? "params:input" : "params:model", "The native parameters exceed the supported text workflow contract."); }
}
