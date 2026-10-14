// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.steps.mjs';

const fixture = '/error-history-storage-fixture.js';
const history = page => page.getByRole('region', { name: 'Errors', exact: true });
const recorderState = page => page.evaluate(() => globalThis.errorRecorderState);

async function openHistory(page) {
  await setMode(page, 'settings');
  const browser = page.locator('summary[aria-label="Browser"]');
  if (await browser.getAttribute('aria-expanded') !== 'true') await browser.click();
  await expect(history(page)).toBeVisible();
  await expect(history(page)).toHaveAttribute('aria-busy', 'false');
}

async function errorWorker(page) {
  let match;
  await expect.poll(async () => {
    for (const worker of page.workers()) {
      try {
        if (await worker.evaluate(() => globalThis.name === 'operations-error-history')) { match = worker; return true; }
      } catch { /* A terminating worker may disappear while enumerating. */ }
    }
    return false;
  }).toBe(true);
  return match;
}

Given('26 saved errors including a repeated failure with a cause', async function () {
  await this.page.evaluate(async fixture => {
    const { recordErrors } = await import(fixture);
    await recordErrors(Array.from({ length: 26 }, (_, index) => ({
      identity: `saved-${index + 1}`, origin: { source: 'application', scope: 'example' },
      error: { name: 'ExampleError', message: `Saved error ${index + 1}`, stack: 'ExampleError\n    at saved-operation.ts:10:2',
        ...(index === 25 ? { code: 'SAVE_FAILED', cause: { name: 'CauseError', message: 'Underlying storage issue', stack: 'CauseError\n    at storage.ts:4:3' } } : {}) },
      firstSeen: Date.UTC(2026, 0, 1, 10, 0), lastSeen: Date.UTC(2026, 0, 1, 10, 1), occurrences: index === 25 ? 3 : 1,
    })));
  }, fixture);
});

When('I open the recorded errors in Browser settings', async function () { await openHistory(this.page); });
Then('the error history shows {int} unique errors and {int} entries', async function (total, entries) {
  await expect(history(this.page).locator('.metrics dd')).toHaveText(String(total));
  await expect(history(this.page).locator('details.entry')).toHaveCount(entries);
});
When('I expand the newest recorded error', async function () { await history(this.page).locator('summary').first().click(); });
Then('its saved cause, stack, occurrence count and observation times are visible', async function () {
  const entry = history(this.page).locator('details.entry').first();
  await expect(entry.getByText('3 occurrences', { exact: true })).toBeVisible();
  await expect(entry.getByText('Caused by', { exact: true })).toBeVisible();
  await expect(entry.getByText('Underlying storage issue', { exact: true })).toBeVisible();
  await expect(entry.getByText('SAVE_FAILED', { exact: true })).toBeVisible();
  await expect(entry.locator('pre').first()).toContainText('saved-operation.ts:10:2');
  await expect(entry.locator('.timestamps dt')).toHaveText(['First seen', 'Last seen']);
  assert.equal((await entry.locator('.timestamps dd').allTextContents()).every(Boolean), true);
});
When('I open the older recorded errors', async function () { await history(this.page).getByRole('button', { name: 'Older errors', exact: true }).click(); });
Then('the error history shows the oldest saved error', async function () {
  await expect(history(this.page).locator('details.entry')).toHaveCount(1);
  await expect(history(this.page).locator('summary')).toContainText('Saved error 1');
});
When('I reload and open the recorded errors', async function () {
  await this.page.reload();
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await openHistory(this.page);
});
Then('the error history is empty', async function () { await expect(history(this.page).getByText('No errors recorded.')).toBeVisible(); });
When('another tab records a failure', async function () {
  const tab = await this.context.newPage();
  try {
    await tab.goto(`${this.baseURL}/error-history-fixture.html`);
    await tab.evaluate(async fixture => {
      const { recordErrors } = await import(fixture);
      await recordErrors([{ identity: 'other-tab', origin: { source: 'runtime' }, error: { name: 'TabError', message: 'From another tab' }, firstSeen: Date.now(), lastSeen: Date.now(), occurrences: 1 }]);
      const channel = new BroadcastChannel('operations-error-history');
      channel.postMessage('updated');
      channel.close();
    }, fixture);
    await expect(history(this.page).locator('summary')).toContainText('From another tab');
  } finally { await tab.close(); }
});

Given('an isolated running error recorder', async function () {
  await this.page.goto(`${this.baseURL}/error-history-fixture.html`);
  await this.page.evaluate(async fixture => {
    const { subscribeErrorHistory } = await import(fixture);
    globalThis.errorRecorderStates = [];
    subscribeErrorHistory(value => {
      globalThis.errorRecorderState = value;
      globalThis.errorRecorderStates.push({ total: value.total, queued: value.queued });
    });
  }, fixture);
  await expect.poll(async () => (await recorderState(this.page)).phase).toBe('ready');
});
When('the recorder cannot write its next error', async function () {
  const worker = await errorWorker(this.page);
  await worker.evaluate(() => {
    IDBDatabase.prototype.transaction = () => { throw new DOMException('Storage write unavailable', 'UnknownError'); };
  });
  await this.page.evaluate(async fixture => {
    const { reportApplicationError } = await import(fixture);
    reportApplicationError(new Error('Unconfirmed write'), { source: 'application' });
  }, fixture);
});
Then('the recorder pauses with {int} unconfirmed occurrence', async function (count) {
  await expect.poll(async () => (await recorderState(this.page)).phase, { timeout: 10_000 }).toBe('unavailable');
  const state = await recorderState(this.page);
  assert.equal(state.unconfirmed, count);
  assert.ok(state.error);
});
When('{int} distinct errors occur while recording is paused', async function (count) {
  await this.page.evaluate(async ({ fixture, count }) => {
    const { reportApplicationError } = await import(fixture);
    for (let index = 0; index < count; index++) reportApplicationError(new Error(`Pending failure ${index}`), { source: 'application' });
  }, { fixture, count });
});
Then('{int} unique errors wait for retry and {int} occurrences were dropped', async function (queued, dropped) {
  const state = await recorderState(this.page);
  assert.equal(state.queued, queued);
  assert.equal(state.dropped, dropped);
  assert.equal(state.phase, 'unavailable');
});
When('I retry the isolated error recorder', async function () {
  await this.page.evaluate(async fixture => { (await import(fixture)).retryErrorHistory(); }, fixture);
  await expect.poll(async () => (await recorderState(this.page)).phase).toBe('ready');
});
Then('{int} unique errors are saved without recording the storage failure', async function (count) {
  await expect.poll(async () => (await recorderState(this.page)).total).toBe(count);
  const stored = await this.page.evaluate(async fixture => (await import(fixture)).readErrors(0, 100), fixture);
  assert.equal(stored.total, count);
  assert.equal(stored.entries.every(entry => entry.error.message.startsWith('Pending failure ')), true);
  assert.equal((await recorderState(this.page)).unconfirmed, 1);
  const states = await this.page.evaluate(() => globalThis.errorRecorderStates);
  assert.equal(states.some(state => state.queued > 0 && state.total > 0 && state.total < count), true,
    'An open history view must refresh before all queued writes finish.');
});
When('the error worker saves an error without acknowledging it', async function () {
  const worker = await errorWorker(this.page);
  await worker.evaluate(() => { globalThis.postMessage = () => {}; });
  await this.page.evaluate(async fixture => {
    const { reportApplicationError } = await import(fixture);
    reportApplicationError(new Error('Lost acknowledgement'), { source: 'application' });
  }, fixture);
});
Then('the acknowledged history contains the error exactly once', async function () {
  await expect.poll(async () => (await recorderState(this.page)).total).toBe(1);
  const state = await recorderState(this.page);
  assert.equal(state.entries[0].error.message, 'Lost acknowledgement');
  assert.equal(state.entries[0].occurrences, 1);
});
When('the same error is reported {int} times before recording runs', async function (count) {
  await this.page.evaluate(async ({ fixture, count }) => {
    const { reportApplicationError } = await import(fixture);
    const error = new Error('Repeated pending error');
    for (let index = 0; index < count; index++) reportApplicationError(error, { source: 'application' });
  }, { fixture, count });
});
Then('one saved error contains {int} occurrences', async function (count) {
  await expect.poll(async () => (await recorderState(this.page)).entries[0]?.occurrences).toBe(count);
  const state = await recorderState(this.page);
  assert.equal(state.total, 1);
  assert.equal(state.dropped, 0);
});
When('the idle error worker crashes', async function () {
  const worker = await errorWorker(this.page);
  await worker.evaluate(() => { setTimeout(() => { throw new Error('Recorder worker fault fixture'); }, 0); });
});
Then('the recorder reports its own failure without recording an application error', async function () {
  await expect.poll(async () => (await recorderState(this.page)).phase).toBe('unavailable');
  const state = await recorderState(this.page);
  assert.match(state.error, /Recorder worker fault fixture/);
  assert.equal(state.queued, 0);
  assert.equal(state.unconfirmed, 0);
  assert.equal(state.total, 0);
});
Then('the retried recorder has no saved errors', async function () {
  const state = await recorderState(this.page);
  assert.equal(state.total, 0);
  assert.deepEqual(state.entries, []);
  assert.equal(state.queued, 0);
});

const runtimeFailureMessages = ['Error history uncaught runtime fixture', 'Error history unhandled promise fixture'];
async function assertRuntimeHistory(page) {
  await expect(history(page).locator('.metrics dd')).toHaveText('2');
  await expect(history(page).locator('details.entry')).toHaveCount(2);
  for (const message of runtimeFailureMessages) await expect(history(page).locator('summary').filter({ hasText: message })).toHaveCount(1);
}
When('the built application throws an error and rejects an unhandled promise', async function () {
  await this.page.evaluate(messages => {
    setTimeout(() => { throw new Error(messages[0]); }, 0);
    setTimeout(() => { void Promise.reject(new Error(messages[1])); }, 0);
  }, runtimeFailureMessages);
});
Then('both runtime failures appear in history and preserve their original browser errors', async function () {
  await assertRuntimeHistory(this.page);
  const expected = item => item.type === 'pageerror' && runtimeFailureMessages.includes(item.message);
  await expect.poll(() => this.diagnostics.filter(expected).map(item => item.message).sort()).toEqual([...runtimeFailureMessages].sort());
  assert.equal(this.diagnostics.filter(expected).length, 2);
  // Only these two deliberately triggered and asserted browser errors are expected.
  this.diagnostics = this.diagnostics.filter(item => !expected(item));
});
Then('both runtime failures remain in the saved error history', async function () { await assertRuntimeHistory(this.page); });
