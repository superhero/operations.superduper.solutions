// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, delimiter } from 'node:path';
import { nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { nativeRpcId } from '../../src/lib/native-agent-contract.ts';
import { nativeCommandParams, nativeCommandOutput, nativeCommandResult, nativeCommandBytes, nativeCommandLimits as limits,
  nativeCommandApprovalMethod, nativeCommandDispatchedMethod, nativeCommandOutputMethod } from '../../src/lib/native-command.ts';

const within = (root, path) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
export async function prepareNativeCommand(input, workspace, home, dispatcher) {
  const params = nativeCommandParams('command/exec', input), requested = resolve(workspace, params.cwd ?? '.'), path = await realpath(requested), info = await stat(path);
  if (!within(workspace, requested) || !within(workspace, path) || within(home, path) || !info.isDirectory()) throw new Error('Command cwd is outside its workspace authority.');
  // The pinned portable PTY launcher resolves its argv0 dispatcher through PATH.
  // A caller's PATH can add search roots but cannot replace that verified alias.
  const env = dispatcher ? { ...params.env, PATH: dispatcher.directory + delimiter + (params.env?.PATH ?? dispatcher.basePath) } : params.env;
  return { params: { ...params, ...(dispatcher ? { env } : {}), cwd: path, outputBytesCap: params.outputBytesCap ?? limits.outputBytes }, root: { path, dev: info.dev, ino: info.ino } };
}
export async function reviewNativeCommand(root, workspace, home) {
  const path = await realpath(root.path), info = await stat(path);
  if (path !== root.path || !within(workspace, path) || within(home, path) || !info.isDirectory() || info.dev !== root.dev || info.ino !== root.ino) throw new Error('Command cwd authority changed.');
}

/** This role owns approval, process IDs and terminal ordering. It never forwards
 * a command before explicit approval or turns local dispatch into an SDK ACK. */
export function createCodexCommandSession({ prepare, review, send, write, secrets = [] }) {
  const requests = new Map(), processes = new Map(), usedIds = new Set(), approvals = new Map(); let closed = false;
  const secretBytes = secrets.filter(value => typeof value === 'string' && value).flatMap(value => [Buffer.from(value), Buffer.from(Buffer.from(value).toString('base64'))]);
  const checkedBytes = bytes => { if (secretBytes.some(secret => bytes.includes(secret))) throw new Error('Known credential echo in command data.'); };
  const close = () => { closed = true; requests.clear(); processes.clear(); approvals.clear(); usedIds.clear(); };
  const live = () => { if (closed) throw new Error('Command channel is closed.'); };
  function output(entry, frame) {
    const note = nativeCommandOutput(frame), stream = entry.output[note.params.stream];
    if (!entry.params.streamStdoutStderr && !entry.params.tty || stream.capped) throw new Error('Unowned or late command output.');
    const bytes = Buffer.from(nativeCommandBytes(note.params.deltaBase64)); stream.bytes = Buffer.concat([stream.bytes, bytes]);
    if (stream.bytes.length > entry.params.outputBytesCap || stream.pending.length >= 64) throw new Error('Command output bound exceeded.');
    checkedBytes(stream.bytes); stream.capped = note.params.capReached; stream.pending.push(note);
    // Hold a possible credential prefix until the next chunk disambiguates it.
    // Exact SDK frames are released only when no known token crosses the edge.
    const prefix = secretBytes.some(secret => { for (let n = 1; n < secret.length && n <= stream.bytes.length; n++) if (stream.bytes.subarray(-n).equals(secret.subarray(0, n))) return true; return false; });
    if (!prefix) for (const value of stream.pending.splice(0)) send(value);
  }
  function finish(entry) {
    for (const stream of Object.values(entry.output)) for (const value of stream.pending.splice(0)) send(value);
    entry.phase = 'complete'; if (entry.params.processId != null) processes.delete(entry.params.processId);
  }
  return { close, ownsRequest: id => !closed && requests.has(id), async request(frame) {
    live(); nativeObject(frame, ['id', 'method', 'params']);
    if (!nativeRpcId(frame.id) || requests.has(frame.id) || requests.size >= 8) throw new Error('Invalid or excessive command request ID.');
    const params = nativeCommandParams(frame.method, frame.params); checkedBytes(Buffer.from(JSON.stringify(params)));
    if (frame.method === 'command/exec') {
      if ([...requests.values()].filter(item => item.method === 'command/exec').length >= limits.processes || params.processId != null && (usedIds.has(params.processId) || usedIds.size >= limits.ids)) throw new Error('Duplicate or excessive command process ID.');
      const prepared = await prepare(params); live(); checkedBytes(Buffer.from(JSON.stringify(prepared.params)));
      const entry = { ...prepared, phase: 'approval', id: frame.id, output: { stdout: { bytes: Buffer.alloc(0), pending: [], capped: false }, stderr: { bytes: Buffer.alloc(0), pending: [], capped: false } } };
      requests.set(frame.id, { method: frame.method, entry });
      if (params.processId != null) { processes.set(params.processId, entry); usedIds.add(params.processId); }
      const token = randomUUID(); approvals.set(token, entry);
      send({ id: token, method: nativeCommandApprovalMethod, params: { requestId: frame.id, params: structuredClone(entry.params) } }); return;
    }
    const entry = processes.get(params.processId);
    if (!entry || entry.phase !== 'running' || frame.method === 'command/exec/write' && (!entry.params.tty && !entry.params.streamStdin || entry.stdinClosed)
      || frame.method === 'command/exec/resize' && !entry.params.tty) throw new Error('No compatible owned live command process.');
    if (frame.method === 'command/exec/write' && params.deltaBase64 != null) checkedBytes(Buffer.from(nativeCommandBytes(params.deltaBase64)));
    if (frame.method === 'command/exec/write' && params.closeStdin) entry.stdinClosed = true;
    requests.set(frame.id, { method: frame.method, entry }); write({ ...frame, params });
  }, async reply(frame) {
    live(); const value = nativeObject(frame, ['id', 'result']), answer = nativeObject(value.result, ['decision']), entry = approvals.get(value.id);
    if (!entry || !['accept', 'decline', 'cancel'].includes(answer.decision)) throw new Error('Unknown command approval.');
    approvals.delete(value.id);
    if (answer.decision !== 'accept') { requests.delete(entry.id); finish(entry); send({ id: entry.id, error: { code: -32001, message: 'Command was not approved.' } }); return; }
    await review(entry.root); live(); entry.phase = 'running'; write({ id: entry.id, method: 'command/exec', params: entry.params });
    send({ method: nativeCommandDispatchedMethod, params: { requestId: entry.id, processId: entry.params.processId ?? null } });
  }, async receive(frame) {
    live();
    if (frame.method === nativeCommandOutputMethod) {
      const entry = processes.get(frame.params?.processId);
      if (!entry || entry.phase !== 'running') throw new Error('Foreign command output.'); output(entry, frame); return true;
    }
    const request = requests.get(frame.id); if (!request) return false;
    if (Object.hasOwn(frame, 'result') === Object.hasOwn(frame, 'error')) throw new Error('Invalid command response envelope.');
    nativeObject(frame, Object.hasOwn(frame, 'result') ? ['id', 'result'] : ['id', 'error']);
    requests.delete(frame.id); const { entry, method } = request;
    if (method === 'command/exec') {
      if (entry.phase !== 'running') throw new Error('Command replied before approval.');
      if (Object.hasOwn(frame, 'result')) {
        const result = nativeCommandResult(frame.result);
        for (const key of ['stdout', 'stderr']) if (Buffer.byteLength(result[key]) > entry.params.outputBytesCap || (entry.params.tty || entry.params.streamStdoutStderr) && result[key] !== '') throw new Error('Invalid command output capture.');
        checkedBytes(Buffer.from(JSON.stringify(result))); finish(entry); send({ id: frame.id, result }); return true;
      }
      finish(entry);
    } else if (Object.hasOwn(frame, 'result')) nativeObject(frame.result, []);
    send(Object.hasOwn(frame, 'error') ? { id: frame.id, error: { code: -32000, message: 'Native command request failed.' } } : frame); return true;
  } };
}
