// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativePluginInstallationSdkFixture } from '../tests/native-plugin-install-sdk.fixture.mjs';
import { ownedRemotePluginId } from '../tests/native-plugin-sdk.fixture.mjs';
import { nativeTlsFixture } from '../tests/native-runtime.fixture.mjs';
import { nativeCaCertificate } from '../companions/codex/tls.mjs';
import { nativePluginInstallParams, nativePluginInstallMethods } from './lib/native-plugin-install.ts';
import { nativePluginInstallFixture } from '../tests/native-plugin-install.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { isNativePairedOperation } from './lib/native-account.ts';
import { nativeConfigurationTransition, nativeConfigurationWriteHash, nativeConfigurationWriteParams } from './lib/native-configuration-write.ts';
import { prepareNativePluginInstall, reviewNativePluginInstall } from '../companions/codex/plugin-install.mjs';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Before({ tags: '@native-plugin-install' }, function () { this.pluginInstallFixtures = []; });
After({ tags: '@native-plugin-install' }, async function () { for (const c of this.pluginInstallFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativePluginInstallFixture(options);
  if (options.mutateFrames) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, settings) {
        if (name !== 'message') return super.addEventListener(name, listener, settings);
        return super.addEventListener(name, event => { for (const frame of options.mutateFrames(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) }); }, settings);
      }
    };
  }
  const v = await nativeVaultFixture(f), c = { f, v, adopted: [] }; world.pluginInstallFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, undefined,
    next => { c.reference = next; c.adopted.push(next); }).catch(error => { if (f.reviewFailure) error.message += '\nPrivate effect review: ' + f.reviewFailure; error.message += '\nOwned effect stages: ' + JSON.stringify(f.effectStages ?? []); throw error; }); return c;
}
Then('plugin management models preserve native responses portable graphs and isolated owner grants', async function () {
  const source = await readServiceSchema('codex');
  for (const method of nativePluginInstallMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined); assert.equal(isNativePairedOperation(method), true);
    assert.deepEqual(operation.rpc.workflowResult, document['x-operations-native-workflow'].wireResult);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document), doc = { version: 3, id: 'plugins', name: 'Plugins', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    assert.ok(operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
  }
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() }, writes = [];
  for (const plugin of [false, true]) {
    const session = createCodexAgentSession({ identity: { ...identity }, authority: async () => ({ ...identity }), send() {}, write: frame => writes.push(frame), threads: new Map(),
      allowAgent: !plugin, allowConfigurationWrite: !plugin, allowMarketplaces: !plugin, allowPluginsRead: !plugin, allowPluginManagement: plugin,
      preparePluginInstall: async () => { throw new Error('Unexpected plugin preparation.'); }, reviewPluginInstall() {}, configurationWriteAuthority() {} });
    try { for (const method of plugin ? ['config/value/write', 'thread/start', 'marketplace/add', 'plugin/read'] : nativePluginInstallMethods) await assert.rejects(session.request({ id: 'denied', method, params: {} })); }
    finally { session.close(); }
  }
  assert.equal(writes.length, 0);
});
Then('plugin authority receipts bind each method input result and unchanged nonconfiguration ownership', async function () {
  const before = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  for (const method of nativePluginInstallMethods) {
    const paramsHash = await nativeConfigurationWriteHash({ reason: 'Owned exact request' }), resultHash = await nativeConfigurationWriteHash({});
    const frame = { type: 'authority', reason: 'configuration', requestId: 'owned_plugin', method, paramsHash, resultHash, beforeConfiguration: before.configuration, identity: { ...before, configuration: 'c'.repeat(64) } };
    assert.deepEqual(nativeConfigurationTransition(frame, before, method, frame.requestId, paramsHash, resultHash), frame);
    for (const change of [{ method: nativePluginInstallMethods.find(m => m !== method) }, { method: 'config/value/write' }, { requestId: 'foreign' }, { paramsHash: 'd'.repeat(64) }, { resultHash: 'd'.repeat(64) },
      { identity: { ...frame.identity, accountEpoch: randomUUID() } }, { identity: { ...frame.identity, workspace: 'd'.repeat(64) } }])
      assert.throws(() => nativeConfigurationTransition({ ...frame, ...change }, before, method, frame.requestId, paramsHash, resultHash));
  }
  assert.throws(() => nativeConfigurationWriteParams('config/value/write', { keyPath: 'plugins', value: {}, mergeStrategy: 'replace' }));
});
async function effectFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-plugin-effects-')), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 }); await mkdir(workspace); await mkdir(join(workspace, '.git')); await writeFile(join(home, 'config.toml'), '', { mode: 0o600 });
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const state = { user: {}, nonUser: [], identity };
  const context = { home, workspace, capture: async () => ({ identity: { ...state.identity }, basis: 'owned-basis' }),
    inspect: async () => ({ config: structuredClone(state.user), layers: [{ name: { type: 'user', file: join(home, 'config.toml') }, version: 'owned', config: structuredClone(state.user) }, ...state.nonUser] }) };
  return { home, workspace, state, context, close: () => rm(directory, { recursive: true, force: true }) };
}
Then('plugin source preparation identifies escaped local files Git options npm registry credentials and mismatched remote IDs', async function () {
  for (const mode of ['local', 'escape', 'link', 'resource', 'git', 'gitCredentials', 'gitOption', 'npm', 'npmRegistry', 'npmPackage', 'remoteLegacy', 'remoteId']) {
    const f = await effectFixture();
    try {
      const market = join(f.workspace, '.agents/plugins/marketplace.json'), plugin = join(f.workspace, 'owned-plugin');
      await mkdir(join(f.workspace, '.agents/plugins'), { recursive: true }); await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
      await writeFile(join(market), JSON.stringify({ name: 'owned-market', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './owned-plugin' } }] }));
      await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '1.0.0', ...(mode === 'resource' ? { skills: f.home } : {}) }));
      if (mode === 'link') { await unlink(market); await symlink(join(f.home, 'config.toml'), market); }
      const source = mode.startsWith('git') ? { type: 'git', url: mode === 'gitCredentials' ? 'https://user:password@example.test/repo.git' : 'https://example.test/repo.git', refName: mode === 'gitOption' ? '--detach' : 'main', path: null, sha: null }
        : mode.startsWith('npm') ? { type: 'npm', package: mode === 'npmPackage' ? '--help' : '@owned/plugin', version: '1.0.0', registry: mode === 'npmRegistry' ? 'http://example.test/' : 'https://example.test/' }
        : mode.startsWith('remote') ? { type: 'remote' } : { type: 'local', path: plugin };
      f.context.read = async () => ({ plugin: { marketplaceName: mode.startsWith('remote') ? 'openai-curated-remote' : 'owned-market', summary: {
        id: 'owned-plugin@' + (mode.startsWith('remote') ? 'openai-curated-remote' : 'owned-market'), name: 'owned-plugin', source, remotePluginId: mode === 'remoteLegacy' ? 'plugins_legacy' : mode === 'remoteId' ? 'plugins~different' : null
      }, skills: [], hooks: [] } });
      const input = mode.startsWith('remote') ? { pluginName: mode === 'remoteLegacy' ? 'plugins_legacy' : ownedRemotePluginId, remoteMarketplaceName: 'openai-curated-remote' } : { pluginName: 'owned-plugin', marketplacePath: mode === 'escape' ? join(f.workspace, '../outside.json') : market };
      if (['local', 'git', 'npm', 'remoteLegacy'].includes(mode)) await prepareNativePluginInstall('plugin/install', input, f.context);
      else await assert.rejects(prepareNativePluginInstall('plugin/install', input, f.context));
    } finally { await f.close(); }
  }
});
Then('plugin reconciliation retains per pass failures and rejects unrelated cache settings and invalid deltas', async function () {
  for (const mode of ['empty', 'partial', 'metadata', 'settings', 'cache', 'nonuser', 'localdelta', 'duplicate', 'flags', 'failure']) {
    const f = await effectFixture();
    try {
      const cached = join(f.home, 'plugins/cache/openai-curated-remote/previous/1.0.0/.codex-plugin'); await mkdir(cached, { recursive: true });
      await writeFile(join(cached, 'plugin.json'), JSON.stringify({ name: 'previous', version: '1.0.0' }));
      const plan = await prepareNativePluginInstall('plugin/reconcile', { reason: 'Owned pass\nwith retained reason' }, f.context);
      const result = { changedPlugins: [], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] };
      if (mode === 'partial') result.failedRemotePluginIds = result.failedMaterializationRemotePluginIds = [ownedRemotePluginId];
      if (mode === 'settings') f.state.user.model = 'unrequested';
      if (mode === 'cache') await writeFile(join(cached, 'plugin.json'), '{}');
      if (mode === 'metadata') await writeFile(join(cached, 'plugin.json'), JSON.stringify({ name: 'previous', version: '1.0.0' }));
      if (mode === 'nonuser') f.state.nonUser.push({ name: { type: 'system', file: '/owned-system' }, config: {} });
      if (['localdelta', 'duplicate', 'flags'].includes(mode)) result.changedPlugins = [{ id: mode === 'localdelta' ? 'owned@local-market' : 'removed@workspace-directory', hasMcps: false, hasApps: false, hasHooks: false, hasSkills: mode === 'flags' ? 'yes' : true }];
      if (mode === 'duplicate') result.changedPlugins.push({ ...result.changedPlugins[0] });
      if (mode === 'failure') result.failedMaterializationRemotePluginIds = [ownedRemotePluginId];
      if (['empty', 'partial', 'metadata'].includes(mode)) assert.deepEqual((await reviewNativePluginInstall(plan, result, f.context)).result, result);
      else await assert.rejects(reviewNativePluginInstall(plan, result, f.context));
    } finally { await f.close(); }
  }
});
Then('actual SDK plugin effects update encrypted pairing across local remote and repeated reconciliation calls', { timeout: 120000 }, async function () {
  const c = await setup(this), original = c.reference, state = c.f.backend.installation;
  const local = await c.execute('plugin/install', { pluginName: 'owned-plugin', marketplacePath: c.f.backend.marketplacePath, installAttemptId: 'owned-local' });
  assert.equal(local.response.result.authPolicy, 'ON_INSTALL'); assert.deepEqual(local.response.result.appsNeedingAuth, []); assert.notDeepEqual(c.reference, original);
  assert.match(await readFile(join(c.f.home, 'plugins/cache/owned-market/owned-plugin/1.0.0/skills/owned-skill/SKILL.md'), 'utf8'), /Owned local fixture content/);
  await assert.rejects(c.v.session.executeNativeRuntime(original, c.selections, c.select('plugin/reconcile'), {}));
  await c.execute('plugin/uninstall', { pluginId: 'owned-plugin@owned-market' });
  await assert.rejects(stat(join(c.f.home, 'plugins/cache/owned-market/owned-plugin')), e => e.code === 'ENOENT');
  assert.match(await readFile(join(c.f.workspace, 'owned-plugin/skills/owned-skill/SKILL.md'), 'utf8'), /Owned local fixture content/);
  state.installed = true;
  const first = await c.execute('plugin/reconcile', { reason: 'Owned pass\nfirst version' });
  assert.ok(first.response.result.changedPlugins.some(p => p.id === 'owned-remote@openai-curated-remote' && p.hasSkills));
  state.version = '2.0.0'; const second = await c.execute('plugin/reconcile', { reason: null });
  assert.deepEqual(second.response.result.failedRemotePluginIds, []);
  assert.match(await readFile(join(c.f.home, 'plugins/cache/openai-curated-remote/owned-remote/2.0.0/skills/owned-skill/SKILL.md'), 'utf8'), /Bundle version 2.0.0/);
  assert.deepEqual((await c.execute('plugin/reconcile')).response.result, { changedPlugins: [], failedRemotePluginIds: [], failedMaterializationRemotePluginIds: [] });
  await c.execute('plugin/uninstall', { pluginId: ownedRemotePluginId });
  const installed = await c.execute('plugin/install', { pluginName: ownedRemotePluginId, remoteMarketplaceName: 'openai-curated-remote', installAttemptId: 'owned-remote' });
  assert.equal(installed.response.result.authPolicy, 'ON_USE'); assert.deepEqual(installed.response.result.appsNeedingAuth, []);
  await c.execute('plugin/uninstall', { pluginId: ownedRemotePluginId });
  await assert.rejects(stat(join(c.f.home, 'plugins/cache/openai-curated-remote/owned-remote')), e => e.code === 'ENOENT');
  assert.equal(state.actions.filter(a => a.path.endsWith('/install')).length, 1); assert.equal(state.actions.filter(a => a.path.endsWith('/uninstall')).length, 2);
  assert.ok(state.downloads.length >= 3); assert.ok(state.downloads.every(d => !d.authorization));
  assert.equal(c.adopted.length, 8); assert.equal(c.f.frames.filter(f => nativePluginInstallMethods.includes(f.method)).length, 8);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1);
  await assert.rejects(c.execute('config/value/write', { keyPath: 'model', value: 'ungranted', mergeStrategy: 'replace' }));
});
Then('unverified plugin effects cancellation source changes and receipt substitution never advance pairing', { timeout: 150000 }, async function () {
  for (const mode of ['receiptMissing', 'receiptMethod', 'settings', 'source', 'cache', 'cancel']) {
    const controller = new AbortController();
    const c = await setup(this, {
      mutateFrames: frame => frame.type !== 'authority' ? [frame] : mode === 'receiptMissing' ? [] : mode === 'receiptMethod' ? [{ ...frame, method: 'plugin/uninstall' }] : [frame],
      async beforeReview(f) {
        f.reachedReview = true;
        if (mode === 'source') await writeFile(join(f.workspace, 'owned-plugin/changed.txt'), 'Changed source.');
        if (mode === 'settings') { const path = join(f.home, 'config.toml'), text = await readFile(path, 'utf8'); await writeFile(path, text.replace('model="owned-account-model"', 'model="unrequested-model"'), { mode: 0o600 }); }
        if (mode === 'cache') { const path = join(f.home, 'plugins/cache/unrelated/plugin'); await mkdir(path, { recursive: true }); await writeFile(join(path, 'changed.txt'), 'Unrelated cache.'); }
      }, afterReview() { if (mode === 'cancel') controller.abort(); }
    });
    const before = structuredClone(c.v.storage.state.snapshot);
    await assert.rejects(c.execute('plugin/install', { pluginName: 'owned-plugin', marketplacePath: c.f.backend.marketplacePath }, controller.signal));
    await waitForWatch(() => c.f.starts === c.f.stops);
    assert.equal(c.f.reachedReview, true); assert.equal(c.adopted.length, 0); assert.deepEqual(c.v.storage.state.snapshot, before);
    assert.equal(c.f.frames.filter(f => nativePluginInstallMethods.includes(f.method)).length, 1);
  }
});
Then('the actual SDK reconciles listed workspace hooks with only its discovered trust hash changes', { timeout: 90000 }, async function () {
  const c = await setup(this, { workspaceHooks: true }), state = c.f.backend.installation;
  // Establish the owned child before publishing a new backend installation to it.
  assert.deepEqual((await c.execute('plugin/reconcile')).response.result.changedPlugins, []);
  state.installed = true;
  const reconciled = await c.execute('plugin/reconcile', { reason: 'Owned listed workspace hook trust' });
  assert.ok(reconciled.response.result.changedPlugins.some(p => p.id === 'owned-remote@workspace-directory' && p.hasHooks), JSON.stringify({ result: reconciled.response.result, downloads: state.downloads.length }));
  const config = await readFile(join(c.f.home, 'config.toml'), 'utf8'); assert.match(config, /trusted_hash\s*=\s*"sha256:[a-f0-9]{64}"/);
  assert.match(config, /model\s*=\s*"owned-account-model"/);
  await c.execute('plugin/uninstall', { pluginId: ownedRemotePluginId });
  await assert.rejects(stat(join(c.f.home, 'plugins/cache/workspace-directory/owned-remote')), e => e.code === 'ENOENT');
  const installed = await c.execute('plugin/install', { pluginName: ownedRemotePluginId, remoteMarketplaceName: 'workspace-directory' });
  assert.equal(installed.response.result.authPolicy, 'ON_USE'); assert.deepEqual(installed.response.result.appsNeedingAuth, []);
  assert.equal(c.adopted.length, 4);
});

Then('plugin management inputs preserve native sources correlation and reconciliation reasons', function () {
  for (const [method, input] of [
    ['plugin/install', { pluginName: 'owned', marketplacePath: '/owned/marketplace.json', installAttemptId: null }],
    ['plugin/install', { pluginName: ownedRemotePluginId, remoteMarketplaceName: 'openai-curated-remote', installAttemptId: 'owned-attempt' }],
    ['plugin/uninstall', { pluginId: 'owned@market' }], ['plugin/reconcile', {}], ['plugin/reconcile', { reason: null }], ['plugin/reconcile', { reason: 'Owned reason\nSecond line\tretained' }]])
    assert.deepEqual(nativePluginInstallParams(method, input), input);
  for (const [method, input, field] of [
    ['plugin/install', { pluginName: 'owned' }, 'marketplacePath'], ['plugin/install', { pluginName: 'owned', marketplacePath: '/owned', remoteMarketplaceName: 'remote' }, 'marketplacePath'],
    ['plugin/install', { pluginName: false, marketplacePath: '/owned' }, 'pluginName'], ['plugin/uninstall', { pluginId: 'bad\nID' }, 'pluginId'],
    ['plugin/reconcile', { reason: false }, 'reason'], ['plugin/install', { pluginName: 'owned', marketplacePath: '/owned', environment: {} }, 'environment']])
    assert.throws(() => nativePluginInstallParams(method, input), e => e.field === field);
});
Then('native CA roots require owned canonical bounded certificate files and retain their content identity', async function () {
  const tls = await nativeTlsFixture();
  try {
    const home = join(tls.directory, 'home'); await mkdir(home, { mode: 0o700 }); const path = join(home, 'ca.pem'); await writeFile(path, tls.cert, { mode: 0o600 });
    const uid = (await stat(home)).uid; assert.equal(await nativeCaCertificate(undefined, home, uid), null);
    const value = await nativeCaCertificate(path, home, uid); assert.equal(value.path, path); assert.match(value.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(nativeCaCertificate(join(tls.directory, 'cert'), home, uid));
    await symlink(path, join(home, 'link.pem')); await assert.rejects(nativeCaCertificate(join(home, 'link.pem'), home, uid));
    await chmod(path, 0o666); await assert.rejects(nativeCaCertificate(path, home, uid)); await chmod(path, 0o600);
    await link(path, join(home, 'hard.pem')); await assert.rejects(nativeCaCertificate(path, home, uid));
    await unlink(join(home, 'hard.pem')); await writeFile(path, Buffer.concat([tls.cert, Buffer.from('\n'), tls.cert]), { mode: 0o600 });
    assert.notEqual((await nativeCaCertificate(path, home, uid)).sha256, value.sha256);
    await writeFile(join(home, 'invalid.pem'), 'not a certificate', { mode: 0o600 }); await assert.rejects(nativeCaCertificate(join(home, 'invalid.pem'), home, uid));
    await writeFile(join(home, 'large.pem'), Buffer.alloc(65537), { mode: 0o600 }); await assert.rejects(nativeCaCertificate(join(home, 'large.pem'), home, uid));
  } finally { await tls.close(); }
});

Then('the actual SDK installs local and HTTPS remote plugins reconciles real bundles and uninstalls their owned state', { timeout: 90000 }, async function () {
  const f = await nativePluginInstallationSdkFixture(), state = f.backend.installation;
  try {
    const config = join(f.home, 'config.toml'); await writeFile(config, (await readFile(config, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
    state.installed = true;
    const first = await f.call('plugin/reconcile', { reason: 'Owned HTTPS bundle qualification' });
    assert.deepEqual(first.failedRemotePluginIds, []); assert.deepEqual(first.failedMaterializationRemotePluginIds, []);
    assert.ok(first.changedPlugins.some(p => p.id === 'owned-remote@openai-curated-remote' && p.hasSkills));
    const remote = join(f.home, 'plugins/cache/openai-curated-remote/owned-remote');
    assert.match(await readFile(join(remote, '1.0.0/skills/owned-skill/SKILL.md'), 'utf8'), /Bundle version 1.0.0/);
    state.version = '2.0.0';
    const second = await f.call('plugin/reconcile', { reason: null }); assert.deepEqual(second.failedRemotePluginIds, []);
    assert.ok(second.changedPlugins.some(p => p.id === 'owned-remote@openai-curated-remote' && p.hasSkills));
    assert.match(await readFile(join(remote, '2.0.0/skills/owned-skill/SKILL.md'), 'utf8'), /Bundle version 2.0.0/);
    await f.call('plugin/uninstall', { pluginId: ownedRemotePluginId });
    await assert.rejects(stat(remote), error => error.code === 'ENOENT');
    const local = await f.call('plugin/install', { pluginName: 'owned-plugin', marketplacePath: f.backend.marketplacePath, installAttemptId: 'owned-local-attempt' });
    assert.equal(local.authPolicy, 'ON_INSTALL'); assert.deepEqual(local.appsNeedingAuth, []);
    const current = (await f.call('config/read', { includeLayers: true })).config;
    assert.equal(current.plugins['owned-plugin@owned-market'].enabled, true);
    await f.call('plugin/uninstall', { pluginId: 'owned-plugin@owned-market' });
    assert.equal((await f.call('config/read', { includeLayers: true })).config.plugins?.['owned-plugin@owned-market'], undefined);
    await assert.rejects(stat(join(f.home, 'plugins/cache/owned-market/owned-plugin')), error => error.code === 'ENOENT');
    assert.match(await readFile(join(f.workspace, 'owned-plugin/skills/owned-skill/SKILL.md'), 'utf8'), /Owned local fixture content/);
    const installed = await f.call('plugin/install', { pluginName: ownedRemotePluginId, remoteMarketplaceName: 'openai-curated-remote', installAttemptId: 'owned-remote-attempt' });
    assert.equal(installed.authPolicy, 'ON_USE'); assert.deepEqual(installed.appsNeedingAuth, []);
    assert.equal(state.actions.filter(a => a.path.endsWith('/install')).length, 1);
    await f.call('plugin/uninstall', { pluginId: ownedRemotePluginId });
    assert.equal(state.actions.filter(a => a.path.endsWith('/uninstall')).length, 2);
    await assert.rejects(stat(remote), error => error.code === 'ENOENT');
    assert.ok(state.downloads.length >= 2); assert.ok(state.downloads.every(d => !d.authorization));
  } finally { await f.close(); }
});

Then('native HTTPS bundle downloads reject a trusted certificate for the wrong host', { timeout: 45000 }, async function () {
  const f = await nativePluginInstallationSdkFixture({ wrongHostname: true }), state = f.backend.installation;
  try {
    const path = join(f.home, 'config.toml'); await writeFile(path, (await readFile(path, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
    state.installed = true;
    const result = await f.call('plugin/reconcile');
    assert.deepEqual(result.failedRemotePluginIds, [ownedRemotePluginId]); assert.deepEqual(result.failedMaterializationRemotePluginIds, [ownedRemotePluginId]);
    assert.equal(state.downloads.length, 0);
    await assert.rejects(stat(join(f.home, 'plugins/cache/openai-curated-remote/owned-remote/1.0.0/.codex-plugin/plugin.json')), error => error.code === 'ENOENT');
  } finally { await f.close(); }
});
