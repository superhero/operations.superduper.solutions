// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import languageProfiles from "./language-profiles.json";

/** Accepted text-only profiles from llm-sds-01; exact provenance is retained beside this catalog. */
export const bonsaiRuntime = {
  url: "https://huggingface.co/spaces/webml-community/ternary-bonsai-2-hermes-webgpu/resolve/621e20782f208660f4f58283c2ce58430020f243/assets/qwen35-vision-Kzp5MMIJ.js",
  sha256: "00c1a72a962a84fee17000a6b1d18b24d75033e56d59996fc504b7c57cfc6488",
  bytes: 2208435,
} as const;
export const assistantModels = languageProfiles;
export const bonsaiModels = assistantModels.filter(model => model.engine === "webml");
export type AssistantModel = typeof assistantModels[number];
export type BonsaiModel = AssistantModel;
export function assistantProfile(id: string): AssistantModel {
  const profile = assistantModels.find(model => model.id === id);
  if (!profile) throw new Error("Choose an available local language model.");
  return profile;
}
export const assistantSettingsKey = "v1/settings/assistant";
export const defaultAssistantSettings = {
  model: "2b", executionMode: "auto", gpuLayers: 8, cpuThreads: 4, context: 4096, maxTokens: 1024, sampling: false, temperature: 0.7, topK: 20, topP: 0.8, minP: 0, seed: 42,
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
  const profile = assistantProfile(next.model);
  if (!["auto", "gpu", "hybrid", "cpu"].includes(next.executionMode)) throw new Error("Choose Auto, GPU, partial GPU or CPU execution.");
  if (profile.engine === "webml" && !["auto", "gpu"].includes(next.executionMode)) throw new Error("Bonsai requires WebGPU execution.");
  if (profile.engine === "litert-lm" && (next.sampling || next.thinking || next.prefixCache || !["auto", "gpu"].includes(next.executionMode)))
    throw new Error("Gemma uses GPU greedy decoding with reasoning and prefix caching off.");
  if (profile.engine === "litert-lm" && next.context > 4096) throw new Error("Gemma supports at most 4096 context tokens in this profile.");
  if (profile.engine === "wllama" && next.executionMode === "cpu" && profile.bytes >= 4294967296)
    throw new Error("This model's language weights exceed the native 4 GiB CPU heap. Select GPU or partial GPU execution.");
  for (const key of ["sampling", "thinking", "prefixCache", "tools", "editing", "skills"] as const)
    if (typeof next[key] !== "boolean") throw new Error(`${key} must be true or false.`);
  const bounds = { gpuLayers: [1, 999], cpuThreads: [1, 8], context: [512, 32768], maxTokens: [1, 20000], topK: [1, 64], seed: [0, 4294967295], imagePixels: [16384, 1048576],
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

/** Apply the selected engine's supported defaults before automatic loading. */
export function settingsForAssistantModel(id: string, current: AssistantSettings): AssistantSettings {
  const profile = assistantProfile(id);
  const native = profile.engine !== "webml";
  return validateAssistantSettings({ ...current, model: id,
    context: profile.settings.context_tokens, maxTokens: Math.min(current.maxTokens, profile.settings.max_new_tokens, profile.settings.context_tokens - 1),
    executionMode: profile.engine === "wllama" && id.startsWith("ornith") ? "gpu" : "auto",
    gpuLayers: 8, cpuThreads: 4,
    prefixCache: native ? false : current.prefixCache,
    sampling: profile.engine === "litert-lm" ? false : current.sampling,
    thinking: profile.engine === "litert-lm" ? false : current.thinking,
    requestTimeout: ["gemma-e2b", "minicpm5-2b"].includes(id) ? 1200000 : current.requestTimeout,
  });
}
