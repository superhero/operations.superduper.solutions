// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { BodyMediaType, InputField, InputSchema, JsonValue, Operation } from "./catalog.ts";

export type PreparedRequest = {
  method: string;
  path: string;
  query: Record<string, JsonValue>;
  body?: JsonValue;
  headers?: Record<string, string>;
  contentType?: Exclude<BodyMediaType, "application/json">;
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

function validate(input: InputField, schema: InputSchema, value: JsonValue, path: string): void
{
  const type = schema.type;
  const matches = type === "null" ? value === null : type === "array" ? Array.isArray(value)
    : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "integer" ? Number.isInteger(value) : typeof value === type;
  if (!matches || typeof value === "number" && !Number.isFinite(value)) fail(input, `${path} must be a valid ${type}.`);
  if (typeof value === "number" && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum))
    fail(input, `${path} value is outside the allowed range.`);
  if (typeof value === "string" && (schema.minLength !== undefined && [...value].length < schema.minLength
    || schema.maxLength !== undefined && [...value].length > schema.maxLength)) fail(input, `${path} text length is outside the allowed range.`);
  if (schema.enum && !schema.enum.includes(value as string | number | boolean | null)) fail(input, `${path} choose one of the allowed values.`);
  if (type === "array")
  {
    const items = value as JsonValue[];
    if (schema.minItems !== undefined && items.length < schema.minItems || schema.maxItems !== undefined && items.length > schema.maxItems)
      fail(input, `${path} item count is outside the allowed range.`);
    items.forEach((item, index) => schema.items ? validate(input, schema.items, item, `${path}[${index}]`)
      : validateJson(input, item, `${path}[${index}]`));
  }
  if (type === "object")
  {
    const properties = value as Record<string, JsonValue>;
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

function convert(input: InputField, raw: string): JsonValue
{
  let value: JsonValue = raw;
  if (input.type === "object" || input.type === "array" || input.type === "null")
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
  if (root?.type !== "object" || root.additionalProperties === false || Object.hasOwn(root.properties ?? {}, name)) return;
  const schema: InputSchema = typeof root.additionalProperties === "object" ? root.additionalProperties : { type };
  if (!["string", "number", "integer", "boolean", "object", "array", "null"].includes(schema.type)) return;
  return { ...schema, key: `body:${name}`, name, label: name || "(empty name)", description: "", location: "body",
    required: root.required?.includes(name) ?? false, schema };
}

export function prepareRequest(operation: Operation, values: Record<string, string>, workflowFields: InputField[] = operation.fields): PreparedRequest
{
  const request: PreparedRequest = { method: operation.method, path: operation.path, query: {} };
  const body: Record<string, JsonValue> = {};
  const fields = [...operation.fields];
  for (const candidate of workflowFields)
  {
    if (candidate.location !== "body" || fields.some(field => field.key === candidate.key)) continue;
    const input = candidate.key === `body:${candidate.name}` && additionalBodyField(operation, candidate.name, candidate.type);
    if (!input) fail(candidate, "this body property is not allowed by the operation schema.");
    fields.push(input);
  }
  const supplied = (input: InputField) => Boolean((values[input.key] ?? "").trim()
    || input.location === "body" && input.type === "string" && operation.bodySchema?.type === "object"
      && !Object.hasOwn(operation.bodySchema.properties ?? {}, input.name) && Object.hasOwn(values, input.key));
  const hasBody = operation.bodyRequired || fields.some(input => input.location === "body" && supplied(input));
  for (const input of fields)
  {
    const raw = values[input.key] ?? "";
    if (!supplied(input))
    {
      if (input.required && (input.location !== "body" || hasBody)) fail(input, "this field is required.");
      continue;
    }
    const value = convert(input, raw);
    if (input.location === "path") request.path = request.path.replaceAll(`{${input.name}}`, encodeURIComponent(String(value)));
    else if (input.location === "query")
    {
      if (input.type === "object") for (const [name, item] of Object.entries(value as Record<string, JsonValue>))
      {
        if (item !== null && typeof item === "object") fail(input, "deepObject query values must be primitive values.");
        set(request.query, `${input.name}[${name}]`, item);
      }
      else set(request.query, input.name, value);
    }
    else if (input.location === "header")
    {
      if (/[\r\n]/.test(String(value))) fail(input, "header values cannot contain line breaks.");
      request.headers ??= {};
      set(request.headers, input.name, String(value));
    }
    else if (operation.bodyValue) request.body = value;
    else
    {
      if ((operation.bodyMediaType === "application/x-www-form-urlencoded" || operation.bodyMediaType === "multipart/form-data")
        && (value === null || typeof value === "object")) fail(input, "form body properties must be primitive text values.");
      set(body, input.name, value);
    }
  }
  if (hasBody)
  {
    if (!operation.bodyValue) request.body = body;
    if (operation.bodySchema) validateInputValue({ key: "body:$", name: "$", label: "Request body", description: "", location: "body",
      type: operation.bodySchema.type, required: operation.bodyRequired, schema: operation.bodySchema }, request.body!);
    if (operation.bodyMediaType && operation.bodyMediaType !== "application/json") request.contentType = operation.bodyMediaType;
  }
  return request;
}
