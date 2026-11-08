// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField, JsonValue } from "./catalog.ts";
import { encodeQueryComponent } from "./query-serialization.ts";
import { validateLiteralQueryFields } from "./literal-query.ts";

const primitives = new Set(["string", "number", "integer", "boolean"]);

/** OpenAPI simple header arrays use comma delimiters in both explode modes.
 * Header bytes are not URL components. Ambiguous delimiters remain guarded. */
export function configureSimpleHeaderArray(input: InputField, parameter: Record<string, unknown>): boolean {
  if (input.location !== "header" || input.type !== "array") return false;
  const items = input.schema?.items;
  if (parameter.style !== undefined && parameter.style !== "simple"
    || parameter.explode !== undefined && typeof parameter.explode !== "boolean"
    || parameter.allowReserved !== undefined && parameter.allowReserved !== false
    || parameter.allowEmptyValue !== undefined && parameter.allowEmptyValue !== false
    || !items || !primitives.has(items.type) || items.nullable || items.format === "binary")
    throw new Error('Simple header arrays require style="simple", a Boolean explode setting and non-null primitive items, without reserved-value or empty-value overrides.');
  return true;
}
export function encodeSimpleHeaderArray(input: InputField, value: JsonValue): string {
  if (!configureSimpleHeaderArray(input, {}) || !Array.isArray(value)
    || value.some(item => item === null || !["string", "number", "boolean"].includes(typeof item)
      || typeof item === "number" && !Number.isFinite(item)))
    throw new Error("A header array requires a list of non-null primitive values.");
  if (value.some(item => /[,\u0000-\u001f\u007f]/.test(String(item))))
    throw new Error("Header array items cannot contain comma delimiters or control characters.");
  return value.map(String).join(",");
}

export function validatePathParameters(path: string, fields: readonly Pick<InputField, "location" | "name">[]): void {
  validateLiteralQueryFields(path, fields);
  const placeholders = new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!));
  const names = new Set(fields.filter(field => field.location === "path").map(field => field.name));
  const missing = [...placeholders].filter(name => !names.has(name));
  const unused = [...names].filter(name => !placeholders.has(name));
  const problems = [
    ...(missing.length ? [`missing path parameter declarations for ${missing.map(name => JSON.stringify(`{${name}}`)).join(", ")}`] : []),
    ...(unused.length ? [`unused path parameter declarations ${unused.map(name => JSON.stringify(name)).join(", ")}`] : []),
  ];
  if (problems.length) throw new Error(`Path parameter mismatch for ${JSON.stringify(path)}: ${problems.join("; ")}.`);
}

export function parameterContext(parameter: Record<string, unknown>, type = "unknown"): string {
  const location = typeof parameter.in === "string" ? parameter.in : "unknown";
  const style = parameter.style === undefined ? ["query", "cookie"].includes(location) ? "form" : "simple" : parameter.style;
  const explode = parameter.explode === undefined ? style === "form" : parameter.explode;
  const show = (value: unknown) => value === null || ["string", "number", "boolean"].includes(typeof value)
    ? JSON.stringify(value) : `<invalid ${typeof value}>`;
  return `${location} parameter ${JSON.stringify(parameter.name ?? "<unnamed>")} (type=${type}, style=${show(style)}, explode=${show(explode)})`;
}

/** Both simple-array explode modes have the same comma-delimited wire format. */
export function configureSimplePathArray(input: InputField, parameter: Record<string, unknown>): boolean {
  if (input.location !== "path" || input.type !== "array") return false;
  const items = input.schema?.items;
  if (parameter.style !== undefined && parameter.style !== "simple"
    || parameter.explode !== undefined && typeof parameter.explode !== "boolean"
    || parameter.allowReserved !== undefined && parameter.allowReserved !== false
    || parameter.allowEmptyValue !== undefined && parameter.allowEmptyValue !== false
    || !items || !primitives.has(items.type) || items.nullable || items.format === "binary")
    throw new Error('Simple path arrays require style="simple", a Boolean explode setting and non-null primitive items, without reserved-value or empty-value overrides.');
  return true;
}

export function encodeSimplePathArray(input: InputField, value: JsonValue): string {
  if (!configureSimplePathArray(input, {}) || !Array.isArray(value) || !value.length
    || value.some(item => item === null || !["string", "number", "boolean"].includes(typeof item)
      || typeof item === "number" && !Number.isFinite(item)))
    throw new Error("A path array requires a non-empty list of non-null primitive values.");
  const encoded = value.map(item => encodeQueryComponent(String(item))).join(",");
  if (!encoded || encoded === "." || encoded === "..")
    throw new Error("A path array must supply a non-empty URL segment without dot traversal.");
  return encoded;
}
