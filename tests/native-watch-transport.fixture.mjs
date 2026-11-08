// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeFilesystemWatchScope } from '../src/lib/native-filesystem-watch.ts';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';

export async function nativeWatchTransportFixture(options = {}) {
  const f = await nativeHostFixture({ ...options, allowFilesystemWatch: options.allowFilesystemWatch ?? true,
    ...(options.real ? { runtimeFactory: async f => {
      await writeFile(join(f.workspace, 'watched.txt'), 'Initial watch contents.');
      const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, allowFilesystemWatch: true });
      return { authority: runtime.authority, prepareWatch: runtime.prepareWatch, reviewWatchChange: runtime.reviewWatchChange,
        async start(receive, exited) {
          f.starts++; const child = await runtime.start(receive, exited); let stopped = false;
          return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() {
            await child.close(); if (!stopped) { stopped = true; f.stops++; }
          } };
        } };
    } } : {}), onClose: f => f.sdkWatches?.clear(), onFrame(frame, f, receive) {
      if (options.onFrame?.(frame, f, receive) === true) return true;
      if (!['fs/watch', 'fs/unwatch'].includes(frame.method)) return false;
      f.sdkWatches ??= new Map();
      if (frame.method === 'fs/watch') f.sdkWatches.set(frame.params.watchId, frame.params.path);
      else f.sdkWatches.delete(frame.params.watchId);
      const reply = () => receive({ id: frame.id, result: frame.method === 'fs/watch' ? { path: frame.params.path } : {} });
      if (f.holdWatch && frame.method === 'fs/watch') (f.watchReplies ??= []).push(reply); else queueMicrotask(reply);
      return true;
    } });
  if (!options.real && f.workspace) await writeFile(join(f.workspace, 'watched.txt'), 'Initial watch contents.');
  f.emitWatch = (watchId, changedPaths = [join(f.workspace, 'watched.txt')]) => {
    if (!f.sdkWatches?.has(watchId)) return false;
    f.emit({ method: 'fs/changed', params: { watchId, changedPaths }, emittedAtMs: 1234 }); return true;
  };
  return f;
}
export async function waitForWatch(predicate, message = 'Watch transport transition timed out.') {
  const end = Date.now() + 4000;
  while (!predicate()) { assert.ok(Date.now() < end, message); await new Promise(resolve => setTimeout(resolve, 5)); }
}
export const watchTicketScope = () => ({ connectionId: randomUUID(), method: nativeFilesystemWatchScope, fingerprint: 'c'.repeat(64) });
export async function nativeWatchSocket(f) {
  const ticket = await f.ticket(watchTicketScope()); assert.equal(ticket.status, 200);
  const socket = await f.socket(ticket.value.ticket); assert.equal((await socket.next()).type, 'paired');
  socket.ws.send(JSON.stringify({ id: 'initialize', method: 'initialize', params: nativeInitializeParams() }));
  assert.equal((await socket.next()).id, 'initialize'); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  let sequence = 0;
  return { ...socket, ticket, async call(method, params) {
    const id = 'watch_' + ++sequence; socket.ws.send(JSON.stringify({ id, method, params }));
    await waitForWatch(() => socket.messages.some(frame => frame.id === id) || socket.ws.readyState === 3);
    const index = socket.messages.findIndex(frame => frame.id === id); assert.ok(index >= 0, 'The owned native request did not receive an acknowledgement.');
    const frame = socket.messages.splice(index, 1)[0]; assert.ok(Object.hasOwn(frame, 'result')); return { id, result: frame.result };
  } };
}
