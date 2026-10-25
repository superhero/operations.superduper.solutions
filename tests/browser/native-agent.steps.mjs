// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { prepare, pair, observations } from './native-runtime.steps.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';
import { scopeNativeRpcSchema, nativeRpcOperation } from '../../src/lib/native-rpc.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';

Before({ tags: '@native-agent-ui' }, function () { this.nativeAgent = true; });
const pane = page => page.getByRole('region', { name: 'Native runtimes', exact: true });
const article = page => pane(page).getByRole('article', { name: 'Runtime Codex', exact: true });
async function enabled(world) {
  await prepare(world); await pair(world);
  await expect(article(world.page).getByText('Connected', { exact: true })).toBeVisible();
  await article(world.page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(world.page).getByRole('button', { name: 'Sign in to Codex', exact: true })).toBeVisible();
}
async function fixture() {
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const graphs = ['thread/start', 'turn/start'].map((method, index) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: index * 500, y: 0 }, index ? 'turn' : 'thread', document);
  });
  const doc = { version: 3, id: 'native-browser-workflow', name: 'Native browser workflow', nodes: graphs.flatMap(value => value.nodes), edges: graphs.flatMap(value => value.edges),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const find = (owner, path) => {
    for (const node of doc.nodes.filter(node => node.type === 'data' && node.data.ownerId === owner))
      for (const field of node.data.fields) if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node, field };
    throw new Error('Missing native test port.');
  };
  const output = find('thread', '/result/thread/id'), input = find('turn', '/threadId');
  doc.edges.push({ id: 'native-thread-mapping', kind: 'mapping', source: output.node.id, sourceHandle: output.field.id, target: input.node.id, targetHandle: input.field.id });
  return doc;
}

Then('native runtime login and workflow approvals complete without HTTP adaptation', { timeout: 90_000 }, async function () {
  const page = this.page; await enabled(this);
  await article(page).getByRole('button', { name: 'Sign in to Codex', exact: true }).click();
  const signIn = page.getByRole('region', { name: 'Codex sign-in', exact: true });
  await expect(signIn).toContainText('ABCD-EFGH'); await expect(signIn.getByRole('status')).toContainText('Waiting');
  assert.equal((await observations(this)).methods.filter(method => method === 'account/read').length, 1);
  await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/finish-login`);
  await expect(article(page)).toContainText('ChatGPT account');
  await repository(page, 'save', await fixture(), null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Native browser workflow', exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByLabel('Thread ID', { exact: true })).toHaveValue(/^thread_/);
  await expect(run.getByLabel('Thread ID', { exact: true })).toBeDisabled();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByLabel('Input', { exact: true }).fill('[{"type":"text","text":"Inspect the approved workspace."}]');
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  const approval = run.getByRole('region', { name: 'Codex approval', exact: true });
  await expect(approval).toContainText('pwd'); await expect(approval.getByRole('button', { name: 'Allow once', exact: true })).toBeEnabled();
  await expect(run.getByText('Native operation completed', { exact: true })).toHaveCount(1);
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: '2 operations completed.' })).toBeVisible();
  assert.equal(await run.getByText(/^HTTP \d/).count(), 0);
  const observed = await observations(this); assert.equal(observed.methods.filter(value => value === 'turn/start').length, 1);
  assert.ok(!observed.methods.includes('account/logout'));
  assert.equal((await page.locator('body').innerText()).includes(this.native.pairingKey), false);
  const stored = await page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());
  assert.equal(JSON.stringify(stored).includes(this.native.pairingKey), false);
});

Then('native browser login waits for confirmation and cancellation preserves its paired account', { timeout: 60_000 }, async function () {
  const page = this.page; await enabled(this);
  await article(page).getByRole('combobox', { name: 'Codex sign-in method', exact: true }).click();
  const choices = await page.getByRole('option').allTextContents();
  assert.ok(!choices.some(value => /AuthTokens|Bedrock/i.test(value)));
  await page.getByRole('option', { name: 'ChatGPT browser sign-in', exact: true }).click();
  await article(page).getByRole('button', { name: 'Sign in to Codex', exact: true }).click();
  const login = page.getByRole('region', { name: 'Codex sign-in', exact: true });
  await expect(login.getByRole('link', { name: 'Open Codex sign-in', exact: true })).toHaveAttribute('href', /^https:\/\/auth\.openai\.com\//);
  await expect(article(page)).toContainText('No account connected');
  await login.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
  await expect(login).toHaveCount(0); await expect(article(page)).toContainText('No account connected');
  await expect.poll(async () => (await observations(this)).stops).toBe(2);
  assert.ok(!(await observations(this)).methods.includes('account/logout'));
});
