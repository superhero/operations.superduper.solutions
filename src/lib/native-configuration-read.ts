// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError, nativeCommandId } from './native-command.ts';

export const nativeConfigurationReadMethods = ['config/read', 'configRequirements/read', 'experimentalFeature/list', 'skills/list'] as const;
export type NativeConfigurationReadMethod = typeof nativeConfigurationReadMethods[number];
export const isNativeConfigurationReadMethod = (value: unknown): value is NativeConfigurationReadMethod => nativeConfigurationReadMethods.includes(value as NativeConfigurationReadMethod);
export function nativeConfigurationReadInputSchema(method: NativeConfigurationReadMethod) {
  const path = { type: 'string', minLength: 1, maxLength: 4096 };
  const properties: Record<string, Record<string, unknown>> = method === 'config/read' ? {
    cwd: { ...path, type: ['string', 'null'], title: 'Working directory', description: 'Optional directory inside the paired workspace for project configuration layers.' },
    includeLayers: { type: 'boolean', default: false, title: 'Include public layers', description: 'Layer values use the same public configuration projection; credentials and unreviewed settings are withheld.' }
  } : method === 'experimentalFeature/list' ? {
    cursor: { type: ['string', 'null'], maxLength: 2048, title: 'Cursor' }, limit: { type: ['integer', 'null'], minimum: 0, maximum: 64, default: 8, title: 'Page size' },
    threadId: { type: ['string', 'null'], minLength: 1, maxLength: 192, pattern: '^[A-Za-z0-9_-]+$', title: 'Thread ID', description: 'Optional thread owned and loaded by this same live workflow session.' }
  } : method === 'skills/list' ? {
    cwds: { type: 'array', maxItems: 8, default: [], items: path, title: 'Working directories', description: 'Directories inside the paired workspace; an empty list uses the session directory.' },
    forceReload: { type: 'boolean', default: false, title: 'Reload skills' }
  } : {};
  return { type: 'object', additionalProperties: false as const, properties, required: [] as string[] };
}
export function nativeConfigurationReadParams(method: NativeConfigurationReadMethod, value: unknown): Record<string, unknown> {
  if (!isNativeConfigurationReadMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) throw new NativeCommandInputError('params', 'Supply configuration parameters as an object.');
  const p = nativeObject(value, Object.keys(value)), allowed = nativeConfigurationReadInputSchema(method).properties;
  for (const key of Object.keys(p)) if (!Object.hasOwn(allowed, key)) throw new NativeCommandInputError(key, 'This parameter is not supported by the selected configuration read.');
  const text = (v: unknown, size: number) => typeof v === 'string' && v.isWellFormed() && v.length <= size && !/[\u0000-\u001f\u007f]/.test(v);
  if (p.cwd != null && (!text(p.cwd, 4096) || !p.cwd)) throw new NativeCommandInputError('cwd', 'Use a bounded directory inside the paired workspace.');
  if (p.cursor != null && !text(p.cursor, 2048)) throw new NativeCommandInputError('cursor', 'Use the bounded cursor returned by the previous page.');
  if (p.threadId != null && !nativeCommandId(p.threadId)) throw new NativeCommandInputError('threadId', 'Use a thread owned and loaded by this paired workflow.');
  if (p.limit != null && (!Number.isSafeInteger(p.limit) || Number(p.limit) < 0 || Number(p.limit) > 64)) throw new NativeCommandInputError('limit', 'Page size must be between 0 and 64.');
  for (const key of ['includeLayers', 'forceReload']) if (Object.hasOwn(p, key) && typeof p[key] !== 'boolean') throw new NativeCommandInputError(key, 'Use a boolean value.');
  if (p.cwds !== undefined && (!Array.isArray(p.cwds) || p.cwds.length > 8 || p.cwds.some(path => !text(path, 4096) || !path))) throw new NativeCommandInputError('cwds', 'Use at most eight nonempty workspace directories.');
  const result = structuredClone(p);
  if (method === 'config/read') result.includeLayers ??= false;
  if (method === 'experimentalFeature/list') result.limit ??= 8;
  if (method === 'skills/list') { result.cwds ??= []; result.forceReload ??= false; }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 16384) throw new NativeCommandInputError('params', 'Configuration parameters must fit 16 KiB.');
  return result;
}
// ApiConfig flattens provider/MCP/desktop data. Only these reviewed public
// preferences and policy fields are released; the original wire model remains.
export const nativePublicConfigurationFields = ['model', 'model_provider', 'review_model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity',
  'model_context_window', 'model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'service_tier', 'approval_policy', 'approvals_reviewer',
  'sandbox_mode', 'sandbox_workspace_write', 'web_search', 'analytics'] as const;
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
export function nativeConfigurationReadResultSchema(document: ObjectValue) {
  const definitions = object(document.definitions) && document.definitions.v2;
  if (!object(definitions) || !object(definitions.Config) || !object(definitions.Config.properties) || !object(definitions.ConfigReadResponse)
    || !object(definitions.ConfigReadResponse.properties) || !object(definitions.ConfigLayer) || !object(definitions.ConfigLayer.properties)) throw new Error('Public configuration declarations require requalification.');
  const properties = definitions.Config.properties;
  const config = { type: 'object', additionalProperties: false, properties: Object.fromEntries(nativePublicConfigurationFields.map(key => {
    const value = properties[key]; if (!object(value)) throw new Error('Public configuration field is missing.'); return [key, structuredClone(value)];
  })) };
  const layer = { ...structuredClone(definitions.ConfigLayer), additionalProperties: false, properties: { ...structuredClone(definitions.ConfigLayer.properties), config } };
  return { ...structuredClone(definitions.ConfigReadResponse), additionalProperties: false,
    properties: { ...structuredClone(definitions.ConfigReadResponse.properties), config, layers: { type: ['array', 'null'], items: layer } } };
}
export function publicNativeConfigurationResult(value: unknown): ObjectValue {
  if (!object(value) || !object(value.config) || !object(value.origins)) throw new Error('Invalid native configuration result.');
  const config = (input: unknown) => {
    if (!object(input)) throw new Error('Invalid configuration layer.');
    return Object.fromEntries(nativePublicConfigurationFields.filter(key => Object.hasOwn(input, key)).map(key => [key, structuredClone(input[key])]));
  };
  const result: ObjectValue = { config: config(value.config), origins: Object.fromEntries(Object.entries(value.origins)
    .filter(([key]) => nativePublicConfigurationFields.includes(key.split(/[.[]/, 1)[0] as typeof nativePublicConfigurationFields[number]))) };
  if (value.layers !== undefined) {
    if (value.layers !== null && !Array.isArray(value.layers)) throw new Error('Invalid native configuration layers.');
    result.layers = value.layers === null ? null : value.layers.map(layer => {
      if (!object(layer)) throw new Error('Invalid native configuration layer.');
      return { ...Object.fromEntries(['name', 'version', 'disabledReason'].filter(key => Object.hasOwn(layer, key)).map(key => [key, structuredClone(layer[key])])), config: config(layer.config) };
    });
  }
  return result;
}
