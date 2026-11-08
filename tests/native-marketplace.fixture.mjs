// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { seedNativePluginBackend } from './native-plugin-sdk.fixture.mjs';
import { seedNativeMarketplaces } from './native-marketplace-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export async function nativeMarketplaceFixture(options = {}) {
  let backend;
  try {
    const f = await nativeHostFixture({ ...options, allowAgent: false, allowMarketplaces: options.allowMarketplaces ?? true,
      async runtimeFactory(f) {
        backend = f.backend = await seedNativePluginBackend(f.home, f.workspace);
        f.marketplaces = await seedNativeMarketplaces(f.home, f.workspace); await options.seedRuntime?.(f);
        const real = f.privateRuntime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
          allowMarketplaces: options.allowMarketplaces ?? true, executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
          binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
        return { ...real,
          async prepareMarketplace(method, input) { const plan = await real.prepareMarketplace(method, input); await options.afterPrepare?.(f, plan); return plan; },
          async reviewMarketplace(plan, result) { await options.beforeReview?.(f, plan, result); const verified = await real.reviewMarketplace(plan, result); await options.afterReview?.(f, plan, verified); return verified; },
          async start(receive, exited) {
            f.starts++; const child = await real.start(receive, exited); let closed = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
          } };
      } });
    f.runtime.requestMs = 15000;
    const close = f.close; f.close = async () => { try { await close(); } finally { await backend?.close(); } }; return f;
  } catch (error) { await backend?.close(); throw error; }
}
