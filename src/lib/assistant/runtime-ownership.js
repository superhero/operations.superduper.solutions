// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from Code's browser queue/ownership contracts; application namespace
// and worker-resident handoff are Operations-owned.

/** Cancellation removes a waiter. An active job settles only after its cleanup. */
export class BrowserWorkQueue {
  active = false;
  waiting = [];
  get busy() { return this.active || this.waiting.length > 0; }
  run(run, signal, onQueued = () => {}) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const job = {run, resolve, reject, signal, abort: () => {
        this.waiting = this.waiting.filter(item => item !== job);
        reject(signal.reason);
      }};
      if (this.busy) onQueued();
      signal?.addEventListener('abort', job.abort, {once: true});
      this.waiting.push(job);
      void this.drain();
    });
  }
  async drain() {
    if (this.active) return;
    this.active = true;
    try {
      let job;
      while ((job = this.waiting.shift())) {
        job.signal?.removeEventListener('abort', job.abort);
        try { job.signal?.throwIfAborted(); job.resolve(await job.run()); }
        catch (error) { job.reject(error); }
      }
    } finally { this.active = false; }
  }
}

/** Awaiting release includes Web Locks' completion, not just our callback. */
export async function browserLease(name, signal, locks = globalThis.navigator?.locks) {
  if (!locks) throw Error('Local model coordination requires Web Locks in a secure browser.');
  signal?.throwIfAborted();
  let release, acquired, failed;
  const held = new Promise(resolve => { release = resolve; });
  const granted = new Promise((resolve, reject) => { acquired = resolve; failed = reject; });
  const completed = locks.request(name, signal ? {signal} : {}, async () => { acquired(); await held; });
  void completed.catch(failed);
  await granted;
  return async () => { release(); await completed; };
}

export const runtimeOwnershipName = 'operations-ai-model-runtime-v1';

/** One same-origin physical runtime. Hold the resident lease across idle time;
 * another owner's request schedules disposal after our entire turn/tool loop.
 * Nested tools execute inside run(), never re-enter this queue. */
export class BrowserRuntimeOwner {
  constructor({suspend, status = () => {}, onError = () => {}, locks = globalThis.navigator?.locks,
    channel = name => new BroadcastChannel(name), id = globalThis.crypto.randomUUID()} = {}) {
    this.suspend = suspend; this.status = status; this.onError = onError;
    this.locks = locks; this.createChannel = channel; this.id = id;
    this.work = new BrowserWorkQueue();
  }
  connect() {
    if (this.channel) return;
    this.channel = this.createChannel(runtimeOwnershipName);
    this.channel.onmessage = ({data}) => {
      if (data?.type !== 'request' || typeof data.owner !== 'string' || data.owner === this.id) return;
      // Also remember a request while acquiring: that waiter must receive a
      // handoff after this turn, even if we had not acquired our lease yet.
      this.yieldRequested = true;
      if (!this.yieldQueued) {
        this.yieldQueued = true;
        void this.work.run(async () => { this.yieldQueued = false; await this.relinquish(); }).catch(this.onError);
      }
    };
  }
  async acquire(signal) {
    if (this.releaseLease) return;
    this.connect();
    this.status('Waiting for the local model runtime…');
    this.channel.postMessage({type: 'request', owner: this.id});
    this.releaseLease = await browserLease(runtimeOwnershipName, signal, this.locks);
    signal?.throwIfAborted();
  }
  run(run, {signal, gpu = true, resident = true} = {}) {
    return this.work.run(async () => {
      let failed = false;
      try {
        if (gpu) await this.acquire(signal);
        signal?.throwIfAborted();
        return await run();
      } catch (error) { failed = true; throw error; }
      finally { if (gpu && (failed || this.yieldRequested || !resident)) await this.relinquish(); }
    }, signal, () => this.status('Queued after the current local model operation…'));
  }
  async relinquish() {
    this.yieldRequested = false;
    if (!this.releaseLease) return;
    // A rejected disposal retains ownership. Unknown cleanup must not grant
    // another model permission to allocate alongside it.
    await this.suspend();
    const release = this.releaseLease;
    await release();
    this.releaseLease = undefined;
  }
  release() { return this.work.run(() => this.relinquish()); }
  async close() {
    await this.release();
    this.channel?.close(); this.channel = undefined;
  }
}
