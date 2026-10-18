// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { test as base } from 'vitest';
import { initializeWorker, cleanupWorker } from './cucumber-compat.mjs';

export const test = base.extend('operationsBrowserWorker',
  { auto: true, scope: 'worker' }, async ({}, { onCleanup }) => {
    // Register cleanup before startup, so partially initialized resources close.
    onCleanup(cleanupWorker);
    await initializeWorker();
    return true;
  });
