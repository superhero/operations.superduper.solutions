// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from llm-sds-01 AO browser Parakeet streaming; see NOTICES.md.
// Main owns capture/preprocessing; inference receives a MessagePort for feature
// requests. PCM reaches this worker even while CPU ONNX blocks inference.
export class LiveFeatures {
  constructor(nMels = 128, port = null, workerFactory = null) {
    this.pending = new Map(); this.id = 0; this.closed = false;
    this.owner = !port;
    this.transport = port || workerFactory();
    this.transport.onmessage = ({ data }) => {
      if (data.fatal) { this.fail(new Error(data.error)); return; }
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      data.error ? request.reject(new Error(data.error)) : request.resolve(data.result);
    };
    if (this.owner) {
      this.transport.onerror = event => this.fail(new Error(event.message || 'Feature worker failed.'));
      this.transport.postMessage({ type: 'init', nMels });
    } else this.transport.start();
  }
  fail(error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear(); this.failure = error;
    if (!this.closed) this.onfailure?.(error);
  }
  assertOpen() { if (this.failure) throw this.failure; }
  connect() {
    this.assertOpen();
    if (!this.owner) throw new Error('Only the feature worker owner can connect clients.');
    const channel = new MessageChannel();
    this.transport.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
    return channel.port2;
  }
  push(pcm) {
    this.assertOpen();
    if (!this.owner) throw new Error('Only the feature worker owner can push audio.');
    const copy = pcm.slice(); this.transport.postMessage({ type: 'push', pcm: copy }, [copy.buffer]);
  }
  compute(startSample, endSample) {
    try { this.assertOpen(); } catch(error) { return Promise.reject(error); }
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.postMessage({ type: 'compute', id, startSample, endSample });
    });
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.fail(new Error('Feature worker closed.'));
    if (this.owner) { this.transport.postMessage({ type: 'close' }); this.transport.terminate(); }
    else { this.transport.postMessage({ type: 'disconnect' }); this.transport.close(); }
  }
}
