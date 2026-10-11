// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { operations } from "./catalog.ts";
import { catalogForOperation } from "./catalog-registry.ts";

type Schema = Record<string, unknown>;
const object = (value: unknown): value is Schema => value !== null && typeof value === "object" && !Array.isArray(value);

function resolve(value: unknown, document: Schema, context: string): Schema
{
  const seen = new Set<string>();
  while (object(value) && value.$ref !== undefined)
  {
    const reference = value.$ref;
    if (typeof reference !== "string" || !reference.startsWith("#/") || /~(?:[^01]|$)/.test(reference) || seen.has(reference))
      throw new Error(`${context}: the header schema reference is unavailable or recursive.`);
    seen.add(reference);
    let target: unknown = document;
    for (const part of reference.slice(2).split("/"))
    {
      const name = part.replace(/~1/g, "/").replace(/~0/g, "~");
      target = object(target) && Object.hasOwn(target, name) ? target[name] : undefined;
    }
    value = target;
  }
  if (!object(value)) throw new Error(`${context}: the header schema is unavailable.`);
  return value;
}

function scalar(raw: string, schema: Schema, context: string): unknown
{
  if (schema.oneOf || schema.anyOf || schema.allOf || schema.not)
    throw new Error(`${context}: combined header schemas cannot be decoded.`);
  let value: unknown = raw;
  const type = schema.type ?? "string";
  if (type === "integer" || type === "number")
  {
    const text = raw.trim();
    value = Number(text);
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(value)
      || type === "integer" && !Number.isSafeInteger(value))
      throw new Error(`${context}: expected a valid ${type} header value.`);
  }
  else if (type === "boolean")
  {
    if (raw.trim() !== "true" && raw.trim() !== "false") throw new Error(`${context}: expected true or false.`);
    value = raw.trim() === "true";
  }
  else if (type === "null")
  {
    if (raw.trim() !== "null") throw new Error(`${context}: expected null.`);
    value = null;
  }
  else if (type !== "string") throw new Error(`${context}: nested or alternative header values cannot be decoded.`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value) || "const" in schema && schema.const !== value)
    throw new Error(`${context}: the header value is not permitted by its schema.`);
  return value;
}

function decode(raw: string, header: Schema, document: Schema, context: string): unknown
{
  if (header.content !== undefined || header.style !== undefined && header.style !== "simple")
    throw new Error(`${context}: only simple response-header serialization is supported.`);
  const schema = resolve(header.schema, document, context);
  if (schema.oneOf || schema.anyOf || schema.allOf || schema.not)
    throw new Error(`${context}: combined header schemas cannot be decoded.`);
  if (schema.type === "array")
  {
    const item = resolve(schema.items, document, context);
    return (raw === "" ? [] : raw.split(",")).map(value => scalar(value.trim(), item, context));
  }
  if (schema.type === "object" || schema.type === undefined && object(schema.properties))
  {
    const parts = raw === "" ? [] : raw.split(",").map(value => value.trim());
    const entries: [string, string][] = [];
    if (header.explode === true)
    {
      for (const part of parts)
      {
        const separator = part.indexOf("=");
        if (separator < 1) throw new Error(`${context}: expected comma-separated name=value properties.`);
        entries.push([part.slice(0, separator), part.slice(separator + 1)]);
      }
    }
    else
    {
      if (parts.length % 2) throw new Error(`${context}: expected alternating property names and values.`);
      for (let index = 0; index < parts.length; index += 2) entries.push([parts[index]!, parts[index + 1]!]);
    }
    const properties = object(schema.properties) ? schema.properties : {};
    const values: [string, unknown][] = [];
    for (const [name, value] of entries)
    {
      if (values.some(([existing]) => existing === name)) throw new Error(`${context}: duplicate property “${name}”.`);
      const defined = Object.hasOwn(properties, name);
      if (!defined && schema.additionalProperties === false) throw new Error(`${context}: property “${name}” is not permitted.`);
      const source = defined ? properties[name] : object(schema.additionalProperties) ? schema.additionalProperties : { type: "string" };
      values.push([name, scalar(value, resolve(source, document, context), `${context}.${name}`)]);
    }
    for (const required of Array.isArray(schema.required) ? schema.required : [])
      if (typeof required === "string" && !values.some(([name]) => name === required)) throw new Error(`${context}: property “${required}” is missing.`);
    return Object.fromEntries(values);
  }
  return scalar(raw, schema, context);
}

/** Preserve wire headers in results; decode documented values only for mapped response fields. */
export function responseHeaderReader(operationId: string, status: number, headers: Record<string, string>)
{
  const operation = operations.find(item => item.id === operationId);
  const document = catalogForOperation(operationId)?.document;
  let declarations: Schema | undefined;
  const decoded = new Map<string, unknown>();
  function declared(): Schema
  {
    if (declarations) return declarations;
    declarations = {};
    if (!operation || !document || !object(document.paths)) return declarations;
    const path = resolve(document.paths[operation.path], document, "Response headers");
    const source = path[operation.method.toLowerCase()];
    if (!object(source) || !object(source.responses)) return declarations;
    const keys = Object.keys(source.responses);
    const key = keys.find(key => key === String(status))
      ?? keys.find(key => key.toUpperCase() === `${Math.floor(status / 100)}XX`)
      ?? keys.find(key => key.toLowerCase() === "default");
    if (!key) return declarations;
    const response = resolve(source.responses[key], document, "Response headers");
    declarations = object(response.headers) ? response.headers : {};
    return declarations;
  }
  function read(name: string): unknown
  {
    const actual = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
    if (actual === undefined) return undefined;
    if (!decoded.has(actual))
    {
      const definitions = declared();
      const declaredName = Object.keys(definitions).find(key => key.toLowerCase() === actual.toLowerCase());
      const context = `Response header “${declaredName ?? actual}”`;
      decoded.set(actual, declaredName && document
        ? decode(headers[actual]!, resolve(definitions[declaredName], document, context), document, context) : headers[actual]);
    }
    return decoded.get(actual);
  }
  return (name?: string): unknown => name === undefined ? Object.fromEntries(Object.keys(headers).map(name => [
    Object.keys(declared()).find(key => key.toLowerCase() === name.toLowerCase()) ?? name, read(name)
  ])) : read(name);
}
