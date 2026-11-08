// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { nativeStoredThreadSdkFixture } from './native-stored-thread-sdk.fixture.mjs';
import { seedNativeShellProvider } from './native-thread-shell.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeStoredThreadReadMethods } from '../src/lib/native-stored-thread.ts';
import { isNativeThreadLifecycleMethod } from '../src/lib/native-thread-lifecycle.ts';

export async function nativeStoredThreadFixture(options = {}) {
  let provider;
  const allowThreadsRead = options.allowThreadsRead ?? true, allowThreadsWrite = options.allowThreadsWrite ?? false;
  let f;
  try {
    f = await nativeHostFixture({ ...options, allowAgent: options.allowAgent ?? false, allowThreadsRead, allowThreadsWrite,
      account: null, requiresOpenaiAuth: options.requiresOpenaiAuth ?? true,
      ...(options.real ? { async runtimeFactory(f) {
        const seed = await nativeStoredThreadSdkFixture({ home: f.home, workspace: f.workspace });
        try { f.seed = await seed.seed(); f.setupRequests = [...seed.provider.requests]; } finally { await seed.close(); }
        provider = await seedNativeShellProvider(f.home); f.provider = provider;
        await appendFile(join(f.home, 'config.toml'), '\n[features]\ngoals=true\n');
        const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowThreadsRead, allowThreadsWrite, allowAgent: options.allowAgent === true, allowThreadShell: options.allowThreadShell === true,
          executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
        return { authority: real.authority, prepareThreadContent: real.prepareThreadContent, reviewThreadContent: real.reviewThreadContent, inspectThreadGoal: real.inspectThreadGoal, prepareThreadLifecycle: real.prepareThreadLifecycle, reviewThreadLifecycle: real.reviewThreadLifecycle, prepareStoredThreadRead: real.prepareStoredThreadRead, reviewStoredThreadRead: real.reviewStoredThreadRead,
          async start(receive, exited) {
            f.starts++; const pending = new Map();
            const child = await real.start(frame => {
              if (frame.method && (f.nativeEvents ??= []).length < 128) f.nativeEvents.push({ method: frame.method, threadId: frame.params?.threadId, turnId: frame.params?.turn?.id, status: frame.params?.turn?.status });
              const method = pending.get(frame.id);
              if (method) {
                pending.delete(frame.id); const result = frame.result;
                (f.resultShapes ??= []).push({ method, fields: result && typeof result === 'object' ? Object.keys(result) : [],
                  threadFields: result?.thread ? Object.keys(result.thread) : [], firstEntryFields: result?.data?.[0] && typeof result.data[0] === 'object' ? Object.keys(result.data[0]) : [] });
              }
              receive(frame);
            }, exited); let closed = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); if (frame.id !== undefined) pending.set(frame.id, frame.method); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
          } };
      } } : {}), onFrame(frame, f, emit) {
        if (options.onFrame?.(frame, f, emit) === true) return true;
        if (isNativeThreadLifecycleMethod(frame.method)) {
          const thread = f.storedThreads.get(frame.params.threadId);
          if (!thread) throw new Error('Unknown fixture thread.');
          if (frame.method === 'thread/name/set') thread.name = frame.params.name;
          if (frame.method === 'thread/metadata/update') thread.gitInfo = { ...thread.gitInfo, ...frame.params.gitInfo };
          if (frame.method === 'thread/section/move') thread.section = frame.params.sectionId ? { id: frame.params.sectionId, name: 'Owned section' } : null;
          const result = f.lifecycleResult ?? (['thread/metadata/update', 'thread/unarchive'].includes(frame.method) ? { thread }
            : frame.method === 'thread/unsubscribe' ? { status: 'notLoaded' } : {});
          queueMicrotask(() => emit({ id: frame.id, result: structuredClone(result) })); return true;
        }
        if (!nativeStoredThreadReadMethods.includes(frame.method)) return false;
        const thread = f.storedThreads.get(frame.params.threadId ?? f.seed.threadId);
        const result = f.readResult ?? (frame.method === 'thread/list' ? { data: [thread], readStates: {}, nextCursor: null, backwardsCursor: null }
          : frame.method === 'thread/loaded/list' ? { data: [...f.storedThreads.keys()], nextCursor: null }
          : frame.method === 'thread/read' ? { thread, readState: null }
          : frame.method === 'thread/goal/get' ? { goal: null }
          : frame.method === 'thread/attachmentOwner/list' ? { data: [...f.storedThreads.keys()].map(threadId => ({ threadId, archived: false })), nextCursor: null }
          : { data: [], nextCursor: null });
        const reply = () => emit({ id: frame.id, result: structuredClone(result) });
        if (f.holdReads) f.release.push(reply); else queueMicrotask(reply); return true;
      } });
  } catch (error) { await provider?.close(); throw error; }
  if (!options.real) {
    f.seed = { threadId: randomUUID() };
    const thread = { id: f.seed.threadId, sessionId: randomUUID(), cliVersion: '0.163.0', createdAt: 1, updatedAt: 1,
      cwd: f.workspace, ephemeral: false, modelProvider: 'operations_fixture', preview: 'Owned persisted history', projectId: null,
      source: 'vscode', status: { type: 'notLoaded' }, turns: [] };
    f.storedThreads = new Map([[thread.id, thread]]);
    f.inspectStoredThread = async id => {
      const thread = f.storedThreads.get(id); if (!thread) throw new Error('Unknown owned fixture thread.');
      return { thread: structuredClone(thread), readState: null };
    };
  } else f.runtime.requestMs = 15000;
  const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } };
  return f;
}
