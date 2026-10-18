// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  root,
  plugins: [quickpickle({ stepTimeout: 5000,
    tagExpression: process.env.OPERATIONS_TEST_TAGS || '' })],
  test: {
    name: 'runner',
    include: process.env.OPERATIONS_FEATURES
      ? JSON.parse(process.env.OPERATIONS_FEATURES)
      : ['tests/gherkin/runner-regressions/contracts.feature'],
    setupFiles: ['tests/gherkin/runner-regressions/steps.mjs'],
    environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false,
    isolate: true, testTimeout: 15000, hookTimeout: 60000,
    server: { deps: { external: ['quickpickle', /[\\/]tests[\\/]gherkin[\\/]quickpickle[\\/]/] } },
    reporters: ['default', ['json', { outputFile: 'tmp/test/vitest-runner.json' }],
      ['blob', { outputFile: 'tmp/test/blobs/runner.json' }],
      fileURLToPath(new URL('../interrupt-reporter.mjs', import.meta.url))],
  },
});
