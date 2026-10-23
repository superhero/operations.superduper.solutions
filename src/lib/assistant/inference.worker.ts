// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/// <reference lib="webworker" />
import { validateAssistantSettings, type AssistantSettings } from "./config.ts";
import { probeAssistantCompatibility } from "./compatibility.ts";
import { loadBonsaiEngine } from "./engine.ts";
import { createAssistantSession, type SessionUpdate, type ToolInvoker } from "./pi-session.ts";
import type { ImageContent } from "@earendil-works/pi-ai";

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
let settings: AssistantSettings;
let engine: Awaited<ReturnType<typeof loadBonsaiEngine>> | undefined;
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

async function image(part: ImageContent) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(part.mimeType) || part.data.length > 14000000) throw new Error("Unsupported assistant image.");
  const bytes = Uint8Array.from(atob(part.data), char => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: part.mimeType }));
  try {
    if (bitmap.width * bitmap.height > settings.imagePixels) throw new Error("The image exceeds the configured pixel budget.");
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return { type: "image", image: { data: context.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height, channels: 4 } };
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
        const compatibility = await probeAssistantCompatibility(scope);
        post({ type: "compatibility", value: compatibility });
        if (message.type === "check") return;
        if (!compatibility.ready) throw new Error(compatibility.summary + " " + compatibility.detail);
        if (engine) throw new Error("Unload the current model before loading another.");
        settings = validateAssistantSettings(message.settings);
        engine = await loadBonsaiEngine(settings, value => post({ type: "progress", value }), AbortSignal.timeout(settings.loadTimeout));
        session = createAssistantSession(engine, settings, invoke, image, publish, schedule);
        post({ type: "ready" });
      } else if (message.type === "send") {
        if (!session) throw new Error("Load a model first.");
        await session.send(message.text, message.images);
        flush(); post({ type: "done" });
      } else if (message.type === "reset") {
        if (!session) throw new Error("Load a model first.");
        await session.reset(); flush(); post({ type: "done" });
      } else throw new Error("Unknown assistant command.");
    } finally { busy = false; }
  })().catch(error => { flush(); post({ type: "error", message: error instanceof Error ? error.message : String(error) }); });
};
