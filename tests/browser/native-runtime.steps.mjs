// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { setMode, workflowAction } from './workspace.fixture.mjs';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { repository } from './workflow-storage.fixture.mjs';
import { scopeNativeRpcSchema, nativeRpcOperation } from '../../src/lib/native-rpc.ts';
import { createOperationGraph } from '../../src/lib/workflow-graph.ts';
import { nativeFilesystemBytes } from '../native-query.fixture.mjs';

const settings = page => page.getByRole('region', { name: 'Secrets vault', exact: true });
const pane = page => page.getByRole('region', { name: 'Native runtimes', exact: true });
export const observations = async world => (await world.context.request.get(`${world.baseURL}/native-companion-fixture/${world.nativeId}/observations`)).json();
Before({ tags: '@native-runtime-ui' }, async function ({ pickle }) {
  this.nativeReal = pickle.tags.some(tag => tag.name === '@native-real-runtime') || process.env.OPERATIONS_CODEX_REAL_RUNTIME === '1';
  this.nativeAgent = pickle.tags.some(tag => tag.name === '@native-agent-profile' || tag.name === '@native-agent-ui');
  this.nativeMetadata = pickle.tags.some(tag => tag.name === '@native-metadata-ui');
  this.nativeApps = pickle.tags.some(tag => tag.name === '@native-apps-ui');
  this.nativeFilesystemRead = pickle.tags.some(tag => tag.name === '@native-fs-read-ui');
  this.nativeFilesystemWrite = pickle.tags.some(tag => tag.name === '@native-fs-write-ui');
  this.nativeFilesystemWatch = pickle.tags.some(tag => tag.name === '@native-fs-watch-ui');
  this.nativeMcpTools = pickle.tags.some(tag => tag.name === '@native-mcp-tools-ui');
  this.nativeCommands = pickle.tags.some(tag => tag.name === '@native-command-ui');
  this.nativeThreadShell = pickle.tags.some(tag => tag.name === '@native-thread-shell-ui');
  this.nativeTurnControls = pickle.tags.some(tag => tag.name === '@native-turn-control-ui');
  this.nativeTurnWork = pickle.tags.some(tag => tag.name === '@native-turn-work-ui');
  this.nativeGuardian = pickle.tags.some(tag => tag.name === '@native-guardian-ui');
  this.nativeConfigurationControl = pickle.tags.some(tag => tag.name === '@native-configuration-control-ui');
  this.nativeAccountAuth = pickle.tags.some(tag => tag.name === '@native-account-auth-ui');
  this.nativeGatewayOAuth = pickle.tags.some(tag => tag.name === '@native-gateway-oauth-ui');
  this.nativeAccountActions = pickle.tags.some(tag => tag.name === '@native-account-actions-ui');
  if (pickle.tags.some(tag => tag.name === '@native-gateway-peer-ui')) this.nativeReal = false;
  if (pickle.tags.some(tag => tag.name === '@native-auth-device-peer')) this.nativeReal = false;
  this.nativeAccountRead = pickle.tags.some(tag => tag.name === '@native-account-read-ui');
  this.nativeWindowsReadiness = pickle.tags.some(tag => tag.name === '@native-windows-readiness-ui');
  this.nativePluginSharing = pickle.tags.some(tag => tag.name === '@native-plugin-sharing-ui');
  this.nativePluginManagement = pickle.tags.some(tag => tag.name === '@native-plugin-management-ui');
  this.nativeMarketplaces = pickle.tags.some(tag => tag.name === '@native-marketplaces-ui');
  this.nativePluginsRead = pickle.tags.some(tag => tag.name === '@native-plugins-read-ui');
  this.nativeConfigurationRead = pickle.tags.some(tag => tag.name === '@native-configuration-read-ui');
  this.nativeConfigurationWrite = pickle.tags.some(tag => tag.name === '@native-configuration-write-ui');
  this.nativeMigration = pickle.tags.some(tag => tag.name === '@native-migration-ui');
  this.nativeThreadContent = pickle.tags.some(tag => tag.name === '@native-thread-content-ui');
  this.nativeThreadLifecycle = pickle.tags.some(tag => tag.name === '@native-thread-lifecycle-ui');
  this.nativeStoredThreadRead = pickle.tags.some(tag => tag.name === '@native-stored-thread-read-ui');
  this.nativeMcpOAuth = pickle.tags.some(tag => tag.name === '@native-mcp-oauth-ui');
  this.nativeMcpRead = pickle.tags.some(tag => tag.name === '@native-mcp-read-ui');
  this.nativeSections = pickle.tags.some(tag => tag.name === '@native-sections-ui');
  this.nativeFeedback = pickle.tags.some(tag => tag.name === '@native-feedback-ui');
  this.nativeFeedbackDisabled = pickle.tags.some(tag => tag.name === '@native-feedback-disabled');
  // This named synthetic-delivery scenario never sends a real report, including
  // when its enclosing feature is exercised with the real-runtime override.
  if (this.nativeFeedback && !this.nativeFeedbackDisabled) this.nativeReal = false;
  // Interception bypasses native CORS preflight. These cases use only the
  // application and an owned loopback TLS endpoint; unexpected access still fails.
  await this.context.unrouteAll({ behavior: 'wait' });
  this.context.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      this.diagnostics.push({ type: 'unexpected-network-request', url: request.url(), method: request.method() });
  });
});
After({ tags: '@native-runtime-ui' }, async function () {
  if (this.nativeId) await this.context.request.delete(`${this.baseURL}/native-companion-fixture/${this.nativeId}/close`);
});
export async function prepare(world, wrongOrigin = false) {
  world.nativeId = randomUUID();
  const response = await world.context.request.post(`${world.baseURL}/native-companion-fixture/${world.nativeId}/create`, { data: { real: world.nativeReal, wrongOrigin, agent: world.nativeAgent === true, metadata: world.nativeMetadata === true, apps: world.nativeApps === true, feedback: world.nativeFeedback === true, denyFeedback: world.nativeFeedbackDisabled === true, filesystemRead: world.nativeFilesystemRead === true, filesystemWrite: world.nativeFilesystemWrite === true, filesystemWatch: world.nativeFilesystemWatch === true, sectionsRead: world.nativeSections === true, sectionsWrite: world.nativeSections === true, commands: world.nativeCommands === true, threadShell: world.nativeThreadShell === true, turnControls: world.nativeTurnControls === true, turnWork: world.nativeTurnWork === true, guardian: world.nativeGuardian === true, accountAuth: world.nativeAccountAuth === true, gatewayOAuth: world.nativeGatewayOAuth === true, accountActions: world.nativeAccountActions === true, accountRead: world.nativeAccountRead === true, marketplaces: world.nativeMarketplaces === true, pluginManagement: world.nativePluginManagement === true, pluginSharing: world.nativePluginSharing === true, windowsReadiness: world.nativeWindowsReadiness === true, pluginsRead: world.nativePluginsRead === true, configurationRead: world.nativeConfigurationRead === true, configurationControl: world.nativeConfigurationControl === true, configurationWrite: world.nativeConfigurationWrite === true, threadsRead: world.nativeStoredThreadRead === true, threadsWrite: world.nativeThreadLifecycle === true || world.nativeThreadContent === true, lifecycleMethod: world.lifecycleMethod, migration: world.nativeMigration === true, holdShell: world.nativeShellHold === true, mcpOAuth: world.nativeMcpOAuth === true, mcpRead: world.nativeMcpRead === true, mcpTools: world.nativeMcpTools === true } });
  assert.equal(response.status(), 200); world.native = await response.json();
  const page = world.page;
  await settings(page).getByLabel('Credential label', { exact: true }).fill('Native pairing key');
  await settings(page).getByLabel('Credential value', { exact: true }).fill(world.native.pairingKey);
  await settings(page).getByRole('button', { name: 'Save credential', exact: true }).click();
  await expect(settings(page).locator('li').filter({ hasText: 'Native pairing key' })).toHaveCount(1);
  await observeNativeWorker(page);
}
export async function observeNativeWorker(page) {
  await page.evaluate(() => {
    globalThis.nativePairMessages = [];
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (typeof message?.method === 'string' && /(?:NativeRuntime|executeNativeAccount|executeNativeInitialize|executeNativeQuery|executeNativeFeedback|executeNativeWatch|executeNativeUnwatch|executeNativeMcpOAuth|cancelNativeAccountLogin|cancelNativeGatewayLogin|controlNativeTurn)$/.test(message.method)) globalThis.nativePairMessages.push(structuredClone(message));
      return original.call(this, message, ...args);
    };
  });
}
export async function pair(world) {
  const page = world.page;
  await pane(page).getByLabel('Companion URL', { exact: true }).fill(world.native.host);
  await pane(page).getByRole('combobox', { name: 'Pairing key', exact: true }).click();
  await page.getByRole('option', { name: 'Native pairing key', exact: true }).click();
  await pane(page).getByRole('button', { name: 'Pair runtime', exact: true }).click();
}
async function connected(world) {
  const article = pane(world.page).getByRole('article', { name: 'Runtime Codex', exact: true });
  await expect(article.getByText('Connected', { exact: true })).toBeVisible();
  await expect(article).toContainText(world.nativeAccountRead || (world.nativeMarketplaces || world.nativePluginManagement || world.nativePluginSharing || world.nativePluginsRead) && world.nativeReal ? 'ChatGPT account' : (world.nativeStoredThreadRead || world.nativeThreadLifecycle) && world.nativeReal ? 'Account not required by this runtime' : 'No account connected');
  const result = await observations(world);
  assert.deepEqual(result.methods.slice(0, 3), ['initialize', 'initialized', 'account/read']);
  assert.ok(result.requests.some(request => request.method === 'OPTIONS' && /authorization/i.test(request.requestedHeaders)));
  assert.ok(result.requests.some(request => request.method === 'POST' && request.authorization && request.origin === world.baseURL && !request.cookie));
  assert.ok(result.sockets.every(socket => socket.origin === world.baseURL && socket.protocol === undefined && !socket.path.includes('?')));
  assert.ok(!JSON.stringify(result).includes(world.native.pairingKey));
  assert.ok(!(await world.page.locator('body').innerText()).includes(world.native.pairingKey));
  const messages = await world.page.evaluate(() => globalThis.nativePairMessages ?? []);
  assert.ok(messages.some(message => message.method === 'pairNativeRuntime'));
  assert.ok(!JSON.stringify(messages).includes(world.native.pairingKey));
  return article;
}
function expectedRejection(world) {
  world.diagnostics = world.diagnostics.filter(item => !(item.type === 'console-error'
    && (/CORS|certificate|Failed to fetch|Failed to load resource|net::ERR_/.test(item.message))
    && (!item.location?.url || item.location.url.startsWith(world.native.host) || /CORS|certificate/.test(item.message))));
}

Then('private command controls cross the production worker with owned approval and cancellation', { timeout: 90000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  const invoke = method => this.page.evaluate(async method => (await import('/vault-policy-fixture.js'))[method](), method);
  await invoke('startPrivateNativeCommands');
  try { await expect.poll(async () => (await invoke('privateNativeCommandState')).map(job => job.notices.length)).toEqual([1, 1]); }
  catch (error) { error.message += '\nCommands: ' + JSON.stringify(await invoke('privateNativeCommandState')) + '\nHost: ' + JSON.stringify(await observations(this)); throw error; }
  assert.equal((await observations(this)).methods.filter(method => method === 'command/exec').length, 0);
  await invoke('approvePrivateNativeCommands');
  await expect.poll(async () => (await invoke('privateNativeCommandState')).map(job => job.values[0]?.stage)).toEqual(['dispatched', 'dispatched']);
  assert.deepEqual((await invoke('writePrivateNativeCommand')).response.result, {});
  await expect.poll(async () => (await invoke('privateNativeCommandState'))[1].values.some(value => value.stage === 'output')).toBe(true);
  assert.deepEqual(await invoke('cancelPrivateNativeCommand'), { error: 'CANCELLED' });
  const before = (await invoke('privateNativeCommandState'))[1].values.length;
  await invoke('writePrivateNativeCommand');
  await expect.poll(async () => (await invoke('privateNativeCommandState'))[1].values.length).toBeGreaterThan(before);
  const done = await invoke('stopPrivateNativeCommands'); assert.deepEqual(done.control.response.result, {}); assert.ok(Number.isInteger(done.terminal.response.result.exitCode));
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const seen = await observations(this); assert.equal(seen.methods.filter(method => method === 'command/exec').length, 2); assert.equal(seen.methods.filter(method => method === 'command/exec/terminate').length, 2);
  assert.equal(JSON.stringify(await invoke('privateNativeCommandState')).includes(this.native.pairingKey), false);
});

Then('native watch controls cross the production worker and client without blocking unwatch', async function () {
  await prepare(this); await pair(this); await connected(this);
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  const invoke = (method) => this.page.evaluate(async method => (await import('/vault-policy-fixture.js'))[method](), method);
  await invoke('startPrivateNativeWatches');
  try { await expect.poll(async () => (await invoke('privateNativeWatchState')).map(job => job.values.length)).toEqual([1, 1]); }
  catch (error) { error.message += '\nWatch state: ' + JSON.stringify(await invoke('privateNativeWatchState')) + '\nHost: ' + JSON.stringify(await observations(this)); throw error; }
  assert.deepEqual(await invoke('privateNativeWatchMetadata'), ['Codex']);
  const touch = () => this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/touch-watch`);
  assert.equal((await touch()).status(), 200);
  await expect.poll(async () => (await invoke('privateNativeWatchState')).every(job => job.values.some(value => value.notification?.method === 'fs/changed'))).toBe(true);
  assert.deepEqual(await invoke('cancelPrivateNativeWatch'), { error: 'CANCELLED' });
  const before = await invoke('privateNativeWatchState');
  assert.equal((await touch()).status(), 200);
  await expect.poll(async () => (await invoke('privateNativeWatchState'))[1].values.length).toBeGreaterThan(before[1].values.length);
  const after = await invoke('privateNativeWatchState'); assert.equal(after[0].values.length, before[0].values.length);
  assert.deepEqual(await invoke('privateNativeWatchMetadata'), ['Codex']);
  const done = await invoke('stopPrivateNativeWatch'); assert.deepEqual(done.response.response, { protocol: 'json-rpc', result: {} });
  assert.equal(done.watch.response.protocol, 'json-rpc'); assert.equal('status' in done.watch.response, false);
  assert.equal(done.watch.response.notification.params.watchId, 'browser-second');
  await expect.poll(async () => { const result = await observations(this); return result.starts - result.stops; }).toBe(0);
  const result = await observations(this);
  assert.equal(result.methods.filter(method => method === 'fs/watch').length, 2);
  assert.equal(result.methods.filter(method => method === 'fs/unwatch').length, 2);
  assert.ok(!JSON.stringify(after).includes(this.native.pairingKey));
});

Then('a native command workflow preserves its {string} lifecycle in the production browser', { timeout: 90000 }, async function (ending) {
  await prepare(this); await pair(this); await connected(this);
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const ids = ['exec', 'resize', 'write', 'terminate'];
  const graphs = ['command/exec', 'command/exec/resize', 'command/exec/write', 'command/exec/terminate'].map((method, i) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: i * 600, y: 0 }, ids[i], document);
  });
  const port = (graph, group, path) => {
    for (const node of graph.nodes.filter(node => node.type === 'data')) {
      const field = node.data.fields.find(field => { const id = JSON.parse(decodeURIComponent(field.id)); return id[0] === group && id[1] === path; });
      if (field) return { node: node.id, field: field.id };
    }
    assert.fail('Missing command lifecycle port: ' + group + ' ' + path);
  };
  const from = port(graphs[0], 'rpc:dispatched', '/dispatched/processId');
  const mappings = graphs.slice(1).map((graph, i) => { const to = port(graph, 'input:params', '/processId');
    return { id: 'owned-process-' + i, kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field };
  });
  const name = 'Native command lifecycle', saved = { version: 3, id: 'native-command-browser', name,
    nodes: graphs.flatMap(graph => graph.nodes), edges: [...graphs.flatMap(graph => graph.edges), ...mappings],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const page = this.page; await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  const add = async name => { await run.getByRole('checkbox', { name: 'Do not send ' + name, exact: true }).uncheck(); };
  await run.getByLabel('command', { exact: true }).fill('["/bin/cat"]');
  await add('processId'); await run.getByLabel('processId', { exact: true }).fill('browser-workflow-command');
  await add('tty'); await run.getByRole('combobox', { name: 'tty', exact: true }).click(); await page.getByRole('option', { name: 'true', exact: true }).click();
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => { await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click(); };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  const approval = run.getByRole('region', { name: 'Command approval', exact: true }); await expect(approval).toBeVisible();
  await expect(approval).toContainText('/bin/cat');
  assert.equal((await observations(this)).methods.filter(method => method === 'command/exec').length, 0);
  await approval.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Stream started.' })).toBeVisible();
  const streams = run.getByRole('region', { name: 'Workflow streams', exact: true }); await expect(streams).toContainText('running');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  await expect(run.getByLabel('processId', { exact: true })).toHaveValue('browser-workflow-command');
  if (ending === 'stop') {
    await streams.getByRole('button', { name: 'Stop stream command/exec', exact: true }).click(); await expect(streams).toContainText('stopped');
    await expect(run.getByLabel('size', { exact: true })).toBeVisible();
  } else {
    await run.getByLabel('size', { exact: true }).fill('{"cols":100,"rows":40}'); await select();
    await run.getByRole('button', { name: 'Run operation', exact: true }).click();
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    await run.getByRole('button', { name: 'Next operation', exact: true }).click();
    await add('deltaBase64'); await run.getByLabel('deltaBase64', { exact: true }).fill(Buffer.from('browser command output\n').toString('base64')); await select();
    await run.getByRole('button', { name: 'Run operation', exact: true }).click();
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); await expect(streams).toContainText('stdout');
    await run.getByRole('button', { name: 'Next operation', exact: true }).click(); await select();
    await run.getByRole('button', { name: 'Run operation', exact: true }).click(); await expect(streams).toContainText('complete');
  }
  await expect.poll(async () => { const result = await observations(this); return result.starts - result.stops; }).toBe(0);
  const seen = await observations(this); assert.equal(seen.methods.filter(method => method === 'command/exec').length, 1); assert.equal(seen.methods.filter(method => method === 'command/exec/terminate').length, 1);
});

Then('a native watch workflow preserves its {string} lifecycle in the production browser', async function (ending) {
  await prepare(this); await pair(this); await connected(this);
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const graphs = ['fs/watch', 'fs/unwatch'].map((method, index) => {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: index * 600, y: 0 }, index ? 'unwatch' : 'watch', document);
  });
  const port = (graph, group, path) => {
    for (const node of graph.nodes.filter(node => node.type === 'data')) {
      const field = node.data.fields.find(field => { const id = JSON.parse(decodeURIComponent(field.id)); return id[0] === group && id[1] === path; });
      if (field) return { node: node.id, field: field.id };
    }
    assert.fail('Missing typed native workflow port.');
  };
  const from = port(graphs[0], 'rpc:notification', '/notification/params/watchId'), to = port(graphs[1], 'input:params', '/watchId');
  const name = 'Native watch lifecycle', saved = { version: 3, id: 'native-watch-browser', name,
    nodes: graphs.flatMap(graph => graph.nodes), edges: [...graphs.flatMap(graph => graph.edges),
      { id: 'owned-watch-id', kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field }],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const page = this.page; await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  await run.getByLabel('Watch ID', { exact: true }).fill('browser-workflow-watch');
  await run.getByLabel('Workspace path', { exact: true }).fill('watched.txt');
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  const select = async () => {
    await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click();
    await page.getByRole('option', { name: 'Codex', exact: true }).click();
  };
  await select(); await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Stream started.' })).toBeVisible();
  const streams = run.getByRole('region', { name: 'Workflow streams', exact: true }); await expect(streams).toContainText('running');
  await run.getByRole('button', { name: 'Next operation', exact: true }).click();
  if (ending === 'stop') {
    await streams.getByRole('button', { name: 'Stop stream fs/watch', exact: true }).click();
    await expect(streams).toContainText('stopped'); await expect(run.getByText('Workflow complete.', { exact: true })).toBeVisible();
  } else {
    const action = ending === 'root-loss' ? 'remove-watch' : 'touch-watch';
    assert.equal((await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/${action}`)).status(), 200);
    await expect(run.getByLabel('Watch ID', { exact: true })).toHaveValue('browser-workflow-watch');
    await expect(streams).toContainText('watched.txt'); await expect(streams).toContainText('emittedAtMs');
    if (ending === 'root-loss') { await expect(streams).toContainText('error'); await expect(streams.getByRole('alert')).toBeVisible(); }
    await select(); await run.getByRole('button', { name: 'Run operation', exact: true }).click();
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    if (ending === 'unwatch') await expect(streams).toContainText('complete');
  }
  await expect.poll(async () => { const result = await observations(this); return result.starts - result.stops; }).toBe(0);
  const result = await observations(this);
  assert.equal(result.methods.filter(method => method === 'fs/watch').length, 1);
  assert.equal(result.methods.filter(method => method === 'fs/unwatch').length, 1);
  assert.ok(!(await page.locator('body').innerText()).includes(this.native.pairingKey));
  const messages = await page.evaluate(() => globalThis.nativePairMessages ?? []);
  assert.ok(messages.some(message => message.method === 'executeNativeWatch'));
  if (ending !== 'stop') assert.ok(messages.some(message => message.method === 'executeNativeUnwatch'));
  assert.ok(!JSON.stringify(messages).includes(this.native.pairingKey));
});

Then('native thread sections preserve metadata and appearance through production browser workflows', { timeout: 45_000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const methods = ['threadSection/create', 'threadSection/update', 'threadSection/update', 'threadSection/delete', 'threadSection/list'];
  const graphs = methods.map((method, index) => { const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    return createOperationGraph(operation, { x: index * 600, y: 0 }, 'section-' + index, document); });
  const port = (graph, group, path) => {
    for (const node of graph.nodes.filter(node => node.type === 'data')) {
      const field = node.data.fields.find(field => { const id = JSON.parse(decodeURIComponent(field.id)); return id[0] === group && id[1] === path; });
      if (field) return { node: node.id, field: field.id };
    }
    assert.fail('Missing section workflow port: ' + path);
  };
  const mappings = [0, 1, 2].map(index => {
    const from = port(graphs[index], 'rpc:result', '/result/section/id'), to = port(graphs[index + 1], 'input:params', '/sectionId');
    return { id: 'section-id-' + index, kind: 'mapping', source: from.node, sourceHandle: from.field, target: to.node, targetHandle: to.field };
  });
  const name = 'Native section lifecycle', saved = { version: 3, id: 'native-sections-browser', name, nodes: graphs.slice(0, 4).flatMap(graph => graph.nodes),
    edges: [...graphs.slice(0, 4).flatMap(graph => graph.edges), ...mappings],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const page = this.page; await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true }); let sectionId;
  for (let index = 0; index < 4; index++) {
    if (index) await run.getByRole('button', { name: 'Next operation', exact: true }).click();
    if (index < 3) await run.getByLabel('Section name', { exact: true }).fill(index ? 'Renamed browser section' : 'Owned browser section');
    if (index === 0) {
      await run.getByRole('checkbox', { name: 'Do not send Appearance', exact: true }).uncheck();
      await run.getByLabel('Appearance', { exact: true }).fill('{"icon":"book","color":"blue"}');
      await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
      await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
    }
    if (index > 0 && index < 4) {
      const input = run.getByLabel('Section ID', { exact: true });
      await expect(input).not.toHaveValue('');
      if (sectionId) await expect(input).toHaveValue(sectionId); else { sectionId = await input.inputValue(); assert.match(sectionId, /^[a-f0-9-]{36}$/i); }
    }
    if (index === 2) {
      await run.getByRole('checkbox', { name: 'Do not send Appearance', exact: true }).uncheck();
      await run.getByRole('checkbox', { name: 'Send Appearance as null', exact: true }).check();
    }
    await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
    await run.getByRole('button', { name: index ? 'Run operation' : 'Start workflow', exact: true }).click();
    await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
    const response = run.getByRole('region', { name: `Step ${index + 1} response`, exact: true });
    await expect(response).toContainText('Native operation completed');
    if (index < 2) await expect(response).toContainText('blue');
    if (index === 2) { await expect(response).toContainText('appearance'); await expect(response).toContainText('null'); }
  }
  const messages = await page.evaluate(() => globalThis.nativePairMessages ?? []), calls = messages.filter(message => message.method === 'executeNativeQuery');
  assert.deepEqual(calls.map(call => call.args[2].operation.rpc.method), methods.slice(0, 4));
  assert.ok(calls.filter(call => call.args[3].sectionId).every(call => call.args[3].sectionId === sectionId));
  assert.equal(Object.hasOwn(calls[1].args[3], 'appearance'), false); assert.equal(calls[2].args[3].appearance, null);
  assert.ok(!JSON.stringify(messages).includes(this.native.pairingKey));
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
  const listed = { ...saved, id: 'native-section-list-browser', name: 'List native sections', nodes: graphs[4].nodes, edges: graphs[4].edges };
  await repository(page, 'save', listed, null); await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const listing = page.getByRole('dialog', { name: 'Run workflow: List native sections', exact: true });
  await listing.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await listing.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await listing.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await listing.getByRole('button', { name: 'Start workflow', exact: true }).click();
  await expect(listing.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  const response = listing.getByRole('region', { name: 'Step 1 response', exact: true }); await expect(response).toContainText('data'); await expect(response).not.toContainText('Renamed browser section');
  const listCalls = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeQuery'));
  assert.deepEqual(listCalls.map(call => call.args[2].operation.rpc.method), ['threadSection/list']);
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
  await expect.poll(async () => { const result = await observations(this); return result.starts - result.stops; }).toBe(0);
  const result = await observations(this);
  for (const method of new Set(methods)) assert.equal(result.methods.filter(value => value === method).length, methods.filter(value => value === method).length);
});

Then('native MCP sign-in exposes a transient link and waits for completion in the production worker', { timeout: 90_000 }, async function () {
  const page = this.page; await prepare(this); await pair(this); await connected(this);
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const method = 'mcpServer/oauth/login', document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
  const saved = { version: 3, id: 'native-mcp-oauth-browser', name: 'Native MCP sign-in',
    ...createOperationGraph(operation, { x: 0, y: 0 }, 'oauth', document),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: Native MCP sign-in', exact: true });
  await run.getByLabel('Server name', { exact: true }).fill('oauth_fixture');
  await expect(run.locator('[data-requirement="native-account"]')).toHaveCount(0);
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click(); await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  const notice = run.getByRole('region', { name: 'MCP sign-in', exact: true }), link = notice.getByRole('link', { name: 'Open MCP sign-in', exact: true });
  try { await expect(link).toBeVisible(); }
  catch (error) { error.message += '\nNative fixture state: ' + JSON.stringify(await observations(this)); throw error; }
  await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer'); const authorizationUrl = await link.getAttribute('href');
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toHaveCount(0);
  const pending = await observations(this); assert.equal(pending.starts - pending.stops, 1);
  if (this.nativeReal) {
    const completion = await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/authorize-mcp`, { data: { authorizationUrl } });
    assert.equal(completion.status(), 200); assert.equal((await completion.json()).status, 200);
  } else assert.equal((await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/finish-mcp`)).status(), 200);
  await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible(); await expect(notice).toHaveCount(0);
  const response = run.getByRole('region', { name: 'Step 1 response', exact: true }); await expect(response).toContainText('success'); await expect(response).not.toContainText('authorizationUrl');
  const calls = await page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeMcpOAuth'));
  assert.equal(calls.length, 1); assert.equal(calls[0].args[2].operation.rpc.method, method); assert.equal(JSON.stringify(calls).includes(this.native.pairingKey), false);
  const stored = await repository(page, 'list'); assert.equal(JSON.stringify(stored).includes(authorizationUrl), false);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const seen = await observations(this); assert.equal(seen.methods.filter(value => value === method).length, 1); assert.equal(seen.methods.includes('account/login/start'), false);
  if (this.nativeReal) { assert.equal(seen.oauth.pkceVerified, 1); assert.deepEqual(seen.oauth.stored, { access: true, refresh: true }); }
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' }); await repository(page, 'remove', [saved.id]);
  assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
});

async function runPairedWorkflow(world, method) {
  const page = world.page; world.lifecycleMethod = method; await prepare(world); await pair(world); await connected(world);
  if (method === 'externalAgentConfig/import/readHistories') assert.equal((await world.context.request.post(`${world.baseURL}/native-companion-fixture/${world.nativeId}/seed-migration-history`)).status(), 200);
  const source = JSON.parse(gunzipSync(await readFile(new URL('../../src/catalogs/services/codex.json.gz', import.meta.url))).toString('utf8'));
  const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
  const name = method === 'account/read' ? 'Native account read' : method === 'initialize' ? 'Native initialization' : 'Native metadata ' + method;
  const saved = { version: 3, id: world.nativeWindowsReadiness ? 'native-windows-readiness' : world.nativePluginSharing ? 'native-plugin-sharing-' + method.replaceAll('/', '-') : world.nativePluginManagement ? 'native-plugin-management-' + method.replaceAll('/', '-') : world.nativeMarketplaces ? 'native-marketplace-' + method.replaceAll('/', '-') : world.nativePluginsRead ? 'native-plugin-' + method.replaceAll('/', '-') : 'native-read-browser', name,
    ...createOperationGraph(operation, { x: 0, y: 0 }, 'account', document),
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  await repository(page, 'save', saved, null); await page.reload();
  await page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(page);
  await setMode(page, 'workflow'); await workflowAction(page, 'Run');
  const run = page.getByRole('dialog', { name: 'Run workflow: ' + name, exact: true });
  if (world.nativeStoredThreadRead || world.nativeThreadLifecycle) {
    const thread = run.getByLabel('Owned thread ID', { exact: true }); if (await thread.count()) await thread.fill(world.native.storedThreadId);
    if (method === 'thread/attachmentOwner/list') {
      await run.getByLabel('Attachment type', { exact: true }).fill('qualification'); await run.getByLabel('Identity key', { exact: true }).fill('owned-item');
    }
    if (method === 'thread/read') {
      const omit = run.getByRole('checkbox', { name: 'Do not send Include turns', exact: true }); if (await omit.count() && await omit.isChecked()) await omit.uncheck();
      await run.getByRole('combobox', { name: 'Include turns', exact: true }).click(); await page.getByRole('option', { name: 'true', exact: true }).click();
    }
  }
  if (method === 'thread/name/set') await run.getByLabel('Thread name', { exact: true }).fill('Owned browser lifecycle');
  if (method === 'thread/metadata/update') await run.getByLabel('Git metadata', { exact: true }).fill('{"branch":"owned-browser-lifecycle","sha":null}');
  if (method === 'thread/section/move') await run.getByRole('checkbox', { name: 'Send Destination section ID as null', exact: true }).check();
  if (method === 'feedback/upload') {
    await run.getByLabel('Classification', { exact: true }).fill('bug');
    await run.getByRole('checkbox', { name: 'Do not send Feedback message', exact: true }).uncheck();
    await run.getByLabel('Feedback message', { exact: true }).fill('Synthetic feedback fixture.');
  }
  if (method === 'experimentalFeature/enablement/set') await run.getByLabel('Feature overrides', { exact: true }).fill('{"memories":true}');
  if (method === 'config/value/write') {
    await run.getByLabel('Setting', { exact: true }).fill('model');
    await run.getByLabel('Value (JSON)', { exact: true }).fill('"browser-owned-config-model"');
    await run.getByLabel('Merge strategy', { exact: true }).fill('replace');
  }
  if (method === 'config/batchWrite') await run.getByLabel('Edits', { exact: true }).fill('[{"keyPath":"model_verbosity","value":"low","mergeStrategy":"replace"}]');
  if (method === 'externalAgentConfig/detect') {
    const omit = run.getByRole('checkbox', { name: 'Do not send Include runtime home', exact: true });
    if (await omit.count() && await omit.isChecked()) await omit.uncheck();
    await run.getByRole('combobox', { name: 'Include runtime home', exact: true }).click(); await page.getByRole('option', { name: 'true', exact: true }).click();
  }
  if (method === 'externalAgentConfig/import') await run.getByLabel('Migration items', { exact: true }).fill(JSON.stringify(['AGENTS_MD', 'CONFIG'].map(itemType => ({ itemType, cwd: null, description: 'Browser migration ' + itemType }))));
  if (method === 'externalAgentConfig/import/recordHistory') {
    await run.getByLabel('Provider attribution', { exact: true }).fill('owned-browser-history');
    await run.getByLabel('Completed item results', { exact: true }).fill('[]');
  }
  if (world.nativeMarketplaces) {
    if (method === 'marketplace/add') await run.getByLabel('Marketplace source', { exact: true }).fill(world.native.marketplaceSource);
    else {
      const omit = run.getByRole('checkbox', { name: 'Do not send Marketplace name', exact: true });
      if (await omit.count() && await omit.isChecked()) await omit.uncheck();
      await run.getByLabel('Marketplace name', { exact: true }).fill('owned-git-market');
    }
  }
  if (world.nativePluginSharing) {
    if (method === 'plugin/share/save') await run.getByLabel('Plugin directory', { exact: true }).fill(world.native.pluginSourcePath);
    else await run.getByLabel('Remote plugin ID', { exact: true }).fill(world.native.sharedPluginId);
    if (method === 'plugin/share/updateTargets') {
      await run.getByLabel('Discoverability', { exact: true }).fill('UNLISTED');
      await run.getByLabel('Share targets', { exact: true }).fill('[{"principalType":"user","principalId":"owned-user-2","role":"editor"}]');
    }
  }
  if (world.nativePluginManagement) {
    if (method === 'plugin/install') {
      await run.getByLabel('Plugin name', { exact: true }).fill('owned-plugin');
      await run.getByRole('checkbox', { name: 'Do not send Local marketplace file', exact: true }).uncheck();
      await run.getByLabel('Local marketplace file', { exact: true }).fill(world.native.pluginMarketplacePath);
    }
    if (method === 'plugin/uninstall') await run.getByLabel('Plugin ID', { exact: true }).fill('owned-plugin@owned-market');
  }
  if (world.nativePluginsRead) {
    const optional = async (label, value) => {
      const omit = run.getByRole('checkbox', { name: 'Do not send ' + label, exact: true });
      if (await omit.count() && await omit.isChecked()) await omit.uncheck();
      await run.getByLabel(label, { exact: true }).fill(value);
    };
    if (method === 'plugin/list' || method === 'plugin/installed') await optional('Working directories', JSON.stringify([world.native.pluginWorkspace]));
    if (method === 'plugin/list') await optional('Marketplace kinds', '["local"]');
    if (method === 'plugin/installed') await optional('Suggested plugin names', '["owned-plugin"]');
    if (method === 'plugin/read') { await run.getByLabel('Plugin name', { exact: true }).fill('owned-plugin'); await optional('Local marketplace file', world.native.pluginMarketplacePath); }
    if (method === 'plugin/skill/read') {
      await run.getByLabel('Remote marketplace name', { exact: true }).fill('openai-curated-remote');
      await run.getByLabel('Remote plugin ID', { exact: true }).fill('plugins~Plugin_00000000000000000000000000000000');
      await run.getByLabel('Skill name', { exact: true }).fill('owned-skill');
    }
  }
  if (method === 'skills/config/write') {
    await run.getByRole('checkbox', { name: 'Do not send Skill name', exact: true }).uncheck();
    await run.getByLabel('Skill name', { exact: true }).fill('owned-configuration-skill');
    await run.getByRole('combobox', { name: 'Enabled', exact: true }).click(); await page.getByRole('option', { name: 'false', exact: true }).click();
  }
  if (method === 'skills/extraRoots/set') await run.getByLabel('Extra skill directories', { exact: true }).fill('["runtime-skills"]');
  if (method.startsWith('fs/') && method !== 'fs/copy') await run.getByLabel('Workspace path', { exact: true }).fill(method === 'fs/readDirectory' ? '.' : method === 'fs/writeFile' ? 'write-link.bin' : method === 'fs/createDirectory' ? 'created/nested' : method === 'fs/remove' ? 'remove-me' : 'fixture.txt');
  if (method === 'fs/writeFile') await run.getByLabel('File contents (base64)', { exact: true }).fill(nativeFilesystemBytes.toString('base64'));
  if (method === 'fs/copy') {
    await run.getByLabel('Source path', { exact: true }).fill('source-tree');
    await run.getByLabel('Destination path', { exact: true }).fill('copied-tree');
    const omit = run.getByRole('checkbox', { name: 'Do not send Recursive', exact: true });
    if (await omit.count() && await omit.isChecked()) await omit.uncheck();
    await run.getByRole('combobox', { name: 'Recursive', exact: true }).click();
    await page.getByRole('option', { name: 'true', exact: true }).click();
  }
  if (method === 'mcpServer/resource/read') {
    await run.getByLabel('Server name', { exact: true }).fill('operations_fixture');
    await run.getByLabel('Resource URI', { exact: true }).fill('operations-fixture://readme');
  }
  if (method === 'fuzzyFileSearch') await run.getByLabel('Search query', { exact: true }).fill('fixture');
  await expect(run.locator('[data-requirement="native-account"]')).toHaveCount(world.nativeAccountRead && method !== 'account/gatewayOAuth/read' ? 1 : 0);
  await run.getByLabel('Authenticate password', { exact: true }).fill('browser-VAULT-password-9182');
  await run.getByRole('button', { name: 'Unlock native runtimes', exact: true }).click();
  await run.getByRole('combobox', { name: 'Native runtime', exact: true }).click();
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await expect(run.getByRole('button', { name: 'Start workflow', exact: true })).toBeEnabled();
  await run.getByRole('button', { name: 'Start workflow', exact: true }).click();
  try {
    if (world.nativeFeedbackDisabled) await expect(run.locator('#workflow-run-error')).toContainText('Feedback delivery was not verified');
    else await expect(run.getByRole('status').filter({ hasText: 'Operation completed.' })).toBeVisible();
  }
  catch (error) { error.message += '\nNative fixture state: ' + JSON.stringify(await observations(world)); throw error; }
  if (!world.nativeFeedbackDisabled) {
    const response = run.getByRole('region', { name: 'Step 1 response', exact: true });
    const keys = world.nativeWindowsReadiness ? ['status', 'notConfigured'] : world.nativePluginSharing ? method === 'plugin/share/save' ? ['remotePluginId', world.native.sharedPluginId, 'shareUrl'] : method === 'plugin/share/updateTargets' ? ['principals', 'UNLISTED', 'owned-user-2', 'owned-account'] : method === 'plugin/share/checkout' ? ['pluginId', 'owned-plugin@codex-curated', 'pluginPath', 'marketplacePath'] : [] : world.nativePluginManagement ? method === 'plugin/install' ? ['authPolicy', 'ON_INSTALL', 'appsNeedingAuth'] : method === 'plugin/reconcile' ? ['changedPlugins', 'owned-remote@openai-curated-remote', 'hasSkills', 'failedRemotePluginIds', 'failedMaterializationRemotePluginIds'] : [] : world.nativeMarketplaces ? method === 'marketplace/upgrade' ? ['selectedMarketplaces', 'upgradedRoots', 'owned-git-market'] : ['marketplaceName', method === 'marketplace/add' ? 'owned-local-market' : 'owned-git-market'] : world.nativePluginsRead ? method === 'plugin/read' ? ['plugin', 'owned-plugin'] : method === 'plugin/skill/read' ? ['contents', 'Owned remote skill'] : method === 'plugin/share/list' ? ['data', 'owned-plugin'] : ['marketplaces', 'owned-plugin'] : world.nativeAccountRead ? method === 'account/gatewayOAuth/read' ? ['providerId', 'required'] : method === 'account/rateLimits/read' ? ['rateLimits', '42'] : method === 'account/usage/read' ? ['summary', '12345'] : ['messages', 'Owned workspace announcement'] : world.nativeThreadLifecycle ? method === 'thread/metadata/update' ? ['thread', 'owned-browser-lifecycle'] : method === 'thread/unarchive' ? ['thread', world.native.storedThreadId] : method === 'thread/unsubscribe' ? ['status'] : [] : world.nativeStoredThreadRead ? method === 'thread/read' ? ['thread', world.native.storedThreadId, 'OWNED_STORED_THREAD_HISTORY'] : method === 'thread/goal/get' ? ['goal', 'paused', 'Owned paused qualification goal'] : method === 'thread/attachment/list' ? ['data', 'payload', 'fixture'] : ['data'] : world.nativeFilesystemWrite ? [] : method === 'externalAgentConfig/detect' ? ['items', 'AGENTS_MD', 'SESSIONS', 'connectors']
      : method === 'externalAgentConfig/import' || method === 'externalAgentConfig/import/recordHistory' ? ['importId']
        : method === 'externalAgentConfig/import/readHistories' ? ['data', 'connectors', 'config_parse'] : method === 'account/read' ? ['requiresOpenaiAuth', 'account'] : method === 'initialize' ? ['codexHome', 'platformFamily', 'platformOs', 'userAgent']
      : method === 'config/value/write' || method === 'config/batchWrite' ? ['filePath', 'status', 'version'] : method === 'skills/config/write' ? ['effectiveEnabled', 'false'] : method === 'experimentalFeature/enablement/set' ? ['enablement', 'memories'] : method === 'skills/extraRoots/set' || method === 'config/mcpServer/reload' ? [] : method === 'config/read' ? ['config', 'owned-fixture-model'] : method === 'configRequirements/read' ? ['requirements'] : method === 'skills/list' ? ['data', 'owned-configuration-skill'] : method === 'mcpServer/resource/read' ? ['contents', 'Owned MCP resource fixture.', 'AAEC/w=='] : method === 'mcpServerStatus/list' ? ['data', 'operations_fixture', 'display_only'] : method === 'feedback/upload' ? ['threadId', 'promptHash'] : method === 'fs/readFile' ? ['dataBase64', nativeFilesystemBytes.toString('base64')]
        : method === 'fs/getMetadata' ? ['isFile', 'modifiedAtMs'] : method === 'fs/readDirectory' ? ['entries', 'fixture.txt'] : method === 'fuzzyFileSearch' ? ['files', 'fixture.txt']
          : method === 'modelProvider/capabilities/read' ? ['imageGeneration', 'webSearch'] : method === 'app/installed' ? ['apps'] : method === 'app/read' ? ['apps', 'missingAppIds'] : ['data'];
    for (const key of keys) await expect(response).toContainText(key);
    if (world.nativeReal && method === 'fs/readDirectory') await expect(response).toContainText('slash.txt');
    if (world.nativeReal && method === 'account/read') await expect(response).toContainText('workspaceRouting');
    assert.equal((await response.innerText()).includes('HTTP '), false);
    if (world.nativeConfigurationRead || world.nativeConfigurationWrite) assert.equal((await response.innerText()).includes('OWNED_SDK_CONFIGURATION_SECRET_7319'), false);
    if (world.nativeMigration) assert.equal((await response.innerText()).includes('OWNED_MIGRATION_PROVIDER_SECRET_2486'), false);
  }
  const seen = await observations(world); assert.equal(seen.methods.filter(method => method === 'account/read').length, method === 'account/read' ? 2 : 1);
  if (method === 'initialize') assert.equal(seen.starts, 2, 'The workflow initializes a new child instead of returning the private pairing handshake.');
  assert.ok(seen.methods.every(observed => ['initialize', 'initialized', 'account/read', method].includes(observed)));
  if (world.nativeMetadata || world.nativeApps || world.nativeFeedback || world.nativeFilesystemRead || world.nativeFilesystemWrite || world.nativeMcpRead || world.nativeMarketplaces || world.nativePluginManagement || world.nativePluginSharing || world.nativeWindowsReadiness || world.nativePluginsRead || world.nativeAccountRead || world.nativeConfigurationRead || world.nativeConfigurationControl || world.nativeConfigurationWrite || world.nativeMigration || world.nativeStoredThreadRead || world.nativeThreadLifecycle) assert.equal(seen.methods.filter(observed => observed === method).length, 1);
  if (world.nativeMarketplaces) assert.equal(seen.marketplaceEffects[method], true);
  if (world.nativePluginManagement) assert.equal(seen.pluginEffects[method], true);
  if (world.nativePluginSharing) assert.equal(seen.shareEffects[method], true);
  if (world.nativeConfigurationWrite) assert.equal(seen.configurationEffects[method], true);
  if (world.nativeMigration && ['externalAgentConfig/import', 'externalAgentConfig/import/recordHistory'].includes(method)) assert.equal(seen.migrationEffects[method], true);
  if (world.nativeFilesystemWrite) assert.equal(seen.mutationEffects[method], true, 'The owned workspace reflects the acknowledged native mutation.');
  if (world.nativeFeedbackDisabled) assert.equal(seen.responseShapes.find(shape => shape.method === 'feedback/upload')?.errorCode, -32600);
  const messages = await page.evaluate(() => globalThis.nativePairMessages ?? []);
  assert.equal(messages.filter(message => message.method === (method === 'account/read' ? 'executeNativeAccount' : method === 'initialize' ? 'executeNativeInitialize' : method === 'feedback/upload' ? 'executeNativeFeedback' : world.nativeMarketplaces || world.nativePluginManagement || world.nativePluginSharing || world.nativeWindowsReadiness || world.nativePluginsRead || world.nativeAccountRead || world.nativeConfigurationRead || world.nativeConfigurationControl || world.nativeConfigurationWrite || world.nativeMigration || world.nativeStoredThreadRead || world.nativeThreadLifecycle ? 'executeNativeRuntime' : 'executeNativeQuery')).length, 1);
  assert.equal(JSON.stringify(messages).includes(world.native.pairingKey), false);
  const stored = await page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());
  assert.equal(JSON.stringify(stored).includes(world.native.pairingKey), false);
  assert.equal((await page.locator('body').innerText()).includes(world.native.pairingKey), false);
  if (world.nativeMarketplaces || world.nativePluginManagement || world.nativePluginSharing || world.nativeWindowsReadiness || world.nativePluginsRead || world.nativeAccountRead || world.nativeMigration || world.nativeStoredThreadRead || world.nativeThreadLifecycle) {
    assert.equal(JSON.stringify(messages).includes('OWNED_MIGRATION_PROVIDER_SECRET_2486'), false);
    assert.equal(JSON.stringify(stored).includes('OWNED_MIGRATION_PROVIDER_SECRET_2486'), false);
    await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
    await repository(page, 'remove', [saved.id]); assert.equal((await repository(page, 'list')).some(workflow => workflow.id === saved.id), false);
  }
}

Then('a read only native pairing returns account state through the production workflow worker', { timeout: 90_000 }, async function () {
  await runPairedWorkflow(this, 'account/read');
});
Then('a read only native pairing initializes through the production workflow worker', { timeout: 90_000 }, async function () {
  await runPairedWorkflow(this, 'initialize');
});
Then('a read only native pairing queries {string} through the production workflow worker', { timeout: 90_000 }, async function (method) {
  await runPairedWorkflow(this, method);
});

Then('native runtime settings pair reconnect and disconnect through the production worker', { timeout: 60_000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  const stored = await this.page.evaluate(async () => (await import('/vault-storage-fixture.js')).createVaultStorage().read());
  assert.ok(!JSON.stringify(stored).includes(this.native.pairingKey));
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' });
  await setMode(this.page, 'settings');
  const disclosure = this.page.locator('summary[aria-label="Secrets"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  await settings(this.page).getByLabel('Unlock password, or recovery key', { exact: true }).fill('browser-VAULT-password-9182');
  await settings(this.page).getByRole('button', { name: 'Unlock vault', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(1);
  await pane(this.page).getByRole('button', { name: 'Reconnect runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Connected', { exact: true })).toBeVisible();
  await pane(this.page).getByRole('button', { name: 'Disconnect runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(2);
  await pane(this.page).getByRole('button', { name: 'Remove pairing', exact: true }).click();
  await expect(pane(this.page).getByRole('article')).toHaveCount(0);
  const result = await observations(this);
  assert.equal(result.real, this.nativeReal); assert.equal(result.starts, result.stops);
  assert.ok(result.methods.every(method => ['initialize', 'initialized', 'account/read'].includes(method)));
});

Then('native runtime settings reject changed authority until the pairing is explicitly replaced', { timeout: 60_000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  await this.context.request.post(`${this.baseURL}/native-companion-fixture/${this.nativeId}/change-account`);
  await pane(this.page).getByRole('button', { name: 'Check runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await pane(this.page).getByRole('button', { name: 'Reconnect runtime', exact: true }).click();
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  assert.equal((await observations(this)).starts, 1, 'Changed pins never spawn a replacement child implicitly.');
  await pane(this.page).getByRole('button', { name: 'Remove pairing', exact: true }).click();
  await expect(pane(this.page).getByRole('article')).toHaveCount(0);
  await pair(this); await connected(this);
  // A second tab can change catalog metadata before this tab receives its
  // library snapshot. Exercise the production worker's independent policy read.
  await this.page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('v1/catalogs/index');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result, transaction = database.transaction('catalog', 'readwrite'), store = transaction.objectStore('catalog');
      const reading = store.get('codex');
      reading.onsuccess = () => { if (!reading.result) { transaction.abort(); return; } store.put({ ...reading.result, enabled: false }, 'codex'); };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }));
  await pane(this.page).getByRole('button', { name: 'Check runtime', exact: true }).click();
  await expect(pane(this.page).getByText('Disconnected', { exact: true })).toBeVisible();
  await expect.poll(async () => (await observations(this)).stops).toBe(2);
});

Then('native runtime settings reject an untrusted companion certificate', async function () {
  await prepare(this); await pair(this);
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  assert.equal((await observations(this)).starts, 0);
  assert.ok(!(await observations(this)).requests.some(request => request.method === 'POST'));
  expectedRejection(this);
});

Then('native runtime settings enforce real companion CORS before sending its pairing key', async function () {
  await prepare(this, true); await pair(this);
  await expect(settings(this.page).getByRole('alert')).toBeVisible();
  const result = await observations(this);
  assert.equal(result.starts, 0); assert.ok(result.requests.some(request => request.method === 'OPTIONS'));
  assert.ok(!result.requests.some(request => request.authorization)); expectedRejection(this);
});

Then('a paired configuration control executes {string} through the production workflow worker', async function (method) { await runPairedWorkflow(this, method); });
Then('a paired configuration write executes {string} through the production workflow worker', async function (method) { await runPairedWorkflow(this, method); });
Then('a paired migration executes {string} through the production workflow worker', async function (method) { await runPairedWorkflow(this, method); });
Then('a paired stored-thread read executes {string} through the production workflow worker', { timeout: 90000 }, async function (method) { await runPairedWorkflow(this, method); });
Then('verified migrations continue with their original workflow binding without publishing private values', { timeout: 90000 }, async function () {
  await this.page.setViewportSize({ width: 412, height: 915 });
  await prepare(this); await pair(this); await connected(this);
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(this.page);
  const value = await this.page.evaluate(async () => (await import('/vault-policy-fixture.js')).privateNativeMigrationContinuation());
  assert.equal(value.current.revision, value.original.revision + 1); assert.ok(value.historyIds.includes(value.importId)); assert.ok(value.recordedId);
  const messages = await this.page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeRuntime'));
  assert.deepEqual(messages.map(message => message.args[0].revision), [0, 0, 1, 1].map(offset => offset + value.original.revision));
  assert.equal(JSON.stringify([value, messages]).includes('OWNED_MIGRATION_PROVIDER_SECRET_2486'), false);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const seen = await observations(this); for (const method of ['externalAgentConfig/detect', 'externalAgentConfig/import', 'externalAgentConfig/import/readHistories', 'externalAgentConfig/import/recordHistory']) assert.equal(seen.methods.filter(value => value === method).length, 1);
});
Then('verified configuration writes advance later workflow calls from their original binding', { timeout: 90000 }, async function () {
  await prepare(this); await pair(this); await connected(this);
  await this.page.reload(); await this.page.locator('#startup-status').waitFor({ state: 'detached' }); await observeNativeWorker(this.page);
  const value = await this.page.evaluate(async () => (await import('/vault-policy-fixture.js')).privateNativeConfigurationContinuation());
  assert.equal(value.current.id, value.original.id); assert.equal(value.current.revision, value.original.revision + 3);
  assert.deepEqual(value.control, {}); assert.equal(value.read.config.model, 'browser-owned-config-model'); assert.equal(value.read.config.model_verbosity, 'low');
  const messages = await this.page.evaluate(() => (globalThis.nativePairMessages ?? []).filter(message => message.method === 'executeNativeRuntime'));
  assert.deepEqual(messages.map(message => message.args[0].revision), [0, 1, 2, 3, 3].map(n => n + value.original.revision));
  assert.equal(JSON.stringify(messages).includes(this.native.pairingKey), false);
  assert.equal(JSON.stringify(value).includes('OWNED_SDK_CONFIGURATION_SECRET_7319'), false);
  await expect.poll(async () => { const seen = await observations(this); return seen.starts - seen.stops; }).toBe(0);
  const seen = await observations(this); assert.equal(seen.starts, 2);
  for (const method of ['config/value/write', 'config/batchWrite', 'skills/config/write', 'config/mcpServer/reload', 'config/read']) assert.equal(seen.methods.filter(m => m === method).length, 1);
  assert.ok(Object.values(seen.configurationEffects).every(Boolean));
});

Then('a paired thread lifecycle action executes {string} through the production workflow worker', { timeout: 90000 }, async function (method) { await runPairedWorkflow(this, method); });
