// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Pure runtime helpers are shared without installing a worker message handler.
import {configureVisionDevice, bindVisionSessionOptions, summarizeVisionSessionOptions, loadVisionRuntime, releaseVisionRuntime, generateLfmChat} from './vision-runtime.js';
import {modelAssetFetch} from '../model-storage/runtime.ts';
export * from './vision-runtime.js';

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const networkFetch = globalThis.fetch.bind(globalThis);
  let library, runtime, ownedDevice, placementAudit, contextTokens, outputTokens, preprocessing, active, queue = Promise.resolve();
  const send = (id, type, data = {}) => self.postMessage({id, type, ...data});
  self.onmessage = ({data}) => {
    if (data.type === 'cancel') { if (active?.id === data.id) active.stopping.interrupt(); return; }
    if (data.type === 'dispose') active?.stopping.interrupt();
    queue = queue.then(async () => {
      try {
        if (data.type === 'load') {
          const started = performance.now();
          if (data.installedModel) {
            const expected = data.pin.precisionVariant === 'official-q4-fp32-compatible-v1' ? 'image:compatible' : 'image:fp16';
            if (data.installedModel !== expected) throw Error('The installed image model does not match this runtime.');
            globalThis.fetch = modelAssetFetch(data.installedModel, networkFetch);
          }
          library = await import('@huggingface/transformers');
          if (library.env.version !== '4.3.1') throw Error(`Unqualified Transformers.js version: ${library.env.version}`);
          const selection = await configureVisionDevice(library, data.pin);
          const {adapter} = selection;
          ownedDevice = selection.device;
          placementAudit = selection.placementAudit;
          library.env.allowLocalModels = false;
          library.env.useFSCache = false;
          if (data.installedModel) { library.env.fetch = globalThis.fetch; library.env.useBrowserCache = false; }
          library.env.backends.onnx.wasm.numThreads = 1;
          library.env.backends.onnx.wasm.wasmPaths = new URL('./vision-ort/', self.location.href).href;
          const sessionOptions = bindVisionSessionOptions(data.pin, ownedDevice);
          runtime = await loadVisionRuntime(library, data.pin, {sessionOptions, textOnly: data.textOnly === true,
            onProgress: progress => send(data.id, 'progress', {progress})});
          const device = selection.device ?? await library.env.backends.onnx.webgpu.device;
          const noCpuFallback = data.pin.sessionOptions?.extra?.session?.disable_cpu_ep_fallback === '1';
          const gpuExecution = placementAudit ? await placementAudit.drain() : null;
          contextTokens = data.contextTokens; outputTokens = data.outputTokens;
          preprocessing = data.preprocessing ?? 'native';
          send(data.id, 'result', {result: {runtime: 'transformers.js', version: library.env.version, device: 'webgpu',
            requested_execution_provider: 'webgpu',
            placement_note: noCpuFallback ? 'WebGPU EP requested with CPU EP fallback disabled in session options; node placement was not independently measured. Sampling runs in JavaScript.' :
              'WebGPU EP requested; ORT may assign individual graph nodes to CPU, and sampling runs in JavaScript. Node placement was not measured.',
            disable_cpu_ep_fallback_requested: noCpuFallback, session_options: summarizeVisionSessionOptions(sessionOptions),
            execution_provider_device: ownedDevice ? 'explicit-owned-gpu-device' : 'ort-managed',
            cpu_ep_fallback_allowed: data.pin.sessionOptions?.extra?.session?.disable_cpu_ep_fallback === '0' ? true : noCpuFallback ? false : null,
            gpu_execution: gpuExecution,
            precision_variant: data.pin.precisionVariant ?? null,
            requested_device_features: selection.requestedFeatures,
            device_features: device?.features ? [...device.features].sort() : null,
            device_shader_f16: device?.features?.has('shader-f16') ?? null,
            device_limits: {maxStorageBuffersPerShaderStage: device?.limits?.maxStorageBuffersPerShaderStage ?? null},
            wasm_threads: 1, dtype: Object.fromEntries(Object.entries(data.pin.dtype).filter(([name]) => !runtime.textOnly || name !== 'vision_encoder')),
            repo: data.pin.repo, revision: data.pin.revision,
            loader: runtime.textOnly ? 'published-language-session-names' : data.pin.loader, load_ms: performance.now() - started,
            chat_template: runtime.templateSource || null, input_mode: runtime.textOnly ? 'text' : 'text-and-image',
            loaded_sessions: Object.keys(runtime.model.sessions), tool_calls: 'unsupported-by-adapter',
            preprocessing,
            context_tokens: contextTokens, output_tokens: outputTokens,
            adapter: {description: adapter.info?.description || '', vendor: adapter.info?.vendor || '', architecture: adapter.info?.architecture || '',
              shader_f16: adapter.features.has('shader-f16'), features: [...adapter.features].sort(),
              limits: {maxStorageBuffersPerShaderStage: adapter.limits?.maxStorageBuffersPerShaderStage ?? null}}}});
        } else if (data.type === 'generate') {
          if (!runtime) throw Error('Load the vision model first.');
          const before = placementAudit?.snapshot();
          active = {id: data.id, stopping: new library.InterruptableStoppingCriteria()};
          const result = await generateLfmChat(library, runtime, {...data, contextTokens, outputTokens, preprocessing, stopping: active.stopping,
            onText: text => send(data.id, 'text', {text})});
          active = null;
          if (placementAudit) {
            const cumulative = await placementAudit.drain();
            result.gpu_execution = {...cumulative, delta: Object.fromEntries(Object.entries(cumulative)
              .filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, value - before[key]]))};
          }
          if (placementAudit && result.finish_reason !== 'cancelled' && (result.gpu_execution?.queue_drain !== 'complete' || !(result.gpu_execution?.delta?.queue_drained_dispatches > 0)))
            throw Error('Vision did not complete compute dispatches on its owned GPU device.');
          send(data.id, 'result', {result});
        } else if (data.type === 'dispose') {
          const current = runtime, device = ownedDevice;
          runtime = null; ownedDevice = null;
          await releaseVisionRuntime(current, device);
          placementAudit = null;
          send(data.id, 'result', {result: null});
        }
      } catch (error) {
        active = null;
        if (placementAudit) send(data.id, 'log', {message: `Vision placement audit on error: ${JSON.stringify(placementAudit.snapshot())}`});
        if (data.type === 'load') {
          const current = runtime, device = ownedDevice;
          runtime = null; ownedDevice = null;
          await releaseVisionRuntime(current, device).catch(() => {});
          placementAudit = null;
        }
        send(data.id, 'error', {message: error.message || String(error), name: error.name || 'Error', stack: error.stack});
      }
    });
  };
}
