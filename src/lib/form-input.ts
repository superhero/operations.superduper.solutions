// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema } from "./catalog.ts";

const unionAnnotations = new Set(["title", "description", "example", "examples", "default", "deprecated"]);

/** Lossless string unions; exclusive alternatives must be provably disjoint. */
export function normalizeStringUnion(shape: Record<string, unknown>, resolveBranch: (branch: unknown) => unknown = branch => branch): Record<string, unknown> {
  const keyword = shape.anyOf === undefined ? "oneOf" : "anyOf", variants = shape[keyword], exclusive = keyword === "oneOf";
  if (!Array.isArray(variants) || !variants.length
    || Object.keys(shape).some(key => key !== keyword && !unionAnnotations.has(key))) return shape;
  let unrestricted = false, nullable = false;
  const patterns: string[] = [], values: string[] = [];
  for (const raw of variants) {
    const variant = resolveBranch(raw);
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) return shape;
    const branch = variant as Record<string, unknown>;
    if (Object.keys(branch).some(key => !["type", "enum", "pattern"].includes(key) && !unionAnnotations.has(key) && !key.startsWith("x-"))) return shape;
    if (branch.type === "null" && branch.enum === undefined) nullable = true;
    else if (branch.type === "string") {
      if (branch.pattern !== undefined) {
        if (typeof branch.pattern !== "string" || branch.enum !== undefined) return shape;
        try { new RegExp(branch.pattern, "u"); } catch { return shape; }
        patterns.push(branch.pattern);
      } else if (branch.enum === undefined) unrestricted = true;
      else {
        if (!Array.isArray(branch.enum) || !branch.enum.length || branch.enum.some(value => typeof value !== "string")) return shape;
        values.push(...branch.enum as string[]);
      }
    } else return shape;
  }
  const annotations = Object.fromEntries(Object.entries(shape).filter(([key]) => key !== keyword));
  if (exclusive && (variants.length !== 2 || unrestricted || nullable || patterns.length !== 1 || !values.length
    || values.some(value => new RegExp(patterns[0]!, "u").test(value)))) return shape;
  if (!unrestricted) {
    if (nullable || patterns.length !== 1 || !values.length) return shape;
    const literals = values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    // Keep the original pattern's search semantics; enum literals match the entire value.
    return { ...annotations, type: "string", pattern: `(?:${patterns[0]})|^(?:${literals})(?![\\s\\S])` };
  }
  return { ...annotations, type: "string", ...(nullable ? { nullable: true } : {}) };
}

function primitiveField(schema: InputSchema): boolean {
  return !schema.format && ["string", "number", "integer", "boolean"].includes(schema.type)
    && (!schema.enum || schema.enum.some(value => value !== null) && schema.enum.every(value => value === null ? !!schema.nullable
      : schema.type === "integer" ? typeof value === "number" && Number.isInteger(value)
      : typeof value === schema.type && (typeof value !== "number" || Number.isFinite(value))));
}
function textField(schema: InputSchema): boolean {
  return !schema.nullable && primitiveField(schema);
}

/** Default form encoding repeats primitive or multipart file items by field name. */
export function supportsFormField(schema: Pick<InputSchema, "type" | "nullable" | "format" | "items" | "enum">, multipart: boolean): boolean {
  return primitiveField(schema)
    || multipart && schema.type === "string" && schema.format === "binary"
    || schema.type === "array" && !schema.nullable && !!schema.items
      && (textField(schema.items) || multipart && schema.items.type === "string" && schema.items.format === "binary" && !schema.items.nullable);
}

export function validateFormBody(schema: InputSchema, multipart: boolean, encoding?: unknown): void {
  const issues: string[] = [];
  if (schema.type !== "object" || schema.nullable)
    issues.push(`Form body must be a non-null object with named fields (type=${schema.type}${schema.nullable ? ", nullable=true" : ""}).`);
  else {
    const fields = Object.entries(schema.properties ?? {});
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") fields.push(["<additional properties>", schema.additionalProperties]);
    for (const [name, field] of fields) if (!supportsFormField(field, multipart)) {
      const reason = field.type === "array" ? "arrays require non-null primitive items or multipart binary files"
        : field.type === "json" ? "the schema union or constraints cannot be represented by a supported form field"
        : "use a primitive value, a primitive array or a multipart binary file";
      issues.push(`Form field ${JSON.stringify(name)} (type=${field.type}): ${reason}.`);
    }
  }
  if (encoding !== undefined) {
    if (!encoding || typeof encoding !== "object" || Array.isArray(encoding)) issues.push("Form part encoding must be an object keyed by field name.");
    else for (const [name, settings] of Object.entries(encoding)) {
      const keys = settings && typeof settings === "object" && !Array.isArray(settings) ? Object.keys(settings) : [];
      issues.push(`Form part ${JSON.stringify(name)}: custom encoding${keys.length ? ` (${keys.join(", ")})` : ""} is not supported.`);
    }
  }
  if (issues.length) throw new Error(issues.join(" "));
}
