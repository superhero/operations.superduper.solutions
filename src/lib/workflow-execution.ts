// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { requestBody } from "./request-body.ts";
import { supportedSecurityAlternative } from "./operation-security.ts";
import { operationForId, operationOrigin, type Operation } from "./catalog.ts";
import { catalogForOperation } from "./catalog-registry.ts";
import { prepareRequest, type InputValues, type PreparedRequest } from "./operation-input.ts";
import { operationServerUrl } from "./schema-documents.ts";
import { serverUrlHasPlaceholder } from "./server-url.ts";
import { VaultError, type ApprovedOperation, type CredentialExecutionContext } from "./secrets/types.ts";
import { approvedOperation } from "./secrets/policy.ts";
import { isBasicCredentialReference, validateCredentialContext } from "./secrets/bindings.ts";
import { executeVaultOperation } from "./secrets/vault-executor.ts";
import { readWorkflowResponseBody, WorkflowBodyError } from "./workflow-response-body.ts";
import { workflowResponseLifetime, responseAccept, type ResponseProgress, type ResponseProgressCallback } from "./workflow-response-stream.ts";

export type WorkflowResponse = { status: number; statusText: string; headers: Record<string, string>; body: unknown;
  bodyType?: "binary"; mediaType?: string; transportMediaType?: string; stream?: ResponseProgress; redacted?: boolean };
export type WorkflowExecutionResult = { request: PreparedRequest; response: WorkflowResponse };
export type WorkflowExecutor = {
  execute(operation: Operation, values: InputValues, signal?: AbortSignal, context?: CredentialExecutionContext, onProgress?: ResponseProgressCallback): WorkflowExecutionResult | Promise<WorkflowExecutionResult>;
};
export type CredentialWorkflowExecutor = (descriptor: ApprovedOperation, values: InputValues,
  context: CredentialExecutionContext, signal?: AbortSignal, onProgress?: ResponseProgressCallback) => Promise<WorkflowExecutionResult>;

export class WorkflowResponseError extends Error
{
  readonly response: WorkflowResponse;

  constructor(message: string, response: WorkflowResponse)
  {
    super(message);
    this.name = "WorkflowResponseError";
    this.response = response;
  }
}

export function workflowExecutionForOperation(operation: Operation | string)
{
  const id = typeof operation === "string" ? operation : operation.id;
  const catalog = catalogForOperation(id);
  const canonical = operationForId(id);
  if (!catalog || !canonical) throw new Error("This operation is not available in the registered schemas.");
  return { ...catalog.execution, origin: operationOrigin(id) ?? operationServerUrl(catalog.document, canonical) };
}

export function workflowRequestUrl(request: PreparedRequest, origin: string): string
{
  if (serverUrlHasPlaceholder(origin))
    throw new Error("The operation server still contains a placeholder. Configure its server variables before running it.");
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("The operation server must be an absolute HTTP or HTTPS URL without credentials.");
  if (!request.path.startsWith("/") || request.path.startsWith("//") || /[\\?#\u0000-\u0020\u007f]/.test(request.path)
    || request.path.split("/").some(segment => /^(?:\.|%2e){1,2}$/i.test(segment)))
    throw new Error("The operation path must be an absolute path without an authority, backslashes, query, fragment or traversal segments.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${request.path}`;
  for (const [key, value] of Object.entries(request.query))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) url.searchParams.append(key, String(item));
  return url.href;
}

function requestFailure(signal: AbortSignal | undefined, timeout: AbortSignal, message: string): Error
{
  if (signal?.aborted) return new Error("The request was cancelled.");
  if (timeout.aborted) return new Error("The request timed out. Retry the operation when the endpoint is available.");
  return new Error(message);
}

/** Explicit HTTP executor, also injectable when testing request/response handling. */
export function createWorkflowRequestExecution(fetchRequest: typeof fetch = globalThis.fetch): WorkflowExecutor
{
  return {
    async execute(operation, values, signal, context, onProgress)
    {
      const canonical = operationForId(operation.id);
      if (operation.deferred || !canonical || canonical.method !== operation.method || canonical.path !== operation.path)
        throw new Error("This operation is not available in the registered schemas.");
      if (context?.variables !== undefined || context?.binding.connection) throw new VaultError("PERMISSION");
      const request = prepareRequest(canonical, values, operation.fields);
      const { origin } = workflowExecutionForOperation(canonical);
      if (canonical.security?.length) {
        if (!context) throw new VaultError("PERMISSION");
        const { binding } = validateCredentialContext(context);
        const descriptor = await approvedOperation(canonical, origin);
        if (operationForId(canonical.id) !== canonical || workflowExecutionForOperation(canonical).origin !== origin || binding.fingerprint !== descriptor.fingerprint
          || canonical.security[binding.alternative]?.length !== 0 || Object.keys(binding.credentials).length)
          throw new VaultError("PERMISSION");
      }
      const credentialHeaders = new Set((canonical.security ?? []).flat().flatMap(scheme => scheme.header ? [scheme.header.toLowerCase()] : []));
      const credentialQueries = new Set((canonical.security ?? []).flat().flatMap(scheme => scheme.query ? [scheme.query] : []));
      if (Object.keys(request.headers ?? {}).some(name => credentialHeaders.has(name.toLowerCase()))
        || Object.keys(request.query).some(name => credentialQueries.has(name))) throw new VaultError("PERMISSION");
      const url = workflowRequestUrl(request, origin);
      if (request.method === "TRACE") throw new Error("Browsers do not permit TRACE requests.");
      const lifetime = workflowResponseLifetime(signal), timeout = lifetime.timeout;
      try {
        const requestSignal = lifetime.signal;
        let response: Response;
        const headers: Record<string, string> = { Accept: responseAccept(canonical.responseStream, canonical.responseMediaType, request.body), ...request.headers };
        if (request.body !== undefined && request.contentType !== "multipart/form-data")
          headers["Content-Type"] = request.contentType ?? "application/json";
        try
        {
          response = await fetchRequest(url, {
            method: request.method, redirect: "error", credentials: "omit", headers, body: requestBody(request),
            signal: requestSignal
          });
        }
        catch
        {
          throw requestFailure(signal, timeout, `The request could not reach ${origin}. Check connectivity and whether the endpoint allows browser requests, then retry.`);
        }
        const metadata = { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) };
        let parsed: Awaited<ReturnType<typeof readWorkflowResponseBody>>;
        let streaming = false;
        try { parsed = await readWorkflowResponseBody(response, canonical, request.method, requestSignal, undefined,
          { onStart() { streaming = true; lifetime.beginStream(); }, ...(onProgress ? { onProgress } : {}) }); }
        catch (error) {
          if (streaming && timeout.aborted && !signal?.aborted)
            throw new WorkflowResponseError("The streamed request timed out. Check the completed request before retrying.", { ...metadata, body: null });
          if (error instanceof WorkflowBodyError && error.code !== "CANCELLED")
            throw new WorkflowResponseError(error.message, { ...metadata, body: null });
          throw requestFailure(signal, timeout, "The response could not be read. Check the completed request before retrying.");
        }
        const { malformedJson, ...result } = parsed;
        if (malformedJson) throw new WorkflowResponseError("The endpoint did not return valid JSON. Check its response before retrying.", { ...metadata, ...result });
        if (!response.ok) throw new WorkflowResponseError(
          `The endpoint returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the request and retry.`,
          { ...metadata, ...result });
        return { request, response: { ...metadata, ...result } };
      } finally { lifetime.dispose(); }
    }
  };
}

/** Every registered schema sends requests to the operation's effective server. */
export function createWorkflowExecution(credentialExecution: CredentialWorkflowExecutor = executeVaultOperation): WorkflowExecutor
{
  const anonymous = createWorkflowRequestExecution();
  return {
    async execute(operation, values, signal, context, onProgress) {
      const canonical = operationForId(operation.id);
      if (operation.deferred || !canonical || canonical.method !== operation.method || canonical.path !== operation.path)
        throw new Error("This operation is not available in the registered schemas.");
      const invocation = context ? validateCredentialContext(context) : undefined;
      const hasVariables = invocation?.variables !== undefined;
      if (invocation?.binding.connection && !canonical.security?.length) throw new VaultError("PERMISSION");
      if (!canonical.security?.length && !hasVariables) return anonymous.execute(operation, values, signal, undefined, onProgress);
      if (!invocation) throw new VaultError("PERMISSION");
      const submitted = { ...values };
      const { origin } = workflowExecutionForOperation(canonical);
      const descriptor = await approvedOperation(canonical, origin);
      if (operationForId(canonical.id) !== canonical || workflowExecutionForOperation(canonical).origin !== origin
        || invocation.binding.fingerprint !== descriptor.fingerprint) throw new VaultError("PERMISSION");
      if (!canonical.security?.length) {
        if (invocation.binding.alternative !== 0 || Object.keys(invocation.binding.credentials).length) throw new VaultError("PERMISSION");
        return credentialExecution(descriptor, submitted, invocation, signal, onProgress);
      }
      const alternative = canonical.security[invocation.binding.alternative];
      if (!supportedSecurityAlternative(alternative)) throw new VaultError("PERMISSION");
      if (invocation.binding.connection) {
        if (!alternative.length) throw new VaultError("PERMISSION");
        return credentialExecution(descriptor, submitted, invocation, signal, onProgress);
      }
      if (!alternative.length) return hasVariables ? credentialExecution(descriptor, submitted, invocation, signal, onProgress) : anonymous.execute(operation, submitted, signal, invocation, onProgress);
      if (Object.keys(invocation.binding.credentials).length !== alternative.length
        || alternative.some(scheme => !Object.hasOwn(invocation.binding.credentials, scheme.name)
          || (scheme.kind === "basic" ? !isBasicCredentialReference(invocation.binding.credentials[scheme.name])
            : typeof invocation.binding.credentials[scheme.name] !== "string"))) throw new VaultError("PERMISSION");
      return credentialExecution(descriptor, submitted, invocation, signal, onProgress);
    }
  };
}
