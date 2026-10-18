// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Required inputs fail closed. Other Gherkin integration modules are discovered
// recursively, including nested QuickPickle shims and runner configurations.
export const requiredConfigurationFiles = Object.freeze([
  '.node-version', 'package.json', 'package-lock.json', 'vitest.config.mjs', 'coverage.config.json',
  'tests/gherkin/config.mjs', 'tests/gherkin/profiles.mjs', 'tests/gherkin/cucumber-compat.mjs',
  'tests/gherkin/execution-fingerprint.mjs', 'tests/gherkin/run.mjs',
  'tests/gherkin/setup.node.mjs', 'tests/gherkin/setup.browser.mjs',
  'tests/gherkin/native-steps.mjs', 'tests/gherkin/worker-test.mjs',
  'tests/gherkin/browser-abort-guard.mjs', 'tests/gherkin/merge.config.mjs',
  'tests/gherkin/quickpickle/index.mjs', 'tests/gherkin/quickpickle/package.json',
  'tests/gherkin/quickpickle/UPSTREAM.json',
]);

export const toolchainPackages = Object.freeze([
  'vitest', '@vitest/ui', '@vitest/coverage-v8', '@vitest/browser-playwright',
  'quickpickle', 'vite', 'svelte', '@sveltejs/vite-plugin-svelte',
  'vitest-browser-svelte', '@playwright/test', 'playwright', 'playwright-core',
]);

function modulesBelow(root, directory, paths) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) modulesBelow(root, path, paths);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) paths.add(path);
    else if (entry.isSymbolicLink()) throw new Error(`Execution configuration cannot contain an untracked symlink: ${path}`);
  }
}

export function configurationFingerprint(root) {
  const paths = new Set(requiredConfigurationFiles);
  modulesBelow(root, 'tests/gherkin', paths);
  const fingerprint = createHash('sha256').update('operations-gherkin-execution-v1\0');
  for (const path of [...paths].sort()) {
    const bytes = readFileSync(resolve(root, path));
    // Length-delimited paths and bytes prevent ambiguous concatenations.
    fingerprint.update(`${Buffer.byteLength(path)}:${path}${bytes.length}:`).update(bytes);
  }
  return fingerprint.digest('hex');
}

export function installedToolchain(root) {
  const versions = { node: process.version };
  for (const name of toolchainPackages) {
    const path = join(root, 'node_modules', ...name.split('/'), 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.name !== name || typeof manifest.version !== 'string'
      || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version))
      throw new Error(`Invalid installed toolchain manifest for ${name}`);
    versions[name] = manifest.version;
  }
  return versions;
}
