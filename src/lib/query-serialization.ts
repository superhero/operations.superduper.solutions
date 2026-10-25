// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";

export type QuerySerialization = "form-csv";
const primitives = new Set(["string", "number", "integer", "boolean"]);

/** The reviewed non-exploded form slice; other parameter styles stay guarded. */
export function configureQueryArray(input: InputField, parameter: Record<string, unknown>): boolean {
  if (input.location !== "query" || input.type !== "array" || parameter.explode !== false) return false;
  const items = input.schema?.items;
  if (!input.name || parameter.style !== undefined && parameter.style !== "form" || parameter.allowReserved !== undefined && parameter.allowReserved !== false
    || parameter.allowEmptyValue !== undefined && parameter.allowEmptyValue !== false
    || !items || !primitives.has(items.type) || items.nullable || items.format === "binary")
    throw new Error("This comma-separated query array requires non-null primitive items and form encoding without allowReserved.");
  input.querySerialization = "form-csv"; return true;
}

export const encodeQueryComponent = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

/** Split comma-delimited members before decoding them (OpenAPI/RFC6570).
 * Both transports call this after validating canonical parameters and auth slots. */
export function appendRequestQuery(url: URL, request: Pick<PreparedRequest, "query" | "querySerialization">,
  injected: ReadonlyMap<string, string> = new Map()): void {
  const styles = request.querySerialization ?? {};
  if (Object.entries(styles).some(([name, style]) => style !== "form-csv" || !Object.hasOwn(request.query, name)))
    throw new Error("Unsupported prepared query serialization.");
  if (!Object.keys(styles).length) {
    for (const [name, value] of Object.entries(request.query))
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) url.searchParams.append(name, String(item));
    for (const [name, value] of injected) url.searchParams.set(name, value);
    return;
  }
  const base = new URLSearchParams(url.search);
  for (const name of injected.keys()) {
    if (Object.hasOwn(request.query, name)) throw new Error("A credential query parameter cannot be overwritten.");
    base.delete(name);
  }
  const parts = [base.toString()];
  for (const [name, value] of Object.entries(request.query)) {
    if (Object.hasOwn(styles, name)) {
      if (!Array.isArray(value) || !value.length || value.some(item => item === null || !["string", "number", "boolean"].includes(typeof item)
        || typeof item === "number" && !Number.isFinite(item))) throw new Error("Invalid comma-separated query value.");
      parts.push(`${encodeQueryComponent(name)}=${value.map(item => encodeQueryComponent(String(item))).join(",")}`);
    } else {
      const ordinary = new URLSearchParams();
      for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) ordinary.append(name, String(item));
      parts.push(ordinary.toString());
    }
  }
  for (const [name, value] of injected) parts.push(new URLSearchParams([[name, value]]).toString());
  // Do not mutate searchParams afterwards: that would encode the comma separators.
  url.search = parts.filter(Boolean).join("&");
}
