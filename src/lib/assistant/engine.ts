// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { bonsaiRuntime, bonsaiModels, type AssistantSettings } from "./config.ts";
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
  importModule: (url: string) => Promise<WebMLModule> = url => import(/* @vite-ignore */ url)): Promise<WebMLModule> {
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
  runtime: (signal: AbortSignal) => Promise<WebMLModule> = fetchBonsaiRuntime): Promise<LocalEngine & { dispose(): Promise<void> }> {
  const profile = bonsaiModels.find(model => model.id === settings.model)!;
  const module = await runtime(signal);
  const raw = await module.Qwen3_5ForConditionalGeneration.from_pretrained(profile.model, {
    file: profile.file, revision: profile.revision, mmproj: profile.projector, max_pixels: settings.imagePixels, maxLength: settings.context,
    cache: false, prefixSnapshotStore: null, chatTemplateArgs: { enable_thinking: settings.thinking }, signal, onProgress,
  });
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
