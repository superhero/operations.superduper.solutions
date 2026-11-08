// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, sameNativeIdentity, type NativeRuntimeIdentity } from '../native-runtime-contract.ts';
import { nativeCommandParams, nativeCommandResult, nativeCommandOutput, nativeCommandBytes, nativeCommandLimits,
  nativeCommandApprovalMethod, nativeCommandDispatchedMethod, nativeCommandOutputMethod,
  type NativeCommandMethod, type NativeCommandValue, type NativeCommandProgress, type NativeCommandOutput } from '../native-command.ts';
import { redactor } from './execution.ts';
import { NativeRuntimeBroker, type NativePeer } from './native-runtime.ts';
import { VaultError } from './types.ts';
import type { NativeDecision } from '../native-agent-contract.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {});
  return { promise, resolve, reject };
}
export type NativeCommandAuthority = { id: string; host: string; key: string; fingerprint: string; identity: NativeRuntimeIdentity; guard: () => Promise<void> };
type Review = { value: (value: unknown) => void; bytes: (bytes: Uint8Array) => boolean };
type Entry = { id: string; input: Record<string, unknown>; prepared?: Record<string, unknown>; phase: 'request' | 'approval' | 'approved' | 'running' | 'complete';
  token?: string; hostToken?: string; cancelled: boolean; signal?: AbortSignal; cleanup: () => void;
  ready: ReturnType<typeof deferred<void>>; dispatched: ReturnType<typeof deferred<void>>; finished: ReturnType<typeof deferred<void>>; completion: ReturnType<typeof deferred<ReturnType<typeof nativeCommandResult>>>;
  progress: (value: NativeCommandProgress) => void; publish: (value: NativeCommandValue) => void; review: Review;
  streams: Record<'stdout' | 'stderr', { bytes: Uint8Array; pending: NativeCommandOutput[] }> };
type State = { authority: NativeCommandAuthority; stamp: string; peer?: NativePeer; ready: Promise<NativePeer>; entries: Map<string, Entry>;
  processes: Map<string, Entry>; queue: Promise<void>; queued: number; controls: number; closed: boolean };
const json = (v: unknown) => JSON.stringify(v);

/** Check complete values and byte streams before publication. Proper credential
 * prefixes stay private until later bytes or terminal completion disambiguate them. */
export function nativeCommandReview(secrets: string[], tokens: string[] = [], byteTokens: string[] = tokens): Review {
  const encoder = new TextEncoder();
  const encodings = (secret: string) => {
    const little = new Uint8Array(secret.length * 2), big = new Uint8Array(secret.length * 2);
    for (let i = 0; i < secret.length; i++) { const c = secret.charCodeAt(i); little[i * 2] = big[i * 2 + 1] = c & 255; little[i * 2 + 1] = big[i * 2] = c >> 8; }
    return [secret, ...[encoder.encode(secret), little, big].map(bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join('')))];
  };
  const variants = [...new Set(secrets.filter(Boolean).flatMap(encodings))];
  const tokenVariants = [...new Set(tokens.filter(Boolean).flatMap(encodings))];
  const byteVariants = [...new Set([...variants, ...byteTokens.filter(Boolean).flatMap(encodings)])];
  const patterns = byteVariants.flatMap(secret => {
    const little = new Uint8Array(secret.length * 2), big = new Uint8Array(secret.length * 2);
    for (let i = 0; i < secret.length; i++) { const c = secret.charCodeAt(i); little[i * 2] = big[i * 2 + 1] = c & 255; little[i * 2 + 1] = big[i * 2] = c >> 8; }
    return [encoder.encode(secret), little, big];
  }).filter(bytes => bytes.length > 0 && bytes.length <= nativeCommandLimits.outputBytes);
  return { value(value) { const scrub = redactor(variants, tokenVariants); scrub.value(value); if (scrub.changed) throw new VaultError('REDACTED'); }, bytes(bytes) {
    let held = false;
    for (const pattern of patterns) {
      const prefix = new Uint32Array(pattern.length);
      for (let i = 1, j = 0; i < pattern.length; i++) { while (j && pattern[i] !== pattern[j]) j = prefix[j - 1]!; if (pattern[i] === pattern[j]) j++; prefix[i] = j; }
      let j = 0;
      for (const byte of bytes) { while (j && byte !== pattern[j]) j = prefix[j - 1]!; if (byte === pattern[j]) j++; if (j === pattern.length) throw new VaultError('REDACTED'); }
      held ||= j > 0;
    }
    return held;
  } };
}
function prepared(input: Record<string, unknown>, value: unknown): Record<string, unknown> {
  const params = nativeCommandParams('command/exec', value);
  for (const key of new Set([...Object.keys(input), ...Object.keys(params)])) {
    if (['cwd', 'outputBytesCap', 'env'].includes(key)) continue;
    if (json(input[key]) !== json(params[key])) throw new VaultError('NATIVE_CONTRACT');
  }
  if (typeof params.cwd !== 'string' || !/^(?:\/|[A-Za-z]:[\\/])/.test(params.cwd) || params.outputBytesCap !== (input.outputBytesCap ?? nativeCommandLimits.outputBytes)) throw new VaultError('NATIVE_CONTRACT');
  const wanted = input.env as Record<string, unknown> | null | undefined, actual = params.env as Record<string, unknown> | null | undefined;
  for (const key of new Set([...Object.keys(wanted ?? {}), ...Object.keys(actual ?? {})])) {
    if (key === 'PATH' && typeof actual?.PATH === 'string' && (wanted?.PATH === undefined || actual.PATH === wanted.PATH || actual.PATH.endsWith(':' + wanted.PATH))) continue;
    if (json(wanted?.[key]) !== json(actual?.[key])) throw new VaultError('NATIVE_CONTRACT');
  }
  return params;
}

export class NativeCommandBroker {
  private readonly states = new Map<string, State>();
  private readonly runtime: NativeRuntimeBroker;
  constructor(runtime: NativeRuntimeBroker) { this.runtime = runtime; }
  active(id: string): boolean { return this.states.has(id); }
  private stamp(a: NativeCommandAuthority): string { return json([a.host, a.key, a.fingerprint, a.identity]); }
  private fail(state: State, error: unknown): void {
    if (state.closed) return; state.closed = true;
    const failure = error instanceof VaultError ? error : new VaultError('NATIVE_CONTRACT');
    if (this.states.get(state.authority.id) === state) this.states.delete(state.authority.id);
    for (const entry of state.entries.values()) { entry.cleanup(); entry.ready.reject(failure); entry.dispatched.reject(failure); entry.completion.reject(failure); entry.finished.resolve(); }
    state.entries.clear(); state.processes.clear(); if (this.runtime.commanding(state.authority.id)) this.runtime.close(state.authority.id);
  }
  close(id: string): void { const state = this.states.get(id); if (state) this.fail(state, new VaultError('CANCELLED')); }
  clear(): void { for (const state of [...this.states.values()]) this.fail(state, new VaultError('CANCELLED')); }
  private state(authority: NativeCommandAuthority): State {
    const current = this.states.get(authority.id), stamp = this.stamp(authority);
    if (current) { if (stamp !== current.stamp) { this.fail(current, new VaultError('CONFLICT')); throw new VaultError('CONFLICT'); } return current; }
    if (this.states.size >= 4) throw new VaultError('LIMIT');
    const state: State = { authority, stamp, entries: new Map(), processes: new Map(), queue: Promise.resolve(), queued: 0, controls: 0, closed: false, ready: undefined! };
    this.states.set(authority.id, state);
    state.ready = this.runtime.commandChannel(authority.id, authority.host, authority.key, authority.fingerprint, authority.identity, authority.guard, {
      frame: (frame, identity) => {
        if (state.closed || !sameNativeIdentity(identity, authority.identity) || ++state.queued > 32) { this.fail(state, new VaultError('NATIVE_CONTRACT')); throw new VaultError('NATIVE_CONTRACT'); }
        state.queue = state.queue.then(async () => { await authority.guard(); if (!state.closed) this.frame(state, frame); })
          .catch(error => this.fail(state, error)).finally(() => { state.queued--; }); return true;
      }, closed: () => this.fail(state, new VaultError('NATIVE_COMMAND'))
    }).then(peer => { if (state.closed) { peer.close(); throw new VaultError('NATIVE_COMMAND'); } state.peer = peer; return peer; }).catch(error => { this.fail(state, error); throw error; });
    void state.ready.catch(() => {}); return state;
  }
  private frame(state: State, frame: Record<string, unknown>): void {
    if (frame.method === nativeCommandApprovalMethod) {
      nativeObject(frame, ['id', 'method', 'params']); const p = nativeObject(frame.params, ['requestId', 'params']), entry = state.entries.get(String(p.requestId));
      if (!entry || entry.phase !== 'request' || typeof frame.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(frame.id)) throw new VaultError('NATIVE_CONTRACT');
      const params = prepared(entry.input, p.params); entry.review.value(params); entry.prepared = params; entry.phase = 'approval'; entry.hostToken = frame.id; entry.token = crypto.randomUUID();
      entry.ready.resolve();
      if (entry.cancelled) { void this.cancel(state, entry).catch(error => this.fail(state, error)); return; }
      entry.progress({ kind: 'command-approval', token: entry.token, processId: (entry.input.processId as string | null | undefined) ?? null, params: structuredClone(params) }); return;
    }
    if (frame.method === nativeCommandDispatchedMethod) {
      nativeObject(frame, ['method', 'params']); const p = nativeObject(frame.params, ['requestId', 'processId']), entry = state.entries.get(String(p.requestId));
      if (!entry || entry.phase !== 'approved' || p.processId !== (entry.input.processId ?? null)) throw new VaultError('NATIVE_CONTRACT');
      entry.phase = 'running'; entry.dispatched.resolve();
      if (!entry.cancelled) entry.publish({ protocol: 'json-rpc', stage: 'dispatched', processId: p.processId as string | null });
      return;
    }
    if (frame.method !== nativeCommandOutputMethod) throw new VaultError('NATIVE_CONTRACT');
    const note = nativeCommandOutput(frame), entry = state.processes.get(note.params.processId);
    if (!entry || entry.phase !== 'running') throw new VaultError('NATIVE_CONTRACT');
    entry.review.value(note); const stream = entry.streams[note.params.stream], bytes = nativeCommandBytes(note.params.deltaBase64), joined = new Uint8Array(stream.bytes.length + bytes.length);
    joined.set(stream.bytes); joined.set(bytes, stream.bytes.length); stream.bytes = joined;
    if (joined.length > Number(entry.prepared!.outputBytesCap) || stream.pending.length >= 64) throw new VaultError('LIMIT');
    stream.pending.push(note);
    if (!entry.review.bytes(joined)) this.flush(entry, note.params.stream);
  }
  private flush(entry: Entry, selected?: 'stdout' | 'stderr'): void {
    for (const key of selected ? [selected] : ['stdout', 'stderr'] as const) for (const notification of entry.streams[key].pending.splice(0)) {
      if (!entry.cancelled) entry.publish({ protocol: 'json-rpc', stage: 'output', processId: notification.params.processId, notification });
    }
  }
  async execute(authority: NativeCommandAuthority, input: unknown, review: Review, progress: Entry['progress'], publish: Entry['publish'], signal?: AbortSignal) {
    const params = nativeCommandParams('command/exec', input); review.value(params); if (signal?.aborted) throw new VaultError('CANCELLED');
    await authority.guard(); const state = this.state(authority), pid = params.processId as string | null | undefined;
    if (state.entries.size >= nativeCommandLimits.processes || pid != null && state.processes.has(pid)) throw new VaultError('CONFLICT');
    const entry: Entry = { id: 'cmd_' + crypto.randomUUID(), input: params, phase: 'request', cancelled: false, cleanup: () => signal?.removeEventListener('abort', cancel), ready: deferred(), dispatched: deferred(), finished: deferred(), completion: deferred(), progress, publish, review,
      streams: { stdout: { bytes: new Uint8Array(), pending: [] }, stderr: { bytes: new Uint8Array(), pending: [] } }, ...(signal ? { signal } : {}) };
    state.entries.set(entry.id, entry); if (pid != null) state.processes.set(pid, entry);
    const cancel = () => { entry.cancelled = true; void this.cancel(state, entry).catch(error => this.fail(state, error)); };
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    void (async () => {
      try {
        const peer = await state.ready; await authority.guard(); if (state.closed) throw new VaultError('NATIVE_COMMAND');
        const raw = await peer.request('command/exec', params, undefined, entry.id); await state.queue; await authority.guard();
        if (state.closed || entry.phase !== 'running') throw new VaultError('NATIVE_CONTRACT');
        const result = nativeCommandResult(raw); review.value(result); this.flush(entry); entry.phase = 'complete';
        if (entry.cancelled) throw new VaultError('CANCELLED');
        publish({ protocol: 'json-rpc', stage: 'completed', processId: pid ?? null, result }); entry.completion.resolve(result);
      } catch (error) {
        const failure = entry.cancelled ? new VaultError('CANCELLED') : error instanceof VaultError ? error : new VaultError('NATIVE_CONTRACT');
        entry.completion.reject(failure);
        if (!entry.cancelled && !['NATIVE_COMMAND', 'NATIVE_FAILED'].includes(failure.code)) this.fail(state, failure);
      } finally {
        entry.cleanup(); entry.phase = 'complete'; entry.ready.resolve(); entry.dispatched.resolve(); entry.finished.resolve(); state.entries.delete(entry.id); if (pid != null) state.processes.delete(pid);
        this.idle(state);
      }
    })();
    return entry.completion.promise;
  }
  private idle(state: State): void {
    if (!state.entries.size && !state.controls && !state.closed) { state.closed = true; this.states.delete(state.authority.id); this.runtime.close(state.authority.id); }
  }
  private async cancel(state: State, entry: Entry): Promise<void> {
    if (state.closed || entry.phase === 'complete') return;
    if (entry.phase === 'request') { await entry.ready.promise; return this.cancel(state, entry); }
    if (entry.phase === 'approval') { entry.phase = 'approved'; state.peer!.reply(entry.hostToken!, { decision: 'cancel' }); return; }
    if (entry.phase === 'approved') {
      await entry.dispatched.promise;
      return this.cancel(state, entry);
    }
    if (entry.input.processId == null) { this.fail(state, new VaultError('CANCELLED')); return; }
    await this.control(state.authority, 'command/exec/terminate', { processId: entry.input.processId }, entry.review);
  }
  async reply(id: string, token: string, decision: NativeDecision, signal?: AbortSignal): Promise<void> {
    const state = this.states.get(id), entry = state && [...state.entries.values()].find(entry => entry.token === token);
    if (!state || !entry || entry.phase !== 'approval' || signal && entry.signal !== signal || !['accept', 'decline', 'cancel'].includes(decision)) throw new VaultError('PERMISSION');
    try { await state.authority.guard(); } catch (error) { this.fail(state, error); throw error; }
    if (state.closed || entry.phase !== 'approval') throw new VaultError('PERMISSION');
    entry.phase = 'approved'; delete entry.token; state.peer!.reply(entry.hostToken!, { decision });
  }
  async control(authority: NativeCommandAuthority, method: Exclude<NativeCommandMethod, 'command/exec'>, input: unknown, review: Review, signal?: AbortSignal) {
    const params = nativeCommandParams(method, input); review.value(params); if (params.deltaBase64 != null) review.bytes(nativeCommandBytes(params.deltaBase64));
    if (signal?.aborted) throw new VaultError('CANCELLED'); await authority.guard();
    const state = this.states.get(authority.id), entry = state?.processes.get(params.processId as string);
    if (!state || state.stamp !== this.stamp(authority) || !entry || entry.phase !== 'running') throw new VaultError('CONFLICT');
    state.controls++;
    try {
      const peer = await state.ready; nativeObject(await peer.request(method, params), []); await state.queue; await authority.guard();
      if (method === 'command/exec/terminate') await entry.finished.promise;
      if (signal?.aborted) throw new VaultError('CANCELLED'); return {};
    } finally { state.controls--; this.idle(state); }
  }
}
