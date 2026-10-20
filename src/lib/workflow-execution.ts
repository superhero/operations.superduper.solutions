// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { requestBody } from "./request-body.ts";
import { operationForId, operationOrigin, type Operation } from "./catalog.ts";
import { catalogForOperation } from "./catalog-registry.ts";
import { prepareRequest, type InputValues, type PreparedRequest } from "./operation-input.ts";
import { operationServerUrl } from "./schema-documents.ts";
import { serverUrlHasPlaceholder } from "./server-url.ts";
import { VaultError, type ApprovedOperation, type CredentialExecutionContext } from "./secrets/types.ts";
import { approvedOperation } from "./secrets/policy.ts";
import { validateCredentialContext } from "./secrets/bindings.ts";
import { executeVaultOperation } from "./secrets/vault-executor.ts";

export type WorkflowResponse = { status: number; statusText: string; headers: Record<string, string>; body: unknown; redacted?: boolean };
export type WorkflowExecutionResult = { request: PreparedRequest; response: WorkflowResponse };
export type WorkflowExecutor = {
  execute(operation: Operation, values: InputValues, signal?: AbortSignal, context?: CredentialExecutionContext): WorkflowExecutionResult | Promise<WorkflowExecutionResult>;
};
export type CredentialWorkflowExecutor = (descriptor: ApprovedOperation, values: InputValues,
  context: CredentialExecutionContext, signal?: AbortSignal) => Promise<WorkflowExecutionResult>;

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
    async execute(operation, values, signal, context)
    {
      const canonical = operationForId(operation.id);
      if (operation.deferred || !canonical || canonical.method !== operation.method || canonical.path !== operation.path)
        throw new Error("This operation is not available in the registered schemas.");
      if (context?.variables !== undefined) throw new VaultError("PERMISSION");
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
      const url = workflowRequestUrl(request, origin);
      if (request.method === "TRACE") throw new Error("Browsers do not permit TRACE requests.");
      const timeout = AbortSignal.timeout(15_000);
      let response: Response;
      const headers: Record<string, string> = { Accept: canonical.responseMediaType ?? "application/json", ...request.headers };
      if (request.body !== undefined && request.contentType !== "multipart/form-data")
        headers["Content-Type"] = request.contentType ?? "application/json";
      try
      {
        response = await fetchRequest(url, {
          method: request.method, redirect: "error", credentials: "omit", headers, body: requestBody(request),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
      }
      catch
      {
        throw requestFailure(signal, timeout, `The request could not reach ${origin}. Check connectivity and whether the endpoint allows browser requests, then retry.`);
      }
      const metadata = { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers) };
      let body: unknown = null;
      if (request.method !== "HEAD" && response.status !== 204 && response.status !== 205)
      {
        let text: string;
        try { text = await response.text(); }
        catch { throw requestFailure(signal, timeout, "The response could not be read. Check connectivity and retry."); }
        if (text || request.method !== "OPTIONS")
        {
          const mediaType = response.ok
            ? canonical.responseMediaType ?? response.headers.get("Content-Type") ?? "application/json"
            : response.headers.get("Content-Type") ?? "text/plain";
          if (/\bjson\b/i.test(mediaType))
          {
            try { body = JSON.parse(text); }
            catch
            {
              if (response.ok) throw new WorkflowResponseError("The endpoint did not return valid JSON. Check its response and retry.",
                { ...metadata, body: text });
              body = text;
            }
          }
          else body = text;
        }
      }
      if (!response.ok) throw new WorkflowResponseError(
        `The endpoint returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the request and retry.`,
        { ...metadata, body });
      return { request, response: { ...metadata, body } };
    }
  };
}

/** Every registered schema sends requests to the operation's effective server. */
export function createWorkflowExecution(credentialExecution: CredentialWorkflowExecutor = executeVaultOperation): WorkflowExecutor
{
  const anonymous = createWorkflowRequestExecution();
  return {
    async execute(operation, values, signal, context) {
      const canonical = operationForId(operation.id);
      if (operation.deferred || !canonical || canonical.method !== operation.method || canonical.path !== operation.path)
        throw new Error("This operation is not available in the registered schemas.");
      const invocation = context ? validateCredentialContext(context) : undefined;
      const hasVariables = invocation?.variables !== undefined;
      if (!canonical.security?.length && !hasVariables) return anonymous.execute(operation, values, signal);
      if (!invocation) throw new VaultError("PERMISSION");
      const submitted = { ...values };
      const { origin } = workflowExecutionForOperation(canonical);
      const descriptor = await approvedOperation(canonical, origin);
      if (operationForId(canonical.id) !== canonical || workflowExecutionForOperation(canonical).origin !== origin
        || invocation.binding.fingerprint !== descriptor.fingerprint) throw new VaultError("PERMISSION");
      if (!canonical.security?.length) {
        if (invocation.binding.alternative !== 0 || Object.keys(invocation.binding.credentials).length) throw new VaultError("PERMISSION");
        return credentialExecution(descriptor, submitted, invocation, signal);
      }
      const alternative = canonical.security[invocation.binding.alternative];
      if (!alternative) throw new VaultError("PERMISSION");
      if (!alternative.length) return hasVariables ? credentialExecution(descriptor, submitted, invocation, signal) : anonymous.execute(operation, submitted, signal, invocation);
      if (Object.keys(invocation.binding.credentials).length !== alternative.length
        || alternative.some(scheme => !Object.hasOwn(invocation.binding.credentials, scheme.name))) throw new VaultError("PERMISSION");
      return credentialExecution(descriptor, submitted, invocation, signal);
    }
  };
}
