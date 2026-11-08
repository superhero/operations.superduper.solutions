// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { waitForWatch } from './native-watch-transport.fixture.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { nativeCommandScope, nativeCommandApprovalMethod, nativeCommandDispatchedMethod } from '../src/lib/native-command.ts';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export async function nativeCommandFixture(options = {}) {
  return nativeHostFixture({ ...options, allowCommands: options.allowCommands ?? true,
    ...(options.real ? { async runtimeFactory(f) {
      const runtime = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256,
        allowCommands: true });
      return { authority: runtime.authority, prepareCommand: runtime.prepareCommand, reviewCommand: runtime.reviewCommand, async start(receive, exited) {
        f.starts++; const child = await runtime.start(frame => {
          if (frame.error) (f.commandErrors ??= []).push({ id: frame.id, code: frame.error.code, message: String(frame.error.message).replaceAll(f.key, '[redacted]') });
          receive(frame);
        }, exited); let stopped = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
      } };
    } } : {}), onClose(f) { f.commandProcesses?.clear(); options.onClose?.(f); }, onFrame(frame, f, receive) {
      if (options.onFrame?.(frame, f, receive) === true) return true;
      if (!frame.method?.startsWith('command/exec')) return false;
      f.commandProcesses ??= new Map();
      f.outputCommand = (processId, bytes, stream = 'stdout', extra = {}) => receive({ method: 'command/exec/outputDelta', params: {
        processId, stream, deltaBase64: Buffer.from(bytes).toString('base64'), capReached: false, ...extra }, emittedAtMs: 1234 });
      f.finishCommand = (processId, result = { exitCode: 0, stdout: '', stderr: '' }) => {
        const entry = f.commandProcesses.get(processId); if (!entry) throw new Error('Missing synthetic command.');
        f.commandProcesses.delete(processId); receive({ id: entry.id, result });
      };
      if (frame.method === 'command/exec') { f.commandProcesses.set(frame.params.processId ?? frame.id, frame); return true; }
      queueMicrotask(() => { if (options.echoCommandInput && frame.method === 'command/exec/write' && frame.params.deltaBase64 != null) f.outputCommand(frame.params.processId, Buffer.from(frame.params.deltaBase64, 'base64')); receive({ id: frame.id, result: {} }); if (options.autoTerminate && frame.method === 'command/exec/terminate' && f.commandProcesses.has(frame.params.processId)) f.finishCommand(frame.params.processId); }); return true;
    } });
}
export const commandTicketScope = () => ({ connectionId: randomUUID(), method: nativeCommandScope, fingerprint: 'd'.repeat(64) });
export async function nativeCommandSocket(f) {
  const ticket = await f.ticket(commandTicketScope());
  if (ticket.status !== 200) throw new Error('Owned command ticket was rejected.');
  const socket = await f.socket(ticket.value.ticket); await socket.next(); let sequence = 0;
  socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next();
  socket.ws.send(JSON.stringify({ method: 'initialized' }));
  const take = async predicate => {
    await waitForWatch(() => socket.messages.some(predicate) || socket.ws.readyState === 3);
    const index = socket.messages.findIndex(predicate); if (index < 0) throw new Error('Owned command channel closed before the expected frame.');
    return socket.messages.splice(index, 1)[0];
  };
  return { ...socket, ticket, take, send(method, params) { const id = 'cmd_' + ++sequence; socket.ws.send(JSON.stringify({ id, method, params })); return id; },
    response: id => take(frame => frame.id === id),
    approval: id => take(frame => frame.method === nativeCommandApprovalMethod && frame.params.requestId === id),
    approve(prompt, decision = 'accept') { socket.ws.send(JSON.stringify({ id: prompt.id, result: { decision } })); },
    dispatched: id => take(frame => frame.method === nativeCommandDispatchedMethod && frame.params.requestId === id),
    async start(params) { const id = this.send('command/exec', params), prompt = await this.approval(id); this.approve(prompt); await this.dispatched(id); return { id, prompt }; },
    async call(method, params) { return this.response(this.send(method, params)); }
  };
}
