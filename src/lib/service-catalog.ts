// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { BodyMediaType, InputField, InputSchema, Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";
import { extractOperationSecurity } from "./operation-security.ts";
import { operationServerUrl, validateSchemaDocumentId } from "./schema-documents.ts";

type Value = Record<string, unknown>;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const primitives = ["string", "number", "integer", "boolean", "null"];
const annotation = new Set(["title", "description", "default", "example", "examples", "deprecated", "format", "externalDocs", "xml", "readOnly", "writeOnly"]);
const constraints = new Set(["type", "nullable", "enum", "const", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "properties", "required", "additionalProperties", "items"]);
const value = (input: unknown): Value => input && typeof input === "object" && !Array.isArray(input) ? input as Value : {};
const text = (input: unknown, fallback = ""): string => typeof input === "string" ? input : fallback;
const json = (): InputSchema => ({ type: "json" });

/** Resolve schema references without expanding recursive models or discarding siblings. */
function resolve(input: unknown, document: Value): Value
{
  let result = value(input);
  const seen = new Set<string>();
  while (typeof result.$ref === "string")
  {
    const ref = result.$ref;
    if (!ref.startsWith("#/") || seen.has(ref)) return { type: "json" };
    seen.add(ref);
    const target = ref.slice(2).split("/").reduce<unknown>((parent, part) => {
      const object = parent && typeof parent === "object" ? parent as Value : {};
      const key = decodeURIComponent(part).replace(/~1/g, "/").replace(/~0/g, "~");
      return Object.hasOwn(object, key) ? object[key] : undefined;
    }, document);
    if (!target || typeof target !== "object") throw new Error(`Unresolved schema reference: ${ref}`);
    const { $ref: _ref, ...siblings } = result;
    if (Object.keys(siblings).some(key => !annotation.has(key) && !key.startsWith("x-"))) return { type: "json" };
    result = { ...value(target), ...siblings };
  }
  return result;
}

/** Keep familiar controls where their constraints are representable. Other JSON
 * Schema vocabularies remain in the source and use explicit server validation. */
function inputSchema(input: unknown, document: Value, depth = 0, ancestors = new Set<unknown>()): InputSchema
{
  if (depth > 8 || ancestors.has(input)) return json();
  const shape = resolve(input, document);
  const variants = shape.anyOf ?? shape.oneOf;
  if (Array.isArray(variants) && variants.length === 2)
  {
    const nonNull = variants.filter(item => value(item).type !== "null");
    if (nonNull.length === 1) return { ...inputSchema(nonNull[0], document, depth + 1, ancestors), nullable: true };
  }
  if (Object.keys(shape).some(key => !constraints.has(key) && !annotation.has(key) && !key.startsWith("x-"))) return json();
  const types = Array.isArray(shape.type) ? shape.type.filter(type => type !== "null") : [shape.type];
  const type = types.length === 1 ? types[0] : undefined;
  const inferred = type ?? (shape.properties ? "object" : shape.items ? "array" : typeof shape.const === "string" ? "string" : undefined);
  if (typeof inferred !== "string" || ![...primitives, "object", "array"].includes(inferred)) return json();
  if (shape.enum !== undefined && (!Array.isArray(shape.enum) || shape.enum.some(item => item !== null && !["string", "number", "boolean"].includes(typeof item)))) return json();
  if (Object.hasOwn(shape, "const") && shape.const !== null && !["string", "number", "boolean"].includes(typeof shape.const)) return json();
  const result: InputSchema = { type: inferred as InputSchema["type"] };
  if (shape.nullable === true || Array.isArray(shape.type) && shape.type.includes("null")) result.nullable = true;
  if (Array.isArray(shape.enum) && shape.enum.every(item => item === null || ["string", "number", "boolean"].includes(typeof item)))
    result.enum = shape.enum as NonNullable<InputSchema["enum"]>;
  if (Object.hasOwn(shape, "const") && (shape.const === null || ["string", "number", "boolean"].includes(typeof shape.const))) result.enum = [shape.const as string | number | boolean | null];
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"] as const)
    if (typeof shape[key] === "number" && Number.isFinite(shape[key])) result[key] = shape[key];
  if (typeof shape.pattern === "string")
  {
    try { new RegExp(shape.pattern, "u"); result.pattern = shape.pattern; } catch { return json(); }
  }
  const next = new Set([...ancestors, input]);
  if (inferred === "array") result.items = inputSchema(shape.items, document, depth + 1, next);
  if (inferred === "object")
  {
    const properties = Object.entries(value(shape.properties)).filter(([, property]) => resolve(property, document).readOnly !== true);
    if (properties.length > 200) return json();
    result.properties = Object.fromEntries(properties.map(([name, property]) => [name, inputSchema(property, document, depth + 1, next)]));
    if (Array.isArray(shape.required) && shape.required.some(name => typeof name !== "string" || !Object.hasOwn(value(shape.properties), name))) return json();
    result.required = Array.isArray(shape.required) ? shape.required.filter((name): name is string => typeof name === "string" && Object.hasOwn(result.properties!, name)) : [];
    result.additionalProperties = typeof shape.additionalProperties === "boolean" ? shape.additionalProperties
      : shape.additionalProperties && Object.keys(value(shape.additionalProperties)).length ? inputSchema(shape.additionalProperties, document, depth + 1, next) : true;
  }
  return result;
}

function field(name: string, location: InputField["location"], raw: unknown, required: boolean, document: Value, description: unknown): InputField
{
  const schema = inputSchema(raw, document);
  const shape = resolve(raw, document);
  const defaultValue = required && location !== "body" && ["string", "number", "boolean"].includes(typeof shape.default)
    ? schema.type === "json" ? JSON.stringify(shape.default) : String(shape.default) : undefined;
  return { ...schema, schema, ...(defaultValue !== undefined ? { defaultValue } : {}), key: `${location}:${name}`, name, location, required,
    label: text(shape.title, name === "$" ? "Request body" : name.replace(/[_-]/g, " ").replace(/^./, letter => letter.toUpperCase())),
    description: [text(description, text(shape.description)), ...(schema.type === "json" ? ["Enter a JSON value. Advanced schema rules are validated by the API."] : [])].filter(Boolean).join("\n\n") };
}

/** OAuth access tokens use the existing bearer transport. Keep the original
 * scope requirements in the approved operation; no login flow is synthesized. */
function security(document: Value, source: Value, operation: Operation): Operation["security"]
{
  const declaration = source.security ?? document.security;
  if (!Array.isArray(declaration)) return extractOperationSecurity(document, source);
  const schemes = value(value(document.components).securitySchemes);
  const normalizedSchemes = { ...schemes };
  let oauth = false;
  const requirements = declaration.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Security requirements must be objects.");
    return Object.fromEntries(Object.entries(raw).map(([name, scopes]) => {
      const definition = resolve(schemes[name], document);
      if (definition.type !== "oauth2") return [name, scopes];
      if (!Array.isArray(scopes) || scopes.some(scope => typeof scope !== "string")) throw new Error("OAuth scopes must be strings.");
      oauth = true;
      Object.defineProperty(normalizedSchemes, name, { value: { type: "http", scheme: "bearer" }, enumerable: true, configurable: true });
      return [name, []];
    }));
  });
  if (oauth) operation.oauthScopes = declaration.map(raw => Object.fromEntries(Object.entries(raw).map(([name, scopes]) => [name, [...scopes as string[]]])));
  return extractOperationSecurity({ ...document, components: { ...value(document.components), securitySchemes: normalizedSchemes } }, { security: requirements });
}

export function inspectServiceSchema(document: Value, id: string, selected?: ReadonlySet<string>, location?: Pick<Operation, "path" | "method">): {
  document: Value; operations: Operation[]; name: string; serverUrl: string; groups: CatalogGroup[];
}
{
  validateSchemaDocumentId(id);
  if (!/^3\.(0|1)\.\d+$/.test(text(document.openapi)) || typeof value(document.info).title !== "string" || !Object.keys(value(document.paths)).length)
    throw new Error("The service schema must declare OpenAPI 3.0/3.1, a title and HTTP paths.");
  const operations: Operation[] = [];
  const identities = new Set<string>();
  const groups = new Map<string, CatalogGroup>();
  let serverUrl = "";
  const paths = value(document.paths);
  for (const [path, rawItem] of location ? [[location.path, paths[location.path]] as const] : Object.entries(paths))
  {
    if (!path.startsWith("/")) continue;
    const item = resolve(rawItem, document);
    for (const [method, rawOperation] of location ? [[location.method.toLowerCase(), item[location.method.toLowerCase()]] as const] : Object.entries(item))
    {
      if (!methods.has(method)) continue;
      const source = value(rawOperation);
      const identity = `${id}:${text(source.operationId, `${method.toUpperCase()} ${path}`)}`;
      if (selected && !selected.has(identity)) continue;
      if (identities.has(identity)) throw new Error(`Duplicate service operation: ${identity}`);
      identities.add(identity);
      const group = Array.isArray(source.tags) ? text(source.tags[0], "Operations") : "Operations";
      const operation: Operation = { id: identity, name: text(source.summary, text(source.operationId, `${method.toUpperCase()} ${path}`)),
        description: text(source.description), group, method: method.toUpperCase(), path, fields: [], bodyRequired: false };
      try
      {
        const url = operationServerUrl(document, operation);
        serverUrl ||= url;
        if (new URL(url).hostname === "no-default") throw new Error("Configure this schema’s server URL for your account before running it.");
        if (path.includes("//") || /[\\?#\u0000-\u0020\u007f]/.test(path)) throw new Error("This endpoint uses a path or transport that is not supported.");
        const fields = new Map<string, InputField>();
        for (const parameters of [item.parameters, source.parameters])
        {
          if (parameters === undefined) continue;
          if (!Array.isArray(parameters)) throw new Error("Parameters must be an array.");
          for (const raw of parameters)
          {
            const parameter = resolve(raw, document);
            const location = text(parameter.in);
            if (!["path", "query", "header"].includes(location) || typeof parameter.name !== "string") throw new Error("Cookie or content-encoded parameters are not supported.");
            const input = field(parameter.name, location as InputField["location"], parameter.schema, parameter.required === true, document, parameter.description);
            const style = location === "query" ? input.type === "object" ? "deepObject" : "form" : "simple";
            if (parameter.content || parameter.style !== undefined && parameter.style !== style
              || parameter.explode !== undefined && parameter.explode !== (location === "query")
              || location !== "query" && ["object", "array"].includes(input.type)) throw new Error("This parameter serialization is not supported.");
            fields.set(location === "header" ? input.key.toLowerCase() : input.key, input);
          }
        }
        operation.fields = [...fields.values()];
        if (source.requestBody !== undefined)
        {
          const body = resolve(source.requestBody, document);
          const content = value(body.content);
          const mediaType = ["application/json", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].find(type => content[type]);
          if (!mediaType) throw new Error("This request requires an unsupported binary or streaming media type.");
          const schema = resolve(value(content[mediaType]).schema, document);
          const parsed = inputSchema(schema, document);
          operation.bodyRequired = body.required === true;
          operation.bodyMediaType = mediaType as BodyMediaType;
          operation.bodySchema = parsed;
          if (mediaType === "text/plain" && parsed.type !== "string") throw new Error("This text body requires an unsupported schema.");
          if (mediaType.endsWith("form-data") || mediaType.endsWith("form-urlencoded"))
            if (parsed.type !== "object" || Object.values(value(schema.properties)).some(property => resolve(property, document).format === "binary")
              || Object.values(parsed.properties!).some(property => !primitives.includes(property.type) || property.nullable))
              throw new Error("This form requires binary or structured fields that are not supported.");
          if (parsed.type === "object" && !parsed.nullable)
            for (const [name, property] of Object.entries(value(schema.properties)))
            {
              if (resolve(property, document).readOnly === true) continue;
              operation.fields.push(field(name, "body", property, parsed.required!.includes(name), document, undefined));
            }
          else
          {
            operation.bodyValue = true;
            operation.fields.push(field("$", "body", schema, true, document, body.description));
          }
        }
        const placeholders = [...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);
        if (placeholders.some(name => !operation.fields.some(field => field.location === "path" && field.name === name)))
          throw new Error("This endpoint uses unsupported URI template expansion.");
        const requirements = source.security ?? document.security;
        if (Array.isArray(requirements)) for (const requirement of requirements) for (const name of Object.keys(value(requirement))) {
          const scheme = resolve(value(value(document.components).securitySchemes)[name], document);
          if (scheme["x-amazon-apigateway-authtype"] === "awsSigv4") throw new Error("This API requires AWS Signature Version 4 request signing, which is not supported here.");
        }
        const authorization = security(document, source, operation);
        if (authorization !== undefined) operation.security = authorization;
        const responses = value(source.responses);
        const response = resolve(responses[Object.keys(responses).find(status => /^2\d\d$/.test(status)) ?? "default"], document);
        const content = value(response.content);
        const mediaType = content["application/json"] ? "application/json" : Object.keys(content)[0];
        if (mediaType) operation.responseMediaType = mediaType;
        const media = value(content[mediaType!]);
        if (media.example !== undefined) operation.responseExample = media.example;
      }
      catch (error) { operation.unavailableReason = error instanceof Error ? error.message : String(error); }
      operations.push(operation);
      if (!groups.has(group)) groups.set(group, { id: `${id}:tag:${encodeURIComponent(group)}`, name: group, description: "", operationIds: [] });
      groups.get(group)!.operationIds!.push(identity);
    }
  }
  if (!operations.length) throw new Error("The service schema has no HTTP operations.");
  const name = text(value(document.info).title);
  return { document, operations, name, serverUrl, groups: [{ id, name, description: text(value(document.info).description), children: [...groups.values()] }] };
}
