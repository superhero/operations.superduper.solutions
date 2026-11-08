// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeWatchTransportFixture, waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { isNativeFilesystemWatchValue, nativeFilesystemWatchMethods } from './lib/native-filesystem-watch.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';

Before({ tags: '@native-watch-private' }, function () { this.privateWatches = []; });
After({ tags: '@native-watch-private' }, async function () {
  for (const { f, v } of this.privateWatches.reverse()) { v.session.lock(); await f.close(); }
});
async function setup(world, options) {
  const f = await nativeWatchTransportFixture(options), v = await nativeVaultFixture(f); world.privateWatches.push({ f, v });
  const source = await readServiceSchema('codex');
  const select = method => { const document = scopeNativeRpcSchema(source, method); return { document, operation: nativeRpcOperation(document, 'codex:' + method) }; };
  const paired = await v.session.pairNativeRuntime(v.input, v.selection), selections = nativeFilesystemWatchMethods.map(select);
  return { f, v, paired, selections, select };
}
function watch(context, watchId = 'owned', signal, path = '.') {
  const values = [], { v, paired, selections } = context;
  const result = v.session.executeNativeWatch(nativeReference(paired), v.selection, selections, { watchId, path }, signal, value => values.push(value));
  void result.catch(() => {}); return { values, result };
}
const unwatch = ({ v, paired, selections }, watchId = 'owned') => v.session.executeNativeUnwatch(nativeReference(paired), v.selection, selections, { watchId });
const stopped = f => waitForWatch(() => f.starts === f.stops, 'The owned SDK child did not stop.');
const calls = (f, method) => f.frames.filter(frame => frame.method === method);

Then('native watch worker admission preserves ordinary command serialization and bounded subscriptions', function () {
  for (const method of ['execute', 'put', 'unlock', 'loginNativeRuntime', 'nativeConnections', 'executeNativeUnwatch', 'executeNativeWatch']) {
    assert.equal(canStartVaultRequest([], method), true);
    for (const ordinary of ['execute', 'put', 'unlock', 'loginNativeRuntime', 'nativeConnections', 'executeNativeUnwatch']) {
      assert.equal(canStartVaultRequest([ordinary], method), false);
      assert.equal(canStartVaultRequest(['executeNativeWatch', ordinary], method), false);
    }
    assert.equal(canStartVaultRequest(Array(7).fill('executeNativeWatch'), method), true);
    assert.equal(canStartVaultRequest(Array(8).fill('executeNativeWatch'), method), method !== 'executeNativeWatch');
  }
});

Then('a private native watch publishes typed values until its explicit native unwatch', async function () {
  const c = await setup(this), { f, v } = c, w = watch(c);
  await waitForWatch(() => w.values.length === 1);
  assert.deepEqual(w.values[0], { protocol: 'json-rpc', result: { path: f.workspace } });
  assert.ok(f.emitWatch('owned')); await waitForWatch(() => w.values.length === 2);
  assert.deepEqual(w.values[1].notification, { method: 'fs/changed', params: { watchId: 'owned', changedPaths: [join(f.workspace, 'watched.txt')] }, emittedAtMs: 1234 });
  assert.ok(w.values.every(isNativeFilesystemWatchValue)); assert.equal(w.values.some(value => 'status' in value), false);
  assert.deepEqual((await unwatch(c)).response, { protocol: 'json-rpc', result: {} });
  assert.deepEqual((await w.result).response, w.values[1]); await stopped(f);
  assert.equal(calls(f, 'fs/unwatch').length, 1); assert.equal(f.emitWatch('owned'), false);
  const before = calls(f, 'fs/unwatch').length;
  assert.deepEqual((await unwatch(c, 'unknown-native-noop')).response.result, {});
  assert.equal(calls(f, 'fs/unwatch').length, before + 1, 'Unknown unwatch IDs must reach the SDK rather than fabricate success.');
  assert.equal(JSON.stringify(v.storage.state).includes(f.key), false); await stopped(f);
});

Then('private native watch cancellation owns one watch ID and preserves other subscriptions', async function () {
  const c = await setup(this), { f, v, paired, selections, select } = c, controller = new AbortController(), first = watch(c, 'first', controller.signal);
  await waitForWatch(() => first.values.length === 1);
  const second = watch(c, 'second'); await waitForWatch(() => second.values.length === 1);
  await assert.rejects(v.session.executeNativeWatch(nativeReference(paired), v.selection, selections, { watchId: 'second', path: '.' }), error => error.code === 'CONFLICT');
  const before = f.starts;
  for (const call of [() => v.session.checkNativeRuntime(nativeReference(paired), v.selection),
    () => v.session.executeNativeAccount(nativeReference(paired), v.selection, { refreshToken: false }),
    () => v.session.executeNativeInitialize(nativeReference(paired), v.selection, select('initialize'), nativeInitializeParams())]) {
    await assert.rejects(call(), error => error.code === 'CONFLICT'); assert.equal(f.starts, before);
  }
  controller.abort(); await assert.rejects(first.result, error => error.code === 'CANCELLED');
  assert.deepEqual(calls(f, 'fs/unwatch').map(frame => frame.params.watchId), ['first']);
  assert.equal(f.emitWatch('first'), false); assert.ok(f.emitWatch('second'));
  await waitForWatch(() => second.values.length === 2); assert.equal(f.starts - f.stops, 1);
  await unwatch(c, 'second'); await second.result; await stopped(f);
});

Then('private native watches reject missing grants altered selections and credential inputs', async function () {
  const disabled = await setup(this, { allowFilesystemWatch: false, allowAgent: true, allowMetadata: true, allowFilesystemRead: true, allowFilesystemWrite: true });
  await assert.rejects(watch(disabled).result, error => error.code === 'NATIVE_FILESYSTEM');
  assert.equal(calls(disabled.f, 'fs/watch').length, 0);
  const c = await setup(this), { f, v, paired, selections } = c, before = f.frames.length;
  for (const bad of [[], selections.toReversed(), [selections[0], { ...selections[1], operation: { ...selections[1].operation, id: 'codex:fs/remove' } }]]) {
    await assert.rejects(v.session.executeNativeWatch(nativeReference(paired), v.selection, bad, { watchId: 'owned', path: '.' }));
  }
  const secret = 'SYNTHETIC_PRIVATE_WATCH_INPUT_SECRET'; await v.session.put(null, { label: 'Watch input fixture', kind: 'secret', value: secret });
  await assert.rejects(watch(c, secret).result, error => error.code === 'REDACTED');
  await assert.rejects(v.session.executeNativeWatch(nativeReference(paired), v.selection, selections, { watchId: 'owned', path: '.', recursive: true }));
  assert.equal(f.frames.length, before);
});

Then('private native watch events withhold stale source and known credential values', async function () {
  for (const mode of ['source', 'secret', 'unknown-field']) {
    const c = await setup(this), { f, v } = c, secret = 'SYNTHETIC_PRIVATE_WATCH_EVENT_SECRET';
    if (mode === 'secret') {
      await v.session.put(null, { label: 'Watch event fixture', kind: 'secret', value: secret }); await writeFile(join(f.workspace, secret), 'Public contents.');
    }
    const w = watch(c); await waitForWatch(() => w.values.length === 1);
    if (mode === 'source') { v.enabled = false; f.emitWatch('owned'); }
    else if (mode === 'secret') f.emitWatch('owned', [join(f.workspace, secret)]);
    else f.emit({ method: 'fs/changed', params: { watchId: 'owned', changedPaths: [join(f.workspace, 'watched.txt')], accessToken: 'unclassified' } });
    await assert.rejects(w.result, error => mode === 'source' ? error.code === 'PERMISSION' : mode === 'secret' ? error.code === 'REDACTED' : error.code === 'NATIVE_FILESYSTEM');
    assert.equal(w.values.length, 1); await stopped(f);
  }
});

Then('credential mutation and vault locking revoke private native watches', async function () {
  for (const mode of ['credential', 'lock']) {
    const c = await setup(this), { f, v } = c, w = watch(c); await waitForWatch(() => w.values.length === 1);
    if (mode === 'credential') await v.session.put(null, { label: 'New watch epoch', kind: 'secret', value: 'SYNTHETIC_NEW_WATCH_CREDENTIAL' }); else v.session.lock();
    await assert.rejects(w.result, error => error.code === 'CANCELLED'); await stopped(f); assert.equal(w.values.length, 1);
  }
});

Then('a private native watch orders early events and cancellation across registration', async function () {
  for (const mode of ['event', 'cancel']) {
    const c = await setup(this), { f } = c, controller = new AbortController(); f.holdWatch = true;
    const w = watch(c, 'early', controller.signal); await waitForWatch(() => f.watchReplies?.length === 1);
    f.emitWatch('early'); if (mode === 'cancel') controller.abort();
    assert.equal(w.values.length, 0); f.watchReplies[0]();
    if (mode === 'cancel') {
      await assert.rejects(w.result, error => error.code === 'CANCELLED'); assert.equal(w.values.length, 0);
    } else {
      await waitForWatch(() => w.values.length === 2); assert.equal(w.values[0].notification, undefined);
      assert.equal(w.values[1].notification.params.watchId, 'early'); await unwatch(c, 'early'); await w.result;
    }
    assert.equal(calls(f, 'fs/watch').length, 1); assert.equal(calls(f, 'fs/unwatch').length, 1); await stopped(f);
  }
});

Then('private native root loss preserves the final notification and ends the subscription', async function () {
  const c = await setup(this), { f } = c, path = join(f.workspace, 'watched.txt'), w = watch(c, 'root', undefined, path);
  await waitForWatch(() => w.values.length === 1); await rm(path); f.emitWatch('root', [path]);
  await assert.rejects(w.result, error => error.code === 'NATIVE_FILESYSTEM');
  assert.deepEqual(w.values.map(value => value.notification?.params.changedPaths), [undefined, [path]]); await stopped(f);
});

Then('the encrypted private watch uses actual pinned SDK events and native unwatch acknowledgement', { timeout: 30_000 }, async function () {
  const c = await setup(this, { real: true }), { f } = c, path = join(f.workspace, 'watched.txt'), w = watch(c, 'real', undefined, path);
  await waitForWatch(() => w.values.length === 1); await writeFile(path, 'Actual SDK event through encrypted pairing and private publication.');
  await waitForWatch(() => w.values.some(value => value.notification?.params.changedPaths.includes(path)));
  assert.ok(Number.isSafeInteger(w.values.at(-1).notification.emittedAtMs));
  await unwatch(c, 'real'); const final = await w.result; assert.deepEqual(final.response, w.values.at(-1)); await stopped(f);
  assert.equal(calls(f, 'fs/watch').length, 1); assert.equal(calls(f, 'fs/unwatch').length, 1);
});
