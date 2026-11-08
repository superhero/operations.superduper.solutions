// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeIdentity, sameNativeIdentity, nativeRuntimeLimits, type NativeRuntimeIdentity } from './native-runtime-contract.ts';
import { NativeCommandInputError, nativeCommandId } from './native-command.ts';

export const nativeMigrationMethods = ['externalAgentConfig/detect', 'externalAgentConfig/import', 'externalAgentConfig/import/readHistories', 'externalAgentConfig/import/recordHistory'] as const;
export type NativeMigrationMethod = typeof nativeMigrationMethods[number];
export const nativeMigrationItemTypes = ['AGENTS_MD', 'CONFIG', 'SKILLS', 'PLUGINS', 'MCP_SERVER_CONFIG', 'SUBAGENTS', 'HOOKS', 'COMMANDS', 'MEMORY', 'SESSIONS'] as const;
export type NativeMigrationItemType = typeof nativeMigrationItemTypes[number];
export const nativeMigrationProgress = 'externalAgentConfig/import/progress';
export const nativeMigrationCompleted = 'externalAgentConfig/import/completed';
export const isNativeMigrationMethod = (value: unknown): value is NativeMigrationMethod => nativeMigrationMethods.includes(value as NativeMigrationMethod);

type Schema = { type: string | string[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false; items?: Schema;
  enum?: readonly string[]; minLength?: number; maxLength?: number; pattern?: string; maxItems?: number; minimum?: number; maximum?: number; title?: string; description?: string };
const string = (maxLength = 4096, nullable = false, minLength = 0, multiline = false): Schema => ({ type: nullable ? ['string', 'null'] : 'string', minLength, maxLength,
  pattern: multiline ? '^[^\\u0000]*$' : '^[^\\u0000-\\u001f\\u007f]*$' });
const array = (items: Schema, maxItems = 128): Schema => ({ type: 'array', items, maxItems });
const object = (properties: Record<string, Schema>, required: string[] = []) => ({ type: 'object', additionalProperties: false as const, properties, required });
const itemType = (): Schema => ({ type: 'string', enum: [...nativeMigrationItemTypes] });
const named = () => object({ name: string(192, false, 1) }, ['name']);
const details = () => object({
  commands: array(named(), 64), hooks: array(named(), 64), mcpServers: array(named(), 64), skills: array(named(), 64), subagents: array(named(), 64),
  memory: array(string()), plugins: array(object({ marketplaceName: string(192, false, 1), pluginNames: array(string(256, false, 1), 64) }, ['marketplaceName', 'pluginNames']), 64),
  sessions: array(object({ cwd: string(), path: string(4096, false, 1), title: string(2048, true, 0, true) }, ['cwd', 'path']))
});
const migrationItem = () => object({ itemType: itemType(), description: string(2048, false, 0, true), cwd: string(4096, true),
  details: { ...details(), type: ['object', 'null'] } }, ['itemType', 'description']);
const success = () => object({ itemType: itemType(), cwd: string(4096, true), source: string(4096, true), target: string(4096, true), title: string(2048, true, 0, true) }, ['itemType']);
const failure = () => object({ itemType: itemType(), cwd: string(4096, true), source: string(4096, true), errorType: string(192, true), subErrorType: string(192, true),
  failureStage: string(192, false, 1), message: string(2048, false, 0, true) }, ['itemType', 'failureStage', 'message']);
const typeResult = () => object({ itemType: itemType(), successes: array(success()), failures: array(failure()) }, ['itemType', 'successes', 'failures']);

/** Bounded input profile retaining every pinned migration method and item kind. */
export function nativeMigrationInputSchema(method: NativeMigrationMethod) {
  const attribution = { migrationSource: { ...string(192, true), title: 'Migration source', description: 'Missing or unknown selectors use the SDK default source.' },
    source: { ...string(192, true), title: 'Initiating product', description: 'Attribution only; this field does not select the migration source.' } };
  if (method === 'externalAgentConfig/detect') return object({ ...attribution,
    includeHome: { type: 'boolean', title: 'Include runtime home' }, cwds: { ...array(string(4096, false, 1), 8), type: ['array', 'null'], title: 'Workspace directories' },
    maxSessions: { type: ['integer', 'null'], minimum: 0, maximum: 128, title: 'Maximum sessions' },
    maxSessionAgeDays: { type: ['integer', 'null'], minimum: 0, maximum: 3650, title: 'Maximum session age (days)' }
  });
  if (method === 'externalAgentConfig/import') return object({ ...attribution,
    providerId: { ...string(192, true), title: 'Provider attribution', description: 'Opaque display/history attribution, separate from migration source.' },
    migrationItems: { ...array(migrationItem(), 16), title: 'Migration items', description: 'Detected item metadata, including the selected source and repository scope.' }
  }, ['migrationItems']);
  if (method === 'externalAgentConfig/import/recordHistory') return object({ providerId: { ...string(192), title: 'Provider attribution' },
    itemTypeResults: { ...array(typeResult(), 16), title: 'Completed item results', description: 'An external completion record; this does not import files or grant thread authority.' }
  }, ['providerId', 'itemTypeResults']);
  return object({});
}
const invalid = (path: string, message: string): never => {
  throw new NativeCommandInputError(path.split(/[.\[]/)[0] || 'params', (path ? path + ': ' : '') + message);
};
function validate(value: unknown, schema: Schema, path = ''): void {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (value === null && types.includes('null')) return;
  const type = types.find(type => type !== 'null');
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(path, 'Use an object.');
    let item: Record<string, unknown>;
    try { item = nativeObject(value, Object.keys(value)); } catch { return invalid(path, 'Use plain data properties.'); }
    for (const key of Object.keys(item)) {
      const next = path ? path + '.' + key : key;
      if (!Object.hasOwn(schema.properties!, key)) invalid(next, 'This parameter is not supported.');
      validate(item[key], schema.properties![key]!, next);
    }
    for (const key of schema.required ?? []) if (!Object.hasOwn(item, key)) invalid(path ? path + '.' + key : key, 'This field is required.');
  } else if (type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems!) return invalid(path, 'Use an array with at most ' + schema.maxItems + ' entries.');
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !Object.hasOwn(field, 'value'))) invalid(path, 'Use a plain dense array.');
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) invalid(path + '[' + index + ']', 'Every array position needs a value.');
      validate(value[index], schema.items!, path + '[' + index + ']');
    }
  } else if (type === 'string') {
    if (typeof value !== 'string' || !value.isWellFormed() || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 4096)
      || schema.pattern && !new RegExp(schema.pattern, 'u').test(value) || schema.enum && !schema.enum.includes(value)) invalid(path, 'Use text matching the declared length, characters and choices.');
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') invalid(path, 'Use a boolean value.');
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value) || Number(value) < schema.minimum! || Number(value) > schema.maximum!) invalid(path, 'Use an integer within the declared limits.');
  } else invalid(path, 'Unsupported migration value.');
}
function consistentResults(results: Record<string, unknown>[], field: string): void {
  results.forEach((result, index) => {
    for (const key of ['successes', 'failures']) (result[key] as Record<string, unknown>[]).forEach((entry, inner) => {
      if (entry.itemType !== result.itemType) invalid(field + '[' + index + '].' + key + '[' + inner + '].itemType', 'Match the enclosing item type.');
    });
  });
}
export function nativeMigrationParams(method: NativeMigrationMethod, input: unknown): Record<string, unknown> {
  if (!isNativeMigrationMethod(method)) invalid('method', 'Choose a pinned migration method.');
  validate(input, nativeMigrationInputSchema(method));
  const result = structuredClone(input) as Record<string, unknown>;
  if (method === 'externalAgentConfig/detect' && !Object.hasOwn(result, 'includeHome')) result.includeHome = false;
  if (method === 'externalAgentConfig/import') (result.migrationItems as Record<string, unknown>[]).forEach((item, index) => {
    if (item.itemType === 'MEMORY' && !((item.details as Record<string, unknown> | null | undefined)?.memory as unknown[] | undefined)?.length)
      invalid('migrationItems[' + index + '].details.memory', 'Memory import requires at least one selected memory.');
  });
  if (method === 'externalAgentConfig/import/recordHistory') consistentResults(result.itemTypeResults as Record<string, unknown>[], 'itemTypeResults');
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > nativeRuntimeLimits.frame - 512) invalid('params', 'Migration inputs must leave room for their authenticated 64 KiB frame.');
  return result;
}

/** Native metadata is validated before the private worker projects display fields. */
export function nativeMigrationResult(method: NativeMigrationMethod, value: unknown): Record<string, unknown> {
  const connector = (imported = false) => object({ name: string(4096, false, 1),
    sessionCount: { type: 'integer', minimum: 0, maximum: 0xffffffff },
    source: { type: 'string', enum: imported ? ['remoteMcpServersConfig'] : ['remoteMcpServersConfig', 'sessionToolUse'] }
  }, ['name', 'sessionCount', 'source']);
  let schema: Schema;
  if (method === 'externalAgentConfig/detect') {
    const item = migrationItem();
    const expand = (node: Schema): void => {
      if (node.items) { node.maxItems = 4096; expand(node.items); }
      for (const child of Object.values(node.properties ?? {})) expand(child);
    };
    expand(item); schema = object({ items: array(item, 128), connectors: array(connector(), 4096) }, ['items']);
  } else if (method === 'externalAgentConfig/import/readHistories') schema = object({ data: array(object({
    importId: string(192, false, 1), providerId: string(192, true), completedAtMs: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    successes: array(success(), 4096), failures: array(failure(), 4096)
  }, ['importId', 'completedAtMs', 'successes', 'failures']), 4096), connectors: array(connector(true), 4096) }, ['data', 'connectors']);
  else if (method === 'externalAgentConfig/import' || method === 'externalAgentConfig/import/recordHistory') schema = object({ importId: string(192, false, 1) }, ['importId']);
  else return invalid('method', 'Choose a pinned migration method.');
  validate(value, schema);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > nativeRuntimeLimits.frame) invalid('result', 'Migration metadata exceeds its frame limit.');
  const result = structuredClone(value) as Record<string, unknown>;
  if (Object.hasOwn(result, 'importId') && !nativeCommandId(result.importId)) invalid('importId', 'Use an owned import identifier.');
  return result;
}

export type NativeMigrationTransition = { type: 'authority'; reason: 'migration'; requestId: string; method: 'externalAgentConfig/import';
  paramsHash: string; resultHash: string; effectHash: string; beforeConfiguration: string; identity: NativeRuntimeIdentity; privateValues: string[] };
/** Private companion/worker receipt. Never project its credential values to UI events. */
export function nativeMigrationTransition(value: unknown, before: NativeRuntimeIdentity, requestId: string, paramsHash: string, resultHash?: string): NativeMigrationTransition {
  const p = nativeObject(value, ['type', 'reason', 'requestId', 'method', 'paramsHash', 'resultHash', 'effectHash', 'beforeConfiguration', 'identity', 'privateValues']);
  const next = nativeIdentity(p.identity), digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (p.type !== 'authority' || p.reason !== 'migration' || p.method !== 'externalAgentConfig/import' || p.requestId !== requestId || !nativeCommandId(requestId)
    || !digest(p.paramsHash) || p.paramsHash !== paramsHash || !digest(p.resultHash) || resultHash !== undefined && p.resultHash !== resultHash || !digest(p.effectHash)
    || p.beforeConfiguration !== before.configuration || !sameNativeIdentity(before, { ...next, configuration: before.configuration })
    || !Array.isArray(p.privateValues) || Object.getPrototypeOf(p.privateValues) !== Array.prototype
    || Reflect.ownKeys(p.privateValues).length !== p.privateValues.length + 1 || Object.values(Object.getOwnPropertyDescriptors(p.privateValues)).some(field => !Object.hasOwn(field, 'value'))
    || p.privateValues.length > 256 || p.privateValues.some(value => typeof value !== 'string' || !value || !value.isWellFormed() || value.length > 8192)
    || new TextEncoder().encode(JSON.stringify(p.privateValues)).byteLength > 32768) throw new Error('Unowned migration authority transition.');
  return structuredClone({ ...p, identity: next }) as NativeMigrationTransition;
}

export type NativeMigrationCompletion = { importId: string; itemTypeResults: { itemType: NativeMigrationItemType; successes: Record<string, unknown>[]; failures: Record<string, unknown>[] }[] };
/** Correlation only. Host effect/history verification must precede publication. */
export class NativeMigrationCorrelation {
  private id: string | undefined;
  private done = false;
  private readonly requested: Set<NativeMigrationItemType>;
  private readonly early: { method: string; params: NativeMigrationCompletion }[] = [];
  constructor(input: unknown) {
    const params = nativeMigrationParams('externalAgentConfig/import', input);
    this.requested = new Set((params.migrationItems as { itemType: NativeMigrationItemType }[]).map(item => item.itemType));
  }
  private reject(): never { this.done = true; this.early.length = 0; throw new Error('Unowned or invalid migration lifecycle.'); }
  private result(method: string, input: unknown): NativeMigrationCompletion {
    try {
      if (method !== nativeMigrationProgress && method !== nativeMigrationCompleted || !this.requested.size) return this.reject();
      validate(input, object({ importId: string(192, false, 1), itemTypeResults: array(typeResult(), 16) }, ['importId', 'itemTypeResults']));
      const p = input as NativeMigrationCompletion;
      if (!nativeCommandId(p.importId) || this.id && p.importId !== this.id) return this.reject();
      consistentResults(p.itemTypeResults, 'itemTypeResults');
      const kinds = new Set(p.itemTypeResults.map(item => item.itemType));
      if (kinds.size !== p.itemTypeResults.length || [...kinds].some(kind => !this.requested.has(kind))
        || method === nativeMigrationCompleted && kinds.size !== this.requested.size) return this.reject();
      return structuredClone(p);
    } catch { return this.reject(); }
  }
  acknowledge(input: unknown): NativeMigrationCompletion | undefined {
    if (this.done || this.id) return this.reject();
    let id: unknown;
    try { id = nativeObject(input, ['importId']).importId; } catch { return this.reject(); }
    if (!nativeCommandId(id) || this.early.some(frame => frame.params.importId !== id)) return this.reject();
    this.id = id;
    if (!this.requested.size) { this.done = true; return { importId: id, itemTypeResults: [] }; }
    const completed = this.early.find(frame => frame.method === nativeMigrationCompleted); this.early.length = 0;
    if (completed) { this.done = true; return completed.params; }
    return undefined;
  }
  notification(method: string, input: unknown): NativeMigrationCompletion | undefined {
    if (this.done) return this.reject();
    const result = this.result(method, input);
    if (!this.id) {
      if (this.early.length >= 32 || this.early.some(frame => frame.method === nativeMigrationCompleted || frame.params.importId !== result.importId)) return this.reject();
      this.early.push({ method, params: result }); return undefined;
    }
    if (method === nativeMigrationCompleted) { this.done = true; return result; }
    return undefined;
  }
  close(): void { this.done = true; this.early.length = 0; }
}
