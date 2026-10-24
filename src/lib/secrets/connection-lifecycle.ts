// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { validateHttpConnectionReference } from "./bindings.ts";
import type { HttpConnectionReference } from "./types.ts";

export type ConnectionAuthorizationState = { kind: "needs-action" | "waiting" | "ready" | "failed" | "cancelled" | "expired";
  reference?: HttpConnectionReference };

/** Shared by existing-token selection and future interactive acquisition. No provider initializes on import. */
export function createConnectionAuthorization<T>(onState: (state: ConnectionAuthorizationState) => void,
  now: () => number = () => Date.now()) {
  let state: ConnectionAuthorizationState = { kind: "needs-action" }, generation = 0;
  let controller: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let abandon: (() => void) | undefined;
  const emit = (kind: ConnectionAuthorizationState["kind"], reference?: HttpConnectionReference) => {
    state = { kind, ...(reference ? { reference: { ...reference } } : {}) }; onState(structuredClone(state));
  };
  const stop = (kind: ConnectionAuthorizationState["kind"]) => {
    generation++; clearTimeout(timer); controller?.abort(); controller = undefined; abandon?.(); abandon = undefined;
    emit(kind, state.reference);
  };
  return {
    get state() { return structuredClone(state); },
    cancel() { stop("cancelled"); },
    reset() { stop("needs-action"); },
    async start(reference: HttpConnectionReference, authorize: (signal: AbortSignal) => Promise<T>,
      options: { enabled: boolean; expiresAt?: number; waitMs?: number }): Promise<T | undefined> {
      stop("needs-action");
      if (!options.enabled) return;
      const selected = validateHttpConnectionReference(reference), request = generation;
      const wait = options.waitMs ?? 300_000;
      if (!Number.isSafeInteger(wait) || wait < 1 || wait > 300_000 || options.expiresAt !== undefined && !Number.isSafeInteger(options.expiresAt)) {
        emit("failed", selected); return;
      }
      if (options.expiresAt !== undefined && options.expiresAt <= now()) { emit("expired", selected); return; }
      controller = new AbortController();
      const signal = controller.signal, cancelled = Symbol("cancelled");
      const aborted = new Promise<typeof cancelled>(resolve => { abandon = () => resolve(cancelled); });
      emit("waiting", selected);
      timer = setTimeout(() => stop("expired"), Math.min(wait, options.expiresAt === undefined ? wait : options.expiresAt - now()));
      try {
        const result = await Promise.race([authorize(signal), aborted]);
        if (request !== generation || signal.aborted || result === cancelled) return;
        clearTimeout(timer); abandon = undefined;
        if (options.expiresAt !== undefined && options.expiresAt <= now()) { stop("expired"); return; }
        emit("ready", selected);
        if (options.expiresAt !== undefined) {
          const expire = () => {
            if (request !== generation) return;
            const remaining = options.expiresAt! - now();
            if (remaining <= 0) stop("expired");
            else timer = setTimeout(expire, Math.min(2_147_483_647, remaining));
          };
          expire();
        }
        return result as T;
      } catch {
        if (request === generation && !signal.aborted) { clearTimeout(timer); abandon = undefined; emit("failed", selected); }
        return;
      }
    }
  };
}
