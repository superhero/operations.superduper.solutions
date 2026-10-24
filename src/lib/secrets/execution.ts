// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { requestBody } from "../request-body.ts";
import { supportedSecurityAlternative } from "../operation-security.ts";
import { additionalBodyField, InputValidationError, prepareRequest, type InputValues, type PreparedRequest } from "../operation-input.ts";
import type { WorkflowExecutionResult, WorkflowResponse } from "../workflow-execution.ts";
import { validateVaultVariableInputs, vaultVariablePlaceholder, type VaultVariableInput } from "./variables.ts";
import { resolvePrivateExpression } from "./processing.ts";
import { validateApprovedOperation, validateCredentialPath } from "./policy.ts";
import { VaultError, vaultLimits, type ApprovedOperation, type CredentialBinding, type VaultCredential } from "./types.ts";

export type CredentialResponse = WorkflowResponse & { redacted?: boolean };
export type CredentialExecutionResult = WorkflowExecutionResult & { response: CredentialResponse };
export type CredentialExecutionOptions = {
  signal?: AbortSignal;
  variables?: VaultVariableInput[];
  assertCurrent: () => void | Promise<void>;
  fetchRequest?: typeof fetch;
};

/** This safe envelope has no raw request, native cause or credential-bearing message. */
export class CredentialResponseError extends Error
{
  readonly response: CredentialResponse;
  constructor(message: string, response: CredentialResponse)
  {
    super(message);
    this.name = "WorkflowResponseError";
    this.response = response;
  }
}

function redactor(secrets: string[])
{
  let changed = false;
  const text = (value: string): string =>
  {
    let result = value;
    // Removing rather than replacing also handles credentials equal to a marker.
    // Repeat because removing one value can join fragments of another value.
    let previous: string;
    do
    {
      previous = result;
      for (const secret of secrets) if (result.includes(secret)) { changed = true; result = result.split(secret).join(""); }
    } while (previous !== result);
    return result;
  };
  const value = (input: unknown): unknown =>
  {
    if (typeof input === "string") return text(input);
    if (Array.isArray(input)) return input.map(value);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, entry]) => [text(key), value(entry)]));
    return input;
  };
  return { text, value, get changed() { return changed; }, mark() { changed = true; } };
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string>
{
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new VaultError("CANCELLED")); });
  signal.addEventListener("abort", abort, { once: true });
  try
  {
    if (signal.aborted) abort();
    while (true)
    {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) return result + decoder.decode();
      size += value.byteLength;
      if (size > vaultLimits.responseBytes) throw new VaultError("LIMIT");
      result += decoder.decode(value, { stream: true });
    }
  }
  finally
  {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Secrets are selected and injected only here; callers receive a separate scrubbed preview. */
export async function executeCredentialed(descriptor: ApprovedOperation, values: InputValues, binding: CredentialBinding,
  credentials: readonly VaultCredential[], options: CredentialExecutionOptions): Promise<CredentialExecutionResult>
{
  let secrets: string[] = [];
  let phase: "policy" | "request" = "policy";
  const timeout = AbortSignal.timeout(15_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try
  {
    const credentialSnapshot = structuredClone(credentials);
    const bindingSnapshot = structuredClone(binding);
    const inputSnapshot = structuredClone(values);
    if (!inputSnapshot || typeof inputSnapshot !== "object" || Array.isArray(inputSnapshot)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(inputSnapshot))
      || Object.values(inputSnapshot).some(value => value !== null && value !== undefined && typeof value !== "string"))
      throw new VaultError("INVALID");
    secrets = [...new Set(credentialSnapshot.map(credential => credential.value)
      .filter(value => typeof value === "string" && value.length > 0)
      .flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))]
      .sort((a, b) => b.length - a.length);
    const approved = await validateApprovedOperation(descriptor);
    const variables = options.variables === undefined ? [] : validateVaultVariableInputs(options.variables);
    const alternative = approved.operation.security?.length ? approved.operation.security[bindingSnapshot.alternative]
      : variables.length && bindingSnapshot.alternative === 0 ? [] : undefined;
    if (bindingSnapshot.fingerprint !== approved.fingerprint || !Number.isInteger(bindingSnapshot.alternative)
      || !supportedSecurityAlternative(alternative) || !alternative.length && !variables.length || !bindingSnapshot.credentials || Object.keys(bindingSnapshot.credentials).length !== alternative.length)
      throw new VaultError("PERMISSION");
    const injected = new Headers();
    const injectedQueries = new Map<string, string>();
    for (const scheme of alternative)
    {
      const id = Object.hasOwn(bindingSnapshot.credentials, scheme.name) ? bindingSnapshot.credentials[scheme.name] : undefined;
      const matches = credentialSnapshot.filter(credential => credential.id === id);
      if (matches.length !== 1) throw new VaultError("PERMISSION");
      const credential = matches[0]!;
      if (credential.kind !== "secret" && credential.kind !== scheme.kind) throw new VaultError("PERMISSION");
      if (typeof credential.value !== "string" || !credential.value.length || credential.value !== credential.value.trim()
        || /[^\u0020-\u007e]/.test(credential.value) || new TextEncoder().encode(credential.value).byteLength > vaultLimits.secretBytes)
        throw new VaultError("INVALID");
      if (scheme.query !== undefined) injectedQueries.set(scheme.query, credential.value);
      else injected.set(scheme.header, scheme.kind === "bearer" ? `Bearer ${credential.value}` : credential.value);
    }
    // Replace only explicit, validated reference slots. Never interpolate secrets into
    // public strings, and never return these decrypted inputs to the page.
    const structured = new Map<string, unknown>();
    const fields = [...approved.operation.fields];
    for (const variable of variables) {
      const resolved = await resolvePrivateExpression(variable.expression ?? { kind: "credential", id: variable.credentialId! }, credentialSnapshot, secrets);
      let field = fields.find(item => item.key === variable.key);
      if (!field && variable.key.startsWith("body:")) {
        field = additionalBodyField(approved.operation, variable.key.slice(5), "string");
        if (field) fields.push(field);
      }
      if (!field || !Object.hasOwn(inputSnapshot, variable.key)) throw new VaultError("PERMISSION");
      if (!variable.path.length) {
        if (inputSnapshot[variable.key] !== vaultVariablePlaceholder) throw new VaultError("INVALID");
        if (variable.credentialId && field.type !== "string") throw new VaultError("INVALID");
        inputSnapshot[variable.key] = resolved === null ? null : typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
      } else {
        if (!["object", "array"].includes(field.type)) throw new VaultError("INVALID");
        if (!structured.has(variable.key)) {
          try { structured.set(variable.key, JSON.parse(inputSnapshot[variable.key] as string)); }
          catch { throw new VaultError("INVALID"); }
        }
        let parent = structured.get(variable.key);
        for (const segment of variable.path.slice(0, -1)) {
          if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, segment)) throw new VaultError("INVALID");
          parent = (parent as Record<string, unknown>)[segment];
        }
        const last = variable.path.at(-1)!;
        if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, last) || (parent as Record<string, unknown>)[last] !== vaultVariablePlaceholder)
          throw new VaultError("INVALID");
        Object.defineProperty(parent, last, { value: resolved, enumerable: true, writable: true, configurable: true });
      }
    }
    secrets = [...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))].sort((a, b) => b.length - a.length);
    for (const [key, value] of structured) inputSnapshot[key] = JSON.stringify(value);
    const request = prepareRequest(approved.operation, inputSnapshot, fields);
    validateCredentialPath(request.path);
    const url = new URL(`${approved.origin}${request.path}`);
    const authQueries = new Set((approved.operation.security ?? []).flat().flatMap(scheme => scheme.query === undefined ? [] : [scheme.query]));
    for (const [key, value] of Object.entries(request.query))
    {
      if (authQueries.has(key)) throw new VaultError("PERMISSION");
      for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(entry));
    }
    for (const [name, value] of injectedQueries) url.searchParams.set(name, value);
    const headers = new Headers({ Accept: approved.operation.responseMediaType ?? "application/json" });
    const publicHeaders = new Set<string>();
    const authHeaders = new Set((approved.operation.security ?? []).flat().flatMap(scheme => scheme.header === undefined ? [] : [scheme.header.toLowerCase()]));
    for (const [name, value] of Object.entries(request.headers ?? {}))
    {
      const normalized = name.toLowerCase();
      if (publicHeaders.has(normalized) || authHeaders.has(normalized) || normalized === "authorization"
        || normalized === "proxy-authorization" || normalized === "cookie") throw new VaultError("PERMISSION");
      publicHeaders.add(normalized);
      headers.set(name, value);
    }
    if (request.body !== undefined && request.contentType !== "multipart/form-data") headers.set("Content-Type", request.contentType ?? "application/json");
    for (const [name, value] of injected) headers.set(name, value);
    const preview = redactor(secrets).value(request) as PreparedRequest;
    const body = requestBody(request);
    await options.assertCurrent();
    if (signal.aborted) throw new VaultError("CANCELLED");
    phase = "request";
    const response = await (options.fetchRequest ?? globalThis.fetch)(url.href, {
      method: request.method, body, headers, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal,
    });
    if (response.redirected) throw new VaultError("NETWORK");
    let text = "";
    let responseBody: unknown = null;
    let malformedJson = false;
    if (request.method !== "HEAD" && response.status !== 204 && response.status !== 205)
    {
      text = await readBounded(response, signal);
      if (text || request.method !== "OPTIONS")
      {
        const media = response.ok ? approved.operation.responseMediaType ?? response.headers.get("Content-Type") ?? "application/json"
          : response.headers.get("Content-Type") ?? "text/plain";
        if (/\bjson\b/i.test(media))
        {
          try { responseBody = JSON.parse(text); }
          catch { responseBody = text; malformedJson = response.ok; }
        }
        else responseBody = text;
      }
    }
    const scrub = redactor(secrets);
    const safeHeaders: [string, string][] = [];
    for (const [name, value] of response.headers)
    {
      if (authHeaders.has(name.toLowerCase()) || /^(?:authorization|proxy-authorization|www-authenticate|proxy-authenticate|set-cookie2?|cookie)$/i.test(name))
        scrub.mark();
      else safeHeaders.push([scrub.text(name), scrub.text(value)]);
    }
    const safe: CredentialResponse = { status: response.status, statusText: scrub.text(response.statusText),
      headers: Object.fromEntries(safeHeaders), body: scrub.value(responseBody) };
    if (scrub.changed) safe.redacted = true;
    await options.assertCurrent();
    if (signal.aborted) throw new VaultError("CANCELLED");
    if (malformedJson) throw new CredentialResponseError("The endpoint did not return valid JSON. Check its response before retrying.", safe);
    if (!response.ok) throw new CredentialResponseError(`The endpoint returned HTTP ${response.status}. Check the request before retrying.`, safe);
    return { request: preview, response: safe };
  }
  catch (error)
  {
    if (options.signal?.aborted) throw new VaultError("CANCELLED");
    if (timeout.aborted) throw new VaultError("NETWORK");
    if (error instanceof CredentialResponseError) throw error;
    if (error instanceof InputValidationError)
    {
      const scrub = redactor(secrets);
      throw new InputValidationError(scrub.text(error.fieldKey), scrub.text(error.message).slice(0, vaultLimits.diagnosticBytes));
    }
    if (error instanceof VaultError) throw new VaultError(error.code);
    throw new VaultError(phase === "policy" ? "PERMISSION" : "NETWORK");
  }
}
