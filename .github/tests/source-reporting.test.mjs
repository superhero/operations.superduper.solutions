// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parse } from 'flatted';
import { Given, Then, When } from '@cucumber/cucumber';
import { acceptance, source } from '../../tests/gherkin/profiles.mjs';
import { createReportFixture } from '../../tests/gherkin/report-fixtures/index.mjs';
import './support.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const manifest = () => JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
const names = ['An independently reported passing source behavior', 'The observed source behavior'];
const testsIn = task => task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(testsIn);

Then('every source feature and its steps belong to exactly one explicit reporting profile', function () {
  const files = readdirSync(join(repository, 'src'), { recursive: true }).map(path => `src/${path}`);
  const features = files.filter(path => path.endsWith('.feature')).sort();
  const modules = files.filter(path => path.endsWith('.test.mjs')).sort();
  assert.ok(features.length > 0);
  const registered = { paths: [], import: [] };
  for (const [name, profile] of Object.entries({ source, acceptance })) {
    for (const kind of ['paths', 'import']) {
      assert.ok(Array.isArray(profile[kind]), `${name} must explicitly register ${kind}`);
      for (const path of profile[kind]) assert.ok(!/[*?{}[\]]/.test(path), `${name} uses an implicit registration: ${path}`);
      registered[kind].push(...profile[kind]);
    }
    assert.deepEqual(profile.import.toSorted(), profile.paths.map(path => path.replace(/\.feature$/, '.test.mjs')).sort(),
      `${name} must load the step module paired with every feature`);
  }
  assert.deepEqual(registered.paths.sort(), features, 'Every feature must appear exactly once across reporting profiles');
  assert.deepEqual(registered.import.sort(), modules, 'Every step module must appear exactly once across reporting profiles');
});

Then('the source test command routes Gherkin through the shared Vitest launcher', function () {
  const { scripts: commands } = manifest();
  assert.equal(commands['test:source'], 'node tests/gherkin/run.mjs source');
  assert.doesNotMatch(commands['test:source'], /&&|\|\||;/);
  assert.equal(Object.hasOwn(commands, 'test:unit'), false);
  assert.doesNotMatch(Object.values(commands).join('\n'), /\bnode\s+--test\b|\btest:unit\b|\bcucumber-js\b/);
  const launcher = readFileSync(join(repository, 'tests/gherkin/run.mjs'), 'utf8');
  assert.ok(launcher.includes('node_modules/vitest/vitest.mjs'));
});

Given('two named source scenarios with a second scenario that has {string}', function (outcome) {
  assert.ok(['passing behavior', 'assertion failure', 'After-hook failure'].includes(outcome));
  this.sourceReporting = { outcome, root: join(this.automation.root, 'source-fixture'),
    badges: join(this.automation.root, 'badges') };
});

When('the shared source execution configuration runs those scenarios', { timeout: 60000 }, async function () {
  this.sourceReporting.fixture = await createReportFixture(this.sourceReporting.root, {
    outcome: this.sourceReporting.outcome, html: true, coverage: false,
  });
});

Then('its exit status and Vitest JSON reflect {string} for the second scenario', function (outcome) {
  const { execution, results } = this.sourceReporting.fixture;
  const passing = outcome === 'passing behavior';
  assert.equal(execution.status === 0, passing, execution.stdout + execution.stderr);
  assert.equal(results.testResults.length, 1);
  const cases = results.testResults[0].assertionResults;
  assert.equal(cases.length, 2);
  cases.forEach((item, index) => assert.ok(item.title.includes(names[index])));
  assert.equal(new Set(cases.map(item => item.meta.gherkin.id)).size, 2);
  assert.ok(cases[0].meta.gherkin.steps.every(step => step.status === 'passed'));
  assert.equal(cases[0].status, 'passed');
  assert.equal(cases[1].status, passing ? 'passed' : 'failed');
  if (!passing) {
    assert.match(cases[1].failureMessages.join('\n'), outcome === 'After-hook failure'
      ? /Source cleanup failed deliberately/ : /Source assertion failed deliberately/);
    // Cleanup failure belongs to the scenario even when its body passed.
    assert.equal(cases[1].meta.gherkin.steps[0].status,
      outcome === 'After-hook failure' ? 'passed' : 'failed');
  }
});

Then('the built-in HTML and scenario badge retain both individual results', function () {
  const state = this.sourceReporting;
  const fixture = state.fixture;
  const before = readFileSync(fixture.jsonFile);
  const metadata = parse(gunzipSync(readFileSync(join(fixture.reportDirectory, 'ui/html.meta.json.gz'))).toString('utf8'));
  const cases = metadata.files.flatMap(testsIn);
  assert.equal(cases.length, 2);
  const passing = state.outcome === 'passing behavior';
  cases.forEach((item, index) => {
    assert.ok(item.name.includes(names[index]));
    assert.equal(item.result.state, index === 0 || passing ? 'pass' : 'fail');
  });
  if (!passing) {
    const errors = cases[1].result.errors;
    assert.match(JSON.stringify(errors), state.outcome === 'After-hook failure'
      ? /Source cleanup failed deliberately/ : /Source assertion failed deliberately/);
  }
  this.automation.execute('generate-scenario-badge.sh', [state.badges, fixture.jsonFile]);
  assert.deepEqual(JSON.parse(readFileSync(join(state.badges, 'test-scenarios.json'), 'utf8')), {
    schemaVersion: 1, label: 'Test Scenarios', message: passing ? '2 passed' : '1/2 passed', color: passing ? 'brightgreen' : 'red',
  });
  assert.deepEqual(readFileSync(fixture.jsonFile), before, 'Publishing must not rewrite source results');
  assert.deepEqual(this.automation.calls(), []);
});
