// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativePluginSdkFixture, ownedRemotePluginId } from '../tests/native-plugin-sdk.fixture.mjs';
import { nativePluginReadFixture } from '../tests/native-plugin-read.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativePluginReadMethods } from './lib/native-plugin-read.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { isNativePairedOperation } from './lib/native-account.ts';

Before({ tags: '@native-plugin-read' }, function () { this.pluginFixtures = []; });
After({ tags: '@native-plugin-read' }, async function () { for (const c of this.pluginFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativePluginReadFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.pluginFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal);
  return c;
}
const calls = c => c.f.frames.filter(f => nativePluginReadMethods.includes(f.method));
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);
const skillParams = { remoteMarketplaceName: 'openai-curated-remote', remotePluginId: ownedRemotePluginId, skillName: 'owned-skill' };
Then('plugin read models retain wire contracts typed ports and field diagnostics', async function () {
  const c = await setup(this);
  for (const method of nativePluginReadMethods) {
    const s = c.select(method), graph = createOperationGraph(s.operation, { x: 0, y: 0 }, 'owner', s.document);
    const doc = { version: 3, id: 'plugin-read', name: 'Plugin read', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.equal(s.operation.unavailableReason, undefined); assert.equal(s.operation.rpc.result, true); assert.deepEqual(s.operation.rpc.workflowResult, s.document['x-operations-native-workflow'].wireResult); assert.equal(isNativePairedOperation(method), true);
    assert.ok(s.operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!s.operation.capabilities.requirements.some(r => ['native-terminal', 'native-workspace'].includes(r.code)));
  }
  const graph = createOperationGraph(c.select('plugin/skill/read').operation, { x: 0, y: 0 }, 'owner', c.select('plugin/skill/read').document);
  assert.ok(graph.nodes.filter(n => n.type === 'data').flatMap(n => n.data.fields).some(f => JSON.parse(decodeURIComponent(f.id))[1] === '/result/contents' && f.type === 'Text'));
  assert.deepEqual(prepareNativeRequest(c.select('plugin/read').operation, { 'params:pluginName': 'owned-plugin', 'params:marketplacePath': 'local.json' }).params,
    { pluginName: 'owned-plugin', marketplacePath: 'local.json' });
  for (const [method, values, field] of [
    ['plugin/list', { 'params:forceRefetch': '"yes"' }, 'forceRefetch'], ['plugin/list', { 'params:marketplaceKinds': '["unknown"]' }, 'marketplaceKinds'],
    ['plugin/read', { 'params:pluginName': 'owned-plugin' }, 'marketplacePath'],
    ['plugin/read', { 'params:pluginName': 'owned-plugin', 'params:marketplacePath': 'local.json', 'params:remoteMarketplaceName': 'remote' }, 'marketplacePath'],
    ['plugin/installed', { 'params:cwds': '[false]' }, 'cwds']])
    assert.throws(() => prepareNativeRequest(c.select(method).operation, values), e => e.fieldKey === 'params:' + field);
});
async function pairedReads(world, real) {
  const c = await setup(world, { real }); assert.equal(c.connection.workflowFingerprint, undefined);
  const list = await c.execute('plugin/list', { cwds: [c.f.workspace], marketplaceKinds: ['local'], forceRefetch: false });
  assert.ok(list.response.result.marketplaces.some(m => m.name === 'owned-market'));
  assert.ok(Array.isArray((await c.execute('plugin/installed', { cwds: [c.f.workspace], installSuggestionPluginNames: ['owned-plugin'] })).response.result.marketplaces));
  const detail = await c.execute('plugin/read', { marketplacePath: c.f.backend.marketplacePath, pluginName: 'owned-plugin' });
  assert.equal(detail.response.result.plugin.summary.name, 'owned-plugin');
  const remote = await c.execute('plugin/read', { pluginName: ownedRemotePluginId, remoteMarketplaceName: 'openai-curated-remote' });
  assert.equal(remote.response.result.plugin.summary.remotePluginId, ownedRemotePluginId);
  assert.match((await c.execute('plugin/skill/read', skillParams)).response.result.contents, /Owned remote skill/);
  assert.equal((await c.execute('plugin/share/list')).response.result.data[0].plugin.remotePluginId, ownedRemotePluginId);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1); assert.equal(calls(c).length, 6);
  assert.ok(!c.f.frames.some(f => ['thread/start', 'turn/start', 'config/value/write', 'plugin/install', 'plugin/share/save'].includes(f.method)));
}
Then('five plugin reads share one paired session without agent or write authority', async function () { await pairedReads(this, false); });
Then('five actual SDK plugin reads complete through the paired encrypted broker', { timeout: 60000 }, async function () { await pairedReads(this, true); });
Then('plugin reads reject missing grants workspace escapes and indirect source escapes', { timeout: 60000 }, async function () {
  const denied = await setup(this, { allowPluginsRead: false, allowAgent: true });
  await assert.rejects(denied.execute('plugin/list')); assert.equal(calls(denied).length, 0);
  for (const mode of ['outside', 'home', 'symlink', 'source', 'resource', 'configured', 'nestedConfigured']) {
    const c = await setup(this); let params = { cwds: [c.f.workspace], marketplaceKinds: ['local'] };
    if (mode === 'outside') params.cwds = ['/outside'];
    if (mode === 'home') params.cwds = [c.f.home];
    if (mode === 'symlink') { await symlink(c.f.home, join(c.f.workspace, 'escape')); params.cwds = [join(c.f.workspace, 'escape')]; }
    if (mode === 'source') await writeFile(c.f.backend.marketplacePath, JSON.stringify({ name: 'owned-market', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: c.f.home } }] }));
    if (mode === 'resource') await writeFile(join(c.f.workspace, 'owned-plugin/.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', mcpServers: join(c.f.home, 'auth.json') }));
    if (mode === 'configured') c.f.pluginConfig = { layers: [{ config: { marketplaces: { outside: { source_type: 'local', source: c.f.home } } } }] };
    if (mode === 'nestedConfigured') {
      const cwd = join(c.f.workspace, 'nested'); await mkdir(cwd); params.cwds = [cwd];
      c.f.pluginConfigs = new Map([[cwd, { layers: [{ config: { marketplaces: { outside: { source_type: 'local', source: c.f.home } } } }] }]]);
    }
    await assert.rejects(c.execute('plugin/list', params)); assert.equal(calls(c).length, 0);
  }
  const c = await setup(this); await c.v.session.disconnectNativeRuntime(c.reference); await ended(c);
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-workflow', fingerprint: 'd'.repeat(64) }); assert.equal(ticket.status, 200);
  const socket = await c.f.socket(ticket.value.ticket); await socket.next(); socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'agent', method: 'thread/start', params: {} })); await waitForWatch(() => socket.ws.readyState === 3);
  assert.ok(!c.f.frames.some(f => f.method === 'thread/start')); socket.ws.terminate();
});
Then('plugin read results reject malformed data and native or vault credential echoes', { timeout: 60000 }, async function () {
  for (const mode of ['type', 'unknown', 'native', 'base64', 'vault', 'nativeError', 'path']) {
    const c = await setup(this); let params = skillParams, method = 'plugin/skill/read';
    if (mode === 'type') c.f.pluginResult = { contents: 42 };
    if (mode === 'unknown') c.f.pluginResult = { contents: 'safe', privateData: 'unknown' };
    if (mode === 'native') c.f.skillContents = c.f.backend.access;
    if (mode === 'base64') c.f.skillContents = Buffer.from(c.f.backend.refresh).toString('base64');
    if (mode === 'vault') { const secret = 'owned-plugin-vault-' + randomUUID(); await c.v.session.put(null, { label: 'Plugin privacy fixture', kind: 'secret', value: secret }); c.f.skillContents = Buffer.from(secret).toString('base64'); }
    if (mode === 'nativeError') c.f.pluginError = c.f.backend.access;
    if (mode === 'path') { method = 'plugin/list'; params = { marketplaceKinds: ['local'] }; c.f.pluginResult = { marketplaces: [{ name: 'escaped', path: join(c.f.home, 'auth.json'), plugins: [] }] }; }
    await assert.rejects(c.execute(method, params)); await ended(c);
  }
});
Then('actual SDK plugin skill credentials remain private before browser delivery', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }); c.f.backend.pluginSkillContents = c.f.backend.access;
  await assert.rejects(c.execute('plugin/skill/read', skillParams)); await ended(c);
  assert.equal(calls(c).length, 1);
});
Then('pending plugin reads reject cancellation lock identity and schema changes without replay', async function () {
  for (const mode of ['source', 'identity', 'lock', 'cancel']) {
    const c = await setup(this), controller = new AbortController(); c.f.holdPlugins = true;
    const pending = c.execute('plugin/skill/read', skillParams, controller.signal); void pending.catch(() => {});
    await waitForWatch(() => c.f.pluginReplies?.length === 1);
    if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID(); else if (mode === 'lock') c.v.session.lock(); else controller.abort();
    if (mode === 'source' || mode === 'identity') c.f.pluginReplies[0]();
    await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('a plugin source changed before response cannot publish stale metadata', async function () {
  const c = await setup(this); c.f.holdPlugins = true;
  const pending = c.execute('plugin/read', { pluginName: 'owned-plugin', marketplacePath: c.f.backend.marketplacePath }); void pending.catch(() => {});
  await waitForWatch(() => c.f.pluginReplies?.length === 1);
  await writeFile(join(c.f.workspace, 'owned-plugin/skills/owned-skill/SKILL.md'), 'Changed after dispatch.'); c.f.pluginReplies[0]();
  await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
});

Then('the pinned SDK lists local and remote plugins and reads owned plugin skills and shares', { timeout: 60000 }, async function () {
  const f = await nativePluginSdkFixture();
  try {
    const list = await f.call('plugin/list', { cwds: [f.workspace], marketplaceKinds: ['local'], forceRefetch: false });
    assert.ok(list.marketplaces.some(m => m.name === 'owned-market' && m.plugins.some(p => p.name === 'owned-plugin')));
    const installed = await f.call('plugin/installed', { cwds: [f.workspace] }); assert.ok(Array.isArray(installed.marketplaces));
    const detail = await f.call('plugin/read', { marketplacePath: f.backend.marketplacePath, pluginName: 'owned-plugin' });
    assert.equal(detail.plugin.summary.name, 'owned-plugin'); assert.ok(detail.plugin.skills.some(s => s.name.endsWith('owned-skill')));
    const remote = await f.call('plugin/read', { remoteMarketplaceName: 'openai-curated-remote', pluginName: ownedRemotePluginId });
    assert.equal(remote.plugin.summary.remotePluginId, ownedRemotePluginId);
    const skill = await f.call('plugin/skill/read', { remoteMarketplaceName: 'openai-curated-remote', remotePluginId: ownedRemotePluginId, skillName: 'owned-skill' });
    assert.match(skill.contents, /Owned remote skill/);
    const shares = await f.call('plugin/share/list'); assert.equal(shares.data[0].plugin.remotePluginId, ownedRemotePluginId);
    assert.ok(f.backend.requests.filter(r => r.path.startsWith('/ps/plugins/')).every(r => r.authorized));
    assert.ok(!f.calls.some(c => ['turn/start', 'thread/start', 'plugin/install', 'plugin/share/save'].includes(c.method)));
  } finally { await f.close(); }
});
