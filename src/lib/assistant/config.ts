// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Pins from llm-sds-01/inference/evaluations/pi-browser/HANDOFF.md. */
export const bonsaiRuntime = {
  url: "https://huggingface.co/spaces/webml-community/ternary-bonsai-2-hermes-webgpu/resolve/621e20782f208660f4f58283c2ce58430020f243/assets/qwen35-vision-Kzp5MMIJ.js",
  sha256: "00c1a72a962a84fee17000a6b1d18b24d75033e56d59996fc504b7c57cfc6488",
  bytes: 2208435,
} as const;
export const bonsaiModels = [
  { id: "2b", label: "Bonsai 2 · 2B", model: "prism-ml/Ternary-Bonsai-2-2B-gguf", revision: "683f7be2629342a50987627b40881e54761a2430",
    file: "Ternary-Bonsai-2-2B-PTQ1_0.gguf", projector: "Ternary-Bonsai-2-2B-mmproj-Q8_0.gguf", bytes: 793847808,
    attempt: "gw-browser-pi-bonsai2-2b", run: "gw-browser-pi-bonsai2-2b-1792646112919399916" },
  { id: "4b", label: "Bonsai 2 · 4B", model: "prism-ml/Ternary-Bonsai-2-4B-gguf", revision: "8d6557168168f91ea6697a4a49ed2ef622b53adb",
    file: "Ternary-Bonsai-2-4B-PTQ1_0.gguf", projector: "Ternary-Bonsai-2-4B-mmproj-Q8_0.gguf", bytes: 1316444544,
    attempt: "he-browser-pi-bonsai2-4b", run: "he-browser-pi-bonsai2-4b-1792657842970109100" },
  { id: "9b", label: "Bonsai 2 · 9B", model: "prism-ml/Ternary-Bonsai-2-9B-gguf", revision: "5b2abb02362efbed46bbe204014b02837778b2c2",
    file: "Ternary-Bonsai-2-9B-PTQ1_0.gguf", projector: "Ternary-Bonsai-2-9B-mmproj-Q8_0.gguf", bytes: 2621716640,
    attempt: "gx-browser-pi-bonsai2-9b", run: "gx-browser-pi-bonsai2-9b-1792648337305103722" },
] as const;
export type BonsaiModel = typeof bonsaiModels[number];
export const assistantSettingsKey = "v1/settings/assistant";
export const defaultAssistantSettings = {
  model: "2b", context: 4096, maxTokens: 1024, sampling: false, temperature: 0.7, topK: 20, topP: 0.8, minP: 0, seed: 42,
  thinking: false, prefixCache: true, imagePixels: 262144, tools: true, editing: true, skills: true,
  maxTurns: 6, maxToolCalls: 8, responseTimeout: 180000, requestTimeout: 600000, loadTimeout: 1200000,
};
export type AssistantSettings = typeof defaultAssistantSettings;

/** Reject malformed settings both before the worker boundary and inside it. */
export function validateAssistantSettings(value: unknown): AssistantSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid assistant settings.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !Object.hasOwn(defaultAssistantSettings, key))) throw new Error("Unknown assistant setting.");
  const next = { ...defaultAssistantSettings, ...input } as AssistantSettings;
  if (!bonsaiModels.some(model => model.id === next.model)) throw new Error("Choose Bonsai 2B, 4B or 9B.");
  for (const key of ["sampling", "thinking", "prefixCache", "tools", "editing", "skills"] as const)
    if (typeof next[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  const bounds = { context: [512, 32768], maxTokens: [1, 20000], topK: [1, 64], seed: [0, 4294967295], imagePixels: [16384, 1048576],
    maxTurns: [1, 32], maxToolCalls: [1, 64], responseTimeout: [1000, 3600000], requestTimeout: [1000, 3600000], loadTimeout: [30000, 3600000] } as const;
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = next[key as keyof typeof bounds];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be a whole number from ${min} to ${max}.`);
  }
  for (const [key, min, max] of [["temperature", 0.01, 2], ["topP", 0.001, 1], ["minP", 0, 1]] as const)
    if (!Number.isFinite(next[key]) || next[key] < min || next[key] > max) throw new Error(`${key} must be from ${min} to ${max}.`);
  if (next.maxTokens >= next.context) throw new Error("Output tokens must be smaller than the context window.");
  if (next.responseTimeout > next.requestTimeout) throw new Error("Response timeout must not exceed the request timeout.");
  return next;
}
