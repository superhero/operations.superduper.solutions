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
  schemaFixture: 'schema-lifecycle',
};

export async function buildFixtureBundles() {
  const bundles = { fixtureChunks: {} };
  // Build serially to bound peak memory. Lazy imports may produce shared JS
  // chunks; retain them alongside the entry rather than serving a broken module.
  for (const [name, file] of Object.entries(entries)) {
    const result = await build({ configFile: false, logLevel: 'error',
      build: { write: false, target: 'es2024', minify: false,
        lib: { entry: resolve(`tests/browser/${file}.fixture.ts`), formats: ['es'] } } });
    const output = Array.isArray(result) ? result[0] : result;
    for (const item of output.output.filter(item => item.type === 'chunk' && !item.isEntry)) {
      if (bundles.fixtureChunks[item.fileName] && bundles.fixtureChunks[item.fileName] !== item.code)
        throw new Error(`Conflicting browser fixture chunk: ${item.fileName}`);
      bundles.fixtureChunks[item.fileName] = item.code;
    }
    bundles[name] = output.output.find(item => item.type === 'chunk' && item.isEntry).code;
  }
  return bundles;
}
