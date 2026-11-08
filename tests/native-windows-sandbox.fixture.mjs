// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { nativePluginSdkFixture } from './native-plugin-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export async function seedNativeWindowsSandbox(home) { await writeFile(join(home, 'config.toml'), '', { mode: 0o600 }); }
export async function nativeWindowsSandboxSdkFixture() {
  return nativePluginSdkFixture({ async backendFactory(home) { await seedNativeWindowsSandbox(home); return { close: async () => {} }; } });
}
export async function nativeWindowsReadinessFixture(options = {}) {
  const f = await nativeHostFixture({ ...options, allowAgent: false, allowWindowsSandboxReadiness: options.allowWindowsSandboxReadiness ?? true,
    async runtimeFactory(f) {
      await seedNativeWindowsSandbox(f.home); await options.seedRuntime?.(f);
      const real = f.privateRuntime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
        allowWindowsSandboxReadiness: options.allowWindowsSandboxReadiness ?? true,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
      return { ...real,
        async reviewWindowsReadiness(plan, result) { f.reachedReview = true; await options.beforeReview?.(f, plan, result); const reviewed = await real.reviewWindowsReadiness(plan, result); await options.afterReview?.(f, plan, reviewed); return reviewed; },
        async start(receive, exited) {
          f.starts++; const child = await real.start(receive, exited); let closed = false;
          return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
        } };
    } });
  f.runtime.requestMs = 15000; return f;
}
