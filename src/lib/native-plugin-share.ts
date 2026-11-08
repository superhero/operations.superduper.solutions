// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';
import { isNativePluginRemoteId } from './native-plugin-id.ts';
import { assertNativeJsonByteBudget } from './native-input-budget.ts';

/** Finite owner-granted sharing contracts with native policy restrictions. */
export const nativePluginShareMethods = ['plugin/share/save', 'plugin/share/updateTargets', 'plugin/share/checkout', 'plugin/share/delete'] as const;
export type NativePluginShareMethod = typeof nativePluginShareMethods[number];
export const isNativePluginShareMethod = (value: unknown): value is NativePluginShareMethod => nativePluginShareMethods.includes(value as NativePluginShareMethod);
export const nativePluginShareResultTypes: Record<NativePluginShareMethod, string> = {
  'plugin/share/save': 'PluginShareSaveResponse', 'plugin/share/updateTargets': 'PluginShareUpdateTargetsResponse',
  'plugin/share/checkout': 'PluginShareCheckoutResponse', 'plugin/share/delete': 'PluginShareDeleteResponse'
};
export function nativePluginShareInputSchema(method: NativePluginShareMethod) {
  const text = (title: string, maxLength = 512): Record<string, unknown> => ({ type: 'string', title, minLength: 1, maxLength });
  const save = method === 'plugin/share/save', update = method === 'plugin/share/updateTargets';
  const targets = { type: save ? ['array', 'null'] : 'array', title: 'Share targets', maxItems: 64,
    description: 'User and group access. The native service manages the workspace reader for unlisted shares.',
    items: { type: 'object', additionalProperties: false, required: ['principalType', 'principalId', 'role'], properties: {
      principalType: { type: 'string', enum: ['user', 'group'], title: 'Principal type' },
      principalId: text('Principal ID'), role: { type: 'string', enum: ['reader', 'editor'], title: 'Role' }
    } } };
  const properties: Record<string, Record<string, unknown>> = save ? {
    pluginPath: { ...text('Plugin directory', 4096), description: 'Owned source directory in the paired workspace or a verified personal checkout.' },
    remotePluginId: { ...text('Remote plugin ID'), type: ['string', 'null'] },
    discoverability: { type: ['string', 'null'], title: 'Discoverability', enum: ['UNLISTED', 'PRIVATE', null], description: 'Creation only. Publish as listed through Update share targets.' }, shareTargets: targets
  } : update ? { remotePluginId: text('Remote plugin ID'),
    discoverability: { type: 'string', title: 'Discoverability', enum: ['UNLISTED', 'PRIVATE', 'LISTED'] }, shareTargets: targets
  } : { remotePluginId: text('Remote plugin ID') };
  return { type: 'object', additionalProperties: false as const, properties,
    required: save ? ['pluginPath'] : update ? ['remotePluginId', 'discoverability', 'shareTargets'] : ['remotePluginId'] };
}
export function nativePluginShareParams(method: NativePluginShareMethod, input: unknown): Record<string, unknown> {
  const fail = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
  if (!isNativePluginShareMethod(method) || !input || typeof input !== 'object' || Array.isArray(input)) return fail('params', 'Supply plugin-sharing parameters as an object.');
  const params = nativeObject(input, Object.keys(input)), schema = nativePluginShareInputSchema(method);
  for (const key of Object.keys(params)) if (!Object.hasOwn(schema.properties, key)) fail(key, 'This parameter is not supported by the selected sharing method.');
  for (const key of schema.required) if (params[key] == null) fail(key, 'This plugin-sharing parameter is required.');
  if (params.remotePluginId != null && !isNativePluginRemoteId(params.remotePluginId)) fail('remotePluginId', 'Use at most 512 ASCII letters, digits, underscores, hyphens or tildes.');
  const text = (value: unknown, field: string, maximum: number) => {
    if (typeof value !== 'string' || !value.trim() || !value.isWellFormed() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value))
      fail(field, 'Use bounded nonempty text without control characters.');
  };
  if (params.pluginPath != null) text(params.pluginPath, 'pluginPath', 4096);
  if (params.discoverability != null && !(method === 'plugin/share/save' ? ['UNLISTED', 'PRIVATE'] : ['UNLISTED', 'PRIVATE', 'LISTED']).includes(params.discoverability as string))
    fail('discoverability', method === 'plugin/share/save' ? 'Create with UNLISTED or PRIVATE; use Update share targets to publish as LISTED.' : 'Choose UNLISTED, PRIVATE or LISTED.');
  if (method === 'plugin/share/save' && params.remotePluginId != null && (params.discoverability != null || params.shareTargets != null))
    fail(params.discoverability != null ? 'discoverability' : 'shareTargets', 'Update existing share access through Update share targets.');
  if (params.shareTargets != null) {
    if (!Array.isArray(params.shareTargets) || params.shareTargets.length > 64) return fail('shareTargets', 'Use an array of at most 64 user/group access targets.');
    for (const [index, raw] of params.shareTargets.entries()) {
      const field = `shareTargets[${index}]`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('shareTargets', field + ' must be an access target object.');
      const target = raw as Record<string, unknown>;
      if (Object.keys(target).some(k => !['principalType', 'principalId', 'role'].includes(k))) fail('shareTargets', field + ' has an unsupported property.');
      if (!['user', 'group'].includes(target.principalType as string)) fail('shareTargets', field + '.principalType must be user or group; workspace access is managed by the native service.');
      text(target.principalId, 'shareTargets', 512);
      if (!['reader', 'editor'].includes(target.role as string)) fail('shareTargets', field + '.role must be reader or editor.');
    }
  }
  assertNativeJsonByteBudget(params, 32768, NativeCommandInputError, 'params', 'Plugin-sharing parameters must fit 32 KiB.');
  return structuredClone(params);
}
