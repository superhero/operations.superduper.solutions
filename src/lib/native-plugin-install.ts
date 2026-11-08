// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

/** Finite owner-granted plugin management contracts for the paired runtime. */
export const nativePluginInstallMethods = ['plugin/install', 'plugin/uninstall', 'plugin/reconcile'] as const;
export type NativePluginInstallMethod = typeof nativePluginInstallMethods[number];
export const isNativePluginInstallMethod = (v: unknown): v is NativePluginInstallMethod => nativePluginInstallMethods.includes(v as NativePluginInstallMethod);
export const nativePluginInstallResultTypes: Record<NativePluginInstallMethod, string> = {
  'plugin/install': 'PluginInstallResponse', 'plugin/uninstall': 'PluginUninstallResponse', 'plugin/reconcile': 'PluginReconcileResponse'
};
export function nativePluginInstallInputSchema(method: NativePluginInstallMethod) {
  const text = (title: string, maxLength = 512): Record<string, unknown> => ({ type: 'string', minLength: 1, maxLength, title });
  const properties: Record<string, Record<string, unknown>> = method === 'plugin/install' ? {
    pluginName: text('Plugin name'), marketplacePath: { ...text('Local marketplace file', 4096), type: ['string', 'null'] },
    remoteMarketplaceName: { ...text('Remote marketplace name', 128), type: ['string', 'null'] },
    installAttemptId: { ...text('Install attempt ID', 128), type: ['string', 'null'], description: 'Optional client correlation identifier.' }
  } : method === 'plugin/uninstall' ? { pluginId: text('Plugin ID') } : {
    reason: { type: ['string', 'null'], maxLength: 1024, title: 'Reason', 'x-native-multiline': true }
  };
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'plugin/install' ? ['pluginName'] : method === 'plugin/uninstall' ? ['pluginId'] : [] };
}
export function nativePluginInstallParams(method: NativePluginInstallMethod, value: unknown): Record<string, unknown> {
  const bad = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
  if (!isNativePluginInstallMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Supply plugin management parameters as an object.');
  const p = nativeObject(value, Object.keys(value)), schema = nativePluginInstallInputSchema(method);
  for (const key of Object.keys(p)) if (!Object.hasOwn(schema.properties, key)) bad(key, 'This parameter is not supported by the selected plugin method.');
  for (const key of schema.required) if (p[key] == null) bad(key, 'This plugin parameter is required.');
  for (const [key, maximum] of [['pluginName', 512], ['pluginId', 512], ['marketplacePath', 4096], ['remoteMarketplaceName', 128], ['installAttemptId', 128], ['reason', 1024]] as const) if (p[key] != null) {
    const text = p[key];
    if (typeof text !== 'string' || !text.isWellFormed() || text.length > maximum || key !== 'reason' && !text.trim()
      || (key === 'reason' ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(text)) bad(key, 'Use bounded text without unsupported control characters.');
  }
  if (method === 'plugin/install' && Number(p.marketplacePath != null) + Number(p.remoteMarketplaceName != null) !== 1)
    bad('marketplacePath', 'Choose exactly one local marketplace file or remote marketplace name.');
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 16384) bad('params', 'Plugin parameters must fit 16 KiB.');
  return structuredClone(p);
}
