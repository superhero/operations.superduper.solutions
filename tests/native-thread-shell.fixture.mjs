// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

/** An owned provider supplies no inference endpoint and requires no credential. */
export async function seedNativeShellProvider(home) {
  const requests = [], server = createServer((request, response) => {
    requests.push(request.url); response.writeHead(request.url === '/v1/models' ? 200 : 404, { 'content-type': 'application/json' });
    response.end(request.url === '/v1/models' ? '{"object":"list","data":[]}' : '{"error":{"message":"Inference is not implemented."}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  try {
    await writeFile(join(home, 'config.toml'), 'model="owned-fixture-model"\nmodel_provider="operations_fixture"\n'
      + '[model_providers.operations_fixture]\nname="Owned qualification provider"\nwire_api="responses"\nrequires_openai_auth=false\n'
      + 'base_url="http://127.0.0.1:' + server.address().port + '/v1"\n', { mode: 0o600 });
    return { requests, close };
  } catch (error) { await close(); throw error; }
}
export async function nativeThreadShellFixture(options = {}) {
  const allowThreadShell = options.allowThreadShell ?? true; let provider;
  const f = await nativeAgentFixture({ ...options, allowThreadShell, account: null, requiresOpenaiAuth: false,
    ...(options.real ? { async runtimeFactory(f) {
      provider = await (options.providerFactory ?? seedNativeShellProvider)(f.home); f.provider = provider;
      const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowAgent: true, allowThreadShell,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
      return { authority: real.authority, async start(receive, exited) {
        f.starts++; const child = await real.start(frame => { options.onNativeFrame?.(frame, f); receive(frame); }, exited); let closed = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
      } };
    } } : {}), onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      if (frame.method === 'thread/shellCommand') {
        const threadId = frame.params.threadId, turnId = 'shell_turn_' + randomUUID(), itemId = 'shell_item_' + randomUUID();
        const item = { type: 'commandExecution', id: itemId, command: frame.params.command, cwd: f.workspace, processId: null,
          source: 'userShell', status: 'inProgress', commandActions: [{ type: 'unknown', command: frame.params.command }], aggregatedOutput: null, exitCode: null, durationMs: null };
        f.shellLive = true;
        f.shellAck = () => emit({ id: frame.id, result: {} });
        f.finishShell = ({ output = frame.params.command.includes('BROWSER_SHELL_OUTPUT') ? 'BROWSER_SHELL_OUTPUT' : 'OWNED_SHELL_OUTPUT', exitCode = 17, status = 'completed', itemOverride = {}, turnOverride = {} } = {}) => {
          f.shellLive = false;
          emit({ method: 'item/completed', params: { threadId, turnId, completedAtMs: 1235,
            item: { ...item, status: exitCode ? 'failed' : 'completed', aggregatedOutput: output, exitCode, durationMs: 10, ...itemOverride } }, emittedAtMs: 1236 });
          emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status, error: null, ...turnOverride } }, emittedAtMs: 1237 });
        };
        emit({ method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } }, emittedAtMs: 1233 });
        emit({ method: 'item/started', params: { threadId, turnId, item, startedAtMs: 1233 }, emittedAtMs: 1234 });
        if (!f.holdShellAck) queueMicrotask(f.shellAck);
        if (options.autoFinishShell) queueMicrotask(() => f.finishShell()); return true;
      }
      if (frame.method === 'turn/interrupt' && f.shellLive) {
        f.interrupts = (f.interrupts ?? 0) + 1; queueMicrotask(() => { emit({ id: frame.id, result: {} }); f.finishShell({ status: 'interrupted', exitCode: -1 }); }); return true;
      }
      return false;
    } });
  const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } }; return f;
}
