// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { operations, type Operation } from "./catalog.ts";
import { catalogForOperation } from "./catalog-registry.ts";
import { prepareRequest, type PreparedRequest } from "./operation-input.ts";

export type WorkflowResponse = { status: number; body: unknown };
export type WorkflowExecutionResult = { request: PreparedRequest; response: WorkflowResponse };
export type WorkflowExecutor = {
  execute(operation: Operation, values: Record<string, string>, signal?: AbortSignal): WorkflowExecutionResult | Promise<WorkflowExecutionResult>;
};

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
  const catalog = catalogForOperation(typeof operation === "string" ? operation : operation.id);
  if (!catalog) throw new Error("This operation is not available in the bundled test catalog.");
  return catalog.execution;
}

export function workflowRequestUrl(request: PreparedRequest, origin: string): string
{
  const url = new URL(request.path, origin);
  for (const [key, value] of Object.entries(request.query))
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  return url.href;
}

function requestBody(request: PreparedRequest): BodyInit | null
{
  if (request.body === undefined) return null;
  if (request.contentType === "text/plain") return String(request.body);
  if (request.contentType === "application/x-www-form-urlencoded") return new URLSearchParams(request.body as Record<string, string>);
  if (request.contentType === "multipart/form-data")
  {
    const form = new FormData();
    for (const [key, value] of Object.entries(request.body as Record<string, string>)) form.append(key, value);
    return form;
  }
  return JSON.stringify(request.body);
}

function requestFailure(signal: AbortSignal | undefined, timeout: AbortSignal, message: string): Error
{
  if (signal?.aborted) return new Error("The request was cancelled.");
  if (timeout.aborted) return new Error("The request timed out. Retry the operation when the test endpoint is available.");
  return new Error(message);
}

/** Explicit HTTP executor, also injectable when testing request/response handling. */
export function createWorkflowRequestExecution(fetchRequest: typeof fetch = globalThis.fetch): WorkflowExecutor
{
  return {
    async execute(operation, values, signal)
    {
      const canonical = operations.find(item => item.id === operation.id);
      if (!canonical || canonical.method !== operation.method || canonical.path !== operation.path)
        throw new Error("This operation is not available in the bundled test catalog.");
      const request = prepareRequest(canonical, values);
      const { origin } = workflowExecutionForOperation(canonical);
      if (request.method === "TRACE") throw new Error("Browsers do not permit TRACE requests.");
      const timeout = AbortSignal.timeout(15_000);
      let response: Response;
      const headers: Record<string, string> = { Accept: canonical.responseMediaType ?? "application/json", ...request.headers };
      if (request.body !== undefined && request.contentType !== "multipart/form-data")
        headers["Content-Type"] = request.contentType ?? "application/json";
      try
      {
        response = await fetchRequest(workflowRequestUrl(request, origin), {
          method: request.method, redirect: "error", credentials: "omit", headers, body: requestBody(request),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });
      }
      catch
      {
        throw requestFailure(signal, timeout, `The test request could not reach ${origin}. Check connectivity and whether the endpoint allows browser requests, then retry.`);
      }
      let body: unknown = null;
      if (request.method !== "HEAD" && response.status !== 204 && response.status !== 205)
      {
        let text: string;
        try { text = await response.text(); }
        catch { throw requestFailure(signal, timeout, "The test response could not be read. Check connectivity and retry."); }
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
              if (response.ok) throw new WorkflowResponseError("The test endpoint did not return valid JSON. Check its response and retry.",
                { status: response.status, body: text });
              body = text;
            }
          }
          else body = text;
        }
      }
      if (!response.ok) throw new WorkflowResponseError(
        `The test endpoint returned ${response.status}${response.statusText ? ` ${response.statusText}` : ""}. Check the request and retry.`,
        { status: response.status, body });
      return { request, response: { status: response.status, body } };
    }
  };
}

/** Every registered catalog sends requests to its declared origin. */
export function createWorkflowExecution(): WorkflowExecutor
{
  return createWorkflowRequestExecution();
}
