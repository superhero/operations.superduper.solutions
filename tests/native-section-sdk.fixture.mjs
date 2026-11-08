// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';

/** Qualification-only child with an empty, owned home and four exact section RPCs. */
export async function nativeSectionSdkFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'operations-native-sections-')), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
  const methods = new Set(['initialize', 'threadSection/list', 'threadSection/create', 'threadSection/update', 'threadSection/delete']);
  const runtime = await openCodexRuntime({ runtimeId: randomUUID(), executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
    binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace });
  const pending = new Map(); let child, sequence = 0;
  const f = { directory, home, workspace, calls: [] };
  f.call = (method, params) => {
    if (!methods.has(method)) throw new Error('Unreviewed section qualification RPC.');
    const id = ++sequence; f.calls.push(method);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Owned section request timed out.')); }, 5000);
      const cleanup = () => clearTimeout(timer);
      pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); } });
      try { child.send({ id, method, params }); } catch (error) { pending.delete(id); cleanup(); reject(error); }
    });
  };
  f.restart = async () => {
    await child?.close();
    child = await runtime.start(frame => {
      const request = pending.get(frame.id); if (!request) return; pending.delete(frame.id);
      if (Object.hasOwn(frame, 'result')) request.resolve(frame.result);
      else request.reject(Object.assign(new Error('Owned SDK section request rejected.'), { code: frame.error?.code }));
    }, () => { for (const request of pending.values()) request.reject(new Error('Owned section runtime closed.')); pending.clear(); });
    await f.call('initialize', nativeInitializeParams()); child.send({ method: 'initialized' });
  };
  f.close = async () => { await child?.close(); await rm(directory, { recursive: true, force: true }); };
  try { await f.restart(); return f; } catch (error) { await f.close(); throw error; }
}
