// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { assistantProfile, defaultAssistantSettings, validateAssistantSettings } from "./config.ts";

// Real compute/readback checks; capability does not promise model memory fit.
export type AssistantCompatibility = { ready: boolean; summary: string; fp32: boolean; fp16: boolean; adapter: string; detail: string };
export type ComputeDevice = GPUDevice;
export type ComputeAdapter = Pick<GPUAdapter, "features" | "info" | "requestDevice">;
export type GPUEnvironment = { isSecureContext?: boolean; crossOriginIsolated?: boolean; WebAssembly?: typeof WebAssembly; navigator?: { gpu?: Pick<GPU, "requestAdapter"> } };

export async function probeCompute(adapter: ComputeAdapter, fp16: boolean): Promise<void> {
  const device = await adapter.requestDevice({ requiredFeatures: fp16 ? ["shader-f16"] : [] });
  let input: ReturnType<ComputeDevice["createBuffer"]> | undefined, output: typeof input, read: typeof input;
  try {
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ code: `${fp16 ? "enable f16;" : ""}
      @group(0) @binding(0) var<storage, read_write> result: array<f32>;
      @group(0) @binding(1) var<storage, read> values: array<f32>;
      @compute @workgroup_size(1) fn main() { result[0] = ${fp16 ? "f32(f16(values[0]) + f16(values[1]))" : "values[0] + values[1]"}; }` });
    const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
    output = device.createBuffer({ size: 4, usage: 128 | 4 }); input = device.createBuffer({ size: 8, usage: 128 | 8 });
    device.queue.writeBuffer(input, 0, new Float32Array([1.5, 2])); read = device.createBuffer({ size: 4, usage: 8 | 1 });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }, { binding: 1, resource: { buffer: input } }] });
    const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1); pass.end();
    encoder.copyBufferToBuffer(output, 0, read, 0, 4); device.queue.submit([encoder.finish()]); await read.mapAsync(1);
    const value = new Float32Array(read.getMappedRange())[0]; read.unmap();
    const error = await device.popErrorScope();
    if (error || value !== 3.5) throw new Error(error?.message ?? "GPU computation returned an incorrect value.");
  } finally { input?.destroy(); output?.destroy(); read?.destroy(); device.destroy(); }
}

async function probeGPUCompatibility(environment: GPUEnvironment): Promise<AssistantCompatibility> {
  const result: AssistantCompatibility = { ready: false, summary: "WebGPU is required.", fp32: false, fp16: false, adapter: "Not exposed", detail: "" };
  if (!environment.isSecureContext) return { ...result, summary: "Open this application over HTTPS or localhost." };
  const gpu = environment.navigator?.gpu;
  if (!gpu) return { ...result, detail: "Enable browser hardware acceleration and use a browser with WebGPU support. This runtime has no CPU fallback." };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter is available.");
    result.adapter = [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device, adapter.info?.description].filter(Boolean).join(" · ") || "Not exposed";
    await probeCompute(adapter, false); result.fp32 = true;
    if (adapter.features.has("shader-f16")) {
      // Dawn can consume the first adapter; use a new one for the FP16 test.
      const fresh = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!fresh) throw new Error("No adapter available for the FP16 check.");
      await probeCompute(fresh, true); result.fp16 = true;
    }
    result.ready = true; result.summary = "WebGPU compute verified.";
  } catch (error) {
    // FP16 is optional for the selected WebML bundle; FP32 must really work.
    result.ready = result.fp32; result.summary = result.fp32 ? "WebGPU FP32 verified; FP16 unavailable." : "WebGPU computation failed.";
    result.detail = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export async function probeAssistantCompatibility(environment: GPUEnvironment, input: unknown = defaultAssistantSettings): Promise<AssistantCompatibility> {
  const settings = validateAssistantSettings(input), profile = assistantProfile(settings.model);
  const gpu = await probeGPUCompatibility(environment);
  if (profile.engine !== "wllama") return gpu;
  const wasm = environment.WebAssembly ?? globalThis.WebAssembly;
  const header = [0, 97, 115, 109, 1, 0, 0, 0];
  const simd = wasm.validate(new Uint8Array([...header, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const memory64 = wasm.validate(new Uint8Array([...header, 5, 3, 1, 4, 0]));
  if (!environment.isSecureContext || !environment.crossOriginIsolated || !simd || !memory64 || !("Suspending" in wasm))
    return { ...gpu, ready: false, summary: "Native Wasm requirements are missing.", detail: "Use a secure, cross-origin isolated Chromium browser with Wasm SIMD, Memory64 and JSPI. Model files have not been downloaded." };
  const fitsCPU = profile.bytes < 4294967296;
  if (settings.executionMode === "cpu" || (settings.executionMode === "auto" && !gpu.fp16 && fitsCPU))
    return { ...gpu, ready: true, summary: "Native Wasm CPU path available.", detail: "Memory fit is verified during loading; CPU execution is explicit and local." };
  if (!gpu.fp16) return { ...gpu, ready: false, summary: "Native GPU execution needs verified shader-f16.", detail: "This execution mode cannot fall back to a full CPU model. Choose a supported GPU or a smaller CPU profile." };
  return { ...gpu, ready: true, summary: "Native Wasm and WebGPU compute verified.", detail: "Memory fit is verified during loading. Partial offload uses the configured GPU layer budget." };
}
