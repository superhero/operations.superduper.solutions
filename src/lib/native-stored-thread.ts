// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

export const nativeStoredThreadReadResultTypes = {
  'thread/list': 'ThreadListResponse', 'thread/loaded/list': 'ThreadLoadedListResponse', 'thread/read': 'ThreadReadResponse',
  'thread/turns/list': 'ThreadTurnsListResponse', 'thread/items/list': 'ThreadItemsListResponse', 'thread/goal/get': 'ThreadGoalGetResponse',
  'thread/attachment/list': 'ThreadAttachmentListResponse', 'thread/attachmentOwner/list': 'ThreadAttachmentOwnerListResponse'
} as const;
export type NativeStoredThreadReadMethod = keyof typeof nativeStoredThreadReadResultTypes;
export const nativeStoredThreadReadMethods = Object.keys(nativeStoredThreadReadResultTypes) as NativeStoredThreadReadMethod[];
export const isNativeStoredThreadReadMethod = (method: unknown): method is NativeStoredThreadReadMethod => typeof method === 'string' && Object.hasOwn(nativeStoredThreadReadResultTypes, method);
const sources = ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'];
const text = (v: unknown, max: number, nonempty = false, multiline = false): v is string => typeof v === 'string' && v.isWellFormed()
  && v.length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v) && (!nonempty || !!v.trim());
const invalid = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
type Property = Record<string, unknown>;
export function nativeStoredThreadReadInputSchema(method: NativeStoredThreadReadMethod) {
  if (!isNativeStoredThreadReadMethod(method)) return invalid('method', 'Unsupported stored-thread read.');
  const nullableText = (max = 2048): Property => ({ type: ['string', 'null'], maxLength: max });
  const enumeration = (values: string[]): Property => ({ type: ['string', 'null'], enum: [...values, null] });
  const texts = (maxItems: number, max = 192): Property => ({ type: ['array', 'null'], maxItems, items: { type: 'string', minLength: 1, maxLength: max } });
  const page: Record<string, Property> = { cursor: { ...nullableText(), title: 'Cursor' },
    limit: { type: ['integer', 'null'], minimum: 0, maximum: 64, default: 8, title: 'Page size' } };
  const properties: Record<string, Property> = method === 'thread/list' ? { ...page,
    archived: { type: ['boolean', 'null'] }, cwd: { anyOf: [{ type: 'string', maxLength: 4096 }, texts(8, 4096)], description: 'Workspace directory or directory list as JSON; omit for its root.' },
    excludedThreadIds: texts(100), modelProviders: texts(32, 512), originators: texts(0, 512), searchTerm: nullableText(4096),
    sectionId: nullableText(192), sortDirection: enumeration(['asc', 'desc']), sortKey: enumeration(['created_at', 'updated_at', 'recency_at', 'section_position']),
    sourceKinds: { ...texts(10), items: { type: 'string', enum: sources } }, useStateDbOnly: { type: 'boolean' }
  } : method === 'thread/loaded/list' ? page : method === 'thread/attachmentOwner/list' ? { ...page,
    attachmentType: { type: 'string', minLength: 1, maxLength: 128, title: 'Attachment type' }, identityKey: { type: 'string', minLength: 1, maxLength: 1024, title: 'Identity key' }, archived: { type: ['boolean', 'null'] }
  } : { threadId: { type: 'string', minLength: 1, maxLength: 192, title: 'Owned thread ID' },
    ...(method === 'thread/read' ? { includeTurns: { type: 'boolean', default: false, title: 'Include turns', description: 'Read full history; prefer paginated turns/items for large threads.' } }
      : method === 'thread/goal/get' ? {} : { ...page,
        ...(method === 'thread/turns/list' ? { itemsView: enumeration(['notLoaded', 'summary', 'full']), sortDirection: enumeration(['asc', 'desc']) }
          : method === 'thread/items/list' ? { turnId: nullableText(192), sortDirection: enumeration(['asc', 'desc']),
            cursor: { description: 'Returned cursor or item anchor as JSON.', anyOf: [nullableText(), { type: 'object', additionalProperties: false, properties: {
              type: { type: 'string', enum: ['item'] }, itemId: { type: 'string', minLength: 1, maxLength: 192 }
            }, required: ['type', 'itemId'] }] } } : {}) }) };
  return { type: 'object', additionalProperties: false as const, properties,
    required: method === 'thread/list' || method === 'thread/loaded/list' ? [] : method === 'thread/attachmentOwner/list' ? ['attachmentType', 'identityKey'] : ['threadId'] };
}
export function nativeBoundedThreadParams(schema: Property, value: unknown): Record<string, unknown> {
  function check(value: unknown, spec: Property, field: string, depth = 0): void {
    if (depth > 8) return invalid(field, 'Input nesting exceeds eight levels.');
    if (Array.isArray(spec.anyOf)) {
      for (const branch of spec.anyOf) {
        try { check(value, branch, field, depth + 1); return; }
        catch (error) { if (!(error instanceof NativeCommandInputError)) throw error; }
      }
      return invalid(field, 'Use the declared JSON shape and limits.');
    }
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isSafeInteger(value) ? 'integer' : typeof value;
    if (!(Array.isArray(spec.type) ? spec.type : [spec.type]).includes(type)) return invalid(field, 'Use the declared field type.');
    if (Array.isArray(spec.enum) && !spec.enum.includes(value)) return invalid(field, 'Choose a supported value.');
    if (typeof value === 'string' && !text(value, spec.maxLength as number ?? 2048, !!spec.minLength, spec['x-native-multiline'] === true)) return invalid(field, `Use valid text up to ${spec.maxLength ?? 2048} characters.`);
    if (typeof value === 'number' && (value < (spec.minimum as number) || value > (spec.maximum as number))) return invalid(field, `Use a whole number from ${spec.minimum} to ${spec.maximum}.`);
    if (Array.isArray(value)) {
      if (value.length > (spec.maxItems as number) || Reflect.ownKeys(value).length !== value.length + 1
        || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !('value' in item))) return invalid(field, `Use a dense list with at most ${spec.maxItems} entries.`);
      for (const item of value) check(item, spec.items as Property, field, depth + 1);
    } else if (value && typeof value === 'object') {
      let object: Record<string, unknown>;
      try { object = nativeObject(value, Object.keys(value)); } catch { return invalid(field, 'Use an object with plain own fields.'); }
      const properties = spec.properties as Record<string, Property>, required = spec.required as string[] ?? [];
      const bad = Object.keys(object).find(key => !Object.hasOwn(properties, key)) ?? required.find(key => !Object.hasOwn(object, key));
      if (bad) return invalid(field === 'params' ? bad : field, 'Unsupported or missing field.');
      for (const [key, item] of Object.entries(object)) check(item, properties[key]!, field === 'params' ? key : field, depth + 1);
    }
  }
  check(value, schema, 'params');
  return structuredClone(value) as Record<string, unknown>;
}
export function nativeStoredThreadReadParams(method: NativeStoredThreadReadMethod, value: unknown): Record<string, unknown> {
  const schema = nativeStoredThreadReadInputSchema(method), p = nativeBoundedThreadParams(schema, value);
  if (method === 'thread/items/list' && p.cursor && typeof p.cursor === 'object' && !text(p.turnId, 192, true)) return invalid('turnId', 'Item anchors require a visible turn ID.');
  const params = structuredClone(p);
  if (Object.hasOwn(schema.properties, 'limit')) params.limit ??= 8;
  if (method === 'thread/read') params.includeTurns ??= false;
  if (new TextEncoder().encode(JSON.stringify(params)).byteLength > 16384) return invalid('params', 'Read parameters must fit 16 KiB.');
  return params;
}

/** The pinned Rust publisher includes experimental read receipts omitted by its schema exporter. */
export function nativeStoredThreadReadResultSchema(method: NativeStoredThreadReadMethod, document: Record<string, unknown>) {
  const definitions = document.definitions as { v2?: Record<string, unknown> } | undefined;
  const raw = definitions?.v2?.[nativeStoredThreadReadResultTypes[method]];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Stored-thread result schema is unavailable.');
  const result = structuredClone(raw) as { properties: Record<string, unknown> };
  if (method === 'thread/read' || method === 'thread/list') {
    const thread = nativeStoredThreadMetadataSchema(document);
    if (method === 'thread/read') result.properties.thread = thread;
    else result.properties.data = { type: 'array', items: thread };
  }
  if (method === 'thread/read') result.properties.readState = { anyOf: [{ $ref: '#/definitions/v2/ThreadReadState' }, { type: 'null' }] };
  if (method === 'thread/list') result.properties.readStates = { type: ['object', 'null'], additionalProperties: { $ref: '#/definitions/v2/ThreadReadState' } };
  return result;
}

export function nativeStoredThreadMetadataSchema(document: Record<string, unknown>) {
  const definitions = document.definitions as { v2?: Record<string, unknown> } | undefined;
  const thread = structuredClone(definitions?.v2?.Thread) as { properties?: Record<string, unknown> } | undefined;
  if (!thread?.properties) throw new Error('Stored-thread metadata schema is unavailable.');
  thread.properties.environments = { type: ['array', 'null'], items: { $ref: '#/definitions/v2/ThreadEnvironment' } };
  thread.properties.extra = { anyOf: [{ $ref: '#/definitions/v2/ThreadExtra' }, { type: 'null' }] };
  thread.properties.canAcceptDirectInput = { type: ['boolean', 'null'] };
  thread.properties.daybreakEnabled = { type: ['boolean', 'null'] };
  return thread;
}
