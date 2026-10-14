// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import type { ErrorDetail, ErrorDiagnostic, ErrorOrigin } from "./error-history-types.ts";

const listeners = new Set<(diagnostic: ErrorDiagnostic) => void>();
const reportedOrigins = new WeakMap<object, ErrorOrigin>();
const workerBlobUrl = /(blob:(?:https?:\/\/[^/\s)]+|null)\/)[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/gi;
let publishing = false;

function read(value: unknown, property: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { return Reflect.get(value, property); } catch { return undefined; }
}

function isArray(value: unknown): value is unknown[] {
  try { return Array.isArray(value); } catch { return false; }
}

/** Snapshot known diagnostic fields without inspecting arbitrary application data. */
export function describeApplicationError(value: unknown, source: ErrorOrigin): ErrorDiagnostic {
  // JSON escaping can expand characters sixfold; this also bounds the canonical identity.
  let remainingText = 8_192;
  let remainingNodes = 16;
  const ancestors = new Set<object>();
  const text = (value: string, maximum: number): string => {
    const size = Math.min(maximum, remainingText);
    const result = value.length <= size ? value : size > 0 ? `${value.slice(0, size - 1)}…` : "";
    remainingText -= result.length;
    return result;
  };
  const channel = read(source, "source");
  const origin: ErrorOrigin = { source: channel === "runtime" || channel === "rejection" || channel === "worker" ? channel : "application" };
  for (const property of ["scope", "operation", "filename"] as const) {
    const field = read(source, property);
    if (typeof field === "string" && field) origin[property] = text(field, property === "filename" ? 1_024 : 256);
  }
  for (const property of ["line", "column"] as const) {
    const field = read(source, property);
    if (typeof field === "number" && Number.isSafeInteger(field) && field >= 0) origin[property] = field;
  }

  function snapshot(value: unknown, depth: number): ErrorDetail | undefined {
    if (remainingNodes === 0) return undefined;
    remainingNodes -= 1;
    if (depth > 6) return { name: text("TruncatedError", 128), message: text("Error nesting limit reached", 2_048) };
    const object = value !== null && (typeof value === "object" || typeof value === "function");
    if (object && ancestors.has(value)) return { name: text("CircularError", 128), message: text("Circular error reference", 2_048) };
    const name = read(value, "name");
    const message = read(value, "message");
    const detail: ErrorDetail = {
      name: text(typeof name === "string" && name ? name : object ? "Error" : "ThrownValue", 128),
      message: text(typeof message === "string" ? message : object ? "Non-Error object thrown" : String(value), 2_048),
    };
    const stack = read(value, "stack");
    if (typeof stack === "string" && stack) detail.stack = text(stack, 4_096);
    const code = read(value, "code");
    if (typeof code === "string") detail.code = text(code, 128);
    else if (typeof code === "number" && Number.isFinite(code)) detail.code = code;
    if (object) ancestors.add(value);
    const cause = read(value, "cause");
    if (cause !== undefined) {
      const nested = snapshot(cause, depth + 1);
      if (nested) detail.cause = nested;
    }
    const errors = read(value, "errors");
    if (isArray(errors)) {
      const length = read(errors, "length");
      const nested: ErrorDetail[] = [];
      if (typeof length === "number" && Number.isSafeInteger(length) && length >= 0) {
        for (let index = 0; index < Math.min(length, 8); index += 1) {
          const child = snapshot(read(errors, String(index)), depth + 1);
          if (!child) break;
          nested.push(child);
        }
      }
      if (nested.length) detail.errors = nested;
    }
    if (object) ancestors.delete(value);
    return detail;
  }

  const error = snapshot(value, 0)!;
  // Inline workers receive a fresh blob URL in each tab and after reloads.
  // Their named worker scope and source position identify the same failure.
  const identity = JSON.stringify({ origin, error }, origin.source === "worker" && origin.scope
    ? (key, value: unknown) => typeof value === "string" && (key === "stack" || key === "filename")
      ? value.replace(workerBlobUrl, "$1<worker>") : value
    : undefined);
  return { identity, origin, error };
}

/** Recording must never interfere with reporting, including recursive subscriber failures. */
export function reportApplicationError(value: unknown, origin: ErrorOrigin): void {
  if (publishing || listeners.size === 0) return;
  publishing = true;
  try {
    const object = value !== null && (typeof value === "object" || typeof value === "function");
    // A worker failure can subsequently reach a logger and the global handler.
    // Preserve its original location while still counting each report.
    const diagnostic = describeApplicationError(value, object ? reportedOrigins.get(value) ?? origin : origin);
    if (object) reportedOrigins.set(value, diagnostic.origin);
    for (const listener of [...listeners]) {
      try { listener(diagnostic); } catch { /* Diagnostics cannot report their own failures. */ }
    }
  } finally { publishing = false; }
}

export function subscribeApplicationErrors(listener: (diagnostic: ErrorDiagnostic) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
