// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createPlan } from '../../tests/gherkin/ci-inputs.mjs';
import { readJSON, writeJSON } from '../../tests/gherkin/ci-units.mjs';

const repository = resolve(import.meta.dirname, '../..');
let template, templateFailure, reportTemplate;
function linkDependencies(root) {
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  for (const name of readdirSync(join(repository, 'node_modules'))) {
    if (name.startsWith('.') || name === 'quickpickle') continue;
    symlinkSync(join(repository, 'node_modules', name), join(root, 'node_modules', name));
  }
  symlinkSync(join(root, 'tests/gherkin/quickpickle'), join(root, 'node_modules/quickpickle'), 'dir');
  symlinkSync(join(repository, 'tests/gherkin/quickpickle/node_modules'), join(root, 'tests/gherkin/quickpickle/node_modules'), 'dir');
}
export function fixtureCommand(root, args, extra = {}) {
  const environment = { ...process.env };
  for (const key of ['OPERATIONS_CI_CONTEXT', 'OPERATIONS_TEST_OUTPUT', 'OPERATIONS_TEST_TAGS', 'OPERATIONS_FEATURES', 'OPERATIONS_COVERAGE']) delete environment[key];
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...environment,
    GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTIONS: '', CI_WORKFLOW_FILE: '.github/workflows/ci-release.yml',
    ...extra },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
export function planFixture(root, bindings = readJSON(join(root, 'tmp/test/ci/bindings.json'))) {
  const head = git(root, 'rev-parse', 'HEAD');
  return createPlan({ bindings, image: `sha256:${'a'.repeat(64)}`, repository: 'owner/project', pullRequest: 42,
    sourceSha: head, testedSha: head, runId: 123456, runAttempt: 1, root });
}
function buildTemplate({ report = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'operations-ci-unit-control-'));
  const filter = source => !source.split('/').some(name => ['node_modules', '.git', '.vite'].includes(name));
  mkdirSync(join(root, 'tests'), { recursive: true });
  cpSync(join(repository, 'tests/gherkin'), join(root, 'tests/gherkin'), { recursive: true, filter });
  cpSync(join(repository, 'tests/source-profile.json'), join(root, 'tests/source-profile.json'));
  mkdirSync(join(root, '.github/scripts'), { recursive: true });
  for (const name of ['test-results.mjs', 'ci-unit-cache.mjs', 'ci-artifact.mjs', 'generate-test-report.mjs',
    'generate-incremental-report.mjs', 'ci-report-evidence.mjs', 'validation-artifacts.mjs', 'changelog.mjs'])
    cpSync(join(repository, '.github/scripts', name), join(root, '.github/scripts', name));
  for (const name of ['package.json', 'package-lock.json', '.node-version', 'coverage.config.json', 'vitest.config.mjs', 'vite.config.mjs'])
    cpSync(join(repository, name), join(root, name));
  linkDependencies(root);
  mkdirSync(join(root, 'tests/browser'), { recursive: true });
  cpSync(join(repository, 'tests/browser/capture-policy.fixture.mjs'), join(root, 'tests/browser/capture-policy.fixture.mjs'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'node_modules\ntmp/\n');
  writeFileSync(join(root, 'src/fixture.js'), 'export const value = 1;\n');
  writeFileSync(join(root, 'dist/index.html'), '<title>Hermetic CI execution control</title>');
  writeFileSync(join(root, 'tests/browser/support.mjs'), `import { BeforeAll, AfterAll } from '@cucumber/cucumber';
BeforeAll(function () {});
AfterAll(function () {});
`);
  writeFileSync(join(root, 'tests/browser/helper.fixture.mjs'), 'export const value = 1;\n');
  for (const [name, count] of [['keybindings', 9], ['other', 2]]) {
    writeFileSync(join(root, `tests/browser/${name}.steps.mjs`), `import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { value } from './helper.fixture.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
Then('the ${name} unit assertion passes', async function () {
  assert.equal(value, 1);
  const path = resolve(process.env.OPERATIONS_TEST_OUTPUT, 'original-attachment.txt');
  writeFileSync(path, 'Original ${name} evidence');
  await this._quickpickleContext.annotate('Original attachment', { path, contentType: 'text/plain' });
});\n`);
    writeFileSync(join(root, `tests/browser/${name}.feature`), `Feature: ${name} execution control\n` +
      Array.from({ length: count }, (_, index) => `  Scenario: Independent ${name} case ${index + 1}\n    Then the ${name} unit assertion passes\n`).join('\n'));
  }
  if (report) prepareReportProfiles(root);
  git(root, 'init', '-q'); git(root, 'add', '.');
  git(root, '-c', 'user.name=CI fixture', '-c', 'user.email=ci-fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'test fixture');
  mkdirSync(join(root, 'tmp/test/ci'), { recursive: true }); mkdirSync(join(root, 'tmp/test/browser'), { recursive: true });
  writeJSON(join(root, 'tmp/test/browser/fixture-bundles.json'), {});
  const collected = fixtureCommand(root, ['tests/gherkin/ci-discover.mjs', 'tmp/test/ci/bindings.json']);
  if (collected.status !== 0) throw new Error(collected.stdout + collected.stderr);
  const plan = planFixture(root); writeJSON(join(root, 'tmp/test/ci/plan.json'), plan);
  for (const unit of plan.units) {
    const result = fixtureCommand(root, ['tests/gherkin/ci.mjs', 'unit', unit.id]);
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  }
  if (report) {
    for (const profile of ['source', 'acceptance', 'automation', 'components', 'runner']) {
      const result = fixtureCommand(root, ['tests/gherkin/run.mjs', profile], profile === 'source' ? { OPERATIONS_COVERAGE: '1' } : {});
      if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    }
    const result = fixtureCommand(root, ['tests/gherkin/ci.mjs', 'assemble']);
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  }
  return root;
}
export function createUnitFixture(target) {
  if (templateFailure) throw templateFailure;
  try { template ??= buildTemplate(); } catch (error) { templateFailure = error; throw error; }
  cpSync(template, target, { recursive: true, filter: source => !source.endsWith('/node_modules') });
  linkDependencies(target);
  return { root: target, plan: readJSON(join(target, 'tmp/test/ci/plan.json')) };
}
export function createIncrementalFixture(target) {
  reportTemplate ??= buildTemplate({ report: true });
  cpSync(reportTemplate, target, { recursive: true, filter: source => !source.endsWith('/node_modules') });
  linkDependencies(target);
  return { root: target, plan: readJSON(join(target, 'tmp/test/ci/plan.json')) };
}
function prepareReportProfiles(root) {
  for (const name of ['_headers', 'apple-touch-icon.png', 'favicon.bmp', 'favicon.gif', 'favicon.ico', 'favicon.jpg',
    'favicon.png', 'favicon.ppm', 'favicon.svg', 'favicon.tiff']) writeFileSync(join(root, 'dist', name), `Hermetic packaging control: ${name}\n`);
  const feature = 'Feature: Native profile control\n  Scenario: Both measured branches execute\n    Then both source branches and evidence are retained\n';
  const paths = ['src/fixture.feature', 'src/build.feature', '.github/tests/fixture.feature',
    'tests/components/fixture.feature', 'tests/gherkin/runner-regressions/contracts.feature'];
  for (const path of paths) { mkdirSync(resolve(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), feature); }
  writeFileSync(join(root, 'src/fixture.js'), 'export function absolute(value) { if (value < 0) return -value; return value; }\n');
  writeJSON(join(root, 'tests/source-profile.json'), { paths: ['src/fixture.feature'], import: ['src/fixture.test.mjs'] });
  writeJSON(join(root, 'coverage.config.json'), { include: ['src/fixture.js'], exclude: [], lines: 100, branches: 100, functions: 100, statements: 100 });
  writeFileSync(join(root, 'tests/profile-control.mjs'), `import {Then} from './gherkin/cucumber-compat.mjs';
import {absolute} from '../src/fixture.js';
import assert from 'node:assert/strict';
Then('both source branches and evidence are retained', async function () {
  assert.equal(absolute(-1), 1); assert.equal(absolute(1), 1); await this.attach('Original whole-profile evidence');
});\n`);
  writeFileSync(join(root, 'vitest.config.mjs'), `import {createTestConfig} from './tests/gherkin/config.mjs';
const name = process.env.OPERATIONS_TEST_PROFILE;
const config = await createTestConfig(name);
if (name !== 'browser') config.test.setupFiles = ['tests/profile-control.mjs'];
// This hermetic control has native Gherkin cases, with the real component
// project's identity; it does not execute or certify application UI behavior.
if (name === 'components') { delete config.test.browser; config.test.name = 'components (chromium)'; }
export default config;\n`);
  writeFileSync(join(root, 'tests/gherkin/runner-regressions/vitest.config.mjs'), `export {default} from '../../../vitest.config.mjs';\n`);
}
export function cleanupUnitFixture() {
  for (const root of [template, reportTemplate]) if (root) rmSync(root, { recursive: true, force: true });
  template = undefined; templateFailure = undefined; reportTemplate = undefined;
}
