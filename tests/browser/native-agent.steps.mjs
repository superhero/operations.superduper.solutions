// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { prepare, pair, observations, observeNativeWorker } from './native-runtime.steps.mjs';
import { repository } from './workflow-storage.fixture.mjs';
import { setMode, workflowAction } from './workspace.fixture.mjs';
import { scopeNativeRpcSchema, nativeRpcOperation } from '../../src/lib/native-rpc.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';

Before({ tags: '@native-agent-ui' }, function () { this.nativeAgent = true; });
const pane = page => page.getByRole('region', { name: 'Native runtimes', exact: true });
const article = page => pane(page).getByRole('article', { name: 'Runtime Codex', exact: true });

Then('the running workflow turn can be steered and interrupted through its private worker', { timeout: 120000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const saved = await fixture(); saved.id = 'native-turn-control-browser'; saved.name = 'Owned turn controls';
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Owned turn controls', exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => { await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click(); };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
  await run.getByLabel('Input', { exact: true }).fill('[{"type":"text","text":"Owned browser turn."}]');
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  const live = run.getByRole('region', { name: 'Running native turn', exact: true });
  await expect(live).toBeVisible(); await live.getByLabel('Instruction for the running turn', { exact: true }).fill('Owned browser steering.');
  await live.getByRole('button', { name: 'Send instruction', exact: true }).click(); await expect(live.getByRole('status')).toHaveText('Instruction sent.');
  await live.getByRole('button', { name: 'Stop turn', exact: true }).click(); await expect(live).toHaveCount(0);
  const seen = await observations(this); if (this.nativeReal) assert.equal(seen.real, true);
  assert.equal(seen.methods.filter(method => method === 'turn/steer').length, 1); assert.equal(seen.methods.filter(method => method === 'turn/interrupt').length, 1);
  const messages = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'controlNativeTurn'));
  assert.equal(messages.length, 2); assert.deepEqual(messages.map(m => m.args[2].operation.rpc.method), ['turn/steer', 'turn/interrupt']);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('the workflow selects and confirms its observed Guardian denial before native approval', { timeout: 150000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const saved = await fixture(['turn/start', 'thread/approveGuardianDeniedAction', 'turn/start']); saved.id = 'native-guardian-browser'; saved.name = 'Owned Guardian approval';
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Owned Guardian approval', exact: true });
  await run.getByRole('combobox', { name: 'Approval reviewer', exact: true }).click(); await page.getByRole('option', { name: 'auto_review', exact: true }).click();
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => { await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click(); };
  const action = async name => { const response = await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/${name}`); assert.equal(response.ok(), true); };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
  await run.getByLabel('Input', { exact: true }).fill('[{"type":"text","text":"Exercise the owned approval fixture, then stop."}]');
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  await expect(run.getByRole('region', { name: 'Running native turn', exact: true })).toBeVisible();
  if (this.nativeReal) await expect.poll(async () => (await observations(this)).providerResponseCount).toBe(1);
  await action('guardian-tool');
  if (this.nativeReal) await expect.poll(async () => (await observations(this)).providerResponseCount).toBe(2);
  await action('guardian-deny');
  if (this.nativeReal) await expect.poll(async () => (await observations(this)).providerResponseCount).toBe(3);
  await action('finish-response'); await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
  await run.getByRole('region', { name: 'Observed Guardian denials', exact: true }).getByRole('button', { name: 'Select this denial', exact: true }).click();
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  const approval = run.getByRole('region', { name: 'Guardian denial approval', exact: true }); await expect(approval).toBeVisible();
  await expect(approval).toContainText('OWNED_GUARDIAN_DENIAL');
  assert.equal((await observations(this)).methods.filter(method => method === 'thread/approveGuardianDeniedAction').length, 0);
  await approval.getByRole('button', { name: 'Approve one retry', exact: true }).click(); await expect(approval).toHaveCount(0);
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
  await run.getByLabel('Input', { exact: true }).fill('[{"type":"text","text":"Report the owned approved action without running tools."}]');
  await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  await expect(run.getByRole('region', { name: 'Running native turn', exact: true })).toBeVisible();
  if (this.nativeReal) {
    await expect.poll(async () => (await observations(this)).providerResponseCount).toBe(4);
    const requests = (await observations(this)).providerRequests, input = requests.findLast(request => request.method === 'POST').body.input;
    const strings = []; const collect = value => { if (typeof value === 'string') strings.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); }; collect(input);
    assert.ok(strings.join('\n').includes('"outcome": "allowed"'));
  }
  await action('finish-response'); await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const seen = await observations(this); if (this.nativeReal) assert.equal(seen.real, true);
  assert.equal(seen.methods.filter(method => method === 'thread/approveGuardianDeniedAction').length, 1);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('the owned workflow review and compaction finish after their native turns', { timeout: 120000 }, async function () {
  this.nativeReal = true;
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const saved = await fixture(['review/start', 'thread/compact/start']); saved.id = 'native-turn-work-browser'; saved.name = 'Owned review and compaction';
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Owned review and compaction', exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => { await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click(); };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  for (const method of ['review/start', 'thread/compact/start']) {
    await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
    if (method === 'review/start') await run.getByLabel('Review target', { exact: true }).fill('{"type":"custom","instructions":"Produce an empty structured review of this owned fixture."}');
    await run.getByRole('button', { name: 'Run operation', exact: true }).click();
    const live = run.getByRole('region', { name: 'Running native turn', exact: true });
    await expect(live).toBeVisible(); await expect(live.getByLabel('Instruction for the running turn', { exact: true })).toHaveCount(0);
    await expect(live.getByRole('button', { name: 'Stop turn', exact: true })).toBeVisible();
    await expect.poll(async () => (await observations(this)).providerHeld).toBe(1);
    const completed = await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/finish-response`); assert.equal(completed.ok(), true);
    await expect(live).toHaveCount(0); await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  }
  const seen = await observations(this); assert.equal(seen.real, true);
  for (const method of ['review/start', 'thread/compact/start']) assert.equal(seen.methods.filter(value => value === method).length, 1);
  assert.equal(seen.providerHeld, 0);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('account action {string} requires confirmation before its native dispatch', { timeout: 90000 }, async function (method) {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
  const saved = { version: 3, id: 'native-account-action-' + (method.includes('consume') ? 'reset' : 'email'), name: 'Account action', ...createOperationGraph(operation, { x: 0, y: 0 }, 'account-action', document), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Account action', exact: true });
  if (method.includes('consume')) await run.getByLabel('Idempotency key', { exact: true }).fill('browser owned retry / 42');
  else { await run.getByRole('combobox', { name: 'Credit type', exact: true }).click(); await page.getByRole('option', { name: 'usage_limit', exact: true }).click(); }
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  const approval = run.getByRole('region', { name: 'Account action approval', exact: true });
  await expect(approval).toContainText('owned-account@example.test');
  if (method.includes('consume')) await expect(approval).toContainText('browser owned retry / 42');
  assert.equal((await observations(this)).methods.filter(item => item === method).length, 0);
  await approval.getByRole('button', { name: method.includes('consume') ? 'Use reset credit' : 'Send credit email', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); await expect(approval).toHaveCount(0);
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true }); await expect(response).toContainText(method.includes('consume') ? 'reset' : 'sent');
  assert.equal((await observations(this)).methods.filter(item => item === method).length, 1);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('gateway authentication cancels its owned native login through the production worker', { timeout: 90000 }, async function () {
  await prepare(this); await pair(this);
  await expect(article(this.page).getByText('Connected', { exact: true })).toBeVisible();
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(this.page);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const result = await this.page.evaluate(async () => (await import('/vault-policy-fixture.js')).privateNativeGatewayAuthentication());
  assert.deepEqual(result.current, result.original); assert.deepEqual(result.failures, ['CANCELLED', 'CANCELLED']);
  const seen = await observations(this); assert.equal(seen.methods.filter(method => method === 'account/gatewayOAuth/login').length, 2);
  assert.equal(seen.methods.filter(method => method === 'account/gatewayOAuth/cancel').length, 2);
  assert.ok(!seen.methods.some(method => ['account/login/start', 'thread/start', 'turn/start'].includes(method)));
});

Then('the gateway workflow form keeps its handoff transient until confirmation', { timeout: 90000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const method = 'account/gatewayOAuth/login', document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
  const saved = { version: 3, id: 'native-gateway-browser', name: 'Gateway sign-in', ...createOperationGraph(operation, { x: 0, y: 0 }, 'gateway', document), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Gateway sign-in', exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  const notice = run.getByRole('region', { name: 'Gateway sign-in', exact: true });
  const link = notice.getByRole('link', { name: 'Open gateway sign-in', exact: true });
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer'); await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
  assert.equal((await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/finish-gateway`)).status(), 200);
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); await expect(notice).toHaveCount(0);
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true }); assert.equal((await response.innerText()).includes('authUrl'), false);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('account authentication updates references and cancels its owned sign-in through the production worker', { timeout: 90000 }, async function () {
  await prepare(this); await pair(this);
  await expect(article(this.page).getByText('Connected', { exact: true })).toBeVisible();
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(this.page);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const result = await this.page.evaluate(async () => (await import('/vault-policy-fixture.js')).privateNativeAccountAuthentication());
  assert.equal(result.current.id, result.original.id); assert.equal(result.current.revision, result.original.revision + 2);
  assert.equal(result.signedIn, 'apiKey'); assert.equal(result.signedOut, 'none'); assert.equal(result.cancelled, 'canceled'); assert.equal(result.failure, 'CANCELLED');
  const messages = await this.page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => ['executeNativeRuntime', 'cancelNativeAccountLogin'].includes(message.method)));
  assert.equal(messages.filter(message => message.method === 'executeNativeRuntime').length, 3);
  assert.equal(messages.filter(message => message.method === 'cancelNativeAccountLogin').length, 1);
  assert.equal(JSON.stringify(messages).includes('browser-APIKEY-canary-9182'), false);
  assert.equal(JSON.stringify(messages).includes('browser-BEARER-canary-9182'), false);
  const seen = await observations(this); assert.equal(seen.methods.filter(method => method === 'account/logout').length, 1); assert.ok(!seen.methods.some(method => ['thread/start', 'turn/start'].includes(method)));
});

Then('the account workflow form shows a transient device code and waits for confirmation', { timeout: 90000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page).getByText('Connected', { exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const method = 'account/login/start', document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
  const saved = { version: 3, id: 'native-account-device-browser', name: 'Account sign-in', ...createOperationGraph(operation, { x: 0, y: 0 }, 'auth', document), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Account sign-in', exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  const notice = run.getByRole('region', { name: 'Account sign-in', exact: true }); await expect(notice).toContainText('ABCD-EFGH');
  await expect(notice.getByRole('link', { name: 'Open account sign-in', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(notice.getByRole('link', { name: 'Open account sign-in', exact: true })).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toHaveCount(0);
  assert.equal((await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/finish-login`)).status(), 200);
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); await expect(notice).toHaveCount(0);
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true }); await expect(response).toContainText('chatgpt');
  assert.equal((await response.innerText()).includes('ABCD-EFGH'), false); assert.equal((await response.innerText()).includes('verificationUrl'), false);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('an approved content workflow preserves attachment goal and history contracts through the production worker', { timeout: 150000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page)).toContainText('Account not required by this runtime');
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const methods = ['thread/start', 'thread/goal/set', 'thread/attachment/add', 'thread/attachment/remove', 'thread/inject_items', 'thread/shellCommand', 'thread/revert', 'thread/goal/clear'];
  const graphs = methods.map((method, i) => { const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: i * 600, y: 0 }, 'content-' + i, document); });
  const port = (graph, path) => {
    for (const node of graph.nodes.filter(n => n.type === 'data')) for (const field of node.data.fields)
      if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node: node.id, field: field.id };
    assert.fail('Missing content workflow port: ' + path);
  };
  const from = port(graphs[0], '/result/thread/id'), mappings = graphs.slice(1).map((graph, i) => { const to = port(graph, '/threadId');
    return { id: 'content-thread-' + i, kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field }; });
  const completed = port(graphs[5], '/result/completion/params/turn/id'), cutoff = port(graphs[6], '/beforeTurnId');
  mappings.push({ id: 'content-revert-cutoff', kind: 'mapping', source: completed.node, sourceHandle: completed.field, target: cutoff.node, targetHandle: cutoff.field });
  const name = 'Approved content workflow', saved = { version: 3, id: 'native-content-browser', name, nodes: graphs.flatMap(g => g.nodes),
    edges: [...graphs.flatMap(g => g.edges), ...mappings], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const include = async label => { const omit = run.getByRole('checkbox', { name: 'Do not send ' + label, exact: true }); if (await omit.count() && await omit.isChecked()) await omit.uncheck(); };
  const choice = async (label, value) => { await include(label); await run.getByLabel(label, { exact: true }).fill(value); };
  let threadId;
  // The cutoff dependency makes revert ready after the already queued goal clear.
  const order = [0, 1, 2, 3, 4, 5, 7, 6];
  for (let step = 0; step < order.length; step++) {
    const i = order[step], method = methods[i];
    if (i) {
      await run.getByRole('button', { name: 'Next operation', exact: true }).click();
      const input = run.getByLabel(method === 'thread/shellCommand' ? 'Thread ID' : 'Owned thread ID', { exact: true });
      await expect(input).not.toHaveValue(''); await expect(input).toBeDisabled();
      if (threadId) await expect(input).toHaveValue(threadId); else threadId = await input.inputValue();
    }
    if (method === 'thread/goal/set') {
      await include('Goal objective'); await run.getByLabel('Goal objective', { exact: true }).fill('Owned paused browser content goal');
      await choice('Goal status', 'paused'); await choice('Goal provenance', 'user');
    }
    if (method === 'thread/attachment/add' || method === 'thread/attachment/remove') {
      await run.getByLabel('Attachment type', { exact: true }).fill('owned-browser-content'); await run.getByLabel('Identity key', { exact: true }).fill('item');
      if (method === 'thread/attachment/add') await run.getByLabel('Attachment payload', { exact: true }).fill('{"nested":[null,false,7,"OWNED_BROWSER_PAYLOAD"]}');
    }
    if (method === 'thread/inject_items') await run.getByLabel('History items', { exact: true }).fill('[{"type":"message","role":"user","content":[{"type":"input_text","text":"OWNED_BROWSER_CONTENT_HISTORY"}]}]');
    if (method === 'thread/shellCommand') await run.getByLabel('Shell command', { exact: true }).fill('printf OWNED_BROWSER_CONTENT_TURN');
    if (method === 'thread/revert') { await expect(run.getByLabel('First removed turn ID', { exact: true })).not.toHaveValue(''); await expect(run.getByLabel('First removed turn ID', { exact: true })).toBeDisabled(); }
    if (method === 'thread/goal/clear') await choice('Goal provenance', 'user');
    await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await run.getByRole('button', { name: i ? 'Run operation' : 'Start workflow', exact: true }).click();
    if (method === 'thread/shellCommand') await run.getByRole('region', { name: 'Thread shell approval', exact: true }).getByRole('button', { name: 'Run once without sandbox', exact: true }).click();
    try { await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); }
    catch (error) { error.message += '\nContent step ' + method + '\nHost: ' + JSON.stringify(await observations(this)); throw error; }
    const result = run.getByRole('region', { name: `Step ${step + 1} response`, exact: true });
    if (method === 'thread/attachment/add') await expect(result).toContainText('OWNED_BROWSER_PAYLOAD');
    if (method === 'thread/revert') await expect(result).toContainText(threadId);
    if (method === 'thread/goal/clear') await expect(result).toContainText('true');
  }
  const messages = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeRuntime'));
  assert.deepEqual(messages.map(message => message.args[2].operation.rpc.method), order.map(i => methods[i])); assert.ok(messages.slice(1).every(message => message.args[3].threadId === threadId));
  assert.equal(JSON.stringify(messages).includes(this.native.pairingKey), false);
  const seen = await observations(this); assert.ok(!seen.methods.includes('turn/start')); assert.ok(seen.providerRequests.every(path => path === '/v1/models'));
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await repository(page, 'remove', [saved.id]); assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('an approved lifecycle workflow resumes and forks its owned thread through the production worker', { timeout: 90000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page)).toContainText('Account not required by this runtime');
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const methods = ['thread/start', 'thread/archive', 'thread/unarchive', 'thread/resume', 'thread/fork'];
  const graphs = methods.map((method, i) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: i * 600, y: 0 }, 'lifecycle-' + i, document);
  });
  const port = (graph, path) => {
    for (const node of graph.nodes.filter(n => n.type === 'data')) for (const field of node.data.fields)
      if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node: node.id, field: field.id };
    assert.fail('Missing lifecycle workflow port: ' + path);
  };
  const from = port(graphs[0], '/result/thread/id'), name = 'Approved lifecycle workflow';
  const mappings = graphs.slice(1).map((graph, i) => { const to = port(graph, '/threadId'); return {
    id: 'lifecycle-thread-' + i, kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field }; });
  const saved = { version: 3, id: 'native-lifecycle-browser', name, nodes: graphs.flatMap(g => g.nodes),
    edges: [...graphs.flatMap(g => g.edges), ...mappings], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  let threadId;
  for (let i = 0; i < methods.length; i++) {
    if (i) {
      await run.getByRole('button', { name: 'Next operation', exact: true }).click();
      const input = run.getByLabel(i === 3 ? 'Thread ID' : 'Owned thread ID', { exact: true });
      await expect(input).not.toHaveValue(''); await expect(input).toBeDisabled();
      if (threadId) await expect(input).toHaveValue(threadId); else threadId = await input.inputValue();
    }
    await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await run.getByRole('button', { name: i ? 'Run operation' : 'Start workflow', exact: true }).click();
    try { await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); }
    catch (error) { error.message += '\nLifecycle step ' + methods[i] + '\nHost: ' + JSON.stringify(await observations(this)); throw error; }
  }
  const result = run.getByRole('region', { name: 'Step 5 response', exact: true }); await expect(result).toContainText('forkedFromId'); await expect(result).toContainText(threadId);
  const messages = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeRuntime'));
  assert.deepEqual(messages.map(message => message.args[2].operation.rpc.method), methods);
  assert.ok(messages.slice(1).every(message => message.args[3].threadId === threadId));
  assert.equal(JSON.stringify(messages).includes(this.native.pairingKey), false);
  const seen = await observations(this); assert.ok(!seen.methods.includes('turn/start')); assert.ok(seen.providerRequests.every(path => path === '/v1/models'));
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await repository(page, 'remove', [saved.id]); assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

Then('a native thread shell workflow preserves its {string} decision in the production browser', { timeout: 90000 }, async function (decision) {
  this.nativeShellHold = decision === 'cancel'; const page = this.page;
  await prepare(this); await pair(this); await expect(article(page)).toContainText('Account not required by this runtime');
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Update workflow approval', exact: true })).toBeVisible();
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const graphs = ['thread/start', 'thread/shellCommand'].map((method, i) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: i * 600, y: 0 }, i ? 'shell' : 'thread', document);
  });
  const port = (graph, path) => {
    for (const node of graph.nodes.filter(n => n.type === 'data')) for (const field of node.data.fields)
      if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node: node.id, field: field.id };
    assert.fail('Missing native shell workflow port: ' + path);
  };
  const from = port(graphs[0], '/result/thread/id'), to = port(graphs[1], '/threadId'), name = 'Approved shell workflow';
  const saved = { version: 3, id: 'native-shell-browser', name, nodes: graphs.flatMap(g => g.nodes), edges: [...graphs.flatMap(g => g.edges),
    { id: 'owned-shell-thread', kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field }],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => { await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click(); };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByLabel('Thread ID', { exact: true })).not.toHaveValue(''); await expect(run.getByLabel('Thread ID', { exact: true })).toBeDisabled();
  await run.getByLabel('Shell command', { exact: true }).fill(decision === 'cancel' ? 'sleep 60' : 'printf BROWSER_SHELL_OUTPUT; exit 17');
  await select(); await run.getByRole('button', { name: 'Run operation', exact: true }).click();
  const approval = run.getByRole('region', { name: 'Thread shell approval', exact: true }); await expect(approval).toBeVisible();
  await expect(approval).toContainText('without a sandbox'); await expect(approval).toContainText('filesystem and network access');
  assert.equal((await observations(this)).methods.filter(m => m === 'thread/shellCommand').length, 0);
  await approval.getByRole('button', { name: decision === 'decline' ? 'Decline' : 'Run once without sandbox', exact: true }).click();
  if (decision === 'accept') {
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    const response = run.getByRole('region', { name: 'Step 2 response', exact: true });
    await expect(response).toContainText('aggregatedOutput'); await expect(response).toContainText('BROWSER_SHELL_OUTPUT'); await expect(response).toContainText('17');
  } else {
    if (decision === 'cancel') {
      await expect.poll(async () => (await observations(this)).methods.filter(m => m === 'thread/shellCommand').length).toBe(1);
      await run.getByRole('button', { name: 'Cancel request', exact: true }).click();
    }
    await expect(run.getByRole('alert')).toContainText(/cancelled/i);
    await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  }
  const seen = await observations(this); assert.equal(seen.methods.filter(m => m === 'thread/shellCommand').length, decision === 'decline' ? 0 : 1);
  if (decision === 'cancel') assert.equal(seen.methods.filter(m => m === 'turn/interrupt').length, 1);
  if (this.nativeReal) assert.deepEqual(seen.providerRequests, []);
  assert.equal((await page.locator('body').innerText()).includes(this.native.pairingKey), false);
});
async function enabled(world) {
  await prepare(world); await pair(world);
  await expect(article(world.page).getByText('Connected', { exact: true })).toBeVisible();
  await article(world.page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(world.page).getByRole('button', { name: 'Sign in to Codex', exact: true })).toBeVisible();
}
async function fixture(workMethods = ['turn/start']) {
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const graphs = ['thread/start', ...workMethods].map((method, index) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: index * 500, y: 0 }, index ? index === 1 ? 'turn' : 'work' + index : 'thread', document);
  });
  const doc = { version: 3, id: 'native-browser-workflow', name: 'Native browser workflow', nodes: graphs.flatMap(value => value.nodes), edges: graphs.flatMap(value => value.edges),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const find = (owner, path) => {
    for (const node of doc.nodes.filter(node => node.type === 'data' && node.data.ownerId === owner))
      for (const field of node.data.fields) if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node, field };
    throw new Error('Missing native test port.');
  };
  const output = find('thread', '/result/thread/id');
  for (let index = 1; index < graphs.length; index++) {
    const input = find(index === 1 ? 'turn' : 'work' + index, '/threadId');
    doc.edges.push({ id: 'native-thread-mapping-' + index, kind: 'mapping', source: output.node.id, sourceHandle: output.field.id, target: input.node.id, targetHandle: input.field.id });
  }
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

Then('native MCP tools preserve their owned thread and JSON through the production workflow worker', { timeout: 90_000 }, async function () {
  const page = this.page; await prepare(this); await pair(this);
  await expect(article(page)).toContainText('Account not required by this runtime');
  await article(page).getByRole('button', { name: 'Enable workflows', exact: true }).click();
  await expect(article(page).getByRole('button', { name: 'Sign in to Codex', exact: true })).toHaveCount(0);
  await article(page).getByRole('button', { name: 'Update workflow approval', exact: true }).click();
  await expect(pane(page)).toContainText('Workflow approval updated.');
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const graphs = ['thread/start', 'mcpServer/tool/call', 'mcpServer/tool/call'].map((method, index) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: index * 500, y: 0 }, 'mcp-browser-' + index, document);
  });
  const find = (graph, path) => {
    for (const node of graph.nodes.filter(node => node.type === 'data')) for (const field of node.data.fields)
      if (JSON.parse(decodeURIComponent(field.id))[1] === path) return { node, field };
    throw new Error('Missing mapped MCP workflow field: ' + path);
  };
  const output = find(graphs[0], '/result/thread/id'), mappings = [1, 2].map(index => {
    const input = find(graphs[index], '/threadId');
    return { id: 'mcp-thread-' + index, kind: 'mapping', source: output.node.id, sourceHandle: output.field.id, target: input.node.id, targetHandle: input.field.id };
  });
  const saved = { version: 3, id: 'native-mcp-tool-browser', name: 'Native MCP tools', nodes: graphs.flatMap(graph => graph.nodes),
    edges: [...graphs.flatMap(graph => graph.edges), ...mappings], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Native MCP tools', exact: true }); let threadId;
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  for (let index = 0; index < 3; index++) {
    if (index) {
      await run.getByRole('button', { name: 'Next operation', exact: true }).click();
      const id = run.getByLabel('Thread ID', { exact: true }); await expect(id).not.toHaveValue(''); await expect(id).toBeDisabled();
      if (threadId) await expect(id).toHaveValue(threadId); else threadId = await id.inputValue();
      await run.getByLabel('Server name', { exact: true }).fill('operations_fixture');
      await run.getByLabel('Tool name', { exact: true }).fill('display_only');
      await run.getByRole('checkbox', { name: 'Do not send Tool arguments', exact: true }).uncheck();
      await run.getByLabel('Tool arguments', { exact: true }).fill(JSON.stringify({ message: 'Browser call ' + index }));
      await run.getByRole('checkbox', { name: 'Do not send Tool metadata', exact: true }).uncheck();
      await run.getByLabel('Tool metadata', { exact: true }).fill('{"threadId":"foreign-override","fixture":true}');
    }
    await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await run.getByRole('button', { name: index ? 'Run operation' : 'Start workflow', exact: true }).click();
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    if (index) {
      const response = run.getByRole('region', { name: `Step ${index + 1} response`, exact: true });
      await expect(response).toContainText('Owned MCP tool: Browser call ' + index); await expect(response).toContainText(threadId);
      await expect(response).not.toContainText('foreign-override');
    }
  }
  const messages = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeRuntime'));
  assert.deepEqual(messages.map(message => message.args[2].operation.rpc.method), ['thread/start', 'mcpServer/tool/call', 'mcpServer/tool/call']);
  assert.ok(messages.slice(1).every(message => message.args[3].threadId === threadId));
  assert.equal(JSON.stringify(messages).includes(this.native.pairingKey), false);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await repository(page, 'remove', [saved.id]); assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const observed = await observations(this); assert.equal(observed.methods.filter(method => method === 'mcpServer/tool/call').length, 2);
  assert.equal(observed.methods.includes('account/login/start'), false); assert.equal(observed.methods.includes('turn/start'), false);
  assert.equal((observed.providerRequests ?? []).some(request => /responses/.test(request.path)), false);
});
