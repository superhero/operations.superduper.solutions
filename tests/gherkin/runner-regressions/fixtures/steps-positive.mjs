// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'vitest';
import {
  After, AfterAll, AfterStep, Before, BeforeAll, BeforeStep,
  Given, Then, When, QuickPickleWorld, setWorldConstructor,
} from 'quickpickle';

const caseName = process.env.OPERATIONS_RUNNER_FIXTURE_MODE;
const ledger = resolve(process.env.OPERATIONS_RUNNER_FIXTURE_OUTPUT, 'ledger.ndjson');
const record = (kind, world, extra = {}) => appendFileSync(ledger, `${JSON.stringify({
  kind,
  feature: world.info.feature,
  scenario: world.info.scenario,
  tags: world.info.tags,
  step: world.info.step,
  worldId: world.id,
  ...extra,
})}\n`);

let nextId = 0;
const retryAttempts = new Map();
class ProbeWorld extends QuickPickleWorld {
  constructor(context, info) {
    super(context, info);
    this.id = ++nextId;
    this.values = [];
    this.initialized = false;
  }
  async init() {
    await super.init();
    this.initialized = true;
    record('world-init', this);
  }
}
setWorldConstructor(ProbeWorld);

BeforeAll(async common => {
  common.starts = (common.starts || 0) + 1;
  common.completed = [];
  record('before-all', common, { starts: common.starts });
});
Before(async world => {
  record('before', world);
  expect(world.initialized).toBe(true);
  expect(world.data).toEqual({});
  expect(world.values).toEqual([]);
  if (world.info.tags.includes('@hook-error')) throw new Error('EXPECTED_BEFORE_HOOK_FAILURE');
});
Before('@scenario-tag and not @never', async world => {
  world.taggedHook = true;
  record('tagged-before', world);
});
BeforeStep(async world => record('before-step', world));
AfterStep(async world => record('after-step', world));
After(async world => {
  world.common.completed.push(world.info.scenario);
  record('after', world, { errors: world.info.errors.map(error => error.message) });
});
AfterAll(async common => {
  if (caseName === 'timeout') await new Promise(resolveDelay => setTimeout(resolveDelay, 120));
  record('after-all', common, {
    starts: common.starts,
    completed: common.completed,
  });
});

Given('the feature background has run', world => {
  expect(world.common.starts).toBe(1);
  world.data.background = 'feature';
});
Given('the rule background has run', world => {
  expect(world.data.background).toBe('feature');
  world.data.rule = 'rule';
});
Given('the following records:', (world, table) => {
  expect(table.raw()).toEqual([['name', 'amount'], ['foo', '2'], ['bar', '3']]);
  expect(table.rows()).toEqual([['foo', '2'], ['bar', '3']]);
  expect(table.hashes()).toEqual([{ name: 'foo', amount: '2' }, { name: 'bar', amount: '3' }]);
  world.values = table.hashes();
});
Given('the following JSON:', (world, content) => {
  world.document = JSON.parse(String(content));
  expect(content.mediaType).toBe('json');
  expect(content.data).toEqual(world.document);
});
Then('the table and document retain their data', world => {
  expect(world.values).toHaveLength(2);
  expect(world.document).toEqual({ hello: 'world', count: 5 });
});
Given('I mutate only this scenario world', world => {
  world.values.push('private');
  world.data.private = true;
});
Then('this world contains the private mutation', world => expect(world.values).toEqual(['private']));
Then('this world has no previous scenario mutations', world => {
  expect(world.values).toEqual([]);
  expect(world.data.private).toBeUndefined();
});
Then('feature and rule backgrounds have run in order', world => {
  expect(world.data).toEqual({ background: 'feature', rule: 'rule' });
  expect(world.info.rule).toBe('Rule backgrounds preserve feature context');
});
Then('the feature, rule and scenario tags are available', world => {
  expect(world.info.tags).toEqual(expect.arrayContaining(['@feature-tag', '@rule-tag', '@scenario-tag']));
  expect(world.taggedHook).toBe(true);
});
Then('the feature hook ran exactly once for this file', world => {
  expect(world.common.starts).toBe(1);
  record('feature-hook-visible', world, { starts: world.common.starts });
});
Given('the example value is {int}', (world, value) => {
  world.value = value;
  record('example-value', world, { value });
});
Then('the example value is preserved as {int}', (world, value) => expect(world.value).toBe(value));
Then('the example tag is {string}', (world, tag) => expect(world.info.tags).toContain(tag));
Then('the body executes successfully', world => record('body', world));
Given('an ambiguous probe step', () => {});
Given(/^an ambiguous probe step$/, () => {});
When('this attempt fails once before succeeding', world => {
  const name = world.info.scenario;
  const attempt = (retryAttempts.get(name) || 0) + 1;
  retryAttempts.set(name, attempt);
  expect(world.values).toEqual([]);
  world.values.push(`attempt-${attempt}`);
  record('retry-attempt', world, { attempt });
  if (attempt === 1) throw new Error('EXPECTED_FIRST_ATTEMPT_FAILURE');
});
Then('the second attempt uses a fresh world', world => {
  expect(world.values).toEqual(['attempt-2']);
  expect(retryAttempts.get(world.info.scenario)).toBe(2);
});
When('a step exceeds its configured timeout', async world => {
  await new Promise(resolveDelay => setTimeout(resolveDelay, 90));
  record('late-step-completed', world);
});
Given('the next scenario starts without waiting for late work', world => record('next-scenario-started', world));
