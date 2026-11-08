// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeMcpInputError, nativeMcpResourceBodies } from './native-mcp-read.ts';

export const nativeMcpToolMethod = 'mcpServer/tool/call';
export const nativeMcpToolLimits = { requestMs: 120000, contents: 64, bodyBytes: 32768, inputBytes: 32768 } as const;
/** Standard JSON Schema vocabulary; the form exposes the complete union as one JSON input. */
export const nativeJsonTypes = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const;
export function nativeMcpToolInputSchema() {
  const text = (title: string, maxLength: number) => ({ type: 'string', minLength: 1, maxLength, title });
  return { type: 'object', additionalProperties: false as const, properties: {
    threadId: { ...text('Thread ID', 192), pattern: '^[A-Za-z0-9_-]+$' }, server: text('Server name', 256), tool: text('Tool name', 256),
    arguments: { type: [...nativeJsonTypes], title: 'Tool arguments', description: 'JSON arguments for the configured MCP tool. No runtime or transport configuration is accepted.' },
    _meta: { type: [...nativeJsonTypes], title: 'Tool metadata', description: 'Optional MCP JSON metadata. Codex supplies its authoritative thread ID for object metadata.' }
  } as Record<string, Record<string, unknown>>, required: ['threadId', 'server', 'tool'] };
}
export function nativeMcpToolParams(value: unknown): Record<string, unknown> {
  const bad = (field: string, message: string): never => { throw new NativeMcpInputError(field, message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Enter MCP tool parameters as an object.');
  const item = nativeObject(value, Object.keys(value)), allowed = nativeMcpToolInputSchema().properties;
  for (const name of Object.keys(item)) if (!Object.hasOwn(allowed, name)) bad(name, 'MCP tool inputs cannot override runtime or transport configuration.');
  for (const [field, maximum] of [['threadId', 192], ['server', 256], ['tool', 256]] as const) {
    const input = item[field];
    if (typeof input !== 'string' || !input.isWellFormed() || !input.trim() || [...input].length > maximum || /[\u0000-\u001f\u007f]/.test(input)
      || field === 'threadId' && !/^[A-Za-z0-9_-]+$/.test(input)) bad(field, 'Enter a bounded MCP name and a thread created by this paired runtime.');
  }
  let nodes = 0;
  const json = (input: unknown, field: string, depth = 0): void => {
    if (++nodes > 4096 || depth > 24) bad(field, 'MCP tool JSON exceeds its complexity limit.');
    if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return;
    if (typeof input === 'string' && input.isWellFormed()) return;
    if (Array.isArray(input)) { for (const entry of input) json(entry, field, depth + 1); return; }
    if (input && typeof input === 'object') {
      nativeObject(input, Object.keys(input));
      for (const [key, entry] of Object.entries(input)) { if (!key.isWellFormed()) bad(field, 'MCP JSON keys must be valid Unicode.'); json(entry, field, depth + 1); } return;
    }
    return bad(field, 'MCP tool values must be finite plain JSON.');
  };
  for (const field of ['arguments', '_meta']) if (Object.hasOwn(item, field)) json(item[field], field);
  if (new TextEncoder().encode(JSON.stringify(item)).byteLength > nativeMcpToolLimits.inputBytes) bad('params', 'MCP tool inputs must fit within 32 KiB.');
  return structuredClone(item);
}

/** Scan recognized MCP text, image/audio and embedded resource bodies without changing the wire result. */
export function nativeMcpToolBodies(value: unknown): Uint8Array[] {
  const result = value as { content?: unknown[] };
  if (!Array.isArray(result.content) || result.content.length > nativeMcpToolLimits.contents) throw new Error('Invalid MCP tool content.');
  const bodies: Uint8Array[] = [];
  for (const content of result.content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) continue;
    const item = content as Record<string, unknown>;
    if (item.type === 'text') bodies.push(...nativeMcpResourceBodies({ contents: [{ uri: 'mcp:tool', text: item.text }] }));
    if (item.type === 'image' || item.type === 'audio') bodies.push(...nativeMcpResourceBodies({ contents: [{ uri: 'mcp:tool', blob: item.data }] }));
    if (item.type === 'resource') bodies.push(...nativeMcpResourceBodies({ contents: [item.resource] }));
  }
  return bodies;
}
