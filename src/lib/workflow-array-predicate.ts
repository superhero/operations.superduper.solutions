// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { CastData } from "./workflow-document.ts";
import { castValue } from "./workflow-cast.ts";
import { processingInputTypes, validateProcessingData, validateProcessingValue, type ProcessingData, type ProcessingKind } from "./workflow-processing.ts";

type PredicateStep = { type: "cast"; targetType: CastData["targetType"] }
  | { type: ProcessingKind; data: ProcessingData; bindings: Record<string, string> };
export type ArrayPredicate = { steps: PredicateStep[]; keep: "success" | "failure" };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

/** Only bounded, declarative processing is allowed inside an item callback. */
export function validateArrayPredicate(value: unknown): ArrayPredicate {
  if (!plain(value) || !keys(value, ["steps", "keep"]) || !["success", "failure"].includes(String(value.keep))
    || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 32) throw new Error("Invalid array assertion path.");
  const steps = value.steps.map((step, index): PredicateStep => {
    if (!plain(step)) throw new Error("Invalid array assertion step.");
    const last = index === (value.steps as unknown[]).length - 1;
    if (step.type === "cast" && !last && keys(step, ["type", "targetType"]) && ["Text", "Number", "Boolean", "Binary"].includes(String(step.targetType)))
      return { type: "cast", targetType: step.targetType as CastData["targetType"] };
    if (!keys(step, ["type", "data", "bindings"]) || (last ? step.type !== "assert" : step.type !== "transform" && step.type !== "filter"))
      throw new Error("An array item path must end at Assert.");
    const type = step.type as ProcessingKind;
    const data = validateProcessingData(type, step.data);
    if (data.operation === "array_filter" || !plain(step.bindings) || Object.keys(step.bindings).length > 16)
      throw new Error("Nested array assertion paths are not supported.");
    for (const [name, capture] of Object.entries(step.bindings))
      if (!processingInputTypes(type, data, name) || name === "value" || typeof capture !== "string" || !capture || capture.length > 512)
        throw new Error("Invalid array assertion input.");
    return { type, data, bindings: { ...step.bindings } as Record<string, string> };
  });
  return { steps, keep: value.keep as ArrayPredicate["keep"] };
}

export function arrayPredicateCaptures(predicate: ArrayPredicate): Set<string> {
  return new Set(predicate.steps.flatMap(step => step.type === "cast" ? [] : Object.values(step.bindings)));
}

/** One worker request processes the array; no per-item graph copies or UI results. */
export async function filterArrayWithPredicate(value: unknown, raw: ArrayPredicate, captures: Record<string, unknown>,
  process: (kind: ProcessingKind, data: ProcessingData, value: unknown, key?: unknown, parameters?: Record<string, unknown>) => Promise<unknown>): Promise<unknown[]> {
  const predicate = validateArrayPredicate(raw);
  validateProcessingValue(value);
  if (!Array.isArray(value)) throw new Error("Filter array requires an Array input.");
  if (value.length * predicate.steps.length > 100_000) throw new Error("The array assertion path exceeds the processing limit.");
  const required = arrayPredicateCaptures(predicate);
  if (!plain(captures) || Object.keys(captures).length !== required.size || [...required].some(name => !Object.hasOwn(captures, name)))
    throw new Error("The array assertion path has an unresolved input.");
  for (const capture of Object.values(captures)) validateProcessingValue(capture);
  // Bind constant operands once, retaining false, null and their original types.
  const steps = predicate.steps.map(step => step.type === "cast" ? step : { ...step,
    key: step.bindings.key ? captures[step.bindings.key] : undefined,
    parameters: Object.fromEntries(Object.entries(step.bindings).filter(([name]) => name !== "key").map(([name, capture]) => [name, captures[capture]])) });
  const result: unknown[] = [];
  for (const original of value) {
    let current: unknown = original;
    for (const step of steps) current = step.type === "cast" ? castValue(current, step.targetType)
      : await process(step.type, step.data, current, step.key, step.parameters);
    if (Boolean(current) === (predicate.keep === "success")) result.push(original);
  }
  return result;
}
