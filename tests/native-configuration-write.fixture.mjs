// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { seedNativeConfigurationRead, configurationSdkSecret } from './native-configuration-read.fixture.mjs';
import { seedNativeMcpTool } from './native-mcp-tool.fixture.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { waitForWatch } from './native-watch-transport.fixture.mjs';

export async function nativeConfigurationWriteFixture(options = {}) {
  let provider;
  try {
    const f = await nativeHostFixture({ ...options, allowAgent: options.withMcp === true,
      allowConfigurationWrite: options.allowConfigurationWrite ?? true, allowConfigurationRead: options.allowConfigurationRead ?? true,
      allowConfigurationControl: true, allowMcpTools: options.withMcp === true,
      async runtimeFactory(f) {
        await seedNativeConfigurationRead(f.home, f.workspace);
        if (options.withMcp) {
          provider = f.provider = await seedNativeMcpTool(f.home);
          await appendFile(join(f.home, 'config.toml'), '\n[model_providers.private_fixture]\nname="Private fixture provider"\nbase_url="http://127.0.0.1:9/v1"\nexperimental_bearer_token="' + configurationSdkSecret + '"\n');
        }
        const runtime = f.privateRuntime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
          executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
          allowAgent: options.withMcp === true, allowMcpTools: options.withMcp === true,
          allowConfigurationWrite: options.allowConfigurationWrite ?? true, allowConfigurationRead: options.allowConfigurationRead ?? true, allowConfigurationControl: true });
        return { ...runtime,
          async prepareConfigurationWrite(method, params) {
            const context = await runtime.prepareConfigurationWrite(method, params); await options.afterPrepare?.(f, context); return context;
          },
          async reviewConfigurationWrite(context, result) {
            await options.beforeReview?.(f, context, result);
            const verified = await runtime.reviewConfigurationWrite(context, result); await options.afterReview?.(f, context, verified); return verified;
          },
          async start(receive, exited) {
            f.starts++; const child = await runtime.start(receive, exited); let closed = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
          }
        };
      } });
    const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } };
    f.runtime.requestMs = 10000;
    return f;
  } catch (error) { await provider?.close(); throw error; }
}

export async function nativeConfigurationWriteSocket(f) {
  const ticket = await f.ticket({ connectionId: randomUUID(), method: 'codex-workflow', fingerprint: 'd'.repeat(64) }); assert.equal(ticket.status, 200);
  const socket = await f.socket(ticket.value.ticket); assert.equal((await socket.next()).type, 'paired');
  socket.ws.send(JSON.stringify({ id: 'owned_init', method: 'initialize', params: nativeInitializeParams() }));
  await waitForWatch(() => socket.messages.some(f => f.id === 'owned_init'));
  assert.ok(socket.messages.splice(socket.messages.findIndex(f => f.id === 'owned_init'), 1)[0].result);
  socket.ws.send(JSON.stringify({ method: 'initialized' }));
  let sequence = 0;
  return { ...socket, ticket, async call(method, params) {
    const id = 'owned_write_' + ++sequence; socket.ws.send(JSON.stringify({ id, method, params }));
    await waitForWatch(() => socket.messages.some(f => f.id === id) || socket.ws.readyState === 3, 'Owned configuration request did not complete.');
    const index = socket.messages.findIndex(f => f.id === id); assert.ok(index >= 0, 'Owned configuration response was withheld.');
    return { id, ...socket.messages.splice(index, 1)[0] };
  } };
}
