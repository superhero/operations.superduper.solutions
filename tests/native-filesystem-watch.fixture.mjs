// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCodexFilesystemWatchSession, prepareNativeFilesystemWatch, reviewNativeFilesystemChange } from '../companions/codex/filesystem-watch.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';

export async function nativeFilesystemWatchFixture({ real = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'operations-native-watch-')), workspace = join(directory, 'workspace'), home = join(directory, 'home');
  await mkdir(workspace, { mode: 0o700 }); await mkdir(home, { mode: 0o700 }); await writeFile(join(workspace, 'watched.txt'), 'Initial contents.');
  const f = { directory, workspace, home, delivered: [], requests: [], errors: [], closed: false, sequence: 0 };
  const waiting = new Map(); let child, receiveSequence = Promise.resolve();
  f.scope = createCodexFilesystemWatchSession({
    prepare: p => prepareNativeFilesystemWatch(p, workspace, home),
    review: (root, paths) => reviewNativeFilesystemChange(root, paths, workspace, home),
    send(frame) {
      f.delivered.push(structuredClone(frame));
      if (Object.hasOwn(frame, 'id')) { const pending = waiting.get(frame.id); waiting.delete(frame.id); pending?.resolve(frame.result); }
    }
  });
  const receive = frame => {
    receiveSequence = receiveSequence.then(async () => {
      if (f.closed) return;
      if (!await f.scope.receive(frame)) {
        const pending = waiting.get(frame.id);
        if (pending) { waiting.delete(frame.id); if (frame.error) pending.reject(new Error('Native SDK rejected request.')); else pending.resolve(frame.result); }
      }
    }).catch(error => {
      f.errors.push(error.message + ' ' + JSON.stringify({ keys: Object.keys(frame), method: frame.method,
        paramsKeys: frame.params && typeof frame.params === 'object' ? Object.keys(frame.params) : [], resultKeys: frame.result && typeof frame.result === 'object' ? Object.keys(frame.result) : [] })); f.scope.close();
      for (const pending of waiting.values()) pending.reject(error); waiting.clear();
      void child?.close();
    });
  };
  if (real) {
    if (!process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY || !process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256) throw new Error('Pinned watch qualification binary is required.');
    const runtime = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
      binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace });
    child = await runtime.start(receive, () => {
      f.closed = true;
      for (const pending of waiting.values()) pending.reject(new Error('Owned watch runtime closed.')); waiting.clear();
    });
    try {
      await new Promise((resolve, reject) => {
        const id = ++f.sequence, timer = setTimeout(() => reject(new Error('Pinned watch initialization timed out.')), 5000);
        waiting.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        child.send({ id, method: 'initialize', params: nativeInitializeParams() });
      }); child.send({ method: 'initialized' });
    } catch (error) { f.scope.close(); await child.close(); await rm(directory, { recursive: true, force: true }); throw error; }
  }
  f.request = async (method, params) => {
    const id = ++f.sequence, frame = await f.scope.request({ id, method, params }); f.requests.push(structuredClone(frame));
    if (!real) { await f.scope.receive({ id, result: method === 'fs/watch' ? { path: frame.params.path } : {} }); return f.delivered.at(-1).result; }
    return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); child.send(frame); });
  };
  f.drain = async () => { await receiveSequence; if (f.errors.length) throw new Error(f.errors.join('; ')); };
  f.close = async () => { f.scope.close(); f.closed = true; await child?.close(); await rm(directory, { recursive: true, force: true }); };
  return f;
}
