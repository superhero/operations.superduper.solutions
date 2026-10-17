// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { resolve } from 'node:path';
import { build } from 'vite';

const entries = {
  repositoryFixture: 'workflow-repository',
  errorHistoryFixture: 'error-history-storage',
  vaultFixture: 'vault-storage',
  policyFixture: 'vault-policy',
  kdfFixture: 'vault-kdf',
};

export async function buildFixtureBundles() {
  const bundles = {};
  // Keep each entry standalone and build serially to bound peak memory.
  for (const [name, file] of Object.entries(entries)) {
    const result = await build({ configFile: false, logLevel: 'error',
      build: { write: false, target: 'es2024', minify: false,
        lib: { entry: resolve(`tests/browser/${file}.fixture.ts`), formats: ['es'] } } });
    const output = Array.isArray(result) ? result[0] : result;
    bundles[name] = output.output.find(item => item.type === 'chunk' && item.isEntry).code;
  }
  return bundles;
}
