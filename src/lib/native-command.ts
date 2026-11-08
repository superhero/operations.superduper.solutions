// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { nativeReadFileBytes } from './native-filesystem-read.ts';

export const nativeCommandScope = 'codex-command';
export const nativeCommandMethods = ['command/exec', 'command/exec/write', 'command/exec/resize', 'command/exec/terminate'] as const;
export type NativeCommandMethod = typeof nativeCommandMethods[number];
export const isNativeCommandMethod = (value: unknown): value is NativeCommandMethod => nativeCommandMethods.includes(value as NativeCommandMethod);
export const nativeCommandApprovalMethod = 'operations/command/requestApproval';
export const nativeCommandDispatchedMethod = 'operations/command/dispatched';
export const nativeCommandOutputMethod = 'command/exec/outputDelta';
export const nativeCommandLimits = { processes: 4, ids: 64, arguments: 64, inputBytes: 16384, outputBytes: 16384, timeoutMs: 300000 } as const;
export function nativeCommandInputSchema(method: NativeCommandMethod) {
  const processId = { type: 'string', minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$' };
  const size = { type: 'object', additionalProperties: false, properties: { cols: { type: 'integer', minimum: 1, maximum: 65535 }, rows: { type: 'integer', minimum: 1, maximum: 65535 } }, required: ['cols', 'rows'] };
  const properties: Record<string, Record<string, unknown>> = method === 'command/exec' ? {
    command: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', maxLength: 8192 }, description: 'Executable and argv. The runtime asks for approval before dispatch.' },
    cwd: { type: ['string', 'null'], minLength: 1, maxLength: 4096, description: 'Directory inside the paired workspace; defaults to its root.' },
    processId: { ...processId, description: 'Unique ID for streaming, stdin or TTY controls on this connection.' },
    env: { type: ['object', 'null'], maxProperties: 64, additionalProperties: { type: ['string', 'null'], maxLength: 4096 } },
    tty: { type: 'boolean' }, streamStdin: { type: 'boolean' }, streamStdoutStderr: { type: 'boolean' }, size,
    timeoutMs: { type: ['integer', 'null'], minimum: 0, maximum: nativeCommandLimits.timeoutMs }, disableTimeout: { type: 'boolean' },
    outputBytesCap: { type: ['integer', 'null'], minimum: 0, maximum: nativeCommandLimits.outputBytes }, disableOutputCap: { type: 'boolean', enum: [false] }
  } : method === 'command/exec/write' ? { processId, deltaBase64: { type: ['string', 'null'], maxLength: 21848, description: 'Canonical base64 stdin bytes, at most 16 KiB decoded.' }, closeStdin: { type: 'boolean' } }
    : method === 'command/exec/resize' ? { processId, size } : { processId };
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'command/exec' ? ['command'] : method === 'command/exec/resize' ? ['processId', 'size'] : ['processId'] };
}
export function nativeCommandDispatchSchema() {
  return { type: 'object', additionalProperties: false, properties: { processId: { type: ['string', 'null'] } }, required: ['processId'] };
}
export function nativeCommandNotificationSchema() {
  return { type: 'object', additionalProperties: false, properties: { method: { type: 'string', enum: [nativeCommandOutputMethod] }, params: {
    type: 'object', additionalProperties: false, properties: { processId: { type: 'string' }, stream: { type: 'string', enum: ['stdout', 'stderr'] },
      deltaBase64: { type: 'string', maxLength: 21848 }, capReached: { type: 'boolean' } }, required: ['processId', 'stream', 'deltaBase64', 'capReached']
  }, emittedAtMs: { type: 'integer', minimum: 0 } }, required: ['method', 'params'] };
}
export class NativeCommandInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) { super(message); this.field = field; }
}
const bad = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.isWellFormed() && value.length <= maximum && !value.includes('\0');
export const nativeCommandId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,192}$/.test(value);
const integer = (value: unknown, maximum: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
export function nativeCommandSize(value: unknown): { cols: number; rows: number } {
  let item: Record<string, unknown>;
  try { item = nativeObject(value, ['cols', 'rows']); } catch { return bad('size', 'Terminal size requires exactly cols and rows.'); }
  if (!integer(item.cols, 65535) || !integer(item.rows, 65535) || item.cols === 0 || item.rows === 0) return bad('size', 'Terminal rows and columns must be between 1 and 65535.');
  return item as { cols: number; rows: number };
}
export function nativeCommandBytes(value: unknown, field = 'deltaBase64'): Uint8Array {
  try {
    const bytes = nativeReadFileBytes({ dataBase64: value });
    if (bytes.length > nativeCommandLimits.inputBytes) throw new Error();
    return bytes;
  } catch { return bad(field, 'Use canonical base64 with at most 16 KiB of decoded bytes.'); }
}
export function nativeCommandParams(method: NativeCommandMethod, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Enter command parameters as an object.');
  let item: Record<string, unknown>;
  try { item = nativeObject(value, Object.keys(value)); } catch { return bad('params', 'Command parameters must be plain data.'); }
  const allowed = method === 'command/exec' ? ['command', 'cwd', 'processId', 'env', 'tty', 'streamStdin', 'streamStdoutStderr', 'size', 'timeoutMs', 'disableTimeout', 'outputBytesCap', 'disableOutputCap']
    : method === 'command/exec/write' ? ['processId', 'deltaBase64', 'closeStdin'] : method === 'command/exec/resize' ? ['processId', 'size'] : ['processId'];
  if (!isNativeCommandMethod(method)) return bad('method', 'Select a qualified command method.');
  for (const key of Object.keys(item)) if (!allowed.includes(key)) bad(key, 'Command inputs cannot override sandbox policies, permission profiles or runtime configuration.');
  if (item.processId != null && !nativeCommandId(item.processId) || method !== 'command/exec' && !nativeCommandId(item.processId)) bad('processId', 'Use an ID owned by this live command connection.');
  if (method === 'command/exec') {
    if (!Array.isArray(item.command) || !item.command.length || item.command.length > nativeCommandLimits.arguments
      || item.command.some(arg => !text(arg, 8192)) || !item.command[0]) bad('command', 'Supply 1–64 bounded argv strings and a nonempty executable. Shell syntax requires an explicitly selected shell executable.');
    if (item.cwd != null && (!text(item.cwd, 4096) || !item.cwd)) bad('cwd', 'Use a directory inside the paired workspace.');
    for (const key of ['tty', 'streamStdin', 'streamStdoutStderr', 'disableTimeout', 'disableOutputCap']) if (Object.hasOwn(item, key) && typeof item[key] !== 'boolean') bad(key, 'Use a boolean command option.');
    if ((item.tty || item.streamStdin || item.streamStdoutStderr) && !nativeCommandId(item.processId)) bad('processId', 'TTY and streaming require a connection-owned process ID.');
    if (item.size != null) { nativeCommandSize(item.size); if (!item.tty) bad('size', 'A terminal size requires tty: true.'); }
    if (item.timeoutMs != null && !integer(item.timeoutMs, nativeCommandLimits.timeoutMs)) bad('timeoutMs', 'Command timeout must be between 0 and 300000 milliseconds.');
    if (item.disableTimeout && item.timeoutMs != null) bad('timeoutMs', 'Choose a timeout or disableTimeout, not both. The connection lease still applies.');
    if (item.disableOutputCap) bad('disableOutputCap', 'The paired command channel requires bounded output.');
    if (item.outputBytesCap != null && !integer(item.outputBytesCap, nativeCommandLimits.outputBytes)) bad('outputBytesCap', 'Output capture must be between 0 and 16384 bytes per stream.');
    if (item.env != null) {
      if (typeof item.env !== 'object' || Array.isArray(item.env)) bad('env', 'Environment overrides must be an object of strings or null values.');
      const env = nativeObject(item.env, Object.keys(item.env));
      if (Object.keys(env).length > 64 || Object.entries(env).some(([name, val]) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) || val !== null && !text(val, 4096))) bad('env', 'Use at most 64 bounded environment names and string/null values.');
      if (env.PATH === null) bad('env.PATH', 'The paired channel reserves PATH for its pinned sandbox dispatcher. Additional search paths may be supplied as a string.');
    }
  } else if (method === 'command/exec/write') {
    if (Object.hasOwn(item, 'closeStdin') && typeof item.closeStdin !== 'boolean') bad('closeStdin', 'Use a boolean closeStdin option.');
    if (item.deltaBase64 != null) nativeCommandBytes(item.deltaBase64);
    if (item.deltaBase64 == null && item.closeStdin !== true) bad('deltaBase64', 'Supply stdin bytes or explicitly close stdin.');
  } else if (method === 'command/exec/resize') nativeCommandSize(item.size);
  if (new TextEncoder().encode(JSON.stringify(item)).byteLength > (method === 'command/exec' ? nativeCommandLimits.inputBytes : 32768)) bad('params', 'The command arguments and environment must fit 16 KiB; stdin controls must fit 32 KiB.');
  return structuredClone(item);
}
export type NativeCommandOutput = { method: typeof nativeCommandOutputMethod; params: { processId: string; stream: 'stdout' | 'stderr'; deltaBase64: string; capReached: boolean }; emittedAtMs?: number };
export function nativeCommandOutput(value: unknown): NativeCommandOutput {
  const timestamped = !!value && typeof value === 'object' && Object.hasOwn(value, 'emittedAtMs');
  const frame = nativeObject(value, timestamped ? ['method', 'params', 'emittedAtMs'] : ['method', 'params']);
  const params = nativeObject(frame.params, ['processId', 'stream', 'deltaBase64', 'capReached']);
  if (frame.method !== nativeCommandOutputMethod || !nativeCommandId(params.processId) || !['stdout', 'stderr'].includes(String(params.stream)) || typeof params.capReached !== 'boolean'
    || timestamped && (!Number.isSafeInteger(frame.emittedAtMs) || Number(frame.emittedAtMs) < 0)) throw new Error('Invalid command output notification.');
  nativeCommandBytes(params.deltaBase64); return structuredClone(frame) as NativeCommandOutput;
}
export function nativeCommandResult(value: unknown): { exitCode: number; stdout: string; stderr: string } {
  const item = nativeObject(value, ['exitCode', 'stdout', 'stderr']);
  if (!Number.isSafeInteger(item.exitCode) || Number(item.exitCode) < -2147483648 || Number(item.exitCode) > 2147483647
    || typeof item.stdout !== 'string' || !item.stdout.isWellFormed() || typeof item.stderr !== 'string' || !item.stderr.isWellFormed()
    || new TextEncoder().encode(item.stdout).byteLength > nativeCommandLimits.outputBytes || new TextEncoder().encode(item.stderr).byteLength > nativeCommandLimits.outputBytes) throw new Error('Invalid command terminal result.');
  return structuredClone(item) as { exitCode: number; stdout: string; stderr: string };
}
export type NativeCommandValue = { protocol: 'json-rpc'; stage: 'dispatched'; processId: string | null }
  | { protocol: 'json-rpc'; stage: 'output'; processId: string; notification: NativeCommandOutput }
  | { protocol: 'json-rpc'; stage: 'completed'; processId: string | null; result: ReturnType<typeof nativeCommandResult> };
export type NativeCommandCallback = (value: NativeCommandValue) => void;
export type NativeCommandProgress = { kind: 'command-approval'; token: string; processId: string | null; params: Record<string, unknown> };
export function isNativeCommandValue(value: unknown): value is NativeCommandValue {
  try {
    if (!value || typeof value !== 'object') return false;
    const stage = (value as Record<string, unknown>).stage;
    const item = nativeObject(value, stage === 'output' ? ['protocol', 'stage', 'processId', 'notification'] : stage === 'completed' ? ['protocol', 'stage', 'processId', 'result'] : ['protocol', 'stage', 'processId']);
    if (item.protocol !== 'json-rpc' || !['dispatched', 'output', 'completed'].includes(String(stage)) || item.processId !== null && !nativeCommandId(item.processId)) return false;
    if (stage === 'output') { const note = nativeCommandOutput(item.notification); if (note.params.processId !== item.processId) return false; }
    if (stage === 'completed') nativeCommandResult(item.result);
    return true;
  } catch { return false; }
}
