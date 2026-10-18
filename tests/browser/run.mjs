// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Keep the browser entry point used by Docker/CI while sharing the Gherkin runner.
process.argv.splice(2, 0, 'browser');
await import('../gherkin/run.mjs');
