// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Script only speech inference and microphone hardware. The controller,
// feature worker, preferences, IndexedDB, draft and Settings UI are real.
export async function installSpeechFixture(page, { slow = false } = {}) {
  await page.addInitScript(({ slow }) => {
    const NativeWorker = window.Worker;
    const fixture = window.speechFixture = { workers: 0, terminated: 0, stoppedTracks: 0, permission: 'allow', starts: [], ends: [], nodes: [], slow };
    window.Worker = function(url, options) {
      if (options?.name !== 'operations-parakeet-worker') {
        const worker = new NativeWorker(url, options);
        if (options?.name === 'operations-parakeet-features') {
          fixture.featureUrl = String(url);
          worker.addEventListener('error', event => fixture.featureError = { message: event.message, filename: event.filename });
        }
        return worker;
      }
      const worker = new EventTarget(); fixture.workers++; let stopped = false, sessionId, port;
      const emit = data => { if (!stopped) { const event = new MessageEvent('message', { data }); worker.onmessage?.(event); worker.dispatchEvent(event); } };
      fixture.emit = emit;
      worker.postMessage = data => queueMicrotask(() => {
        if (stopped) return;
        if (data.type === 'load') { fixture.mode = data.mode; emit({ type: 'initializing', text: 'Creating encoder session…' }); if (!fixture.slow) emit({ type: 'ready', runtime: { parakeetJs: '1.4.4', ort: '1.30.0' } }); }
        if (data.type === 'streamStart') { sessionId = data.sessionId; port = data.featurePort; fixture.starts.push(sessionId); fixture.sessionId = sessionId; }
        if (data.type === 'streamEnd') { fixture.ends.push(data); port.close(); emit({ type: 'result', sessionId, text: fixture.finalText ?? 'First sentence. Second sentence.', seconds: data.pcm.length / 16000 }); }
        if (data.type === 'transcribe') { fixture.fileSamples = data.pcm.length; emit({ type: 'result', sessionId: data.sessionId, text: 'From an audio file.', seconds: data.pcm.length / 16000 }); }
      });
      worker.terminate = () => { if (!stopped) { stopped = true; port?.close(); fixture.terminated++; } };
      return worker;
    };
    const stream = () => {
      let stopped = false;
      const track = { stop() { if (!stopped) { stopped = true; fixture.stoppedTracks++; } }, getSettings() { return { sampleRate: 16000, channelCount: 1 }; } };
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      if (fixture.permission === 'deny') throw new DOMException('Microphone permission denied', 'NotAllowedError');
      if (fixture.permission === 'pending') return new Promise(resolve => fixture.grant = () => resolve(stream()));
      return stream();
    } });
    window.AudioContext = class {
      constructor() { this.sampleRate = 16000; this.state = 'running'; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      async close() { this.state = 'closed'; }
      async resume() {}
    };
    window.AudioWorkletNode = class {
      constructor() {
        this.port = { onmessage: null, postMessage: data => { if (data === 'flush') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed' } })); } };
        fixture.nodes.push(this);
      }
      connect() {} disconnect() {}
    };
    fixture.pcm = () => fixture.nodes.at(-1).port.onmessage({ data: { type: 'pcm', pcm: Float32Array.from({ length: 4000 }, (_, i) => .1 * Math.sin(i * .05)) } });
    fixture.partial = (stableText, draftText = '') => fixture.emit({ type: 'partial', sessionId: fixture.sessionId, text: `${stableText} ${draftText}`.trim(), stableText, draftText, seconds: .25 });
  }, { slow });
  await page.reload(); await page.locator('#startup-status').waitFor({ state: 'detached' });
}
