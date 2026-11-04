# Core FP32 WebGPU for native decision models

This experimental Wllama/ggml backend removes the mandatory `shader-f16` dependency. Original BF16, Q8_0, Q4_K and Q6_K buffers remain packed; GPU arithmetic and workgroup temporaries use FP32. Q4_K row lookup explicitly preserves its 144-byte block layout. Unsupported F16 storage is rejected, never reinterpreted as FP32. Optional subgroup/matrix/packed-dot paths are disabled.

`merge-native.py` combines the existing D3 inspector, KnowLine safe JSON, Elephant two-block and Perplexity protocol-v3 APIs without replacing their native bodies. Exact token guards, masks, calibration and trained readout remain required. Use **paired** JS/Wasm artifacts from this recipe with `n_gpu_layers: 99`, `cache_type_k: 'f32'`, `cache_type_v: 'f32'`, `flash_attn: false`. CPU input embedding can remain; this is GPU backbone execution, not a claim that every operation runs on GPU.

From `inference/evaluations/brave-decisions`, run `make prepare-gpu` to validate cached artifacts or compile on sds-01. [pins.json](pins.json) pins every input and built file. Generated assets stay ignored under `runtime/.runtime/native/shared-fp32/artifacts/`; model files stay on sds-01. The build receipt's inherited D3 description is superseded by its `context_variant` and the four merged patch hashes.

Run `make gpu` for pending native GPU checks, or each attempt's `make verify`. Acceptance requires actual Brave without a shader-f16 override, a native device reporting `shader_f16=0`, GPU model buffers, matching quantized/BF16 GPU matrix pipelines and all six decisions/controls. A successful adapter request or CPU fallback alone does not qualify. See [the measured report](../../../REPORT.md) for the per-model outcome; unmeasured profiles remain hidden.
