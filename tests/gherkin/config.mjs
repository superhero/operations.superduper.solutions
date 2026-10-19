// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';
import { profiles } from './profiles.mjs';
import { browserProjects } from './browser-projects.mjs';

export const root = resolve(import.meta.dirname, '../..');
const runnerDirectory = resolve(root, 'tests/gherkin/quickpickle');
const runnerFingerprint = createHash('sha256');
for (const file of readdirSync(resolve(runnerDirectory, 'src')).filter(file => file.endsWith('.mjs')).sort())
  runnerFingerprint.update(file).update(readFileSync(resolve(runnerDirectory, 'src', file)));
const runnerCacheIdentity = runnerFingerprint.digest('hex').slice(0, 12);
export const coverageScope = JSON.parse(readFileSync(resolve(root, 'coverage.config.json'), 'utf8'));
export const coverageOptions = (directory = 'tmp/test/coverage') => ({
  enabled: true, provider: 'v8', autoAttachSubprocess: true,
  include: coverageScope.include, exclude: coverageScope.exclude,
  reporter: ['json', 'json-summary', 'html', 'text-summary'],
  reportsDirectory: directory,
  thresholds: { lines: coverageScope.lines, branches: coverageScope.branches,
    statements: coverageScope.statements, functions: coverageScope.functions },
});

// The production client still runs through its real RPC. Only Vite's worker
// constructor adapter is replaced, matching the native-loader test seam.
function matchingWorkerConstructor() {
  return {
    name: 'operations-test-worker-constructor', enforce: 'pre',
    resolveId(id, importer) {
      if (id === './operation-matching.worker.ts?worker&inline'
        && importer?.split('?')[0] === resolve(root, 'src/lib/operation-matching-client.ts'))
        return '\0operations:matching-test-worker';
    },
    load(id) {
      if (id === '\0operations:matching-test-worker') return `export default class {
        constructor(options) { return globalThis[Symbol.for('operations.matching.test.worker-factory')](options); }
      }`;
    },
  };
}

export async function createTestConfig(name = process.env.OPERATIONS_TEST_PROFILE ?? 'source') {
  const profile = profiles[name];
  if (!profile) throw new Error(`Unknown Gherkin test profile: ${name}`);
  const browser = name === 'browser';
  const components = name === 'components';
  const engine = process.env.BROWSER_ENGINE ?? 'chromium';
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`Unsupported browser engine: ${engine}`);
  const identity = browser ? `browser-${engine}` : name;
  const workers = browser ? Number(process.env.OPERATIONS_TEST_WORKERS ?? (process.env.GITHUB_ACTIONS ? '2' : '1')) : 1;
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 2) throw new Error('Browser workers must be 1 or 2.');
  const selected = process.env.OPERATIONS_FEATURES ? JSON.parse(process.env.OPERATIONS_FEATURES) : profile.paths;
  let tags = process.env.OPERATIONS_TEST_TAGS ?? '';
  if (browser && engine !== 'chromium') tags = tags ? `(${tags}) and not @chromium-only` : 'not @chromium-only';
  const plugins = [];
  if (components) {
    const { svelte } = await import('@sveltejs/vite-plugin-svelte');
    plugins.push(svelte());
  }
  plugins.push(quickpickle({ root, stepTimeout: 120_000, stepAbortGrace: 2_000,
    tagExpression: tags, ...(browser ? { testModule: resolve(root, 'tests/gherkin/worker-test.mjs') } : {}) }));
  if (name === 'source') plugins.push(matchingWorkerConstructor());
  const config = {
    root, cacheDir: resolve(root, `tmp/test/.vite/${identity}-${runnerCacheIdentity}`), plugins,
    resolve: { alias: [{ find: /^@cucumber\/cucumber$/, replacement: resolve(root, 'tests/gherkin/cucumber-compat.mjs') }] },
    test: {
      name: identity, include: selected, passWithNoTests: false,
      environment: 'node', pool: 'forks', maxWorkers: workers,
      fileParallelism: browser && workers > 1, isolate: false, retry: 0,
      testTimeout: browser ? 300_000 : 240_000, hookTimeout: 120_000,
      setupFiles: [resolve(root, components ? 'tests/components/component.steps.mjs'
        : browser ? 'tests/gherkin/setup.browser.mjs' : 'tests/gherkin/setup.node.mjs')],
      server: { deps: { external: ['quickpickle', /[\\/]tests[\\/]gherkin[\\/]quickpickle[\\/]/, ...(browser ? [
        /[\\/]tests[\\/]gherkin[\\/](?:native-steps|cucumber-compat|worker-test)\.mjs$/,
      ] : [])] } },
      attachmentsDir: resolve(root, 'tmp/test/attachments'),
      reporters: ['default', resolve(root, 'tests/gherkin/interrupt-reporter.mjs'), ['json', { outputFile: `tmp/test/vitest-${identity}.json` }],
        ['blob', { outputFile: `tmp/test/blobs/${identity}.json` }]],
      ...(name === 'source' && process.env.OPERATIONS_COVERAGE === '1' ? { coverage: coverageOptions() } : {}),
    },
  };
  if (browser) {
    const projects = browserProjects(selected, identity, workers);
    if (projects) {
      // Inline projects inherit setup/plugins and root reporters. An empty root
      // include prevents inherited patterns from duplicating either partition.
      config.test.include = [];
      delete config.test.name;
      config.test.projects = projects;
    }
  }
  if (components) {
    const { playwright } = await import('@vitest/browser-playwright');
    config.test.browser = {
      enabled: true, headless: true,
      provider: playwright({ launchOptions: { args: ['--disable-dev-shm-usage'] } }),
      instances: [{ browser: engine }], screenshotFailures: true,
    };
  }
  return defineConfig(config);
}
