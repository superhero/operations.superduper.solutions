// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode } from './workspace.steps.mjs';
import { repository } from './workflow-storage.fixture.mjs';

const dashboard = page => page.getByRole('region', { name: 'Storage dashboard', exact: true });
const browserStorage = page => dashboard(page).getByRole('region', { name: 'Storage', exact: true });
const databases = page => dashboard(page).getByRole('region', { name: 'Storage', exact: true });
const repositories = page => dashboard(page).getByRole('region', { name: 'Git filesystem', exact: true });
const value = (region, label) => region.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
const report = page => page.evaluate(async () => (await import('/workflow-repository-fixture.js')).collectStorageReport());
const databaseNames = page => page.evaluate(async () => (await indexedDB.databases()).map(database => database.name).sort());

async function openStorage(page) {
  const requestedAt = Date.now();
  await setMode(page, 'settings');
  const summary = page.locator('summary[aria-label="Browser"]');
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  await expect(dashboard(page)).toBeVisible();
  await page.evaluate(requestedAt => new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('operations-metrics-recorder-v1');
    const timer = setTimeout(() => { channel.close(); reject(new Error('The recorder did not publish fresh storage metrics within 60 seconds.')); }, 60000);
    channel.onmessage = ({ data }) => {
      if (data?.type === 'snapshot' && data.snapshot?.report?.collectedAt >= requestedAt) {
        clearTimeout(timer); channel.close(); resolve();
      }
    };
    channel.postMessage({ type: 'hello' });
  }), requestedAt);
  await expect(browserStorage(page)).toBeVisible();
}

async function mockStorageAPIs(page, mode) {
  let recorder;
  await expect.poll(async () => {
    for (const worker of page.workers()) {
      if (await worker.evaluate(() => globalThis.name === 'operations-metrics-recorder')) { recorder = worker; return true; }
    }
    return false;
  }).toBe(true);
  // The recorder creates its own history database before its first measurement.
  // Capture database baselines only after that legitimate initialization settles.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('operations-metrics-recorder-v1');
    const timer = setTimeout(() => { channel.close(); reject(new Error('The metrics recorder did not initialize.')); }, 10000);
    channel.onmessage = ({ data }) => {
      if (data?.type === 'snapshot' && data.snapshot?.phase !== 'starting') {
        clearTimeout(timer); channel.close(); resolve();
      }
    };
    channel.postMessage({ type: 'hello' });
  }));
  const apply = mode => {
    if (mode === 'known') {
      Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: async () => ({ usage: 1024, quota: 4096, usageDetails: { indexedDB: 1024 } }) });
      Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false });
    } else {
      globalThis.storageOriginalDatabases = indexedDB.databases.bind(indexedDB);
      Object.defineProperty(navigator.storage, 'estimate', { configurable: true, value: undefined });
      Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: undefined });
      Object.defineProperty(indexedDB, 'databases', { configurable: true, value: undefined });
    }
  };
  await page.evaluate(apply, mode);
  await recorder.evaluate(apply, mode);
}

async function createDatabase(page, name) {
  await page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      const records = request.result.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
      records.createIndex('by_kind', 'kind');
      records.createIndex('by_code', 'code', { unique: true });
      records.createIndex('by_tag', 'tags', { multiEntry: true });
      records.put({ id: 1, kind: 'example', code: 'a', tags: ['one', 'two'] });
      records.put({ id: 2, kind: 'example', code: 'b', tags: ['two'] });
      request.result.createObjectStore('empty');
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), name);
}

async function databaseContents(page, name) {
  return page.evaluate(name => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction([...database.objectStoreNames]);
      const requests = [...database.objectStoreNames].map(name => ({ name, request: transaction.objectStore(name).getAll() }));
      transaction.oncomplete = () => { database.close(); resolve(requests.map(({ name, request }) => ({ name, values: request.result }))); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), name);
}

function databaseDetails(page, name) {
  return databases(page).locator('.database-entry').and(page.getByRole('group', { name, exact: true }));
}

function repositoryDetails(page, name) {
  return repositories(page).locator('.repository-entry').filter({ has: page.locator('.repository-heading').filter({ hasText: name }) }).first();
}

async function expectRepositoryGraphs(details, commits) {
  await expect(details.locator('.repository-size > .stacked-bar')).toBeVisible();
  await expect(details.locator('.activity')).toContainText(`Last 60 days · ${commits} commits`, { timeout: 60000 });
  const activity = details.getByRole('group', { name: 'Daily commit counts', exact: true });
  await expect(activity).toBeVisible();
  const days = activity.locator('.activity-day');
  await expect(days).toHaveCount(60);
  const cells = await days.evaluateAll(elements => elements.map(element => ({
    label: element.getAttribute('aria-label'),
    intensity: element.style.getPropertyValue('--intensity').trim(),
  })));
  const counts = cells.map(cell => {
    const match = cell.label?.match(/: (\d+) commits?$/);
    assert.ok(match, `Each heatmap day needs an accessible commit count: ${cell.label}`);
    return Number(match[1]);
  });
  assert.equal(counts.reduce((total, count) => total + count, 0), commits);
  const busiest = Math.max(...counts);
  cells.forEach((cell, index) => {
    if (counts[index] === 0) assert.equal(cell.intensity, '0%');
    if (counts[index] === busiest) assert.equal(cell.intensity, '100%');
  });
  await expect(details.locator('.metadata, .daily-counts, details')).toHaveCount(0);
}

Given('a database containing indexed records and an empty store', async function () {
  this.storageDatabaseName = 'storage-dashboard-fixture';
  await createDatabase(this.page, this.storageDatabaseName);
});

Then('Storage shows native estimates and accurate database metadata without changing storage', { timeout: 90000 }, async function () {
  const page = this.page;
  const namesBefore = await databaseNames(page);
  const recordsBefore = await databaseContents(page, this.storageDatabaseName);
  const result = await report(page);
  assert.equal(result.indexedDB.available, true);
  assert.equal(result.indexedDB.enumeration, 'complete');
  assert.deepEqual(await databaseNames(page), namesBefore, 'Resource inspection must not create databases.');
  assert.equal(typeof result.browser.persisted, 'boolean');
  assert.ok(result.browser.usage >= 0 && result.browser.quota > 0);
  assert.equal(result.browser.remaining, Math.max(0, result.browser.quota - result.browser.usage));
  assert.equal(result.browser.utilization, result.browser.usage / result.browser.quota);
  const database = result.indexedDB.databases.find(item => item.name === this.storageDatabaseName);
  assert.equal(database.version, 3);
  assert.equal(database.error, null);
  assert.deepEqual(database.stores.map(store => ({ ...store, indexes: store.indexes.toSorted((a, b) => a.name.localeCompare(b.name)) })).toSorted((a, b) => a.name.localeCompare(b.name)), [
    { name: 'empty', records: 0, keyPath: null, autoIncrement: false, indexes: [] },
    { name: 'records', records: 2, keyPath: 'id', autoIncrement: true, indexes: [
      { name: 'by_code', keyPath: 'code', unique: true, multiEntry: false },
      { name: 'by_kind', keyPath: 'kind', unique: false, multiEntry: false },
      { name: 'by_tag', keyPath: 'tags', unique: false, multiEntry: true },
    ] },
  ]);
  await openStorage(page);
  const details = databaseDetails(page, this.storageDatabaseName);
  await expect(details.locator('.database-name')).toHaveText(this.storageDatabaseName);
  await expect(details.locator('.database-count')).toHaveText('2');
  await expect(details.locator('.database-unit')).toHaveText('Records');
  await expect(details.locator('details, summary')).toHaveCount(0);
  await expect(value(browserStorage(page), 'Used')).not.toHaveText('Unavailable');
  assert.deepEqual(await databaseContents(page, this.storageDatabaseName), recordsBefore);
  // Opening Browser settings also initializes the independent error-history service.
  // That owned database is distinct from the resource collector's readonly inspection.
  assert.deepEqual((await databaseNames(page)).filter(name => name !== 'v1/errors'), namesBefore.filter(name => name !== 'v1/errors'),
    'Monitoring must not create phantom databases.');
});

Then('Storage reports repository bytes and history without changing either workflow', { timeout: 90000 }, async function () {
  const page = this.page;
  this.storageBefore = await repository(page, 'inspect', this.historyFirst.id);
  this.storageOtherBefore = await repository(page, 'inspect', this.historyOther.id);
  const result = await report(page);
  const entry = result.repositories.items.find(item => item.id === this.historyFirst.id);
  assert.equal(entry.error, null);
  assert.equal(entry.repositoryPath, this.storageBefore.entry.repositoryPath);
  const metrics = entry.metrics;
  assert.equal(metrics.commitCount, 2);
  assert.equal(metrics.head, this.historyLatestOid);
  assert.equal(metrics.latest.oid, this.historyLatestOid);
  assert.deepEqual(metrics.recent.map(commit => commit.oid), this.storageBefore.versions.map(commit => commit.oid));
  assert.deepEqual(metrics.latest.parents, [this.historyFirstOid]);
  assert.equal(metrics.latest.message, 'Add a comment and rename');
  assert.ok(metrics.latest.author && metrics.latest.committer && metrics.latest.timestamp > 0);
  assert.deepEqual(metrics.trackedFiles, ['workflow.json']);
  assert.deepEqual(metrics.status, { clean: true, modified: 0, staged: 0, untracked: 0, deleted: 0 });
  assert.equal(metrics.workingTreeBytes, Buffer.byteLength(this.storageBefore.working));
  assert.equal(metrics.workflowFile.bytes, metrics.workingTreeBytes);
  assert.ok(metrics.gitBytes > 0);
  assert.equal(metrics.repositoryBytes, metrics.gitBytes + metrics.workingTreeBytes);
  assert.ok(metrics.branches.includes(metrics.branch));
  assert.deepEqual(metrics.tags, []);
  assert.deepEqual(metrics.remotes, []);
  assert.equal(metrics.activity.reduce((sum, day) => sum + day.count, 0), 2);
  await openStorage(page);
  await page.screenshot({ path: 'tmp/test/storage-desktop.png' });
  const details = repositoryDetails(page, this.historyLatest.name);
  await expectRepositoryGraphs(details, 2);
  assert.deepEqual(await repository(page, 'inspect', this.historyFirst.id), this.storageBefore);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.storageOtherBefore);
  await page.screenshot({ path: 'tmp/test/storage-repository.png' });
});

Then('reopening Storage includes the next saved workflow version', { timeout: 90000 }, async function () {
  const page = this.page;
  const next = await repository(page, 'save', { ...this.historyLatest, description: 'A refreshed stored version' }, this.historyLatestOid, 'Refresh dashboard version');
  await page.locator('summary[aria-label="Browser"]').click();
  await expect(dashboard(page)).toHaveCount(0);
  await openStorage(page);
  const details = repositoryDetails(page, this.historyLatest.name);
  await expectRepositoryGraphs(details, 3);
  const result = await report(page);
  const metrics = result.repositories.items.find(item => item.id === this.historyFirst.id).metrics;
  assert.equal(metrics.head, next.revision);
  assert.equal(metrics.commitCount, 3);
  assert.deepEqual(await repository(page, 'inspect', this.historyOther.id), this.storageOtherBefore);
});

Then('Storage accurately reports dirty Git files without rewriting the index', { timeout: 90000 }, async function () {
  this.storageDirtyBefore = await repository(this.page, 'dirtyGit', this.historyFirst.id);
  this.storageOtherBefore = await repository(this.page, 'inspect', this.historyOther.id);
  const result = await report(this.page);
  const metrics = result.repositories.items.find(item => item.id === this.historyFirst.id).metrics;
  assert.deepEqual(metrics.status, { clean: false, modified: 2, staged: 1, untracked: 1, deleted: 1 });
  assert.equal(metrics.head, this.storageDirtyBefore.head);
  assert.deepEqual(await repository(this.page, 'gitState', this.historyFirst.id), this.storageDirtyBefore,
    'A status scan must preserve the exact index bytes, HEAD, and working files.');
});

Then("an unreadable repository does not hide another workflow's metrics", { timeout: 90000 }, async function () {
  await this.page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/workflows/index');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('catalog', 'readwrite');
      const store = transaction.objectStore('catalog');
      const entry = store.get(id);
      entry.onsuccess = () => store.put({ ...entry.result, repositoryPath: `${entry.result.repositoryPath}/missing-repository` }, id);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), this.historyFirst.id);
  const result = await report(this.page);
  const failed = result.repositories.items.find(item => item.id === this.historyFirst.id);
  const other = result.repositories.items.find(item => item.id === this.historyOther.id);
  assert.equal(failed.metrics, null);
  assert.ok(failed.error);
  assert.equal(other.error, null);
  assert.equal(other.metrics.commitCount, 1);
  await openStorage(this.page);
  const details = repositoryDetails(this.page, this.historyLatest.name);
  await expect(details.getByRole('alert')).toBeVisible();
  const readable = repositoryDetails(this.page, this.historyOther.name);
  await expectRepositoryGraphs(readable, 1);
  assert.deepEqual(await repository(this.page, 'inspect', this.historyOther.id), this.storageOtherBefore);
});

Given('browser storage estimates are known and persistence is not granted', async function () {
  await mockStorageAPIs(this.page, 'known');
});

Then('Storage displays best-effort persistence and the calculated capacity', { timeout: 90000 }, async function () {
  const result = await report(this.page);
  assert.deepEqual({ usage: result.browser.usage, quota: result.browser.quota, remaining: result.browser.remaining,
    utilization: result.browser.utilization, persisted: result.browser.persisted },
  { usage: 1024, quota: 4096, remaining: 3072, utilization: 0.25, persisted: false });
  assert.deepEqual(result.browser.breakdown, [{ name: 'indexedDB', bytes: 1024 }]);
  await openStorage(this.page);
  await expect(value(browserStorage(this.page), 'Persistence')).toHaveText('Best effort');
  await expect(value(browserStorage(this.page), 'Remaining')).toHaveCount(0);
  await expect(browserStorage(this.page)).toContainText('25');
});

Given('browser storage estimate and enumeration APIs are unavailable', async function () {
  await mockStorageAPIs(this.page, 'unavailable');
  this.storageDatabaseNames = await this.page.evaluate(async () => (await globalThis.storageOriginalDatabases()).map(database => database.name).sort());
});

Then('Storage reports unavailable metrics and safely inspects existing application databases', { timeout: 90000 }, async function () {
  const result = await report(this.page);
  const nativeNames = () => this.page.evaluate(async () => (await window.storageOriginalDatabases()).map(database => database.name).sort());
  assert.deepEqual(await nativeNames(), this.storageDatabaseNames, 'Fallback resource inspection must not create databases.');
  assert.equal(result.browser.usage, null);
  assert.equal(result.browser.quota, null);
  assert.equal(result.browser.persisted, null);
  assert.equal(result.indexedDB.enumeration, 'known');
  assert.ok(result.indexedDB.databases.some(database => database.name === 'v1/settings'));
  await openStorage(this.page);
  await expect(value(browserStorage(this.page), 'Used')).toHaveText('Unavailable');
  await expect(value(browserStorage(this.page), 'Quota')).toHaveText('Unavailable');
  await expect(value(browserStorage(this.page), 'Persistence')).toHaveText('Unavailable');
  await expect(databases(this.page)).toContainText('v1/settings');
  assert.deepEqual((await nativeNames()).filter(name => name !== 'v1/errors'), this.storageDatabaseNames.filter(name => name !== 'v1/errors'),
    'Only the independent error-history service may initialize its database when Browser settings open.');
});

Given('storage contains a database and workflow with long names', async function () {
  this.storageDatabaseName = `storage-database-${'longname'.repeat(16)}`;
  this.storageWorkflowName = `Workflow-${'longname'.repeat(16)}`.slice(0, 100);
  await createDatabase(this.page, this.storageDatabaseName);
  await repository(this.page, 'save', { version: 3, id: 'storage-long-workflow', name: this.storageWorkflowName, description: '', nodes: [], edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false }, null, 'Long workflow name');
});

Then('expanded Storage details fit the narrow viewport', { timeout: 90000 }, async function () {
  await openStorage(this.page);
  await this.page.screenshot({ path: 'tmp/test/storage-mobile.png' });
  const database = databaseDetails(this.page, this.storageDatabaseName);
  const repo = repositoryDetails(this.page, this.storageWorkflowName);
  await expect(database).toContainText(this.storageDatabaseName);
  await expect(repo).toContainText(this.storageWorkflowName);
  const overflow = await this.page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Storage dashboard"]');
    return { document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: panel.scrollWidth - panel.clientWidth };
  });
  assert.ok(overflow.document <= 1 && overflow.panel <= 1, `Storage must not overflow the viewport: ${JSON.stringify(overflow)}`);
  await this.page.screenshot({ path: 'tmp/test/storage-mobile-details.png' });
});
