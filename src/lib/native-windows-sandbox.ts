// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeWindowsSandboxReadinessMethod = 'windowsSandbox/readiness' as const;
export const nativeWindowsSandboxSetupMethod = 'windowsSandbox/setupStart' as const;
export type NativeWindowsSandboxMethod = typeof nativeWindowsSandboxReadinessMethod | typeof nativeWindowsSandboxSetupMethod;
export const isNativeWindowsSandboxReadinessMethod = (value: unknown): value is typeof nativeWindowsSandboxReadinessMethod => value === nativeWindowsSandboxReadinessMethod;
export const nativeWindowsSandboxStatuses = ['ready', 'notConfigured', 'updateRequired'] as const;
export type NativeWindowsSandboxStatus = typeof nativeWindowsSandboxStatuses[number];
export const nativeWindowsSandboxReadinessResultTypes = { [nativeWindowsSandboxReadinessMethod]: 'WindowsSandboxReadinessResponse' } as const;
export function nativeWindowsSandboxInputSchema(method: NativeWindowsSandboxMethod) {
  const properties: Record<string, Record<string, unknown>> = method === nativeWindowsSandboxSetupMethod ? {
    mode: { type: 'string', title: 'Setup mode', enum: ['elevated', 'unelevated'] },
    cwd: { type: ['string', 'null'], title: 'Working directory', minLength: 1, maxLength: 4096,
      description: 'Omitting the project preserves native setup without project workspace roots.' }
  } : {};
  return { type: 'object', additionalProperties: false as const, properties, required: method === nativeWindowsSandboxSetupMethod ? ['mode'] : [] };
}
/** Setup contracts remain under qualification; only readiness is publicly enrolled. */
export function nativeWindowsSandboxParams(method: NativeWindowsSandboxMethod, input: unknown): Record<string, unknown> {
  const fail = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
  if (method !== nativeWindowsSandboxReadinessMethod && method !== nativeWindowsSandboxSetupMethod) return fail('method', 'Choose a native Windows sandbox lifecycle method.');
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) return fail('params', 'Supply Windows sandbox parameters as an object.');
  const params = nativeObject(input ?? {}, Object.keys(input ?? {})), schema = nativeWindowsSandboxInputSchema(method);
  for (const key of Object.keys(params)) if (!Object.hasOwn(schema.properties, key)) fail(key, 'This Windows sandbox parameter is not supported.');
  if (method === nativeWindowsSandboxSetupMethod && !['elevated', 'unelevated'].includes(params.mode as string)) fail('mode', 'Choose elevated or unelevated setup.');
  if (params.cwd != null && (typeof params.cwd !== 'string' || !params.cwd.trim() || !params.cwd.isWellFormed() || params.cwd.length > 4096 || /[\u0000-\u001f\u007f]/.test(params.cwd)))
    fail('cwd', 'Use a bounded native directory without control characters.');
  if (typeof params.cwd === 'string' && !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\])/.test(params.cwd)) fail('cwd', 'Use an absolute native directory.');
  return structuredClone(params);
}
export function nativeWindowsSandboxReadiness(value: unknown): { status: NativeWindowsSandboxStatus } {
  const result = nativeObject(value, ['status']);
  if (!nativeWindowsSandboxStatuses.includes(result.status as NativeWindowsSandboxStatus)) throw new Error('Invalid native Windows sandbox readiness.');
  return result as { status: NativeWindowsSandboxStatus };
}
export function nativeWindowsSandboxCompletion(value: unknown, mode: unknown) {
  const result = nativeObject(value, ['mode', 'success', 'error']);
  if (!['elevated', 'unelevated'].includes(mode as string) || result.mode !== mode || typeof result.success !== 'boolean'
    || result.error != null && (typeof result.error !== 'string' || result.error.length > 4096)
    || result.success && result.error != null) throw new Error('Invalid or unowned Windows sandbox setup completion.');
  return structuredClone(result);
}
