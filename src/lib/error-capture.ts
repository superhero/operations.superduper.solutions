// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { reportApplicationError } from "./error-diagnostics.ts";

/** Observe runtime diagnostics without suppressing the browser or development overlay. */
export function installRuntimeErrorCapture(target: Window): () => void {
  const error = (event: ErrorEvent) => {
    // Resource-load events have no runtime error details and belong to their own handlers.
    if (!event.error && !event.message) return;
    reportApplicationError(event.error ?? event.message, {
      source: "runtime", filename: event.filename, line: event.lineno, column: event.colno,
    });
  };
  const rejection = (event: PromiseRejectionEvent) => reportApplicationError(event.reason, { source: "rejection" });
  target.addEventListener("error", error);
  target.addEventListener("unhandledrejection", rejection);
  return () => {
    target.removeEventListener("error", error);
    target.removeEventListener("unhandledrejection", rejection);
  };
}
