// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type FieldMapping = { name: string; path: string[] };
export const fieldMappingLimit = 200;
const parameterLimit = 16000;

/** Keep the saved executor format; users edit literal names, never pointer escapes. */
export function readFieldMappings(value: string): FieldMapping[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("The saved field mappings could not be read. Reset them to start again."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > fieldMappingLimit)
    throw new Error("The saved field mappings could not be read. Reset them to start again.");
  return Object.entries(parsed).map(([name, pointer]) => {
    if (typeof pointer !== "string" || pointer !== "" && (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer)))
      throw new Error("A saved source field could not be read. Reset the mappings to start again.");
    return { name, path: pointer === "" ? [] : pointer.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~")) };
  });
}

export function writeFieldMappings(mappings: FieldMapping[]): string {
  if (mappings.length > fieldMappingLimit) throw new Error(`Use at most ${fieldMappingLimit} field mappings.`);
  if (new Set(mappings.map(mapping => mapping.name)).size !== mappings.length)
    throw new Error("That new field name is already used. Choose a different name.");
  const value = JSON.stringify(Object.fromEntries(mappings.map(({ name, path }) =>
    [name, path.map(part => "/" + part.replace(/~/g, "~0").replace(/\//g, "~1")).join("")])));
  if (value.length > parameterLimit) throw new Error("These mappings are too large. Shorten the field names or remove a mapping.");
  return value;
}
