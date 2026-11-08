// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeMarketplaceSdkFixture } from '../tests/native-marketplace-sdk.fixture.mjs';
import { nativeMarketplaceParams } from './lib/native-marketplace.ts';
import { nativeMarketplaceFixture } from '../tests/native-marketplace.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeMarketplaceMethods } from './lib/native-marketplace.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { isNativePairedOperation } from './lib/native-account.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { nativeConfigurationTransition, nativeConfigurationWriteHash, nativeConfigurationWriteParams } from './lib/native-configuration-write.ts';
import { randomUUID } from 'node:crypto';
import { prepareNativeMarketplace, reviewNativeMarketplace } from '../companions/codex/marketplace.mjs';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Before({ tags: '@native-marketplace' }, function () { this.marketplaceFixtures = []; });
After({ tags: '@native-marketplace' }, async function () { for (const c of this.marketplaceFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeMarketplaceFixture(options);
  if (options.mutateFrames) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, options) {
        if (name !== 'message') return super.addEventListener(name, listener, options);
        return super.addEventListener(name, event => { for (const frame of optionsFrames(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) }); }, options);
      }
    };
    const optionsFrames = options.mutateFrames;
  }
  const v = await nativeVaultFixture(f), c = { f, v, adopted: [] }; world.marketplaceFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, undefined,
    next => { c.reference = next; c.adopted.push(next); }); return c;
}
Then('marketplace operation models preserve native results graph persistence and paired execution', async function () {
  const source = await readServiceSchema('codex');
  for (const method of nativeMarketplaceMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.equal(isNativePairedOperation(method), true);
    assert.deepEqual(operation.rpc.workflowResult, document['x-operations-native-workflow'].wireResult);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document), doc = { version: 3, id: 'marketplace', name: 'Marketplace', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.ok(operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
    if (method === 'marketplace/add') {
      assert.ok(graph.nodes.filter(n => n.type === 'data').flatMap(n => n.data.fields).some(f => JSON.parse(decodeURIComponent(f.id))[1] === '/result/alreadyAdded' && f.type === 'Boolean'));
      assert.deepEqual(prepareNativeRequest(operation, { 'params:source': './owned-market' }).params, { source: './owned-market' });
    }
  }
});
async function hostContext() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-marketplace-contract-')), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 }); await mkdir(workspace); await mkdir(join(workspace, 'market/.agents/plugins'), { recursive: true });
  await writeFile(join(home, 'config.toml'), '', { mode: 0o600 });
  await writeFile(join(workspace, 'market/.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned', plugins: [] }));
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const state = { user: {}, nonUser: [], identity };
  const context = { home, workspace, capture: async () => ({ identity: { ...state.identity }, basis: 'owned-non-user-basis' }),
    inspect: async () => ({ config: structuredClone(state.user), layers: [{ name: { type: 'user', file: join(home, 'config.toml') }, version: 'owned-layer', config: structuredClone(state.user) }, ...state.nonUser] }) };
  return { directory, home, workspace, state, context, local: join(workspace, 'market'), close: () => rm(directory, { recursive: true, force: true }) };
}
Then('marketplace preparation confines local sources resource references and inherited configuration', async function () {
  for (const mode of ['home', 'escape', 'link', 'credential', 'ref', 'refoption', 'sparse', 'resource', 'inherited']) {
    const f = await hostContext();
    try {
      let method = 'marketplace/add', input = { source: f.local };
      if (mode === 'home') input.source = f.home;
      if (mode === 'escape') input.source = join(f.workspace, '../outside');
      if (mode === 'link') { await symlink(f.home, join(f.workspace, 'link')); input.source = join(f.workspace, 'link'); }
      if (mode === 'credential') input.source = 'https://user:password@example.test/repository.git';
      if (mode === 'ref') input.refName = 'main';
      if (mode === 'refoption') input = { source: 'owner/repository', refName: '--detach' };
      if (mode === 'sparse') input = { source: 'owner/repository', sparsePaths: ['../outside'] };
      if (mode === 'resource') await writeFile(join(f.local, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned', plugins: [{ name: 'escaped', source: { source: 'local', path: f.home } }] }));
      if (mode === 'inherited') { method = 'marketplace/remove'; input = { marketplaceName: 'owned' }; f.state.nonUser = [{ name: { type: 'project', dotCodexFolder: join(f.workspace, '.codex') }, config: { marketplaces: { owned: { source_type: 'local', source: f.local } } } }]; }
      await assert.rejects(prepareNativeMarketplace(method, input, f.context));
    } finally { await f.close(); }
  }
});
Then('marketplace effect verification rejects unrelated settings changed sources and false acknowledgements', async function () {
  for (const mode of ['valid', 'settings', 'source', 'destination', 'repeat']) {
    const f = await hostContext();
    try {
      const plan = await prepareNativeMarketplace('marketplace/add', { source: f.local }, f.context);
      f.state.user = { marketplaces: { owned: { source_type: 'local', source: f.local } } }; f.state.identity = { ...f.state.identity, configuration: 'c'.repeat(64) };
      const result = { marketplaceName: 'owned', installedRoot: f.local, alreadyAdded: false };
      if (mode === 'settings') f.state.user.model = 'unrequested';
      if (mode === 'source') await writeFile(join(f.local, 'changed.txt'), 'Changed after native dispatch.');
      if (mode === 'destination') result.installedRoot = f.home;
      if (mode === 'repeat') result.alreadyAdded = true;
      if (mode === 'valid') assert.deepEqual((await reviewNativeMarketplace(plan, result, f.context)).result, result);
      else await assert.rejects(reviewNativeMarketplace(plan, result, f.context));
    } finally { await f.close(); }
  }
});
Then('marketplace management and preference or agent grants cannot enable each other', async function () {
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() }, writes = [];
  for (const market of [false, true]) {
    const session = createCodexAgentSession({ identity: { ...identity }, authority: async () => ({ ...identity }), send() {}, write: frame => writes.push(frame), threads: new Map(),
      allowAgent: !market, allowConfigurationWrite: !market, allowMarketplaces: market, prepareMarketplace: async () => { throw new Error('Unexpected preparation.'); }, reviewMarketplace() {},
      prepareConfigurationWrite() {}, reviewConfigurationWrite() {}, configurationWriteAuthority() {} });
    try {
      for (const method of market ? ['config/value/write', 'thread/start', 'plugin/install'] : nativeMarketplaceMethods)
        await assert.rejects(session.request({ id: 'denied', method, params: {} }));
    } finally { session.close(); }
  }
  assert.equal(writes.length, 0);
});
Then('unverified marketplace effects and receipts never advance the encrypted pairing', { timeout: 120000 }, async function () {
  for (const mode of ['receiptMissing', 'receiptMethod', 'settings', 'source', 'credential', 'cancel']) {
    const controller = new AbortController();
    const c = await setup(this, {
      mutateFrames: frame => frame.type !== 'authority' ? [frame] : mode === 'receiptMissing' ? [] : mode === 'receiptMethod' ? [{ ...frame, method: 'config/value/write' }] : [frame],
      async seedRuntime(f) { if (mode === 'credential') await writeFile(join(f.marketplaces.local, '.agents/plugins/marketplace.json'), JSON.stringify({ name: f.backend.access, plugins: [] })); },
      async beforeReview(f) {
        f.reachedReview = true;
        if (mode === 'source') await writeFile(join(f.marketplaces.local, 'changed.txt'), 'Changed source.');
        if (mode === 'settings') { const path = join(f.home, 'config.toml'), text = await readFile(path, 'utf8'); await writeFile(path, text.replace('model="owned-account-model"', 'model="unrequested-model"'), { mode: 0o600 }); }
      },
      afterReview() { if (mode === 'cancel') controller.abort(); }
    });
    const before = structuredClone(c.v.storage.state.snapshot);
    await assert.rejects(c.execute('marketplace/add', { source: c.f.marketplaces.local }, controller.signal));
    await waitForWatch(() => c.f.starts === c.f.stops);
    assert.equal(c.f.reachedReview, true); assert.equal(c.adopted.length, 0); assert.deepEqual(c.v.storage.state.snapshot, before);
    assert.equal(c.f.frames.filter(f => nativeMarketplaceMethods.includes(f.method)).length, 1);
  }
});
Then('marketplace authority receipts bind exact methods inputs results and runtime ownership', async function () {
  const before = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const paramsHash = await nativeConfigurationWriteHash({ source: './owned' }), resultHash = await nativeConfigurationWriteHash({ marketplaceName: 'owned' });
  const frame = { type: 'authority', reason: 'configuration', requestId: 'owned_marketplace', method: 'marketplace/add', paramsHash, resultHash,
    beforeConfiguration: before.configuration, identity: { ...before, configuration: 'c'.repeat(64) } };
  assert.deepEqual(nativeConfigurationTransition(frame, before, 'marketplace/add', frame.requestId, paramsHash, resultHash), frame);
  for (const change of [{ method: 'config/value/write' }, { method: 'marketplace/remove' }, { requestId: 'foreign' }, { paramsHash: 'd'.repeat(64) }, { resultHash: 'd'.repeat(64) },
    { identity: { ...frame.identity, accountEpoch: randomUUID() } }, { identity: { ...frame.identity, workspace: 'd'.repeat(64) } }])
    assert.throws(() => nativeConfigurationTransition({ ...frame, ...change }, before, 'marketplace/add', frame.requestId, paramsHash, resultHash));
  assert.throws(() => nativeConfigurationWriteParams('config/value/write', { keyPath: 'marketplaces', value: {}, mergeStrategy: 'replace' }));
});
Then('actual SDK marketplace changes advance their encrypted binding and preserve later calls', { timeout: 90000 }, async function () {
  const c = await setup(this); assert.equal(c.connection.workflowFingerprint, undefined); const original = c.reference;
  const local = await c.execute('marketplace/add', { source: c.f.marketplaces.local });
  assert.equal(local.response.result.marketplaceName, 'owned-local-market'); assert.notDeepEqual(c.reference, original);
  await assert.rejects(c.v.session.executeNativeRuntime(original, c.selections, c.select('marketplace/upgrade'), {}));
  assert.equal((await c.execute('marketplace/add', { source: c.f.marketplaces.local })).response.result.alreadyAdded, true);
  const cloned = await c.execute('marketplace/add', { source: c.f.marketplaces.source, refName: 'main', sparsePaths: ['.agents/plugins'] });
  const root = cloned.response.result.installedRoot; assert.equal(root, join(c.f.home, '.tmp/marketplaces/owned-git-market'));
  await c.f.marketplaces.update(); const upgraded = await c.execute('marketplace/upgrade', { marketplaceName: 'owned-git-market' });
  assert.deepEqual(upgraded.response.result.upgradedRoots, [root]); assert.deepEqual(upgraded.response.result.errors, []);
  assert.equal(await readFile(join(root, 'marker.txt'), 'utf8'), 'owned updated marketplace\n');
  const all = await c.execute('marketplace/upgrade'); assert.deepEqual(all.response.result.selectedMarketplaces, ['owned-git-market']); assert.deepEqual(all.response.result.errors, []);
  const removedLocal = await c.execute('marketplace/remove', { marketplaceName: 'owned-local-market' }); assert.equal(removedLocal.response.result.installedRoot, null);
  await c.execute('marketplace/remove', { marketplaceName: 'owned-git-market' }); await assert.rejects(stat(root), e => e.code === 'ENOENT');
  assert.equal(await readFile(join(c.f.marketplaces.local, 'marker.txt'), 'utf8'), 'owned initial marketplace\n');
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1); assert.equal(c.adopted.length, 7);
  assert.equal(c.f.frames.filter(f => nativeMarketplaceMethods.includes(f.method)).length, 7);
  await assert.rejects(c.execute('config/value/write', { keyPath: 'model', value: 'ungranted', mergeStrategy: 'replace' }));
  assert.ok(!c.f.frames.some(f => ['thread/start', 'turn/start', 'config/value/write'].includes(f.method)));
});

Then('marketplace inputs preserve native optional values and report offending fields', function () {
  for (const [method, input] of [
    ['marketplace/add', { source: './owned-market' }],
    ['marketplace/add', { source: 'owner/repository', refName: null, sparsePaths: null }],
    ['marketplace/add', { source: 'https://owned-market.example.test/repository.git', refName: 'main', sparsePaths: ['.agents/plugins'] }],
    ['marketplace/remove', { marketplaceName: 'owned-market' }], ['marketplace/upgrade', {}], ['marketplace/upgrade', { marketplaceName: null }]])
    assert.deepEqual(nativeMarketplaceParams(method, input), input);
  for (const [method, input, field] of [
    ['marketplace/add', { source: null }, 'source'], ['marketplace/add', { source: './owned', refName: 1 }, 'refName'],
    ['marketplace/add', { source: './owned', sparsePaths: [false] }, 'sparsePaths'], ['marketplace/remove', {}, 'marketplaceName'],
    ['marketplace/upgrade', { marketplaceName: false }, 'marketplaceName'], ['marketplace/add', { source: './owned', model: 'override' }, 'model']])
    assert.throws(() => nativeMarketplaceParams(method, input), error => error.field === field);
});

Then('the pinned SDK registers local and Git marketplaces upgrades real revisions and removes only its owned clones', { timeout: 90000 }, async function () {
  const f = await nativeMarketplaceSdkFixture();
  const config = async () => (await f.call('config/read', { includeLayers: true })).config;
  try {
    const before = await config();
    const local = await f.call('marketplace/add', { source: f.marketplaces.local });
    assert.deepEqual(local, { marketplaceName: 'owned-local-market', installedRoot: f.marketplaces.local, alreadyAdded: false });
    assert.equal((await f.call('marketplace/add', { source: f.marketplaces.local })).alreadyAdded, true);
    const added = await f.call('marketplace/add', { source: f.marketplaces.source, refName: 'main', sparsePaths: ['.agents/plugins'] });
    assert.equal(added.marketplaceName, 'owned-git-market'); assert.equal(added.alreadyAdded, false);
    assert.ok(added.installedRoot.startsWith(f.home + '/'));
    assert.equal(await readFile(join(added.installedRoot, 'marker.txt'), 'utf8'), 'owned initial marketplace\n');
    const registered = await config();
    assert.equal(registered.marketplaces['owned-local-market'].source_type, 'local');
    assert.equal(registered.marketplaces['owned-local-market'].source, f.marketplaces.local);
    assert.equal(registered.marketplaces['owned-git-market'].source_type, 'git');
    assert.equal(registered.marketplaces['owned-git-market'].source, f.marketplaces.source);
    await f.marketplaces.update();
    const upgraded = await f.call('marketplace/upgrade', { marketplaceName: 'owned-git-market' });
    assert.deepEqual(upgraded.errors, []); assert.deepEqual(upgraded.selectedMarketplaces, ['owned-git-market']);
    assert.deepEqual(upgraded.upgradedRoots, [added.installedRoot]);
    assert.equal(await readFile(join(added.installedRoot, 'marker.txt'), 'utf8'), 'owned updated marketplace\n');
    const all = await f.call('marketplace/upgrade'); assert.deepEqual(all.errors, []); assert.deepEqual(all.selectedMarketplaces, ['owned-git-market']);
    const localRemoved = await f.call('marketplace/remove', { marketplaceName: 'owned-local-market' });
    assert.equal(localRemoved.marketplaceName, 'owned-local-market'); assert.equal(localRemoved.installedRoot, null);
    assert.equal(await readFile(join(f.marketplaces.local, 'marker.txt'), 'utf8'), 'owned initial marketplace\n');
    const removed = await f.call('marketplace/remove', { marketplaceName: 'owned-git-market' });
    assert.deepEqual(removed, { marketplaceName: 'owned-git-market', installedRoot: added.installedRoot });
    await assert.rejects(stat(added.installedRoot), e => e.code === 'ENOENT');
    const after = await config(); delete before.marketplaces; delete after.marketplaces; assert.deepEqual(after, before);
    assert.ok(!f.calls.some(c => ['thread/start', 'turn/start', 'plugin/install', 'plugin/share/save'].includes(c.method)));
  } finally { await f.close(); }
});
