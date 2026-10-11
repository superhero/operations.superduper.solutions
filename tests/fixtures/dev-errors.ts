// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Test-only fixture. Importing it never triggers an error.
import { logger } from "../../src/lib/logger.ts";

export function throwRuntimeError(): void {
  window.setTimeout(() => {
    // The smoke test explicitly invokes this source-linked runtime failure.
    throw new Error("Test-only runtime error — saved workflows and settings are unchanged.");
  }, 600);
}

export function logTestError(): void {
  logger.error(new Error("Test-only Pail error — saved workflows and settings are unchanged."));
}
