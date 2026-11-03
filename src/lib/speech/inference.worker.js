// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { fromUrls } from 'parakeet.js';
import * as ort from 'onnxruntime-web';
import { modelFiles, runtimeFiles, verifyBlob } from './assets.js';
import { modelLock } from './config.js';
import { LiveDecoder } from './live-decoder.js';
import { LiveFeatures } from './live-features.js';
import { TenVad } from './ten-vad.js';
import { BrowserRuntimeOwner } from '../assistant/runtime-ownership.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let model, live, streamId, vad, features, refine = false, maxContextSeconds = 30, mode, runtime, ownedDevice, loadedOnce = false, nativeLoading = false;
const send = (type, data = {}) => postMessage({type, ...data});
let queue = Promise.resolve(), streamTask, streamAbort, finishStream, prepared = false;
const owner = new BrowserRuntimeOwner({
  suspend: suspendModel,
  status: text => send('runtime-status', {text}),
  onError: error => send('error', {message: error.message || String(error)}),
});
async function suspendModel() {
  // A PCM/VAD failure can arrive while a native forward is still pending.
  // Keep the scope until that forward drains before releasing its sessions.
  await live?.cancel();
  if (!model) {if (nativeLoading) throw Error('Speech initialization cleanup is unconfirmed; terminate this worker.');return;}
  model.resetMelCache(); model.clearIncrementalCache();
  const results = await Promise.allSettled([model.encoderSession.release(), model.joinerSession.release()]);
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Speech session cleanup failed.');
  for (const name of ['_combState1','_combState2','_targetTensor','_targetLenTensor','_encoderFrameTensor']) model[name]?.dispose?.();
  if (ownedDevice) { await ownedDevice.queue.onSubmittedWorkDone(); ownedDevice.destroy(); ownedDevice = undefined; }
  features?.close(); features = undefined; vad?.close(); vad = undefined; model = undefined;
  send('suspended', {recreate: true});
}
async function loadModel() {
  if (model) return;
  if (loadedOnce) throw Error('Restore speech in a fresh worker after a runtime handoff.');
  const gpu = mode === 'gpu-fp32';
  maxContextSeconds = gpu ? 30 : 6;
  if (gpu) {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }) || await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available to speech. Select CPU explicitly to use it.');
    ort.env.webgpu.adapter = adapter;
  }
  const progress = value => send('progress', value);
  const paths = await runtimeFiles(progress);
  ort.env.wasm.wasmPaths = paths;
  const files = await modelFiles(mode, progress);
  send('initializing', { text: 'Initializing speech in browser memory…' });
  try {
    if (gpu) {
      send('stage', { text: 'Initializing CPU decoder runtime…' });
      const bootstrap = await ort.InferenceSession.create(files.decoderUrl, { executionProviders: ['wasm'] });
      await bootstrap.release();
    }
    nativeLoading = true;
    model = await fromUrls({ ...files, backend: gpu ? 'webgpu-strict' : 'wasm', encoderQuant: gpu ? 'fp32' : 'int8', decoderQuant: 'int8',
      preprocessorBackend: 'js', cpuThreads: 1, wasmPaths: paths,
      onSessionStage: stage => send('stage', { text: ({ encoder_session_start: 'Creating encoder session…', encoder_session_ready: 'Encoder ready.', decoder_session_start: 'Creating decoder session…', decoder_session_ready: 'Decoder ready.' })[stage] }),
    });
    nativeLoading = false;
    if (gpu) ownedDevice = await ort.env.webgpu.device;
    const vadBlob = await (await fetch(new URL('./vendor/ten-vad/ten_vad.wasm', import.meta.url))).blob();
    await verifyBlob(vadBlob, { file: 'TEN-VAD', bytes: vadBlob.size, sha256: '1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3' });
    vad = await TenVad.create(new Uint8Array(await vadBlob.arrayBuffer()));
  } finally { files.release(); }
  runtime = { model: modelLock.publisherModel, revision: modelLock.revision, backend: gpu ? 'webgpu-strict' : 'wasm',
    encoderQuant: gpu ? 'fp32' : 'int8', decoderQuant: 'int8', wasmThreads: 1, parakeetJs: '1.4.4', ort: '1.30.0', streamingMaxContextSeconds: maxContextSeconds };
  loadedOnce = true;
}
async function cancelStream() {
  streamAbort?.abort(new DOMException('Speech preparation cancelled.', 'AbortError'));
  await live?.cancel();
  finishStream?.resolve();
}
self.onmessage = ({data}) => {
  if (data.type === 'streamCancel') {if (data.sessionId === streamId) void cancelStream();return;}
  if (data.type === 'archive_done') {if (data.sessionId === streamId) finishStream?.resolve();return;}
  if (data.type === 'dispose') {
    void (async () => {
      await cancelStream(); await streamTask?.catch(() => {});
      await owner.close(); if (mode === 'cpu') await suspendModel(); send('disposed');
    })().catch(error => send('error', {message: error.message || String(error)}));return;
  }
  queue = queue.then(() => handle(data));
};
async function handle(data) {
  try {
    if (data.type === 'load') {
      if (mode) throw Error('Speech model is already configured.');
      mode = data.mode;
      if (!['cpu','gpu-fp32'].includes(mode)) throw Error('Choose an explicit speech runtime.');
      await owner.run(loadModel, {gpu: mode === 'gpu-fp32'});
      send('ready', {runtime, suspended: !model});
    } else if (data.type === 'streamPrepare') {
      mode ??= data.mode;
      if (!['cpu','gpu-fp32'].includes(mode)) throw Error('Choose an explicit speech runtime.');
      if (streamTask) throw Error('The previous speech recording has not drained.');
      streamId = data.sessionId; prepared = false; live = undefined;
      const sessionId = streamId;
      const active = streamAbort = new AbortController();
      const done = new Promise((resolve, reject) => {finishStream = {resolve, reject};});
      // Attach immediately: cancellation/feature failure can arrive during load.
      void done.catch(() => {});
      streamTask = owner.run(async () => {
        await loadModel(); active.signal.throwIfAborted(); prepared = true;
        send('prepared', {sessionId: streamId, runtime});
        await done;
      }, {signal: active.signal, gpu: mode === 'gpu-fp32'}).catch(error => {
        if (error.name !== 'AbortError') send('error', {sessionId: streamId, message: error.message || String(error)});
      }).finally(() => {streamTask = undefined; streamAbort = undefined; finishStream = undefined; prepared = false; send('drained', {sessionId});});
    } else if (data.type === 'streamStart') {
      if (!model || !streamTask || !prepared) throw new Error('Prepare speech before microphone capture.');
      model.resetMelCache(); model.clearIncrementalCache();
      streamId = data.sessionId; const sessionId = streamId;
      features?.close();
      const sessionFeatures = features = new LiveFeatures(128, data.featurePort); vad.reset();
      live = new LiveDecoder({ maxContextSeconds, detect: pcm => vad.process(pcm),
        infer: async (pcm, timeOffset) => {
          const start = performance.now();
          const prepared = await sessionFeatures.compute(Math.round(timeOffset * 16000), Math.round(timeOffset * 16000) + pcm.length);
          const preprocessMs = performance.now() - start;
          const result = await model.transcribe(pcm, 16000, { returnTimestamps: true, timeOffset, precomputedFeatures: prepared });
          return { ...result, preprocessing: { ms: preprocessMs, cachedFrames: prepared.cachedFrames, newFrames: prepared.newFrames, totalComputedFrames: prepared.totalComputedFrames } };
        },
        update: result => send('partial', { sessionId, ...result }),
        finish: async result => {
          if (refine && live.calls) {
            const start = performance.now();
            const refined = await model.transcribe(live.audio.subarray(0, live.count), 16000, { returnTimestamps: true });
            result = { ...result, text: refined.utterance_text, words: refined.words, refined: true, elapsed: result.elapsed + (performance.now() - start) / 1000 };
          }
          sessionFeatures.close(); send('result', { sessionId, ...result, needsArchiveAck: true });
        },
        error: error => { sessionFeatures.close(); finishStream?.reject(error); },
      });
    } else if (data.type === 'streamChunk') {
      if (data.sessionId === streamId) live?.push(data.pcm);
    } else if (data.type === 'streamEnd') {
      if (data.sessionId === streamId) {refine = !!data.refine; live?.end(data.pcm);}
    } else if (data.type === 'transcribe') {
      mode ??= data.mode;
      if (!['cpu','gpu-fp32'].includes(mode)) throw Error('Choose an explicit speech runtime.');
      if (streamTask) throw Error('The previous recording has not drained.');
      streamId = data.sessionId; const sessionId = streamId;
      const done = new Promise((resolve, reject) => {finishStream = {resolve, reject};});
      void done.catch(() => {});
      streamTask = owner.run(async () => {
        await loadModel(); model.resetMelCache(); model.clearIncrementalCache();
        const start = performance.now();
        const result = await model.transcribe(data.pcm, 16000, {returnTimestamps: true});
        send('result', {sessionId: streamId, text: result.utterance_text, words: result.words,
          seconds: data.pcm.length / 16000, elapsed: (performance.now() - start) / 1000, needsArchiveAck: true});
        await done;
      }, {gpu: mode === 'gpu-fp32'}).catch(error => send('error', {sessionId: streamId, message: error.message || String(error)}))
        .finally(() => {streamTask = undefined; finishStream = undefined; send('drained', {sessionId});});
    } else throw Error('Unknown speech command.');
  } catch (error) {send('error', {sessionId: data.sessionId, message: error.message || String(error)});}
}
