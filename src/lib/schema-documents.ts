// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { parseDocument } from "yaml";
import { extractOperations, type Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";
import { serverUrlHasPlaceholder, telegramPrivateEndpoint, telegramBotOrigin } from "./server-url.ts";
import { awsWirePath, awsWireProfile } from "./aws-wire.ts";
import { inspectCodexSchema, isCodexSchema } from "./codex-schema.ts";

export const schemaDocumentMaxBytes = 10 * 1024 * 1024;
export type SchemaDocumentRecord = {
  id: string;
  file: string;
  document: Record<string, unknown>;
  enabled: boolean;
  displayName?: string;
  groups?: CatalogGroup[];
  createdAt: number;
  updatedAt: number;
};

type ObjectValue = Record<string, unknown>;
const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function invalid(message: string): never { throw new Error(`Invalid OpenAPI document: ${message}`); }
function unsupported(message: string): never { throw new Error(`Unsupported by this application: ${message}`); }
function object(value: unknown, context: string): ObjectValue
{
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(`${context} must be an object.`);
  return value as ObjectValue;
}

/** A document ID is an opaque namespace, independent of its title and filename. */
export function createSchemaDocumentId(): string { return `schema-${crypto.randomUUID()}`; }

export function validateSchemaDocumentId(id: string): void
{
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new Error("A schema ID must be a stable, nonempty identifier without colons or path separators.");
}

function jsonValue(value: unknown): unknown
{
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(value: unknown, depth: number): unknown
  {
    if (++nodes > 1_000_000 || depth > 100) throw new Error("The document exceeds the supported nesting or expanded value limit.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || !value) throw new Error("Documents must contain only JSON-compatible values.");
    if (ancestors.has(value)) throw new Error("Cyclic YAML aliases are not supported.");
    ancestors.add(value);
    let result: unknown;
    if (Array.isArray(value)) result = value.map(item => visit(item, depth + 1));
    else
    {
      if (!(value instanceof Map) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
        throw new Error("Documents must contain only JSON-compatible objects.");
      const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
      const keys = new Set<string>();
      result = Object.fromEntries(entries.map(([key, entry]) => {
        if (typeof key !== "string" && !(typeof key === "number" && Number.isFinite(key)))
          throw new Error("YAML mapping keys must be strings or finite numbers.");
        const name = String(key);
        if (keys.has(name)) throw new Error(`Duplicate mapping key: ${name}.`);
        keys.add(name);
        return [name, visit(entry, depth + 1)];
      }));
    }
    ancestors.delete(value);
    return result;
  }
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > schemaDocumentMaxBytes)
    throw new Error("The expanded document exceeds the 10 MiB limit.");
  return result;
}

export function parseSchemaDocument(text: string, filename: string): unknown
{
  if (new TextEncoder().encode(text).byteLength > schemaDocumentMaxBytes) throw new Error("Schema files must be 10 MiB or smaller.");
  try
  {
    if (/\.json$/i.test(filename)) return jsonValue(JSON.parse(text));
    if (!/\.ya?ml$/i.test(filename)) throw new Error("Choose an OpenAPI .json, .yaml or .yml file.");
    const parsed = parseDocument(text, { uniqueKeys: true, version: "1.2", schema: "core" });
    const error = parsed.errors[0] ?? parsed.warnings[0];
    if (error) throw error;
    return jsonValue(parsed.toJS({ mapAsMap: true, maxAliasCount: 100 }));
  }
  catch (error) { throw new Error(`Could not parse ${filename}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}

function resolve(value: unknown, document: ObjectValue, context: string): ObjectValue
{
  let result = object(value, context);
  const seen = new Set<string>();
  while (Object.hasOwn(result, "$ref"))
  {
    const reference = result.$ref;
    if (typeof reference !== "string") invalid(`${context}: $ref must be a string.`);
    if (!reference.startsWith("#/")) unsupported(`${context}: only local document references are supported.`);
    if (Object.keys(result).length !== 1) unsupported(`${context}: references with sibling fields are not supported.`);
    if (seen.has(reference) || /~(?:[^01]|$)/.test(reference)) invalid(`${context}: cyclic or malformed reference ${reference}.`);
    seen.add(reference);
    let target: unknown = document;
    for (const part of reference.slice(2).split("/"))
    {
      const parent = object(target, `${context}: reference ${reference}`);
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      target = Object.hasOwn(parent, key) ? parent[key] : undefined;
    }
    result = object(target, `${context}: reference ${reference}`);
  }
  return result;
}

function safePath(path: string): void
{
  if (!path.startsWith("/") || path.includes("//") || /[\\?#\u0000-\u0020\u007f]/.test(path))
    unsupported(`Operation path ${JSON.stringify(path)} must be an absolute path without double slashes, backslashes, query strings or fragments.`);
  for (const segment of path.split("/"))
  {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { invalid(`Operation path ${JSON.stringify(path)} has malformed percent encoding.`); }
    if (decoded === "." || decoded === ".." || /[\\/\u0000-\u0020\u007f]/.test(decoded))
      unsupported(`Operation path ${JSON.stringify(path)} contains traversal or encoded separators.`);
  }
}

function serverUrl(servers: unknown, base: () => string | undefined, context: string): string | undefined
{
  if (servers === undefined) return base();
  if (!Array.isArray(servers)) invalid(`${context}: servers must be an array.`);
  if (!servers.length) {
    const parent = base();
    return parent ? new URL(parent).origin : undefined;
  }
  const selected = object(servers[0], `${context}: first server`);
  if (typeof selected.url !== "string" || !selected.url.trim()) invalid(`${context}: server url must be a nonempty string.`);
  const variables = selected.variables === undefined ? {} : object(selected.variables, `${context}: server variables`);
  const expanded = selected.url.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const variable = object(variables[name], `${context}: server variable ${name}`);
    if (typeof variable.default !== "string") invalid(`${context}: server variable ${name} requires a string default.`);
    if (variable.enum !== undefined && (!Array.isArray(variable.enum) || !variable.enum.includes(variable.default)))
      invalid(`${context}: server variable ${name} default must belong to its enum.`);
    if (serverUrlHasPlaceholder(variable.default))
      unsupported(`${context}: server variable ${name} still contains a placeholder. Configure it before running this operation.`);
    return variable.default;
  });
  if (serverUrlHasPlaceholder(expanded))
    unsupported(`${context}: the server URL still contains a placeholder. Configure it before running this operation.`);
  if (/[{}\\\u0000-\u0020\u007f]/.test(expanded)) unsupported(`${context}: the server URL contains unresolved variables or unsafe characters.`);
  let url: URL;
  try { url = new URL(expanded); }
  catch {
    const parent = base();
    try { url = new URL(expanded, parent); }
    catch { unsupported(`${context}: a usable absolute HTTP or HTTPS server URL is required; relative server URLs need an absolute parent server.`); }
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash)
    unsupported(`${context}: use an HTTP or HTTPS server URL without credentials, query strings or fragments.`);
  if (url.origin === telegramBotOrigin) unsupported("Telegram requires a saved private bot token connection and its reviewed endpoint template.");
  return url.href.replace(/\/$/, "");
}

/** Respect operation, path-item and document servers, including variable defaults and base paths. */
export function operationServerUrl(document: ObjectValue, operation: Pick<Operation, "path" | "method">): string
{
  const paths = object(document.paths, "paths");
  const item = resolve(paths[operation.path], document, operation.path);
  const value = object(item[operation.method.toLowerCase()], `${operation.method} ${operation.path}`);
  const privateEndpoint = telegramPrivateEndpoint(document, value, item);
  if (privateEndpoint) {
    if (!/^(?:GET|POST)$/.test(operation.method) || !/^\/[A-Za-z][A-Za-z0-9]{0,127}$/.test(operation.path))
      unsupported("Private Telegram token paths require a single Bot API method name.");
    return privateEndpoint;
  }
  // Resolve ancestors only when inherited or needed as the base of a relative URL.
  const top = () => serverUrl(document.servers, () => undefined, "document");
  const path = () => serverUrl(item.servers, top, operation.path);
  const server = serverUrl(value.servers, path, `${operation.method} ${operation.path}`);
  if (!server) unsupported(`${operation.method} ${operation.path}: a usable absolute HTTP or HTTPS server URL is required.`);
  return server;
}

function generatedGroups(document: ObjectValue, operations: Operation[], id: string): CatalogGroup[]
{
  const tags = Array.isArray(document.tags) ? document.tags.map(value => object(value, "tag")) : [];
  const groups = new Map<string, CatalogGroup>();
  for (const operation of operations)
  {
    let group = groups.get(operation.group);
    if (!group)
    {
      const tag = tags.find(tag => tag.name === operation.group);
      group = { id: `${id}:tag:${encodeURIComponent(operation.group)}`, name: operation.group,
        description: typeof tag?.description === "string" ? tag.description : "", operationIds: [] };
      groups.set(operation.group, group);
    }
    group.operationIds!.push(operation.id);
  }
  return [...groups.values()];
}

export function validateSchemaDocument(value: unknown, id: string): {
  document: ObjectValue; operations: Operation[]; name: string; serverUrl: string; groups: CatalogGroup[];
}
{
  validateSchemaDocumentId(id);
  const document = object(jsonValue(value), "document");
  if (isCodexSchema(document)) return inspectCodexSchema(document, id);
  if (document.swagger === "2.0") unsupported("Only OpenAPI 3.0 and 3.1 documents are supported.");
  if (typeof document.openapi !== "string" || !/^\d+\.\d+\.\d+$/.test(document.openapi))
    invalid("openapi must declare a version such as 3.0.3 or 3.1.0.");
  if (!/^3\.(?:0|1)\.\d+$/.test(document.openapi))
    unsupported("Only OpenAPI 3.0 and 3.1 documents are supported.");
  const info = object(document.info, "info");
  if (typeof info.title !== "string" || !info.title.trim() || typeof info.version !== "string" || !info.version.trim())
    invalid("info.title and info.version must be nonempty strings.");
  const paths = object(document.paths, "paths");
  if (document.webhooks !== undefined && Object.keys(object(document.webhooks, "webhooks")).length)
    unsupported("Webhook operations are not executable in this application.");
  for (const [path, raw] of Object.entries(paths))
  {
    if (path.startsWith("x-")) continue;
    const item = resolve(raw, document, path);
    const invocations = Object.entries(item).filter(([method]) => methods.has(method));
    const reviewedWirePath = invocations.length > 0 && invocations.every(([method, raw]) => {
      const wire = awsWireProfile(object(raw, `${method} ${path}`)["x-operations-aws-wire"]);
      return wire !== undefined && awsWirePath(path, method.toUpperCase(), wire);
    });
    if (!reviewedWirePath) safePath(path);
    for (const [method, value] of Object.entries(item))
    {
      if (!methods.has(method)) continue;
      const operation = object(value, `${method} ${path}`);
      if (operation.operationId !== undefined && (typeof operation.operationId !== "string" || !operation.operationId.trim()))
        invalid(`${method} ${path}: operationId must be a nonempty string.`);
      const responses = object(operation.responses, `${method} ${path}: responses`);
      if (!Object.keys(responses).some(status => status === "default" || /^[1-5](?:\d\d|XX)$/.test(status)))
        invalid(`${method} ${path}: at least one response is required.`);
      for (const [status, rawResponse] of Object.entries(responses))
      {
        if (status.startsWith("x-")) continue;
        if (status !== "default" && !/^[1-5](?:\d\d|XX)$/.test(status)) invalid(`${method} ${path}: invalid response status ${status}.`);
        const response = resolve(rawResponse, document, `${method} ${path}: response ${status}`);
        if (typeof response.description !== "string") invalid(`${method} ${path}: response ${status} requires a description.`);
      }
      if (operation.callbacks !== undefined && Object.keys(object(operation.callbacks, "callbacks")).length)
        unsupported(`${method} ${path}: callbacks are not supported.`);
    }
  }
  let operations: Operation[];
  try { operations = extractOperations(document, id); }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    if (/unsupported|supported|references must|choose one|nesting exceeds|recursive reference/i.test(message)) unsupported(message);
    invalid(message);
  }
  const urls = operations.map(operation => operationServerUrl(document, operation));
  const server = urls[0]!;
  const name = info.title.trim();
  const groups: CatalogGroup[] = [{ id, name: new URL(server).host,
    description: typeof info.description === "string" ? info.description : name,
    children: generatedGroups(document, operations, id) }];
  return { document, operations, name, serverUrl: server, groups };
}
