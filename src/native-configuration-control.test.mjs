// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeConfigurationControlFixture } from '../tests/native-configuration-control.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeConfigurationControlMethods } from './lib/native-configuration-control.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { prepareNativeConfigurationControl } from '../companions/codex/configuration-control.mjs';

Before({ tags: '@native-configuration-control' }, function () { this.controlFixtures = []; });
After({ tags: '@native-configuration-control' }, async function () { for (const c of this.controlFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeConfigurationControlFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.controlFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal);
  return c;
}
const calls = c => c.f.frames.filter(f => nativeConfigurationControlMethods.includes(f.method));
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);
Then('configuration control models roundtrip with native declarations and bounded named inputs', async function () {
  const c = await setup(this);
  for (const method of nativeConfigurationControlMethods) {
    const selected = c.select(method), graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'owner', selected.document);
    const doc = { version: 3, id: 'configuration-control', name: 'Configuration control', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.equal(selected.operation.unavailableReason, undefined);
    const responseName = { 'experimentalFeature/enablement/set': 'ExperimentalFeatureEnablementSetResponse', 'skills/extraRoots/set': 'SkillsExtraRootsSetResponse', 'config/mcpServer/reload': 'McpServerRefreshResponse' }[method];
    assert.deepEqual(selected.document['x-operations-native-workflow'].result, { $ref: '#/definitions/v2/' + responseName });
    assert.ok(selected.document.definitions.v2[responseName]);
    assert.ok(!selected.operation.capabilities.requirements.some(r => ['native-account', 'native-workspace', 'native-terminal'].includes(r.code)));
  }
  for (const [method, name, value] of [['experimentalFeature/enablement/set', 'enablement', '{"unknown":true}'], ['experimentalFeature/enablement/set', 'enablement', '{"memories":"true"}'], ['skills/extraRoots/set', 'extraRoots', '[false]']])
    assert.throws(() => prepareNativeRequest(c.select(method).operation, { ['params:' + name]: value }), e => e.fieldKey === 'params:' + name);
  assert.throws(() => prepareNativeRequest(c.select('config/mcpServer/reload').operation, { 'params:cwd': '.' }));
});
async function sharedControls(world, real) {
  const c = await setup(world, { real }), before = await readFile(join(c.f.home, 'config.toml')).catch(() => null);
  assert.equal(c.connection.accountType, 'none'); assert.equal(c.connection.workflowFingerprint, undefined);
  const features = async () => (await c.execute('experimentalFeature/list', { limit: 64 })).response.result.data;
  const skills = async () => (await c.execute('skills/list', { forceReload: true })).response.result.data.flatMap(x => x.skills);
  assert.equal((await skills()).some(x => x.name === 'owned-runtime-extra'), false);
  const prior = (await features()).find(x => x.name === 'memories'); assert.ok(prior);
  assert.deepEqual((await c.execute('experimentalFeature/enablement/set', { enablement: { memories: !prior.enabled } })).response.result, { enablement: { memories: !prior.enabled } });
  assert.equal((await features()).find(x => x.name === 'memories').enabled, !prior.enabled);
  await c.execute('skills/extraRoots/set', { extraRoots: ['runtime-skills'] });
  assert.ok((await skills()).some(x => x.name === 'owned-runtime-extra'));
  await c.execute('skills/extraRoots/set', { extraRoots: [] });
  assert.equal((await skills()).some(x => x.name === 'owned-runtime-extra'), false);
  assert.deepEqual((await c.execute('config/mcpServer/reload')).response.result, {});
  assert.deepEqual(await readFile(join(c.f.home, 'config.toml')).catch(() => null), before);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1); assert.equal(calls(c).length, 4);
  assert.equal(c.f.frames.find(f => f.method === 'config/mcpServer/reload').params, null);
  assert.ok(!c.f.frames.some(f => ['thread/start', 'turn/start', 'account/login/start', 'config/value/write'].includes(f.method)));
  await c.v.session.disconnectNativeRuntime(c.reference); await ended(c);
  // A new child must not inherit the old process's overrides or extra roots.
  assert.equal((await features()).find(x => x.name === 'memories').enabled, prior.enabled);
  assert.equal((await skills()).some(x => x.name === 'owned-runtime-extra'), false);
}
Then('configuration controls change runtime features and skill roots without writing configuration', async function () { await sharedControls(this, false); });
Then('the pinned SDK applies feature and skill overrides in the paired session', { timeout: 60000 }, async function () { await sharedControls(this, true); });
Then('configuration controls reject missing grants invalid roots and unrelated agent authority', { timeout: 60000 }, async function () {
  for (const method of nativeConfigurationControlMethods) {
    const c = await setup(this, { allowConfigurationControl: false, allowAgent: true });
    await assert.rejects(c.execute(method, method === 'experimentalFeature/enablement/set' ? { enablement: {} } : method === 'skills/extraRoots/set' ? { extraRoots: [] } : {}));
    assert.equal(calls(c).length, 0); await ended(c);
  }
  for (const root of ['../home', '/outside', 'escape']) {
    const c = await setup(this); if (root === 'escape') await symlink(c.f.home, join(c.f.workspace, root));
    await assert.rejects(c.execute('skills/extraRoots/set', { extraRoots: [root] })); assert.equal(calls(c).length, 0);
  }
  const c = await setup(this, { requiresOpenaiAuth: false, allowConfigurationRead: false }), privateHome = join(c.f.workspace, 'private-home'); await mkdir(privateHome);
  await assert.rejects(prepareNativeConfigurationControl('skills/extraRoots/set', { extraRoots: ['.'] }, c.f.workspace, privateHome));
  c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  await assert.rejects(c.execute('thread/start')); assert.ok(!c.f.frames.some(f => f.method === 'thread/start'));
  assert.deepEqual((await c.execute('config/mcpServer/reload')).response.result, {});
});
Then('configuration controls withhold mismatched results and known encoded secrets', async function () {
  for (const result of [{ enablement: { memories: false } }, { enablement: { memories: true, unreviewed: true } }]) {
    const c = await setup(this); c.f.controlResult = result;
    await assert.rejects(c.execute('experimentalFeature/enablement/set', { enablement: { memories: true } })); await ended(c);
  }
  for (const method of ['skills/extraRoots/set', 'config/mcpServer/reload']) {
    const c = await setup(this); c.f.controlResult = { private: 'OWNED_UNEXPECTED_SDK_SECRET' };
    await assert.rejects(c.execute(method, method === 'skills/extraRoots/set' ? { extraRoots: [] } : {})); await ended(c);
  }
  for (const encoding of ['plain', 'base64', 'utf16']) {
    const c = await setup(this), secret = 'owned-control-secret-' + randomUUID(); await c.v.session.put(null, { label: 'Control privacy fixture', kind: 'secret', value: secret });
    const value = encoding === 'plain' ? secret : encoding === 'base64' ? Buffer.from(secret).toString('base64') : Buffer.from(secret, 'utf16le').toString('utf8');
    await assert.rejects(c.execute('skills/extraRoots/set', { extraRoots: [value] }), e => encoding === 'utf16' ? e.field === 'extraRoots' : e.code === 'REDACTED'); assert.equal(calls(c).length, 0);
  }
});
Then('configuration controls revoke pending requests and reject overlapping SDK work', async function () {
  for (const mode of ['source', 'identity', 'lock', 'cancel']) {
    const c = await setup(this), controller = new AbortController(); c.f.holdControl = true;
    const pending = c.execute('experimentalFeature/enablement/set', { enablement: { memories: true } }, controller.signal); void pending.catch(() => {});
    await waitForWatch(() => c.f.controlReplies?.length === 1);
    if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID(); else if (mode === 'lock') c.v.session.lock(); else controller.abort();
    if (mode === 'source' || mode === 'identity') c.f.controlReplies[0]();
    await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
  }
  const c = await setup(this); await c.v.session.disconnectNativeRuntime(c.reference); await ended(c); c.f.holdControl = true;
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-workflow', fingerprint: 'd'.repeat(64) });
  assert.equal(ticket.status, 200); const socket = await c.f.socket(ticket.value.ticket); await socket.next();
  socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'control', method: 'experimentalFeature/enablement/set', params: { enablement: { memories: true } } }));
  await waitForWatch(() => c.f.controlReplies?.length === 1); const before = c.f.frames.length;
  socket.ws.send(JSON.stringify({ id: 'overlap', method: 'account/read', params: { refreshToken: false } }));
  await waitForWatch(() => socket.ws.readyState === 3); assert.equal(c.f.frames.length, before); socket.ws.terminate();
});
async function reloadOwned(world, real) {
  const c = await setup(world, { real, withMcp: true, allowAgent: true, allowMcpTools: true, requiresOpenaiAuth: false });
  c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  const threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  const tool = async message => (await c.execute('mcpServer/tool/call', { threadId, server: 'operations_fixture', tool: 'display_only', arguments: { message } })).response.result;
  assert.ok(JSON.stringify(await tool('before reload')).includes('Owned MCP tool: before reload'));
  assert.deepEqual((await c.execute('config/mcpServer/reload')).response.result, {});
  assert.ok(JSON.stringify(await tool('after reload')).includes('Owned MCP tool: after reload'));
  assert.equal(c.f.starts, 2); assert.equal(calls(c).length, 1);
  if (real) assert.ok(c.f.provider.requests.every(r => r.path.startsWith('/v1/models') && !r.hasAuthorization));
}
Then('configuration reload completes on the owned loaded thread without provider inference', async function () { await reloadOwned(this, false); });
Then('the pinned SDK reloads MCP for the owned loaded thread without inference', { timeout: 60000 }, async function () { await reloadOwned(this, true); });
