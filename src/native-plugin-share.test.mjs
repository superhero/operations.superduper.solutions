// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativePluginShareParams, nativePluginShareInputSchema, nativePluginShareMethods } from './lib/native-plugin-share.ts';
import { isNativePluginRemoteId } from './lib/native-plugin-id.ts';
import { nativePluginShareSdkFixture, ownedSharedPluginId } from '../tests/native-plugin-share-sdk.fixture.mjs';
import { nativePluginShareFixture } from '../tests/native-plugin-share.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { isNativePairedOperation } from './lib/native-account.ts';
import { nativeConfigurationTransition, nativeConfigurationWriteHash } from './lib/native-configuration-write.ts';
import { prepareNativePluginShare, reviewNativePluginShare } from '../companions/codex/plugin-share.mjs';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { prepareNativePluginRead } from '../companions/codex/plugin-read.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Before({ tags: '@native-plugin-share' }, function () { this.pluginShareFixtures = []; });
After({ tags: '@native-plugin-share' }, async function () { for (const c of this.pluginShareFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativePluginShareFixture(options);
  if (options.mutateFrames) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, settings) {
        if (name !== 'message') return super.addEventListener(name, listener, settings);
        return super.addEventListener(name, event => { for (const frame of options.mutateFrames(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) }); }, settings);
      }
    };
  }
  const v = await nativeVaultFixture(f), c = { f, v, adopted: [] }; world.pluginShareFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, undefined,
    next => { c.reference = next; c.adopted.push(next); }).catch(error => { if (f.reviewFailure) error.message += '\nPrivate share review: ' + f.reviewFailure; error.message += '\nOwned stages: ' + JSON.stringify(f.effectStages ?? []); throw error; }); return c;
}
Then('plugin sharing preserves typed results portable graphs and separate owner permissions', async function () {
  const source = await readServiceSchema('codex');
  for (const method of nativePluginShareMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.equal(isNativePairedOperation(method), true);
    assert.deepEqual(operation.rpc.workflowResult, document['x-operations-native-workflow'].wireResult);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document), doc = { version: 3, id: 'share', name: 'Share', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.ok(operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
  }
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  let prepared = 0;
  const prepare = async (method, params) => { prepared++; return { method, params, before: { identity } }; };
  for (const granted of [false, true]) {
    const session = createCodexAgentSession({ identity: { ...identity }, authority: async () => ({ ...identity }), send() {}, write() {}, threads: new Map(),
      allowAgent: !granted, allowConfigurationWrite: !granted, allowMarketplaces: !granted, allowPluginsRead: !granted, allowPluginManagement: !granted, allowPluginSharing: granted,
      preparePluginShare: prepare, reviewPluginShare() {}, preparePluginInstall: prepare, reviewPluginInstall() {}, prepareMarketplace: prepare, reviewMarketplace() {}, prepareConfigurationWrite: prepare, reviewConfigurationWrite() {}, preparePluginRead: prepare, reviewPluginRead() {}, configurationWriteAuthority: async () => ({ ...identity }) });
    try {
      const cases = granted ? [['plugin/install', { pluginName: 'owned', marketplacePath: '/owned/market.json' }], ['marketplace/add', { source: './owned' }], ['config/value/write', { keyPath: 'model', value: 'owned', mergeStrategy: 'replace' }], ['plugin/read', { pluginName: 'owned', marketplacePath: '/owned/market.json' }], ['thread/start', {}]]
        : [['plugin/share/save', { pluginPath: '/owned/plugin' }], ['plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'PRIVATE', shareTargets: [] }], ['plugin/share/checkout', { remotePluginId: ownedSharedPluginId }], ['plugin/share/delete', { remotePluginId: ownedSharedPluginId }]];
      for (const [method, params] of cases) await assert.rejects(session.request({ id: 'denied', method, params }));
      assert.equal(prepared, 0);
      if (granted) { const frame = await session.request({ id: 'owned_share', method: 'plugin/share/save', params: { pluginPath: '/owned/plugin' } }); assert.equal(frame.method, 'plugin/share/save'); assert.equal(prepared, 1); }
    } finally { session.close(); }
  }
});
Then('plugin sharing receipts bind exact methods inputs results and nonconfiguration authority', async function () {
  const before = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  for (const method of nativePluginShareMethods) {
    const paramsHash = await nativeConfigurationWriteHash({ remotePluginId: ownedSharedPluginId }), resultHash = await nativeConfigurationWriteHash({});
    const frame = { type: 'authority', reason: 'configuration', requestId: 'owned_share', method, paramsHash, resultHash, beforeConfiguration: before.configuration, identity: { ...before } };
    assert.deepEqual(nativeConfigurationTransition(frame, before, method, frame.requestId, paramsHash, resultHash), frame);
    for (const change of [{ method: 'plugin/install' }, { method: nativePluginShareMethods.find(m => m !== method) }, { requestId: 'foreign' }, { paramsHash: 'd'.repeat(64) }, { resultHash: 'd'.repeat(64) },
      { identity: { ...before, accountEpoch: randomUUID() } }, { identity: { ...before, workspace: 'd'.repeat(64) } }])
      assert.throws(() => nativeConfigurationTransition({ ...frame, ...change }, before, method, frame.requestId, paramsHash, resultHash));
  }
});
async function contractFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-share-effects-')), home = join(directory, 'home'), workspace = join(directory, 'workspace'), plugin = join(workspace, 'plugin');
  await mkdir(home, { mode: 0o700 }); await mkdir(join(plugin, '.codex-plugin'), { recursive: true }); await writeFile(join(home, 'config.toml'), '', { mode: 0o600 });
  await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '1.0.0' }));
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const state = { user: {}, principals: [{ principalType: 'user', principalId: 'owned-user', role: 'owner', name: 'Owned user' }] };
  const context = { home, workspace, capture: async () => ({ identity, basis: 'owned-basis' }),
    inspect: async () => ({ config: structuredClone(state.user), layers: [{ name: { type: 'user', file: join(home, 'config.toml') }, version: 'owned', config: structuredClone(state.user) }] }),
    account: async () => ({ requiresOpenaiAuth: true, account: { type: 'chatgpt', email: 'owned@example.test', planType: 'pro' }, workspaceRouting: { chatgptAccountId: 'owned-account', backendOrigin: 'https://chatgpt.com', accountRoutingOverride: 'NO_CONSTRAINT' } }),
    read: async () => ({ plugin: { marketplaceName: 'workspace-shared-with-me', summary: { name: 'owned-plugin', remotePluginId: ownedSharedPluginId, source: { type: 'remote' },
      shareContext: { remotePluginId: ownedSharedPluginId, discoverability: 'PRIVATE', sharePrincipals: state.principals, shareUrl: 'https://chatgpt.example/owned' } } } }) };
  return { home, workspace, plugin, state, context, close: () => rm(directory, { recursive: true, force: true }) };
}
Then('plugin sharing confines publish sources and rejects changed files settings associations or access', async function () {
  for (const mode of ['valid', 'privateRoot', 'link', 'resource', 'source', 'settings', 'association', 'access']) {
    const f = await contractFixture();
    try {
      let path = f.plugin;
      if (mode === 'privateRoot') path = f.home;
      if (mode === 'link') { path = join(f.workspace, 'link'); await symlink(f.home, path); }
      if (mode === 'resource') await writeFile(join(f.plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', skills: f.home }));
      if (['privateRoot', 'link', 'resource'].includes(mode)) { await assert.rejects(prepareNativePluginShare('plugin/share/save', { pluginPath: path }, f.context), e => e.field === 'pluginPath'); continue; }
      const plan = await prepareNativePluginShare('plugin/share/save', { pluginPath: path, discoverability: 'PRIVATE', shareTargets: [] }, f.context);
      const mapped = { [ownedSharedPluginId]: path }; if (mode === 'association') mapped.plugins_other = '/outside';
      await mkdir(join(f.home, '.tmp')); await writeFile(join(f.home, '.tmp/plugin-share-local-paths-v1.json'), JSON.stringify({ localPluginPathsByRemotePluginId: mapped }));
      if (mode === 'source') await writeFile(join(path, 'changed.txt'), 'Changed source.');
      if (mode === 'settings') f.state.user.model = 'unrequested';
      if (mode === 'access') f.state.principals.push({ principalType: 'user', principalId: 'unrequested', role: 'editor', name: 'Unrequested' });
      const result = { remotePluginId: ownedSharedPluginId, shareUrl: 'https://chatgpt.example/owned', canPublishToWorkspace: true };
      if (mode === 'valid') assert.deepEqual((await reviewNativePluginShare(plan, result, f.context)).result, result);
      else await assert.rejects(reviewNativePluginShare(plan, result, f.context));
    } finally { await f.close(); }
  }
});
Then('personal plugin discovery reviews checked out sources while keeping private credentials and runtime data outside scope', async function () {
  for (const mode of ['valid', 'data', 'credentials', 'link']) {
    const f = await contractFixture();
    try {
      const market = join(f.home, '.agents/plugins/marketplace.json'), path = join(f.home, 'plugins/owned-plugin');
      await mkdir(join(f.home, '.agents/plugins'), { recursive: true }); await mkdir(join(path, '.codex-plugin'), { recursive: true });
      await writeFile(join(path, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '1.0.0' }));
      let selected = './plugins/owned-plugin';
      if (mode === 'data') selected = './plugins/data/owned';
      if (mode === 'credentials') selected = './auth.json';
      if (mode === 'link') { selected = './plugins/link'; await symlink(f.home, join(f.home, 'plugins/link')); }
      await writeFile(market, JSON.stringify({ name: 'codex-curated', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: selected } }] }));
      const promise = prepareNativePluginRead('plugin/read', { pluginName: 'owned-plugin', marketplacePath: market }, f.context);
      if (mode === 'valid') assert.ok((await promise).sources.some(s => s.path === path));
      else await assert.rejects(promise, e => e.field === 'marketplacePath');
    } finally { await f.close(); }
  }
});
Then('actual plugin sharing effects advance exact encrypted ownership across publishing access and deletion', { timeout: 120000 }, async function () {
  const c = await setup(this), original = c.reference, state = c.f.backend.sharing, path = join(c.f.workspace, 'owned-plugin');
  const first = await c.execute('plugin/share/save', { pluginPath: path, discoverability: 'UNLISTED', shareTargets: [{ principalType: 'user', principalId: 'owned-user-2', role: 'editor' }] });
  assert.equal(first.response.result.remotePluginId, ownedSharedPluginId);
  assert.deepEqual(c.reference, original, 'Remote sharing leaves the paired configuration and credential authority unchanged.');
  await c.execute('plugin/share/save', { pluginPath: path, remotePluginId: ownedSharedPluginId });
  const updated = await c.execute('plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'UNLISTED', shareTargets: [{ principalType: 'group', principalId: 'owned-group', role: 'reader' }] });
  assert.ok(updated.response.result.principals.some(p => p.principalType === 'workspace' && p.principalId === 'owned-account' && p.role === 'reader'));
  assert.equal((await c.execute('plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'LISTED', shareTargets: [] })).response.result.discoverability, 'LISTED');
  await c.execute('plugin/share/delete', { remotePluginId: ownedSharedPluginId });
  assert.equal(state.created, false); assert.equal(state.uploads.length, 2); assert.ok(state.uploads.every(u => !u.authorization));
  assert.ok(state.uploads.every(u => gunzipSync(u.body).includes(Buffer.from('Owned local fixture content'))));
  await assert.rejects(stat(join(c.f.home, '.tmp/plugin-share-local-paths-v1.json')), e => e.code === 'ENOENT');
  assert.match(await readFile(join(path, 'skills/owned-skill/SKILL.md'), 'utf8'), /Owned local fixture content/);
  assert.equal(c.adopted.length, 5); assert.equal(c.f.frames.filter(f => nativePluginShareMethods.includes(f.method)).length, 5);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1);
  await assert.rejects(c.execute('plugin/install', { pluginName: 'owned-plugin', marketplacePath: c.f.backend.marketplacePath }));
});
Then('actual paired checkout keeps personal edits and permits publishing only its reviewed package', { timeout: 120000 }, async function () {
  const c = await setup(this, { created: true }), state = c.f.backend.sharing;
  const first = (await c.execute('plugin/share/checkout', { remotePluginId: ownedSharedPluginId })).response.result;
  assert.equal(first.pluginPath, join(c.f.home, 'plugins/owned-plugin')); assert.equal(first.marketplacePath, join(c.f.home, '.agents/plugins/marketplace.json'));
  assert.match(await readFile(join(first.pluginPath, 'skills/owned-skill/SKILL.md'), 'utf8'), /Bundle version 1.0.0/);
  await writeFile(join(first.pluginPath, 'local-edit.txt'), 'Owned paired edit.');
  assert.equal((await c.execute('plugin/share/checkout', { remotePluginId: ownedSharedPluginId })).response.result.pluginPath, first.pluginPath);
  assert.equal(c.f.backend.installation.downloads.length, 1); assert.equal(await readFile(join(first.pluginPath, 'local-edit.txt'), 'utf8'), 'Owned paired edit.');
  await c.execute('plugin/share/save', { remotePluginId: ownedSharedPluginId, pluginPath: first.pluginPath });
  assert.equal(state.uploads.length, 1); assert.equal(state.uploads[0].authorization, false); assert.ok(gunzipSync(state.uploads[0].body).includes(Buffer.from('Owned paired edit.')));
  await c.execute('plugin/share/delete', { remotePluginId: ownedSharedPluginId });
  assert.equal(await readFile(join(first.pluginPath, 'local-edit.txt'), 'utf8'), 'Owned paired edit.');
  assert.equal(c.adopted.length, 4); assert.equal(c.f.frames.filter(f => nativePluginShareMethods.includes(f.method)).length, 4);
});
Then('unverified share files associations access receipts and cancellation cannot advance pairing', { timeout: 180000 }, async function () {
  for (const mode of ['receiptMissing', 'receiptMethod', 'settings', 'association', 'source', 'cancel']) {
    const controller = new AbortController();
    const c = await setup(this, {
      mutateFrames: frame => frame.type !== 'authority' ? [frame] : mode === 'receiptMissing' ? [] : mode === 'receiptMethod' ? [{ ...frame, method: 'plugin/share/delete' }] : [frame],
      async beforeReview(f) {
        f.reachedReview = true;
        if (mode === 'source') await writeFile(join(f.workspace, 'owned-plugin/changed.txt'), 'Changed after upload.');
        if (mode === 'association') { const path = join(f.home, '.tmp/plugin-share-local-paths-v1.json'), value = JSON.parse(await readFile(path, 'utf8')); value.localPluginPathsByRemotePluginId.plugins_other = '/outside'; await writeFile(path, JSON.stringify(value)); }
        if (mode === 'settings') { const path = join(f.home, 'config.toml'); await writeFile(path, (await readFile(path, 'utf8')).replace('model="owned-account-model"', 'model="unrequested-model"'), { mode: 0o600 }); }
      }, afterReview() { if (mode === 'cancel') controller.abort(); }
    });
    const before = structuredClone(c.v.storage.state.snapshot);
    await assert.rejects(c.execute('plugin/share/save', { pluginPath: join(c.f.workspace, 'owned-plugin') }, controller.signal));
    await waitForWatch(() => c.f.starts === c.f.stops);
    assert.equal(c.f.reachedReview, true); assert.equal(c.f.backend.sharing.created, true); assert.equal(c.f.backend.sharing.uploads.length, 1);
    assert.equal(c.adopted.length, 0); assert.deepEqual(c.v.storage.state.snapshot, before); assert.equal(c.f.frames.filter(f => nativePluginShareMethods.includes(f.method)).length, 1);
  }
});
Then('share source credentials private paths native upload failure and denied permissions never publish verified ownership', { timeout: 180000 }, async function () {
  for (const mode of ['credentials', 'privateRoot', 'link', 'failedUpload', 'deniedTargets']) {
    const c = await setup(this, { failUpload: mode === 'failedUpload', created: mode === 'deniedTargets', denyTargets: mode === 'deniedTargets', async seedRuntime(f) {
      if (mode === 'credentials') await writeFile(join(f.workspace, 'owned-plugin/token.txt'), f.backend.access);
      if (mode === 'link') await symlink(f.home, join(f.workspace, 'private-link'));
    } });
    const before = structuredClone(c.v.storage.state.snapshot), path = mode === 'privateRoot' ? c.f.home : mode === 'link' ? join(c.f.workspace, 'private-link') : join(c.f.workspace, 'owned-plugin');
    await assert.rejects(mode === 'deniedTargets' ? c.execute('plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'PRIVATE', shareTargets: [] }) : c.execute('plugin/share/save', { pluginPath: path }));
    await waitForWatch(() => c.f.starts === c.f.stops);
    assert.equal(c.adopted.length, 0); assert.deepEqual(c.v.storage.state.snapshot, before); assert.deepEqual(c.f.backend.sharing.actions, []);
    assert.equal(c.f.backend.sharing.uploads.length, mode === 'failedUpload' ? 1 : 0);
    assert.equal(c.f.frames.filter(f => nativePluginShareMethods.includes(f.method)).length, ['failedUpload', 'deniedTargets'].includes(mode) ? 1 : 0);
  }
});

Then('plugin sharing retains native nullable creation selectors user group roles and update visibility', function () {
  const target = { principalType: 'user', principalId: 'owned-user-2', role: 'editor' };
  for (const [method, params] of [
    ['plugin/share/save', { pluginPath: '/owned/plugin', remotePluginId: null, discoverability: null, shareTargets: null }],
    ['plugin/share/save', { pluginPath: '/owned/plugin', discoverability: 'UNLISTED', shareTargets: [target] }],
    ['plugin/share/save', { pluginPath: '/owned/plugin', remotePluginId: 'plugins_123' }],
    ['plugin/share/updateTargets', { remotePluginId: 'plugins~Plugin_123', discoverability: 'LISTED', shareTargets: [target, { ...target, principalType: 'group', role: 'reader' }] }],
    ['plugin/share/checkout', { remotePluginId: 'native-ID_123' }], ['plugin/share/delete', { remotePluginId: 'plugins_123' }]])
    assert.deepEqual(nativePluginShareParams(method, params), params);
  for (const id of ['plugins_123', 'plugins~Plugin_123', 'native-ID_123', 'a']) assert.equal(isNativePluginRemoteId(id), true);
  for (const id of ['', '../escape', 'plugins/id', 'bad\nID', 'x'.repeat(513), null, 1]) assert.equal(isNativePluginRemoteId(id), false);
  assert.deepEqual(nativePluginShareInputSchema('plugin/share/updateTargets').properties.discoverability.enum, ['UNLISTED', 'PRIVATE', 'LISTED']);
});
Then('plugin sharing rejects unsupported creation policies client workspace grants malformed targets and remote IDs by field', function () {
  const save = { pluginPath: '/owned/plugin' }, update = { remotePluginId: 'plugins_123', discoverability: 'PRIVATE', shareTargets: [] };
  for (const [method, input, field] of [
    ['plugin/share/save', { ...save, discoverability: 'LISTED' }, 'discoverability'],
    ['plugin/share/save', { ...save, remotePluginId: 'plugins_123', shareTargets: [] }, 'shareTargets'],
    ['plugin/share/save', { ...save, remotePluginId: 'plugins_123', discoverability: 'PRIVATE' }, 'discoverability'],
    ['plugin/share/save', { ...save, pluginPath: 'bad\npath' }, 'pluginPath'],
    ['plugin/share/updateTargets', { ...update, shareTargets: null }, 'shareTargets'],
    ...[{ principalType: 'workspace', principalId: 'owned-account', role: 'reader' }, { principalType: 'user', principalId: 'owned-user', role: 'owner' },
      { principalType: 'user', role: 'editor' }, { principalType: 'user', principalId: 'owned-user', role: 'reader', token: 'extra' }].map(t => ['plugin/share/updateTargets', { ...update, shareTargets: [t] }, 'shareTargets']),
    ['plugin/share/delete', { remotePluginId: 'bad/id' }, 'remotePluginId'], ['plugin/share/checkout', { remotePluginId: '' }, 'remotePluginId'],
    ['plugin/share/save', { ...save, authorization: 'extra' }, 'authorization']])
    assert.throws(() => nativePluginShareParams(method, input), e => e.field === field);
});
async function enable(f) {
  const path = join(f.home, 'config.toml'); await writeFile(path, (await readFile(path, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
}
Then('the actual SDK uploads owned plugin archives changes native share permissions and deletes only its mapping', { timeout: 90000 }, async function () {
  const f = await nativePluginShareSdkFixture(), state = f.backend.sharing, path = join(f.workspace, 'owned-plugin');
  try {
    await enable(f);
    const saved = await f.call('plugin/share/save', { pluginPath: path, discoverability: 'UNLISTED', shareTargets: [{ principalType: 'user', principalId: 'owned-user-2', role: 'editor' }] });
    assert.deepEqual(saved, { remotePluginId: ownedSharedPluginId, shareUrl: 'https://chatgpt.example/plugins/share/owned-share', canPublishToWorkspace: true });
    assert.equal(state.created, true); assert.equal(state.uploads.length, 1); assert.equal(state.uploads[0].authorization, false);
    assert.equal(state.uploads[0].blobType, 'BlockBlob'); assert.equal(state.uploads[0].contentType, 'application/gzip');
    const archive = gunzipSync(state.uploads[0].body); assert.ok(archive.includes(Buffer.from('Owned local fixture content')));
    assert.equal(archive.includes(Buffer.from(f.backend.access)), false); assert.equal(archive.includes(Buffer.from(f.backend.refresh)), false);
    assert.equal(state.uploadRequests[0].input.size_bytes, state.uploads[0].body.length); assert.equal(state.uploadRequests[0].input.mime_type, 'application/gzip');
    assert.deepEqual(state.actions[0].input.share_targets, [{ principal_type: 'user', principal_id: 'owned-user-2', role: 'editor' }, { principal_type: 'workspace', principal_id: 'owned-account', role: 'reader' }]);
    const mapping = join(f.home, '.tmp/plugin-share-local-paths-v1.json');
    assert.equal(JSON.parse(await readFile(mapping, 'utf8')).localPluginPathsByRemotePluginId[ownedSharedPluginId], path);
    await f.call('plugin/share/save', { pluginPath: path, remotePluginId: ownedSharedPluginId });
    assert.equal(state.actions[1].path, '/public/plugins/workspace/' + ownedSharedPluginId); assert.equal(state.uploadRequests[1].input.plugin_id, ownedSharedPluginId);
    const changed = await f.call('plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'UNLISTED', shareTargets: [{ principalType: 'group', principalId: 'owned-group', role: 'reader' }] });
    assert.equal(changed.discoverability, 'UNLISTED');
    assert.ok(changed.principals.some(p => p.principalType === 'workspace' && p.principalId === 'owned-account' && p.role === 'reader'));
    assert.ok(changed.principals.some(p => p.principalType === 'group' && p.principalId === 'owned-group' && p.role === 'reader'));
    const listed = await f.call('plugin/share/updateTargets', { remotePluginId: ownedSharedPluginId, discoverability: 'LISTED', shareTargets: [] });
    assert.equal(listed.discoverability, 'LISTED'); assert.equal(listed.principals.some(p => p.principalType === 'workspace'), false);
    assert.deepEqual(await f.call('plugin/share/delete', { remotePluginId: ownedSharedPluginId }), {}); assert.equal(state.created, false);
    await assert.rejects(stat(mapping), e => e.code === 'ENOENT');
    assert.match(await readFile(join(path, 'skills/owned-skill/SKILL.md'), 'utf8'), /Owned local fixture content/);
    assert.ok(f.backend.requests.filter(r => r.path.startsWith('/public/plugins/') || r.path.endsWith('/shares')).every(r => r.authorized));
  } finally { await f.close(); }
});
Then('the actual SDK checks out a verified HTTPS share into its personal marketplace and preserves repeated local edits', { timeout: 90000 }, async function () {
  const f = await nativePluginShareSdkFixture({ created: true });
  try {
    await enable(f);
    const result = await f.call('plugin/share/checkout', { remotePluginId: ownedSharedPluginId });
    assert.equal(result.remotePluginId, ownedSharedPluginId); assert.equal(result.pluginName, 'owned-plugin'); assert.equal(result.pluginId, 'owned-plugin@codex-curated');
    assert.equal(result.pluginPath, join(f.home, 'plugins/owned-plugin')); assert.equal(result.marketplacePath, join(f.home, '.agents/plugins/marketplace.json'));
    assert.equal(result.marketplaceName, 'codex-curated'); assert.equal(result.remoteVersion, '1.0.0');
    assert.match(await readFile(join(result.pluginPath, 'skills/owned-skill/SKILL.md'), 'utf8'), /Bundle version 1.0.0/);
    const market = JSON.parse(await readFile(result.marketplacePath, 'utf8')); assert.equal(market.name, 'codex-curated');
    assert.ok(market.plugins.some(p => p.name === 'owned-plugin' && p.source.path === './plugins/owned-plugin' && p.policy.authentication === 'ON_USE'));
    const mapping = JSON.parse(await readFile(join(f.home, '.tmp/plugin-share-local-paths-v1.json'), 'utf8'));
    assert.equal(mapping.localPluginPathsByRemotePluginId[ownedSharedPluginId], result.pluginPath);
    const downloads = f.backend.installation.downloads.length; assert.equal(downloads, 1); assert.ok(f.backend.installation.downloads.every(d => !d.authorization));
    await writeFile(join(result.pluginPath, 'local-edit.txt'), 'Owned local edit.');
    const again = await f.call('plugin/share/checkout', { remotePluginId: ownedSharedPluginId });
    assert.equal(again.pluginPath, result.pluginPath); assert.equal(await readFile(join(result.pluginPath, 'local-edit.txt'), 'utf8'), 'Owned local edit.');
    assert.equal(f.backend.installation.downloads.length, downloads);
  } finally { await f.close(); }
});
Then('failed native plugin uploads do not finalize publication or create local share mappings', { timeout: 45000 }, async function () {
  const f = await nativePluginShareSdkFixture({ failUpload: true });
  try {
    await enable(f);
    await assert.rejects(f.call('plugin/share/save', { pluginPath: join(f.workspace, 'owned-plugin') }));
    assert.equal(f.backend.sharing.uploads.length, 1); assert.equal(f.backend.sharing.created, false); assert.deepEqual(f.backend.sharing.actions, []);
    await assert.rejects(stat(join(f.home, '.tmp/plugin-share-local-paths-v1.json')), e => e.code === 'ENOENT');
  } finally { await f.close(); }
});
