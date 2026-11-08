// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeConfigurationControlMethods = ['experimentalFeature/enablement/set', 'skills/extraRoots/set', 'config/mcpServer/reload'] as const;
export type NativeConfigurationControlMethod = typeof nativeConfigurationControlMethods[number];
export const isNativeConfigurationControlMethod = (v: unknown): v is NativeConfigurationControlMethod => nativeConfigurationControlMethods.includes(v as NativeConfigurationControlMethod);
// Exact process-wide keys accepted by the pinned 0.163.0 config processor.
export const nativeRuntimeFeatureKeys = ['api_key_cyber_access_programs', 'api_key_model_discovery', 'auth_elicitation',
  'background_paginated_rollout_migration', 'codex_apps_mcp_2026_07_28', 'mcp_2026_07_28', 'memories', 'mentions_v2',
  'remote_control', 'remote_plugin', 'tool_suggest', 'windows_sandbox_service'] as const;
export function nativeConfigurationControlInputSchema(method: NativeConfigurationControlMethod) {
  const properties: Record<string, Record<string, unknown>> = method === 'experimentalFeature/enablement/set' ? {
    enablement: { type: 'object', title: 'Feature overrides', additionalProperties: false,
      properties: Object.fromEntries(nativeRuntimeFeatureKeys.map(key => [key, { type: 'boolean' }])), default: {},
      description: 'Update named process-wide feature overrides. Omitted keys stay unchanged; an empty object is a no-op. Changes can start configured background services.' }
  } : method === 'skills/extraRoots/set' ? {
    extraRoots: { type: 'array', title: 'Extra skill directories', maxItems: 8, default: [], items: { type: 'string', minLength: 1, maxLength: 4096 },
      description: 'Replace this SDK session’s extra skill roots with directories inside the paired workspace. An empty list clears them.' }
  } : {};
  return { type: 'object', additionalProperties: false as const, properties, required: Object.keys(properties) };
}
export function nativeConfigurationControlParams(method: NativeConfigurationControlMethod, value: unknown): Record<string, unknown> {
  if (!isNativeConfigurationControlMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) throw new NativeCommandInputError('params', 'Supply configuration control parameters as an object.');
  const p = nativeObject(value, Object.keys(value)), names = Object.keys(nativeConfigurationControlInputSchema(method).properties);
  for (const key of Object.keys(p)) if (!names.includes(key)) throw new NativeCommandInputError(key, 'This parameter is not supported by the selected configuration control.');
  if (method === 'experimentalFeature/enablement/set') {
    const map = p.enablement;
    if (!map || typeof map !== 'object' || Array.isArray(map) || Object.entries(map).some(([key, v]) => !nativeRuntimeFeatureKeys.includes(key as typeof nativeRuntimeFeatureKeys[number]) || typeof v !== 'boolean')) throw new NativeCommandInputError('enablement', 'Use canonical runtime feature names with boolean values.');
  }
  if (method === 'skills/extraRoots/set' && (!Array.isArray(p.extraRoots) || p.extraRoots.length > 8 || p.extraRoots.some(v => typeof v !== 'string' || !v || v.length > 4096 || !v.isWellFormed() || /[\u0000-\u001f\u007f]/.test(v)))) throw new NativeCommandInputError('extraRoots', 'Use at most eight directories inside the paired workspace.');
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 16384) throw new NativeCommandInputError('params', 'Configuration controls must fit 16 KiB.');
  return structuredClone(p);
}
