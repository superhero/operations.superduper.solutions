// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { CastData } from "./workflow-document.ts";
import { encodeWorkflowBinary, validateWorkflowBinary, type WorkflowBinary } from "./workflow-binary.ts";

export function numericValue(value: unknown): value is string
{
  return typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value));
}

export function castValue(value: unknown, type: CastData["targetType"]): string | number | boolean | WorkflowBinary
{
  if (type === "Binary") {
    if (value && typeof value === "object" && "kind" in value && value.kind === "workflow-file") return validateWorkflowBinary(value);
    const encoded = typeof value === "string" ? value : JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "number" && !Number.isFinite(item) || item === undefined || typeof item === "function" || typeof item === "symbol")
        throw new Error("Only finite JSON values can be cast to Binary.");
      return item;
    });
    const text = typeof value === "string";
    return encodeWorkflowBinary(text ? "data.txt" : "data.json", new TextEncoder().encode(encoded), text ? "text/plain" : "application/json");
  }
  if (!["string", "number", "boolean"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value))
    throw new Error("Only text, finite numbers and booleans can be cast.");
  if (type === "Text") return String(value);
  if (type === "Number")
  {
    if (typeof value !== "string" || numericValue(value)) return Number(value);
    throw new Error("Enter a valid number to cast text to Number.");
  }
  if (type === "Boolean")
  {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
    if (normalized === true || normalized === 1 || normalized === "true" || normalized === "1") return true;
    if (normalized === false || normalized === 0 || normalized === "false" || normalized === "0") return false;
    throw new Error("Boolean casts accept only true, false, 1 or 0.");
  }
  throw new Error("Unsupported cast type.");
}
