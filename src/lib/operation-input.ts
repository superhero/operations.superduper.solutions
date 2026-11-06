// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { supportsCredentialResults } from "./credential-results.ts";
import { useGitlabJsonBody } from "./gitlab-form.ts";
import { mistralVariantRoute, mistralVariantInputs } from "./mistral-variant.ts";
import { gmailMessageMode, prepareGmailMessage, gmailMimeInputKey } from "./gmail-message.ts";
import { mediaUploadMode, prepareMediaUpload, mediaUploadInputKey } from "./media-upload.ts";
import { validDigitalOceanUpload, prepareDigitalOceanAgent } from "./digitalocean-destinations.ts";
import { operationBlockReason } from "./operation-capabilities.ts";
import { awsRestUsesS3Keys } from "./aws-rest.ts";
import { prepareAwsRestRequest } from "./aws-rest-codec.ts";
import { awsJsonWireRequest, validAwsJsonModel } from "./aws-json.ts";
import { prepareAwsQueryRequest } from "./aws-query.ts";
import { prepareAwsWireRequest } from "./aws-wire.ts";
import { encodeS3Key, validateS3Bucket, s3MetadataHeaders } from "./s3-files.ts";
import type { BodyMediaType, InputField, InputSchema, JsonValue, Operation } from "./catalog.ts";
import { validateWorkflowBinary, binaryRequestMediaType, validateBinarySchema } from "./workflow-binary.ts";
import { supportsFormField } from "./form-input.ts";
import { validateMultipartParts, validateMultipartValue, type MultipartParts } from "./multipart-parts.ts";
import { responseStreamProfile } from "./workflow-response-stream.ts";
import type { QuerySerialization } from "./query-serialization.ts";
import { encodeSimplePathArray, encodeSimpleHeaderArray } from "./parameter-serialization.ts";
import { isJsonLinesRequestMediaType, validateJsonLinesBody } from "./request-media.ts";
import { literalQueryRoute, validateLiteralQueryFields } from "./literal-query.ts";

export type InputValue = string | null | undefined;
export type InputValues = Record<string, InputValue>;

export function inputAllowsNull(input: InputSchema | InputField): boolean
{
  const schema = "schema" in input && input.schema ? input.schema : input;
  return (schema.type === "null" || schema.nullable === true) && (!schema.enum || schema.enum.includes(null));
}

export type PreparedRequest = {
  method: string;
  path: string;
  query: Record<string, JsonValue>;
  querySerialization?: Record<string, QuerySerialization>;
  body?: JsonValue;
  headers?: Record<string, string>;
  contentType?: Exclude<BodyMediaType, "application/json">;
  bodyFormat?: "binary" | "text" | "cloudflare-assets" | "cloudflare-module" | "gmail-related" | "google-related";
  multipartParts?: MultipartParts;
  /** Derived from a reviewed S3 Control ARN, never from an arbitrary destination. */
  awsRestOutpost?: { region: string; account: string; id: string };
  /** The SQS queue URL must match the separately approved service authority. */
  awsQueryOrigin?: string;
};

export class InputValidationError extends Error
{
  fieldKey: string;
  constructor(fieldKey: string, message: string) { super(message); this.fieldKey = fieldKey; this.name = "InputValidationError"; }
}

function fail(input: InputField, message: string): never
{
  throw new InputValidationError(input.key, `${input.label}: ${message}`);
}

function validateJson(input: InputField, value: JsonValue, path: string): void
{
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") fail(input, `${path} must be a valid JSON value.`);
  for (const [name, item] of Object.entries(value)) validateJson(input, item, `${path}.${name}`);
}

/** JSON equality ignores object member order and preserves array order. */
function equalityKey(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(equalityKey).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${equalityKey(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

function validate(input: InputField, schema: InputSchema, value: JsonValue, path: string): void
{
  const type = schema.type;
  if (schema.anyOf !== undefined || schema.oneOf !== undefined) {
    if (value === null && schema.nullable && inputAllowsNull(schema)) return;
    const branches = schema.anyOf ?? schema.oneOf;
    if (schema.anyOf !== undefined && schema.oneOf !== undefined || !Array.isArray(branches) || branches.length < 2 || branches.length > 32)
      fail(input, `${path} has an invalid schema union.`);
    let matches = 0;
    for (const branch of branches!) try { validate(input, branch, value, path); matches++; } catch (error) { if (!(error instanceof InputValidationError)) throw error; }
    if (schema.oneOf ? matches !== 1 : matches === 0) fail(input, `${path} must match ${schema.oneOf ? "exactly one" : "an"} allowed schema alternative.`);
    return;
  }
  if (schema.format === "binary") {
    try { validateBinarySchema(schema); }
    catch (error) { fail(input, (error as Error).message); }
    if (value === null) fail(input, "explicit null has no qualified file encoding; omit an optional field or upload a file.");
    let file;
    try { file = validateWorkflowBinary(value); }
    catch { fail(input, `${path} must be an uploaded binary file.`); }
    if (schema.minLength !== undefined && file.size < schema.minLength || schema.maxLength !== undefined && file.size > schema.maxLength)
      fail(input, `${path} file size is outside the allowed range.`);
    return;
  }
  if (type === "json") { validateJson(input, value, path); return; }
  if (value === null && (type === "null" || schema.nullable))
  {
    if (!inputAllowsNull(schema)) fail(input, `${path} choose one of the allowed values.`);
    return;
  }
  const matches = type === "null" ? value === null : type === "array" ? Array.isArray(value)
    : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "integer" ? Number.isInteger(value) : typeof value === type;
  if (!matches || typeof value === "number" && !Number.isFinite(value)) fail(input, `${path} must be a valid ${type}.`);
  if (typeof value === "number" && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum))
    fail(input, `${path} value is outside the allowed range.`);
  if (typeof value === "string" && (schema.minLength !== undefined && [...value].length < schema.minLength
    || schema.maxLength !== undefined && [...value].length > schema.maxLength)) fail(input, `${path} text length is outside the allowed range.`);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail(input, `${path} does not match the required pattern.`);
  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) fail(input, `${path} choose one of the allowed values.`);
  if (type === "array")
  {
    const items = value as JsonValue[];
    if (schema.minItems !== undefined && items.length < schema.minItems || schema.maxItems !== undefined && items.length > schema.maxItems)
      fail(input, `${path} item count is outside the allowed range.`);
    items.forEach((item, index) => schema.items ? validate(input, schema.items, item, `${path}[${index}]`)
      : validateJson(input, item, `${path}[${index}]`));
    if (schema.uniqueItems && new Set(items.map(equalityKey)).size !== items.length)
      fail(input, `${path} items must be unique.`);
  }
  if (type === "object")
  {
    const properties = value as Record<string, JsonValue>;
    const names = Object.keys(properties);
    if (schema.requiredOneOf !== undefined) {
      if (!Array.isArray(schema.requiredOneOf) || schema.requiredOneOf.length < 2 || schema.requiredOneOf.length > 16
        || schema.requiredOneOf.some(branch => !Array.isArray(branch) || !branch.length || branch.length > 200
          || new Set(branch).size !== branch.length || branch.some(name => typeof name !== "string" || !Object.hasOwn(schema.properties ?? {}, name))))
        fail(input, `${path} has an invalid exclusive required-field contract.`);
      if (schema.requiredOneOf.filter(branch => branch.every(name => Object.hasOwn(properties, name))).length !== 1)
        fail(input, `${path} must supply exactly one of ${schema.requiredOneOf.map(branch => branch.map(name => JSON.stringify(name)).join(" + ")).join(" or ")}.`);
    }
    if (schema.minProperties !== undefined && names.length < schema.minProperties || schema.maxProperties !== undefined && names.length > schema.maxProperties)
      fail(input, `${path} property count is outside the allowed range.`);
    if (schema.propertyNames) for (const name of names) validate(input, schema.propertyNames, name, `${path} property name ${JSON.stringify(name)}`);
    for (const name of schema.required ?? []) if (!Object.hasOwn(properties, name)) fail(input, `${path}.${name} is required.`);
    for (const [name, item] of Object.entries(properties))
    {
      if (Object.hasOwn(schema.properties ?? {}, name)) validate(input, schema.properties![name]!, item, `${path}.${name}`);
      else if (schema.additionalProperties === false) fail(input, `${path}.${name} is not a declared property.`);
      else if (typeof schema.additionalProperties === "object") validate(input, schema.additionalProperties, item, `${path}.${name}`);
      else validateJson(input, item, `${path}.${name}`);
    }
  }
}

export function validateInputValue(input: InputField, value: JsonValue): void
{
  validate(input, input.schema ?? { ...input, required: [] }, value, "value");
}

function convert(input: InputField, raw: string | null): JsonValue
{
  if (raw === null)
  {
    validateInputValue(input, null);
    return null;
  }
  let value: JsonValue = raw;
  if (input.format === "binary" || input.type === "object" || input.type === "array" || input.type === "null" || input.type === "json")
  {
    try { value = JSON.parse(raw); }
    catch { fail(input, "enter valid JSON."); }
    validateInputValue(input, value);
    return value;
  }
  if (input.type === "boolean")
  {
    if (raw !== "true" && raw !== "false") fail(input, "choose true or false.");
    value = raw === "true";
  }
  if (input.type === "number" || input.type === "integer")
  {
    value = Number(raw);
    if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(value)
      || input.type === "integer" && !Number.isInteger(value)) fail(input, `enter a valid ${input.type}.`);
    if (input.minimum !== undefined && value < input.minimum || input.maximum !== undefined && value > input.maximum)
      fail(input, "value is outside the allowed range.");
  }
  if (typeof value === "string" && (input.minLength !== undefined && [...value].length < input.minLength
    || input.maxLength !== undefined && [...value].length > input.maxLength)) fail(input, "text length is outside the allowed range.");
  if (input.enum && !input.enum.includes(value as string | number | boolean)) fail(input, "choose one of the allowed values.");
  validateInputValue(input, value);
  return value;
}

function set(target: object, name: string, value: JsonValue)
{
  Object.defineProperty(target, name, { value, enumerable: true, configurable: true });
}

/** Resolve a concrete workflow property against the authoritative request-body schema. */
export function additionalBodyField(operation: Operation, name: string, type: InputSchema["type"]): InputField | undefined
{
  const root = operation.bodySchema;
  if (operation.bodyValue || root?.type !== "object" || root.additionalProperties === false || Object.hasOwn(root.properties ?? {}, name)) return;
  const schema: InputSchema = typeof root.additionalProperties === "object" ? root.additionalProperties : { type };
  if (!["string", "number", "integer", "boolean", "object", "array", "null"].includes(schema.type)) return;
  return { ...schema, key: `body:${name}`, name, label: name || "(empty name)", description: "", location: "body",
    required: root.required?.includes(name) ?? false, schema };
}

export function prepareRequest(operation: Operation, values: InputValues, workflowFields: InputField[] = operation.fields): PreparedRequest
{
  if (operation.deferred) throw new Error("Load this operation's schema before preparing a request.");
  if (operation.protocol === "json-rpc" || operation.rpc !== undefined || operation.method === "RPC")
    throw new Error(operation.unavailableReason ?? "Native RPC execution requires a paired runtime.");
  if (operationBlockReason(operation)) throw new Error(operationBlockReason(operation));
  if ((operation.credentialResult !== undefined || operation.credentialResultProfile !== undefined) && !supportsCredentialResults(operation)) throw new Error("This operation returns credentials. Its private result adoption contract has not been qualified.");
  responseStreamProfile(operation.responseStream);
  if (operation.privatePath !== undefined && operation.privatePath !== "telegram-bot"
    && (operation.privatePath !== "digitalocean-upload" || !validDigitalOceanUpload(operation))) throw new Error("This private token path is not supported.");
  const route = literalQueryRoute(operation.path);
  let variant: ReturnType<typeof mistralVariantRoute>;
  try { variant = mistralVariantRoute(operation); values = mistralVariantInputs(operation, values); }
  catch (cause) { throw new InputValidationError("body:stream", (cause as Error).message); }
  try { validateLiteralQueryFields(operation.path, operation.fields); }
  catch (cause) { throw new InputValidationError("query:beta", (cause as Error).message); }
  const request: PreparedRequest = { method: operation.method, path: variant?.path ?? route?.path ?? operation.path, query: { ...route?.query } };
  let media: ReturnType<typeof mediaUploadMode>;
  try { media = mediaUploadMode(operation, values); }
  catch (cause) { throw new InputValidationError(mediaUploadInputKey, (cause as Error).message); }
  let gmail: ReturnType<typeof gmailMessageMode>;
  try { gmail = gmailMessageMode(operation, values); }
  catch (cause) { throw new InputValidationError(gmailMimeInputKey, (cause as Error).message); }
  const jsonForm = useGitlabJsonBody(operation, values);
  if (operation.multipartParts !== undefined) {
    if (operation.bodyMediaType !== "multipart/form-data" || !operation.bodySchema) throw new InputValidationError("body:$", "Multipart part contracts require a named multipart body.");
    validateMultipartParts(operation.multipartParts, operation.bodySchema);
    if (!jsonForm) request.multipartParts = structuredClone(operation.multipartParts);
  }
  const body: Record<string, JsonValue> = {};
  const fields = operation.fields.filter(field => (!gmail || field.key !== gmailMimeInputKey) && (!media || field.key !== mediaUploadInputKey));
  if (operation.s3Files || operation.awsWire || operation.awsRest || operation.awsJson || operation.awsQuery) for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && !fields.some(field => field.key === key))
      throw new InputValidationError(key, "This input is outside the supported AWS operation profile.");
  }
  for (const candidate of workflowFields)
  {
    if (gmail && candidate.key === gmailMimeInputKey || media && candidate.key === mediaUploadInputKey) continue;
    if (candidate.location !== "body" || fields.some(field => field.key === candidate.key)) continue;
    const input = candidate.key === `body:${candidate.name}` && additionalBodyField(operation, candidate.name, candidate.type);
    if (!input) fail(candidate, "this body property is not allowed by the operation schema.");
    fields.push(input);
  }
  const supplied = (input: InputField) => values[input.key] === null || Boolean((values[input.key] ?? "").trim()
    || input.location === "body" && input.type === "string" && operation.bodySchema?.type === "object"
      && !operation.bodyValue && !Object.hasOwn(operation.bodySchema.properties ?? {}, input.name) && values[input.key] !== undefined);
  const hasBody = operation.bodyRequired || fields.some(input => input.location === "body" && supplied(input));
  for (const input of fields)
  {
    const raw = values[input.key];
    if (!supplied(input))
    {
      if (input.required && (input.location !== "body" || hasBody)) fail(input, "this field is required.");
      continue;
    }
    const value = convert(input, raw!);
    if (input.querySerialization !== undefined && (input.querySerialization !== "form-csv" || input.location !== "query" || input.type !== "array"))
      fail(input, "this query serialization is not supported.");
    if (input.parameterContentType !== undefined) {
      if (input.parameterContentType !== "application/json" || !["path", "query"].includes(input.location) || input.querySerialization !== undefined)
        fail(input, "this content parameter serialization is not supported.");
      const serialized = JSON.stringify(value);
      if (input.location === "path") request.path = request.path.replaceAll(`{${input.name}}`, encodeURIComponent(serialized));
      else set(request.query, input.name, serialized);
    }
    else if (input.location === "path") {
      let encoded: string;
      try {
        if (input.type === "array" && !operation.s3Files) encoded = encodeSimplePathArray(input, value);
        else {
          if (value !== null && typeof value === "object") throw new Error("path values must be primitive values or supported simple arrays.");
          encoded = operation.s3Files || awsRestUsesS3Keys(operation)
            ? input.name === "Key" ? encodeS3Key(String(value)) : input.name === "Bucket" ? encodeURIComponent(validateS3Bucket(String(value))) : encodeURIComponent(String(value))
            : encodeURIComponent(String(value));
        }
      }
      catch (cause) { fail(input, (cause as Error).message); }
      request.path = request.path.replaceAll(`{${input.name}}`, encoded!);
    }
    else if (input.location === "query")
    {
      if (input.querySerialization === "form-csv") {
        if (!Array.isArray(value) || value.some(item => item === null || typeof item === "object"))
          fail(input, "comma-separated query arrays require non-null primitive items; omit a nullable array instead of sending null.");
        if (!value.length) {
          if (input.required) fail(input, "an empty array cannot supply a required query parameter.");
          continue;
        }
        request.querySerialization ??= {};
        set(request.querySerialization, input.name, "form-csv");
      }
      if (input.type === "json" && value !== null && typeof value === "object" && !Array.isArray(value)
        || Array.isArray(value) && value.some(item => item !== null && typeof item === "object"))
        fail(input, "this structured query serialization is not supported.");
      if (input.type === "object" && value !== null) for (const [name, item] of Object.entries(value as Record<string, JsonValue>))
      {
        if (item !== null && typeof item === "object") fail(input, "deepObject query values must be primitive values.");
        set(request.query, `${input.name}[${name}]`, item);
      }
      else set(request.query, input.name, value);
    }
    else if (input.location === "header")
    {
      if (operation.s3Files === "put-object" && input.name === "x-amz-meta-") {
        try { request.headers = { ...request.headers, ...s3MetadataHeaders(value) }; }
        catch (cause) { fail(input, (cause as Error).message); }
        continue;
      }
      let header: string;
      try {
        if (input.type === "array") header = encodeSimpleHeaderArray(input, value);
        else {
          if (value !== null && typeof value === "object") throw new Error("header values must be primitive values or simple arrays.");
          header = String(value);
        }
      } catch (cause) { fail(input, (cause as Error).message); }
      if (/[\r\n]/.test(header)) fail(input, "header values cannot contain line breaks.");
      request.headers ??= {};
      set(request.headers, input.name, header);
    }
    else if (operation.bodyValue) request.body = value;
    else
    {
      const part = !jsonForm && Object.hasOwn(operation.multipartParts ?? {}, input.name) ? operation.multipartParts![input.name] : undefined;
      if (part) try { validateMultipartValue(input.name, part, value); } catch (cause) { fail(input, (cause as Error).message); }
      if (!jsonForm && (operation.bodyMediaType === "application/x-www-form-urlencoded" || operation.bodyMediaType === "multipart/form-data") && value === null && !["json", "json-text"].includes(part?.kind ?? ""))
        fail(input, "explicit null has no qualified form encoding; omit an optional field or provide a value.");
      if (!jsonForm && (operation.bodyMediaType === "application/x-www-form-urlencoded" || operation.bodyMediaType === "multipart/form-data")
        && !supportsFormField(input.schema ?? input, operation.bodyMediaType === "multipart/form-data") && !part)
        fail(input, "form body properties must be primitive values, primitive arrays or declared binary files.");
      set(body, input.name, value);
    }
  }
  if (hasBody)
  {
    if (!operation.bodyValue) request.body = body;
    if (operation.bodySchema) validateInputValue({ key: "body:$", name: "$", label: "Request body", description: "", location: "body",
      type: operation.bodySchema.type, required: operation.bodyRequired, schema: operation.bodySchema }, request.body!);
    if (!jsonForm && operation.bodyMediaType && operation.bodyMediaType !== "application/json") request.contentType = operation.bodyMediaType;
    if (operation.binaryMediaTypes) {
      request.contentType = binaryRequestMediaType(operation.binaryMediaTypes, request.body!) as BodyMediaType;
      request.bodyFormat = "binary";
    }
    else if (isJsonLinesRequestMediaType(operation.bodyMediaType ?? "")) {
      try { validateJsonLinesBody(request.body); }
      catch (cause) { throw new InputValidationError("body:$", `Request body: ${(cause as Error).message}`); }
      request.bodyFormat = "text";
    }
  }
  if (operation.cloudflareUpload === "workers-upload") { request.bodyFormat = "cloudflare-assets"; request.contentType = "multipart/form-data"; }
  if (operation.privatePath === "digitalocean-upload") {
    const type = request.headers?.["Content-Type"] ?? "application/octet-stream";
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(type)) throw new InputValidationError("header:Content-Type", "Use the exact valid media type expected by the signed upload URL.");
    request.contentType = type as BodyMediaType;
  }
  if (["workers-version", "workers-module", "platform-module"].includes(operation.cloudflareUpload ?? "")) {
    request.bodyFormat = "cloudflare-module"; request.contentType = "multipart/form-data";
  }
  if (operation.awsQuery) return prepareAwsQueryRequest(operation, request);
  if (operation.awsJson) {
    if (!validAwsJsonModel(operation)) throw new InputValidationError("body", "This AWS JSON target no longer matches its reviewed contract.");
    const wire = awsJsonWireRequest(operation, request.body);
    return { ...request, path: wire.path, query: {}, headers: { "X-Amz-Target": wire.headers["X-Amz-Target"] },
      body: new TextDecoder().decode(wire.bytes), bodyFormat: "text", contentType: wire.headers["Content-Type"] as `${string}/${string}` };
  }
  return prepareDigitalOceanAgent(operation, prepareMediaUpload(operation, operation.awsRest ? prepareAwsRestRequest(operation, request)
    : operation.awsWire ? prepareAwsWireRequest(operation, request) : prepareGmailMessage(request, gmail), media));
}
