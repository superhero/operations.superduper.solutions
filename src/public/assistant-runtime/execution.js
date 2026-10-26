export const layerLimit = profile => (profile.gguf_block_count || profile.model_layers) + 1;
// @wllama/wllama3.8.1 generated glue: getHeapMax=4294967296,
// maximum:65536n pages. GPU buffers are outside this CPU heap.
export const CPU_HEAP_BYTES = 4294967296;
export const fullCPUFitsBuild = profile => profile.weight_bytes + (profile.projector?.bytes ?? 0) < CPU_HEAP_BYTES;
export function executionPlans(profile, capabilities, {mode = 'auto', gpuLayers = 24, visionGpu = true} = {}) {
  if (!['auto', 'gpu', 'hybrid', 'cpu'].includes(mode)) throw Error('Unknown execution mode');
  if (!Number.isInteger(gpuLayers) || gpuLayers < 1 || gpuLayers > layerLimit(profile)) throw Error('Invalid GPU layer count');
  const gpu = !!capabilities?.gpu?.compute && !!capabilities?.gpu?.f16_compute;
  const vision = !!profile.projector;
  const full = {mode: 'gpu', gpu_layers: 99, vision_gpu_offload: vision, label: `GPU preferred · all supported layers${vision ? ' and vision' : ''} on GPU`};
  const hybrid = {mode: 'hybrid', gpu_layers: gpuLayers, vision_gpu_offload: vision && !!visionGpu, label: `GPU + CPU · GPU layer budget ${gpuLayers}; remaining layers on CPU${vision ? '; vision on ' + (visionGpu ? 'GPU' : 'CPU') : ''}`};
  const cpu = {mode: 'cpu', gpu_layers: 0, vision_gpu_offload: false, label: `CPU · language${vision ? ' and vision' : ''} in browser WebAssembly`};
  const fitsCPU = fullCPUFitsBuild(profile);
  if ((mode === 'cpu' || (mode === 'auto' && !gpu)) && !fitsCPU) throw Error('These weights exceed this runtime’s4GiB CPU heap. Partial CPU offload needs GPU shader-f16; CPU-only needs a larger-heap runtime build.');
  if (mode === 'cpu') return [cpu];
  if (mode === 'auto') return gpu ? [full, hybrid, ...(fitsCPU ? [cpu] : [])] : [cpu];
  if (!gpu) throw Error('This GPU mode needs working WebGPU shader-f16. Select Auto or CPU; see Browser compatibility.');
  return mode === 'gpu' ? [full] : [hybrid];
}

export const isAllocationError = error => /out[ -]of[ -]memory|\boom\b|unable to allocate|failed to allocate|buffer allocation|maximum buffer size/i.test(error?.message ?? '');

// Only memory allocation failures justify reloading the same weights on another
// device. Network, model-format and template failures must remain visible.
export async function loadWithFallback(plans, create, onProgress = () => {}, timeoutMs = 1200000) {
  const history = [], deadline = Date.now() + timeoutMs;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i], remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('Model loading timed out');
    onProgress({message: plan.label});
    const instance = create(plan, remaining);
    try {
      const info = await instance.load();
      return {instance, info: {...info, execution: {...plan, attempts: [...history, {mode: plan.mode, status: 'loaded'}]}}};
    } catch (error) {
      error.nativeLogs = instance.logs?.slice() ?? [];
      await instance.dispose().catch(() => {});
      history.push({mode: plan.mode, status: 'failed', error: error.message});
      error.loadAttempts = history.slice();
      if (i === plans.length - 1 || !isAllocationError(error)) throw error;
      onProgress({message: `Memory allocation failed in ${plan.mode} mode. Retrying with more CPU work…`});
    }
  }
}

export async function abortableGeneration(start, signal, terminate) {
  let listener;
  const interrupted = new Promise((_, reject) => {
    listener = () => {
      const error = Error(signal.reason?.name === 'TimeoutError' ? 'Generation timed out; model unloaded. Reload to continue.' : 'Generation cancelled; model unloaded. Reload to continue.');
      Promise.resolve().then(terminate).then(() => reject(error), () => reject(error));
    };
    signal.addEventListener('abort', listener, {once: true});
  });
  try {
    if (signal.aborted) { listener(); return await interrupted; }
    return await Promise.race([Promise.resolve().then(start), interrupted]);
  } finally { signal.removeEventListener('abort', listener); }
}
