// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { defineConfig } from 'vitest/config';
import { root, coverageOptions } from './config.mjs';

// Merge serialized results and raw coverage; no step setup or tests run here.
const directory = process.env.OPERATIONS_REPORT_DIRECTORY ?? 'tmp/test/report';
const names = ['source', 'acceptance', 'automation',
  ...['chromium', 'firefox', 'webkit'].flatMap(engine => {
    const name = `browser-${engine}`;
    return [name, `${name}-service-library`, `${name}-application`];
  }), 'components', 'components (chromium)', 'runner'];
export default defineConfig({
  root,
  test: {
    include: [],
    projects: names.map(name => ({ test: { name, include: [] } })),
    coverage: coverageOptions(`${directory}/coverage`),
    attachmentsDir: 'tmp/test/attachments',
    reporters: ['default', ['json', { outputFile: `${directory}/results.json` }],
      ['html', { outputDir: directory }]],
  },
});
