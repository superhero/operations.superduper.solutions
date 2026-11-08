// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdtemp, mkdir, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { nativeStoredThreadReadMethods } from '../src/lib/native-stored-thread.ts';
import { nativeThreadLifecycleMethods } from '../src/lib/native-thread-lifecycle.ts';
import { nativeThreadContentMethods } from '../src/lib/native-thread-content.ts';
import { seedNativeShellProvider } from './native-thread-shell.fixture.mjs';

/** Qualification-only owned native store. No inference, login, or external provider. */
export async function nativeStoredThreadSdkFixture(options = {}) {
  const ownDirectory = !options.home, directory = ownDirectory ? await mkdtemp(join(tmpdir(), 'operations-native-stored-thread-')) : dirname(options.home),
    home = options.home ?? join(directory, 'home'), workspace = options.workspace ?? join(directory, 'workspace');
  if (ownDirectory) { await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 }); }
  let provider, child, sequence = 0;
  const pending = new Map(), events = [], waiters = new Set(), calls = [];
  const methods = new Set(['initialize', 'thread/start', 'thread/inject_items', 'thread/goal/set', 'thread/attachment/add', 'thread/shellCommand',
    'threadSection/create', 'threadSection/delete', 'review/start', 'thread/compact/start', 'turn/start', 'turn/interrupt', 'thread/approveGuardianDeniedAction', ...nativeStoredThreadReadMethods, ...nativeThreadLifecycleMethods, ...nativeThreadContentMethods]);
  const f = { directory, home, workspace, events, calls };
  const rejectPending = () => {
    for (const request of pending.values()) request.reject(new Error('Owned stored-thread SDK child closed.'));
    pending.clear();
    for (const waiter of waiters) waiter.reject(new Error('Owned stored-thread SDK child closed.'));
    waiters.clear();
  };
  f.call = (method, params) => {
    if (!methods.has(method)) throw new Error('Unreviewed stored-thread qualification RPC.');
    const id = 'stored_' + ++sequence; calls.push({ id, method });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Owned stored-thread request timed out: ' + method)); }, 10000);
      const clean = () => clearTimeout(timer);
      pending.set(id, { resolve: value => { clean(); resolve(value); }, reject: error => { clean(); reject(error); } });
      try { child.send({ id, method, params }); } catch (error) { pending.delete(id); clean(); reject(error); }
    });
  };
  f.notification = (method, predicate = () => true) => {
    const found = events.find(event => event.method === method && predicate(event.params));
    if (found) return Promise.resolve(found.params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('Owned stored-thread notification timed out: ' + method)); }, 10000);
      const waiter = { method, predicate, resolve: value => { clearTimeout(timer); waiters.delete(waiter); resolve(value); },
        reject: error => { clearTimeout(timer); waiters.delete(waiter); reject(error); } };
      waiters.add(waiter);
    });
  };
  f.seed = async (options = {}) => {
    const start = await f.call('thread/start', { model: 'owned-fixture-model', approvalPolicy: 'on-request', approvalsReviewer: 'user', ...(options.cwd ? { cwd: options.cwd } : {}) }), threadId = start.thread.id;
    await f.call('thread/goal/set', { threadId, objective: 'Owned paused qualification goal', status: 'paused', origin: 'user' });
    await f.call('thread/inject_items', { threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Owned stored-thread fixture user message' }] }] });
    await f.call('thread/attachment/add', { threadId, attachmentType: 'qualification', identityKey: 'owned-item', payload: { fixture: true } });
    const terminal = f.notification('turn/completed', params => params.threadId === threadId);
    await f.call('thread/shellCommand', { threadId, command: 'printf OWNED_STORED_THREAD_HISTORY' });
    return { threadId, turn: (await terminal).turn, start };
  };
  f.close = async () => { try { await child?.close(); } finally { rejectPending(); await provider?.close(); if (ownDirectory) await rm(directory, { recursive: true, force: true }); } };
  try {
    provider = await (options.providerFactory ?? seedNativeShellProvider)(home); f.provider = provider;
    await appendFile(join(home, 'config.toml'), '\n[features]\ngoals=true\n');
    const runtime = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
      binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace, allowAgent: true, allowThreadShell: true,
      allowThreadsWrite: options.allowThreadsWrite === true });
    f.runtime = runtime;
    child = await runtime.start(frame => {
      if (Object.hasOwn(frame, 'method')) {
        if (Object.hasOwn(frame, 'id')) { child.send({ id: frame.id, error: { code: -32601, message: 'Interaction is not granted by this fixture.' } }); return; }
        events.push(frame);
        for (const waiter of [...waiters]) if (frame.method === waiter.method && waiter.predicate(frame.params)) waiter.resolve(frame.params);
        return;
      }
      const selected = pending.get(frame.id); if (!selected) return; pending.delete(frame.id);
      if (Object.hasOwn(frame, 'result')) selected.resolve(frame.result);
      else selected.reject(Object.assign(new Error('Owned SDK stored-thread request rejected: ' + String(frame.error?.message).replaceAll(home, '<owned-home>').slice(0, 1000)), { code: frame.error?.code }));
    }, rejectPending);
    await f.call('initialize', nativeInitializeParams()); child.send({ method: 'initialized' });
    return f;
  } catch (error) { await f.close(); throw error; }
}
