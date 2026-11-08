// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeFilesystemWatchParams, nativeFilesystemWatchResult, nativeFilesystemChangeFrame, nativeFilesystemWatchLimits,
  type NativeFilesystemWatchValue, type NativeFilesystemWatchCallback } from '../native-filesystem-watch.ts';
import { nativeObject, sameNativeIdentity, type NativeRuntimeIdentity } from '../native-runtime-contract.ts';
import { NativeRuntimeBroker, type NativePeer } from './native-runtime.ts';
import { VaultError } from './types.ts';

export type NativeWatchAuthority = { id: string; host: string; key: string; fingerprint: string; identity: NativeRuntimeIdentity; guard: () => Promise<void> };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject };
}
type Sink = { id: string; registered: Deferred<void>; completion: Deferred<NativeFilesystemWatchValue>; value?: NativeFilesystemWatchValue;
  publish: NativeFilesystemWatchCallback; sanitize: (value: NativeFilesystemWatchValue) => Promise<NativeFilesystemWatchValue>;
  cancelled: boolean; signal?: AbortSignal; stop?: Promise<void>; cleanup: () => void };
type State = { authority: NativeWatchAuthority; stamp: string; peer?: NativePeer; ready: Promise<NativePeer>; sinks: Map<string, Sink>;
  queue: Promise<void>; queued: number; closed: boolean; rootLost: boolean };

/** Private-worker ownership and bounded event delivery. No unwatch is replayed,
 * and only its own subscription is stopped on ordinary per-watch cancellation. */
export class NativeFilesystemWatchBroker {
  private readonly states = new Map<string, State>();
  private readonly runtime: NativeRuntimeBroker;
  constructor(runtime: NativeRuntimeBroker) { this.runtime = runtime; }
  active(id: string): boolean { return this.states.has(id); }
  private stamp(a: NativeWatchAuthority): string { return JSON.stringify([a.host, a.key, a.fingerprint, a.identity.runtimeId, a.identity.generation,
    a.identity.configuration, a.identity.workspace, a.identity.accountEpoch, a.identity.version]); }
  private fail(state: State, error: unknown): void {
    if (state.closed) return; state.closed = true;
    error = error instanceof VaultError ? error : new VaultError('NATIVE_CONTRACT');
    if (this.states.get(state.authority.id) === state) this.states.delete(state.authority.id);
    for (const sink of state.sinks.values()) { sink.cleanup(); sink.registered.reject(error); sink.completion.reject(error); }
    state.sinks.clear(); if (this.runtime.watching(state.authority.id)) this.runtime.close(state.authority.id);
  }
  close(id: string): void { const state = this.states.get(id); if (state) this.fail(state, new VaultError('CANCELLED')); }
  clear(): void { for (const state of [...this.states.values()]) this.fail(state, new VaultError('CANCELLED')); }
  private state(authority: NativeWatchAuthority): State {
    const current = this.states.get(authority.id), stamp = this.stamp(authority);
    if (current) {
      if (current.stamp !== stamp) { this.fail(current, new VaultError('CONFLICT')); throw new VaultError('CONFLICT'); }
      return current;
    }
    if (this.states.size >= 4) throw new VaultError('LIMIT');
    const state: State = { authority, stamp, sinks: new Map(), queue: Promise.resolve(), queued: 0, closed: false, rootLost: false, ready: undefined! };
    this.states.set(authority.id, state);
    state.ready = this.runtime.watchChannel(authority.id, authority.host, authority.key, authority.fingerprint, authority.identity, authority.guard, {
      frame: (frame, identity) => {
        try {
          if (state.closed || !sameNativeIdentity(identity, authority.identity)) throw new VaultError('AUTHORIZATION');
          const note = nativeFilesystemChangeFrame(frame), sink = state.sinks.get(note.params.watchId);
          if (!sink || ++state.queued > 32) throw new VaultError('NATIVE_CONTRACT');
          state.queue = state.queue.then(async () => {
            await sink.registered.promise;
            if (state.closed || sink.cancelled || !state.sinks.has(sink.id)) return;
            await authority.guard();
            const value = await sink.sanitize({ protocol: 'json-rpc', result: sink.value!.result, notification: note });
            await authority.guard(); if (state.closed || sink.cancelled || !state.sinks.has(sink.id)) return;
            sink.value = value; sink.publish(structuredClone(value));
          }).catch(error => this.fail(state, error)).finally(() => { state.queued--; });
          return true;
        } catch (error) { this.fail(state, error); throw error; }
      },
      closed: reason => {
        if (state.closed) return;
        if (reason === 'root-lost') { state.rootLost = true; void state.queue.then(() => this.fail(state, new VaultError('NATIVE_FILESYSTEM'))); }
        else this.fail(state, new VaultError('NATIVE_FILESYSTEM'));
      }
    }).then(peer => { if (state.closed) { peer.close(); throw new VaultError('NATIVE_FILESYSTEM'); } state.peer = peer; return peer; })
      .catch(error => { this.fail(state, error); throw error; });
    void state.ready.catch(() => {}); return state;
  }
  async subscribe(authority: NativeWatchAuthority, input: unknown, publish: NativeFilesystemWatchCallback,
    sanitize: Sink['sanitize'], signal?: AbortSignal): Promise<NativeFilesystemWatchValue> {
    const params = nativeFilesystemWatchParams('fs/watch', input); if (signal?.aborted) throw new VaultError('CANCELLED');
    await authority.guard(); const state = this.state(authority);
    if (state.sinks.has(params.watchId) || state.sinks.size >= nativeFilesystemWatchLimits.watches) throw new VaultError('CONFLICT');
    const sink: Sink = { id: params.watchId, registered: deferred(), completion: deferred(), publish, sanitize, cancelled: false, cleanup: () => signal?.removeEventListener('abort', cancel), ...(signal ? { signal } : {}) };
    state.sinks.set(sink.id, sink);
    const cancel = () => { sink.cancelled = true; void this.stop(state, sink).catch(error => this.fail(state, error)); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const peer = await state.ready; await authority.guard();
      if (state.closed) throw new VaultError('NATIVE_FILESYSTEM');
      const result = nativeFilesystemWatchResult(await peer.request('fs/watch', params));
      await authority.guard();
      const value = await sanitize({ protocol: 'json-rpc', result }); await authority.guard();
      if (state.closed) throw new VaultError('NATIVE_FILESYSTEM');
      sink.value = value; sink.registered.resolve();
      if (sink.cancelled || signal?.aborted) { sink.cancelled = true; void this.stop(state, sink).catch(error => this.fail(state, error)); }
      else sink.publish(structuredClone(value));
    } catch (error) { sink.registered.reject(error); this.fail(state, error); }
    return sink.completion.promise;
  }
  private stop(state: State, sink: Sink): Promise<void> {
    if (sink.stop) return sink.stop;
    return sink.stop = (async () => {
      const peer = await state.ready; await sink.registered.promise; await state.authority.guard();
      nativeObject(await peer.request('fs/unwatch', { watchId: sink.id }), []);
      await state.queue; await state.authority.guard();
      if (state.closed) throw new VaultError('NATIVE_FILESYSTEM');
      state.sinks.delete(sink.id); sink.cleanup();
      if (sink.cancelled) sink.completion.reject(new VaultError('CANCELLED')); else sink.completion.resolve(sink.value!);
      if (!state.sinks.size) { state.closed = true; this.states.delete(state.authority.id); this.runtime.close(state.authority.id); }
    })();
  }
  async unwatch(authority: NativeWatchAuthority, input: unknown, signal?: AbortSignal): Promise<Record<string, never>> {
    const params = nativeFilesystemWatchParams('fs/unwatch', input); if (signal?.aborted) throw new VaultError('CANCELLED');
    await authority.guard(); const state = this.state(authority), sink = state.sinks.get(params.watchId);
    try {
      if (sink) await this.stop(state, sink);
      else {
        const peer = await state.ready; nativeObject(await peer.request('fs/unwatch', params, signal), []); await authority.guard();
        if (!state.sinks.size) { state.closed = true; this.states.delete(authority.id); this.runtime.close(authority.id); }
      }
      return {};
    } catch (error) {
      if (state.rootLost) await state.queue;
      this.fail(state, error); throw error;
    }
  }
}
