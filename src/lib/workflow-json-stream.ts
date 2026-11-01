// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { WorkflowBodyError } from "./workflow-body-error.ts";
import { streamLimits, validStreamJson, type ResponseProgressCallback, type ResponseValueCallback } from "./workflow-response-stream.ts";

/** Long-lived JSON streams retain one frame. Views own their bounded display windows. */
export async function readJsonStream(response: Response, sse: boolean, signal: AbortSignal,
  onProgress?: ResponseProgressCallback, onValue?: ResponseValueCallback) {
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new WorkflowBodyError("CANCELLED"); }
  if (!response.body) throw new WorkflowBodyError("INCOMPLETE");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", data: string[] = [], frameSize = 0, bytes = 0, events = 0, empty = 0, notified = -Infinity, last: unknown = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => { abort = () => reject(new WorkflowBodyError("CANCELLED")); });
  void cancelled.catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  const progress = (force = false) => {
    if (force || Date.now() - notified >= streamLimits.progressMs) {
      notified = Date.now(); onProgress?.({ bytes, events });
    }
  };
  const frame = (source: string) => {
    if (signal.aborted) throw new WorkflowBodyError("CANCELLED");
    try { last = JSON.parse(source); } catch { throw new WorkflowBodyError("FRAME"); }
    validStreamJson(last);
    events = Math.min(events + 1, streamLimits.events);
    onValue?.({ body: last, status: response.status });
  };
  const line = (source: string) => {
    if (!sse) { if (source.trim()) frame(source); return; }
    if (!source) { if (data.length) frame(data.join("\n")); data = []; frameSize = 0; return; }
    if (source.startsWith(":")) return;
    const separator = source.indexOf(":"), field = separator < 0 ? source : source.slice(0, separator);
    let value = separator < 0 ? "" : source.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") {
      frameSize += value.length + 1;
      if (frameSize > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
      data.push(value);
    }
  };
  try {
    progress(true);
    while (true) {
      const idle = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new WorkflowBodyError("IDLE")), streamLimits.idleMs); });
      const item = await Promise.race([reader.read(), cancelled, idle]);
      clearTimeout(timer);
      if (signal.aborted) throw new WorkflowBodyError("CANCELLED");
      if (item.done) {
        try { buffer += decoder.decode(); } catch { throw new WorkflowBodyError("FRAME"); }
        if (!sse && buffer.trim()) frame(buffer);
        if (sse && buffer.endsWith("\r")) line(buffer.slice(0, -1));
        // SSE dispatch requires a blank line, including at EOF.
        progress(true); return { body: last, stream: { bytes, events } };
      }
      if (item.value.byteLength > streamLimits.bytes) throw new WorkflowBodyError("LIMIT");
      if (item.value.byteLength) empty = 0;
      else if (++empty > 1024) throw new WorkflowBodyError("LIMIT");
      bytes = Math.min(streamLimits.bytes, bytes + item.value.byteLength);
      try { buffer += decoder.decode(item.value, { stream: true }); } catch { throw new WorkflowBodyError("FRAME"); }
      while (true) {
        const index = buffer.search(/[\r\n]/);
        if (index < 0 || sse && buffer[index] === "\r" && index === buffer.length - 1) break;
        const source = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1));
        if (source.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
        line(source);
      }
      if (buffer.length > streamLimits.frameCharacters) throw new WorkflowBodyError("LIMIT");
      progress();
    }
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
