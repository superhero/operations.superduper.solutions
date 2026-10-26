// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/// <reference lib="webworker" />
import { validateAssistantSettings, type AssistantSettings } from "./config.ts";
import { probeAssistantCompatibility } from "./compatibility.ts";
import { loadAssistantEngine } from "./engine.ts";
import { encodeError } from "../worker-rpc.ts";
import { createAssistantSession, type SessionUpdate, type ToolInvoker } from "./pi-session.ts";
import { createVisionTool } from "./vision-tool.js";
import visionProfile from "./vision-profile.json";
import type { LocalEngine } from "./pi-session.ts";
import type { ImageContent } from "@earendil-works/pi-ai";

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
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
const facade: LocalEngine = {
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
  void (async () => {
    if (busy) throw new Error("The assistant is busy.");
    busy = true;
    try {
      if (message.type === "check" || message.type === "load") {
        const compatibility = await probeAssistantCompatibility(scope, message.settings);
        post({ type: "compatibility", value: compatibility });
        if (message.type === "check") return;
        if (!compatibility.ready) throw new Error(compatibility.summary + " " + compatibility.detail);
        if (engine) throw new Error("Unload the current model before loading another.");
        settings = validateAssistantSettings(message.settings);
        const assetURL = new URL(message.assetBase);
        if (!["https:", "http:"].includes(assetURL.protocol) || assetURL.origin !== scope.location.origin) throw new Error("Assistant runtime assets must come from this application.");
        assetBase = assetURL.href;
        const progress = (value: unknown) => post({ type: "progress", value });
        const loadText = (signal: AbortSignal) => loadAssistantEngine(settings, progress, signal, compatibility, assetBase);
        engine = await loadText(AbortSignal.timeout(settings.loadTimeout));
        vision = createVisionTool({assetBase, profile: visionProfile, getImage: id => { if (!compatibility.fp16) throw new Error("Local image interpretation requires verified WebGPU shader-f16."); return images.get(id); },
          async suspendText() { const current = engine; if (!current) throw new Error("Text model is already unloaded."); await current.dispose(); engine = undefined; },
          async resumeText({signal}) { engine = await loadText(signal); },
          onState: state => { if (state.status) progress(state.status); },
        });
        session = createAssistantSession(facade, settings, invoke, async () => { throw new Error("Use inspect_image for local image pixels."); }, publish, schedule,
          error => post({ type: "diagnostic", operation: "send", error: encodeError(error) }), [vision.tool]);
        post({ type: "ready" });
      } else if (message.type === "send") {
        if (!session) throw new Error("Load a model first.");
        const incoming = message.images ?? [];
        if (!Array.isArray(incoming) || incoming.length > 1) throw new Error("Attach at most one image per message.");
        if (incoming.length && !settings.tools) throw new Error("Enable application tools to inspect local images.");
        const attached = await Promise.all(incoming.map((part: ImageContent) => storeImage(part)));
        await session.send(message.text, [], attached.map(({id, width, height}) => ({id, width, height})));
        flush(); post({ type: "done" });
      } else if (message.type === "reset") {
        if (!session) throw new Error("Load a model first.");
        await session.reset(); images.clear(); flush(); post({ type: "done" });
      } else throw new Error("Unknown assistant command.");
    } finally { busy = false; }
  })().catch(error => { flush(); post({ type: "error", operation: message.type, error: encodeError(error) }); });
};
