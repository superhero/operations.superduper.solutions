// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import captureSource from './capture-worklet.js?raw';
import { LiveFeatures } from './live-features.js';
import { wav, signalStats } from './diagnostics.js';
import { speechPreferenceKey, speechPreferences, recordingLimit, initializationDeadline, downloadDeadline, downloadIdleDeadline } from './config.js';
import { listRecordings, saveRecording } from './storage.js';
import { trackApplicationWorker } from '../application-workers.ts';

export class SpeechController {
  constructor({ state, text, recordings, dependencies = {} }) {
    this.notify = state; this.text = text; this.recordings = recordings;
    this.dependencies = dependencies; this.generation = 0; this.alive = true;
    this.state = { phase: 'unloaded', status: 'Load speech to dictate a message.', error: '', provisional: '', storageError: '', seconds: 0 };
    try { this.preferences = speechPreferences(JSON.parse(localStorage.getItem(speechPreferenceKey) || '{}')); }
    catch { this.preferences = speechPreferences({}); this.state.storageError = 'Speech preferences could not be read.'; }
    this.writing = Promise.resolve(); this.update(); void this.refreshRecordings();
  }
  update(fields = {}) { Object.assign(this.state, fields); if (this.alive) this.notify({ ...this.state }); }
  preferencesChanged(value) {
    this.preferences = speechPreferences({ ...this.preferences, ...value });
    try { localStorage.setItem(speechPreferenceKey, JSON.stringify(this.preferences)); }
    catch { this.update({ storageError: 'Speech preferences could not be saved.' }); }
  }
  async refreshRecordings() {
    try { const records = await (this.dependencies.listRecordings || listRecordings)(); if (this.alive) this.recordings(records); }
    catch (error) { this.update({ storageError: `Local recording storage unavailable: ${error.message}` }); }
  }
  async flushStorage() { await this.writing; }
  workerFactory(kind) {
    if (this.dependencies.worker) return this.dependencies.worker(kind);
    const url = import.meta.env.DEV ? new URL(kind === 'worker' ? './inference.worker.js' : './features.worker.js', import.meta.url) : new URL(`speech/${kind}.js`, document.baseURI);
    const worker = new Worker(url, { type: 'module', name: `operations-parakeet-${kind}` });
    const release = trackApplicationWorker(worker, { scope: 'assistant', reportErrors: false });
    const terminate = worker.terminate.bind(worker); worker.terminate = () => { release(); terminate(); };
    return worker;
  }
  timeout(ms, message) { clearTimeout(this.timer); this.timer = setTimeout(() => this.fail(message), ms); }
  load() {
    if (this.state.phase !== 'unloaded') return;
    this.update({ phase: 'downloading', status: 'Checking cached speech resources…', error: '', provisional: '' });
    this.downloadStarted = Date.now();
    this.loadStages = [];
    this.timeout(downloadIdleDeadline, 'Speech download stopped making progress. Retry to resume cached files.');
    try {
      const worker = this.worker = this.workerFactory('worker');
      worker.onmessage = ({ data }) => { if (this.worker === worker) this.message(data); };
      worker.onerror = event => { if (this.worker === worker) { event.preventDefault(); this.fail(event.message || 'The speech worker stopped unexpectedly.'); } };
      worker.onmessageerror = () => { if (this.worker === worker) this.fail('Could not read the speech worker response.'); };
      worker.postMessage({ type: 'load', mode: this.preferences.mode });
    } catch (error) { this.fail(error.message); }
  }
  message(data) {
    if (data.type === 'progress') {
      if (Date.now() - this.downloadStarted >= downloadDeadline) { this.fail('Speech download deadline reached. Retry to resume cached files.'); return; }
      this.timeout(downloadIdleDeadline, 'Speech download stopped making progress. Retry to resume cached files.');
      this.update({ status: data.text || `Downloading ${data.file}… ${Math.round(100 * data.loaded / data.total)}%` });
    } else if (data.type === 'initializing') {
      this.loadStages.push({ stage: data.text, atMs: Date.now() - this.downloadStarted });
      this.update({ phase: 'initializing', status: data.text });
      this.timeout(initializationDeadline, 'Speech initialization exceeded 120 seconds. Retry creates a fresh worker.');
    } else if (data.type === 'stage') { this.loadStages.push({ stage: data.text, atMs: Date.now() - this.downloadStarted }); this.update({ status: data.text }); }
    else if (data.type === 'ready') {
      clearTimeout(this.timer); this.runtime = data.runtime;
      this.preferencesChanged({ loaded: true }); this.update({ phase: 'ready', status: 'Speech ready · audio and transcription stay in this browser.' });
    } else if (data.type === 'partial' || data.type === 'result') {
      if (data.sessionId !== this.record?.id) return;
      const final = data.type === 'result';
      this.record.events.push({ type: data.type, atMs: Math.round(performance.now() - this.started) });
      if (final) { this.record.final = data; this.record.status = 'complete'; }
      else this.record.partials.push({ atMs: Math.round(performance.now() - this.started), ...data });
      this.update({ provisional: final ? '' : data.draftText || '', seconds: data.seconds || this.state.seconds });
      if (!this.preferences.refine || final) this.text({ sessionId: data.sessionId, confirmed: final ? data.text : data.stableText || '', final });
      if (final) {
        clearTimeout(this.timer); this.features?.close(); this.features = undefined;
        this.update({ phase: 'ready', status: data.text ? 'Transcript added to your draft.' : 'No speech detected. Your draft is unchanged.' });
      }
      this.persist();
    } else if (data.type === 'error') {
      if (data.sessionId && data.sessionId !== this.record?.id) return;
      this.fail(data.message);
    }
  }
  startRecord(source = 'microphone') {
    this.chunks = []; this.savedSecond = -1; this.started = performance.now();
    this.record = { id: crypto.randomUUID(), created: new Date().toISOString(), status: 'recording', expected: '',
      metadata: { source, profile: this.preferences.mode, runtime: this.runtime, startupStages: this.loadStages, sampleRate: 16000, refine: this.preferences.refine }, events: [{ type: 'start', atMs: 0 }], partials: [], final: null };
    this.update({ provisional: '', seconds: 0, error: '' }); this.persist(); return this.record.id;
  }
  persist() {
    if (!this.record) return;
    const snapshot = structuredClone({ ...this.record, audio: wav(this.chunks), signal: signalStats(this.chunks) });
    this.writing = this.writing.catch(() => {}).then(() => (this.dependencies.saveRecording || saveRecording)(snapshot))
      .then(() => this.refreshRecordings()).catch(error => this.update({ storageError: `Local recording save failed: ${error.message}. Export before leaving this page.` }));
  }
  receivePcm(pcm) {
    if (!['recording', 'finalizing'].includes(this.state.phase)) return;
    const remaining = recordingLimit * 16000 - this.chunks.reduce((sum, x) => sum + x.length, 0);
    const chunk = pcm.slice(0, Math.max(0, remaining));
    if (!chunk.length) return;
    this.chunks.push(chunk); this.features.push(chunk);
    const copy = chunk.slice(); this.worker.postMessage({ type: 'streamChunk', sessionId: this.record.id, pcm: copy }, [copy.buffer]);
    const seconds = this.chunks.reduce((sum, x) => sum + x.length, 0) / 16000;
    this.record.events.push({ type: 'audio', atMs: Math.round(performance.now() - this.started), receivedSeconds: seconds });
    this.update({ seconds });
    if (Math.floor(seconds) > this.savedSecond) { this.savedSecond = Math.floor(seconds); this.persist(); }
    if (seconds >= recordingLimit && this.state.phase === 'recording') void this.stopRecording();
  }
  async startRecording() {
    if (this.state.phase !== 'ready') return;
    const generation = ++this.generation;
    this.startRecord(); this.update({ phase: 'requesting', status: 'Allow microphone access to start dictation…' });
    this.timeout(30000, 'Microphone permission timed out. Retry when you are ready.');
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture requires HTTPS and browser permission. You can also choose an audio file.');
      stream = await (this.dependencies.microphone || (constraints => navigator.mediaDevices.getUserMedia(constraints)))({ audio: true });
      if (!this.alive || generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const context = this.context = this.dependencies.audioContext ? this.dependencies.audioContext() : new AudioContext({ sampleRate: 16000 });
      if (context.sampleRate !== 16000) throw new Error('This browser cannot capture at 16 kHz. Choose an audio file instead.');
      const captureUrl = URL.createObjectURL(new Blob([captureSource], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(captureUrl); } finally { URL.revokeObjectURL(captureUrl); }
      if (generation !== this.generation) return;
      this.node = this.dependencies.captureNode ? this.dependencies.captureNode(context) : new AudioWorkletNode(context, 'pcm-capture');
      this.node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === 'pcm') {
          try { this.receivePcm(data.pcm); } catch (error) { this.fail(error.message); }
        }
        else if (data.type === 'flushed') this.flushed?.();
      };
      this.features = new LiveFeatures(128, null, () => this.workerFactory('features'));
      this.features.onfailure = error => this.fail(error.message);
      const featurePort = this.features.connect();
      this.worker.postMessage({ type: 'streamStart', sessionId: this.record.id, featurePort }, [featurePort]);
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.node); this.node.connect(context.destination);
      this.record.metadata.capture = { sampleRate: stream.getAudioTracks()[0]?.getSettings().sampleRate, channelCount: stream.getAudioTracks()[0]?.getSettings().channelCount };
      await context.resume();
      if (generation !== this.generation) return;
      clearTimeout(this.timer); this.update({ phase: 'recording', status: 'Listening… Stop to finish your draft.' });
      this.autoStop = setTimeout(() => void this.stopRecording(), recordingLimit * 1000);
    } catch (error) {
      if (generation === this.generation) {
        this.generation++; await this.closeCapture(); clearTimeout(this.timer);
        this.record.status = 'error'; this.record.events.push({ type: 'error', message: error.message }); this.persist();
        this.update({ phase: 'ready', error: error.message, status: 'Speech is ready. Retry microphone access or choose a file.' });
      } else stream?.getTracks().forEach(track => track.stop());
    }
  }
  async closeCapture() {
    clearTimeout(this.autoStop);
    this.source?.disconnect(); this.source = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.node?.disconnect(); this.node = undefined;
    const context = this.context; this.context = undefined;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
  async stopRecording() {
    if (this.state.phase === 'requesting') {
      this.generation++; clearTimeout(this.timer); await this.closeCapture();
      this.record.status = 'cancelled'; this.persist();
      this.update({ phase: 'ready', status: 'Microphone request cancelled.' }); return;
    }
    if (this.state.phase !== 'recording') return;
    this.update({ phase: 'finalizing', status: 'Finishing transcript…' });
    this.record.status = 'finishing';
    this.record.events.push({ type: 'stop', atMs: Math.round(performance.now() - this.started) });
    clearTimeout(this.autoStop); this.source?.disconnect(); this.stream?.getTracks().forEach(track => track.stop());
    const generation = this.generation;
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.flushed = undefined; resolve(); }, 3000);
      this.flushed = () => { clearTimeout(timer); this.flushed = undefined; resolve(); };
      this.node.port.postMessage('flush');
    });
    await this.closeCapture();
    if (!this.alive || generation !== this.generation || this.state.phase !== 'finalizing') return;
    this.persist();
    this.timeout(initializationDeadline, 'Speech finalization exceeded 120 seconds. The recording is saved locally; Retry to load speech again.');
    const count = this.chunks.reduce((sum, x) => sum + x.length, 0), pcm = new Float32Array(count);
    let offset = 0; for (const chunk of this.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
    this.worker.postMessage({ type: 'streamEnd', sessionId: this.record.id, refine: this.preferences.refine, pcm }, [pcm.buffer]);
  }
  async file(file) {
    if (!file || this.state.phase !== 'ready') return;
    const generation = ++this.generation;
    this.startRecord('file'); this.update({ phase: 'finalizing', status: 'Reading audio file…' });
    this.timeout(initializationDeadline, 'Audio transcription exceeded 120 seconds. Retry to load speech again.');
    try {
      if (file.size > 10485760) throw new Error('Choose an audio file up to 10 MiB and 60 seconds.');
      const context = new OfflineAudioContext(1, 16000, 16000);
      const audio = await context.decodeAudioData(await file.arrayBuffer());
      if (generation !== this.generation || !this.alive) return;
      if (audio.duration < .1 || audio.duration > 60) throw new Error('Choose audio between 0.1 and 60 seconds.');
      const pcm = new Float32Array(audio.length);
      for (let channel = 0; channel < audio.numberOfChannels; channel++) {
        const values = audio.getChannelData(channel); for (let i = 0; i < pcm.length; i++) pcm[i] += values[i] / audio.numberOfChannels;
      }
      this.chunks = [pcm]; this.persist();
      const copy = pcm.slice(); this.worker.postMessage({ type: 'transcribe', sessionId: this.record.id, pcm: copy }, [copy.buffer]);
    } catch (error) { if (generation === this.generation) this.fail(error.message); }
  }
  fail(message) { this.unload(false, message); this.update({ error: message, status: 'Speech stopped. Retry creates a fresh worker and reuses cached downloads.' }); }
  unload(forget = true, reason = 'Speech unloaded.') {
    this.generation++; clearTimeout(this.timer); void this.closeCapture();
    this.features?.close(); this.features = undefined; this.worker?.terminate(); this.worker = undefined;
    if (this.record && !['complete', 'cancelled', 'error'].includes(this.record.status)) {
      this.record.status = 'error'; this.record.events.push({ type: 'reset', message: reason }); this.persist();
    }
    if (forget) this.preferencesChanged({ loaded: false });
    this.update({ phase: 'unloaded', status: reason, provisional: '' });
  }
  hidden() { if (['recording', 'requesting'].includes(this.state.phase)) void this.stopRecording(); }
  destroy() { this.alive = false; this.unload(false, 'Page closed.'); }
}
