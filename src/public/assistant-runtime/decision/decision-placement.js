// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** Observe the pinned native backend, never infer placement from a requested mode. */
export function nativeGpuPlacement(expectedKernel) {
  const kernel = new RegExp('FP32_COMPAT pipeline mul_mat.*(?:'+expectedKernel+')','i');
  const buffers = new Set(), pipelines = new Set();
  let shaderF16, offload, matchedKernel = false, invalidDevice = false;
  return {
    observe(text) {
      const feature = text.match(/FP32_COMPAT device shader_f16=(\d)/);
      if (feature) {shaderF16 = Number(feature[1]); if (shaderF16 !== 0) invalidDevice = true;}
      const layers = text.match(/offloaded (\d+)\/(\d+) layers to GPU/);
      if (layers) offload = {count:Number(layers[1]),total:Number(layers[2])};
      if (/WebGPU.*model buffer size|model buffer size.*WebGPU/.test(text) && /(?:size\s*=\s*)([\d.]+)\s*MiB/.test(text) && Number(text.match(/size\s*=\s*([\d.]+)/)?.[1])>0 && buffers.size<16) buffers.add(text);
      if (/FP32_COMPAT pipeline mul_mat/i.test(text)) {
        if (pipelines.size<32) pipelines.add(text);
        if (kernel.test(text)) matchedKernel = true;
      }
    },
    verify(layerCount, requireForward = false) {
      if (invalidDevice || shaderF16 !== 0 || !buffers.size || !offload || offload.count<=0 || offload.count!==offload.total || offload.count<layerCount) throw Error('Native FP32 WebGPU placement was not verified. This decision model requires GPU execution; CPU fallback is disabled.');
      if (requireForward && !matchedKernel) throw Error('The native forward did not prove the pinned packed-weight GPU matrix pipeline.');
      return {backend:'webgpu',n_gpu_layers:99,shader_f16:false,offloaded:offload,gpu_model_buffers:[...buffers],matrix_pipelines:[...pipelines],compute_verified:requireForward};
    },
  };
}
