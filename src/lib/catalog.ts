// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { catalogs, replaceCatalogs, setOperationCatalog, type Catalog } from "./catalog-registry.ts";
import { extractOperationSecurity, type OperationSecurity } from "./operation-security.ts";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type InputSchema = {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | "json";
  pattern?: string;
  nullable?: boolean;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, InputSchema>;
  additionalProperties?: boolean | InputSchema;
  required?: string[];
  items?: InputSchema;
};
export type InputField = Omit<InputSchema, "properties" | "required" | "items"> & {
  key: string;
  defaultValue?: string;
  name: string;
  label: string;
  description: string;
  location: "path" | "query" | "header" | "body";
  required: boolean;
  schema?: InputSchema;
};
export type BodyMediaType = "application/json" | "text/plain" | "application/x-www-form-urlencoded" | "multipart/form-data";
export type Operation = {
  /** Navigation-only descriptor. Execution requires a separately hydrated model. */
  deferred?: true;
  id: string;
  name: string;
  description: string;
  group: string;
  method: string;
  path: string;
  fields: InputField[];
  bodyRequired: boolean;
  bodyMediaType?: BodyMediaType;
  bodyValue?: boolean;
  bodySchema?: InputSchema;
  responseExample?: unknown;
  responseMediaType?: string;
  security?: OperationSecurity;
  unavailableReason?: string;
  oauthScopes?: Record<string, string[]>[];
};

type RecordValue = Record<string, unknown>;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const annotations = ["title", "description", "example", "examples", "default", "deprecated"];
const primitiveTypes = ["string", "number", "integer", "boolean", "null"];

function object(value: unknown, context: string): RecordValue
{
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${context}: expected an object.`);
  return value as RecordValue;
}

function supported(value: RecordValue, keys: string[], context: string)
{
  const unknown = Object.keys(value).filter(key => !keys.includes(key));
  if (unknown.length) throw new Error(`${context}: unsupported schema fields: ${unknown.join(", ")}.`);
}

function resolve(value: unknown, document: RecordValue, context: string): RecordValue
{
  let result = object(value, context);
  const seen = new Set<string>();
  while ("$ref" in result)
  {
    const reference = result.$ref;
    if (typeof reference !== "string" || !reference.startsWith("#/") || seen.has(reference)
      || Object.keys(result).length !== 1 || /~(?:[^01]|$)/.test(reference))
      throw new Error(`${context}: references must be local, non-cyclic JSON pointers without sibling fields.`);
    seen.add(reference);
    let target: unknown = document;
    for (const part of reference.slice(2).split("/"))
    {
      const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
      const parent = object(target, context);
      target = Object.hasOwn(parent, key) ? parent[key] : undefined;
    }
    result = object(target, `${context}: reference ${reference}`);
  }
  return result;
}

function text(value: unknown, fallback: string): string
{
  return typeof value === "string" ? value : fallback;
}

function inputSchema(value: unknown, document: RecordValue, context: string, depth = 0): InputSchema
{
  if (depth > 12) throw new Error(`${context}: schema nesting exceeds 12 levels or contains a recursive reference.`);
  const shape = resolve(value, document, context);
  const union = Array.isArray(shape.type) ? shape.type : undefined;
  if (union && (union.length !== 2 || !union.includes("null") || new Set(union).size !== 2))
    throw new Error(`${context}: unsupported input type union.`);
  const type = (union ? union.find(type => type !== "null") : shape.type) as InputSchema["type"];
  if (![...primitiveTypes, "object", "array"].includes(type)) throw new Error(`${context}: unsupported input type.`);
  if (shape.nullable !== undefined && typeof shape.nullable !== "boolean") throw new Error(`${context}: nullable must be Boolean.`);
  const nullable = !!union || shape.nullable === true;
  const keys = ["type", "nullable", ...annotations];
  if (primitiveTypes.includes(type)) keys.push("enum");
  if (type === "number" || type === "integer") keys.push("minimum", "maximum");
  if (type === "string") keys.push("minLength", "maxLength");
  if (type === "array") keys.push("items", "minItems", "maxItems");
  if (type === "object") keys.push("properties", "required", "additionalProperties");
  // Validate misplaced numeric constraints explicitly, keeping useful diagnostics.
  supported(shape, [...keys, "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"], context);
  const result: InputSchema = { type, ...(nullable ? { nullable: true } : {}) };
  if (shape.enum !== undefined)
  {
    if (!Array.isArray(shape.enum) || !shape.enum.length || shape.enum.some(value =>
      value === null ? type !== "null" && !nullable : type === "null" || typeof value !== (type === "integer" ? "number" : type)
      || typeof value === "number" && !Number.isFinite(value) || type === "integer" && !Number.isInteger(value)))
      throw new Error(`${context}: enum values must match the input type.`);
    result.enum = shape.enum;
  }
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const)
  {
    const value = shape[key];
    if (value === undefined) continue;
    const length = key === "minLength" || key === "maxLength";
    const items = key === "minItems" || key === "maxItems";
    if (typeof value !== "number" || !Number.isFinite(value)
      || (length || items ? type !== (length ? "string" : "array") || !Number.isInteger(value) || value < 0 : type !== "number" && type !== "integer"))
      throw new Error(`${context}: invalid ${key} constraint.`);
    result[key] = value;
  }
  if (result.minimum !== undefined && result.maximum !== undefined && result.minimum > result.maximum
    || result.minLength !== undefined && result.maxLength !== undefined && result.minLength > result.maxLength
    || result.minItems !== undefined && result.maxItems !== undefined && result.minItems > result.maxItems)
    throw new Error(`${context}: minimum exceeds maximum.`);
  if (type === "array") result.items = inputSchema(shape.items, document, `${context}[]`, depth + 1);
  if (type === "object")
  {
    if (shape.additionalProperties !== undefined)
    {
      if (typeof shape.additionalProperties === "boolean") result.additionalProperties = shape.additionalProperties;
      else
      {
        const additional = resolve(shape.additionalProperties, document, `${context}: additionalProperties`);
        result.additionalProperties = Object.keys(additional).every(key => annotations.includes(key)) ? true
          : inputSchema(additional, document, `${context}: additionalProperties`, depth + 1);
      }
    }
    const properties = object(shape.properties === undefined ? {} : shape.properties, `${context}: properties`);
    const required = shape.required ?? [];
    if (!Array.isArray(required) || required.some(name => typeof name !== "string"
      || result.additionalProperties === false && !Object.hasOwn(properties, name)))
      throw new Error(`${context}: required body properties must name allowed fields.`);
    result.required = required;
    result.properties = Object.fromEntries(Object.entries(properties).map(([name, property]) =>
      [name, inputSchema(property, document, `${context}.${name}`, depth + 1)]));
  }
  return result;
}

function objectSchemas(schema: InputSchema): InputSchema[]
{
  return [...Object.values(schema.properties!),
    ...(typeof schema.additionalProperties === "object" ? [schema.additionalProperties] : [])];
}

function field(value: unknown, document: RecordValue, location: InputField["location"], name: string,
  required: boolean): InputField
{
  const context = `${location}:${name}`;
  const shape = resolve(value, document, context);
  const schema = inputSchema(shape, document, context);
  const result: InputField = { key: context, name, label: text(shape.title, name),
    description: text(shape.description, ""), location, type: schema.type, required };
  if (schema.type === "object" || schema.type === "array")
  {
    result.schema = schema;
    if (schema.nullable) result.nullable = true;
  }
  else Object.assign(result, schema);
  return result;
}

function responseDetails(operation: RecordValue, document: RecordValue, context: string): Pick<Operation, "responseExample" | "responseMediaType">
{
  for (const [status, raw] of Object.entries(object(operation.responses ?? {}, `${context}: responses`)))
  {
    if (!/^2\d\d$/.test(status)) continue;
    const response = resolve(raw, document, context);
    const content = object(response.content ?? {}, context);
    for (const [responseMediaType, rawMedia] of Object.entries(content))
    {
      const media = object(rawMedia, context);
      if (Object.hasOwn(media, "example")) return { responseMediaType, responseExample: media.example };
      if (media.schema !== undefined) return { responseMediaType, responseExample: resolve(media.schema, document, context).example };
      return { responseMediaType, responseExample: undefined };
    }
  }
  return { responseExample: undefined };
}

export function extractOperations(value: unknown, source: string): Operation[]
{
  const document = object(value, source);
  if (!/^3\.(?:0|1)\./.test(String(document.openapi)) || !source.trim())
    throw new Error(`${source}: expected an OpenAPI 3.0 or 3.1 document and a source name.`);
  const result: Operation[] = [];
  const identities = new Set<string>();
  for (const [path, value] of Object.entries(object(document.paths, `${source}: paths`)))
  {
    if (!path.startsWith("/")) continue;
    const item = resolve(value, document, path);
    for (const [method, value] of Object.entries(item))
    {
      if (!methods.has(method)) continue;
      const operation = object(value, `${method} ${path}`);
      const id = `${source}:${text(operation.operationId, `${method.toUpperCase()} ${path}`)}`;
      if (identities.has(id)) throw new Error(`${source}: duplicate operation identifier ${id}.`);
      identities.add(id);
      const inputs = new Map<string, InputField>();
      for (const parameters of [item.parameters, operation.parameters])
      {
        if (parameters === undefined) continue;
        if (!Array.isArray(parameters)) throw new Error(`${id}: parameters must be an array.`);
        const parameterKeys = new Set<string>();
        for (const raw of parameters)
        {
          const parameter = resolve(raw, document, id);
          supported(parameter, ["name", "in", "required", "schema", "description", "deprecated", "style", "explode"], id);
          if (!["path", "query", "header"].includes(String(parameter.in)) || typeof parameter.name !== "string" || !parameter.name
            || parameter.required !== undefined && typeof parameter.required !== "boolean"
            || parameter.in === "path" && parameter.required !== true)
            throw new Error(`${id}: inputs require a name and a supported path/query/header location; path inputs must be required.`);
          const input = field(parameter.schema, document, parameter.in as InputField["location"], parameter.name, parameter.required === true);
          const query = input.location === "query";
          const style = query ? input.type === "object" ? "deepObject" : "form" : "simple";
          if (query && input.type === "object" && parameter.style !== "deepObject"
            || parameter.style !== undefined && parameter.style !== style
            || parameter.explode !== undefined && parameter.explode !== query
            || !query && !primitiveTypes.includes(input.type)
            || input.type === "array" && !primitiveTypes.includes(input.schema!.items!.type)
            || input.type === "object" && objectSchemas(input.schema!).some(property => !primitiveTypes.includes(property.type)))
            throw new Error(`${id}: unsupported parameter serialization; use primitive parameters, form query arrays or flat deepObject query objects.`);
          if (input.location === "header" && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(input.name))
            throw new Error(`${id}: invalid header name.`);
          const identity = input.location === "header" ? input.key.toLowerCase() : input.key;
          if (parameterKeys.has(identity)) throw new Error(`${id}: duplicate parameter ${input.key}.`);
          parameterKeys.add(identity);
          input.description = text(parameter.description, input.description);
          inputs.set(identity, input);
        }
      }
      const fields = [...inputs.values()];
      let bodyRequired = false;
      let bodyMediaType: BodyMediaType | undefined;
      let bodyValue = false;
      let bodySchema: InputSchema | undefined;
      if (operation.requestBody !== undefined)
      {
        const body = resolve(operation.requestBody, document, `${id}: request body`);
        supported(body, ["required", "description", "content"], id);
        if (body.required !== undefined && typeof body.required !== "boolean") throw new Error(`${id}: body required must be Boolean.`);
        bodyRequired = body.required === true;
        const content = object(body.content, `${id}: request content`);
        const mediaTypes = Object.keys(content);
        if (mediaTypes.length !== 1 || !["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].includes(mediaTypes[0]!))
          throw new Error(`${id}: choose one supported request media type: application/json, text/plain, application/x-www-form-urlencoded or multipart/form-data.`);
        bodyMediaType = mediaTypes[0] as BodyMediaType;
        const media = object(content[bodyMediaType], id);
        supported(media, ["schema", "example", "examples"], id);
        const shape = resolve(media.schema, document, id);
        const schema = inputSchema(shape, document, id);
        bodySchema = schema;
        if (bodyMediaType === "text/plain" && schema.type !== "string") throw new Error(`${id}: text/plain requires a string schema.`);
        if (bodyMediaType === "application/x-www-form-urlencoded" || bodyMediaType === "multipart/form-data")
          if (schema.type !== "object" || schema.nullable || objectSchemas(schema).some(property => property.nullable || !["string", "number", "integer", "boolean"].includes(property.type)))
            throw new Error(`${id}: form bodies require named primitive text fields; files and structured fields are unsupported.`);
        if (schema.type === "object" && !schema.nullable)
          for (const [name, property] of Object.entries((shape.properties ?? {}) as RecordValue)) fields.push(field(property, document, "body", name, schema.required!.includes(name)));
        else
        {
          bodyValue = true;
          const input = field(media.schema, document, "body", "$", true);
          input.label = text(shape.title, "Request body");
          fields.push(input);
        }
      }
      const placeholders = [...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
      if (placeholders.some(name => !fields.some(input => input.location === "path" && input.name === name))
        || fields.some(input => input.location === "path" && !placeholders.includes(input.name)))
        throw new Error(`${id}: path placeholders and required path inputs must agree.`);
      const tags = operation.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !tag.trim())))
        throw new Error(`${id}: tags must be nonempty strings.`);
      const extracted: Operation = { id, name: text(operation.summary, text(operation.operationId, `${method.toUpperCase()} ${path}`)),
        description: text(operation.description, ""), group: Array.isArray(tags) && tags.length ? tags[0] : "Operations",
        method: method.toUpperCase(), path, fields, bodyRequired, ...responseDetails(operation, document, id) };
      if (bodyMediaType) extracted.bodyMediaType = bodyMediaType;
      if (bodyValue) extracted.bodyValue = true;
      if (bodySchema) extracted.bodySchema = bodySchema;
      const security = extractOperationSecurity(document, operation);
      if (security !== undefined) extracted.security = security;
      result.push(extracted);
    }
  }
  if (!result.length) throw new Error(`${source}: no operations found.`);
  return result;
}

export let operations = catalogs.flatMap(catalog => extractOperations(catalog.document, catalog.id));
const sourceIdentity = (catalog: Catalog) => JSON.stringify([catalog.file, catalog.document]);
let operationSources = new Map(catalogs.map(catalog => [catalog.id, sourceIdentity(catalog)]));
let operationIndex = new Map(operations.map(operation => [operation.id, operation]));
const models = new Map<string, OperationModel>();
const pins = new Map<object, ReadonlySet<string>>();
const modelBudget = 8 * 1024 * 1024;

export type OperationModel = { operation: Operation; document: Record<string, unknown>; origin: string;
  sourceIdentity: string; bytes: number };

export function operationSourceIdentity(id: string): string | undefined {
  const separator = id.indexOf(":");
  return separator < 0 ? undefined : operationSources.get(id.slice(0, separator));
}

/** A discovery descriptor is never an executable canonical operation. */
export function operationForId(id: string): Operation | undefined {
  const operation = operationIndex.get(id);
  if (!operation?.deferred) return operation;
  const model = models.get(id);
  if (model) { models.delete(id); models.set(id, model); }
  return model?.operation;
}

export function operationDescriptorForId(id: string): Operation | undefined { return operationIndex.get(id); }

export function operationOrigin(id: string): string | undefined { return models.get(id)?.origin; }

function releaseModel(id: string): void { models.delete(id); setOperationCatalog(id); }

function pruneModels(keep?: string): void {
  let total = [...models.values()].reduce((bytes, model) => bytes + model.bytes, 0);
  const retained = new Set([...pins.values()].flatMap(ids => [...ids]));
  for (const [id, model] of models) if (total > modelBudget && id !== keep && !retained.has(id)) {
    total -= model.bytes; releaseModel(id);
  }
}

export function pinOperationModels(owner: object, ids?: ReadonlySet<string>): void {
  if (ids) pins.set(owner, ids); else pins.delete(owner);
  pruneModels();
}

/** Refuse replies from a replaced/disabled source before installing any model. */
export function installOperationModel(model: OperationModel): Operation {
  const descriptor = operationIndex.get(model.operation.id);
  const catalog = catalogs.find(catalog => catalog.id === model.operation.id.slice(0, model.operation.id.indexOf(":")));
  if (!descriptor || !catalog || operationSourceIdentity(descriptor.id) !== model.sourceIdentity
    || model.operation.deferred || descriptor.method !== model.operation.method || descriptor.path !== model.operation.path
    || !Number.isSafeInteger(model.bytes) || model.bytes < 0)
    throw new Error("The schema changed while its operation was loading. Try again.");
  models.delete(model.operation.id);
  models.set(model.operation.id, model);
  setOperationCatalog(model.operation.id, { ...catalog, document: model.document, execution: { kind: "http", origin: model.origin } });
  pruneModels(model.operation.id);
  return model.operation;
}

export type PreparedCatalog = { catalog: Catalog; operations: Operation[]; sourceIdentity: string };

function validateCatalogIdentifiers(next: readonly Catalog[]): void
{
  const identifiers = new Set<string>();
  for (const catalog of next)
  {
    if (!catalog.id.trim() || catalog.id.includes(":") || identifiers.has(catalog.id))
      throw new Error(`Invalid or duplicate schema identifier: ${catalog.id}.`);
    identifiers.add(catalog.id);
  }
}

/** Publish worker-prepared data without parsing or fingerprinting schemas on the UI thread. */
export function publishPreparedCatalogs(next: readonly PreparedCatalog[]): void
{
  const replacement = next.map(entry => entry.catalog);
  validateCatalogIdentifiers(replacement);
  const previousOperations = new Map(operations.map(operation => [operation.id, operation]));
  const nextSources = new Map<string, string>();
  const extracted = next.flatMap(({ catalog, operations: prepared, sourceIdentity: identity }) =>
  {
    nextSources.set(catalog.id, identity);
    return operationSources.get(catalog.id) === identity
      ? prepared.map(operation => previousOperations.get(operation.id) ?? operation) : prepared;
  });
  if (replacement.length !== catalogs.length || replacement.some((catalog, index) => catalogs[index] !== catalog)) replaceCatalogs(replacement);
  // Card ordering changes navigation, not the matching input snapshot.
  if (extracted.length !== operations.length || extracted.some(operation => previousOperations.get(operation.id) !== operation)) operations = extracted;
  operationIndex = new Map(operations.map(operation => [operation.id, operation]));
  operationSources = nextSources;
  for (const [id, model] of models) {
    const catalog = replacement.find(catalog => catalog.id === id.slice(0, id.indexOf(":")));
    if (!catalog || operationSourceIdentity(id) !== model.sourceIdentity || !operationIndex.has(id)) releaseModel(id);
    else setOperationCatalog(id, { ...catalog, document: model.document, execution: { kind: "http", origin: model.origin } });
  }
}

/** Validate every operation before replacing the live registry and operation index together. */
export function updateCatalogs(next: readonly Catalog[]): void
{
  validateCatalogIdentifiers(next);
  publishPreparedCatalogs(next.map(catalog => ({ catalog, operations: extractOperations(catalog.document, catalog.id),
    sourceIdentity: sourceIdentity(catalog) })));
}
