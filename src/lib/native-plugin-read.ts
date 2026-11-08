// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativePluginReadMethods = ['plugin/installed', 'plugin/list', 'plugin/read', 'plugin/skill/read', 'plugin/share/list'] as const;
export type NativePluginReadMethod = typeof nativePluginReadMethods[number];
export const isNativePluginReadMethod = (method: unknown): method is NativePluginReadMethod => nativePluginReadMethods.includes(method as NativePluginReadMethod);
export const nativePluginReadResultTypes: Record<NativePluginReadMethod, string> = {
  'plugin/installed': 'PluginInstalledResponse', 'plugin/list': 'PluginListResponse', 'plugin/read': 'PluginReadResponse',
  'plugin/skill/read': 'PluginSkillReadResponse', 'plugin/share/list': 'PluginShareListResponse'
};
const kinds = ['local', 'vertical', 'workspace-directory', 'shared-with-me', 'created-by-me-remote'];
export function nativePluginReadInputSchema(method: NativePluginReadMethod) {
  const text = (title: string, maxLength = 512): Record<string, unknown> => ({ type: 'string', minLength: 1, maxLength, title });
  const cwds = { type: ['array', 'null'], maxItems: 8, title: 'Working directories', description: 'Optional directories inside the paired workspace for local marketplace discovery.', items: text('Directory', 4096) };
  const properties: Record<string, Record<string, unknown>> = method === 'plugin/installed' ? { cwds,
    installSuggestionPluginNames: { type: ['array', 'null'], maxItems: 32, title: 'Suggested plugin names', items: text('Plugin name', 128) } }
    : method === 'plugin/list' ? { cwds, forceRefetch: { type: 'boolean', default: false, title: 'Refresh plugin catalog',
      description: 'Refreshes configured plugin caches. Changed effective plugins may refresh configured MCP and hook runtimes.' },
      marketplaceKinds: { type: ['array', 'null'], maxItems: 5, title: 'Marketplace kinds', description: 'Omit to use the SDK default, including its configured remote catalog.', items: { type: 'string', enum: kinds } } }
    : method === 'plugin/read' ? { pluginName: text('Plugin name'),
      marketplacePath: { ...text('Local marketplace file', 4096), type: ['string', 'null'], description: 'Choose this or a remote marketplace name, never both.' },
      remoteMarketplaceName: { ...text('Remote marketplace name', 128), type: ['string', 'null'] } }
    : method === 'plugin/skill/read' ? { remoteMarketplaceName: text('Remote marketplace name', 128), remotePluginId: text('Remote plugin ID'), skillName: text('Skill name', 256) } : {};
  return { type: 'object', additionalProperties: false as const, properties,
    required: method === 'plugin/read' ? ['pluginName'] : method === 'plugin/skill/read' ? ['remoteMarketplaceName', 'remotePluginId', 'skillName'] : [] };
}
export function nativePluginReadParams(method: NativePluginReadMethod, value: unknown): Record<string, unknown> {
  const bad = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
  if (!isNativePluginReadMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Supply plugin read parameters as an object.');
  const p = nativeObject(value, Object.keys(value)), schema = nativePluginReadInputSchema(method);
  for (const key of Object.keys(p)) if (!Object.hasOwn(schema.properties, key)) bad(key, 'This parameter is not supported by the selected plugin read.');
  const text = (key: string, v: unknown, maximum: number) => {
    if (typeof v !== 'string' || !v.trim() || !v.isWellFormed() || v.length > maximum || /[\u0000-\u001f\u007f]/.test(v)) bad(key, 'Use bounded, nonempty text without control characters.');
  };
  for (const key of schema.required) if (!Object.hasOwn(p, key)) bad(key, 'This plugin read parameter is required.');
  for (const [key, maximum] of [['pluginName', 512], ['marketplacePath', 4096], ['remoteMarketplaceName', 128], ['remotePluginId', 512], ['skillName', 256]] as const)
    if (p[key] != null || schema.required.includes(key)) text(key, p[key], maximum);
  if (method === 'plugin/read' && Number(p.marketplacePath != null) + Number(p.remoteMarketplaceName != null) !== 1)
    bad('marketplacePath', 'Choose exactly one local marketplace file or remote marketplace name.');
  for (const [key, count, length] of [['cwds', 8, 4096], ['installSuggestionPluginNames', 32, 128], ['marketplaceKinds', 5, 128]] as const) if (p[key] != null) {
    const entries = p[key];
    if (!Array.isArray(entries) || entries.length > count) return bad(key, 'Use at most ' + count + ' entries.');
    for (const entry of entries) text(key, entry, length);
    if (key === 'marketplaceKinds' && entries.some(entry => !kinds.includes(entry))) bad(key, 'Choose a marketplace kind advertised by the pinned SDK.');
  }
  if (Object.hasOwn(p, 'forceRefetch') && typeof p.forceRefetch !== 'boolean') bad('forceRefetch', 'Use a boolean refresh option.');
  const result = structuredClone(p);
  if (method === 'plugin/list') result.forceRefetch ??= false;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768) bad('params', 'Plugin read parameters must fit 32 KiB.');
  return result;
}
