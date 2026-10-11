// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { normalizeRuntimeError } from "./runtime-error.ts";

type ErrorIdentity = { name: string; code?: string | number };
type ErrorDetail = ErrorIdentity & { message: string };
const reports: ErrorDetail[][] = [];
const resolved = new WeakMap<readonly unknown[], readonly ErrorIdentity[]>();

function read(error: unknown, key: string): unknown {
  try { return error && typeof error === "object" ? Reflect.get(error, key) : undefined; }
  catch { return undefined; }
}

function detail(error: unknown): ErrorDetail {
  const name = read(error, "name");
  const message = read(error, "message");
  const code = read(error, "code");
  return {
    name: typeof name === "string" && name ? name : "Error",
    message: typeof message === "string" ? message : "",
    ...(typeof code === "string" && code !== "" || typeof code === "number" && Number.isFinite(code) ? { code } : {}),
  };
}

/** Visulima serializes name/message/cause, but omits native and custom codes. */
export function rememberErrorChain(error: unknown): void {
  const chain: ErrorDetail[] = [];
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error) && chain.length < 50) {
    seen.add(error);
    chain.push(detail(error));
    error = read(error, "cause");
  }
  if (!chain.length) return;
  reports.push(chain);
  if (reports.length > 50) reports.shift();
}

export function getErrorChain(errors: readonly unknown[]): readonly ErrorIdentity[] {
  const cached = resolved.get(errors);
  if (cached) return cached;
  const chain = errors.map(detail);
  const matches = reports.filter(report => report.length === chain.length && report.every((error, index) =>
    error.name === chain[index]?.name && error.message === chain[index]?.message));
  const result = chain.map(({ name, code }, index) => {
    const codes = new Set(matches.map(report => report[index]?.code));
    // Never infer a code from prose or choose between conflicting reports.
    const preserved = codes.size === 1 ? [...codes][0] : undefined;
    const actualCode = code ?? preserved;
    return actualCode === undefined ? { name } : { name, code: actualCode };
  });
  resolved.set(errors, result);
  return result;
}

if (import.meta.env?.DEV && typeof window !== "undefined") {
  const onError = (event: ErrorEvent) => {
    // Resource-load events have no ErrorEvent diagnostics and are not runtime exceptions.
    if (!(event instanceof ErrorEvent)) return;
    const error = normalizeRuntimeError(event.error, { kind: "error", message: event.message,
      filename: event.filename, lineno: event.lineno, colno: event.colno });
    if (event.error !== error) Object.defineProperty(event, "error", { value: error });
    rememberErrorChain(error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const error = normalizeRuntimeError(event.reason, { kind: "rejection" });
    if (event.reason !== error) Object.defineProperty(event, "reason", { value: error });
    rememberErrorChain(error);
  };
  // The Vite integration imports this module before Visulima registers its listeners.
  // Do not cancel the event or send a second report: its existing listener handles it.
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection, true);
  import.meta.hot?.dispose(() => {
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection, true);
  });
}
