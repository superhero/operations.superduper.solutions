// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { test as base } from 'vitest';
import { initializeWorker, cleanupWorker } from './cucumber-compat.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function lifecycle(complete) {
  if (process.env.OPERATIONS_CI_CONTEXT) writeFileSync(resolve(process.env.OPERATIONS_TEST_OUTPUT, 'worker-lifecycle.json'),
    JSON.stringify({ complete, finishedAt: new Date().toISOString() }) + '\n');
}

export const test = base.extend('operationsBrowserWorker',
  { auto: true, scope: 'worker' }, async ({}, { onCleanup }) => {
    // Register cleanup before startup, so partially initialized resources close.
    onCleanup(async () => {
      try { await cleanupWorker(); lifecycle(true); }
      catch (error) { lifecycle(false); throw error; }
    });
    await initializeWorker();
    return true;
  });
