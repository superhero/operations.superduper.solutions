// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativePluginShareMethod, type NativePluginShareMethod } from './native-plugin-share.ts';
import { isNativePluginInstallMethod, type NativePluginInstallMethod } from './native-plugin-install.ts';
import { isNativeMarketplaceMethod, type NativeMarketplaceMethod } from './native-marketplace.ts';
import { nativeObject, nativeIdentity, sameNativeIdentity, type NativeRuntimeIdentity } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';
import { nativeJsonTypes } from './native-mcp-tool.ts';

export const nativeConfigurationWriteMethods = ['config/value/write', 'config/batchWrite', 'skills/config/write'] as const;
export type NativeConfigurationWriteMethod = typeof nativeConfigurationWriteMethods[number];
export const isNativeConfigurationWriteMethod = (v: unknown): v is NativeConfigurationWriteMethod => nativeConfigurationWriteMethods.includes(v as NativeConfigurationWriteMethod);
// Provider routing, credentials and host permission policy require separate authority.
export const nativeWritableConfigurationKeys = ['model', 'review_model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity',
  'model_context_window', 'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'service_tier', 'web_search', 'analytics.enabled'] as const;
const editProperties = () => ({
  keyPath: { type: 'string', enum: [...nativeWritableConfigurationKeys], title: 'Setting' },
  value: { type: [...nativeJsonTypes], title: 'Value (JSON)', description: 'A public preference value. Null removes this user override.' },
  mergeStrategy: { type: 'string', enum: ['replace', 'upsert'], title: 'Merge strategy' }
});
export function nativeConfigurationWriteInputSchema(method: NativeConfigurationWriteMethod) {
  const text = { type: ['string', 'null'], minLength: 1, maxLength: 4096 };
  const properties: Record<string, Record<string, unknown>> = method === 'skills/config/write' ? {
    path: { ...text, title: 'Skill path', description: 'Choose a workspace skill path or a name, exactly one.' },
    name: { ...text, maxLength: 192, title: 'Skill name', description: 'A name-based user configuration override.' }, enabled: { type: 'boolean', title: 'Enabled' }
  } : {
    ...(method === 'config/value/write' ? editProperties() : { edits: { type: 'array', maxItems: 16, title: 'Edits', items: { type: 'object', additionalProperties: false, properties: editProperties(), required: ['keyPath', 'value', 'mergeStrategy'] } },
      reloadUserConfig: { type: 'boolean', default: false, title: 'Reload loaded threads', description: 'The SDK hot-reloads eligible settings; session-static model defaults stay unchanged.' } }),
    expectedVersion: { ...text, maxLength: 512, title: 'Expected version', description: 'An explicit SDK version is checked for conflicts. Otherwise the companion uses its current private snapshot.' },
    filePath: { ...text, title: 'Configuration file', description: 'Only the paired runtime’s user config.toml is writable. Omit to use it.' }
  };
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'skills/config/write' ? ['enabled'] : method === 'config/value/write' ? ['keyPath', 'value', 'mergeStrategy'] : ['edits'] };
}
const text = (v: unknown, size: number) => typeof v === 'string' && !!v && v.length <= size && v.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(v);
function checkedEdit(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new NativeCommandInputError('edits', 'Use setting, value and merge strategy objects.');
  const p = nativeObject(input, Object.keys(input));
  if (Object.keys(p).some(k => !['keyPath', 'value', 'mergeStrategy'].includes(k))) throw new NativeCommandInputError('edits', 'An edit accepts only keyPath, value and mergeStrategy.');
  if (!nativeWritableConfigurationKeys.includes(p.keyPath as typeof nativeWritableConfigurationKeys[number])) throw new NativeCommandInputError('keyPath', 'Choose a reviewed public preference; provider, credential and permission settings are not writable here.');
  if (typeof p.mergeStrategy !== 'string' || !['replace', 'upsert'].includes(p.mergeStrategy)) throw new NativeCommandInputError('mergeStrategy', 'Choose replace or upsert.');
  if (!Object.hasOwn(p, 'value')) throw new NativeCommandInputError('value', 'Supply a JSON value or null to remove the override.');
  const key = String(p.keyPath), value = p.value;
  if (value !== null) {
    const accepted = key === 'analytics.enabled' ? typeof value === 'boolean'
      : ['model_context_window', 'model_auto_compact_token_limit'].includes(key) ? Number.isSafeInteger(value)
      : key === 'model_reasoning_summary' ? typeof value === 'string' && ['auto', 'concise', 'detailed', 'none'].includes(value)
      : key === 'model_verbosity' ? typeof value === 'string' && ['low', 'medium', 'high'].includes(value)
      : key === 'model_auto_compact_token_limit_scope' ? typeof value === 'string' && ['total', 'body_after_prefix'].includes(value)
      : key === 'web_search' ? typeof value === 'string' && ['disabled', 'cached', 'indexed', 'live'].includes(value)
      : text(value, key === 'model' || key === 'review_model' ? 128 : 64);
    if (!accepted) throw new NativeCommandInputError('value', 'The value does not match the selected public setting.');
  }
  return { keyPath: key, value: structuredClone(value), mergeStrategy: p.mergeStrategy as 'replace' | 'upsert' };
}
export function nativeConfigurationWriteParams(method: NativeConfigurationWriteMethod, input: unknown): Record<string, unknown> {
  if (!isNativeConfigurationWriteMethod(method) || !input || typeof input !== 'object' || Array.isArray(input)) throw new NativeCommandInputError('params', 'Use a configuration write object.');
  const p = nativeObject(input, Object.keys(input)), names = Object.keys(nativeConfigurationWriteInputSchema(method).properties);
  for (const key of Object.keys(p)) if (!names.includes(key)) throw new NativeCommandInputError(key, 'Unsupported configuration write parameter.');
  for (const key of ['filePath', 'expectedVersion', 'path', 'name']) if (p[key] != null && !text(p[key], key === 'expectedVersion' ? 512 : key === 'name' ? 192 : 4096)) throw new NativeCommandInputError(key, 'Use bounded nonempty text.');
  let result: Record<string, unknown>;
  if (method === 'skills/config/write') {
    if ((p.path != null) === (p.name != null)) throw new NativeCommandInputError('path', 'Choose exactly one of path or name.');
    if (typeof p.enabled !== 'boolean') throw new NativeCommandInputError('enabled', 'Use a boolean enabled value.');
    if (typeof p.name === 'string' && !p.name.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')) throw new NativeCommandInputError('name', 'Use a nonempty skill name.');
    result = { ...(p.path != null ? { path: p.path } : { name: (p.name as string).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '') }), enabled: p.enabled };
  } else {
    if (method === 'config/batchWrite' && (!Array.isArray(p.edits) || p.edits.length > 16)) throw new NativeCommandInputError('edits', 'Use up to sixteen setting edits.');
    if (Object.hasOwn(p, 'reloadUserConfig') && typeof p.reloadUserConfig !== 'boolean') throw new NativeCommandInputError('reloadUserConfig', 'Use a boolean reload value.');
    result = { ...(method === 'config/value/write' ? checkedEdit({ keyPath: p.keyPath, value: p.value, mergeStrategy: p.mergeStrategy }) : { edits: (p.edits as unknown[]).map((edit, index) => { try { return checkedEdit(edit); } catch (error) { if (error instanceof NativeCommandInputError) throw new NativeCommandInputError('edits', `edits[${index}]${error.field === 'edits' ? '' : '.' + error.field}: ${error.message}`); throw error; } }), reloadUserConfig: p.reloadUserConfig ?? false }),
      ...(p.filePath != null ? { filePath: p.filePath } : {}), ...(p.expectedVersion != null ? { expectedVersion: p.expectedVersion } : {}) };
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16384) throw new NativeCommandInputError('params', 'Configuration writes must fit 16 KiB.');
  return result;
}
export type NativeConfigurationMutationMethod = NativeConfigurationWriteMethod | NativeMarketplaceMethod | NativePluginInstallMethod | NativePluginShareMethod;
export type NativeConfigurationTransition = { type: 'authority'; reason: 'configuration'; requestId: string; method: NativeConfigurationMutationMethod;
  paramsHash: string; resultHash: string; beforeConfiguration: string; identity: NativeRuntimeIdentity };
export function nativeConfigurationTransition(value: unknown, before: NativeRuntimeIdentity, method: NativeConfigurationMutationMethod, requestId: string, paramsHash: string, resultHash?: string): NativeConfigurationTransition {
  const p = nativeObject(value, ['type', 'reason', 'requestId', 'method', 'paramsHash', 'resultHash', 'beforeConfiguration', 'identity']), next = nativeIdentity(p.identity);
  if (p.type !== 'authority' || p.reason !== 'configuration' || p.method !== method || !(isNativeConfigurationWriteMethod(p.method) || isNativeMarketplaceMethod(p.method) || isNativePluginInstallMethod(p.method) || isNativePluginShareMethod(p.method)) || p.requestId !== requestId
    || typeof p.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(p.requestId) || typeof p.paramsHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.paramsHash) || p.paramsHash !== paramsHash || p.beforeConfiguration !== before.configuration || typeof p.resultHash !== 'string' || !/^[a-f0-9]{64}$/.test(p.resultHash)
    || resultHash !== undefined && p.resultHash !== resultHash || !sameNativeIdentity(before, { ...next, configuration: before.configuration })) throw new Error('Unowned configuration authority transition.');
  return structuredClone({ ...p, identity: next }) as NativeConfigurationTransition;
}
/** Shared by companion and worker; never import the HTTP policy graph into the host. */
export async function nativeConfigurationWriteHash(value: unknown): Promise<string> {
  let nodes = 0;
  const canonical = (v: unknown, depth = 0): string => {
    if (++nodes > 8192 || depth > 32) throw new Error('Configuration fingerprint exceeds its bounds.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (v && typeof v === 'object' && (Reflect.ownKeys(v).some(key => typeof key === 'symbol')
      || Object.values(Object.getOwnPropertyDescriptors(v)).some(p => !Object.hasOwn(p, 'value')))) throw new Error('Invalid configuration fingerprint data.');
    if (Array.isArray(v)) return '[' + v.map(x => canonical(x, depth + 1)).join(',') + ']';
    if (v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))
      return '{' + Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : 1).map(([key, x]) => JSON.stringify(key) + ':' + canonical(x, depth + 1)).join(',') + '}';
    throw new Error('Invalid configuration fingerprint data.');
  };
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
}
