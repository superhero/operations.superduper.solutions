// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringify as stringifyBlob } from 'flatted';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { profiles } from '../../tests/gherkin/profiles.mjs';
import { configurationFingerprint, installedToolchain, requiredConfigurationFiles, toolchainPackages }
  from '../../tests/gherkin/execution-fingerprint.mjs';
import { caseId, expectedCases, hashFile, verifyCoverage, verifyExecution } from '../scripts/test-results.mjs';

const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const save = (path, value) => write(path, `${JSON.stringify(value)}\n`);
function fixture(world) {
  if (world.testEvidence) return world.testEvidence;
  const root = mkdtempSync(join(tmpdir(), 'operations-test-evidence-'));
  return world.testEvidence = { root, environment: new Map(['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']
    .map(name => [name, process.env[name]])) };
}
After({ tags: '@test-evidence' }, function () {
  if (!this.testEvidence) return;
  for (const [name, value] of this.testEvidence.environment)
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  rmSync(this.testEvidence.root, { recursive: true, force: true });
});
function blobFor(report) {
  const files = report.testResults.map((module, index) => {
    const file = { type: 'suite', id: `file-${index}`, name: module.name,
      filepath: module.name, projectName: 'source', tasks: [], result: { state: 'pass' } };
    file.tasks = module.assertionResults.map((item, row) => ({
      type: 'test', id: `case-${index}-${row}`, name: item.title, file, suite: file,
      meta: structuredClone(item.meta), result: { state: item.status === 'passed' ? 'pass' : item.status },
    }));
    return file;
  });
  // This is validator input, not a report to merge or release. Cyclic task/file
  // references exercise the same flatted representation as real Vitest blobs.
  return ['5.0.5', files, [], undefined, 0, {}];
}
function persist(state, { synchronizeBlob = true } = {}) {
  save(state.resultPath, state.report);
  if (synchronizeBlob) state.blob = blobFor(state.report);
  write(state.blobPath, stringifyBlob(state.blob));
  state.proof.resultHash = hashFile(state.resultPath);
  state.proof.blobHash = hashFile(state.blobPath);
  save(state.proofPath, state.proof);
}
Given('a complete synthetic source execution', function () {
  const state = fixture(this);
  // Small authored parser inputs cover the real declared source profile paths.
  // No actual application tests execute inside this validator scenario.
  for (const path of profiles.source.paths) {
    assert.ok(!path.includes('*'), 'Update this fixture when source profile discovery changes.');
    write(join(state.root, path), 'Feature: Evidence fixture\n\n  Scenario: Recorded case\n    Given a recorded step\n');
  }
  for (const path of requiredConfigurationFiles)
    write(join(state.root, path), path.endsWith('.json') ? '{}\n' : '// Synthetic execution configuration\n');
  const versions = Object.fromEntries(toolchainPackages.map(name => [name,
    name === 'quickpickle' ? '1.11.2-operations.1' : name.startsWith('@vitest/') || name === 'vitest' ? '5.0.5' : '1.2.3']));
  write(join(state.root, '.node-version'), `${process.versions.node}\n`);
  save(join(state.root, 'package.json'), { name: 'execution-evidence-fixture', type: 'module',
    engines: { node: process.versions.node }, devDependencies: versions });
  for (const [name, version] of Object.entries(versions))
    save(join(state.root, 'node_modules', ...name.split('/'), 'package.json'), { name, version });
  const git = (...args) => execFileSync('git', args, { cwd: state.root, encoding: 'utf8', timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet'); git('add', '.');
  git('-c', 'user.name=Evidence Fixture', '-c', 'user.email=evidence@example.invalid', '-c', 'core.hooksPath=/dev/null',
    'commit', '--quiet', '-m', 'Fixture feature inventory');
  const expected = expectedCases('source', state.root);
  state.expected = expected;
  state.resultPath = join(state.root, 'tmp/test/vitest-source.json');
  state.blobPath = join(state.root, 'tmp/test/blobs/source.json');
  state.proofPath = join(state.root, 'tmp/test/executions/source.json');
  const tests = expected.features.map(uri => ({ name: join(state.root, uri), assertionResults: [{
    title: 'Recorded case', status: 'passed', meta: { gherkin: { uri, line: 3, exampleLine: 3,
      steps: [{ text: 'a recorded step', line: 4, status: 'passed' }] } },
  }] }));
  state.report = { success: true, numFailedTestSuites: 0, numTotalTests: tests.length,
    numPassedTests: tests.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: tests.length, numPassedTestSuites: tests.length, testResults: tests };
  state.proof = { profile: 'source', project: 'source', head: git('rev-parse', 'HEAD'),
    featurePaths: expected.features, expectedCaseIds: expected.ids, filtered: false, complete: true, exitCode: 0,
    startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z',
    configFingerprint: configurationFingerprint(state.root), dependencyVersions: installedToolchain(state.root), runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null };
  persist(state);
});
Given('its evidence has {string}', function (defect) {
  const state = this.testEvidence;
  const item = state.report.testResults[0].assertionResults[0];
  switch (defect) {
    case 'missing results': rmSync(state.resultPath); return;
    case 'missing blob': rmSync(state.blobPath); return;
    case 'missing proof': rmSync(state.proofPath); return;
    case 'filtered run': state.proof.filtered = true; break;
    case 'incomplete run': state.proof.complete = false; break;
    case 'nonzero exit': state.proof.exitCode = 1; break;
    case 'stale commit': state.proof.head = 'f'.repeat(40); break;
    case 'wrong profile': state.proof.profile = 'acceptance'; break;
    case 'wrong project': state.proof.project = 'automation'; break;
    case 'incomplete feature list': state.proof.featurePaths = state.proof.featurePaths.slice(1); break;
    case 'missing case': state.report.testResults.pop(); state.report.numTotalTests--; state.report.numPassedTests--; break;
    case 'duplicate case': state.report.testResults[1].assertionResults[0].meta = structuredClone(item.meta); break;
    case 'missing Gherkin metadata': delete item.meta.gherkin; break;
    case 'mismatched result hash': state.proof.resultHash = 'f'.repeat(64); save(state.proofPath, state.proof); return;
    case 'mismatched blob hash': state.proof.blobHash = 'f'.repeat(64); save(state.proofPath, state.proof); return;
    case 'reversed timestamps': state.proof.finishedAt = '2025-01-01T00:00:00.000Z'; break;
    case 'missing configuration identity': delete state.proof.configFingerprint; break;
    case 'altered configuration identity': state.proof.configFingerprint = 'f'.repeat(64); break;
    case 'changed configuration input': write(join(state.root, 'vitest.config.mjs'), '// Changed after execution\n'); break;
    case 'changed installed version': save(join(state.root, 'node_modules/vitest/package.json'), { name: 'vitest', version: '5.0.6' }); break;
    case 'mismatched recorded toolchain': state.proof.dependencyVersions.vitest = '5.0.4'; break;
    case 'another CI run': process.env.GITHUB_RUN_ID = '12345'; state.proof.runId = '54321'; break;
    case 'another CI attempt': process.env.GITHUB_RUN_ID = '12345'; process.env.GITHUB_RUN_ATTEMPT = '2';
      state.proof.runId = '12345'; state.proof.runAttempt = '1'; break;
    case 'unsuccessful report': state.report.success = false; break;
    case 'failed module': state.report.numFailedTestSuites = 1; break;
    case 'skipped scenario': item.status = 'skipped'; state.report.numPassedTests--; state.report.numPendingTests++; break;
    case 'pending scenario': item.status = 'pending'; state.report.numPassedTests--; state.report.numPendingTests++; break;
    case 'missing steps': item.meta.gherkin.steps = []; break;
    case 'changed authored step text': item.meta.gherkin.steps[0].text = 'changed in JSON and blob'; break;
    case 'added unauthored step': item.meta.gherkin.steps.push({ text: 'extra step in both outputs', line: 4, status: 'passed' }); break;
    case 'changed authored step line': item.meta.gherkin.steps[0].line = 5; break;
    case 'unexecuted step': item.meta.gherkin.steps[0].status = 'pending'; break;
    case 'inconsistent totals': state.report.numTotalTests++; break;
    case 'blob missing case': state.blob[1].pop(); persist(state, { synchronizeBlob: false }); return;
    case 'blob extra case': {
      const extra = structuredClone(state.blob[1][0]);
      extra.filepath = join(state.root, 'src/undeclared.feature');
      extra.tasks[0].meta.gherkin.uri = 'src/undeclared.feature';
      state.blob[1].push(extra); persist(state, { synchronizeBlob: false }); return;
    }
    case 'blob wrong project': state.blob[1][0].projectName = 'automation'; persist(state, { synchronizeBlob: false }); return;
    case 'blob different steps': state.blob[1][0].tasks[0].meta.gherkin.steps[0].text = 'different recorded step';
      persist(state, { synchronizeBlob: false }); return;
    case 'blob failed case': state.blob[1][0].tasks[0].result.state = 'fail'; persist(state, { synchronizeBlob: false }); return;
    case 'blob wrong feature path': state.blob[1][0].filepath = join(state.root, 'src/unrelated.feature');
      persist(state, { synchronizeBlob: false }); return;
    case 'blob run errors': state.blob[2].push({ message: 'Uncaught runner failure' }); persist(state, { synchronizeBlob: false }); return;
    case 'blob unsupported version': state.blob[0] = '5.0.4'; persist(state, { synchronizeBlob: false }); return;
    default: assert.fail(`Unknown evidence defect: ${defect}`);
  }
  persist(state);
});
When('its execution evidence is checked', function () {
  try { this.testEvidence.value = verifyExecution('source', 'tmp/test', { root: this.testEvidence.root }); }
  catch (error) { this.testEvidence.error = error; }
});
Then('the execution evidence is accepted', function () {
  assert.ifError(this.testEvidence.error);
  assert.equal(this.testEvidence.value.profile, 'source');
  assert.equal(this.testEvidence.value.cases, this.testEvidence.expected.ids.length);
});
Then('the execution evidence is rejected', function () { assert.ok(this.testEvidence.error); });

Given('a Gherkin identity expressed as {string}', function (form) {
  const state = fixture(this);
  const uri = 'src/example.feature';
  const forms = { 'relative path': uri, 'absolute path': join(state.root, uri), 'file URL': pathToFileURL(join(state.root, uri)).href,
    'outside repository': join(state.root, '..', 'outside.feature'), 'traversal path': 'src/../../outside.feature',
    'dot path alias': 'src/../src/example.feature' };
  state.metadata = { uri: forms[form] ?? uri, line: 3, exampleLine: 11 };
  if (form === 'missing location') delete state.metadata.line;
  if (form === 'invalid row') state.metadata.exampleLine = 0;
});
When('its canonical identity is read', function () {
  try { this.testEvidence.value = caseId(this.testEvidence.metadata, this.testEvidence.root); }
  catch (error) { this.testEvidence.error = error; }
});
Then('it identifies the repository feature and example row', function () {
  assert.ifError(this.testEvidence.error); assert.equal(this.testEvidence.value, 'src/example.feature:11');
});
Then('the invalid identity is rejected', function () { assert.ok(this.testEvidence.error); });
Then('unknown evidence profiles are rejected', function () { assert.throws(() => expectedCases('unknown-profile')); });

Given('synthetic coverage with {string}', function (defect) {
  const state = fixture(this);
  state.coverage = { total: Object.fromEntries(['statements', 'branches', 'functions', 'lines']
    .map(metric => [metric, { total: 10, covered: 10, skipped: 0, pct: 100 }])) };
  const metric = state.coverage.total.branches;
  switch (defect) {
    case 'all counters covered': break;
    case 'missing metric': delete state.coverage.total.functions; break;
    case 'partial branch count': metric.covered = 9; metric.pct = 90; break;
    case 'rounded percentage': metric.covered = 9; break;
    case 'skipped counter': metric.skipped = 1; break;
    case 'unexecuted source': metric.covered = 0; metric.pct = 0; break;
    case 'empty denominator': metric.total = 0; metric.covered = 0; break;
    default: assert.fail(`Unknown coverage defect: ${defect}`);
  }
  state.coveragePath = join(state.root, 'coverage-summary.json'); save(state.coveragePath, state.coverage);
});
When('its coverage evidence is checked', function () {
  try { this.testEvidence.value = verifyCoverage(this.testEvidence.coveragePath); }
  catch (error) { this.testEvidence.error = error; }
});
Then('the coverage evidence is accepted', function () { assert.ifError(this.testEvidence.error); assert.ok(this.testEvidence.value); });
Then('the coverage evidence is rejected', function () { assert.ok(this.testEvidence.error); });
