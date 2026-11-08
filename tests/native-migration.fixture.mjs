// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { NativeRuntimeBroker } from '../src/lib/secrets/native-runtime.ts';
import { NativeAgentBroker } from '../src/lib/secrets/native-agent.ts';
import { seedNativeMcpTool } from './native-mcp-tool.fixture.mjs';

export const migrationFixtureSecret = 'OWNED_MIGRATION_PROVIDER_SECRET_2486';
export async function nativeMigrationFixture(options = {}) {
  let provider;
  const f = await nativeHostFixture({ allowMigration: true, allowAgent: options.withMcp === true,
    allowMcpTools: options.withMcp === true, allowConfigurationControl: options.withMcp === true, async runtimeFactory(f) {
    f.migrationHome = dirname(f.home);
    await mkdir(join(f.migrationHome, '.claude'), { mode: 0o700 });
    await writeFile(join(f.migrationHome, '.claude/CLAUDE.md'), 'Owned private migration instructions.\n');
    await writeFile(join(f.migrationHome, '.claude/settings.json'), JSON.stringify({ env: { OWNED_MIGRATION_SECRET: migrationFixtureSecret } }));
    if (options.withMcp) provider = f.provider = await seedNativeMcpTool(f.home);
    await options.beforeOpen?.(f);
    const runtime = f.privateRuntime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
      migrationHome: f.migrationHome, allowMigration: true, allowAgent: options.withMcp === true,
      allowMcpTools: options.withMcp === true, allowConfigurationControl: options.withMcp === true, executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
      binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
    return { ...runtime,
      async reviewMigration(context, result, completion) {
        await options.beforeReview?.(f, context, result);
        return runtime.reviewMigration(context, result, completion);
      },
      async start(receive, exited) {
        f.starts++; const child = await runtime.start(receive, exited); let stopped = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); },
          async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
      }
    };
  } }).catch(async error => { await provider?.close(); throw error; });
  f.runtime.requestMs = 10000;
  if (options.mutateFrame) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, opts) {
        if (name !== 'message') return super.addEventListener(name, listener, opts);
        return super.addEventListener(name, event => {
          for (const frame of options.mutateFrame(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) });
        }, opts);
      }
    };
  }
  f.transport = new NativeRuntimeBroker(f.runtime); f.broker = new NativeAgentBroker(f.transport);
  const close = f.close; f.close = async () => { try { f.transport.clear(); await close(); } finally { await provider?.close(); } };
  const id = randomUUID(), fingerprint = 'd'.repeat(64), summary = await f.transport.check(id, f.publicOrigin, f.key, fingerprint, undefined, async () => {}).catch(async error => { await f.close(); throw error; });
  f.connection = { id, host: f.publicOrigin, identity: summary.identity, accountType: summary.accountType, requiresOpenaiAuth: summary.requiresOpenaiAuth };
  f.execute = (method, input, adopt, signal, guard = async () => {}, progress) => f.broker.execute(f.connection, f.key, fingerprint, method, input, guard, signal, progress, undefined, adopt);
  return f;
}
