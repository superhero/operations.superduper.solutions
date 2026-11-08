// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { seedNativePluginInstallation } from './native-plugin-install-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

/** Real SDK only: source fixtures cannot acknowledge plugin effects on its behalf. */
export async function nativePluginInstallFixture(options = {}) {
  let backend;
  try {
    const f = await nativeHostFixture({ ...options, allowAgent: false, allowPluginManagement: options.allowPluginManagement ?? true,
      async runtimeFactory(f) {
        backend = f.backend = await seedNativePluginInstallation(f.home, f.workspace, options);
        const config = join(f.home, 'config.toml'); await writeFile(config, (await readFile(config, 'utf8')).replace('plugins=false', 'plugins=true'), { mode: 0o600 });
        await options.seedRuntime?.(f);
        const real = f.privateRuntime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
          caCertificate: backend.caCertificate, allowPluginManagement: options.allowPluginManagement ?? true,
          executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
        return { ...real,
          async preparePluginInstall(method, input) {
            (f.effectStages ??= []).push('prepare:' + method);
            const plan = await real.preparePluginInstall(method, input); await options.afterPrepare?.(f, plan); f.effectStages.push('prepared:' + method); return plan;
          },
          async reviewPluginInstall(plan, result) {
            await options.beforeReview?.(f, plan, result);
            f.effectStages.push('review:' + plan.method);
            try { const verified = await real.reviewPluginInstall(plan, result); await options.afterReview?.(f, plan, verified); return verified; }
            catch (error) { f.reviewFailure = String(error.message).replaceAll(f.home, '<owned-home>').replaceAll(backend.access, '<owned-access>').replaceAll(backend.refresh, '<owned-refresh>').slice(0, 400); throw error; }
          },
          async start(receive, exited) {
            f.starts++; const child = await real.start(receive, exited); let closed = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
          } };
      } });
    f.runtime.requestMs = 20000;
    const close = f.close; f.close = async () => { try { await close(); } finally { await backend?.close(); } }; return f;
  } catch (error) { await backend?.close(); throw error; }
}
