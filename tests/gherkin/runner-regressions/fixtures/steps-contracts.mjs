// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { expect } from 'vitest';
import { After, AfterAll, AfterStep, Before, BeforeAll, Given, When, Then, QuickPickleWorld, setWorldConstructor } from 'quickpickle';

const file = resolve(process.env.OPERATIONS_RUNNER_FIXTURE_OUTPUT, 'ledger.ndjson');
let sequence = 0;
const events = [];
const record = (kind, state, extra = {}) => {
  const item = { sequence: ++sequence, kind, scenario: state.info.scenario, id: state.info.gherkin?.id, ...extra };
  events.push(item);
  appendFileSync(file, `${JSON.stringify(item)}\n`);
};
class World extends QuickPickleWorld {
  async init() {
    record('init', this);
    expect(this.signal).toBeInstanceOf(AbortSignal);
    if (this.info.tags.includes('@init-fails')) throw new Error('EXPECTED_INIT_FAILURE');
    if (['quarantine', 'interruption', 'interruption-term', 'interruption-forced'].includes(process.env.OPERATIONS_RUNNER_FIXTURE_MODE)) {
      this.server = createServer((_, response) => response.end('owned scenario resource'));
      await new Promise((done, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', done);
      });
      this.serverPort = this.server.address().port;
      record('world-http-open', this, { pid: process.pid, port: this.serverPort });
    }
  }
}
setWorldConstructor(World);
BeforeAll(async common => record('before-all', common));
Before(async state => {
  record('before', state);
  if (state.info.tags.includes('@before-fails')) throw new Error('EXPECTED_BEFORE_FAILURE');
});
AfterStep(async state => record('after-step', state));
After(async state => {
  if (state.server) {
    await new Promise((done, reject) => state.server.close(error => error ? reject(error) : done()));
    record('world-http-close', state, { pid: process.pid, port: state.serverPort,
      listening: state.server.listening });
  }
  record('after', state, { error: state._quickpickleFailure?.message });
});
After('@after-fails', async state => record('remaining-after', state));
After('@after-fails', async state => {
  record('throwing-after', state);
  throw new Error('EXPECTED_AFTER_FAILURE');
});
AfterStep('@after-step-fails', async state => record('remaining-after-step', state));
AfterStep('@after-step-fails', async state => {
  record('throwing-after-step', state);
  throw new Error('EXPECTED_AFTER_STEP_FAILURE');
});
AfterAll(async common => record('after-all', common));

Given('the example has value {string}', (state, value) => { state.data.value = value; });
Then('its Examples tag is {string}', (state, tag) => expect(state.info.tags).toContain(tag));
Then('its canonical Gherkin identity is recorded', state => {
  const meta = state._quickpickleContext.task.meta.gherkin;
  expect(meta.id).toBe(state.info.gherkin.id);
  expect(meta.uri).toBe('tests/gherkin/runner-regressions/fixtures/regressions.feature');
  expect(meta.line).toBe(3);
  expect(meta.exampleLine).toBeGreaterThan(meta.line);
  expect(events.filter(item => item.kind === 'identity').every(item => item.id !== meta.id)).toBe(true);
  record('identity', state, { meta, taskLocation: state._quickpickleContext.task.location });
});
Then('the unreachable body must not run', state => {
  record('UNREACHABLE_BODY_RAN', state);
  throw new Error('UNREACHABLE_BODY_RAN');
});
Then('both failed setup scenarios were cleaned exactly once', () => {
  for (const scenario of ['World initialization failure still runs After', 'Before failure still runs After']) {
    expect(events.filter(item => item.kind === 'after' && item.scenario === scenario)).toHaveLength(1);
    expect(events.some(item => item.kind === 'UNREACHABLE_BODY_RAN' && item.scenario === scenario)).toBe(false);
  }
});
When('cancellable work exceeds the step deadline', state => new Promise((resolveWork, rejectWork) => {
  const timer = setTimeout(() => { record('UNEXPECTED_COOPERATIVE_COMPLETION', state); resolveWork(); }, 1000);
  state.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    record('cooperative-settled', state);
    rejectWork(state.signal.reason);
  }, { once: true });
}));
Then('cooperative work settled before After and this scenario', () => {
  const settled = events.find(item => item.kind === 'cooperative-settled');
  const after = events.find(item => item.kind === 'after' && item.scenario === 'Cooperative timeout aborts and settles before cleanup');
  expect(settled.sequence).toBeLessThan(after.sequence);
  expect(events.some(item => item.kind === 'UNEXPECTED_COOPERATIVE_COMPLETION')).toBe(false);
});
When('short uncooperative work exceeds the step deadline', async state => {
  await new Promise(resolveWork => setTimeout(resolveWork, 150));
  record('uncooperative-settled', state);
});
Then('short uncooperative work finished before After and this scenario', () => {
  const settled = events.find(item => item.kind === 'uncooperative-settled');
  const after = events.find(item => item.kind === 'after' && item.scenario === 'Short uncooperative work is drained after its deadline');
  expect(settled.sequence).toBeLessThan(after.sequence);
});
When('uncooperative work never settles', state => {
  // Deliberately do not clear this handle in After: the test proves Vitest
  // actually disposes the quarantined fork, not merely an unreferenced promise.
  setInterval(() => record('quarantine-active-handle', state), 100);
  return new Promise(() => {});
});
When('owned work waits for an external interruption', state => new Promise((_, reject) => {
  state.signal.addEventListener('abort', () => {
    record('external-interrupt-abort', state, { reason: state.signal.reason?.message });
    reject(state.signal.reason);
  }, { once: true });
  record('interrupt-ready', state);
}));
When('owned work blocks the worker event loop until it is terminated', state => {
  record('interrupt-ready', state);
  // Only this disposable child worker blocks. No signal/deadline callback can
  // run here; the coordinator must actually dispose the process and its ports.
  while (true) { /* Deliberate noncooperation for the forced-cancel contract. */ }
});
Then('the regular body succeeds', state => record('body', state));
Then('throwing and remaining After hooks both ran before the outer cleanup', () => {
  const scenario = 'A failing After does not skip remaining cleanup';
  const cleanup = events.filter(item => item.scenario === scenario && ['throwing-after', 'remaining-after', 'after'].includes(item.kind));
  expect(cleanup.map(item => item.kind)).toEqual(['throwing-after', 'remaining-after', 'after']);
});
Then('throwing and remaining AfterStep hooks ran before scenario After', () => {
  const scenario = 'A failing AfterStep does not skip remaining step cleanup';
  const cleanup = events.filter(item => item.scenario === scenario && ['throwing-after-step', 'remaining-after-step', 'after-step', 'after'].includes(item.kind));
  expect(cleanup.map(item => item.kind)).toEqual(['throwing-after-step', 'remaining-after-step', 'after-step', 'after']);
});
