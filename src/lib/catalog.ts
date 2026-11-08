// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { credentialResultProfile, privateResultVersion, supportsCredentialResults } from "./credential-results.ts";
import { parameterContentSchema } from "./parameter-content.ts";
import { operationDisplayName } from "./operation-display.ts";
import { configureGitlabJsonForm } from "./gitlab-form.ts";
import { configureMistralVariant } from "./mistral-variant.ts";
import { configureGmailMessage, requireGmailMessageRoute } from "./gmail-message.ts";
import { configureGithubAutomation, requireGithubAutomationSource } from './github-automations.ts';
import { configureGithubArchive } from './github-archive.ts';
import { configureMediaUpload } from "./media-upload.ts";
import { cloudflareUploadProfile, configureCloudflareUpload, type CloudflareUploadProfile } from "./cloudflare-upload.ts";
import { awsWireProfile, configureAwsWire, validAwsWireModel } from "./aws-wire.ts";
import { configureAwsSigning, validAwsSigningModel } from "./aws-signing.ts";
import { awsRestSigningProfile } from "./aws-rest.ts";
import { awsJsonSigningProfile, configureAwsJson, validAwsJsonModel } from "./aws-json.ts";
import { awsQuerySigningProfile, configureAwsQuery, validAwsQueryModel } from "./aws-query.ts";
import { configureS3Files, s3FilesProfile, validS3FilesModel, type S3FilesProfile } from "./s3-files.ts";
import { catalogs, replaceCatalogs, setOperationCatalog, type Catalog } from "./catalog-registry.ts";
import { inspectOperationSecurity, type CredentialPermissions, type OperationSecurity } from "./operation-security.ts";
import { isBinaryMediaType, containsBinaryInput, validateBinarySchema } from "./workflow-binary.ts";
import { inspectResponseContent, type ResponseContent } from "./workflow-response-body.ts";
import { normalizeStringUnion, validateFormBody } from "./form-input.ts";
import { multipartBodySchema, type MultipartParts } from "./multipart-parts.ts";
import { serviceInputSchema, serviceOperationSecurity } from "./service-catalog.ts";
import { responseStreamProfile, type ResponseStreamProfile } from "./workflow-response-stream.ts";
import { privatePathProfile, type PrivatePathProfile } from "./server-url.ts";
import { codexExecutionLimitation, type NativeRpcContract } from "./native-rpc.ts";
import { isNativeWorkflowOperation } from "./native-account.ts";
import { nativeRuntimeVersion } from "./native-runtime-contract.ts";
import { withOperationCapabilities, type OperationCapabilities, type CapabilitySummary } from "./operation-capabilities.ts";
import { acceptsScalarQueryExplode, configureQueryArray, type QuerySerialization } from "./query-serialization.ts";
import { configureSimplePathArray, configureSimpleHeaderArray, parameterContext, validatePathParameters } from "./parameter-serialization.ts";
import { isJsonRequestMediaType, isYamlRequestMediaType, isJsonLinesRequestMediaType } from "./request-media.ts";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type InputSchema = {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | "json";
  format?: "binary";
  pattern?: string;
  nullable?: boolean;
  enum?: (string | number | boolean | null)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  propertyNames?: InputSchema;
  properties?: Record<string, InputSchema>;
  additionalProperties?: boolean | InputSchema;
  required?: string[];
  /** Exactly one required-only object branch must match the supplied names. */
  requiredOneOf?: string[][];
  anyOf?: InputSchema[];
  oneOf?: InputSchema[];
  items?: InputSchema;
};
export type InputField = Omit<InputSchema, "properties" | "required" | "items"> & {
  key: string;
  defaultValue?: string;
  name: string;
  label: string;
  description: string;
  location: "path" | "query" | "header" | "body" | "params";
  required: boolean;
  querySerialization?: QuerySerialization;
  parameterContentType?: "application/json";
  schema?: InputSchema;
};
export type BodyMediaType = `${string}/${string}`;
export type Operation = {
  /** Optional explicitly paired Unix-socket route; configured HTTP remains independent. */
  dockerNative?: { profile: "docker-unix-read-v1"; apiVersion: "1.57" };
  protocol?: "json-rpc";
  /** Native wire schemas resolve against this operation's scoped model document. */
  rpc?: NativeRpcContract;
  awsWire?: import("./aws-wire.ts").AwsWireProfile;
  awsRest?: import("./aws-rest.ts").AwsRestSigningProfile;
  awsRestRevision?: string;
  awsJson?: import("./aws-json.ts").AwsJsonSigningProfile;
  awsJsonRevision?: string;
  awsQuery?: import("./aws-query.ts").AwsQuerySigningProfile;
  awsQueryRevision?: string;
  s3Files?: S3FilesProfile;
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
  binaryMediaTypes?: string[];
  bodyValue?: boolean;
  bodySchema?: InputSchema;
  bodyEncoding?: "gitlab-json-or-multipart-v1";
  mistralVariant?: "mistral-fragments-v1";
  gmailMessage?: "gmail-message-v1";
  githubAutomation?: 'github-automations-v1';
  githubArchive?: 'github-migration-archive-v1';
  googleMedia?: "google-media-v1";
  rawUpload?: "raw-upload-v1";
  multipartParts?: MultipartParts;
  responseExample?: unknown;
  responseMediaType?: string;
  /** Per-status media contracts for operations with binary or reviewed streaming responses. */
  responseContent?: ResponseContent;
  /** Reviewed wire framing and terminal JSON assembly, never arbitrary event code. */
  responseStream?: ResponseStreamProfile;
  /** Fixed provider-owned token slot, resolved only through an encrypted connection. */
  privatePath?: PrivatePathProfile;
  /** Reviewed private upload lifecycle and provider-owned wire format. */
  cloudflareUpload?: CloudflareUploadProfile;
  security?: OperationSecurity;
  unavailableReason?: string;
  /** Compact discovery diagnostics; dispatch still resolves the current canonical model. */
  capabilities?: OperationCapabilities;
  capabilitySummary?: CapabilitySummary;
  oauthScopes?: Record<string, string[]>[];
  credentialPermissions?: CredentialPermissions;
  /** Credential acquisition needs a private result handler, not a JSON output. */
  credentialResult?: true;
  credentialResultProfile?: "private-result-v1";
};

type RecordValue = Record<string, unknown>;
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const annotations = ["title", "description", "example", "examples", "default", "deprecated", "x-auditable"];
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
  const shape = normalizeStringUnion(resolve(value, document, context), branch => resolve(branch, document, context));
  const union = Array.isArray(shape.type) ? shape.type : undefined;
  if (union && (union.length !== 2 || !union.includes("null") || new Set(union).size !== 2))
    throw new Error(`${context}: unsupported input type union.`);
  const type = (union ? union.find(type => type !== "null") : shape.type) as InputSchema["type"];
  if (![...primitiveTypes, "object", "array"].includes(type)) throw new Error(`${context}: unsupported input type.`);
  if (shape.nullable !== undefined && typeof shape.nullable !== "boolean") throw new Error(`${context}: nullable must be Boolean.`);
  const nullable = !!union || shape.nullable === true;
  const keys = ["type", "nullable", ...annotations];
  // Reused identifier schemas can mark the identifier read-only on a resource.
  // Supplying that identifier in a route does not write the resource property.
  if (context.startsWith("path:")) for (const annotation of ["readOnly", "writeOnly"]) {
    if (shape[annotation] !== undefined && typeof shape[annotation] !== "boolean") throw new Error(`${context}: ${annotation} must be Boolean.`);
    keys.push(annotation);
  }
  if (type === "string" && shape.format === "binary") keys.push("format");
  if (primitiveTypes.includes(type)) keys.push("enum");
  if (type === "number" || type === "integer") keys.push("minimum", "maximum");
  if (type === "string") keys.push("minLength", "maxLength", "pattern");
  if (type === "array") keys.push("items", "minItems", "maxItems", "uniqueItems");
  if (type === "object") keys.push("properties", "required", "additionalProperties", "minProperties", "maxProperties", "propertyNames");
  // Validate misplaced numeric constraints explicitly, keeping useful diagnostics.
  supported(shape, [...keys, "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"], context);
  const result: InputSchema = { type, ...(nullable ? { nullable: true } : {}) };
  if (shape.uniqueItems !== undefined) {
    if (typeof shape.uniqueItems !== "boolean") throw new Error(`${context}: uniqueItems must be Boolean.`);
    result.uniqueItems = shape.uniqueItems;
  }
  if (shape.pattern !== undefined) {
    if (typeof shape.pattern !== "string") throw new Error(`${context}: pattern must be a string.`);
    try { new RegExp(shape.pattern, "u"); }
    catch { throw new Error(`${context}: invalid pattern constraint.`); }
    result.pattern = shape.pattern;
  }
  if (shape.format === "binary") result.format = "binary";
  if (result.format) validateBinarySchema(shape);
  if (shape.enum !== undefined)
  {
    if (!Array.isArray(shape.enum) || !shape.enum.length || shape.enum.some(value =>
      value === null ? type !== "null" && !nullable : type === "null" || typeof value !== (type === "integer" ? "number" : type)
      || typeof value === "number" && !Number.isFinite(value) || type === "integer" && !Number.isInteger(value)))
      throw new Error(`${context}: enum values must match the input type.`);
    result.enum = shape.enum;
  }
  for (const key of ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"] as const)
  {
    const value = shape[key];
    if (value === undefined) continue;
    const length = key === "minLength" || key === "maxLength";
    const items = key === "minItems" || key === "maxItems";
    const properties = key === "minProperties" || key === "maxProperties";
    if (typeof value !== "number" || !Number.isFinite(value)
      || (length || items || properties ? type !== (length ? "string" : items ? "array" : "object") || !Number.isInteger(value) || value < 0 : type !== "number" && type !== "integer"))
      throw new Error(`${context}: invalid ${key} constraint.`);
    result[key] = value;
  }
  if (result.minimum !== undefined && result.maximum !== undefined && result.minimum > result.maximum
    || result.minLength !== undefined && result.maxLength !== undefined && result.minLength > result.maxLength
    || result.minItems !== undefined && result.maxItems !== undefined && result.minItems > result.maxItems
    || result.minProperties !== undefined && result.maxProperties !== undefined && result.minProperties > result.maxProperties)
    throw new Error(`${context}: minimum exceeds maximum.`);
  if (type === "array") result.items = inputSchema(shape.items, document, `${context}[]`, depth + 1);
  if (type === "object")
  {
    if (shape.propertyNames !== undefined) {
      result.propertyNames = inputSchema(shape.propertyNames, document, `${context}: property names`, depth + 1);
      if (result.propertyNames.type !== "string" || result.propertyNames.format)
        throw new Error(`${context}: property names require a string schema.`);
    }
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
  required: boolean, schemaOverride?: InputSchema): InputField
{
  const context = `${location}:${name}`;
  const shape = resolve(value, document, context);
  const schema = schemaOverride ?? inputSchema(shape, document, context);
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
      if (operation["x-operations-credential-result"] !== undefined && operation["x-operations-credential-result"] !== true)
        throw new Error("Credential result metadata must be true when present.");
      const id = `${source}:${text(operation.operationId, `${method.toUpperCase()} ${path}`)}`;
      if (identities.has(id)) throw new Error(`${source}: duplicate operation identifier ${id}.`);
      identities.add(id);
      if (operation["x-operations-aws-query"] !== undefined) {
        if (operation["x-operations-aws-query"] !== awsQuerySigningProfile) throw new Error("Unknown AWS Query profile.");
        const model: Operation = { id, name: text(operation.summary, text(operation.operationId, `${method.toUpperCase()} ${path}`)),
          description: text(operation.description, ""), group: Array.isArray(operation.tags) ? String(operation.tags[0]) : "Operations",
          method: method.toUpperCase(), path, fields: [], bodyRequired: false, awsQuery: awsQuerySigningProfile };
        model.name = operationDisplayName(model); configureAwsQuery(model);
        const security = inspectOperationSecurity(document, operation); if (security !== undefined) model.security = security;
        if (!validAwsQueryModel(model) || model.credentialResult && !supportsCredentialResults(model)) throw new Error("AWS Query actions require their reviewed signing, input and private result contracts.");
        result.push(withOperationCapabilities(model, [])); continue;
      }
      if (operation["x-operations-aws-json"] !== undefined) {
        if (operation["x-operations-aws-json"] !== awsJsonSigningProfile) throw new Error("Unknown AWS JSON target profile.");
        const model: Operation = { id, name: text(operation.summary, text(operation.operationId, `${method.toUpperCase()} ${path}`)),
          description: text(operation.description, ""), group: Array.isArray(operation.tags) ? String(operation.tags[0]) : "Operations",
          method: method.toUpperCase(), path, fields: [], bodyRequired: false, awsJson: awsJsonSigningProfile };
        model.name = operationDisplayName(model); configureAwsJson(model);
        const security = inspectOperationSecurity(document, operation); if (security !== undefined) model.security = security;
        if (!validAwsJsonModel(model) || model.credentialResult && !supportsCredentialResults(model)) throw new Error("AWS JSON targets require their reviewed signing, input and private result contracts.");
        result.push(withOperationCapabilities(model, [])); continue;
      }
      const upload = cloudflareUploadProfile(operation["x-operations-cloudflare-upload"]);
      const s3 = s3FilesProfile(operation["x-operations-s3-files"]);
      const wire = awsWireProfile(operation["x-operations-aws-wire"]);
      if (upload || s3 || wire) {
        const model: Operation = { id, name: text(operation.summary, text(operation.operationId, `${method.toUpperCase()} ${path}`)),
          description: text(operation.description, ""), group: Array.isArray(operation.tags) ? String(operation.tags[0]) : "Operations",
          method: method.toUpperCase(), path, fields: [], bodyRequired: false };
        model.name = operationDisplayName(model);
        if (wire) configureAwsWire(model, wire); else if (s3) configureS3Files(model, s3); else configureCloudflareUpload(model, upload!);
        const security = inspectOperationSecurity(document, operation);
        if (security !== undefined) model.security = security;
        if (s3 && !validS3FilesModel(model)) throw new Error("S3 objects require their reviewed private signing and byte profile.");
        if (wire && !validAwsWireModel(model)) throw new Error("AWS wire operations require their reviewed private signing and codec profile.");
        result.push(model); continue;
      }
      const inputs = new Map<string, InputField>();
      for (const parameters of [item.parameters, operation.parameters])
      {
        if (parameters === undefined) continue;
        if (!Array.isArray(parameters)) throw new Error(`${id}: parameters must be an array.`);
        const parameterKeys = new Set<string>();
        for (const raw of parameters)
        {
          const parameter = resolve(raw, document, id);
          supported(parameter, ["name", "in", "required", "schema", "content", "description", "deprecated", "style", "explode", "allowReserved", "allowEmptyValue"], `${id}: ${parameterContext(parameter)}`);
          if (!["path", "query", "header"].includes(String(parameter.in)) || typeof parameter.name !== "string" || !parameter.name
            || parameter.required !== undefined && typeof parameter.required !== "boolean"
            || parameter.in === "path" && parameter.required !== true)
            throw new Error(`${id}: ${parameterContext(parameter)}: inputs require a name and a supported path/query/header location; path inputs must be required.`);
          let content;
          try { content = parameterContentSchema(parameter); }
          catch (error) { throw new Error(`${id}: ${parameterContext(parameter)}: ${(error as Error).message}`, { cause: error }); }
          const input = field(content ?? parameter.schema, document, parameter.in as InputField["location"], parameter.name, parameter.required === true);
          const query = input.location === "query";
          const style = query ? input.type === "object" ? "deepObject" : "form" : "simple";
          try {
            if (content) {
              if (containsBinaryInput(input.schema ?? { ...input, required: [] })) throw new Error("JSON content parameters cannot contain binary files.");
              input.parameterContentType = "application/json";
            }
            else {
              const csv = configureQueryArray(input, parameter);
              const scalarQuery = acceptsScalarQueryExplode(input, parameter);
              const pathArray = configureSimplePathArray(input, parameter);
              const headerArray = configureSimpleHeaderArray(input, parameter);
              if (containsBinaryInput(input.schema ?? { ...input, required: [] }) || query && input.type === "object" && parameter.style !== "deepObject"
                || parameter.style !== undefined && parameter.style !== style
                || parameter.explode !== undefined && parameter.explode !== query && !csv && !pathArray && !headerArray && !scalarQuery
                || parameter.allowReserved !== undefined && parameter.allowReserved !== false
                || parameter.allowEmptyValue !== undefined && parameter.allowEmptyValue !== false
                || !query && !primitiveTypes.includes(input.type) && !pathArray && !headerArray
                || input.type === "array" && !primitiveTypes.includes(input.schema!.items!.type)
                || input.type === "object" && objectSchemas(input.schema!).some(property => !primitiveTypes.includes(property.type)))
                throw new Error("unsupported parameter serialization; use primitive values, simple path/header arrays, form query arrays or flat deepObject query objects.");
            }
          } catch (error) {
            throw new Error(`${id}: ${parameterContext(parameter, input.type)}: ${(error as Error).message}`, { cause: error });
          }
          if (input.location === "header" && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(input.name))
            throw new Error(`${id}: ${parameterContext(parameter, input.type)}: invalid header name.`);
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
      let multipartParts: MultipartParts | undefined;
      let binaryMediaTypes: string[] | undefined;
      if (operation.requestBody !== undefined)
      {
        const body = resolve(operation.requestBody, document, `${id}: request body`);
        supported(body, ["required", "description", "content"], id);
        if (body.required !== undefined && typeof body.required !== "boolean") throw new Error(`${id}: body required must be Boolean.`);
        bodyRequired = body.required === true;
        const content = object(body.content, `${id}: request content`);
        const mediaTypes = Object.keys(content);
        if (!mediaTypes.length && bodyRequired) throw new Error(`${id}: required request body has no declared media types.`);
        if (mediaTypes.length) {
          const binary = mediaTypes.length > 0 && mediaTypes.every(type => {
            const shape = resolve(object(content[type], id).schema ?? {}, document, id);
            return isBinaryMediaType(type) && shape.type === "string" && shape.format === "binary";
          });
          if (!binary && (mediaTypes.length !== 1 || !isJsonRequestMediaType(mediaTypes[0]!) && !isYamlRequestMediaType(mediaTypes[0]!) && !isJsonLinesRequestMediaType(mediaTypes[0]!) && !["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"].includes(mediaTypes[0]!)))
            throw new Error(`${id}: choose one supported request media type: JSON (application/json or +json), YAML, JSON Lines, text/plain, application/x-www-form-urlencoded or multipart/form-data. Declared: ${mediaTypes.join(", ")}.`);
          bodyMediaType = mediaTypes[0] as BodyMediaType;
          const media = object(content[bodyMediaType], id);
          const form = bodyMediaType === "application/x-www-form-urlencoded" || bodyMediaType === "multipart/form-data";
          const mistralJson = !form && operation["x-operations-mistral-variant"] !== undefined;
          if (mistralJson) configureMistralVariant({ id, method: method.toUpperCase(), path }, operation["x-operations-mistral-variant"], operation["x-operations-response-stream"]);
          const gmailJson = !form && operation["x-operations-gmail-message"] !== undefined;
          if (gmailJson) requireGmailMessageRoute({ id, method: method.toUpperCase(), path }, operation["x-operations-gmail-message"]);
          const githubJson = !form && requireGithubAutomationSource({ id, method: method.toUpperCase(), path }, operation);
          supported(media, ["schema", "example", "examples", ...(form ? ["encoding"] : [])], id);
          const shape = resolve(media.schema, document, id);
          const encodedForm = bodyMediaType === "multipart/form-data" && (media.encoding !== undefined
            || shape.oneOf !== undefined || shape.$defs !== undefined);
          const compiled = encodedForm ? multipartBodySchema(shape, raw => resolve(raw, document, id), raw => serviceInputSchema(raw, document, true)) : undefined;
          // Reviewed native Mistral JSON uses the same explicit server-validation
          // fallback as service hydration for its heterogeneous conversation unions.
          const schema = compiled?.schema ?? (mistralJson || gmailJson || githubJson ? serviceInputSchema(shape, document, false) : inputSchema(shape, document, id));
          bodySchema = schema;
          if (binary) {
            if (schema.nullable) throw new Error(`${id}: nullable raw-file bodies have no qualified wire encoding.`);
            if (mediaTypes.some(type => {
              const alternative = object(content[type], id);
              supported(alternative, ["schema", "example", "examples"], id);
              return JSON.stringify(inputSchema(alternative.schema, document, id)) !== JSON.stringify(schema);
            }))
              throw new Error(`${id}: binary media alternatives must use the same file schema.`);
            binaryMediaTypes = mediaTypes;
          }
          else if (bodyMediaType !== "multipart/form-data" && containsBinaryInput(schema)) throw new Error(`${id}: binary fields require a raw file body or multipart/form-data.`);
          if ((bodyMediaType === "text/plain" || isJsonLinesRequestMediaType(bodyMediaType)) && schema.type !== "string")
            throw new Error(`${id}: ${bodyMediaType} requires a string schema.`);
          if (form) {
            try {
              const parts = validateFormBody(schema, bodyMediaType === "multipart/form-data", media.encoding, compiled?.mixed);
              if (Object.keys(parts).length) multipartParts = parts;
            }
            catch (error) { throw new Error(`${id}: ${(error as Error).message}`, { cause: error }); }
          }
          if (gmailJson) bodyValue = true; // Named JSON/file choices are configured after parsing the resource.
          else if (schema.type === "object" && !schema.nullable)
            for (const [name, property] of Object.entries(compiled?.properties ?? (shape.properties ?? {}) as RecordValue)) {
              if (encodedForm && !Object.hasOwn(schema.properties!, name)) continue;
              fields.push(field(property, document, "body", name, schema.required!.includes(name), encodedForm || mistralJson || githubJson ? schema.properties?.[name] : undefined));
            }
          else
          {
            bodyValue = true;
            const input = field(media.schema, document, "body", "$", true);
            input.label = text(shape.title, "Request body");
            fields.push(input);
          }
        }
      }
      try { validatePathParameters(path, fields); }
      catch (error) { throw new Error(`${id}: ${(error as Error).message}`, { cause: error }); }
      const tags = operation.tags;
      if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== "string" || !tag.trim())))
        throw new Error(`${id}: tags must be nonempty strings.`);
      const extracted: Operation = { id, name: text(operation.summary, text(operation.operationId, `${method.toUpperCase()} ${path}`)),
        description: text(operation.description, ""), group: Array.isArray(tags) && tags.length ? tags[0] : "Operations",
        method: method.toUpperCase(), path, fields, bodyRequired, ...responseDetails(operation, document, id) };
      if (operation["x-operations-aws-signing"] === awsRestSigningProfile) extracted.awsRest = awsRestSigningProfile;
      extracted.name = operationDisplayName(extracted);
      if (bodyMediaType) extracted.bodyMediaType = bodyMediaType;
      if (binaryMediaTypes) extracted.binaryMediaTypes = binaryMediaTypes;
      if (bodyValue) extracted.bodyValue = true;
      if (bodySchema) extracted.bodySchema = bodySchema;
      if (multipartParts) extracted.multipartParts = multipartParts;
      configureGitlabJsonForm(extracted, operation["x-operations-gitlab-form"]);
      configureGmailMessage(extracted, operation["x-operations-gmail-message"]);
      configureGithubAutomation(extracted, operation);
      configureMediaUpload(extracted, operation["x-operations-google-media"], operation["x-operations-raw-upload"]);
      const stream = responseStreamProfile(operation["x-operations-response-stream"]);
      if (stream) extracted.responseStream = stream;
      configureMistralVariant(extracted, operation["x-operations-mistral-variant"], stream);
      const responseContent = inspectResponseContent(operation.responses, document, stream);
      if (responseContent) extracted.responseContent = responseContent;
      const privatePath = privatePathProfile(operation["x-operations-private-path"]);
      if (privatePath) extracted.privatePath = privatePath;
      if (operation["x-operations-credential-result"] === true) extracted.credentialResult = true;
      if (operation["x-operations-private-result"] === privateResultVersion) extracted.credentialResultProfile = privateResultVersion;
      const security = extracted.gmailMessage || extracted.googleMedia ? serviceOperationSecurity(document, operation, extracted) : inspectOperationSecurity(document, operation);
      if (security !== undefined) extracted.security = security;
      configureGithubArchive(extracted, operation);
      if (security?.flat().some(scheme => scheme.kind === "aws-sigv4")) {
        configureAwsSigning(extracted);
        if (!validAwsSigningModel(extracted)) throw new Error(`${id}: this AWS operation requires a supported REST request and response profile.`);
      }
      if (operation["x-operations-credential-result"] === true) {
        extracted.credentialResult = true;
        if (operation["x-operations-private-result"] !== undefined) {
          if (operation["x-operations-private-result"] !== privateResultVersion) throw new Error("Unknown private credential-result profile.");
          extracted.credentialResultProfile = privateResultVersion; credentialResultProfile(extracted);
        }
        if (!supportsCredentialResults(extracted)) extracted.unavailableReason = "This operation returns credentials. Its private result adoption contract has not been qualified.";
      }
      if (operation["x-operations-private-result"] !== undefined && !extracted.credentialResult) throw new Error("A private result profile requires credential-result metadata.");
      result.push(withOperationCapabilities(extracted, extracted.unavailableReason ? [{ area: "response", code: "unsupported-contract", message: extracted.unavailableReason }] : []));
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

export type OperationModel = { operation: Operation; document: Record<string, unknown>;
  sourceIdentity: string; bytes: number } & ({ protocol?: "http"; origin: string } | { protocol: "json-rpc"; origin?: never });

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
    || (model.protocol === "json-rpc" ? catalog.execution.kind !== "json-rpc" || model.operation.protocol !== "json-rpc"
      || model.operation.rpc?.method !== descriptor.path || model.operation.rpc?.version !== (catalog.document.info as { version?: string })?.version
      || model.operation.unavailableReason !== (isNativeWorkflowOperation(descriptor.path) && model.operation.rpc?.version === nativeRuntimeVersion ? undefined : codexExecutionLimitation) || model.origin !== undefined
      : catalog.execution.kind !== "http" || model.operation.protocol === "json-rpc")
    || !Number.isSafeInteger(model.bytes) || model.bytes < 0)
    throw new Error("The schema changed while its operation was loading. Try again.");
  models.delete(model.operation.id);
  models.set(model.operation.id, model);
  setOperationCatalog(model.operation.id, { ...catalog, document: model.document, execution: model.protocol === "json-rpc"
    ? { kind: "json-rpc" } : { kind: "http", origin: model.origin } });
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
    else setOperationCatalog(id, { ...catalog, document: model.document, execution: model.protocol === "json-rpc"
      ? { kind: "json-rpc" } : { kind: "http", origin: model.origin } });
  }
}

/** Validate every operation before replacing the live registry and operation index together. */
export function updateCatalogs(next: readonly Catalog[]): void
{
  validateCatalogIdentifiers(next);
  publishPreparedCatalogs(next.map(catalog => ({ catalog, operations: extractOperations(catalog.document, catalog.id),
    sourceIdentity: sourceIdentity(catalog) })));
}
