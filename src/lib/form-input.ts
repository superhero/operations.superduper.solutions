// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema } from "./catalog.ts";

function primitiveField(schema: InputSchema): boolean {
  return !schema.format && ["string", "number", "integer", "boolean"].includes(schema.type)
    && (!schema.enum || schema.enum.some(value => value !== null) && schema.enum.every(value => value === null ? !!schema.nullable
      : schema.type === "integer" ? typeof value === "number" && Number.isInteger(value)
      : typeof value === schema.type && (typeof value !== "number" || Number.isFinite(value))));
}
function textField(schema: InputSchema): boolean {
  return !schema.nullable && primitiveField(schema);
}

/** Default form encoding repeats primitive array items under the same field name. */
export function supportsFormField(schema: Pick<InputSchema, "type" | "nullable" | "format" | "items" | "enum">, multipart: boolean): boolean {
  return primitiveField(schema)
    || multipart && schema.type === "string" && schema.format === "binary"
    || schema.type === "array" && !schema.nullable && !!schema.items && textField(schema.items);
}
