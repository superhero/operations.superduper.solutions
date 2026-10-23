// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { fromUrls } from 'parakeet.js';
import * as ort from 'onnxruntime-web';
import { modelFiles, runtimeFiles, verifyBlob } from './assets.js';
import { modelLock } from './config.js';
import { LiveDecoder } from './live-decoder.js';
import { LiveFeatures } from './live-features.js';
import { TenVad } from './ten-vad.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
let model, live, streamId, vad, features, refine = false, maxContextSeconds = 30;
const send = (type, data = {}) => postMessage({ type, ...data });
let queue = Promise.resolve();
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
async function handle(data) {
  try {
    if (data.type === 'load') {
      if (model) throw new Error('Speech model is already loaded.');
      const gpu = data.mode === 'gpu-fp32';
      maxContextSeconds = gpu ? 30 : 6;
      if (gpu) {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }) || await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter is available to speech. Select CPU explicitly to use it.');
        ort.env.webgpu.adapter = adapter;
      }
      const progress = value => send('progress', value);
      const paths = await runtimeFiles(progress);
      ort.env.wasm.wasmPaths = paths;
      const files = await modelFiles(data.mode, progress);
      send('initializing', { text: 'Initializing speech in browser memory…' });
      try {
        if (gpu) {
          send('stage', { text: 'Initializing CPU decoder runtime…' });
          const bootstrap = await ort.InferenceSession.create(files.decoderUrl, { executionProviders: ['wasm'] });
          await bootstrap.release();
        }
        model = await fromUrls({ ...files, backend: gpu ? 'webgpu-strict' : 'wasm', encoderQuant: gpu ? 'fp32' : 'int8', decoderQuant: 'int8',
          preprocessorBackend: 'js', cpuThreads: 1, wasmPaths: paths,
          onSessionStage: stage => send('stage', { text: ({ encoder_session_start: 'Creating encoder session…', encoder_session_ready: 'Encoder ready.', decoder_session_start: 'Creating decoder session…', decoder_session_ready: 'Decoder ready.' })[stage] }),
        });
        const vadBlob = await (await fetch(new URL('./vendor/ten-vad/ten_vad.wasm', import.meta.url))).blob();
        await verifyBlob(vadBlob, { file: 'TEN-VAD', bytes: vadBlob.size, sha256: '1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3' });
        vad = await TenVad.create(new Uint8Array(await vadBlob.arrayBuffer()));
      } finally { files.release(); }
      send('ready', { runtime: { model: modelLock.publisherModel, revision: modelLock.revision, backend: gpu ? 'webgpu-strict' : 'wasm',
        encoderQuant: gpu ? 'fp32' : 'int8', decoderQuant: 'int8', wasmThreads: 1, parakeetJs: '1.4.4', ort: '1.30.0', streamingMaxContextSeconds: maxContextSeconds } });
    } else if (data.type === 'streamStart') {
      if (!model) throw new Error('Load speech first.');
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
          sessionFeatures.close(); send('result', { sessionId, ...result });
        },
        error: error => { sessionFeatures.close(); send('error', { sessionId, message: error.message || String(error) }); },
      });
    } else if (data.type === 'streamChunk') {
      if (data.sessionId === streamId) live?.push(data.pcm);
    } else if (data.type === 'streamEnd') {
      if (data.sessionId === streamId) { refine = !!data.refine; live?.end(data.pcm); }
    } else if (data.type === 'transcribe') {
      if (!model) throw new Error('Load speech first.');
      model.resetMelCache(); model.clearIncrementalCache();
      const start = performance.now();
      const result = await model.transcribe(data.pcm, 16000, { returnTimestamps: true });
      send('result', { sessionId: data.sessionId, text: result.utterance_text, words: result.words, seconds: data.pcm.length / 16000, elapsed: (performance.now() - start) / 1000 });
    }
  } catch (error) { send('error', { sessionId: data.sessionId, message: error.message || String(error) }); }
}
