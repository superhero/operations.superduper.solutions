// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile, symlink, link, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeFilesystemWatchFixture } from '../tests/native-filesystem-watch.fixture.mjs';
import { createCodexFilesystemWatchSession, prepareNativeFilesystemWatch } from '../companions/codex/filesystem-watch.mjs';
import { nativeFilesystemWatchParams, nativeFilesystemChange, nativeFilesystemChangeFrame, nativeFilesystemWatchLimits as limits } from './lib/native-filesystem-watch.ts';

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
