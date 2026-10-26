// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { bonsaiRuntime, bonsaiModels, assistantProfile, type AssistantSettings } from "./config.ts";
import type { AssistantCompatibility } from "./compatibility.ts";
import type { LocalEngine, NativeMessage, NativeResult } from "./pi-session.ts";

export type WebMLModel = {
  create_session(): { reset(): Promise<void>; dispose(): Promise<void>;
    generate(messages: NativeMessage[], options: Record<string, unknown>): AsyncIterable<{ type: string; text: string }> & { result: Promise<NativeResult> } };
  dispose(): Promise<void>;
};
export type WebMLModule = { Qwen3_5ForConditionalGeneration: { from_pretrained(model: string, options: Record<string, unknown>): Promise<WebMLModel> } };

/** Fetch the original runtime only on demand; verify the source before executing it.
 * The upstream runtime has no established redistribution license, so do not vendor it. */
export async function fetchBonsaiRuntime(signal: AbortSignal, request: typeof fetch = fetch,
  // A template specifier keeps Vite's browser-only query helper out of the worker.
  importModule: (url: string) => Promise<WebMLModule> = url => import(/* @vite-ignore */ `${url}`)): Promise<WebMLModule> {
  const response = await request(bonsaiRuntime.url, { signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the WebML runtime (${response.status}).`);
  const source = await response.arrayBuffer();
  if (source.byteLength !== bonsaiRuntime.bytes) throw new Error("The pinned WebML runtime size does not match.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", source))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== bonsaiRuntime.sha256) throw new Error("The pinned WebML runtime checksum does not match.");
  signal.throwIfAborted();
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try { return await importModule(url); }
  finally { URL.revokeObjectURL(url); }
}

export async function loadBonsaiEngine(settings: AssistantSettings, onProgress: (event: unknown) => void, signal: AbortSignal,
  compatibility: Pick<AssistantCompatibility, "fp16">,
  runtime: (signal: AbortSignal) => Promise<WebMLModule> = fetchBonsaiRuntime): Promise<LocalEngine & { dispose(): Promise<void> }> {
  const profile = bonsaiModels.find(model => model.id === settings.model)!;
  const module = await runtime(signal);
  let stage = "GPU initialization";
  const diagnostics: { name: string; message: string }[] = [];
  let raw: WebMLModel;
  try {
    raw = await module.Qwen3_5ForConditionalGeneration.from_pretrained(profile.model, {
      file: profile.file, revision: profile.revision, mmproj: null, max_pixels: settings.imagePixels, maxLength: settings.context,
      cache: false, prefixSnapshotStore: null, chatTemplateArgs: { enable_thinking: settings.thinking }, signal,
      onProgress: (event: unknown) => {
        if (event && typeof event === "object" && "message" in event && typeof event.message === "string") stage = event.message;
        onProgress(event);
      },
      // The runtime otherwise enables every advertised feature, including FP16
      // on adapters where the real FP16 computation probe failed.
      runtimeOptions: { disabledFeatures: compatibility.fp16 ? [] : ["shader-f16"],
        diagnosticSink: (event: { message: string }) => {
          diagnostics.push({ name: "WebGPUDiagnostic", message: event.message });
          if (diagnostics.length > 4) diagnostics.shift();
        } },
    });
  } catch (cause) {
    const message = `${profile.label} failed during ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`;
    // Preserve the native stack/cause and the runtime's actual device-loss or
    // validation details. Diagnostic strings have no invented stack trace.
    throw diagnostics.length ? new AggregateError(diagnostics, message, { cause }) : new Error(message, { cause });
  }
  let session: ReturnType<WebMLModel["create_session"]>;
  try { signal.throwIfAborted(); session = raw.create_session(); }
  catch (error) { await raw.dispose(); throw error; }
  return {
    reset: () => session.reset(),
    async generate(messages, { tools, signal, maxTokens, onText, onThinking }) {
      if (!settings.prefixCache) await session.reset();
      const turn = session.generate(messages, { tools, signal, max_new_tokens: maxTokens, do_sample: settings.sampling,
        temperature: settings.sampling ? settings.temperature : 0, top_k: settings.topK, top_p: settings.topP, min_p: settings.minP, seed: settings.seed,
        enable_thinking: settings.thinking });
      for await (const event of turn) {
        if (event.type === "text") onText(event.text);
        if (event.type === "reasoning") onThinking(event.text);
      }
      return turn.result;
    },
    async dispose() { try { await session.dispose(); } finally { await raw.dispose(); } },
  };
}

export type NativeLanguageRuntime = {
  loadWllama: (profile: unknown, onProgress: (value: unknown) => void, options: unknown) => Promise<LocalEngine & { dispose(): Promise<void> }>;
  loadGemma: (profile: unknown, onProgress: (value: unknown) => void, options: unknown) => Promise<LocalEngine & { dispose(): Promise<void> }>;
};

/** Adapt accepted native engines without substituting a server or a text parser. */
export async function loadAssistantEngine(settings: AssistantSettings, onProgress: (event: unknown) => void,
  signal: AbortSignal, compatibility: Pick<AssistantCompatibility, "fp16" | "fp32">, assetBase: string, nativeRuntime?: NativeLanguageRuntime): Promise<LocalEngine & { dispose(): Promise<void> }> {
  const profile = assistantProfile(settings.model);
  if (profile.engine === "webml") return loadBonsaiEngine(settings, onProgress, signal, compatibility);
  const url = new URL("load-language.mjs", assetBase).href;
  const runtime = nativeRuntime ?? await import(/* @vite-ignore */ `${url}`) as NativeLanguageRuntime;
  signal.throwIfAborted();
  const configured = { ...profile, projector: null, settings: { ...profile.settings,
    context_tokens: settings.context, max_new_tokens: settings.maxTokens, load_timeout_ms: settings.loadTimeout,
    response_timeout_ms: settings.responseTimeout, thinking: settings.thinking, prefix_cache: settings.prefixCache,
    temperature: settings.sampling ? settings.temperature : 0, sampling_mode: settings.sampling ? "sample" : "greedy",
    top_k: settings.topK, top_p: settings.topP, min_p: settings.minP, seed: settings.seed, cpu_threads: settings.cpuThreads,
  } };
  const loader = profile.engine === "litert-lm" ? runtime.loadGemma : runtime.loadWllama;
  const engine = await loader(configured, onProgress, { assetBase, mode: settings.executionMode,
    // The accepted MiniCPM allocation fallback uses eight GPU layers.
    gpuLayers: settings.executionMode === "hybrid" ? settings.gpuLayers : 8,
    capabilities: { gpu: { compute: compatibility.fp32, f16_compute: compatibility.fp16 } },
  });
  if (signal.aborted) { await engine.dispose(); signal.throwIfAborted(); }
  return engine;
}
