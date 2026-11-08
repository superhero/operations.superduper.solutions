// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeWindowsSandboxReadinessMethod } from './native-windows-sandbox.ts';
import { isNativePluginShareMethod } from './native-plugin-share.ts';
import { isNativePluginInstallMethod } from './native-plugin-install.ts';
import { nativeGuardianMethod } from './native-guardian.ts';
import { isNativeTurnWorkMethod } from './native-turn-work.ts';
import { isNativeTurnControlMethod } from './native-turn-control.ts';
import { isNativeAccountActionMethod } from './native-account-actions.ts';
import { isNativeGatewayOAuthMethod } from './native-gateway-oauth.ts';
import { isNativeAccountAuthMethod } from './native-account-auth.ts';
import { isNativeAccountReadMethod } from './native-account-read.ts';
import { isNativeThreadContentMethod, nativeThreadContentResultSchema } from './native-thread-content.ts';
import { isNativeThreadLifecycleMethod, nativeThreadLifecycleResultSchema } from './native-thread-lifecycle.ts';
import { withOperationCapabilities, nativeCapabilityIssues } from "./operation-capabilities.ts";
import type { Operation, InputSchema } from "./catalog.ts";
import { isNativeWorkflowMethod, nativeWorkflowInputSchema, nativeWorkflowResultTypes } from "./native-agent-contract.ts";
import { isNativeMigrationMethod } from './native-migration.ts';
import { isNativeStoredThreadReadMethod, nativeStoredThreadReadResultSchema } from './native-stored-thread.ts';
import { nativeRuntimeVersion, isNativeStandaloneMethod } from "./native-runtime-contract.ts";
import { nativeMethodResult } from "./native-method-results.ts";
import { nativeAccountReadMethod, nativeAccountInputSchema, nativeAccountWorkflowResultSchema, isNativeWorkflowOperation } from "./native-account.ts";
import { nativeInitializeMethod, nativeInitializeInputSchema } from "./native-initialize.ts";
import { nativeQueryInputSchema, nativeQueryFieldSchema } from "./native-query-contract.ts";
import { nativeMcpOAuthMethod } from './native-mcp-oauth.ts';
import { nativeMcpToolMethod } from './native-mcp-tool.ts';
import { nativeFeedbackMethod, nativeFeedbackInputSchema } from "./native-feedback-contract.ts";
import { isNativeFilesystemWatchMethod, nativeFilesystemWatchInputSchema, nativeFilesystemWatchNotificationSchema } from './native-filesystem-watch.ts';
import { isNativeCommandMethod, nativeCommandInputSchema, nativeCommandDispatchSchema, nativeCommandNotificationSchema } from './native-command.ts';
import { nativeThreadShellMethod, nativeThreadShellResultSchema } from './native-thread-shell.ts';
import { isNativeConfigurationControlMethod } from './native-configuration-control.ts';
import { isNativeConfigurationWriteMethod } from './native-configuration-write.ts';
import { isNativeMarketplaceMethod } from './native-marketplace.ts';
import { isNativePluginReadMethod } from './native-plugin-read.ts';
import { isNativeConfigurationReadMethod, nativeConfigurationReadResultSchema } from './native-configuration-read.ts';

type Document = Record<string, unknown>;
export type NativeSchema = boolean | Document;
export type NativeRpcContract = {
  version: string;
  method: string;
  paramsRequired: boolean;
  params?: NativeSchema;
  result: NativeSchema;
  error: NativeSchema;
  workflowParams?: NativeSchema;
  workflowResult?: NativeSchema;
  workflowNotification?: NativeSchema;
  workflowDispatched?: NativeSchema;
  methodResult?: NativeSchema;
};
export const codexExecutionLimitation = "This Codex method is not enabled for native workflow execution.";
const object = (value: unknown): value is Document => !!value && typeof value === "object" && !Array.isArray(value);
const schema = (value: unknown): value is NativeSchema => typeof value === "boolean" || object(value);
const literals = new Set(["default", "example", "examples", "enum", "const"]);
const maps = new Set(["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]);
export const nativeRpcMethod = /^[A-Za-z][A-Za-z0-9_/-]{0,511}$/;

/** Keep the selected wire request and its reference closure at their original pointers.
 * Results stay generic when the pinned wire schema does not map methods to result types. */
export function scopeNativeRpcSchema(document: Document, method: string): Document
{
  const metadata = document["x-codex-app-server"], info = document.info, definitions = document.definitions;
  if (!object(metadata) || metadata.protocol !== "json-rpc" || !object(info)
    || typeof info.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(info.version)
    || metadata.version !== info.version || document.$schema !== "http://json-schema.org/draft-07/schema#"
    || document.openapi !== undefined || document.paths !== undefined || document.servers !== undefined
    || !object(definitions) || !object(definitions.ClientRequest) || !Array.isArray(definitions.ClientRequest.oneOf)
    || !nativeRpcMethod.test(method)) throw new Error("Invalid native RPC model contract.");
  const requests = definitions.ClientRequest.oneOf.filter(value => object(value) && object(value.properties)
    && object(value.properties.method) && Array.isArray(value.properties.method.enum)
    && value.properties.method.enum.length === 1 && value.properties.method.enum[0] === method);
  const request = requests[0];
  if (requests.length !== 1 || !object(request) || request.type !== "object" || !object(request.properties)
    || !schema(request.properties.id) || !Array.isArray(request.required)
    || !request.required.includes("id") || !request.required.includes("method")
    || request.required.includes("params") && !schema(request.properties.params)
    || request.properties.params !== undefined && !schema(request.properties.params)
    || !schema(definitions.JSONRPCResponse) || !schema(definitions.JSONRPCError))
    throw new Error("The native RPC request, parameters or response schema is unavailable.");
  const result: Document = structuredClone({ $schema: document.$schema, info,
    "x-codex-app-server": metadata, definitions: { ClientRequest: { oneOf: [request] },
      JSONRPCResponse: definitions.JSONRPCResponse, JSONRPCError: definitions.JSONRPCError } });
  const workflow = info.version !== nativeRuntimeVersion ? undefined : isNativeWorkflowMethod(method) ? {
    params: nativeWorkflowInputSchema(method), result: method === 'account/login/start' ? nativeAccountWorkflowResultSchema((document.definitions as { v2: Record<string, unknown> }).v2.GetAccountResponse) : isNativeThreadContentMethod(method) ? nativeThreadContentResultSchema(method, document) : isNativeThreadLifecycleMethod(method) ? nativeThreadLifecycleResultSchema(method, document) : isNativeStoredThreadReadMethod(method) ? nativeStoredThreadReadResultSchema(method, document) : method === 'config/read' ? nativeConfigurationReadResultSchema(document) : method === nativeThreadShellMethod ? nativeThreadShellResultSchema(document) : { $ref: "#/definitions/v2/" + nativeWorkflowResultTypes[method] },
    ...(method === nativeGuardianMethod || isNativeTurnWorkMethod(method) || isNativeTurnControlMethod(method) || isNativeAccountActionMethod(method) || isNativeGatewayOAuthMethod(method) || isNativeAccountAuthMethod(method) || isNativeAccountReadMethod(method) || isNativeThreadContentMethod(method) || isNativeThreadLifecycleMethod(method) || isNativeStoredThreadReadMethod(method) || method === 'config/read' || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method) || isNativeWindowsSandboxReadinessMethod(method) || isNativePluginReadMethod(method) || method === nativeMcpOAuthMethod || method === nativeThreadShellMethod ? { wireResult: nativeMethodResult(document, method) } : {}),
    ...(isNativeAccountActionMethod(method) || method === 'account/login/start' || method === 'account/logout' ? { wireConfirmation: { $ref: '#/definitions/v2/GetAccountResponse' } } : {}),
    ...(isNativeGatewayOAuthMethod(method) ? { wireConfirmation: { $ref: '#/definitions/v2/GatewayOAuthReadResponse' }, wireNotifications: [{ $ref: '#/definitions/v2/GatewayOAuthChangedNotification' }] } : {}),
    ...(isNativeTurnWorkMethod(method) || isNativeTurnControlMethod(method) ? { wireNotifications: [{ $ref: '#/definitions/v2/TurnStartedNotification' }, { $ref: '#/definitions/v2/TurnCompletedNotification' }] } : {}),
    ...(method === nativeGuardianMethod || method === 'turn/start' ? { guardianNotifications: [{ $ref: '#/definitions/v2/ItemGuardianApprovalReviewStartedNotification' }, { $ref: '#/definitions/v2/ItemGuardianApprovalReviewCompletedNotification' }] } : {}),
    ...(method === nativeThreadShellMethod ? { wireNotifications: [{ $ref: '#/definitions/v2/ItemCompletedNotification' }] } : {})
  } : method === nativeAccountReadMethod ? { params: nativeAccountInputSchema(),
    result: nativeAccountWorkflowResultSchema(object(definitions.v2) ? definitions.v2.GetAccountResponse : undefined),
    wireResult: { $ref: "#/definitions/v2/GetAccountResponse" } }
    : method === nativeInitializeMethod ? { params: nativeInitializeInputSchema(), result: { $ref: "#/definitions/InitializeResponse" } }
      : isNativeStandaloneMethod(method) ? { params: nativeQueryInputSchema(method), result: nativeMethodResult(document, method)! }
        : method === nativeFeedbackMethod ? { params: nativeFeedbackInputSchema(), result: nativeMethodResult(document, method)! }
          : isNativeFilesystemWatchMethod(method) ? { params: nativeFilesystemWatchInputSchema(method), result: nativeMethodResult(document, method)!,
            ...(method === 'fs/watch' ? { notification: nativeFilesystemWatchNotificationSchema() } : {}) }
            : isNativeCommandMethod(method) ? { params: nativeCommandInputSchema(method), result: nativeMethodResult(document, method)!,
              ...(method === 'command/exec' ? { dispatched: nativeCommandDispatchSchema(), notification: nativeCommandNotificationSchema() } : {}) } : undefined;
  if (workflow && !schema(workflow.result)) throw new Error('The native workflow result schema is unavailable.');
  if (workflow) result["x-operations-native-workflow"] = workflow;
  const methodResult = workflow ? undefined : nativeMethodResult(document, method);
  if (methodResult) result["x-operations-native-method-result"] = methodResult;
  const visited = new Set<string>();
  let nodes = 0;
  function walk(value: unknown, depth = 0): void {
    if (++nodes > 100_000 || depth > 128) throw new Error("The native RPC schema exceeds the model complexity limit.");
    if (Array.isArray(value)) { for (const entry of value) walk(entry, depth + 1); return; }
    if (!object(value)) return;
    if (Object.hasOwn(value, "$ref")) {
      const reference = value.$ref;
      if (typeof reference !== "string" || !reference.startsWith("#/definitions/") || /~(?:[^01]|$)/.test(reference))
        throw new Error("Native RPC models require resolvable local definition references.");
      if (!visited.has(reference)) {
        visited.add(reference);
        const parts = reference.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
        let target: unknown = document;
        for (const key of parts) target = object(target) && Object.hasOwn(target, key) ? target[key] : undefined;
        if (!schema(target)) throw new Error(`Unresolved native RPC reference: ${reference}`);
        let parent = result;
        for (const key of parts.slice(0, -1)) {
          if (!Object.hasOwn(parent, key)) Object.defineProperty(parent, key, { value: {}, enumerable: true, writable: true });
          // Resolution above proves every prefix is an object in this same source document.
          parent = parent[key] as Document;
        }
        Object.defineProperty(parent, parts.at(-1)!, { value: structuredClone(target), enumerable: true, writable: true, configurable: true });
        walk(target, depth + 1);
      }
    }
    for (const [key, child] of Object.entries(value)) if (!literals.has(key) && key !== "$ref") {
      if (maps.has(key) && object(child)) { for (const entry of Object.values(child)) walk(entry, depth + 1); }
      else walk(child, depth + 1);
    }
  }
  walk(request); walk(definitions.JSONRPCResponse); walk(definitions.JSONRPCError);
  if (workflow) walk(workflow);
  if (methodResult) walk(methodResult);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1024 * 1024)
    throw new Error("The native RPC operation model must fit within 1 MiB.");
  return result;
}

/** Hydration and private policy validation use the same native contract. */
export function nativeRpcOperation(document: Document, operationId: string): Operation
{
  const separator = operationId.indexOf(":"), method = operationId.slice(separator + 1);
  if (separator < 1) throw new Error("Invalid native RPC operation identity.");
  const scoped = scopeNativeRpcSchema(document, method);
  const definitions = scoped.definitions as Document;
  const request = (definitions.ClientRequest as { oneOf: Document[] }).oneOf[0]!;
  const properties = request.properties as Document;
  const response = definitions.JSONRPCResponse;
  const responseProperties = object(response) && object(response.properties) ? response.properties : {};
  if (!schema(responseProperties.result)) throw new Error("The native RPC result schema is unavailable.");
  const error = definitions.JSONRPCError;
  const errorProperties = object(error) && object(error.properties) ? error.properties : {};
  if (!schema(errorProperties.error)) throw new Error("The native RPC error schema is unavailable.");
  const workflow = scoped["x-operations-native-workflow"] as { params: ReturnType<typeof nativeWorkflowInputSchema> | ReturnType<typeof nativeAccountInputSchema> | ReturnType<typeof nativeInitializeInputSchema> | ReturnType<typeof nativeQueryInputSchema> | ReturnType<typeof nativeFeedbackInputSchema> | ReturnType<typeof nativeFilesystemWatchInputSchema> | ReturnType<typeof nativeCommandInputSchema>; result: Document; notification?: Document; dispatched?: Document } | undefined;
  const standaloneFields = method === nativeGuardianMethod || isNativeTurnWorkMethod(method) || isNativeTurnControlMethod(method) || isNativeAccountActionMethod(method) || isNativeGatewayOAuthMethod(method) || isNativeAccountAuthMethod(method) || isNativeAccountReadMethod(method) || isNativeThreadContentMethod(method) || isNativeThreadLifecycleMethod(method) || isNativeStoredThreadReadMethod(method) || isNativeMigrationMethod(method) || isNativeConfigurationWriteMethod(method) || isNativeConfigurationControlMethod(method) || isNativeConfigurationReadMethod(method) || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method) || isNativeWindowsSandboxReadinessMethod(method) || isNativePluginReadMethod(method) || method === nativeThreadShellMethod || method === nativeMcpOAuthMethod || method === nativeMcpToolMethod || isNativeStandaloneMethod(method) || method === nativeFeedbackMethod || isNativeFilesystemWatchMethod(method) || isNativeCommandMethod(method);
  const fieldSchema = (name: string, value: Document): InputSchema => isNativeStoredThreadReadMethod(method) && (name === 'cwd' || method === 'thread/items/list' && name === 'cursor')
    ? { type: 'json', nullable: true }
    : nativeQueryFieldSchema(value);
  return withOperationCapabilities({ id: operationId, name: method, description: typeof request.description === "string" ? request.description : "",
    group: "Client requests", method: "RPC", path: method, protocol: "json-rpc",
    rpc: { version: (scoped.info as { version: string }).version, method,
      paramsRequired: (request.required as string[]).includes("params"),
      ...(schema(properties.params) ? { params: properties.params } : {}), result: responseProperties.result, error: errorProperties.error,
      ...(workflow ? { workflowParams: workflow.params, workflowResult: workflow.result } : {}),
      ...(workflow?.notification ? { workflowNotification: workflow.notification } : {}),
      ...(workflow?.dispatched ? { workflowDispatched: workflow.dispatched } : {}),
      ...(scoped["x-operations-native-method-result"] ? { methodResult: scoped["x-operations-native-method-result"] as NativeSchema } : {}) },
    fields: workflow ? Object.entries(workflow.params.properties).map(([name, value]) => ({
      key: "params:" + name, name, label: standaloneFields ? String((value as Document).title ?? name) : name === "threadId" ? "Thread ID" : name === "approvalsReviewer" ? "Approval reviewer" : name === "input" ? "Input" : name === "refreshToken" ? "Refresh token" : "Model",
      description: standaloneFields || name === "approvalsReviewer" ? String((value as Document).description ?? '') : name === "refreshToken" ? "Read cached public account state. Credential refresh is not authorized by this paired read profile."
        : name === "input" ? 'Text input, for example [{"type":"text","text":"Hello"}].' : name === "model" ? "Optional model name supported by the connected account." : "A thread created by this paired runtime.",
      ...(isNativeAccountAuthMethod(method) && name === 'type' ? { enum: ['apiKey', 'chatgpt', 'chatgptDeviceCode'] } : {}),
      ...(isNativeAccountActionMethod(method) && name === 'creditType' ? { enum: ['credits', 'usage_limit'] } : {}),
      ...(method === 'review/start' && name === 'delivery' ? { enum: ['inline'] } : {}),
      ...(name === 'approvalsReviewer' ? { enum: ['user', 'auto_review'], defaultValue: 'user' } : {}),
      location: "params", required: workflow.params.required.includes(name), type: standaloneFields ? fieldSchema(name, value as Document).type : name === "refreshToken" ? "boolean" : name === "input" ? "array" : "string",
      schema: standaloneFields ? fieldSchema(name, value as Document) : value as InputSchema,
      ...(standaloneFields && Object.hasOwn(value as Document, 'default') ? { defaultValue: isNativeAccountAuthMethod(method) && name === 'type' ? String((value as Document).default) : JSON.stringify((value as Document).default) }
        : name === "refreshToken" ? { defaultValue: "false" } : {})
    })) : [], bodyRequired: false, ...(!workflow ? { unavailableReason: codexExecutionLimitation } : {}) }, nativeCapabilityIssues(isNativeWorkflowOperation(method), (scoped.info as { version: string }).version, codexExecutionLimitation));
}
