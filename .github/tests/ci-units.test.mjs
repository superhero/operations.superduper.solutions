// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, unlinkSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parse as parseBlob } from 'flatted';
import { AfterAll, Given, When, Then } from '@cucumber/cucumber';
import { createUnitFixture, createIncrementalFixture, cleanupUnitFixture, planFixture, fixtureCommand } from './ci-units.fixture.mjs';
import { readJSON, writeJSON, verifyReceipt, verifyBrowserAggregate, unitDirectory, MAX_AGE_MS } from '../../tests/gherkin/ci-units.mjs';
import { validatePlan } from '../../tests/gherkin/ci-inputs.mjs';
import { restoreUnit } from '../scripts/ci-unit-cache.mjs';
import { command } from '../scripts/ci-browser.mjs';

Then('the installed artifact SDK verifies a checkpoint with a {string} archive digest', async function (kind) {
  // A stored ZIP containing checkpoint.txt, served through the real SDK's REST
  // redirect and archive extraction path without external network access.
  const archive = Buffer.from('UEsDBBQAAAAAAAAAIVyfkyJ+HAAAABwAAAAOAAAAY2hlY2twb2ludC50eHR2ZXJpZmllZCBmZWF0dXJlIGNoZWNrcG9pbnQKUEsBAhQDFAAAAAAAAAAhXJ+TIn4cAAAAHAAAAA4AAAAAAAAAAAAAAIABAAAAAGNoZWNrcG9pbnQudHh0UEsFBgAAAAABAAEAPAAAAEgAAAAAAA==', 'base64');
  const requests = [];
  let origin;
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/repos/owner/project/actions/artifacts/7/zip') {
      response.writeHead(302, { location: `${origin}/checkpoint.zip` }); response.end();
    } else if (request.url === '/checkpoint.zip') {
      response.writeHead(200, { 'content-type': 'application/zip', 'content-length': archive.length }); response.end(archive);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const file = join(this.automation.root, 'artifact-operation.json');
    const directory = join(this.automation.root, 'download');
    const digest = `sha256:${kind === 'matching' ? createHash('sha256').update(archive).digest('hex') : '0'.repeat(64)}`;
    writeJSON(file, { command: 'download', id: 7, runId: 123456, repository: 'owner/project', digest, directory });
    const result = await command(process.execPath, [fileURLToPath(new URL('../scripts/ci-artifact.mjs', import.meta.url)), file], {
      quiet: true, timeoutMs: 10_000,
      env: { ...process.env, GH_TOKEN: 'artifact-sdk-test-token', GITHUB_API_URL: origin, GITHUB_SERVER_URL: 'https://github.com' },
    });
    assert.equal(result.code, kind === 'matching' ? 0 : 1, result.output);
    assert.deepEqual(requests, ['/repos/owner/project/actions/artifacts/7/zip', '/checkpoint.zip']);
    if (kind === 'matching') {
      assert.equal(readJSON(`${file}.result`).digestMismatch, false);
      assert.equal(readFileSync(join(directory, 'checkpoint.txt'), 'utf8'), 'verified feature checkpoint\n');
    } else assert.throws(() => readFileSync(`${file}.result`), 'A mismatched archive must not produce successful transfer evidence.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

AfterAll(cleanupUnitFixture);
Given('a hermetic CI feature-unit execution', { timeout: 60_000 }, function () {
  this.ci = createUnitFixture(join(this.automation.root, 'ci-control'));
  this.ci.unit = this.ci.plan.units.find(unit => unit.feature.endsWith('keybindings.feature'));
  this.ci.directory = unitDirectory(this.ci.unit, this.ci.root);
});
Then('its browser aggregate includes all eleven cases and their original steps', function () {
  const { root, plan } = this.ci;
  const result = verifyBrowserAggregate(plan, plan.units.map(unit => unitDirectory(unit, root)), { root });
  assert.equal(result.flatMap(item => item.ids).length, 11);
  assert.ok(result.every(item => item.cases.every(test => test.meta.gherkin.steps.every(step => step.status === 'passed'))));
});
When('only the keybindings step implementation changes', function () {
  const file = join(this.ci.root, 'tests/browser/keybindings.steps.mjs');
  writeFileSync(file, readFileSync(file, 'utf8') + '\n// An isolated implementation correction.\n');
  this.ci.next = planFixture(this.ci.root);
});
Then('only the nine keybindings cases need fresh execution', function () {
  const { plan, next } = this.ci;
  const changed = next.units.filter(unit => unit.inputDigest !== plan.units.find(old => old.id === unit.id).inputDigest);
  assert.equal(changed.length, 1); assert.equal(changed[0].expectedCaseIds.length, 9);
});
When('another feature uses an existing step', function () {
  writeFileSync(join(this.ci.root, 'tests/browser/added.feature'), 'Feature: Added behavior\n  Scenario: New case\n    Then the other unit assertion passes\n');
  const result = fixtureCommand(this.ci.root, ['tests/gherkin/ci-discover.mjs', 'tmp/test/ci/next-bindings.json']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  this.ci.next = planFixture(this.ci.root, readJSON(join(this.ci.root, 'tmp/test/ci/next-bindings.json')));
});
Then('existing feature keys are unchanged and the new case is required', function () {
  const { plan, next } = this.ci;
  for (const old of plan.units) assert.equal(next.units.find(unit => unit.id === old.id).inputDigest, old.inputDigest);
  assert.equal(next.units.flatMap(unit => unit.expectedCaseIds).length, 12);
});
When('the shared CI fixture helper changes', function () {
  writeFileSync(join(this.ci.root, 'tests/browser/helper.fixture.mjs'), 'export const value = 2;\n');
  this.ci.next = planFixture(this.ci.root);
});
Then('every dependent feature needs fresh execution', function () {
  assert.equal(this.ci.next.units.filter(unit => unit.inputDigest !== this.ci.plan.units.find(old => old.id === unit.id).inputDigest).length, 2);
});
When('its unit evidence has {string}', function (defect) {
  const { directory, plan } = this.ci;
  const file = join(directory, 'receipt.json'), receipt = readJSON(file);
  const changes = {
    'incomplete receipt': () => { receipt.complete = false; },
    'wrong input digest': () => { receipt.inputDigest = 'b'.repeat(64); },
    'wrong pull request': () => { receipt.producer.pullRequest++; },
    'wrong repository': () => { receipt.producer.repository = 'other/project'; },
    'untrusted workflow': () => { receipt.producer.workflow = '.github/workflows/untrusted.yml'; },
    'stale execution': () => { this.ci.now = Date.parse(receipt.finishedAt) + MAX_AGE_MS + 1; },
    'renewed receipt time': () => { receipt.finishedAt = new Date(Date.parse(receipt.finishedAt) + 1).toISOString(); },
    'wrong original attempt': () => { receipt.producer.runAttempt++; },
    'wrong original revision': () => { receipt.producer.testedSha = 'b'.repeat(40); },
  };
  if (defect === 'missing receipt') { unlinkSync(file); return; }
  if (defect === 'changed result bytes') writeFileSync(join(directory, 'vitest-browser-chromium.json'), '{}');
  else if (defect === 'changed blob bytes') writeFileSync(join(directory, 'blobs/browser-chromium.json'), '[]');
  else if (defect === 'changed attachment') {
    mkdirSync(join(directory, 'attachments'), { recursive: true }); writeFileSync(join(directory, 'attachments/changed.txt'), 'unverified evidence');
  } else if (defect === 'unexpected file') writeFileSync(join(directory, 'unexpected.txt'), 'unverified');
  else if (defect === 'symlink output') symlinkSync(join(directory, 'context.json'), join(directory, 'link.json'));
  else { assert.ok(changes[defect], defect); changes[defect](); }
  writeJSON(file, receipt);
});
Then('the unit result is rejected', function () {
  const { root, plan, unit, directory, now } = this.ci;
  assert.throws(() => verifyReceipt(plan, unit, directory, { root, ...(now ? { now } : {}), allowCurrentRun: true }));
});
When('a unit cleanup hook throws after its assertions pass', { timeout: 45_000 }, function () {
  const path = join(this.ci.root, 'tests/browser/support.mjs');
  writeFileSync(path, readFileSync(path, 'utf8').replace('AfterAll(function () {});', "AfterAll(function () { throw new Error('late cleanup failed'); });"));
  const collected = fixtureCommand(this.ci.root, ['tests/gherkin/ci-discover.mjs', 'tmp/test/ci/bindings.json']);
  assert.equal(collected.status, 0, collected.stdout + collected.stderr);
  this.ci.plan = planFixture(this.ci.root); this.ci.unit = this.ci.plan.units.find(unit => unit.feature.endsWith('keybindings.feature'));
  writeJSON(join(this.ci.root, 'tmp/test/ci/plan.json'), this.ci.plan);
  this.ci.result = fixtureCommand(this.ci.root, ['tests/gherkin/ci.mjs', 'unit', this.ci.unit.id]);
});
Then('the unit process fails and creates no reusable receipt', function () {
  assert.notEqual(this.ci.result.status, 0, this.ci.result.stdout + this.ci.result.stderr);
  assert.match(this.ci.result.stdout + this.ci.result.stderr, /late cleanup failed|Incomplete unit evidence/);
  assert.throws(() => readFileSync(join(this.ci.directory, 'receipt.json')));
});
Then('missing and duplicate unit inventories cannot certify validation', function () {
  const { root, plan } = this.ci, dirs = plan.units.map(unit => unitDirectory(unit, root));
  assert.throws(() => verifyBrowserAggregate(plan, dirs.slice(1), { root }));
  assert.throws(() => verifyBrowserAggregate(plan, [dirs[0], dirs[0]], { root }));
  const wrong = structuredClone(plan); wrong.units.push(structuredClone(wrong.units[0]));
  assert.throws(() => validatePlan(wrong));
});
Then('valid previous-attempt results remain reusable with their original provenance', function () {
  const { root, plan, unit, directory } = this.ci, next = { ...plan, runAttempt: 2, testedSha: 'b'.repeat(40) };
  const verified = verifyReceipt(next, unit, directory, { root });
  assert.equal(verified.receipt.producer.runAttempt, 1); assert.equal(verified.receipt.producer.testedSha, plan.testedSha);
  assert.equal(next.runAttempt, 2);
});
Then('a rejected cached artifact is a cache miss and never overwrites valid evidence', async function () {
  const { root, plan, unit, directory } = this.ci;
  const original = readFileSync(join(directory, 'receipt.json'));
  const result = await restoreUnit(plan, unit, [{ inputDigest: unit.inputDigest, id: 7, runId: 123456, runAttempt: 1,
    workflow: '.github/workflows/ci-release.yml', digest: `sha256:${'a'.repeat(64)}` }], {
    root, note: () => {}, operation: async input => { writeFileSync(join(input.directory, 'receipt.json'), '{}'); return {}; },
  });
  assert.equal(result, undefined); assert.deepEqual(readFileSync(join(directory, 'receipt.json')), original);
});

function cacheAPI(plan, { association = 42, stale = false } = {}) {
  const repository = { id: 7, full_name: plan.repository };
  const metadata = id => ({ id, path: '.github/workflows/ci-release.yml', event: 'pull_request', repository,
    head_repository: repository, head_sha: plan.sourceSha, head_branch: 'feature/ci-control',
    created_at: new Date().toISOString(), run_attempt: 1, status: id === plan.runId ? 'in_progress' : 'completed',
    conclusion: id === plan.runId ? null : 'failure', pull_requests: [] });
  const original = 123456;
  const artifacts = plan.units.map((unit, index) => ({ id: 100 + index, name: `ci-unit-v1-pr42-${unit.id}-${unit.inputDigest}-r${original}-a1`,
    expired: false, digest: `sha256:${'a'.repeat(64)}`, workflow_run: { id: original, head_repository_id: 7, head_sha: plan.sourceSha } }));
  return async endpoint => {
    if (endpoint.endsWith('/pulls/42')) return { number: 42, state: 'open', draft: false, merged: false,
      head: { sha: stale ? 'b'.repeat(40) : plan.sourceSha, ref: 'feature/ci-control', repo: repository } };
    if (endpoint.includes('/actions/runs?')) return { workflow_runs: [metadata(original)] };
    if (endpoint.includes(`/commits/${plan.sourceSha}/pulls`)) return [{ number: association, head: { repo: repository }, base: { repo: repository } }];
    if (endpoint.endsWith(`/actions/runs/${plan.runId}`)) return metadata(plan.runId);
    if (endpoint.endsWith(`/actions/runs/${original}`)) return metadata(original);
    if (endpoint.includes('/artifacts?')) return { artifacts: endpoint.includes(`/runs/${original}/`) ? artifacts : [] };
    if (endpoint.includes('/git/commits/')) return { tree: { sha: endpoint.endsWith(plan.sourceSha) ? 'c'.repeat(40) : 'd'.repeat(40) } };
    if (endpoint.includes('/git/trees/')) return { truncated: false, tree: [{ path: 'src', type: 'tree', mode: '040000', sha: endpoint.endsWith('c'.repeat(40)) ? 'a'.repeat(40) : 'b'.repeat(40) }] };
    throw new Error(`Unexpected mock GitHub read: ${endpoint}`);
  };
}
function cacheDownload(root, plan) {
  return async input => {
    const unit = plan.units[input.id - 100];
    assert.ok(unit, 'Only declared fixture artifacts may be downloaded.');
    const { cpSync } = await import('node:fs');
    cpSync(unitDirectory(unit, root), input.directory, { recursive: true });
    return { downloadPath: input.directory };
  };
}
Then('passing units from a failed same-PR workflow are found through commit association', async function () {
  const { discoverUnitArtifacts } = await import('../scripts/ci-unit-cache.mjs');
  const { root, plan, unit } = this.ci, next = { ...plan, runId: plan.runId + 1 };
  const artifacts = await discoverUnitArtifacts(next, { api: cacheAPI(next), note: () => {} });
  assert.equal(artifacts.length, 2);
  const hit = await restoreUnit(next, unit, artifacts, { root, operation: cacheDownload(root, plan), note: () => {} });
  assert.equal(hit.reused, true); assert.equal(hit.producer.runId, plan.runId);
});
Then('mismatched commit association supplies no cached result', async function () {
  const { discoverUnitArtifacts } = await import('../scripts/ci-unit-cache.mjs');
  const plan = { ...this.ci.plan, runId: this.ci.plan.runId + 1 };
  const artifacts = await discoverUnitArtifacts(plan, { api: cacheAPI(plan, { association: 43 }), note: () => {} });
  assert.deepEqual(artifacts, []);
});
Then('cache planning leaves all cases verified and schedules no browser batches', async function () {
  const { prepareCachedUnits } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci, next = { ...plan, runId: plan.runId + 1 };
  writeJSON(join(root, 'tmp/test/ci/plan.json'), next);
  const output = join(root, 'outputs.txt');
  const prepared = await prepareCachedUnits({ root, api: cacheAPI(next), operation: cacheDownload(root, plan), outputFile: output, note: () => {} });
  assert.equal(prepared.reusedUnits.length, 2); assert.equal(prepared.batches.flatMap(batch => batch.units).length, 0);
  assert.match(readFileSync(output, 'utf8'), /has_work=false/);
  const verified = verifyBrowserAggregate(prepared, prepared.units.map(unit => unitDirectory(unit, root)), { root });
  assert.equal(verified.flatMap(item => item.ids).length, 11);
});
Then('an obsolete prepared input set starts no browser container', async function () {
  const { runBatch } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci, calls = [];
  await assert.rejects(runBatch({ root, batchId: 'application-1', node: process.execPath, api: async endpoint => endpoint.includes('/artifacts?') ? { artifacts: [] } : cacheAPI(plan, { stale: true })(endpoint),
    run: async (...args) => { calls.push(args); return { code: 0, output: '' }; }, note: () => {},
    environment: { GITHUB_RUN_ATTEMPT: '1', CI_WORKFLOW_FILE: '.github/workflows/ci-release.yml' } }), /did not complete/);
  assert.deepEqual(calls, []);
});
Then('root tree comparison accepts only the unchanged execution inputs', async function () {
  const { unchangedSourceInputs } = await import('../scripts/ci-browser.mjs');
  const { plan } = this.ci;
  let changed = false;
  const api = async endpoint => endpoint.includes('/git/commits/') ? { tree: { sha: endpoint.endsWith(plan.sourceSha) ? 'c'.repeat(40) : 'd'.repeat(40) } }
    : { truncated: false, tree: [
      { path: 'src', type: 'tree', mode: '040000', sha: changed && endpoint.endsWith('d'.repeat(40)) ? 'b'.repeat(40) : 'a'.repeat(40) },
      { path: 'CHANGELOG.md', type: 'blob', mode: '100644', sha: endpoint.endsWith('c'.repeat(40)) ? 'a'.repeat(40) : 'b'.repeat(40) },
    ] };
  assert.equal(await unchangedSourceInputs(plan, 'b'.repeat(40), { api }), true);
  changed = true;
  assert.equal(await unchangedSourceInputs(plan, 'b'.repeat(40), { api }), false);
});
Then('the browser controller publishes completed evidence and closes its container', async function () {
  const { runBatch } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci, calls = [], publications = [];
  const api = async endpoint => endpoint.includes('/artifacts?') ? { artifacts: [] } : cacheAPI(plan)(endpoint);
  const summary = await runBatch({ root, batchId: 'application-1', node: process.execPath, api, note: () => {},
    environment: { GITHUB_RUN_ATTEMPT: '1', CI_WORKFLOW_FILE: '.github/workflows/ci-release.yml' },
    operation: async input => { publications.push(input); return { id: 123, digest: 'a'.repeat(64) }; },
    run: async (program, args) => { calls.push([program, args]); return { code: 0, output: args.includes('inspect') ? plan.shared.image : '' }; },
  });
  assert.equal(summary.fresh, 1); assert.equal(publications.length, 1);
  assert.ok(calls.some(([program, args]) => program === 'docker' && args[0] === 'rm' && args[1] === '-f'));
  const start = calls.find(([, args]) => args[0] === 'run')[1];
  assert.ok(start.includes('--network=none')); assert.ok(start.includes('--memory=5g'));
  assert.ok(!start.some(argument => argument.includes('GH_TOKEN') || argument.includes('ACTIONS_RUNTIME_TOKEN')));
});

Then('adding a source case retains every existing browser input key', function () {
  writeFileSync(join(this.ci.root, 'tests/source-profile.json'), JSON.stringify({ paths: ['src/new.feature'], import: [] }));
  const next = planFixture(this.ci.root);
  assert.deepEqual(next.units.map(unit => unit.inputDigest), this.ci.plan.units.map(unit => unit.inputDigest));
});
Then('CI capture keeps ordinary action traces and full diagnostic contracts', async function () {
  const { tracingOptions, captureForTags } = await import('../../tests/browser/capture-policy.fixture.mjs');
  assert.deepEqual(tracingOptions([], { OPERATIONS_CI_CAPTURE: 'minimal' }), { screenshots: false, snapshots: false, sources: false });
  for (const tag of ['@full-trace', '@browser-abort-diagnostics', '@coverage-report', '@schema-profile']) {
    assert.equal(captureForTags([tag], 'minimal'), 'full');
    assert.deepEqual(tracingOptions([tag], { OPERATIONS_CI_CAPTURE: 'minimal' }), { screenshots: true, snapshots: true, sources: true });
  }
  assert.deepEqual(tracingOptions([], {}), { screenshots: true, snapshots: true, sources: true });
});
Given('native feature units and five whole profiles with complete coverage', { timeout: 90_000 }, function () {
  this.ciReport = createIncrementalFixture(join(this.automation.root, 'incremental-report-control'));
});
function incrementalReport(world) {
  const { root, plan } = world.ciReport;
  return fixtureCommand(root, ['.github/scripts/generate-test-report.mjs'], {
    GITHUB_RUN_ATTEMPT: '2', REPORT_COMMIT: plan.testedSha, REPORT_WARNING: '', REPORT_DIAGNOSTIC: '',
  });
}
When('the incremental native report is merged', { timeout: 45_000 }, function () { this.ciReport.result = incrementalReport(this); });
Then('all original cases and attachments survive with verifiable publication evidence', async function () {
  const { root, plan, result } = this.ciReport;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = readJSON(join(root, 'tmp/test/report/results.json'));
  assert.equal(report.numTotalTests, 16); assert.equal(report.numPassedTests, 16);
  const metadata = parseBlob(gunzipSync(readFileSync(join(root, 'tmp/test/report/ui/html.meta.json.gz'))).toString('utf8'));
  const tests = task => task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(tests);
  assert.ok(metadata.files.flatMap(tests).flatMap(test => test.annotations ?? []).filter(note => note.attachment?.contentType === 'text/plain').length >= 11);
  const provenance = readJSON(join(root, 'tmp/test/report/provenance.json'));
  assert.equal(provenance.schemaVersion, 3); assert.equal(provenance.suites.length, 6);
  const browser = provenance.suites.find(suite => suite.profile === 'browser');
  assert.equal(browser.reusedCases, 11); assert.equal(browser.freshCases, 0);
  for (const unit of plan.units) {
    const original = readFileSync(join(unitDirectory(unit, root), 'receipt.json'));
    assert.deepEqual(readFileSync(join(root, 'tmp/test/report/evidence/browser', unit.id, 'receipt.json')), original);
  }
  const verified = fixtureCommand(root, ['--input-type=module', '-e', `
    import {validateReportEvidence} from './.github/scripts/validation-artifacts.mjs';
    const result = validateReportEvidence('tmp/test/report', {testedSha:${JSON.stringify(plan.testedSha)},runId:123456,runAttempt:2,schemaVersion:3});
    console.log(result.schemaVersion);
  `]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /3/);
  const publication = fixtureCommand(root, ['--input-type=module', '-e', `
    import {cpSync,mkdirSync,rmSync,writeFileSync,readdirSync,rmdirSync} from 'node:fs';
    import {createManifest,verifyArtifacts} from './.github/scripts/validation-artifacts.mjs';
    mkdirSync('tmp/publication', {recursive:true});
    cpSync('dist','tmp/publication/bundle',{recursive:true});
    cpSync('tmp/test/coverage','tmp/publication/coverage',{recursive:true});
    rmSync('tmp/publication/coverage/v8',{recursive:true,force:true});
    cpSync('tmp/test/report','tmp/publication/test-report',{recursive:true});
    mkdirSync('tmp/publication/test-report/badges',{recursive:true});
    for(const name of ['test-scenarios','test-coverage']) {
      writeFileSync('tmp/publication/test-report/badges/'+name+'.json', JSON.stringify({schemaVersion:1,label:name,message:name==='test-coverage'?'100%':'16 passing',color:'brightgreen'}));
      writeFileSync('tmp/publication/test-report/badges/'+name+'.svg', '<svg xmlns="http://www.w3.org/2000/svg"><text>Hermetic packaging control</text></svg>');
    }
    function prune(directory) {
      for(const entry of readdirSync(directory,{withFileTypes:true})) if(entry.isDirectory()) prune(directory+'/'+entry.name);
      if(!readdirSync(directory).length) rmdirSync(directory);
    }
    for(const name of ['bundle','coverage','test-report']) prune('tmp/publication/'+name);
    const manifest=createManifest({repository:'owner/project',runId:123456,runAttempt:2,
      sourceSha:${JSON.stringify(plan.sourceSha)},testedSha:${JSON.stringify(plan.testedSha)},
      bundle:'tmp/publication/bundle',coverage:'tmp/publication/coverage',report:'tmp/publication/test-report/index.html'});
    writeFileSync('tmp/publication/manifest.json',JSON.stringify(manifest));
  `]);
  assert.equal(publication.status, 0, publication.stdout + publication.stderr);
  const builtin = fixtureCommand(root, ['--input-type=module', '-e', `
    import {readFileSync,renameSync} from 'node:fs';
    renameSync('node_modules','hidden-dependencies');
    try { const {verifyArtifacts}=await import('./.github/scripts/validation-artifacts.mjs');
      verifyArtifacts(JSON.parse(readFileSync('tmp/publication/manifest.json')),'tmp/publication');
    } finally { renameSync('hidden-dependencies','node_modules'); }
  `]);
  assert.equal(builtin.status, 0, builtin.stdout + builtin.stderr);
});
When('an original unit attachment is changed before report generation', function () {
  const { root, plan } = this.ciReport, unit = plan.units[0];
  const receipt = readJSON(join(unitDirectory(unit, root), 'receipt.json'));
  const attachment = receipt.files.find(([path]) => path.startsWith('attachments/'));
  assert.ok(attachment, 'The control must contain a real native attachment');
  writeFileSync(join(unitDirectory(unit, root), attachment[0]), 'tampered original attachment');
  this.ciReport.result = incrementalReport(this);
});
Then('incremental certification fails and removes stale output', function () {
  assert.notEqual(this.ciReport.result.status, 0);
  assert.match(this.ciReport.result.stderr, /Unit artifacts differ from receipt/);
  assert.throws(() => readFileSync(join(this.ciReport.root, 'tmp/test/report/index.html')));
});

Then('an application source correction invalidates all browser feature keys', function () {
  writeFileSync(join(this.ci.root, 'src/fixture.js'), 'export const value = 2;\n');
  const next = planFixture(this.ci.root);
  assert.ok(next.units.every(unit => unit.inputDigest !== this.ci.plan.units.find(old => old.id === unit.id).inputDigest));
});
Then('cancelling an active batch closes its container and retains only diagnostics', async function () {
  const { runBatch } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci, calls = [], publications = [], cancellation = new AbortController();
  const api = async endpoint => endpoint.includes('/artifacts?') ? { artifacts: [] } : cacheAPI(plan)(endpoint);
  await assert.rejects(runBatch({ root, batchId: 'application-1', node: process.execPath, api, note: () => {}, signal: cancellation.signal,
    environment: { GITHUB_RUN_ATTEMPT: '1', CI_WORKFLOW_FILE: '.github/workflows/ci-release.yml' },
    operation: async input => { publications.push(input); return { id: 123, digest: 'a'.repeat(64) }; },
    run: async (program, args) => {
      calls.push([program, args]);
      if (args[0] === 'exec' && args.includes('unit')) { cancellation.abort(); return { code: 143, output: '' }; }
      return { code: 0, output: args.includes('inspect') ? plan.shared.image : '' };
    },
  }), /did not complete/);
  assert.ok(calls.some(([, args]) => args[0] === 'rm' && args[1] === '-f'));
  assert.equal(publications.length, 1); assert.match(publications[0].name, /^ci-failure-/);
  assert.equal(readJSON(join(root, 'tmp/test/ci/batch-application-1.json')).fresh, 0);
});
Then('a failed feature does not discard a successful sibling checkpoint', async function () {
  const { runBatch } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci, publications = [];
  for (const batch of plan.batches) batch.units = batch.id === 'application-1' ? plan.units.map(unit => unit.id) : [];
  writeJSON(join(root, 'tmp/test/ci/plan.json'), plan);
  let executed = 0;
  const api = async endpoint => endpoint.includes('/artifacts?') ? { artifacts: [] } : cacheAPI(plan)(endpoint);
  await assert.rejects(runBatch({ root, batchId: 'application-1', node: process.execPath, api, note: () => {},
    environment: { GITHUB_RUN_ATTEMPT: '1', CI_WORKFLOW_FILE: '.github/workflows/ci-release.yml' },
    operation: async input => { publications.push(input); return { id: 123, digest: 'a'.repeat(64) }; },
    run: async (program, args) => {
      if (args[0] === 'exec' && args.includes('unit') && ++executed === 1) {
        const unit = plan.units.find(item => item.id === args.at(-1)), directory = unitDirectory(unit, root);
        // A broken diagnostic directory must not cancel a healthy sibling.
        symlinkSync(join(directory, 'context.json'), join(directory, 'invalid-diagnostic-link'));
        return { code: 1, output: '' };
      }
      return { code: 0, output: args.includes('inspect') ? plan.shared.image : '' };
    },
  }), /did not complete/);
  const summary = readJSON(join(root, 'tmp/test/ci/batch-application-1.json'));
  assert.equal(summary.fresh, 1); assert.equal(summary.failed, 1); assert.equal(summary.unfinished, 0);
  assert.equal(publications.filter(input => input.name.startsWith('ci-unit-')).length, 1);
});
Then('an incomplete browser inventory stages available evidence without certifying it', async function () {
  const { restoreBrowserUnits } = await import('../scripts/ci-browser.mjs');
  const { root, plan } = this.ci;
  rmSync(unitDirectory(plan.units[0], root), { recursive: true, force: true });
  const api = async endpoint => endpoint.includes('/artifacts?') ? { artifacts: [] } : cacheAPI(plan)(endpoint);
  await assert.rejects(restoreBrowserUnits({ root, api, note: () => {} }), /results are outstanding/);
  const available = plan.units[1];
  assert.deepEqual(readFileSync(join(root, `tmp/test/blobs/ci-unit-${available.id}.json`)),
    readFileSync(join(unitDirectory(available, root), 'blobs/browser-chromium.json')));
  assert.equal(readJSON(join(root, 'tmp/test/ci/selection.json')).missing.length, 1);
  assert.throws(() => verifyBrowserAggregate(plan, plan.units.map(unit => unitDirectory(unit, root)), { root }));
});
Then('a fresh-only feature rejects old-run receipts before download', { timeout: 30_000 }, async function () {
  const { root, unit } = this.ci, feature = join(root, unit.feature);
  writeFileSync(feature, '@ci-fresh\n' + readFileSync(feature, 'utf8'));
  const collected = fixtureCommand(root, ['tests/gherkin/ci-discover.mjs', 'tmp/test/ci/bindings.json']);
  assert.equal(collected.status, 0, collected.stdout + collected.stderr);
  const plan = planFixture(root), fresh = plan.units.find(item => item.id === unit.id);
  assert.equal(fresh.cacheable, false);
  writeJSON(join(root, 'tmp/test/ci/plan.json'), plan);
  const execution = fixtureCommand(root, ['tests/gherkin/ci.mjs', 'unit', unit.id]);
  assert.equal(execution.status, 0, execution.stdout + execution.stderr);
  const next = { ...plan, runId: plan.runId + 1 };
  assert.throws(() => verifyReceipt(next, fresh, unitDirectory(fresh, root), { root }), /Ineligible unit receipt/);
  let downloads = 0;
  const hit = await restoreUnit(next, fresh, [{ kind: 'unit', inputDigest: fresh.inputDigest, runId: plan.runId }], {
    root, operation: async () => { downloads++; }, note: () => {},
  });
  assert.equal(hit, undefined); assert.equal(downloads, 0);
});
Then('an eager nested initialization cannot remain a local-only input', function () {
  const path = join(this.ci.root, 'tests/browser/other.steps.mjs');
  writeFileSync(path, readFileSync(path, 'utf8') + '\nconst eager = { value: unknownInitialization() };\nfunction unknownInitialization() { return 1; }\n');
  const next = planFixture(this.ci.root);
  assert.ok(next.units.every(unit => unit.inputDigest !== this.ci.plan.units.find(old => old.id === unit.id).inputDigest));
});
