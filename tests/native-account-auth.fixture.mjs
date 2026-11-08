// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { seedNativeAccountBackend } from './native-account-read-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export async function nativeAccountAuthFixture(options = {}) {
  let backend;
  const allowAccountAuth = options.allowAccountAuth ?? true;
  let f;
  try {
    f = await nativeAgentFixture({ ...options, allowAgent: options.allowAgent ?? false, allowAccountAuth, account: null,
      ...(options.real ? { async runtimeFactory(f) {
        backend = await seedNativeAccountBackend(f.home); f.backend = backend; await rm(join(f.home, 'auth.json'));
        if (options.requiresOpenaiAuth === false) {
          const file = join(f.home, 'config.toml'); await writeFile(file, (await readFile(file, 'utf8')).replace('requires_openai_auth=true', 'requires_openai_auth=false'), { mode: 0o600 });
        }
        const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowAccountAuth,
          executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
        return { authority: real.authority, accountUpdateIsUnchanged: real.accountUpdateIsUnchanged, reviewAccountMetadata: real.reviewAccountMetadata,
          async start(receive, exited) {
            f.starts++; const child = await real.start(receive, exited); let stopped = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
          } };
      } } : {}), onFrame(frame, f, emit) {
        if (options.onFrame?.(frame, f, emit) === true) return true;
        if (frame.method === 'account/read' && options.requiresOpenaiAuth === false) { queueMicrotask(() => emit({ id: frame.id, result: { account: null, requiresOpenaiAuth: false } })); return true; }
        if (frame.method !== 'account/logout') return false;
        f.account = null; f.identity.accountEpoch = randomUUID();
        queueMicrotask(() => { emit({ method: 'account/updated', params: {} }); emit({ id: frame.id, result: {} }); }); return true;
      } });
  } catch (error) { await backend?.close(); throw error; }
  const close = f.close; f.close = async () => { try { await close(); } finally { await backend?.close(); } };
  if (options.real) f.runtime.requestMs = 15000;
  return f;
}
