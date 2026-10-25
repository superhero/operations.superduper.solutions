// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { telegramPrivateEndpoint, telegramPathSecurity } from "./server-url.ts";

export type OperationSecurityScheme =
  | { name: string; kind: "cloudflare-upload"; header: "Authorization"; profile: "workers" | "pages"; query?: never; path?: never }
  | { name: string; kind: "oauth1"; header: "Authorization"; profile: "x-hmac-sha1"; query?: never; path?: never }
  | { name: string; kind: "bearer" | "basic" | "apiKey"; header: string; query?: never; path?: never }
  | { name: string; kind: "apiKey"; query: string; header?: never; path?: never }
  | { name: string; kind: "apiKey"; path: "telegram-bot"; header?: never; query?: never };
export type UnavailableSecurityScheme = { name: string; kind: "unsupported"; reason: string } &
  ({ header: string; query?: never; path?: never } | { query: string; header?: never; path?: never });
export type OperationSecurityRequirement = OperationSecurityScheme | UnavailableSecurityScheme;
/** Alternatives retain source positions. Every member is required (AND), including unavailable members. */
export type OperationSecurity = OperationSecurityRequirement[][];
export function supportedSecurityAlternative(value: unknown): value is OperationSecurityScheme[] {
  return Array.isArray(value) && value.every(scheme => scheme && ["bearer", "basic", "apiKey", "oauth1", "cloudflare-upload"].includes(scheme.kind));
}
/** Permission metadata is aligned with the security alternatives, not OAuth flows. */
export type CredentialPermissions = Record<string, string[]>[];

type ObjectValue = Record<string, unknown>;
const invalidHeaderName = /[^!#$%&'*+.^_`|~0-9A-Za-z-]/;
// Fetch-controlled headers cannot carry credentials. Media types belong to the
// request serializer; method overrides must not change an approved operation.
const unavailableHeaders = new Set([
  "accept", "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method",
  "connection", "content-length", "content-type", "cookie", "cookie2", "date", "dnt", "expect", "host", "keep-alive",
  "origin", "referer", "set-cookie", "te", "trailer", "transfer-encoding", "upgrade", "via",
  "x-http-method", "x-http-method-override", "x-method-override",
]);

function object(value: unknown, context: string): ObjectValue
{
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context}: expected an object.`);
  return value as ObjectValue;
}

function resolve(value: unknown, document: ObjectValue, context: string): ObjectValue
{
  let result = object(value, context);
  const seen = new Set<string>();
  while (Object.hasOwn(result, "$ref"))
  {
    const reference = result.$ref;
    if (typeof reference !== "string" || !reference.startsWith("#/") || Object.keys(result).length !== 1)
      throw new Error(`${context}: references must be local JSON pointers without sibling fields.`);
    let pointer: string;
    try { pointer = decodeURIComponent(reference.slice(1)); }
    catch { throw new Error(`${context}: malformed security scheme reference.`); }
    if (seen.has(pointer) || /~(?:[^01]|$)/.test(pointer))
      throw new Error(`${context}: cyclic or malformed security scheme reference.`);
    seen.add(pointer);
    let target: unknown = document;
    for (const part of pointer.slice(1).split("/"))
    {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      const parent = object(target, `${context}: reference target`);
      target = Object.hasOwn(parent, key) ? parent[key] : undefined;
    }
    result = object(target, `${context}: reference target`);
  }
  return result;
}

function scheme(document: ObjectValue, name: string, allowUnsupported: boolean): OperationSecurityRequirement
{
  const context = `Security scheme ${JSON.stringify(name)}`;
  if (!name.trim()) throw new Error("Security requirement names must be nonempty strings.");
  const components = document.components === undefined ? {} : object(document.components, "components");
  const schemes = components.securitySchemes === undefined ? {} : object(components.securitySchemes, "securitySchemes");
  if (!Object.hasOwn(schemes, name)) throw new Error(`${context}: unsupported security requirement without a declared scheme.`);
  const definition = resolve(schemes[name], document, context);
  let result: OperationSecurityRequirement;
  let keys: string[];
  if (definition.type === "http")
  {
    if (typeof definition.scheme !== "string" || !definition.scheme || invalidHeaderName.test(definition.scheme))
      throw new Error(`${context}: only HTTP bearer and Basic authentication are supported.`);
    const kind = definition.scheme.toLowerCase();
    result = kind === "bearer" && ["workers", "pages"].includes(String(definition["x-operations-cloudflare-upload-token"]))
      ? { name, kind: "cloudflare-upload", header: "Authorization", profile: definition["x-operations-cloudflare-upload-token"] as "workers" | "pages" }
      : kind === "oauth" && definition["x-operations-oauth1"] === "x-hmac-sha1"
      ? { name, kind: "oauth1", header: "Authorization", profile: "x-hmac-sha1" }
      : kind === "bearer" || kind === "basic" ? { name, kind, header: "Authorization" }
      : { name, kind: "unsupported", header: "Authorization", reason: `${context}: only HTTP bearer and Basic authentication are supported.` };
    keys = ["type", "scheme", "description", "bearerFormat"];
    if (definition.bearerFormat !== undefined && typeof definition.bearerFormat !== "string")
      throw new Error(`${context}: bearerFormat must be a string.`);
  }
  else if (definition.type === "apiKey")
  {
    if (definition.in === "query")
    {
      const query = definition.name;
      if (typeof query !== "string" || !query || /[^A-Za-z0-9_.~-]/.test(query))
        throw new Error(`${context}: invalid credential query parameter name.`);
      result = { name, kind: "apiKey", query };
    }
    else
    {
      if (definition.in !== "header") throw new Error(`${context}: only header and query API keys are supported.`);
      const header = definition.name;
      if (typeof header !== "string" || !header || invalidHeaderName.test(header)) throw new Error(`${context}: invalid credential header name.`);
      const normalized = header.toLowerCase();
      if (unavailableHeaders.has(normalized) || normalized.startsWith("proxy-") || normalized.startsWith("sec-"))
        throw new Error(`${context}: unsupported credential header ${JSON.stringify(header)}.`);
      result = { name, kind: "apiKey", header };
    }
    keys = ["type", "in", "name", "description"];
  }
  else throw new Error(`${context}: only HTTP bearer, Basic and header or query API key security schemes are supported.`);
  if (definition.description !== undefined && typeof definition.description !== "string")
    throw new Error(`${context}: description must be a string.`);
  if (Object.keys(definition).some(key => !keys.includes(key) && !key.startsWith("x-")))
    throw new Error(`${context}: unsupported security scheme fields.`);
  if (definition["x-amazon-apigateway-authtype"] === "awsSigv4")
    result = { ...result, kind: "unsupported", reason: "This API requires AWS Signature Version 4 request signing, which is not supported here." };
  if (result.kind === "unsupported" && !allowUnsupported) throw new Error(result.reason);
  return result;
}

function operationSecurity(document: ObjectValue, operation: ObjectValue, allowUnsupported: boolean): OperationSecurity | undefined
{
  if (telegramPrivateEndpoint(document, operation)) return telegramPathSecurity();
  const declaration = operation.security === undefined ? document.security : operation.security;
  if (declaration === undefined) return undefined;
  if (!Array.isArray(declaration)) throw new Error("Security requirements must be an array.");
  return declaration.map((value, index) =>
  {
    const requirement = object(value, `Security alternative ${index + 1}`);
    const headers = new Set<string>();
    const queries = new Set<string>();
    return Object.entries(requirement).map(([name, scopes]) =>
    {
      if (!Array.isArray(scopes) || scopes.length)
        throw new Error(`Security scheme ${JSON.stringify(name)}: only empty scope arrays are supported for bearer and API key requirements.`);
      const resolved = scheme(document, name, allowUnsupported);
      if (resolved.query !== undefined)
      {
        if (queries.has(resolved.query)) throw new Error(`Security alternative ${index + 1}: duplicate credential query parameter ${JSON.stringify(resolved.query)}.`);
        queries.add(resolved.query);
      }
      else
      {
        const header = resolved.header!.toLowerCase();
        if (headers.has(header)) throw new Error(`Security alternative ${index + 1}: duplicate credential header ${JSON.stringify(resolved.header)}.`);
        headers.add(header);
      }
      return resolved;
    });
  });
}

/** Strict import remains strict; capability inspection preserves unavailable HTTP choices in place. */
export function extractOperationSecurity(document: ObjectValue, operation: ObjectValue): OperationSecurityScheme[][] | undefined {
  return operationSecurity(document, operation, false) as OperationSecurityScheme[][] | undefined;
}
export function inspectOperationSecurity(document: ObjectValue, operation: ObjectValue): OperationSecurity | undefined {
  const security = inspectSecurityAlternatives(document, operation);
  if (security?.length && !security.some(supportedSecurityAlternative))
    throw new Error(security.flat().find(scheme => scheme.kind === "unsupported")!.reason);
  return security;
}

/** Preserve all well-formed choices for diagnostics, including all-unsupported declarations. */
export function inspectSecurityAlternatives(document: ObjectValue, operation: ObjectValue): OperationSecurity | undefined {
  return operationSecurity(document, operation, true);
}

/** Retain reviewed permission metadata in canonical models and private approval.
 * This does not allow nonempty bearer/API-key security requirement arrays. */
export function extractCredentialPermissions(value: unknown, security: OperationSecurity | undefined): CredentialPermissions | undefined
{
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !security || value.length !== security.length)
    throw new Error("Credential permissions must match the security alternatives.");
  return value.map((raw, index) => Object.fromEntries(Object.entries(object(raw, "Credential permissions")).map(([name, permissions]) =>
  {
    if (!security[index]!.some(scheme => scheme.name === name && scheme.kind === "bearer")
      || !Array.isArray(permissions) || !permissions.length
      || permissions.some(permission => typeof permission !== "string" || !permission.trim() || permission !== permission.trim()))
      throw new Error("Credential permissions require a declared bearer scheme and nonempty permission strings.");
    return [name, [...permissions]];
  })));
}

/** An absent declaration, [] or an empty alternative permits anonymous execution. */
export function securityRequiresCredentials(security: OperationSecurity | undefined): boolean
{
  return !!security?.length && security.every(alternative => alternative.length > 0);
}
