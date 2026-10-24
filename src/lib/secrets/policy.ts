// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import { validAwsSigningModel, lambdaSigningRegion } from "../aws-signing.ts";
import { validS3FilesModel, s3SigningEndpoint } from "../s3-files.ts";
import { cloudflareOrigin, configureCloudflareUpload, cloudflareUploadProfile, uploadSessionConsumer } from "../cloudflare-upload.ts";
import { extractCredentialPermissions, extractOperationSecurity, supportedSecurityAlternative } from "../operation-security.ts";
import { serverUrlHasPlaceholder, telegramBotOrigin, telegramPathSecurity } from "../server-url.ts";
import { VaultError, type ApprovedOperation } from "./types.ts";

const encoder = new TextEncoder();
const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const loopbacks = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Stable plain JSON only: never execute toJSON or preserve mutable/prototyped inputs. */
export function canonicalPolicyValue(value: unknown, depth = 0): string
{
  if (depth > 40) throw new VaultError("PERMISSION");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (value && typeof value === "object" && (Reflect.ownKeys(value).some(key => typeof key === "symbol")
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(property => !("value" in property)))) throw new VaultError("PERMISSION");
  if (Array.isArray(value)) return `[${value.map(entry => canonicalPolicyValue(entry, depth + 1)).join(",")}]`;
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null))
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : 1)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalPolicyValue(entry, depth + 1)}`).join(",")}}`;
  throw new VaultError("PERMISSION");
}

function freeze<T>(value: T): T
{
  if (value && typeof value === "object")
  {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** Validate before URL parsing, which would otherwise silently remove dot segments. */
export function validateCredentialPath(path: string, template = false): void
{
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("//") || /[\\?#\u0000-\u0020\u007f]/.test(path)
    || !template && /[{}]/.test(path)) throw new VaultError("PERMISSION");
  for (const segment of path.split("/"))
  {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { throw new VaultError("PERMISSION"); }
    if (decoded === "." || decoded === ".." || /[%\\/?#\u0000-\u0020\u007f]/.test(decoded)) throw new VaultError("PERMISSION");
  }
}

export function normalizeCredentialOrigin(origin: string): string
{
  if (typeof origin !== "string" || /[\\\u0000-\u0020\u007f]/.test(origin) || serverUrlHasPlaceholder(origin)) throw new VaultError("PERMISSION");
  const parts = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(origin);
  if (!parts || /[%@]/.test(parts[2]!)) throw new VaultError("PERMISSION");
  validateCredentialPath(parts[3] ?? "/");
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new VaultError("PERMISSION"); }
  if (url.origin === telegramBotOrigin && url.pathname !== "/") throw new VaultError("PERMISSION");
  if (url.protocol === "http:")
  {
    // WorkerLocation.origin retains the application's origin for a blob worker.
    // Missing location (including non-browser callers) cannot enable development HTTP.
    let application: URL;
    try { application = new URL(globalThis.location?.origin ?? ""); }
    catch { throw new VaultError("PERMISSION"); }
    if (!["http:", "https:"].includes(application.protocol) || !loopbacks.has(application.hostname)
      || !loopbacks.has(url.hostname) || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(parts[2]!))
      throw new VaultError("PERMISSION");
  }
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

function validateOperation(operation: Operation): void
{
  if (operation?.credentialResult !== undefined) throw new VaultError("PERMISSION");
  if (!operation || !methods.has(operation.method) || typeof operation.id !== "string" || !operation.id.trim()
    || !Array.isArray(operation.fields)) throw new VaultError("PERMISSION");
  validateCredentialPath(operation.path, true);
  if (operation.privatePath !== undefined) {
    if (operation.privatePath !== "telegram-bot" || !/^(?:GET|POST)$/.test(operation.method)
      || !/^\/[A-Za-z][A-Za-z0-9]{0,127}$/.test(operation.path)
      || canonicalPolicyValue(operation.security) !== canonicalPolicyValue(telegramPathSecurity())) throw new VaultError("PERMISSION");
  } else if (operation.security?.some(option => option.some(scheme => scheme.path !== undefined))) throw new VaultError("PERMISSION");
  if (operation.security !== undefined && !operation.privatePath)
  {
    if (!Array.isArray(operation.security)) throw new VaultError("PERMISSION");
    if (operation.security.length && !operation.security.some(supportedSecurityAlternative)) throw new VaultError("PERMISSION");
    const validatedSecurity = operation.security.map(alternative => {
      if (!Array.isArray(alternative)) throw new VaultError("PERMISSION");
      return alternative.map(scheme => {
        if (scheme?.kind !== "unsupported") return scheme;
        if (typeof scheme.reason !== "string" || !scheme.reason.trim() || scheme.reason.length > 4096
          || Object.keys(scheme).length !== 4 || Object.keys(scheme).some(key => !["name", "kind", "reason", "header", "query"].includes(key)))
          throw new VaultError("PERMISSION");
        return scheme.query !== undefined ? { name: scheme.name, kind: "apiKey" as const, query: scheme.query }
          : { name: scheme.name, kind: "apiKey" as const, header: scheme.header };
      });
    });
    const definitions: Record<string, unknown> = Object.create(null);
    const requirements = validatedSecurity.map(alternative =>
    {
      const names = new Set<string>();
      return Object.fromEntries(alternative.map(scheme =>
      {
        if (!scheme || typeof scheme.name !== "string" || names.has(scheme.name)
          || !["bearer", "basic", "apiKey", "oauth1", "cloudflare-upload", "aws-sigv4"].includes(scheme.kind)) throw new VaultError("PERMISSION");
        names.add(scheme.name);
        const definition = scheme.kind === "aws-sigv4" ? { type: "apiKey", in: "header", name: "Authorization", "x-amazon-apigateway-authtype": scheme.profile === "s3-object" ? "awsS3" : "awsSigv4", "x-operations-aws-sigv4": scheme.profile }
          : scheme.kind === "cloudflare-upload" ? { type: "http", scheme: "bearer", "x-operations-cloudflare-upload-token": scheme.profile }
          : scheme.kind === "oauth1" ? { type: "http", scheme: "OAuth", "x-operations-oauth1": "x-hmac-sha1" }
          : scheme.kind === "bearer" || scheme.kind === "basic" ? { type: "http", scheme: scheme.kind }
          : scheme.query !== undefined ? { type: "apiKey", in: "query", name: scheme.query }
          : { type: "apiKey", in: "header", name: scheme.header };
        if (Object.hasOwn(definitions, scheme.name) && canonicalPolicyValue(definitions[scheme.name]) !== canonicalPolicyValue(definition))
          throw new VaultError("PERMISSION");
        definitions[scheme.name] = definition;
        return [scheme.name, []];
      }));
    });
    const normalized = extractOperationSecurity({ components: { securitySchemes: definitions }, security: requirements }, {});
    if (canonicalPolicyValue(normalized) !== canonicalPolicyValue(validatedSecurity)) throw new VaultError("PERMISSION");
  }
  if (operation.cloudflareUpload !== undefined) {
    const profile = cloudflareUploadProfile(operation.cloudflareUpload)!;
    const expected = { ...operation }; configureCloudflareUpload(expected, profile);
    for (const key of ["fields", "bodySchema", "bodyMediaType", "bodyValue", "bodyRequired", "binaryMediaTypes", "responseMediaType"] as const)
      if (canonicalPolicyValue(expected[key] ?? null) !== canonicalPolicyValue(operation[key] ?? null)) throw new VaultError("PERMISSION");
    if (!operation.security?.length || operation.responseStream !== undefined) throw new VaultError("PERMISSION");
    if (!uploadSessionConsumer(profile) && operation.security.some(option =>
      canonicalPolicyValue(option) !== canonicalPolicyValue([{ name: "api_token", kind: "bearer", header: "Authorization" }])
      && canonicalPolicyValue(option) !== canonicalPolicyValue([{ name: "api_email", kind: "apiKey", header: "X-Auth-Email" }, { name: "api_key", kind: "apiKey", header: "X-Auth-Key" }]))) throw new VaultError("PERMISSION");
    if (uploadSessionConsumer(profile)) {
      const kind = profile === "workers-upload" ? "workers" : "pages", name = kind === "workers" ? "assets_jwt" : "pages_upload_token";
      if (canonicalPolicyValue(operation.security) !== canonicalPolicyValue([[{ name, kind: "cloudflare-upload", header: "Authorization", profile: kind }]])) throw new VaultError("PERMISSION");
    }
  } else if (operation.security?.flat().some(scheme => scheme.kind === "cloudflare-upload")) throw new VaultError("PERMISSION");
  extractCredentialPermissions(operation.credentialPermissions, operation.security);
  if (operation.security?.flat().some(scheme => scheme.kind === "aws-sigv4") && !(operation.s3Files ? validS3FilesModel(operation) : validAwsSigningModel(operation))) throw new VaultError("PERMISSION");
  if (operation.s3Files !== undefined && !validS3FilesModel(operation)) throw new VaultError("PERMISSION");
}

/** Approval binds the entire sanitized operation, including input/auth metadata and base path. */
export async function approvedOperation(operation: Operation, origin: string): Promise<ApprovedOperation>
{
  try
  {
    const sanitized = JSON.parse(canonicalPolicyValue(operation)) as Operation;
    validateOperation(sanitized);
    const normalized = normalizeCredentialOrigin(origin);
    if (sanitized.security?.flat().some(scheme => scheme.kind === "aws-sigv4")
      && !(sanitized.s3Files ? s3SigningEndpoint(normalized) : lambdaSigningRegion(normalized))) throw new VaultError("PERMISSION");
    if (sanitized.cloudflareUpload && normalized !== cloudflareOrigin) throw new VaultError("PERMISSION");
    if (sanitized.security?.some(option => option.some(scheme => scheme.kind === "oauth1"))
      && (normalized !== "https://api.x.com" || !sanitized.path.startsWith("/2/"))) throw new VaultError("PERMISSION");
    if (sanitized.privatePath && normalized !== telegramBotOrigin) throw new VaultError("PERMISSION");
    if (normalized === telegramBotOrigin && !sanitized.privatePath) throw new VaultError("PERMISSION");
    const bytes = encoder.encode(canonicalPolicyValue({ origin: normalized, operation: sanitized }));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    return freeze({ fingerprint, origin: normalized, operation: sanitized });
  }
  catch { throw new VaultError("PERMISSION"); }
}

/** Validate persisted/page-provided descriptors again before approving grants or dispatching. */
export async function validateApprovedOperation(descriptor: ApprovedOperation): Promise<ApprovedOperation>
{
  try
  {
    const snapshot = JSON.parse(canonicalPolicyValue(descriptor)) as ApprovedOperation;
    const approved = await approvedOperation(snapshot.operation, snapshot.origin);
    if (canonicalPolicyValue(snapshot) !== canonicalPolicyValue(approved)) throw new VaultError("PERMISSION");
    return approved;
  }
  catch { throw new VaultError("PERMISSION"); }
}
