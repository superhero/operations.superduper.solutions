// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const mode = process.env.OPERATIONS_RUNNER_FIXTURE_MODE;
const output = process.env.OPERATIONS_RUNNER_FIXTURE_OUTPUT;
const features = {
  positive: ['positive-a.feature', 'positive-b.feature'],
  contracts: ['regressions.feature'],
  selection: ['regressions.feature'],
  quarantine: ['quarantine.feature'],
  retry: ['retry.feature'],
  worker: ['worker-a.feature', 'worker-b.feature'],
  statuses: ['statuses.feature'],
  'hook-errors': ['hook-errors.feature'],
  interruption: ['interruption.feature'],
  'interruption-term': ['interruption.feature'],
  'interruption-forced': ['interruption-forced.feature'],
};
if (!features[mode] || !output) throw new Error('A runner fixture mode and output directory are required.');
const fixture = 'tests/gherkin/runner-regressions/fixtures/';
const signalProbe = {
  onInit(vitest) {
    const loggerExit = process.listeners('SIGINT').find(listener => process.listeners('SIGTERM').includes(listener)
      && process.listeners('exit').includes(listener));
    const record = signal => appendFileSync(join(output, 'ledger.ndjson'), `${JSON.stringify({
      kind: 'unrelated-interrupt', signal, loggerExitRetained: process.listeners('exit').includes(loggerExit),
    })}\n`);
    const onInterrupt = () => record('SIGINT');
    const onTerminate = () => record('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    vitest.onClose(() => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    });
  },
};

export default defineConfig({
  root,
  cacheDir: join(output, 'cache'),
  plugins: [quickpickle({
    stepTimeout: ['contracts', 'quarantine'].includes(mode) ? 80 : 2000,
    stepAbortGrace: 500,
    tagExpression: mode === 'selection' ? '@second and not @first' : '',
    ...( ['worker', 'quarantine', 'interruption', 'interruption-term', 'interruption-forced'].includes(mode)
      ? { testModule: join(root, fixture, 'worker-test.mjs') } : {}),
  })],
  test: {
    name: `runner-fixture-${mode}`,
    include: features[mode].map(name => fixture + name),
    setupFiles: [fixture + 'setup.mjs'],
    environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false,
    isolate: mode !== 'worker', testTimeout: mode.startsWith('interruption') ? 10000 : 4000, hookTimeout: 4000,
    retry: mode === 'retry' ? 1 : 0,
    server: { deps: { external: ['quickpickle',
      /[\\/]tests[\\/]gherkin[\\/]quickpickle[\\/]/,
      /[\\/]runner-regressions[\\/]fixtures[\\/]native-load\.mjs$/] } },
    reporters: [['json', { outputFile: join(output, 'results.json') }],
      ...(mode.startsWith('interruption') ? [signalProbe] : []),
      [join(root, 'tests/gherkin/interrupt-reporter.mjs'), {
        ...(mode === 'interruption-forced' ? { shutdownTimeout: 1000 } : {}),
      }]],
  },
});
