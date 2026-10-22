// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { runBatch, restoreBrowserUnits, prepareCachedUnits } from '../../scripts/ci-browser.mjs';
const cancellation = new AbortController();
const cancel = () => cancellation.abort();
process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
try {
  if (process.env.INPUT_MODE === 'batch') await runBatch({ batchId: process.env.INPUT_BATCH, node: process.env.INPUT_NODE, signal: cancellation.signal });
  else if (process.env.INPUT_MODE === 'prepare') await prepareCachedUnits();
  else if (process.env.INPUT_MODE === 'restore') await restoreBrowserUnits();
  else throw new Error('Unknown browser validation mode.');
} catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
finally { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }
