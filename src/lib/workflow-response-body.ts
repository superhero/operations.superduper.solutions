// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import { encodeWorkflowBinary, maxWorkflowUploadBytes } from "./workflow-binary.ts";

export type ResponseKind = "json" | "text" | "binary" | "unsupported";
export type ResponseContent = Record<string, Record<string, ResponseKind>>;
export const maxWorkflowResponseBytes = 8 * 1024 * 1024;
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function responseMediaType(value: string): string | undefined {
  const media = value.split(";", 1)[0]!.trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(media) && media.length <= 255 ? media : undefined;
}

export function responseKind(media: string, schema: Record<string, unknown> = {}): ResponseKind {
  if (/^(?:text\/event-stream|application\/(?:x-ndjson|ndjson|jsonl|json-seq|stream\+json))$/.test(media)) return "unsupported";
  if (media === "application/json" || media.endsWith("+json")) return "json";
  if (schema.type === "string" && schema.format === "binary") return "binary";
  if (media.startsWith("text/") || media === "application/xml" || media.endsWith("+xml")) return "text";
  return responseMediaType(media) && !["multipart/form-data", "application/x-www-form-urlencoded"].includes(media) ? "binary" : "unsupported";
}

/** Only file-capable operations acquire new approval metadata; old JSON/text fingerprints stay stable. */
export function inspectResponseContent(responses: unknown, document: Record<string, unknown>): ResponseContent | undefined {
  function resolve(raw: unknown): Record<string, any> {
    let value = object(raw);
    const seen = new Set<string>();
    while (value.$ref !== undefined) {
      const ref = value.$ref;
      if (typeof ref !== "string" || !ref.startsWith("#/") || /~(?:[^01]|$)/.test(ref) || seen.has(ref) || seen.size >= 16) return {};
      seen.add(ref);
      let target: unknown = document;
      for (const part of ref.slice(2).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        target = Object.hasOwn(object(target), key) ? object(target)[key] : undefined;
      }
      value = object(target);
    }
    return value;
  }
  const content: ResponseContent = Object.create(null);
  let binary = false;
  for (const [status, raw] of Object.entries(object(responses))) {
    if (!/^(?:[1-5](?:\d\d|XX)|default)$/i.test(status)) continue;
    const representations: Record<string, ResponseKind> = Object.create(null);
    for (const [media, source] of Object.entries(object(resolve(raw).content))) {
      const normalized = responseMediaType(media);
      if (!normalized) continue;
      const kind = responseKind(normalized, resolve(object(source).schema));
      representations[normalized] = kind;
      binary ||= kind === "binary";
    }
    content[status.toUpperCase()] = representations;
  }
  return binary ? content : undefined;
}

export class WorkflowBodyError extends Error {
  readonly code: "LIMIT" | "CANCELLED" | "MEDIA";
  constructor(code: WorkflowBodyError["code"]) {
    super(code === "LIMIT" ? "The response exceeds the supported size limit. Check the completed request before retrying."
      : code === "CANCELLED" ? "The request was cancelled."
      : "The endpoint returned an unsupported or undeclared response type. Check the completed request before retrying.");
    this.code = code;
  }
}

async function readBytes(response: Response, signal: AbortSignal, limit: number): Promise<Uint8Array> {
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new WorkflowBodyError("CANCELLED"); }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(limit, 8192));
  let size = 0, emptyChunks = 0;
  let abort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => { abort = () => reject(new WorkflowBodyError("CANCELLED")); });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new WorkflowBodyError("CANCELLED");
      if (done) break;
      if (!value.byteLength) {
        if (++emptyChunks > 1024) throw new WorkflowBodyError("LIMIT");
        continue;
      }
      emptyChunks = 0;
      size += value.byteLength;
      if (size > limit) throw new WorkflowBodyError("LIMIT");
      if (size > bytes.length) {
        const expanded = new Uint8Array(Math.min(limit, Math.max(size, bytes.length * 2)));
        expanded.set(bytes); bytes = expanded;
      }
      bytes.set(value, size - value.byteLength);
    }
    return bytes.subarray(0, size);
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Advisory filenames never provide paths, control characters or executable previews. */
export function responseFileName(disposition: string | null): string {
  const extended = /(?:^|;)\s*filename\*\s*=\s*UTF-8'[^']*'([^;]*)/i.exec(disposition ?? "");
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"([^"\r\n]*)"|([^;\s]*))/i.exec(disposition ?? "");
  let name = plain?.[1] ?? plain?.[2] ?? "response.bin";
  if (extended) { try { name = decodeURIComponent(extended[1]!.trim()); } catch { /* Use the plain advisory fallback. */ } }
  name = (name.split(/[/\\]/).at(-1) ?? "").replace(/[\u0000-\u001f\u007f]/g, "_").trim().slice(0, 255);
  return !name || /^\.+$/.test(name) ? "response.bin" : name;
}

export async function readWorkflowResponseBody(response: Response, operation: Operation, method: string, signal: AbortSignal,
  textLimit = maxWorkflowResponseBytes): Promise<{ body: unknown; bodyType?: "binary"; mediaType?: string; malformedJson?: boolean }> {
  if (method === "HEAD" || response.status === 204 || response.status === 205) {
    void response.body?.cancel().catch(() => {});
    return { body: null };
  }
  const raw = response.headers.get("Content-Type");
  const mediaType = responseMediaType(raw ?? (response.ok ? operation.responseMediaType ?? "application/json" : "text/plain"));
  const definitions = operation.responseContent;
  const declared = definitions?.[String(response.status)] ?? definitions?.[`${Math.floor(response.status / 100)}XX`] ?? definitions?.DEFAULT;
  const selected = mediaType && (declared?.[mediaType] ?? declared?.["application/octet-stream"]);
  const kind = mediaType ? selected ?? responseKind(mediaType) : "unsupported";
  // Actual events can never be forced through a declared JSON decoder. Files need an explicit declaration.
  if (!mediaType || responseKind(mediaType) === "unsupported" || kind === "unsupported" || kind === "binary" && selected !== "binary"
    || response.ok && definitions && selected === undefined) {
    void response.body?.cancel().catch(() => {});
    throw new WorkflowBodyError("MEDIA");
  }
  const bytes = await readBytes(response, signal, kind === "binary" ? maxWorkflowUploadBytes : textLimit);
  if (kind === "binary") return { body: encodeWorkflowBinary(responseFileName(response.headers.get("Content-Disposition")), bytes, mediaType), bodyType: "binary", mediaType };
  const metadata = definitions ? { mediaType } : {};
  const text = new TextDecoder().decode(bytes);
  if (!text && method === "OPTIONS") return { body: null, ...metadata };
  if (kind === "json") {
    try { return { body: JSON.parse(text), ...metadata }; }
    catch { return { body: text, ...metadata, malformedJson: response.ok }; }
  }
  return { body: text, ...metadata };
}

/** Linear byte search: inspect raw payloads before base64, including ASCII credentials echoed as UTF-16. */
export function binaryContainsSecret(bytes: Uint8Array, secrets: readonly string[]): boolean {
  const encoder = new TextEncoder();
  function contains(pattern: Uint8Array): boolean {
    if (!pattern.length || pattern.length > bytes.length) return false;
    const prefix = new Uint32Array(pattern.length);
    for (let i = 1, j = 0; i < pattern.length; i++) {
      while (j && pattern[i] !== pattern[j]) j = prefix[j - 1]!;
      if (pattern[i] === pattern[j]) j++;
      prefix[i] = j;
    }
    for (let i = 0, j = 0; i < bytes.length; i++) {
      while (j && bytes[i] !== pattern[j]) j = prefix[j - 1]!;
      if (bytes[i] === pattern[j]) j++;
      if (j === pattern.length) return true;
    }
    return false;
  }
  return secrets.some(secret => {
    const utf8 = encoder.encode(secret);
    const little = new Uint8Array(secret.length * 2), big = new Uint8Array(secret.length * 2);
    for (let i = 0; i < secret.length; i++) { const code = secret.charCodeAt(i); little[i * 2] = big[i * 2 + 1] = code & 255; little[i * 2 + 1] = big[i * 2] = code >> 8; }
    return contains(utf8) || contains(little) || contains(big);
  });
}
