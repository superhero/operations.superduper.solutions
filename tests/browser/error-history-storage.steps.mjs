// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';

const fixture = '/error-history-storage-fixture.js';
const historyPage = page => page.evaluate(async path => (await import(path)).readErrors(), fixture);

Given('an empty error-history database', async function () {
  await this.page.evaluate(async path => (await import(path)).clearHistory(), fixture);
});

When('the same diagnostic is recorded at different times', async function () {
  await this.page.evaluate(async path => {
    const { recordErrors, occurrence } = await import(path);
    await recordErrors([occurrence('same', 2000, 2)]);
    await recordErrors([occurrence('same', 4000), occurrence('same', 1000)]);
  }, fixture);
});

When('the error-history page is reloaded', async function () {
  await this.page.reload();
});

Then('one persisted error retains its details, occurrence count and first and last times', async function () {
  const history = await historyPage(this.page);
  assert.equal(history.total, 1);
  assert.equal(history.entries.length, 1);
  const [record] = history.entries;
  assert.equal(record.occurrences, 4);
  assert.equal(record.firstSeen, 1000);
  assert.equal(record.lastSeen, 4000);
  assert.equal(record.identity, 'same');
  assert.equal(record.error.name, 'StorageError');
  assert.equal(record.error.code, 'EXAMPLE');
  assert.equal(record.error.stack, 'StorageError: Failure same\n    at example.ts:4:2');
  assert.deepEqual(record.error.cause, { name: 'TypeError', message: 'Underlying failure', stack: 'TypeError: Underlying failure\n    at source.ts:2:1' });
  assert.deepEqual(record.origin, { source: 'application', scope: 'Browser fixture' });
});

When('1000 different errors have been recorded', async function () {
  await this.page.evaluate(async path => (await import(path)).seedHistory(1000), fixture);
});

When('the oldest error repeats before another distinct error arrives', async function () {
  await this.page.evaluate(async path => {
    const { recordErrors, occurrence } = await import(path);
    await recordErrors([occurrence('unique-0', 5000), occurrence('unique-1000', 6000)]);
  }, fixture);
});

Then('only the 1000 newest unique errors remain in insertion order', async function () {
  const result = await this.page.evaluate(async path => {
    const { readErrors } = await import(path);
    return { first: await readErrors(), last: await readErrors(975), beyond: await readErrors(1000) };
  }, fixture);
  assert.equal(result.first.total, 1000);
  assert.deepEqual(result.first.entries.map(entry => entry.identity), Array.from({ length: 25 }, (_, index) => `unique-${1000 - index}`));
  assert.equal(result.last.entries.length, 25);
  assert.equal(result.last.entries.at(-1).identity, 'unique-1');
  assert.deepEqual(result.beyond, { entries: [], total: 1000 });
});

When('a new error is followed by the just-evicted error in one batch', async function () {
  await this.page.evaluate(async path => {
    const { recordErrors, occurrence } = await import(path);
    await recordErrors([occurrence('unique-1000', 6000), occurrence('unique-0', 7000)]);
  }, fixture);
});

Then('the recurring error is newest and the next oldest error is evicted', async function () {
  const result = await this.page.evaluate(async path => {
    const { readErrors } = await import(path);
    return { newest: await readErrors(), oldest: await readErrors(999) };
  }, fixture);
  assert.equal(result.newest.total, 1000);
  assert.deepEqual(result.newest.entries.slice(0, 2).map(entry => entry.identity), ['unique-0', 'unique-1000']);
  assert.equal(result.newest.entries[0].occurrences, 1);
  assert.equal(result.newest.entries[0].firstSeen, 7000);
  assert.equal(result.oldest.entries[0].identity, 'unique-2');
});

When('two tabs record overlapping error batches concurrently', async function () {
  await this.page.evaluate(async path => (await import(path)).seedHistory(999), fixture);
  const other = await this.context.newPage();
  await other.goto(`${this.baseURL}/error-history-fixture.html`);
  try {
    await Promise.all([this.page, other].map((page, index) => page.evaluate(async ({ path, index }) => {
      const { recordErrors, occurrence } = await import(path);
      for (let pass = 0; pass < 5; pass++)
        await recordErrors([occurrence('shared', 10_000 + index * 10 + pass), occurrence(`tab-${index}`, 20_000 + pass)]);
    }, { path: fixture, index })));
  } finally { await other.close(); }
});

Then('their shared errors retain every occurrence without exceeding the history limit', async function () {
  const result = await historyPage(this.page);
  assert.equal(result.total, 1000);
  const shared = result.entries.find(entry => entry.identity === 'shared');
  assert.equal(shared.occurrences, 10);
  assert.equal(shared.firstSeen, 10_000);
  assert.equal(shared.lastSeen, 10_014);
  assert.equal(result.entries.find(entry => entry.identity === 'tab-0').occurrences, 5);
  assert.equal(result.entries.find(entry => entry.identity === 'tab-1').occurrences, 5);
  const oldest = await this.page.evaluate(async path => (await import(path)).readErrors(999), fixture);
  assert.equal(oldest.entries[0].identity, 'unique-2');
});

When('an error-history transaction aborts after its first insertion', async function () {
  assert.equal(await this.page.evaluate(async path => (await import(path)).abortWriteBatch(), fixture), 'AbortError');
});

Then('none of the aborted errors are persisted', async function () {
  assert.deepEqual(await historyPage(this.page), { entries: [], total: 0 });
});

When('an error-history transaction aborts during FIFO eviction', async function () {
  assert.equal(await this.page.evaluate(async path => (await import(path)).abortEviction(), fixture), 'AbortError');
});

Then('the complete original error history remains unchanged', async function () {
  const result = await this.page.evaluate(async path => {
    const { readErrors } = await import(path);
    return { first: await readErrors(), last: await readErrors(999) };
  }, fixture);
  assert.equal(result.first.total, 1000);
  assert.equal(result.first.entries[0].identity, 'unique-999');
  assert.equal(result.last.entries[0].identity, 'unique-0');
});

When('browser access to error history is denied', async function () {
  assert.equal(await this.page.evaluate(async path => (await import(path)).unavailableHistory(), fixture), 'SecurityError');
});

Then('error history can be used again after access returns', async function () {
  await this.page.evaluate(async path => {
    const { recordErrors, occurrence } = await import(path);
    await recordErrors([occurrence('recovered')]);
  }, fixture);
  const result = await historyPage(this.page);
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].identity, 'recovered');
});

When('another connection prevents error history from opening', async function () {
  this.blockedHistory = await this.page.evaluate(async path => (await import(path)).blockedHistory(), fixture);
});

Then('the blocked request is bounded and history recovers after the connection closes', function () {
  assert.equal(this.blockedHistory.name, 'TimeoutError');
  assert.equal(this.blockedHistory.repeated, 'TimeoutError');
  assert.ok(this.blockedHistory.elapsed >= 2400 && this.blockedHistory.elapsed < 5000, `Unexpected timeout: ${this.blockedHistory.elapsed}ms`);
  assert.equal(this.blockedHistory.leftBehind, false);
  assert.deepEqual(this.blockedHistory.recovered, { entries: [], total: 0 });
});

When('another connection holds an error-history write transaction', async function () {
  this.blockedTransaction = await this.page.evaluate(async path => (await import(path)).blockedTransaction(), fixture);
});

Then('the blocked transaction times out and later reads recover', function () {
  assert.equal(this.blockedTransaction.name, 'TimeoutError');
  assert.ok(this.blockedTransaction.elapsed >= 2400 && this.blockedTransaction.elapsed < 5000,
    `Unexpected timeout: ${this.blockedTransaction.elapsed}ms`);
  assert.deepEqual(this.blockedTransaction.recovered, { entries: [], total: 0 });
});

Then('error history rejects oversized batches and invalid pagination', async function () {
  const result = await this.page.evaluate(async path => {
    const { recordErrors, readErrors, occurrence } = await import(path);
    const operations = [() => recordErrors(Array.from({ length: 129 }, () => occurrence('excess'))),
      () => recordErrors([occurrence('invalid', Number.NaN)]), () => readErrors(-1), () => readErrors(0, 101)];
    return Promise.all(operations.map(operation => operation().then(() => 'unexpected success', error => error.name)));
  }, fixture);
  assert.deepEqual(result, ['RangeError', 'TypeError', 'RangeError', 'RangeError']);
  assert.deepEqual(await historyPage(this.page), { entries: [], total: 0 });
});
