// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readWorkflowResponseBody, binaryContainsSecret, WorkflowBodyError } from "../workflow-response-body.ts";
import { validateWorkflowBinary } from "../workflow-binary.ts";
import { requestBody } from "../request-body.ts";
import { supportedSecurityAlternative } from "../operation-security.ts";
import { credentialSelectionForVariables, isBasicCredentialReference, isOAuth1CredentialReference, oauth1CredentialParts } from "./bindings.ts";
import { additionalBodyField, InputValidationError, prepareRequest, type InputValues, type PreparedRequest } from "../operation-input.ts";
import type { WorkflowExecutionResult, WorkflowResponse } from "../workflow-execution.ts";
import { validateVaultVariableInputs, vaultVariablePlaceholder, type VaultVariableInput } from "./variables.ts";
import { resolvePrivateExpression } from "./processing.ts";
import { validateApprovedOperation, validateCredentialPath } from "./policy.ts";
import { VaultError, vaultLimits, type ApprovedOperation, type CredentialBinding, type VaultCredential } from "./types.ts";
import { workflowResponseLifetime, responseAccept, type ResponseProgressCallback } from "../workflow-response-stream.ts";
import { resolveHttpConnection, formatHttpToken } from "./http-connections.ts";
import { telegramPrivateUrl, privateUrlRedactions } from "./telegram-path.ts";
import { managedGitlabSecrets, validateGitlabTokenState } from "./gitlab-oauth.ts";
import { appendRequestQuery, encodeQueryComponent } from "../query-serialization.ts";
import { CloudflareUploadSessions, type CloudflareUploadLease } from "./cloudflare-upload.ts";
import { cloudflareSessionField, uploadSessionConsumer } from "../cloudflare-upload.ts";
import { signOAuth1, type OAuth1Values, type OAuth1Clock } from "./oauth1.ts";
import { signAwsRequest, type AwsSigningValues } from "./aws-sigv4.ts";
import { awsCredentialParts, isAwsCredentialReference } from "./bindings.ts";
import { awsSigningHeaders, lambdaSigningRegion } from "../aws-signing.ts";
import { awsWireEndpoint } from "../aws-wire.ts";
import { s3SigningEndpoint, s3ObjectUrl } from "../s3-files.ts";
import { s3PayloadChecksum, verifyS3Object } from "./s3-files.ts";

export type CredentialResponse = WorkflowResponse & { redacted?: boolean };
export type CredentialExecutionResult = WorkflowExecutionResult & { response: CredentialResponse };
export type CredentialExecutionOptions = {
  signal?: AbortSignal;
  variables?: VaultVariableInput[];
  assertCurrent: () => void | Promise<void>;
  fetchRequest?: typeof fetch;
  onProgress?: ResponseProgressCallback;
  oauth1Clock?: OAuth1Clock;
  uploadSessions?: CloudflareUploadSessions;
  privateSecrets?: readonly string[];
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

export function redactor(secrets: string[])
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

/** Secrets are selected and injected only here; callers receive a separate scrubbed preview. */
export async function executeCredentialed(descriptor: ApprovedOperation, values: InputValues, binding: CredentialBinding,
  credentials: readonly VaultCredential[], options: CredentialExecutionOptions): Promise<CredentialExecutionResult>
{
  let secrets: string[] = [];
  let phase: "policy" | "request" = "policy";
  let s3Upload = false, responseStatus: number | undefined;
  const lifetime = workflowResponseLifetime(options.signal), timeout = lifetime.timeout, signal = lifetime.signal;
  let streaming = false, streamStatus = 0;
  let uploadLease: CloudflareUploadLease | undefined, privateUpload = false, uploadSucceeded = false;
  try
  {
    const credentialSnapshot = structuredClone(credentials);
    let bindingSnapshot = structuredClone(binding);
    const inputSnapshot = structuredClone(values);
    if (!inputSnapshot || typeof inputSnapshot !== "object" || Array.isArray(inputSnapshot)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(inputSnapshot))
      || Object.values(inputSnapshot).some(value => value !== null && value !== undefined && typeof value !== "string"))
      throw new VaultError("INVALID");
    secrets = [...new Set([...credentialSnapshot.flatMap(credential => typeof credential.value === "string" ? [credential.value, ...managedGitlabSecrets(credential.oauthState ?? "")] : []), ...(options.privateSecrets ?? [])]
      .filter(value => typeof value === "string" && value.length > 0)
      .flatMap(value => [value, encodeURIComponent(value), encodeQueryComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))]
      .sort((a, b) => b.length - a.length);
    const approved = await validateApprovedOperation(descriptor);
    s3Upload = approved.operation.s3Files === "put-object";
    privateUpload = !!approved.operation.cloudflareUpload;
    if (privateUpload && !options.uploadSessions) throw new VaultError("PERMISSION");
    const savedConnection = !!bindingSnapshot.connection;
    if (approved.operation.privatePath && !savedConnection) throw new VaultError("PERMISSION");
    const connection = await resolveHttpConnection(approved, bindingSnapshot, credentialSnapshot);
    bindingSnapshot = connection.binding;
    const variables = options.variables === undefined ? [] : validateVaultVariableInputs(options.variables);
    const alternative = approved.operation.security?.length ? approved.operation.security[bindingSnapshot.alternative]
      : variables.length && bindingSnapshot.alternative === 0 ? [] : undefined;
    if (bindingSnapshot.fingerprint !== approved.fingerprint || !Number.isInteger(bindingSnapshot.alternative)
      || !supportedSecurityAlternative(alternative) || !alternative.length && !variables.length || !bindingSnapshot.credentials || Object.keys(bindingSnapshot.credentials).length !== alternative.length)
      throw new VaultError("PERMISSION");
    const injected = new Headers();
    const injectedQueries = new Map<string, string>();
    let pathToken: string | undefined;
    let oauth1: OAuth1Values | undefined, uploadReference: string | undefined;
    let managed: { expiresAt: number; accountId: string } | undefined;
    let aws: AwsSigningValues | undefined, awsSignedAt: number | undefined;
    const credentialValue = (id: string, kind: "bearer" | "basic" | "apiKey" | "oauth1" | "aws-sigv4", connectedHeader = false): string => {
      const matches = credentialSnapshot.filter(credential => credential.id === id);
      if (matches.length !== 1) throw new VaultError("PERMISSION");
      const credential = matches[0]!;
      if (!["secret", "bearer", "apiKey"].includes(credential.kind)
        || !connectedHeader && !["basic", "oauth1", "aws-sigv4"].includes(kind) && credential.kind !== "secret" && credential.kind !== kind) throw new VaultError("PERMISSION");
      if (typeof credential.value !== "string" || !credential.value.length || credential.value !== credential.value.trim()
        || /[^\u0020-\u007e]/.test(credential.value) || new TextEncoder().encode(credential.value).byteLength > vaultLimits.secretBytes)
        throw new VaultError("INVALID");
      return credential.value;
    };
    for (const scheme of alternative)
    {
      const reference = Object.hasOwn(bindingSnapshot.credentials, scheme.name) ? bindingSnapshot.credentials[scheme.name] : undefined;
      if (scheme.kind === "cloudflare-upload") {
        if (typeof reference !== "string" || !uploadSessionConsumer(approved.operation.cloudflareUpload) || alternative.length !== 1) throw new VaultError("PERMISSION");
        uploadReference = reference;
        const supplied = inputSnapshot[cloudflareSessionField];
        if (supplied !== undefined && supplied !== reference) throw new VaultError("PERMISSION");
        delete inputSnapshot[cloudflareSessionField];
      } else if (scheme.kind === "aws-sigv4") {
        if (!isAwsCredentialReference(reference) || alternative.length !== 1
          || !(approved.operation.awsWire ? awsWireEndpoint(approved.origin, approved.operation.awsWire) : approved.operation.s3Files ? s3SigningEndpoint(approved.origin) : lambdaSigningRegion(approved.origin))) throw new VaultError("PERMISSION");
        aws = Object.fromEntries(awsCredentialParts.flatMap(part => reference[part] ? [[part, credentialValue(reference[part]!, "aws-sigv4")]] : [])) as AwsSigningValues;
      } else if (scheme.kind === "oauth1") {
        if (!isOAuth1CredentialReference(reference) || scheme.profile !== "x-hmac-sha1" || alternative.length !== 1
          || approved.origin !== "https://api.x.com" || !approved.operation.path.startsWith("/2/")) throw new VaultError("PERMISSION");
        oauth1 = Object.fromEntries(oauth1CredentialParts.map(part => [part, credentialValue(reference[part], "oauth1")])) as OAuth1Values;
      } else if (scheme.kind === "basic") {
        if (!isBasicCredentialReference(reference)) throw new VaultError("PERMISSION");
        const username = credentialValue(reference.username, "basic"), password = credentialValue(reference.password, "basic");
        if (username.includes(":")) throw new VaultError("INVALID");
        const joined = `${username}:${password}`, encoded = btoa(joined), authorization = `Basic ${encoded}`;
        if (encoded.length > vaultLimits.secretBytes) throw new VaultError("LIMIT");
        secrets.push(joined, encoded, authorization);
        injected.set(scheme.header, authorization);
      } else {
        if (typeof reference !== "string") throw new VaultError("PERMISSION");
        const connected = credentialSelectionForVariables([[scheme]], variables);
        let value = credentialValue(reference, scheme.kind, connected?.credentials[scheme.name] === reference);
        if (connection.format === "gitlab-oauth") {
          if (scheme.kind !== "bearer" || connection.oauth?.profile !== "gitlab-public-pkce-v1") throw new VaultError("PERMISSION");
          const state = validateGitlabTokenState(credentialSnapshot.find(item => item.id === reference)?.oauthState ?? "", connection.oauth);
          managed = { expiresAt: state.expiresAt, accountId: state.oauth.accountId };
          if (state.refreshPending || managed.expiresAt <= Date.now()) throw new VaultError("AUTHORIZATION");
          value = state.accessToken;
        }
        if (scheme.path !== undefined) {
          if (scheme.path !== approved.operation.privatePath || !savedConnection) throw new VaultError("PERMISSION");
          pathToken = value;
          secrets.push(...privateUrlRedactions(value));
        }
        else if (scheme.query !== undefined) injectedQueries.set(scheme.query, value);
        else {
          const formatted = scheme.kind === "bearer" ? `Bearer ${value}` : formatHttpToken(connection.format, value);
          if (formatted !== value) secrets.push(formatted);
          injected.set(scheme.header!, formatted);
        }
      }
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
        // Keep existing private header edges after an auth metadata correction.
        // A public value or a different private value still cannot override auth.
        if (field.location === "header" && injected.has(field.name)) {
          if (resolved !== injected.get(field.name)) throw new VaultError("PERMISSION");
          delete inputSnapshot[variable.key];
          continue;
        }
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
    secrets = [...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), encodeQueryComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))].sort((a, b) => b.length - a.length);
    for (const [key, value] of structured) inputSnapshot[key] = JSON.stringify(value);
    let publicRequest = prepareRequest(approved.operation, inputSnapshot, fields);
    let request = publicRequest;
    if (privateUpload) {
      const prepared = options.uploadSessions!.authorize(approved, request, bindingSnapshot, uploadReference);
      request = prepared.request; uploadLease = prepared.lease;
      if (prepared.authorization) injected.set("Authorization", prepared.authorization);
      secrets.push(...prepared.secrets);
      secrets = [...new Set(secrets.flatMap(value => [value, encodeURIComponent(value), encodeQueryComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))].sort((a, b) => b.length - a.length);
    }
    if (!approved.operation.s3Files) validateCredentialPath(request.path);
    const url = approved.operation.s3Files ? s3ObjectUrl(approved.origin, request.path)
      : approved.operation.privatePath ? telegramPrivateUrl(approved, request.path, pathToken ?? "") : new URL(`${approved.origin}${request.path}`);
    if (approved.operation.s3Files) publicRequest = { ...publicRequest, path: url.pathname };
    if (approved.operation.privatePath) secrets.push(...privateUrlRedactions(url.href));
    const authQueries = new Set((approved.operation.security ?? []).flat().flatMap(scheme => scheme.query === undefined ? [] : [scheme.query]));
    if (Object.keys(request.query).some(key => authQueries.has(key))) throw new VaultError("PERMISSION");
    appendRequestQuery(url, request, injectedQueries);
    const headers = new Headers({ Accept: responseAccept(approved.operation.responseStream, approved.operation.responseMediaType, request.body) });
    const publicHeaders = new Set<string>();
    const authHeaders = new Set((approved.operation.security ?? []).flat().flatMap(scheme => scheme.header === undefined ? [] : [scheme.header.toLowerCase()]));
    for (const [name, value] of Object.entries(request.headers ?? {}))
    {
      const normalized = name.toLowerCase();
      if (publicHeaders.has(normalized) || authHeaders.has(normalized) || normalized === "authorization"
        || normalized === "proxy-authorization" || normalized === "cookie" || aws && awsSigningHeaders.has(normalized)) throw new VaultError("PERMISSION");
      publicHeaders.add(normalized);
      headers.set(name, value);
    }
    if (request.body !== undefined && request.contentType !== "multipart/form-data") headers.set("Content-Type", request.contentType ?? "application/json");
    for (const [name, value] of injected) headers.set(name, value);
    let body = requestBody(request);
    if (aws) {
      await options.assertCurrent(); if (signal.aborted) throw new VaultError("CANCELLED");
      if (s3Upload) headers.set("x-amz-checksum-sha256", await s3PayloadChecksum(body));
      else if (approved.operation.s3Files) headers.set("x-amz-checksum-mode", "ENABLED");
      const signed = await signAwsRequest(request.method, url.href, headers, body, aws, approved.operation.awsWire ? awsWireEndpoint(approved.origin, approved.operation.awsWire)! : approved.operation.s3Files
        ? { service: "s3", region: s3SigningEndpoint(approved.origin)!.region } : { service: "lambda", region: lambdaSigningRegion(approved.origin)! });
      for (const [name, value] of signed.headers) headers.set(name, value);
      body = signed.body ?? null; awsSignedAt = signed.signedAt;
      secrets = [...new Set([...secrets, ...signed.secrets].flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))]
        .sort((a, b) => b.length - a.length);
    }
    if (oauth1) {
      await options.assertCurrent();
      if (signal.aborted) throw new VaultError("CANCELLED");
      const signed = await signOAuth1(request.method, url.href, headers.get("Content-Type"), body, oauth1, options.oauth1Clock);
      headers.set("Authorization", signed.authorization);
      secrets = [...new Set([...secrets, ...signed.secrets].flatMap(value => [value, encodeURIComponent(value), encodeQueryComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))]
        .sort((a, b) => b.length - a.length);
    }
    const preview = redactor(secrets).value(publicRequest) as PreparedRequest;
    await options.assertCurrent();
    if (connection.expiresAt !== undefined && connection.expiresAt <= Date.now()) throw new VaultError("PERMISSION");
    if (signal.aborted) throw new VaultError("CANCELLED");
    if (privateUpload) options.uploadSessions!.assertCurrent(uploadLease);
    if (managed && managed.expiresAt <= Date.now()) throw new VaultError("AUTHORIZATION");
    if (awsSignedAt !== undefined && Math.abs(Date.now() - awsSignedAt) > 60000) throw new VaultError("PERMISSION");
    phase = "request";
    const response = await (options.fetchRequest ?? globalThis.fetch)(url.href, {
      method: request.method, body, headers, redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal,
    });
    responseStatus = response.status;
    if (response.redirected) throw new VaultError("NETWORK");
    const parsed = await readWorkflowResponseBody(response, approved.operation, request.method, signal, vaultLimits.responseBytes,
      { onStart() { streaming = true; streamStatus = response.status; lifetime.beginStream(); }, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
    const { malformedJson, ...result } = parsed;
    if (managed && (managed.expiresAt <= Date.now() || response.ok && (!result.body || typeof result.body !== "object"
      || Array.isArray(result.body) || String((result.body as Record<string, unknown>).id) !== managed.accountId))) throw new VaultError("AUTHORIZATION");
    if (approved.operation.s3Files && response.ok) {
      if (response.status !== 200) throw new VaultError("S3_INTEGRITY");
      await verifyS3Object(response.headers, s3Upload ? request.body : result.body);
    }
    if (privateUpload) {
      await options.assertCurrent();
      if (signal.aborted) throw new VaultError("CANCELLED");
      options.uploadSessions!.assertCurrent(uploadLease);
      if (malformedJson) throw new VaultError("NETWORK");
      const completed = options.uploadSessions!.finish(approved, publicRequest, bindingSnapshot, response.status, result.body, uploadLease);
      result.body = completed.body;
      secrets = [...new Set([...secrets, ...completed.secrets].flatMap(value => [value, encodeURIComponent(value), encodeQueryComponent(value), new URLSearchParams({ v: value }).toString().slice(2)]))]
        .sort((a, b) => b.length - a.length);
    }
    const scrub = redactor(secrets);
    const safeHeaders: [string, string][] = [];
    for (const [name, value] of response.headers)
    {
      if (privateUpload && name.toLowerCase() !== "content-type") continue;
      if (authHeaders.has(name.toLowerCase()) || /^(?:authorization|proxy-authorization|www-authenticate|proxy-authenticate|set-cookie2?|cookie)$/i.test(name))
        scrub.mark();
      else safeHeaders.push([scrub.text(name), scrub.text(value)]);
    }
    let safeBody = result.body;
    if (result.bodyType === "binary") {
      const file = validateWorkflowBinary(result.body);
      const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
      if (binaryContainsSecret(bytes, secrets) || secrets.some(secret => file.base64.includes(secret))
        || scrub.text(file.name) !== file.name || scrub.text(file.mediaType) !== file.mediaType) {
        safeBody = null;
        scrub.mark();
      }
      // Never redact inside a base64 file: either retain exact bytes or withhold it entirely.
    } else safeBody = scrub.value(safeBody);
    const safe: CredentialResponse = { ...result, status: response.status, statusText: privateUpload ? "" : scrub.text(response.statusText),
      headers: Object.fromEntries(safeHeaders), body: safeBody };
    if (safeBody === null) delete safe.bodyType;
    if (safe.mediaType) safe.mediaType = scrub.text(safe.mediaType);
    if (safe.transportMediaType) safe.transportMediaType = scrub.text(safe.transportMediaType);
    if (scrub.changed) safe.redacted = true;
    await options.assertCurrent();
    if (connection.expiresAt !== undefined && connection.expiresAt <= Date.now()) throw new VaultError("PERMISSION");
    if (signal.aborted) throw new VaultError("CANCELLED");
    if (managed && managed.expiresAt <= Date.now()) throw new VaultError("AUTHORIZATION");
    if (malformedJson) throw new CredentialResponseError("The endpoint did not return valid JSON. Check its response before retrying.", safe);
    if (!response.ok) throw new CredentialResponseError(`The endpoint returned HTTP ${response.status}. Check the request before retrying.`, safe);
    uploadSucceeded = true;
    return { request: preview, response: safe };
  }
  catch (error)
  {
    if (s3Upload && phase === "request" && (responseStatus === undefined || responseStatus >= 200 && responseStatus < 300)
      && !(error instanceof CredentialResponseError)) throw new VaultError("WRITE_UNCONFIRMED");
    if (options.signal?.aborted) throw new VaultError("CANCELLED");
    if (timeout.aborted) {
      if (streaming) throw new CredentialResponseError("The streamed request timed out. Check the completed request before retrying.",
        { status: streamStatus, statusText: "", headers: {}, body: null });
      throw new VaultError("NETWORK");
    }
    if (error instanceof CredentialResponseError) throw error;
    if (error instanceof InputValidationError)
    {
      const scrub = redactor(secrets);
      throw new InputValidationError(scrub.text(error.fieldKey), scrub.text(error.message).slice(0, vaultLimits.diagnosticBytes));
    }
    if (error instanceof WorkflowBodyError) {
      if (streaming && !["LIMIT", "CANCELLED", "MEDIA"].includes(error.code)) throw new CredentialResponseError(error.message,
        { status: streamStatus, statusText: "", headers: {}, body: null });
      throw new VaultError(error.code === "LIMIT" || error.code === "CANCELLED" ? error.code : "NETWORK");
    }
    if (error instanceof VaultError) throw new VaultError(error.code);
    throw new VaultError(phase === "policy" ? "PERMISSION" : "NETWORK");
  } finally { if (privateUpload && !uploadSucceeded) options.uploadSessions?.clear(); lifetime.dispose(); }
}
