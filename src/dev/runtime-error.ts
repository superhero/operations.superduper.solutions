// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { inspect } from "@visulima/inspector";

type RuntimeContext = {
  kind: "error" | "rejection";
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
};

function read(value: unknown, key: string): unknown {
  try { return value && typeof value === "object" ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}

/** Preserve browser diagnostics without inventing a stack at the reporting site. */
export function normalizeRuntimeError(value: unknown, context: RuntimeContext): Error {
  if (value instanceof Error) return value;
  const valueMessage = read(value, "message");
  let message = typeof valueMessage === "string" && valueMessage ? valueMessage : context.message;
  if (!message && context.kind === "error" && value == null) {
    message = "The browser reported an error without a message or exception details.";
  }
  if (!message || value !== null && typeof value === "object") {
    try {
      const inspected = inspect(value, {
        customInspect: false, depth: 4, maxArrayLength: 30, truncate: 4000,
      });
      message = message ? `${message}\n\nReported value: ${inspected}`
        : `${context.kind === "rejection" ? "Unhandled promise rejection" : "Thrown value"}: ${inspected}`;
    } catch {
      message = message ? `${message}\n\nThe reported value could not be inspected.`
        : `The browser reported a ${context.kind === "rejection" ? "promise rejection" : "runtime error"} whose value could not be inspected.`;
    }
  }
  const resizeLoop = /^ResizeObserver loop/.test(message);
  if (resizeLoop) message += "\n\nThe browser deferred resize notifications to prevent a loop. Check ResizeObserver callbacks for layout changes that resize the observed element. The browser does not provide the callback's stack for this event.";
  const error = new Error(message);
  const name = read(value, "name");
  error.name = typeof name === "string" && name ? name : resizeLoop ? "ResizeObserverError"
    : context.kind === "rejection" ? "UnhandledRejectionError" : "BrowserRuntimeError";
  const stack = read(value, "stack");
  const location = context.filename && context.lineno && context.lineno > 0
    ? `\n    at ${context.filename}:${context.lineno}:${Math.max(1, context.colno ?? 1)}` : "";
  error.stack = typeof stack === "string" && stack ? stack
    : location ? `${error.name}: ${message.split("\n")[0]}${location}` : "";
  const code = read(value, "code");
  if (typeof code === "string" || typeof code === "number") Object.defineProperty(error, "code", { value: code });
  // Keep the original object available to console inspection without adding a fake cause.
  Object.defineProperty(error, "originalValue", { value });
  return error;
}
