// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { seedNativeAccountBackend } from './native-account-read-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { prepareNativeAccountAction, checkNativeAccountAction, reviewNativeAccountAction } from '../companions/codex/account-actions.mjs';
import { nativeAccountAuthority } from '../companions/codex/account-authority.mjs';
import { isNativeAccountActionMethod } from '../src/lib/native-account-actions.ts';
import { sameNativeIdentity } from '../src/lib/native-runtime-contract.ts';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function nativeAccountActionsFixture(options = {}) {
  let backend, fixture;
  try {
    fixture = await nativeHostFixture({ ...options, allowAccountActions: options.allowAccountActions ?? true, allowAgent: options.allowAgent ?? false,
      async runtimeFactory(f) {
        backend = await seedNativeAccountBackend(f.home); f.backend = backend;
        if (options.requiresOpenaiAuth === false) {
          const path = join(f.home, 'config.toml'); await writeFile(path, (await readFile(path, 'utf8')).replace('requires_openai_auth=true', 'requires_openai_auth=false'), { mode: 0o600 });
        }
        if (options.real) {
          const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowAccountActions: true,
            executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
          return { ...real, async start(receive, exited) {
            f.starts++; const child = await real.start(receive, exited); let stopped = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
          } };
        }
        let before;
        const authority = async () => {
          const current = JSON.stringify(await nativeAccountAuthority(f.home, process.getuid()));
          if (before !== undefined && current !== before) f.identity.accountEpoch = randomUUID(); before = current;
          return structuredClone(f.identity);
        };
        f.account = { type: 'chatgpt', email: 'owned-account@example.test', planType: 'pro' };
        const account = async () => ({ account: f.account, requiresOpenaiAuth: true });
        const context = { home: f.home, account, authority };
        return { authority, accountUpdateIsUnchanged: async expected => sameNativeIdentity(expected, await authority()),
          prepareAccountAction: (method, params) => prepareNativeAccountAction(method, params, context),
          checkAccountAction: plan => checkNativeAccountAction(plan, context), reviewAccountAction: (plan, result) => reviewNativeAccountAction(plan, result, context),
          async start(receive, exited) {
            f.starts++; let stopped = false;
            return { send(frame) {
              f.frames.push(structuredClone(frame)); if (!Object.hasOwn(frame, 'id')) return;
              const emit = value => queueMicrotask(() => { if (!stopped) receive(value); });
              if (options.onFrame?.(frame, f, emit) === true) return;
              if (frame.method === 'initialize') return emit({ id: frame.id, result: { userAgent: 'owned-account-action-fixture', codexHome: f.home, platformFamily: 'unix', platformOs: 'linux' } });
              if (frame.method === 'account/read') return void account().then(result => emit({ id: frame.id, result }));
              if (!isNativeAccountActionMethod(frame.method)) throw new Error('Unreviewed account action fixture method.');
              const result = f.actionResult ?? (frame.method === 'account/rateLimitResetCredit/consume' ? { outcome: 'reset' } : { status: 'sent' });
              f.finishAction = () => emit({ id: frame.id, result: structuredClone(result) });
              if (!f.holdActions) f.finishAction();
            }, async close() { if (!stopped) { stopped = true; f.stops++; exited(); } } };
          } };
      } });
  } catch (error) { await backend?.close(); throw error; }
  const close = fixture.close; fixture.close = async () => { try { await close(); } finally { await backend?.close(); } };
  if (options.real) fixture.runtime.requestMs = 15000;
  return fixture;
}
