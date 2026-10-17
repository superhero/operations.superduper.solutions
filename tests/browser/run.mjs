// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfiguration, runCucumber } from '@cucumber/cucumber/api';

const { runConfiguration } = await loadConfiguration({
  file: 'cucumber.config.mjs', profiles: ['browser'], provided: process.argv.slice(2),
});
let directory;
try {
  if (!runConfiguration.runtime.dryRun) {
    directory = await mkdtemp(join(tmpdir(), 'operations-browser-fixtures-'));
    const filename = join(directory, 'bundles.json');
    const { buildFixtureBundles } = await import('./fixture-bundles.mjs');
    const started = performance.now();
    const bundles = await buildFixtureBundles();
    await writeFile(filename, JSON.stringify(bundles));
    process.stderr.write(`Browser fixtures: built ${Object.keys(bundles).length} bundles once in ${Math.round(performance.now() - started)} ms.\n`);
    runConfiguration.runtime.worldParameters = { ...runConfiguration.runtime.worldParameters, fixtureBundlesFile: filename };
  }
  const { success } = await runCucumber(runConfiguration);
  process.exitCode = success ? 0 : 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
