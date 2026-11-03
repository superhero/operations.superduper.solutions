// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import original from "./vision-profile.json";
import compatible from "./vision-compatible-profile.json";

export const visionModes = [
  { value: "fp16", label: "Original FP16/Q4", profile: original },
  { value: "compatible", label: "Compatible FP32/Q4", profile: compatible },
] as const;
export function visionProfileFor(mode: string) {
  const choice = visionModes.find(choice => choice.value === mode);
  if (!choice) throw new Error("Choose an available image runtime.");
  return choice.profile;
}

/** Query limits before the owning Pi turn unloads text. Device allocation and
 * native session binding are still verified by the separate image worker. */
export async function preflightVision(mode: string, capabilities: { fp16: boolean; fp32: boolean }, gpu = globalThis.navigator?.gpu) {
  visionProfileFor(mode);
  if (mode === "fp16") {
    if (!capabilities.fp16) throw new Error("The original image runtime requires verified WebGPU shader-f16. Select Compatible FP32/Q4 in Settings → AI to use its separately qualified runtime.");
    return;
  }
  if (!capabilities.fp32 || !gpu) throw new Error("Compatible image interpretation requires verified WebGPU FP32 computation.");
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter || (adapter.limits?.maxStorageBuffersPerShaderStage ?? 0) < 9)
    throw new Error("Compatible image interpretation requires at least 9 storage buffers per shader stage. The text model remains loaded.");
}
