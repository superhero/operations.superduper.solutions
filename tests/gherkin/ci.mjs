// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, validatePlan, verifyPlanInputs, digest, same, hashFiles } from './ci-inputs.mjs';
import { readJSON, writeJSON, unitDirectory, sealUnit, verifyReceipt, verifyBrowserAggregate } from './ci-units.mjs';

const root = resolve(import.meta.dirname, '../..');
export function runChild(script, args = [], environment = process.env) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: environment, stdio: 'inherit' });
    const signal = name => child.kill(name);
    const interrupt = () => signal('SIGINT'), terminate = () => signal('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, sig) => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      resolveExit(sig ? 1 : code ?? 1);
    });
  });
}

export async function preparePlan(environment = process.env) {
  mkdirSync(resolve(root, 'tmp/test/ci'), { recursive: true });
  mkdirSync(resolve(root, 'tmp/test/browser'), { recursive: true });
  const { buildFixtureBundles } = await import('../browser/fixture-bundles.mjs');
  writeJSON(resolve(root, 'tmp/test/browser/fixture-bundles.json'), await buildFixtureBundles());
  const output = 'tmp/test/ci/bindings.json';
  if (await runChild(resolve(root, 'tests/gherkin/ci-discover.mjs'), [output]) !== 0) throw new Error('Browser binding collection failed.');
  const testedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const plan = createPlan({ bindings: readJSON(resolve(root, output)), image: environment.CI_BROWSER_IMAGE_SHA, imageReference: environment.CI_BROWSER_IMAGE_REFERENCE,
    capture: environment.CI_BROWSER_CAPTURE ?? 'full', repository: environment.GITHUB_REPOSITORY,
    pullRequest: Number(environment.CI_PR_NUMBER ?? 0), sourceSha: environment.CI_SOURCE_SHA ?? testedSha, testedSha,
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
    timings: readJSON(resolve(root, '.github/ci-browser-timings.json')).features, root });
  writeJSON(resolve(root, 'tmp/test/ci/plan.json'), plan);
  return plan;
}

export async function executeUnit(plan, unit) {
  verifyPlanInputs(plan, root);
  if (!plan.units.includes(unit)) throw new Error('Unit is not in the execution plan.');
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== plan.testedSha
    || !same(hashFiles(unit.inputs.map(([path]) => path), root), unit.inputs)
    || digest(readFileSync(resolve(root, unit.feature))) !== unit.featureDigest)
    throw new Error('Unit inputs changed after planning.');
  const directory = unitDirectory(unit, root), output = relative(root, directory).replaceAll('\\', '/');
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const context = resolve(directory, 'context.json');
  writeJSON(context, unit);
  writeFileSync(`/tmp/ci-unit-${unit.id}.pid`, String(process.pid));
  const exitCode = await runChild(resolve(root, 'tests/gherkin/run.mjs'), ['browser', '--features', unit.feature],
    { ...process.env, OPERATIONS_TEST_OUTPUT: output, OPERATIONS_CI_CONTEXT: context,
      OPERATIONS_FIXTURE_BUNDLES: 'tmp/test/browser/fixture-bundles.json', OPERATIONS_TEST_WORKERS: '1',
      OPERATIONS_CI_CAPTURE: unit.capture, OPERATIONS_TEST_TAGS: '', SCHEMA_PROFILE_LOW_OVERHEAD: '', SCHEMA_PROFILE_STARTUP_ONLY: '' });
  rmSync(`/tmp/ci-unit-${unit.id}.pid`, { force: true });
  if (exitCode !== 0) return exitCode;
  sealUnit(plan, unit, directory, { root });
  return 0;
}

export function assembleBrowser(plan) {
  const directories = plan.units.map(unit => unitDirectory(unit, root));
  const verified = verifyBrowserAggregate(plan, directories, { root });
  const modules = verified.flatMap(item => readJSON(resolve(item.directory, 'vitest-browser-chromium.json')).testResults);
  const first = readJSON(resolve(verified[0].directory, 'vitest-browser-chromium.json'));
  const cases = modules.flatMap(file => file.assertionResults);
  const report = { ...first, success: true, testResults: modules,
    numTotalTests: cases.length, numPassedTests: cases.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: modules.length, numPassedTestSuites: modules.length, numFailedTestSuites: 0,
    numPendingTestSuites: 0, operationsAggregate: { schemaVersion: 3, testedSha: plan.testedSha, inventoryDigest: plan.inventoryDigest } };
  writeJSON(resolve(root, 'tmp/test/vitest-browser-chromium.json'), report);
  writeJSON(resolve(root, 'tmp/test/ci/browser-aggregate.json'), { schemaVersion: 3, plan,
    units: verified.map(item => ({ id: item.unit.id, directory: relative(root, item.directory).replaceAll('\\', '/'), receiptHash: digest(readFileSync(resolve(item.directory, 'receipt.json'))) })) });
  return verified;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, id] = process.argv.slice(2);
    if (command === 'plan') {
      const plan = await preparePlan();
      console.log(`Planned ${plan.units.length} browser features / ${plan.units.reduce((sum, unit) => sum + unit.expectedCaseIds.length, 0)} cases.`);
    } else {
      const plan = validatePlan(readJSON(resolve(root, process.env.CI_PLAN_FILE ?? 'tmp/test/ci/plan.json')));
      if (command === 'unit') {
        const unit = plan.units.find(item => item.id === id);
        if (!unit) throw new Error('Unknown CI feature unit.');
        process.exitCode = await executeUnit(plan, unit);
      } else if (command === 'assemble') {
        const verified = assembleBrowser(plan);
        console.log(`Verified all ${verified.length} browser feature units.`);
      } else if (command === 'verify-unit') {
        const unit = plan.units.find(item => item.id === id);
        if (!unit) throw new Error('Unknown CI feature unit.');
        verifyReceipt(plan, unit, unitDirectory(unit, root), { root, allowCurrentRun: true });
      } else throw new Error('Usage: ci.mjs plan | unit <id> | verify-unit <id> | assemble');
    }
  } catch (error) { console.error(`::error::CI validation failed: ${error.message}`); process.exitCode = 1; }
}
