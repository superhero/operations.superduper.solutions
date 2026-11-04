// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/// <reference lib="webworker" />
import { validateAssistantSettings, type AssistantSettings } from "./config.ts";
import { probeAssistantCompatibility } from "./compatibility.ts";
import { loadAssistantEngine } from "./engine.ts";
import { encodeError } from "../worker-rpc.ts";
import { createAssistantSession, type SessionUpdate, type ToolInvoker } from "./pi-session.ts";
import { BrowserRuntimeOwner } from "./runtime-ownership.js";
import { prepareModelAssets, modelAssetFetch } from "./model-storage/runtime.ts";
import { createVisionTool } from "./vision-tool.js";
import { visionProfileFor, preflightVision } from "./vision-profiles.ts";
import type { LocalEngine } from "./pi-session.ts";
import type { ImageContent } from "@earendil-works/pi-ai";

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const networkFetch = globalThis.fetch.bind(globalThis);
let releaseAssets: (() => Promise<void>) | undefined;
let settings: AssistantSettings;
let engine: Awaited<ReturnType<typeof loadAssistantEngine>> | undefined;
let session: ReturnType<typeof createAssistantSession> | undefined;
let busy = false, toolId = 0;
const pendingTools = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const post = (message: unknown) => scope.postMessage(message);
let update: (() => void) | undefined, updateTimer: ReturnType<typeof setTimeout> | undefined;
const flush = () => { clearTimeout(updateTimer); updateTimer = undefined; const snapshot = update; update = undefined; snapshot?.(); };
const schedule = (snapshot: () => void) => { update = snapshot; updateTimer ??= setTimeout(flush, 40); };
const publish = (state: SessionUpdate) => post({ type: "update", ...state });

const invoke: ToolInvoker = async (name, args, signal) => {
  signal.throwIfAborted();
  const id = ++toolId;
  let abort: () => void;
  try {
    return await new Promise((resolve, reject) => {
      abort = () => { pendingTools.delete(id); reject(new Error("Tool call cancelled.")); };
      signal.addEventListener("abort", abort, { once: true });
      pendingTools.set(id, { resolve, reject });
      post({ type: "tool", id, name, args });
    });
  } finally { signal.removeEventListener("abort", abort!); }
};

type StoredImage = { id: string; data: string; mimeType: string; width: number; height: number };
const images = new Map<string, StoredImage>();
let vision: ReturnType<typeof createVisionTool> | undefined;
let assetBase = "";
let loadText: ((signal: AbortSignal) => Promise<NonNullable<typeof engine>>) | undefined;
let commandAbort: AbortController | undefined;
let unconfirmedAllocation: unknown;
const owner = new BrowserRuntimeOwner({
  async suspend() {
    if (unconfirmedAllocation) throw new Error("Language initialization cleanup is unconfirmed; terminate this worker.", {cause: unconfirmedAllocation});
    if (!engine) return;
    await engine.dispose(); engine = undefined;
    post({type: "suspended"});
  },
  status: value => post({type: "progress", value}),
  onError: error => post({type: "error", operation: "handoff", error: encodeError(error)}),
});
async function ensureText(signal: AbortSignal) {
  if (unconfirmedAllocation) throw new Error("Local model cleanup is unconfirmed; reload the assistant.", {cause: unconfirmedAllocation});
  if (engine && "invalidated" in engine && engine.invalidated) {await engine.dispose(); engine = undefined;}
  if (!engine) {
    if (!loadText) throw new Error("Load a model first.");
    post({type: "progress", value: "Restoring the language model with the saved conversation…"});
    engine = await loadText(AbortSignal.any([signal, AbortSignal.timeout(settings.loadTimeout)]));
  }
}
const facade: LocalEngine = {
  get contextMode() { return engine?.contextMode; },
  get contextLimit() { return engine?.contextLimit; },
  async generate(messages, options) { if (!engine) throw new Error("The text model is not ready."); return engine.generate(messages, options); },
  async reset() { if (!engine) throw new Error("The text model is not ready."); await engine.reset(); },
};
async function storeImage(part: ImageContent): Promise<StoredImage> {
  if (images.size >= 3) throw new Error("This conversation already contains three local images. Start a new conversation before attaching another.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(part.mimeType) || part.data.length > 13981020) throw new Error("Choose a PNG, JPEG or WebP image up to 10 MiB.");
  const bytes = Uint8Array.from(atob(part.data), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: part.mimeType }));
  try {
    if (bitmap.width * bitmap.height > 16 * 1024 * 1024 || bitmap.width > 8192 || bitmap.height > 8192) throw new Error("Images must fit within 16 megapixels and 8192 pixels per side.");
    const record = { id: crypto.randomUUID(), data: part.data, mimeType: part.mimeType, width: bitmap.width, height: bitmap.height };
    images.set(record.id, record); return record;
  } finally { bitmap.close(); }
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === "tool_result") {
    const pending = pendingTools.get(message.id); pendingTools.delete(message.id);
    if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value);
    return;
  }
  if (message.type === "stop") { session?.stop(); commandAbort?.abort(new DOMException("Model operation cancelled.", "AbortError")); return; }
  if (message.type === "dispose") {
    session?.stop(); commandAbort?.abort(new DOMException("Model unloaded.", "AbortError"));
    void owner.close().then(async () => { await releaseAssets?.(); releaseAssets = undefined; post({type: "disposed"}); }).catch(error => post({type: "error", operation: "dispose", error: encodeError(error)}));
    return;
  }
  void (async () => {
    if (busy) throw new Error("The assistant is busy.");
    busy = true;
    const controller = commandAbort = new AbortController();
    try {
      const reply = await owner.run(async () => {
      if (message.type === "check" || message.type === "load") {
        const compatibility = await probeAssistantCompatibility(scope, message.settings);
        if (message.type === "check") return {type: "compatibility", value: compatibility};
        post({ type: "compatibility", value: compatibility });
        if (!compatibility.ready) throw new Error(compatibility.summary + " " + compatibility.detail);
        if (engine || session || releaseAssets) throw new Error("Unload the current model before loading another.");
        settings = validateAssistantSettings(message.settings);
        const assetURL = new URL(message.assetBase);
        if (!["https:", "http:"].includes(assetURL.protocol) || assetURL.origin !== scope.location.origin) throw new Error("Assistant runtime assets must come from this application.");
        assetBase = assetURL.href;
        const progress = (value: unknown) => post({ type: "progress", value });
        releaseAssets = await prepareModelAssets(settings.model, AbortSignal.any([controller.signal, AbortSignal.timeout(settings.loadTimeout)]), progress, networkFetch);
        const cachedFetch = modelAssetFetch(settings.model, networkFetch);
        progress({message: "Model files saved and verified. Initializing the runtime…"});
        const restoreText = async (signal: AbortSignal) => {
          signal.throwIfAborted();
          try {return await loadAssistantEngine(settings, progress, signal, compatibility, assetBase, undefined, {fetch: cachedFetch, modelId: settings.model});}
          catch (error) {unconfirmedAllocation = error instanceof Error ? error : new Error("Native allocation failed.", {cause: error}); throw error;}
        };
        loadText = restoreText;
        engine = await loadText(AbortSignal.any([controller.signal, AbortSignal.timeout(settings.loadTimeout)]));
        vision = createVisionTool({assetBase, profile: visionProfileFor(settings.visionMode), getImage: id => images.get(id),
          preflight: () => preflightVision(settings.visionMode, compatibility),
          async suspendText() { const current = engine; if (!current) throw new Error("Text model is already unloaded."); await current.dispose(); engine = undefined; },
          async resumeText({signal}) { engine = await restoreText(signal); },
          onState: state => { if (state.cleanup_failed) unconfirmedAllocation = new Error("Vision cleanup is unconfirmed; reload the assistant."); if (state.status) progress(state.status); },
        });
        session = createAssistantSession(facade, settings, invoke, async () => { throw new Error("Use inspect_image for local image pixels."); }, publish, schedule,
          error => post({ type: "diagnostic", operation: "send", error: encodeError(error) }), [vision.tool],
          value => post({ type: "context", value }));
        return {type: "ready"};
      } else if (message.type === "send") {
        if (!session) throw new Error("Load a model first.");
        await ensureText(controller.signal);
        const incoming = message.images ?? [];
        if (!Array.isArray(incoming) || incoming.length > 1) throw new Error("Attach at most one image per message.");
        if (incoming.length && !settings.tools) throw new Error("Enable application tools to inspect local images.");
        const attached = await Promise.all(incoming.map((part: ImageContent) => storeImage(part)));
        await session.send(message.text, [], attached.map(({id, width, height}) => ({id, width, height})));
        flush(); return {type: "done"};
      } else if (message.type === "reset") {
        if (!session) throw new Error("Load a model first.");
        await ensureText(controller.signal);
        await session.reset(); images.clear(); flush(); return {type: "done"};
      } else throw new Error("Unknown assistant command.");
      }, {signal: controller.signal, resident: message.type !== "check"});
      post({...reply, suspended: !engine});
    } finally { busy = false; if (commandAbort === controller) commandAbort = undefined; }
  })().catch(error => { flush(); post({ type: "error", operation: message.type, error: encodeError(error) }); });
};
