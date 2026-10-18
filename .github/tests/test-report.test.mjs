// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parse, stringify } from 'flatted';
import { Given, Then, When } from '@cucumber/cucumber';
import { createReportFixture } from '../../tests/gherkin/report-fixtures/index.mjs';
import './support.mjs';

const projects = ['source', 'acceptance', 'automation', 'browser-chromium', 'components', 'runner'];
const generator = fileURLToPath(new URL('../scripts/generate-test-report.mjs', import.meta.url));
const testsIn = task => task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(testsIn);
function metadata(directory) {
  return parse(gunzipSync(readFileSync(join(directory, 'ui/html.meta.json.gz'))).toString('utf8'));
}

async function prepare(world, selected) {
  world.testReport = await createReportFixture(join(world.automation.root, 'report-fixture'), {
    projects: selected, html: true, coverage: true,
  });
  world.testReport.output = join(world.testReport.root, 'tmp/test/merged-report');
  world.testReport.originalBlob = readFileSync(join(world.testReport.blobDirectory, 'fixture.json'));
  world.testReport.originalResults = readFileSync(world.testReport.jsonFile);
  mkdirSync(world.testReport.output, { recursive: true });
  writeFileSync(join(world.testReport.output, 'index.html'), 'stale successful report');
}

Given('real Vitest results from all six Gherkin projects', { timeout: 60000 }, async function () {
  await prepare(this, projects);
});
Given('real Vitest results without the browser project', { timeout: 60000 }, async function () {
  await prepare(this, projects.filter(name => name !== 'browser-chromium'));
  this.testReport.warning = 'CI failed. Missing suite results: browser <suite> & diagnostics.';
});
Given('the input blob is {string}', function (problem) {
  const file = join(this.testReport.blobDirectory, 'fixture.json');
  if (problem === 'missing') unlinkSync(file);
  else writeFileSync(file, { 'malformed JSON': '{', empty: '[]', 'invalid shape': '[{}]' }[problem]);
});

function generate(world, diagnostic, { trailingRoot = false } = {}) {
  const program = `import { generateReport } from ${JSON.stringify(generator)};
    try { generateReport('tmp/test/merged-report', 'tmp/test/blobs', {root:${trailingRoot ? "process.cwd()+'/'" : 'process.cwd()'},diagnostic:${diagnostic},
      ${world.testReport.mergeTimeout ? `mergeTimeout:${world.testReport.mergeTimeout}` : ''}}); }
    catch(error) { console.error(error.message); process.exitCode=1; }`;
  world.result = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: world.testReport.root, encoding: 'utf8', timeout: 45000,
    env: { ...process.env, ...world.automation.env,
      REPORT_COMMIT: 'af28ee270f2df1ecf9d50a7584b1de577ef25c8b',
      REPORT_RUN_URL: 'https://github.com/superhero/operations.superduper.solutions/actions/runs/37898008768',
      REPORT_WARNING: world.testReport.warning || 'Tiny fixture results do not certify full application validation.' },
  });
  assert.ifError(world.result.error);
  for (const secret of [world.automation.env.GH_TOKEN, world.automation.env.CLOUDFLARE_API_TOKEN])
    assert.ok(!(world.result.stdout + world.result.stderr).includes(secret), 'Report diagnostics exposed a test credential');
}
When('the diagnostic test report is generated', { timeout: 60000 }, function () { generate(this, true); });
When('the diagnostic report is generated from a workspace root with a trailing separator', { timeout: 60000 }, function () {
  generate(this, true, { trailingRoot: true });
});
When('strict test report generation is attempted', { timeout: 60000 }, function () { generate(this, false); });

Then('the built-in report preserves each project and its individual cases', function () {
  assert.equal(this.result.status, 0, this.result.stdout + this.result.stderr);
  const root = this.testReport.output;
  const report = metadata(root);
  assert.deepEqual([...new Set(report.files.map(file => file.projectName))].sort(), [...projects].sort());
  const cases = report.files.flatMap(testsIn);
  assert.equal(cases.length, 12);
  assert.ok(cases.every(item => item.result.state === 'pass'));
  assert.equal(new Set(cases.map(item => `${item.projectName}:${item.meta.gherkin.id}`)).size, 12);
  for (const project of projects) assert.equal(report.files.filter(file => file.projectName === project).flatMap(testsIn).length, 2);
  assert.ok(cases.some(item => item.annotations.some(note => note.attachment?.contentType === 'image/png')));
  assert.ok(cases.some(item => item.annotations.some(note => note.attachment?.contentType === 'application/zip')));
  const proof = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8'));
  assert.equal(proof.complete, false);
  assert.equal(proof.diagnostic, true);
  assert.equal(proof.testedSha, 'af28ee270f2df1ecf9d50a7584b1de577ef25c8b');
  assert.ok(proof.runUrl.endsWith('/37898008768'));
});

Then('report generation preserves original evidence and bundled assets', function () {
  const state = this.testReport;
  assert.deepEqual(readFileSync(join(state.blobDirectory, 'fixture.json')), state.originalBlob);
  assert.deepEqual(readFileSync(state.jsonFile), state.originalResults);
  assert.ok(existsSync(join(state.output, 'coverage/index.html')));
  const index = readFileSync(join(state.output, 'index.html'), 'utf8');
  const local = [...index.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(match => match[1]);
  for (const path of local) assert.ok(existsSync(join(state.output, path)), `Missing built-in report resource ${path}`);
  const assets = readdirSync(join(state.output, 'ui/assets'));
  assert.ok(assets.some(path => path.endsWith('.js')));
  assert.ok(assets.some(path => path.endsWith('.css')));
  assert.deepEqual(this.automation.calls(), []);
});

Then('the diagnostic report displays its failure warning as escaped text', function () {
  assert.equal(this.result.status, 0, this.result.stdout + this.result.stderr);
  const html = readFileSync(join(this.testReport.output, 'index.html'), 'utf8');
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('CI failed. Missing suite results: browser &lt;suite&gt; &amp; diagnostics.'));
  assert.ok(!html.includes('browser <suite>'));
  const report = metadata(this.testReport.output);
  assert.equal(report.files.flatMap(testsIn).length, 10);
  assert.ok(!report.files.some(file => file.projectName === 'browser-chromium'));
});

Then('report generation rejects incomplete application evidence and removes stale output', function () {
  assert.notEqual(this.result.status, 0);
  assert.match(this.result.stderr, /Required suite blob set is incomplete|Incomplete.*execution|execution manifest/);
  assert.equal(existsSync(this.testReport.output), false);
});
Then('report generation fails with input and output context and removes stale output', function () {
  assert.notEqual(this.result.status, 0);
  for (const value of ['Cannot generate test report', this.testReport.output, this.testReport.blobDirectory])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.equal(existsSync(this.testReport.output), false);
  assert.deepEqual(this.automation.calls(), []);
});

Given('passing Gherkin cases with an unexecuted measured source file', function () {
  this.coverageGateDirectory = join(this.automation.root, 'coverage-threshold-fixture');
});
When('Vitest executes them with every coverage threshold set to 100 percent', { timeout: 60000 }, async function () {
  this.coverageGateFixture = await createReportFixture(this.coverageGateDirectory, {
    html: true, coverage: true, coverageThresholds: true,
  });
});
Then('every scenario and step passes while only the coverage gate fails', function () {
  const { results, execution } = this.coverageGateFixture;
  assert.equal(execution.status, 1, execution.stdout + execution.stderr);
  assert.equal(results.numTotalTests, 2);
  assert.equal(results.numPassedTests, 2);
  for (const field of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites'])
    assert.equal(results[field], 0, field);
  const cases = results.testResults.flatMap(file => file.assertionResults);
  assert.equal(cases.length, 2);
  assert.ok(cases.every(item => item.status === 'passed'
    && item.meta.gherkin.steps.every(step => step.status === 'passed')));
  const diagnostics = (execution.stdout + execution.stderr).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  for (const metric of ['statements', 'branches', 'functions', 'lines'])
    assert.match(diagnostics, new RegExp(`ERROR: Coverage for ${metric} \\([\\d.]+%\\) does not meet global threshold \\(100%\\)`));
  assert.deepEqual(this.automation.calls(), []);
});
Then('the coverage summary retains unexecuted source and missing branches', function () {
  const coverageDirectory = this.coverageGateFixture.coverageDirectory;
  const summary = JSON.parse(readFileSync(join(coverageDirectory, 'coverage-summary.json'), 'utf8'));
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    assert.ok(summary.total[metric].total > summary.total[metric].covered, metric);
    assert.ok(summary.total[metric].pct < 100, metric);
  }
  const coverage = JSON.parse(readFileSync(join(coverageDirectory, 'coverage-final.json'), 'utf8'));
  const unexecuted = Object.entries(coverage).find(([path]) => path.endsWith('/source_a.js'))?.[1];
  assert.ok(unexecuted && Object.keys(unexecuted.s).length > 0, 'The unexecuted file remains measured');
  assert.ok(Object.values(unexecuted.s).every(hit => hit === 0));
  const executed = Object.entries(coverage).find(([path]) => path.endsWith('/source-a.js'))?.[1];
  assert.ok(executed && Object.values(executed.s).some(hit => hit > 0));
  assert.ok(Object.values(executed.b).some(hits => hits.some(hit => hit === 0)), 'The partially executed branch remains uncovered');
});

Given('a report merger that ignores graceful termination', function () {
  const root = join(this.automation.root, 'stalled-report-fixture');
  const blobDirectory = join(root, 'tmp/test/blobs');
  const output = join(root, 'tmp/test/merged-report');
  for (const directory of [blobDirectory, output, join(root, 'tmp/test/executions'), join(root, 'node_modules/vitest')])
    mkdirSync(directory, { recursive: true });
  const featurePaths = ['features/stalled.feature'];
  writeFileSync(join(blobDirectory, 'fixture.json'), stringify(['5.0.5',
    [{ filepath: join(root, featurePaths[0]) }], [], {}, 1, {}]));
  writeFileSync(join(root, 'tmp/test/executions/fixture.json'), JSON.stringify({ featurePaths }));
  writeFileSync(join(output, 'index.html'), 'stale successful report');
  writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `import {writeFileSync} from 'node:fs';
    process.on('SIGTERM', () => {});
    writeFileSync('merger-ready.json', JSON.stringify({pid:process.pid, ignoresSigterm:process.listenerCount('SIGTERM')===1}));
    setInterval(() => {}, 1000);
    // A broken timeout must fail this control, never strand its own process.
    setTimeout(() => process.exit(98), 5000);
  `);
  this.testReport = { root, blobDirectory, output, mergeTimeout: 1000 };
});
When('the diagnostic test report is generated with a short merge deadline', { timeout: 10000 }, function () {
  const started = Date.now();
  generate(this, true);
  this.testReport.elapsed = Date.now() - started;
});
Then('the stalled merger is terminated and its incomplete output is removed', function () {
  assert.equal(this.result.status, 1, this.result.stdout + this.result.stderr);
  const ready = JSON.parse(readFileSync(join(this.testReport.root, 'merger-ready.json'), 'utf8'));
  assert.equal(ready.ignoresSigterm, true, 'The control must actually ignore graceful termination');
  assert.ok(this.testReport.elapsed < 4000, 'Report generation waited for the control fallback instead of enforcing its deadline');
  assert.throws(() => process.kill(ready.pid, 0), { code: 'ESRCH' }, 'The report merger survived its deadline');
  assert.match(this.result.stderr, /Vitest report merge exceeded 1000 ms and was terminated/);
  for (const value of ['Cannot generate test report', this.testReport.output, this.testReport.blobDirectory])
    assert.ok(this.result.stderr.includes(value), this.result.stderr);
  assert.equal(existsSync(this.testReport.output), false);
  assert.ok(!readdirSync(join(this.testReport.root, 'tmp/test')).some(name => name.startsWith('.merge-')));
  assert.deepEqual(this.automation.calls(), []);
});
