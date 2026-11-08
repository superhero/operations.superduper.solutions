// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { nativeCommandId, NativeCommandInputError } from './native-command.ts';

export const nativeThreadShellMethod = 'thread/shellCommand';
export const nativeThreadShellApprovalMethod = 'operations/threadShell/requestApproval';
export type NativeThreadShellNotice = { kind: 'shell-approval'; token: string; threadId: string; command: string; timeoutMs: number; unsandboxed: true };
export function nativeThreadShellInputSchema() {
  return { type: 'object', additionalProperties: false as const, properties: {
    threadId: { type: 'string', minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$', title: 'Thread ID' },
    command: { type: 'string', minLength: 1, maxLength: 8192, title: 'Shell command', description: 'Runs through the thread shell without the runtime sandbox. Requires separate host permission and explicit approval.' },
    timeoutMs: { type: 'integer', minimum: 0, maximum: 300000, default: 300000, title: 'Timeout (ms)', description: 'Execution timeout, at most five minutes. Zero requests an immediate timeout.' }
  }, required: ['threadId', 'command'] };
}
export function nativeThreadShellParams(value: unknown): { threadId: string; command: string; timeoutMs: number } {
  let p: Record<string, unknown>;
  try { p = nativeObject(value, ['threadId', 'command', ...(value && typeof value === 'object' && Object.hasOwn(value, 'timeoutMs') ? ['timeoutMs'] : [])]); }
  catch { throw new NativeCommandInputError('params', 'Thread shell accepts only threadId, command and timeoutMs.'); }
  if (!nativeCommandId(p.threadId)) throw new NativeCommandInputError('threadId', 'Use a thread owned and loaded by this paired workflow.');
  if (typeof p.command !== 'string' || !p.command.isWellFormed() || !p.command.trim() || p.command.includes('\0') || new TextEncoder().encode(p.command).byteLength > 8192)
    throw new NativeCommandInputError('command', 'Supply a nonempty shell command of at most 8 KiB without NUL bytes.');
  const timeoutMs = p.timeoutMs === undefined ? 300000 : p.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || Number(timeoutMs) < 0 || Number(timeoutMs) > 300000)
    throw new NativeCommandInputError('timeoutMs', 'Shell execution timeout must be between 0 and 300000 milliseconds.');
  return { threadId: p.threadId, command: p.command.trim(), timeoutMs: Number(timeoutMs) };
}
type Document = Record<string, unknown>;
const object = (v: unknown): v is Document => !!v && typeof v === 'object' && !Array.isArray(v);
/** Preserve the two actual native notifications instead of relabelling the empty ACK. */
export function nativeThreadShellResultSchema(document: Document) {
  const definitions = object(document.definitions) && document.definitions.v2;
  const item = object(definitions) && definitions.ThreadItem, completed = object(definitions) && definitions.ItemCompletedNotification;
  const variant = object(item) && Array.isArray(item.oneOf) && item.oneOf.find(value => object(value) && object(value.properties)
    && object(value.properties.type) && JSON.stringify(value.properties.type.enum) === '["commandExecution"]');
  if (!object(variant) || !object(completed) || !object(completed.properties)) throw new Error('Thread shell notification declarations require requalification.');
  const event = (method: string, params: unknown) => ({ type: 'object', additionalProperties: false, properties: {
    method: { type: 'string', enum: [method] }, params, emittedAtMs: { type: 'integer', minimum: 0 }
  }, required: ['method', 'params'] });
  return { type: 'object', additionalProperties: false, properties: {
    completion: event('turn/completed', { $ref: '#/definitions/v2/TurnCompletedNotification' }),
    command: event('item/completed', { ...structuredClone(completed), properties: { ...structuredClone(completed.properties), item: structuredClone(variant) } })
  }, required: ['completion', 'command'] };
}
export type NativeThreadShellFrame = { method: string; params: Record<string, unknown>; emittedAtMs?: number };
export function nativeThreadShellItem(value: unknown, threadId: string, turnId: string, phase: 'started' | 'completed', itemId?: string): NativeThreadShellFrame {
  const timestamp = !!value && typeof value === 'object' && Object.hasOwn(value, 'emittedAtMs');
  const frame = nativeObject(value, ['method', 'params', ...(timestamp ? ['emittedAtMs'] : [])]);
  const p = frame.params;
  if (!object(p) || p.threadId !== threadId || p.turnId !== turnId || frame.method !== 'item/' + phase || !object(p.item)) throw new Error('Unowned shell item.');
  const item = p.item;
  if (item.type !== 'commandExecution' || item.source !== 'userShell' || !nativeCommandId(item.id) || itemId !== undefined && item.id !== itemId
    || typeof item.command !== 'string' || typeof item.cwd !== 'string' || !Array.isArray(item.commandActions)
    || phase === 'started' && item.status !== 'inProgress' || phase === 'completed' && !['completed', 'failed', 'declined'].includes(String(item.status))
    || phase === 'completed' && (!Number.isSafeInteger(p.completedAtMs) || Number(p.completedAtMs) < 0)
    || item.aggregatedOutput != null && (typeof item.aggregatedOutput !== 'string' || !item.aggregatedOutput.isWellFormed())
    || item.exitCode != null && (!Number.isSafeInteger(item.exitCode) || Number(item.exitCode) < -2147483648 || Number(item.exitCode) > 2147483647)
    || timestamp && (!Number.isSafeInteger(frame.emittedAtMs) || Number(frame.emittedAtMs) < 0)
    || new TextEncoder().encode(JSON.stringify(frame)).byteLength > 60000) throw new Error('Invalid shell command item.');
  return structuredClone(frame) as NativeThreadShellFrame;
}
