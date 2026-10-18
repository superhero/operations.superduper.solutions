// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Given, Then, When } from '@cucumber/cucumber';
import { createReportFixture } from '../../tests/gherkin/report-fixtures/index.mjs';
import './support.mjs';

async function reports(world) {
  const fixture = await createReportFixture(join(world.automation.root, 'badge-fixture'), {
    outline: true, html: false, coverage: false,
  });
  world.scenarioBadge = { output: join(world.automation.root, 'badges'),
    inputs: [join(world.automation.root, 'source.json')], data: structuredClone(fixture.results),
    original: structuredClone(fixture.results) };
  save(world.scenarioBadge);
}
function save(state) { writeFileSync(state.inputs[0], JSON.stringify(state.data)); }
function cases(state) { return state.data.testResults.flatMap(module => module.assertionResults); }
function changeOutcome(state, status) {
  state.data = structuredClone(state.original);
  const item = cases(state)[1];
  item.status = status;
  if (status === 'failed') item.failureMessages = ['Deliberate scenario cleanup failure'];
  // A cleanup failure must count even though each visible body step passed.
  state.data.numPassedTests = 2;
  state.data.numFailedTests = status === 'failed' ? 1 : 0;
  state.data.numPendingTests = ['skipped', 'pending', 'disabled'].includes(status) ? 1 : 0;
  state.data.numTodoTests = status === 'todo' ? 1 : 0;
  state.data.numFailedTestSuites = status === 'failed' ? 1 : 0;
  state.data.success = status !== 'failed';
  save(state);
}
function generate(world, check = false) {
  return world.automation.execute('generate-scenario-badge.sh',
    [world.scenarioBadge.output, ...world.scenarioBadge.inputs, ...(check ? ['--check'] : [])], [], { success: null });
}
function snapshot(directory) {
  return Object.fromEntries(readdirSync(directory).sort().map(name => [name, readFileSync(join(directory, name), 'utf8')]));
}
function badge(world, message, color) {
  assert.equal(world.result.status, 0, world.result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(world.scenarioBadge.output, 'test-scenarios.json'), 'utf8')),
    { schemaVersion: 1, label: 'Test Scenarios', message, color });
  const svg = readFileSync(join(world.scenarioBadge.output, 'test-scenarios.svg'), 'utf8');
  for (const text of [`aria-label="Test Scenarios: ${message}"`, `<title>Test Scenarios: ${message}</title>`, `>${message}</text>`,
    `fill="${{ brightgreen: '#4c1', orange: '#fe7d37', red: '#e05d44' }[color]}"`]) assert.ok(svg.includes(text), svg);
  assert.deepEqual(world.automation.calls(), []);
}

Given('real passing Vitest outline results with a background', { timeout: 60000 }, async function () {
  await reports(this);
});
When('local scenario badges are generated', function () {
  this.result = generate(this);
  assert.equal(this.result.status, 0, this.result.stderr);
  this.scenarioBadgesBefore = snapshot(this.scenarioBadge.output);
});
Then('the scenario JSON and SVG show {string} in {string}', function (message, color) { badge(this, message, color); });
When('local scenario badges are checked', function () { this.result = generate(this, true); });
Then('the local scenario badge check succeeds', function () { assert.equal(this.result.status, 0, this.result.stderr); });
Then('these recorded scenario outcomes produce badges:', function (table) {
  for (const { status, message, color } of table.hashes()) {
    changeOutcome(this.scenarioBadge, status);
    this.result = generate(this);
    badge(this, message, color);
  }
});
When('only the scenario SVG is changed', function () {
  writeFileSync(join(this.scenarioBadge.output, 'test-scenarios.svg'), 'stale SVG');
  this.scenarioBadgesBefore = snapshot(this.scenarioBadge.output);
});
When('a scenario result changes', function () { changeOutcome(this.scenarioBadge, 'failed'); });
Then('the scenario check reports stale {string} without changing files', function (name) {
  assert.notEqual(this.result.status, 0);
  for (const text of ['missing or stale', name, ...this.scenarioBadge.inputs, this.scenarioBadge.output, 'npm run badges:scenarios'])
    assert.ok(this.result.stderr.includes(text), this.result.stderr);
  assert.deepEqual(snapshot(this.scenarioBadge.output), this.scenarioBadgesBefore);
});
Then('scenario badge generation rejects these report problems without writing files:', { timeout: 60000 }, async function (table) {
  await reports(this);
  for (const { problem } of table.hashes()) {
    const state = this.scenarioBadge;
    state.data = structuredClone(state.original);
    save(state);
    if (problem === 'missing file') unlinkSync(state.inputs[0]);
    else if (problem === 'malformed JSON') writeFileSync(state.inputs[0], '{');
    else {
      const item = cases(state)[0];
      if (problem === 'empty report') state.data = {};
      else if (problem === 'no scenarios') { state.data.testResults = []; state.data.numTotalTests = 0; state.data.numPassedTests = 0; }
      else if (problem === 'missing scenario identity') delete item.meta.gherkin;
      else if (problem === 'duplicate scenario identity') cases(state)[1].meta.gherkin = structuredClone(item.meta.gherkin);
      else if (problem === 'empty steps') item.meta.gherkin.steps = [];
      else if (problem === 'missing step status') delete item.meta.gherkin.steps[0].status;
      else if (problem === 'unknown result status') item.status = 'unknown';
      else if (problem === 'inconsistent totals') state.data.numTotalTests += 1;
      else assert.fail(`Unknown report problem: ${problem}`);
      save(state);
    }
    const result = generate(this);
    assert.notEqual(result.status, 0, problem);
    for (const text of ['Invalid Vitest report', state.inputs[0], state.output, 'npm run badges:scenarios'])
      assert.ok(result.stderr.includes(text), result.stderr);
    assert.equal(existsSync(state.output), false, problem);
  }
  assert.deepEqual(this.automation.calls(), []);
});
