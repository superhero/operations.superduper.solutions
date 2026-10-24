// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { WorkflowBodyError } from "./workflow-body-error.ts";

export type ResponseStreamProfile = "openai-responses" | "ollama-chat" | "ollama-generate";
export type ResponseProgress = { bytes: number; events: number };
export type ResponseProgressCallback = (progress: ResponseProgress) => void;
export const streamLimits = { bytes: 8 * 1024 * 1024, frameCharacters: 1024 * 1024, events: 10_000,
  depth: 64, nodes: 100_000, chunks: 65_536, idleMs: 15_000, runMs: 120_000, progressMs: 500 } as const;
export const isResponseStreamProfile = (value: unknown): value is ResponseStreamProfile =>
  value === "openai-responses" || value === "ollama-chat" || value === "ollama-generate";
export function responseStreamProfile(value: unknown): ResponseStreamProfile | undefined {
  if (value === undefined) return;
  if (isResponseStreamProfile(value)) return value;
  throw new Error("This response streaming profile is not supported.");
}
export const streamMediaType = (profile: ResponseStreamProfile): string => profile === "openai-responses" ? "text/event-stream" : "application/x-ndjson";
export function responseAccept(profile: ResponseStreamProfile | undefined, fallback: string | undefined, body: unknown): string {
  const stream = object(body) ? body.stream : undefined;
  return profile && stream !== false && (profile !== "openai-responses" || stream === true) ? streamMediaType(profile) : fallback ?? "application/json";
}
export function isResponseProgress(value: unknown): value is ResponseProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as ResponseProgress;
  return Object.keys(value).length === 2 && Object.keys(value).every(key => key === "bytes" || key === "events")
    && Number.isSafeInteger(item.bytes) && item.bytes >= 0 && item.bytes <= streamLimits.bytes
    && Number.isSafeInteger(item.events) && item.events >= 0 && item.events <= streamLimits.events;
}

/** Connect/ordinary responses keep 15 seconds; a qualified stream gets one bounded run. */
export function workflowResponseLifetime(external?: AbortSignal) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), 15_000);
  return { timeout: controller.signal, signal: external ? AbortSignal.any([external, controller.signal]) : controller.signal,
    beginStream() { clearTimeout(timer); timer = setTimeout(() => controller.abort(), streamLimits.runMs); },
    dispose() { clearTimeout(timer); } };
}

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function validJson(value: unknown): void {
  const stack: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (++nodes > streamLimits.nodes || depth > streamLimits.depth) throw new WorkflowBodyError("LIMIT");
    if (typeof item === "number" && !Number.isFinite(item)) throw new WorkflowBodyError("FRAME");
    if (item && typeof item === "object") for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
}

/** Frames stay local. Only bounded counts and the assembled terminal JSON can leave this reader. */
export async function readResponseStream(response: Response, profile: ResponseStreamProfile, signal: AbortSignal,
  onProgress?: ResponseProgressCallback): Promise<{ body: unknown; stream: ResponseProgress }> {
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new WorkflowBodyError("CANCELLED"); }
  if (!response.body) throw new WorkflowBodyError("INCOMPLETE");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", scan = 0, event = "", frameCharacters = 0, chunks = 0, empty = 0;
  let data: string[] = [], bytes = 0, events = 0, lastByte = Date.now(), notified = -Infinity;
  let model = "", role = "", responseId = "", sequence = -1, result: Record<string, any> | undefined;
  const text: string[] = [], thinking: string[] = [], tools: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new WorkflowBodyError("CANCELLED")); });
  let runTimer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => { runTimer = setTimeout(() => reject(new WorkflowBodyError("TIMEOUT")), streamLimits.runMs); });
  void aborted.catch(() => {}); void deadline.catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  function progress(force = false) {
    if (force || Date.now() - notified >= streamLimits.progressMs) { notified = Date.now(); onProgress?.({ bytes, events }); }
  }
  function frame(source: string, name = "") {
    if (++events > streamLimits.events) throw new WorkflowBodyError("LIMIT");
    if (source.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
    let value: unknown;
    try { value = JSON.parse(source); } catch { throw new WorkflowBodyError("FRAME"); }
    validJson(value);
    if (!object(value)) throw new WorkflowBodyError("FRAME");
    if (profile === "openai-responses") {
      if (typeof value.type !== "string" || name && name !== "message" && name !== value.type) throw new WorkflowBodyError("FRAME");
      if (["error", "response.failed", "response.incomplete", "response.cancelled"].includes(value.type)) throw new WorkflowBodyError("PROVIDER");
      if (value.sequence_number !== undefined) {
        if (!Number.isSafeInteger(value.sequence_number) || value.sequence_number <= sequence) throw new WorkflowBodyError("FRAME");
        sequence = value.sequence_number;
      }
      if (object(value.response) && typeof value.response.id === "string") {
        if (responseId && responseId !== value.response.id) throw new WorkflowBodyError("FRAME");
        responseId = value.response.id;
      }
      if (value.response_id !== undefined) {
        if (typeof value.response_id !== "string" || !value.response_id || responseId && value.response_id !== responseId) throw new WorkflowBodyError("FRAME");
        responseId = value.response_id;
      }
      if (value.type === "response.completed") {
        const final = value.response;
        if (!object(final) || final.object !== "response" || typeof final.id !== "string" || !final.id || !Array.isArray(final.output))
          throw new WorkflowBodyError("FRAME");
        if (final.status !== "completed" || final.error != null) throw new WorkflowBodyError("PROVIDER");
        result = final;
      }
      return;
    }
    if (value.error != null) throw new WorkflowBodyError("PROVIDER");
    if (typeof value.done !== "boolean") throw new WorkflowBodyError("FRAME");
    if (value.model !== undefined) {
      if (typeof value.model !== "string" || !value.model || model && value.model !== model) throw new WorkflowBodyError("FRAME");
      model = value.model;
    }
    const message = profile === "ollama-chat" ? value.message : value;
    if (message !== undefined) {
      if (!object(message)) throw new WorkflowBodyError("FRAME");
      const content = profile === "ollama-chat" ? message.content : message.response;
      if (content !== undefined && typeof content !== "string" || message.thinking !== undefined && typeof message.thinking !== "string")
        throw new WorkflowBodyError("FRAME");
      if (content !== undefined) text.push(content);
      if (message.thinking !== undefined) thinking.push(message.thinking);
      if (profile === "ollama-chat") {
        if (Object.keys(message).some(key => !["role", "content", "thinking", "tool_calls"].includes(key))) throw new WorkflowBodyError("FRAME");
        if (message.role !== undefined) {
          if (message.role !== "assistant") throw new WorkflowBodyError("FRAME");
          role = message.role;
        }
        if (message.tool_calls !== undefined) {
          if (!Array.isArray(message.tool_calls) || message.tool_calls.some((call: unknown) => !object(call))) throw new WorkflowBodyError("FRAME");
          tools.push(...message.tool_calls);
        }
      }
    }
    if (value.done) {
      if (!model) throw new WorkflowBodyError("FRAME");
      result = profile === "ollama-chat" ? { ...value, model, message: { role: role || "assistant", content: text.join(""),
        ...(thinking.length ? { thinking: thinking.join("") } : {}), ...(tools.length ? { tool_calls: tools } : {}) } }
        : { ...value, model, response: text.join(""), ...(thinking.length ? { thinking: thinking.join("") } : {}) };
      validJson(result);
    }
  }
  function line(value: string) {
    if (profile !== "openai-responses") { if (value.trim()) frame(value); return; }
    if (!value) {
      if (data.length) frame(data.join("\n"), event);
      data = []; event = ""; frameCharacters = 0; return;
    }
    if (value.startsWith(":")) return;
    const separator = value.indexOf(":");
    const field = separator < 0 ? value : value.slice(0, separator);
    let content = separator < 0 ? "" : value.slice(separator + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "data") {
      frameCharacters += content.length + 1;
      if (frameCharacters > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
      data.push(content);
    } else if (field === "event") {
      if (content.length > 256) throw new WorkflowBodyError("LIMIT");
      event = content;
    }
  }
  try {
    if (signal.aborted) abort();
    progress(true);
    while (!result) {
      const idle = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new WorkflowBodyError("IDLE")), Math.max(0, streamLimits.idleMs - (Date.now() - lastByte)));
      });
      const { value, done } = await Promise.race([reader.read(), aborted, idle, deadline]);
      clearTimeout(timer);
      if (signal.aborted) throw new WorkflowBodyError("CANCELLED");
      if (done) {
        try { decoder.decode(); } catch { throw new WorkflowBodyError("FRAME"); }
        // A final CR is a complete SSE line ending even without a following LF.
        if (profile === "openai-responses" && buffer.endsWith("\r")) {
          const current = buffer.slice(0, -1);
          if (current.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
          line(current);
          if (result) break;
        }
        throw new WorkflowBodyError("INCOMPLETE");
      }
      if (++chunks > streamLimits.chunks || !value.byteLength && ++empty > 1024) throw new WorkflowBodyError("LIMIT");
      bytes += value.byteLength;
      if (bytes > streamLimits.bytes) throw new WorkflowBodyError("LIMIT");
      if (value.byteLength) { lastByte = Date.now(); empty = 0; }
      try { buffer += decoder.decode(value, { stream: true }); } catch { throw new WorkflowBodyError("FRAME"); }
      while (!result) {
        let index = scan;
        while (index < buffer.length && buffer[index] !== "\r" && buffer[index] !== "\n") index++;
        if (index === buffer.length || buffer[index] === "\r" && index === buffer.length - 1) { scan = index; break; }
        if (profile !== "openai-responses" && buffer[index] === "\r" && buffer[index + 1] !== "\n") throw new WorkflowBodyError("FRAME");
        const current = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1));
        scan = 0;
        if (current.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
        line(current);
      }
      if (!result && buffer.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
      progress();
    }
    progress(true);
    return { body: result, stream: { bytes, events } };
  } finally {
    clearTimeout(timer); clearTimeout(runTimer!); signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
