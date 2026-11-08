// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeWatchTransportFixture, nativeWatchSocket, watchTicketScope, waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Before({ tags: '@native-watch-transport' }, function () { this.watchTransports = []; });
After({ tags: '@native-watch-transport' }, async function () { for (const f of this.watchTransports.reverse()) await f.close(); });
async function setup(world, options) { const f = await nativeWatchTransportFixture(options); world.watchTransports.push(f); return f; }
const notices = socket => socket.messages.filter(frame => frame.method === 'fs/changed');
Then('native watch transport permissions are independent and reject unrelated RPCs', async function () {
  const disabled = await setup(this, { allowFilesystemWatch: false, allowAgent: true, allowMetadata: true, allowApps: true, allowFilesystemRead: true, allowFilesystemWrite: true });
  assert.equal((await disabled.ticket(watchTicketScope())).status, 400); assert.equal(disabled.starts, 0);
  const f = await setup(this);
  for (const method of ['codex-workflow', 'model/list', 'app/list', 'fs/readFile', 'fs/writeFile']) assert.equal((await f.ticket({ ...watchTicketScope(), method })).status, 400);
  const socket = await nativeWatchSocket(f);
  socket.ws.send(JSON.stringify({ id: 'unrelated', method: 'fs/writeFile', params: { path: 'x', dataBase64: '' } }));
  await waitForWatch(() => socket.ws.readyState === 3 && f.stops === f.starts);
  assert.equal(f.frames.some(frame => frame.method === 'fs/writeFile'), false);
});
Then('the authenticated watch transport forwards only owned notifications before unwatch', async function () {
  const f = await setup(this), socket = await nativeWatchSocket(f);
  assert.deepEqual((await socket.call('fs/watch', { watchId: 'owned', path: '.' })).result, { path: f.workspace });
  f.emitWatch('owned'); await waitForWatch(() => notices(socket).length === 1);
  assert.deepEqual(notices(socket)[0], { method: 'fs/changed', params: { watchId: 'owned', changedPaths: [join(f.workspace, 'watched.txt')] }, emittedAtMs: 1234 });
  assert.deepEqual((await socket.call('fs/unwatch', { watchId: 'owned' })).result, {}); assert.equal(f.emitWatch('owned'), false);
  f.emit({ method: 'fs/changed', params: { watchId: 'owned', changedPaths: [join(f.workspace, 'watched.txt')] } });
  await waitForWatch(() => socket.ws.readyState === 3 && f.stops === f.starts); assert.equal(notices(socket).length, 1);
});
Then('account and workspace drift during native watch review close the owned channel', async function () {
  for (const field of ['accountEpoch', 'workspace']) {
    const f = await setup(this), socket = await nativeWatchSocket(f); await socket.call('fs/watch', { watchId: 'owned', path: '.' });
    let release, entered = false; f.onWatchReview = () => new Promise(resolve => { entered = true; release = resolve; });
    f.emitWatch('owned'); await waitForWatch(() => entered);
    f.identity[field] = field === 'workspace' ? 'd'.repeat(64) : crypto.randomUUID(); release();
    await waitForWatch(() => socket.ws.readyState === 3 && f.stops === f.starts);
    assert.equal(notices(socket).length, 0); assert.equal(f.sdkWatches.size, 0);
  }
});
Then('native watch cancellation stops acknowledged subscriptions and rejects ticket reuse', async function () {
  const f = await setup(this), socket = await nativeWatchSocket(f);
  const response = await socket.call('fs/watch', { watchId: 'owned', path: 'watched.txt' });
  socket.ws.send(JSON.stringify({ type: 'cancel', id: response.id }));
  await waitForWatch(() => socket.ws.readyState === 3 && f.stops === f.starts); assert.equal(f.sdkWatches.size, 0);
  const before = f.starts, replay = await f.socket(socket.ticket.value.ticket);
  await waitForWatch(() => replay.ws.readyState === 3); assert.equal(f.starts, before);
});
Then('native watch transport denies foreign origins and invalid pairing credentials', async function () {
  const f = await setup(this);
  assert.equal((await f.ticket(watchTicketScope(), { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.ticket(watchTicketScope(), { Authorization: 'Bearer ' + 'x'.repeat(43) })).status, 401);
  assert.equal(f.starts, 0);
});
Then('native watch transport delivers only the terminal known root after root removal', async function () {
  const f = await setup(this), socket = await nativeWatchSocket(f);
  const path = join(f.workspace, 'watched.txt'); await socket.call('fs/watch', { watchId: 'owned', path });
  await rm(path); f.emitWatch('owned');
  await waitForWatch(() => socket.ws.readyState === 3 && f.stops === f.starts);
  assert.deepEqual(notices(socket).map(frame => frame.params.changedPaths), [[path]]); assert.equal(f.sdkWatches.size, 0);
});
Then('the pinned SDK watch lifecycle crosses authenticated HTTPS and WSS', { timeout: 30_000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeWatchSocket(f);
  const path = join(f.workspace, 'watched.txt'); assert.deepEqual((await socket.call('fs/watch', { watchId: 'real-owned', path })).result, { path });
  const before = notices(socket).length; await writeFile(path, 'Actual SDK change through the authenticated host.');
  await waitForWatch(() => notices(socket).length > before);
  assert.ok(notices(socket).at(-1).params.changedPaths.includes(path)); assert.ok(Number.isSafeInteger(notices(socket).at(-1).emittedAtMs));
  assert.deepEqual((await socket.call('fs/unwatch', { watchId: 'real-owned' })).result, {});
  const stopped = notices(socket).length; await writeFile(path, 'After the actual unwatch barrier.'); await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(notices(socket).length, stopped); await socket.close(); await waitForWatch(() => f.starts === f.stops);
});
Then('the pinned SDK reports the terminal root before its authenticated watch channel closes', { timeout: 30_000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeWatchSocket(f), path = join(f.workspace, 'watched.txt');
  await socket.call('fs/watch', { watchId: 'real-root-loss', path });
  await rm(path); await waitForWatch(() => socket.ws.readyState === 3 && f.starts === f.stops);
  assert.deepEqual(notices(socket).map(frame => frame.params.changedPaths), [[path]]);
});
