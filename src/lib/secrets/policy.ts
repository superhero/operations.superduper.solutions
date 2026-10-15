// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "../catalog.ts";
import { extractOperationSecurity } from "../operation-security.ts";
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
  if (typeof origin !== "string" || /[\\\u0000-\u0020\u007f]/.test(origin)) throw new VaultError("PERMISSION");
  const parts = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(origin);
  if (!parts || /[%@]/.test(parts[2]!)) throw new VaultError("PERMISSION");
  validateCredentialPath(parts[3] ?? "/");
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new VaultError("PERMISSION"); }
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
  if (!operation || !methods.has(operation.method) || typeof operation.id !== "string" || !operation.id.trim()
    || !Array.isArray(operation.fields)) throw new VaultError("PERMISSION");
  validateCredentialPath(operation.path, true);
  if (operation.security !== undefined)
  {
    if (!Array.isArray(operation.security)) throw new VaultError("PERMISSION");
    const definitions: Record<string, unknown> = Object.create(null);
    const requirements = operation.security.map(alternative =>
    {
      if (!Array.isArray(alternative)) throw new VaultError("PERMISSION");
      const names = new Set<string>();
      return Object.fromEntries(alternative.map(scheme =>
      {
        if (!scheme || typeof scheme.name !== "string" || names.has(scheme.name)
          || !["bearer", "apiKey"].includes(scheme.kind)) throw new VaultError("PERMISSION");
        names.add(scheme.name);
        const definition = scheme.kind === "bearer" ? { type: "http", scheme: "bearer" }
          : { type: "apiKey", in: "header", name: scheme.header };
        if (Object.hasOwn(definitions, scheme.name) && canonicalPolicyValue(definitions[scheme.name]) !== canonicalPolicyValue(definition))
          throw new VaultError("PERMISSION");
        definitions[scheme.name] = definition;
        return [scheme.name, []];
      }));
    });
    const normalized = extractOperationSecurity({ components: { securitySchemes: definitions }, security: requirements }, {});
    if (canonicalPolicyValue(normalized) !== canonicalPolicyValue(operation.security)) throw new VaultError("PERMISSION");
  }
}

/** Approval binds the entire sanitized operation, including input/auth metadata and base path. */
export async function approvedOperation(operation: Operation, origin: string): Promise<ApprovedOperation>
{
  try
  {
    const sanitized = JSON.parse(canonicalPolicyValue(operation)) as Operation;
    validateOperation(sanitized);
    const normalized = normalizeCredentialOrigin(origin);
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
