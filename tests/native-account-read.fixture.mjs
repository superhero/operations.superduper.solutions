// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { seedNativeAccountBackend } from './native-account-read-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { prepareNativeAccountRead, reviewNativeAccountRead } from '../companions/codex/account-read.mjs';
import { isNativeAccountReadMethod } from '../src/lib/native-account-read.ts';

export async function nativeAccountReadFixture(options = {}) {
  let backend;
  let f;
  try {
    f = await nativeHostFixture({ ...options, allowAccountRead: options.allowAccountRead ?? true, allowAgent: options.allowAgent ?? false,
      async runtimeFactory(f) {
        backend = await seedNativeAccountBackend(f.home); f.backend = backend;
        const account = () => ({ account: Object.hasOwn(options, 'account') ? options.account : { type: 'chatgpt', email: 'owned-account@example.test', planType: 'pro' },
          requiresOpenaiAuth: options.requiresOpenaiAuth ?? true, workspaceRouting: { chatgptAccountId: backend.accountId, backendOrigin: 'https://chatgpt.com', accountRoutingOverride: 'NO_CONSTRAINT' } });
        const real = options.real ? await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
          allowAccountRead: true, executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 }) : undefined;
        const context = { home: f.home, account: async () => account() };
        return { accountUpdateIsUnchanged: real?.accountUpdateIsUnchanged, authority: real?.authority ?? (async () => structuredClone(f.identity)),
          prepareAccountRead: real?.prepareAccountRead ?? ((method, params) => prepareNativeAccountRead(method, params, context)),
          reviewAccountRead: real?.reviewAccountRead ?? ((plan, result) => reviewNativeAccountRead(plan, result, context)),
          async start(receive, exited) {
            f.starts++; let stopped = false;
            if (real) {
              const child = await real.start(frame => {
                (f.nativeShapes ??= []).push({ method: frame.method, resultFields: frame.result && typeof frame.result === 'object' ? Object.keys(frame.result) : [] });
                receive(frame);
              }, exited);
              return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
            }
            return { send(frame) {
              f.frames.push(structuredClone(frame)); if (!Object.hasOwn(frame, 'id')) return;
              const result = frame.method === 'initialize' ? { userAgent: 'codex/0.163.0', codexHome: f.home, platformFamily: 'unix', platformOs: 'linux' }
                : frame.method === 'account/read' ? account()
                : isNativeAccountReadMethod(frame.method) ? f.readResult ?? (frame.method === 'account/gatewayOAuth/read'
                  ? { providerId: 'operations_account_fixture', providerName: 'Owned account fixture', required: false, status: null, error: null }
                  : { featureEnabled: true, messages: [] }) : undefined;
              if (result === undefined) throw new Error('Unreviewed fake account method.');
              const reply = () => { if (!stopped) receive({ id: frame.id, result: structuredClone(result) }); };
              if (f.holdReads && isNativeAccountReadMethod(frame.method)) f.release.push(reply); else queueMicrotask(reply);
            }, async close() { if (!stopped) { stopped = true; f.stops++; exited(); } } };
          } };
      } });
  } catch (error) { await backend?.close(); throw error; }
  const close = f.close; f.close = async () => { try { await close(); } finally { await backend?.close(); } };
  if (options.real) f.runtime.requestMs = 15000;
  return f;
}
