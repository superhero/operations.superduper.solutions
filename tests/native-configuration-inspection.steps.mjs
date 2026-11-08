// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { seedNativeConfigurationRead, configurationSdkSecret } from './native-configuration-read.fixture.mjs';
import { waitForWatch } from './native-watch-transport.fixture.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { nativeConfigurationWriteFixture, nativeConfigurationWriteSocket } from './native-configuration-write.fixture.mjs';
import { nativeConfigurationTransition, nativeConfigurationWriteParams, nativeConfigurationWriteHash } from '../src/lib/native-configuration-write.ts';
import { reviewNativeConfigurationWrite } from '../companions/codex/configuration-write.mjs';

Before({ tags: '@native-configuration-inspection' }, function () { this.inspectionFixtures = []; this.inspectionTransports = []; });
After({ tags: '@native-configuration-inspection' }, async function () {
  for (const f of this.inspectionTransports.reverse()) await f.close();
  for (const c of this.inspectionFixtures.reverse()) {
    try { await c.child?.close(); } finally { await rm(c.directory, { recursive: true, force: true }); }
  }
});

async function transport(world, options) {
  const f = await nativeConfigurationWriteFixture(options); world.inspectionTransports.push(f);
  return { f, socket: await nativeConfigurationWriteSocket(f) };
}
async function verifiedWrite(socket, before, method, input) {
  const response = await socket.call(method, input); assert.ok(response.result);
  const frame = socket.messages.find(f => f.type === 'authority' && f.requestId === response.id); assert.ok(frame);
  const receipt = nativeConfigurationTransition(frame, before, method, response.id,
    await nativeConfigurationWriteHash(nativeConfigurationWriteParams(method, input)), await nativeConfigurationWriteHash(response.result));
  assert.equal(socket.messages.filter(f => f.type === 'authority' && f.requestId === response.id).length, 1);
  return receipt.identity;
}
Then('the paired host emits verified write receipts without granting agent access', { timeout: 60000 }, async function () {
  const { f, socket } = await transport(this, { allowConfigurationRead: false }); let identity = socket.ticket.value.identity;
  for (const [method, input] of [
    ['config/value/write', { keyPath: 'model', value: 'owned-host-model', mergeStrategy: 'replace' }],
    ['config/batchWrite', { edits: [{ keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' }], reloadUserConfig: true }],
    ['skills/config/write', { name: 'owned-configuration-skill', enabled: false }],
    ['skills/config/write', { name: 'owned-configuration-skill', enabled: true }]
  ]) identity = await verifiedWrite(socket, identity, method, input);
  assert.deepEqual(await f.privateRuntime.authority(), identity);
  const beforeConflict = structuredClone(identity), conflict = await socket.call('config/value/write', { keyPath: 'model', value: 'must-not-apply', mergeStrategy: 'replace', expectedVersion: 'stale-owned-version' });
  assert.equal(conflict.error.message, 'Native configuration write failed.');
  assert.ok(!socket.messages.some(f => f.requestId === conflict.id)); assert.deepEqual(await f.privateRuntime.authority(), beforeConflict);
  assert.ok((await socket.call('account/read', { refreshToken: false })).result);
  assert.equal(f.starts, 1); assert.equal(f.stops, 0);
  assert.ok(!JSON.stringify(socket.messages).includes(configurationSdkSecret));
  await assert.rejects(socket.call('thread/start', {}));
  await waitForWatch(() => f.starts === f.stops);
  assert.ok(!f.frames.some(f => f.method === 'thread/start'));
});
Then('the paired host retains its loaded thread after verified configuration changes', { timeout: 60000 }, async function () {
  const { f, socket } = await transport(this, { withMcp: true });
  const thread = await socket.call('thread/start', { model: 'owned-fixture-model' }); assert.ok(thread.result?.thread?.id);
  const input = { threadId: thread.result.thread.id, server: 'operations_fixture', tool: 'display_only', arguments: { message: 'before write' } };
  assert.ok(JSON.stringify((await socket.call('mcpServer/tool/call', input)).result).includes('before write'));
  await verifiedWrite(socket, socket.ticket.value.identity, 'config/value/write', { keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'replace' });
  assert.deepEqual((await socket.call('config/mcpServer/reload', {})).result, {});
  assert.ok(JSON.stringify((await socket.call('mcpServer/tool/call', { ...input, arguments: { message: 'after write' } })).result).includes('after write'));
  assert.equal(f.starts, 1); assert.equal(f.stops, 0);
  assert.ok(f.provider.requests.every(r => r.path.startsWith('/v1/models') && !r.hasAuthorization));
  assert.ok(!JSON.stringify(socket.messages).includes(configurationSdkSecret));
});
Then('the paired host withholds transitions for revoked cancelled or unrelated changes', { timeout: 60000 }, async function () {
  const input = { keyPath: 'model', value: 'owned-host-model', mergeStrategy: 'replace' };
  for (const mode of ['grant', 'user', 'project', 'after-review', 'cancel']) {
    let release, prepared = false;
    const wait = new Promise(resolve => { release = resolve; });
    const { f, socket } = await transport(this, { allowConfigurationWrite: mode !== 'grant',
      afterPrepare: mode === 'cancel' ? async () => { prepared = true; await wait; } : undefined,
      beforeReview: async f => {
        if (mode === 'user') await writeFile(join(f.home, 'config.toml'), 'review_model="unapproved"\n' + await readFile(join(f.home, 'config.toml'), 'utf8'));
        if (mode === 'project') { await mkdir(join(f.workspace, '.codex')); await writeFile(join(f.workspace, '.codex/config.toml'), 'model="unapproved"\n'); }
      },
      afterReview: mode === 'after-review' ? async f => { await writeFile(join(f.home, 'config.toml'), 'review_model="unapproved"\n' + await readFile(join(f.home, 'config.toml'), 'utf8')); } : undefined
    });
    const pending = socket.call('config/value/write', input); void pending.catch(() => {});
    if (mode === 'cancel') { await waitForWatch(() => prepared); await socket.close(); release(); }
    await assert.rejects(pending); await waitForWatch(() => f.starts === f.stops);
    assert.ok(!socket.messages.some(f => f.type === 'authority'));
    if (mode === 'grant' || mode === 'cancel') assert.ok(!f.frames.some(f => f.method === 'config/value/write'));
  }
});
async function fixture(world, granted) {
  const directory = await mkdtemp(join(tmpdir(), 'native-config-inspection-')), c = { directory, frames: [] }; world.inspectionFixtures.push(c);
  c.home = join(directory, 'home'); c.workspace = join(directory, 'workspace'); await mkdir(c.home, { mode: 0o700 }); await mkdir(c.workspace);
  await seedNativeConfigurationRead(c.home, c.workspace);
  c.runtime = await openCodexRuntime({ runtimeId: randomUUID(), home: c.home, workspace: c.workspace,
    executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
    allowConfigurationWrite: granted, allowAgent: !granted, allowConfigurationRead: !granted, allowConfigurationControl: !granted });
  let ready;
  c.initialized = new Promise(resolve => { ready = resolve; });
  c.child = await c.runtime.start(frame => { c.frames.push(structuredClone(frame)); if (frame.id === 'owned_init') ready(frame); }, () => { c.exited = true; });
  return c;
}
async function initialize(c) {
  c.child.send({ id: 'owned_init', method: 'initialize', params: nativeInitializeParams() });
  let timer;
  try {
    const response = await Promise.race([c.initialized, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned SDK initialization timed out.')), 10000); })]);
    assert.ok(response.result); c.child.send({ method: 'initialized' });
  } finally { clearTimeout(timer); }
}
const userLayer = result => result.layers.find(layer => layer.name.type === 'user');
Then('private configuration inspection retains actual SDK versions and withholds raw replies', { timeout: 60000 }, async function () {
  const c = await fixture(this, true);
  await assert.rejects(c.runtime.inspectConfiguration(), /unavailable/); await initialize(c);
  const identity = await c.runtime.authority(), before = await readFile(join(c.home, 'config.toml'));
  const first = c.runtime.inspectConfiguration(); await assert.rejects(c.runtime.inspectConfiguration(), /already pending/);
  const raw = await first, layer = userLayer(raw); assert.ok(layer); assert.equal(typeof layer.version, 'string');
  assert.equal(raw.config.model, 'owned-fixture-model'); assert.ok(JSON.stringify(raw).includes(configurationSdkSecret));
  assert.equal(userLayer(await c.runtime.inspectConfiguration()).version, layer.version);
  assert.deepEqual(await c.runtime.authority(), identity); assert.deepEqual(await readFile(join(c.home, 'config.toml')), before);
  assert.equal(JSON.stringify(c.frames).includes(configurationSdkSecret), false);
  assert.ok(c.frames.every(frame => !String(frame.id ?? '').startsWith('operations/private/config/')));
  assert.throws(() => c.child.send({ id: 'operations/private/config/forged', method: 'config/read', params: { includeLayers: true } }), /Reserved/);
  const pending = c.runtime.inspectConfiguration(); void pending.catch(() => {}); const closed = c.child.close();
  await assert.rejects(pending, /unavailable/); await closed; assert.equal(c.exited, true);
  await assert.rejects(c.runtime.inspectConfiguration(), /unavailable/);
});
Then('private configuration inspection requires its grant and masks SDK errors', { timeout: 60000 }, async function () {
  const denied = await fixture(this, false); await initialize(denied);
  await assert.rejects(denied.runtime.inspectConfiguration(), /unavailable/);
  const c = await fixture(this, true); await initialize(c); const original = await readFile(join(c.home, 'config.toml'));
  await writeFile(join(c.home, 'config.toml'), 'model = "' + configurationSdkSecret + '\n');
  await assert.rejects(c.runtime.inspectConfiguration(), e => e.message === 'Native configuration inspection failed.');
  assert.ok(c.frames.every(frame => !String(frame.id ?? '').startsWith('operations/private/config/')));
  await writeFile(join(c.home, 'config.toml'), original);
  assert.equal((await c.runtime.inspectConfiguration()).config.model, 'owned-fixture-model');
});

async function sdkRequest(c, method, params) {
  const id = 'owned_sdk_' + randomUUID().replaceAll('-', '_'); c.child.send({ id, method, params });
  await waitForWatch(() => c.frames.some(f => f.id === id), 'Owned SDK write response timed out.');
  return c.frames.find(f => f.id === id);
}
Then('owned SDK configuration writes preserve versions selectors and private provider settings', { timeout: 60000 }, async function () {
  const c = await fixture(this, true); await initialize(c);
  const before = await c.runtime.inspectConfiguration(), original = userLayer(before);
  const write = await sdkRequest(c, 'config/value/write', { keyPath: 'model', value: 'owned-persisted-model', mergeStrategy: 'replace', expectedVersion: original.version });
  assert.ok(write.result); const afterValue = userLayer(await c.runtime.inspectConfiguration());
  assert.notEqual(write.result.version, original.version); assert.equal(afterValue.version, write.result.version); assert.equal(afterValue.config.model, 'owned-persisted-model');
  const stale = await sdkRequest(c, 'config/value/write', { keyPath: 'model', value: 'must-not-be-written', mergeStrategy: 'replace', expectedVersion: original.version });
  assert.ok(stale.error); assert.equal(userLayer(await c.runtime.inspectConfiguration()).version, afterValue.version);
  const batch = await sdkRequest(c, 'config/batchWrite', { edits: [{ keyPath: 'model', value: 'owned-batch-model', mergeStrategy: 'replace' }, { keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' }], expectedVersion: afterValue.version, reloadUserConfig: true });
  assert.ok(batch.result); const afterBatch = userLayer(await c.runtime.inspectConfiguration());
  assert.equal(afterBatch.config.model, 'owned-batch-model'); assert.equal(afterBatch.config.model_reasoning_effort, 'high'); assert.equal(afterBatch.version, batch.result.version);
  for (const selector of [{ path: join(c.workspace, '.agents/skills/owned-configuration-skill/SKILL.md') }, { name: 'owned-configuration-skill' }]) {
    const disabled = await sdkRequest(c, 'skills/config/write', { ...selector, enabled: false }); assert.deepEqual(disabled.result, { effectiveEnabled: false });
    const layer = userLayer(await c.runtime.inspectConfiguration()); assert.ok(layer.config.skills.config.some(entry => entry.enabled === false));
    const enabled = await sdkRequest(c, 'skills/config/write', { ...selector, enabled: true }); assert.deepEqual(enabled.result, { effectiveEnabled: true });
    assert.deepEqual(userLayer(await c.runtime.inspectConfiguration()).config, afterBatch.config);
  }
  const final = userLayer(await c.runtime.inspectConfiguration());
  assert.deepEqual(final.config.model_providers, original.config.model_providers);
  assert.equal(JSON.stringify(c.frames).includes(configurationSdkSecret), false);
});

Then('host verification accepts exactly the owned SDK preference and skill edits', { timeout: 60000 }, async function () {
  const c = await fixture(this, true); await initialize(c);
  const path = '.agents/skills/owned-configuration-skill/SKILL.md';
  for (const [method, input] of [
    ['config/value/write', { keyPath: 'model', value: 'verified-model', mergeStrategy: 'replace' }],
    ['config/batchWrite', { edits: [{ keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'upsert' }, { keyPath: 'analytics.enabled', value: true, mergeStrategy: 'replace' }] }],
    ['skills/config/write', { path, enabled: false }], ['skills/config/write', { path, enabled: true }],
    ['skills/config/write', { name: 'owned-configuration-skill', enabled: false }], ['skills/config/write', { name: 'owned-configuration-skill', enabled: true }],
    ['config/value/write', { keyPath: 'model', value: null, mergeStrategy: 'replace' }],
    ['config/value/write', { keyPath: 'analytics.enabled', value: null, mergeStrategy: 'replace' }],
    ['config/batchWrite', { edits: [] }]
  ]) {
    const before = await c.runtime.authority(), context = await c.runtime.prepareConfigurationWrite(method, input);
    const response = await sdkRequest(c, method, context.params); assert.ok(response.result);
    const verified = await c.runtime.reviewConfigurationWrite(context, response.result);
    assert.deepEqual(verified.result, response.result);
    assert.deepEqual({ ...verified.identity, configuration: before.configuration }, before);
  }
  assert.equal(JSON.stringify(c.frames).includes(configurationSdkSecret), false);
});
Then('host verification rejects unrelated user and workspace changes', { timeout: 60000 }, async function () {
  for (const mode of ['user', 'project', 'inode']) {
    const c = await fixture(this, true); await initialize(c);
    const context = await c.runtime.prepareConfigurationWrite('config/value/write', { keyPath: 'model', value: 'owned-change', mergeStrategy: 'replace' });
    if (mode === 'inode') {
      await rename(c.workspace, c.workspace + '-old'); await mkdir(c.workspace);
      assert.equal((await c.runtime.authority()).workspace, context.before.identity.workspace);
      await assert.rejects(c.runtime.configurationWriteAuthority(context), /Non-user configuration authority/); continue;
    }
    const response = await sdkRequest(c, 'config/value/write', context.params); assert.ok(response.result);
    if (mode === 'user') {
      const file = join(c.home, 'config.toml'); await writeFile(file, 'review_model="unapproved"\n' + await readFile(file, 'utf8'));
      await assert.rejects(c.runtime.reviewConfigurationWrite(context, response.result), /outside the requested/);
    } else {
      await mkdir(join(c.workspace, '.codex')); await writeFile(join(c.workspace, '.codex/config.toml'), 'model="unapproved-project"\n');
      await assert.rejects(c.runtime.reviewConfigurationWrite(context, response.result), /Non-user configuration authority/);
    }
  }
});
Then('host verification rejects changes to SDK layers beyond its local file hashes', { timeout: 60000 }, async function () {
  const c = await fixture(this, true); await initialize(c);
  const context = await c.runtime.prepareConfigurationWrite('config/value/write', { keyPath: 'model', value: 'owned-layer-model', mergeStrategy: 'replace' });
  const response = await sdkRequest(c, 'config/value/write', context.params), snapshot = await c.runtime.inspectConfiguration(); assert.ok(response.result);
  const capture = async () => ({ identity: await c.runtime.authority(), basis: context.before.basis });
  await reviewNativeConfigurationWrite(context, response.result, { workspace: c.workspace, home: c.home, capture, inspect: async () => snapshot });
  const changed = structuredClone(snapshot); changed.layers.push({ name: { type: 'system', file: '/owned-system/config.toml' }, config: { model: 'unapproved' }, version: 'unowned-system-version' });
  await assert.rejects(reviewNativeConfigurationWrite(context, response.result, { workspace: c.workspace, home: c.home, capture, inspect: async () => changed }), /Non-user SDK configuration layers/);
});
Then('host write preparation rejects missing grants and unsafe configuration destinations', { timeout: 60000 }, async function () {
  const input = { keyPath: 'model', value: 'owned-change', mergeStrategy: 'replace' }, denied = await fixture(this, false); await initialize(denied);
  await assert.rejects(async () => denied.runtime.prepareConfigurationWrite('config/value/write', input), /not granted/);
  for (const mode of ['destination', 'skill', 'missing-skill', 'symlink', 'hardlink']) {
    const c = await fixture(this, true); await initialize(c);
    if (mode === 'destination') await assert.rejects(c.runtime.prepareConfigurationWrite('config/value/write', { ...input, filePath: '/outside/config.toml' }), e => e.field === 'filePath');
    else if (mode === 'skill') await assert.rejects(c.runtime.prepareConfigurationWrite('skills/config/write', { path: '../home/config.toml', enabled: false }), e => e.field === 'path');
    else if (mode === 'missing-skill') await assert.rejects(c.runtime.prepareConfigurationWrite('skills/config/write', { path: 'missing/skill', enabled: false }), e => e.field === 'path');
    else {
      const file = join(c.home, 'config.toml');
      if (mode === 'symlink') { const saved = join(c.workspace, 'outside.toml'); await rename(file, saved); await symlink(saved, file); }
      else await link(file, join(c.workspace, 'linked.toml'));
      await assert.rejects(c.runtime.prepareConfigurationWrite('config/value/write', input), e => e.field === 'filePath');
    }
  }
});
