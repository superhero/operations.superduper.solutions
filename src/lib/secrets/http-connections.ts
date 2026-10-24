// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { canonicalPolicyValue, validateApprovedOperation } from "./policy.ts";
import { credentialObject, credentialReferenceIds, isBasicCredentialReference, isOAuth1CredentialReference, isAwsCredentialReference, validateCredentialBinding, validateHttpConnectionReference } from "./bindings.ts";
import { supportedSecurityAlternative } from "../operation-security.ts";
import { VaultError, type ApprovedOperation, type CredentialBinding, type HttpConnection, type HttpConnectionInput,
  type HttpConnectionReference, type HttpTokenFormat, type VaultCredential } from "./types.ts";

export const httpConnectionLimit = 128;
function ownObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const item = credentialObject(value);
  if (required.some(key => !Object.hasOwn(item, key)) || Object.keys(item).some(key => !required.includes(key) && !optional.includes(key)))
    throw new VaultError("INVALID");
  return item;
}
const schemaId = (descriptor: ApprovedOperation) => descriptor.operation.id.slice(0, descriptor.operation.id.indexOf(":"));
export const httpConnectionReference = ({ id, revision, fingerprint }: HttpConnection): HttpConnectionReference => ({ id, revision, fingerprint });
export const connectionCredentialIds = (connection: Pick<HttpConnection, "credentials">): string[] => [...new Set(Object.values(connection.credentials)
  .flatMap(credentialReferenceIds))].sort();

/** These are wire formats, not user-supplied templates or new secret types. */
export function httpTokenFormats(descriptor: ApprovedOperation, alternative: number): HttpTokenFormat[] {
  const security = descriptor.operation.security?.[alternative];
  if (!supportedSecurityAlternative(security) || security.length !== 1) return ["schema"];
  const scheme = security[0]!;
  if (scheme.kind !== "apiKey" || scheme.header?.toLowerCase() !== "authorization") return ["schema"];
  if (schemaId(descriptor) === "discord" && descriptor.origin === "https://discord.com/api/v10" && scheme.name === "BotToken")
    return ["schema", "discord-bot"];
  if (schemaId(descriptor) === "opsgenie" && ["https://api.opsgenie.com", "https://api.eu.opsgenie.com"].includes(descriptor.origin) && scheme.name === "GenieKey")
    return ["schema", "opsgenie-key"];
  return ["schema"];
}

export function validateHttpConnection(value: unknown): HttpConnection {
  const item = ownObject(value, ["id", "revision", "fingerprint", "label", "account", "provider", "endpoint", "runtime",
    "alternative", "security", "credentials", "format"], ["expiresAt"]);
  validateHttpConnectionReference({ id: item.id, revision: item.revision, fingerprint: item.fingerprint });
  if ([item.label, item.account].some(value => typeof value !== "string" || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))
    || typeof item.provider !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(item.provider)
    || typeof item.endpoint !== "string" || item.runtime !== "browser-http" || !["schema", "discord-bot", "opsgenie-key"].includes(String(item.format))
    || item.expiresAt !== undefined && (!Number.isSafeInteger(item.expiresAt) || (item.expiresAt as number) <= 0)) throw new VaultError("INVALID");
  let endpoint: URL;
  try { endpoint = new URL(item.endpoint); } catch { throw new VaultError("INVALID"); }
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || item.endpoint !== endpoint.origin + endpoint.pathname.replace(/\/$/, "")) throw new VaultError("INVALID");
  const binding = validateCredentialBinding({ alternative: item.alternative, credentials: item.credentials, fingerprint: item.fingerprint });
  if (!supportedSecurityAlternative(item.security) || !item.security.length || item.security.length > 16) throw new VaultError("INVALID");
  const security = item.security.map(scheme => {
    ownObject(scheme, ["name", "kind", scheme.path !== undefined ? "path" : scheme.query === undefined ? "header" : "query", ...(["oauth1", "aws-sigv4"].includes(scheme.kind) ? ["profile"] : [])]);
    if (scheme.kind === "oauth1" && (scheme.profile !== "x-hmac-sha1" || scheme.header !== "Authorization")) throw new VaultError("INVALID");
    if (scheme.kind === "aws-sigv4" && (!["lambda-list-functions", "s3-object"].includes(scheme.profile) || scheme.header !== "Authorization")) throw new VaultError("INVALID");
    if (typeof scheme.name !== "string" || typeof (scheme.header ?? scheme.query ?? scheme.path) !== "string"
      || !Object.hasOwn(binding.credentials, scheme.name)) throw new VaultError("INVALID");
    return { ...scheme };
  });
  if (security.length !== Object.keys(binding.credentials).length) throw new VaultError("INVALID");
  return { ...item, security, credentials: binding.credentials } as HttpConnection;
}

async function fingerprint(value: Omit<HttpConnection, "fingerprint">): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPolicyValue(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function storedHttpConnections(records: readonly VaultCredential[]): HttpConnection[] {
  const result = records.flatMap(record => (record.connections ?? []).map(value => {
    const connection = validateHttpConnection(value);
    if (connectionCredentialIds(connection)[0] !== record.id) throw new VaultError("INVALID");
    return connection;
  }));
  if (result.length > httpConnectionLimit || new Set(result.map(item => item.id)).size !== result.length) throw new VaultError("LIMIT");
  return result;
}
export function httpConnectionMatches(connection: HttpConnection, descriptor: ApprovedOperation): boolean {
  const security = descriptor.operation.security?.[connection.alternative];
  return schemaId(descriptor) === connection.provider && descriptor.origin === connection.endpoint
    && supportedSecurityAlternative(security) && security.length > 0
    && canonicalPolicyValue(security) === canonicalPolicyValue(connection.security)
    && httpTokenFormats(descriptor, connection.alternative).includes(connection.format);
}
function assertReferences(connection: HttpConnection, records: readonly VaultCredential[]): void {
  for (const scheme of connection.security) {
    const reference = connection.credentials[scheme.name]!;
    const ids = credentialReferenceIds(reference);
    if ((scheme.kind === "basic" ? !isBasicCredentialReference(reference)
      : scheme.kind === "oauth1" ? !isOAuth1CredentialReference(reference)
      : scheme.kind === "aws-sigv4" ? !isAwsCredentialReference(reference) : typeof reference !== "string") || ids.some(id => {
      const matches = records.filter(record => record.id === id);
      return matches.length !== 1 || !["basic", "oauth1", "aws-sigv4"].includes(scheme.kind) && !["secret", scheme.kind].includes(matches[0]!.kind);
    })) throw new VaultError("PERMISSION");
  }
}

export async function resolveHttpConnection(descriptor: ApprovedOperation, binding: CredentialBinding, records: readonly VaultCredential[]):
  Promise<{ binding: CredentialBinding; format: HttpTokenFormat; expiresAt?: number }> {
  if (!binding.connection) return { binding, format: "schema" };
  const selected = validateCredentialBinding(binding), reference = selected.connection!;
  const connection = storedHttpConnections(records).find(item => item.id === reference.id);
  if (!connection || connection.revision !== reference.revision || connection.fingerprint !== reference.fingerprint
    || !httpConnectionMatches(connection, descriptor) || selected.fingerprint !== descriptor.fingerprint || selected.alternative !== connection.alternative
    || connection.expiresAt !== undefined && connection.expiresAt <= Date.now()) throw new VaultError("PERMISSION");
  const { fingerprint: saved, ...config } = connection;
  if (saved !== await fingerprint(config)) throw new VaultError("PERMISSION");
  assertReferences(connection, records);
  return { binding: { alternative: connection.alternative, fingerprint: descriptor.fingerprint, credentials: structuredClone(connection.credentials) },
    format: connection.format, ...(connection.expiresAt === undefined ? {} : { expiresAt: connection.expiresAt }) };
}

/** Profiles live in existing encrypted records; their fields contain metadata and references only. */
export async function createHttpConnection(input: HttpConnectionInput, descriptor: ApprovedOperation, selected: CredentialBinding,
  records: readonly VaultCredential[]): Promise<HttpConnection> {
  ownObject(input, ["label", "account", "format"], ["reference", "expiresAt"]);
  const approved = await validateApprovedOperation(descriptor), binding = validateCredentialBinding(selected);
  const security = approved.operation.security?.[binding.alternative];
  if (binding.connection || binding.fingerprint !== approved.fingerprint || !supportedSecurityAlternative(security) || !security.length
    || !httpTokenFormats(approved, binding.alternative).includes(input.format)) throw new VaultError("PERMISSION");
  const all = storedHttpConnections(records), previous = input.reference && all.find(item => item.id === validateHttpConnectionReference(input.reference).id);
  if (input.reference && (!previous || previous.revision !== input.reference.revision || previous.fingerprint !== input.reference.fingerprint)) throw new VaultError("CONFLICT");
  if (!previous && all.length >= httpConnectionLimit || previous?.revision === Number.MAX_SAFE_INTEGER) throw new VaultError("LIMIT");
  const config: Omit<HttpConnection, "fingerprint"> = { id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1,
    label: input.label, account: input.account, provider: schemaId(approved), endpoint: approved.origin, runtime: "browser-http",
    alternative: binding.alternative, security: structuredClone(security), credentials: binding.credentials, format: input.format,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }) };
  const connection = validateHttpConnection({ ...config, fingerprint: await fingerprint(config) });
  assertReferences(connection, records);
  if (all.some(item => item.id !== connection.id && item.provider === connection.provider
    && item.label.trim().toLocaleLowerCase() === connection.label.trim().toLocaleLowerCase())) throw new VaultError("DUPLICATE_KEY");
  return connection;
}

export function formatHttpToken(format: HttpTokenFormat, value: string): string {
  if (format === "schema") return value;
  if (!value || /\s/.test(value)) throw new VaultError("INVALID");
  return `${format === "discord-bot" ? "Bot" : "GenieKey"} ${value}`;
}

/** Rotating an underlying value requires explicit reselection of its saved connection. */
export async function invalidateHttpConnections(records: VaultCredential[], credentialId: string): Promise<void> {
  for (const record of records) if (record.connections) record.connections = await Promise.all(record.connections.map(async connection => {
    if (!connectionCredentialIds(connection).includes(credentialId)) return connection;
    if (connection.revision === Number.MAX_SAFE_INTEGER) throw new VaultError("LIMIT");
    const { fingerprint: _old, ...config } = connection;
    config.revision++;
    return { ...config, fingerprint: await fingerprint(config) };
  }));
}
