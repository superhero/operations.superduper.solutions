// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createPail } from "@visulima/pail/browser";
import { PrettyReporter } from "@visulima/pail/browser/reporter/pretty";
import { rememberErrorChain } from "../dev/error-chain.ts";
import { reportApplicationError } from "./error-diagnostics.ts";

class BrowserReporter extends PrettyReporter
{
  override log(meta: Parameters<PrettyReporter["log"]>[0]): void
  {
    const error = meta.error ?? meta.context?.find(value => value instanceof Error);
    const failure = ["error", "critical", "alert", "emergency"].includes(meta.type.level);
    if (failure || (meta.type.level === "warning" && error)) {
      reportApplicationError(error ?? meta.message, { source: "application", scope: meta.scope?.join(" > ") });
    }
    if (error && failure) {
      /* c8 ignore start -- Vite-only overlay bridge, exercised by tests/dev-overlay.smoke.mjs. */
      if (import.meta.env?.DEV) {
        rememberErrorChain(error);
        // Report application errors directly, leaving transport diagnostics in
        // the console. Intercepting console.error would report those recursively.
        const overlay = Reflect.get(globalThis, "__visulima_overlay__") as
          { sendError?: (error: Error) => Promise<void> } | undefined;
        const failed = (failure: unknown) => console.error("Could not report error to the development overlay:", failure);
        try { void overlay?.sendError?.(error)?.catch(failed); }
        catch (failure) { failed(failure); }
      }
      /* c8 ignore stop */
      // Keep native errors and their stacks inspectable before their context.
      const scope = meta.scope?.length ? [`[${meta.scope.join(" > ")}]`] : [];
      const message = typeof meta.message === "symbol" ? [] : [meta.message];
      console.error(error, ...scope, ...message, ...(meta.context ?? []).filter(value => value !== error));
      return;
    }
    super.log(meta);
  }
}

// Preserve console severity without wrapping console methods in the app.
export const logger = createPail({
  scope: "operations",
  reporters: [new BrowserReporter()],
});
