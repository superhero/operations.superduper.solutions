// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.env.OPERATIONS_TEST_OUTPUT ?? 'tmp/test';
if (!/^tmp\/test(?:\/[a-zA-Z0-9_-]+)*$/.test(output)) throw new Error('Invalid runner output directory.');
export default defineConfig({
  root,
  cacheDir: `${output}/.vite/runner`,
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
    attachmentsDir: `${output}/attachments`,
    reporters: ['default', ['json', { outputFile: `${output}/vitest-runner.json` }],
      ['blob', { outputFile: `${output}/blobs/runner.json` }],
      fileURLToPath(new URL('../interrupt-reporter.mjs', import.meta.url))],
  },
});
