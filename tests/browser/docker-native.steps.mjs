// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { After, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { inspectServiceSchema } from '../../src/lib/service-catalog.ts';
import { scopeOperationSchema } from '../../src/lib/operation-report.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';

const settings = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
const pane = page => page.getByRole('region', { name: 'Docker hosts', exact: true });
const article = page => pane(page).getByRole('article', { name: 'Docker host Docker', exact: true });
const observations = async world => (await world.context.request.get(`${world.baseURL}/docker-companion-fixture/${world.dockerId}/observations`)).json();
After({ tags: '@docker-native-ui' }, async function () {
  if (this.dockerId) await this.context.request.delete(`${this.baseURL}/docker-companion-fixture/${this.dockerId}/close`);
});
async function prepare(world) {
  world.dockerId = randomUUID(); const response = await world.context.request.post(`${world.baseURL}/docker-companion-fixture/${world.dockerId}/create`);
  assert.equal(response.status(), 200); world.docker = await response.json();
  const page = world.page;
  await settings(page).getByLabel('Credential label', { exact: true }).fill('Docker pairing key');
  await settings(page).getByLabel('Credential value', { exact: true }).fill(world.docker.pairingKey);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).locator('li').filter({ hasText: 'Docker pairing key' })).toHaveCount(1);
  await page.evaluate(() => {
    globalThis.dockerWorkerMessages = []; const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (typeof message?.method === 'string' && /Docker|dockerConnections/.test(message.method)) globalThis.dockerWorkerMessages.push(structuredClone(message));
      return original.call(this, message, ...args);
    };
  });
}
async function pair(world) {
  await pane(world.page).getByLabel('Docker companion URL', { exact: true }).fill(world.docker.host);
  await pane(world.page).getByRole('combobox', { name: 'Docker pairing key', exact: true }).click();
  await world.page.getByRole('option', { name: 'Docker pairing key', exact: true }).click();
  await pane(world.page).getByRole('button', { name: 'Pair Docker host', exact: true }).click();
  await expect(article(world.page).getByText('Connected', { exact: true })).toBeVisible();
}
async function document() {
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/docker.json.gz', import.meta.url))).toString('utf8'));
  const operation = inspectServiceSchema(source, 'docker', new Set(['docker:ContainerList'])).operations[0];
  const scoped = scopeOperationSchema(source, operation.path, operation.method, true).schema;
  return { version: 3, id: 'docker-native-browser', name: 'Docker native browser', ...createOperationGraph(operation, { x: 0, y: 0 }, 'containers', scoped),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
}

Then('a Docker host pairs reloads and runs its scoped container listing', { timeout: 90_000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page)).toContainText(this.docker.daemonId);
  assert.equal((await observations(this)).engineRequests.some(value => value.path.includes('/containers/')), false);
  await repository(page, 'save', await document(), null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Docker native browser', exact: true });
  await expect(run.locator('[data-requirement="docker-destination"]')).toContainText('Required');
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock Docker hosts', exact: true }).click();
  await run.getByRole('combobox', { name: 'Docker destination', exact: true }).click();
  await page.getByRole('option', { name: 'Docker', exact: true }).click();
  await expect(run.locator('[data-requirement="docker-destination"]')).toContainText('Selected');
  await expect(run.getByRole('button', { name: 'Start workflow', exact: true })).toBeEnabled();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await expect(run.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('synthetic-container');
  await expect(run.getByRole('region', { name: 'Step 1 response', exact: true })).toContainText('HTTP 200');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: '1 operation completed.' })).toBeVisible();
  const seen = await observations(this); assert.equal(seen.engineRequests.filter(value => value.path.startsWith('/v1.57/containers/json')).length, 1);
  assert.ok(seen.engineRequests.every(value => value.method === 'GET'));
  assert.ok(seen.requests.some(value => value.method === 'OPTIONS')); assert.ok(seen.requests.every(value => !value.cookie));
  assert.equal((await page.locator('body').innerText()).includes(this.docker.pairingKey), false);
  assert.equal(JSON.stringify(await page.evaluate(() => globalThis.dockerWorkerMessages ?? [])).includes(this.docker.pairingKey), false);
  const storage = await page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());
  assert.equal(JSON.stringify(storage).includes(this.docker.pairingKey), false);
});

Then('Docker settings reject changed daemon and source authority before container reads', { timeout: 60_000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await this.context.request.post(`${this.baseURL}/docker-companion-fixture/${this.dockerId}/change-daemon`);
  await article(page).getByRole('button', { name: 'Check Docker host', exact: true }).click();
  await expect(article(page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect(settings(page).getByRole('alert')).toContainText('changed');
  assert.equal((await observations(this)).engineRequests.some(value => value.path.includes('/containers/')), false);
  await article(page).getByRole('button', { name: 'Remove Docker pairing', exact: true }).click();
  await expect(pane(page).getByRole('article')).toHaveCount(0); await pair(this);
  const count = (await observations(this)).requests.length;
  await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index'); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('catalog', 'readwrite'), store = transaction.objectStore('catalog'), reading = store.get('docker');
      reading.onsuccess = () => { if (!reading.result) { transaction.abort(); return; } store.put({ ...reading.result, enabled: false }, 'docker'); };
      transaction.oncomplete = () => { database.close(); resolve(); }; transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  await article(page).getByRole('button', { name: 'Check Docker host', exact: true }).click();
  await expect(settings(page).getByRole('alert')).toBeVisible(); assert.equal((await observations(this)).requests.length, count);
});
