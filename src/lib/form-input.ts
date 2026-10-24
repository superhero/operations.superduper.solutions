// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema } from "./catalog.ts";

function textField(schema: InputSchema): boolean {
  return !schema.nullable && !schema.format && ["string", "number", "integer", "boolean"].includes(schema.type);
}

/** Default form encoding repeats primitive array items under the same field name. */
export function supportsFormField(schema: Pick<InputSchema, "type" | "nullable" | "format" | "items">, multipart: boolean): boolean {
  return textField(schema)
    || multipart && schema.type === "string" && schema.format === "binary" && !schema.nullable
    || schema.type === "array" && !schema.nullable && !!schema.items && textField(schema.items);
}
