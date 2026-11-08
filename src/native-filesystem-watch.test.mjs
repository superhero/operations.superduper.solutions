// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, symlink, link, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeFilesystemWatchFixture } from '../tests/native-filesystem-watch.fixture.mjs';
import { createCodexFilesystemWatchSession, prepareNativeFilesystemWatch } from '../companions/codex/filesystem-watch.mjs';
import { nativeFilesystemWatchParams, nativeFilesystemChange, nativeFilesystemChangeFrame, nativeFilesystemWatchLimits as limits } from './lib/native-filesystem-watch.ts';
import { NativeFilesystemWatchBroker } from './lib/secrets/native-filesystem-watch.ts';

Before({ tags: '@native-filesystem-watch-host' }, function () { this.watchHosts = []; });
After({ tags: '@native-filesystem-watch-host' }, async function () { for (const f of this.watchHosts.reverse()) await f.close(); });
async function setup(world, options) { const f = await nativeFilesystemWatchFixture(options); world.watchHosts.push(f); return f; }
const note = (f, watchId = 'owned', changedPaths = [join(f.workspace, 'watched.txt')]) => ({ method: 'fs/changed', params: { watchId, changedPaths } });

Then('native watch channels preserve acknowledgement order and reject notifications after unwatch', async function () {
  const f = await setup(this), frame = await f.scope.request({ id: 1, method: 'fs/watch', params: { watchId: 'owned', path: '.' } });
  await f.scope.receive({ ...note(f), emittedAtMs: 1234 }); assert.equal(f.delivered.length, 0);
  await f.scope.receive({ id: 1, result: { path: frame.params.path } });
  assert.deepEqual(f.delivered.map(v => v.method ?? 'ack'), ['ack', 'fs/changed']);
  assert.equal(f.delivered[1].emittedAtMs, 1234);
  await f.scope.request({ id: 2, method: 'fs/unwatch', params: { watchId: 'owned' } });
  await f.scope.receive(note(f)); await f.scope.receive({ id: 2, result: {} });
  const before = f.delivered.length; await assert.rejects(f.scope.receive(note(f))); assert.equal(f.delivered.length, before);
  const other = await setup(this); await other.request('fs/unwatch', { watchId: 'unknown' }); assert.deepEqual(other.delivered.at(-1).result, {});
});
Then('native watch paths reject private roots escaped aliases and recursive notifications', async function () {
  const f = await setup(this); await writeFile(join(f.home, 'private'), 'Private fixture.');
  await symlink(f.home, join(f.workspace, 'escape')); await link(join(f.home, 'private'), join(f.workspace, 'hard-link'));
  for (const path of ['..', f.home, 'escape', 'hard-link']) await assert.rejects(prepareNativeFilesystemWatch({ watchId: 'owned', path }, f.workspace, f.home));
  for (const mode of ['private', 'recursive', 'alias', 'relative']) {
    const owner = await setup(this); await mkdir(join(owner.workspace, 'nested')); await writeFile(join(owner.workspace, 'nested/file'), '');
    await writeFile(join(owner.home, 'private'), 'Private fixture.'); await symlink(owner.home, join(owner.workspace, 'escape'));
    const changedPaths = [mode === 'private' ? join(owner.home, 'private') : mode === 'recursive' ? join(owner.workspace, 'nested/file') : mode === 'alias' ? join(owner.workspace, 'escape') : 'relative'];
    await owner.request('fs/watch', { watchId: 'owned', path: '.' });
    await assert.rejects(owner.scope.receive(note(owner, 'owned', changedPaths))); assert.equal(owner.delivered.length, 1);
  }
  await f.request('fs/watch', { watchId: 'owned', path: '.' });
  await f.scope.receive(note(f, 'owned', [join(f.workspace, 'removed.txt')])); assert.equal(f.delivered.at(-1).method, 'fs/changed');
});
Then('native watch channels reject duplicate IDs malformed frames and notification overflow', async function () {
  const f = await setup(this); await f.request('fs/watch', { watchId: 'owned', path: '.' });
  await assert.rejects(f.scope.request({ id: 10, method: 'fs/watch', params: { watchId: 'owned', path: 'watched.txt' } }));
  for (const params of [{ watchId: '', path: '.' }, { watchId: 'owned', path: '.', command: 'pwd' }, { watchId: 'owned', path: 2 }]) assert.throws(() => nativeFilesystemWatchParams('fs/watch', params));
  for (const params of [{ watchId: 'owned', changedPaths: [] }, { watchId: 'owned', changedPaths: ['x'], privateToken: 'no' }, { watchId: 'owned', changedPaths: Array(limits.changedPaths + 1).fill('x') }]) assert.throws(() => nativeFilesystemChange(params));
  for (const emittedAtMs of [null, '123', -1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => nativeFilesystemChangeFrame({ ...note(f), emittedAtMs }));
  assert.throws(() => nativeFilesystemChangeFrame({ ...note(f), extra: 'unknown' }));
  const early = await setup(this); await early.scope.request({ id: 1, method: 'fs/watch', params: { watchId: 'owned', path: '.' } });
  for (let i = 0; i < limits.earlyEvents; i++) await early.scope.receive(note(early));
  await assert.rejects(early.scope.receive(note(early))); assert.equal(early.delivered.length, 0);
  const foreign = await setup(this); await foreign.request('fs/watch', { watchId: 'owned', path: '.' });
  await assert.rejects(foreign.scope.receive(note(foreign, 'foreign'))); assert.equal(foreign.delivered.length, 1);
});
Then('native watch root replacement and closure discard pending registration and events', async function () {
  const f = await setup(this); await f.request('fs/watch', { watchId: 'owned', path: 'watched.txt' });
  await writeFile(join(f.workspace, 'replacement'), 'New inode.'); await rename(join(f.workspace, 'replacement'), join(f.workspace, 'watched.txt'));
  await f.scope.receive(note(f)); assert.equal(f.delivered.length, 2);
  await assert.rejects(f.scope.receive(note(f)));
  let release; const prepared = await prepareNativeFilesystemWatch({ watchId: 'owned', path: '.' }, f.workspace, f.home), delivered = [];
  const scope = createCodexFilesystemWatchSession({ prepare: () => new Promise(resolve => { release = () => resolve(prepared); }), review: async () => {}, send: frame => delivered.push(frame) });
  const result = scope.request({ id: 1, method: 'fs/watch', params: { watchId: 'owned', path: '.' } });
  scope.close(); release(); await assert.rejects(result); assert.equal(delivered.length, 0);
});
Then('the real pinned native SDK preserves watch notifications and the unwatch barrier', { timeout: 30_000 }, async function () {
  const f = await setup(this, { real: true });
  assert.deepEqual(await f.request('fs/watch', { watchId: 'owned', path: 'watched.txt' }), { path: join(f.workspace, 'watched.txt') });
  const initial = f.delivered.filter(frame => frame.method === 'fs/changed').length;
  await writeFile(join(f.workspace, 'watched.txt'), 'A real native notification.');
  const end = Date.now() + 5000;
  while (f.delivered.filter(frame => frame.method === 'fs/changed').length <= initial) { assert.ok(Date.now() < end, 'Pinned SDK did not deliver the filesystem change.'); await f.drain(); await new Promise(resolve => setTimeout(resolve, 20)); }
  const change = f.delivered.filter(frame => frame.method === 'fs/changed').at(-1); assert.equal(change.params.watchId, 'owned'); assert.ok(change.params.changedPaths.includes(join(f.workspace, 'watched.txt')));
  assert.ok(Number.isSafeInteger(change.emittedAtMs) && change.emittedAtMs > 0);
  assert.deepEqual(await f.request('fs/unwatch', { watchId: 'owned' }), {});
  const before = f.delivered.filter(frame => frame.method === 'fs/changed').length;
  await writeFile(join(f.workspace, 'watched.txt'), 'After acknowledged unwatch.'); await new Promise(resolve => setTimeout(resolve, 500)); await f.drain();
  assert.equal(f.delivered.filter(frame => frame.method === 'fs/changed').length, before); assert.deepEqual(f.errors, []);
});

function deferredWatch() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function watchUntil(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'The controlled watch boundary did not settle.'); await new Promise(resolve => setTimeout(resolve, 0)); }
}
function privateWatch(world, options = {}) {
  const c = { channels: new Map(), requests: [], values: [], jobs: [], closes: 0, options };
  const runtime = {
    watching: id => c.channels.has(id),
    close(id) { const channel = c.channels.get(id); c.channels.delete(id); c.closes++; channel?.events.closed(); },
    async watchChannel(id, _host, _key, _fingerprint, identity, _guard, events) {
      const peer = { close: () => runtime.close(id), async request(method, params) {
        c.requests.push({ method, params });
        if (method === 'fs/watch') return options.register ? options.register(params) : { path: '/owned/watch' };
        assert.equal(method, 'fs/unwatch'); return options.unwatch ? options.unwatch(params) : {};
      } };
      c.channels.set(id, { peer, identity, events }); c.events = events;
      if (options.open) await options.open.promise;
      options.onOpen?.(c); return peer;
    }
  };
  c.broker = new NativeFilesystemWatchBroker(runtime);
  c.authority = { id: randomUUID(), host: 'https://owned.example.test', key: 'a'.repeat(43), fingerprint: 'b'.repeat(64),
    identity: { runtimeId: randomUUID(), generation: randomUUID(), configuration: 'c'.repeat(64), workspace: 'd'.repeat(64), accountEpoch: randomUUID(), version: '0.163.0' },
    guard: async () => { await options.guard?.(c); } };
  c.subscribe = (authority = c.authority, signal) => {
    const work = c.broker.subscribe(authority, { watchId: 'owned', path: '.' }, value => c.values.push(value), async value => options.sanitize ? options.sanitize(value, c) : value, signal);
    void work.catch(() => {}); c.jobs.push(work); return work;
  };
  c.note = () => ({ method: 'fs/changed', params: { watchId: 'owned', changedPaths: ['/owned/watch'] } });
  c.emit = (frame = c.note(), identity = c.authority.identity) => c.events.frame(frame, identity);
  world.watchHosts.push({ async close() { c.broker.clear(); await Promise.allSettled(c.jobs); } }); return c;
}

Then('private watch owners retain capacity stamps and explicit cancellation authority', async function () {
  const c = privateWatch(this), authorities = Array.from({ length: 4 }, () => ({ ...c.authority, id: randomUUID() }));
  const work = authorities.map(authority => c.subscribe(authority)); await watchUntil(() => c.values.length === 4);
  await assert.rejects(c.subscribe({ ...c.authority, id: randomUUID() }), { code: 'LIMIT' });
  await assert.rejects(c.subscribe({ ...authorities[0], key: 'e'.repeat(43) }), { code: 'CONFLICT' });
  await assert.rejects(work[0], { code: 'CONFLICT' });
  c.broker.close(authorities[1].id); await assert.rejects(work[1], { code: 'CANCELLED' });
  c.broker.clear(); await Promise.all(work.slice(2).map(value => assert.rejects(value, { code: 'CANCELLED' })));
  const cancelled = AbortSignal.abort();
  await assert.rejects(c.subscribe(c.authority, cancelled), { code: 'CANCELLED' });
  await assert.rejects(c.broker.unwatch(c.authority, { watchId: 'owned' }, cancelled), { code: 'CANCELLED' });
  assert.equal(c.channels.size, 0);
});

Then('private watch frames reject foreign owners malformed shapes and queued event overflow', async function () {
  for (const mode of ['identity', 'unknown-watch', 'malformed', 'overflow']) {
    const registration = deferredWatch(), c = privateWatch(this, mode === 'overflow' ? { register: () => registration.promise } : {}), work = c.subscribe();
    await watchUntil(() => mode === 'overflow' ? c.requests.length === 1 : c.values.length === 1);
    if (mode === 'overflow') {
      for (let index = 0; index < 32; index++) c.emit();
      assert.throws(() => c.emit(), { code: 'NATIVE_CONTRACT' }); registration.resolve({ path: '/owned/watch' });
    } else if (mode === 'identity') assert.throws(() => c.emit(c.note(), { ...c.authority.identity, workspace: 'e'.repeat(64) }), { code: 'AUTHORIZATION' });
    else if (mode === 'unknown-watch') assert.throws(() => c.emit({ ...c.note(), params: { ...c.note().params, watchId: 'foreign' } }), { code: 'NATIVE_CONTRACT' });
    else assert.throws(() => c.emit({ ...c.note(), params: { ...c.note().params, changedPaths: [] } }));
    await assert.rejects(work, { code: mode === 'identity' ? 'AUTHORIZATION' : 'NATIVE_CONTRACT' });
    assert.throws(() => c.emit(), { code: 'AUTHORIZATION' }); assert.equal(c.channels.size, 0);
  }
});

Then('private watch cancellation during opening registration and sanitation cannot publish late values', async function () {
  for (const phase of ['opening', 'ready', 'registration', 'sanitation', 'delivery']) {
    const gate = deferredWatch(), controller = new AbortController(); let c;
    const options = phase === 'opening' ? { open: gate }
      : phase === 'ready' ? { onOpen: () => { options.guard = owner => owner.broker.close(owner.authority.id); } }
      : phase === 'registration' ? { register: () => gate.promise }
      : { sanitize: async (value, owner) => { if (phase === 'sanitation') owner.broker.close(owner.authority.id); else if (value.notification) await gate.promise; return value; } };
    c = privateWatch(this, options); const work = c.subscribe(c.authority, controller.signal);
    if (phase === 'opening') { await watchUntil(() => c.channels.size === 1); c.broker.close(c.authority.id); gate.resolve(); }
    else if (phase === 'registration') { await watchUntil(() => c.requests.length === 1); controller.abort(); gate.resolve({ path: '/owned/watch' }); }
    else if (phase === 'delivery') {
      await watchUntil(() => c.values.length === 1); c.emit(); await new Promise(resolve => setTimeout(resolve, 0));
      controller.abort(); await watchUntil(() => c.requests.some(frame => frame.method === 'fs/unwatch')); gate.resolve();
    }
    await assert.rejects(work, { code: 'CANCELLED' }); assert.equal(c.values.length, phase === 'delivery' ? 1 : 0);
    await watchUntil(() => c.channels.size === 0);
  }
});

Then('private unwatch failures drain root loss and preserve the public failure boundary', async function () {
  for (const mode of ['request', 'root-lost', 'closed']) {
    const gate = deferredWatch(), failure = new Error('controlled transport failed');
    const c = privateWatch(this, { sanitize: async value => { if (value.notification && mode === 'root-lost') await gate.promise; return value; },
      unwatch: () => { if (mode === 'closed') { c.broker.close(c.authority.id); return {}; } throw failure; } });
    const work = c.subscribe(); await watchUntil(() => c.values.length === 1);
    if (mode === 'root-lost') { c.emit(); c.events.closed('root-lost'); }
    const stopping = c.broker.unwatch(c.authority, { watchId: 'owned' }); void stopping.catch(() => {});
    if (mode === 'root-lost') gate.resolve();
    await assert.rejects(stopping, mode === 'closed' ? { code: 'NATIVE_FILESYSTEM' } : error => error === failure);
    await assert.rejects(work, { code: mode === 'closed' ? 'CANCELLED' : mode === 'root-lost' ? 'NATIVE_FILESYSTEM' : 'NATIVE_CONTRACT' });
    assert.equal(c.channels.size, 0);
  }
});

Then('failed unwatch during cancellation closes delayed registrations without publishing their values', async function () {
  for (const delayed of [false, true]) {
    const registration = deferredWatch(), controller = new AbortController();
    const c = privateWatch(this, { ...(delayed ? { register: () => registration.promise } : {}), unwatch() { throw new Error('controlled unwatch failure'); } });
    const work = c.subscribe(c.authority, controller.signal);
    await watchUntil(() => delayed ? c.requests.length === 1 : c.values.length === 1); controller.abort();
    if (delayed) registration.resolve({ path: '/owned/watch' });
    await assert.rejects(work, { code: 'NATIVE_CONTRACT' });
    assert.equal(c.values.length, delayed ? 0 : 1); assert.equal(c.channels.size, 0);
  }
});

Then('unwatching an unknown private watch ID preserves the owned active subscription', async function () {
  const c = privateWatch(this), work = c.subscribe(); await watchUntil(() => c.values.length === 1);
  assert.deepEqual(await c.broker.unwatch(c.authority, { watchId: 'unknown' }), {});
  assert.equal(c.broker.active(c.authority.id), true); assert.equal(c.channels.size, 1);
  c.emit(); await watchUntil(() => c.values.length === 2);
  assert.deepEqual(await c.broker.unwatch(c.authority, { watchId: 'owned' }), {});
  assert.deepEqual(await work, c.values.at(-1)); assert.equal(c.channels.size, 0);
});
