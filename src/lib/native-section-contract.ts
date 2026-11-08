// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, isNativeSectionMethod, type NativeSectionMethod } from './native-runtime-contract.ts';

export const nativeSectionLimits = { name: 200, id: 192, appearanceBytes: 64, cursor: 2048, page: 64 } as const;
export class NativeSectionInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) { super(message); this.field = field; }
}
const invalid = (field: string, message: string): never => { throw new NativeSectionInputError(field, message); };
const text = (v: unknown, max: number, nonempty = false): v is string => typeof v === 'string' && v.isWellFormed()
  && [...v].length <= max && !/[\u0000-\u001f\u007f]/.test(v) && (!nonempty || !!v.trim());
export function nativeSectionInputSchema(method: NativeSectionMethod) {
  const nullableAppearanceText = { type: ['string', 'null'], maxLength: nativeSectionLimits.appearanceBytes };
  const appearance = { type: ['object', 'null'], title: 'Appearance', description: 'Omit to preserve appearance on updates; null clears it. Icon and color allow up to 64 UTF-8 bytes each.',
    additionalProperties: false, properties: { icon: nullableAppearanceText, color: nullableAppearanceText } };
  const properties: Record<string, Record<string, unknown>> = method === 'threadSection/list' ? {
    cursor: { type: ['string', 'null'], maxLength: nativeSectionLimits.cursor, title: 'Cursor' },
    limit: { type: ['integer', 'null'], minimum: 0, maximum: nativeSectionLimits.page, default: 8, title: 'Page size' }
  } : method === 'threadSection/delete' ? { sectionId: { type: 'string', minLength: 1, maxLength: nativeSectionLimits.id, title: 'Section ID' } }
    : { name: { type: 'string', minLength: 1, maxLength: nativeSectionLimits.name, title: 'Section name' }, appearance,
      ...(method === 'threadSection/update' ? { sectionId: { type: 'string', minLength: 1, maxLength: nativeSectionLimits.id, title: 'Section ID' } } : {}) };
  return { type: 'object', additionalProperties: false as const, properties,
    required: method === 'threadSection/list' ? [] : method === 'threadSection/create' ? ['name'] : method === 'threadSection/update' ? ['sectionId', 'name'] : ['sectionId'] };
}
export function nativeSectionParams(method: NativeSectionMethod, value: unknown): Record<string, unknown> {
  if (!isNativeSectionMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) return invalid('params', 'Invalid native section inputs.');
  const item = nativeObject(value, Object.keys(value)), schema = nativeSectionInputSchema(method);
  const bad = Object.keys(item).find(key => !Object.hasOwn(schema.properties, key)) ?? schema.required.find(key => !Object.hasOwn(item, key));
  if (bad) return invalid(bad, 'Unsupported or missing native section field.');
  if (Object.hasOwn(item, 'name') && !text(item.name, nativeSectionLimits.name, true)) return invalid('name', 'Section name must contain bounded public text.');
  if (Object.hasOwn(item, 'sectionId') && !text(item.sectionId, nativeSectionLimits.id, true)) return invalid('sectionId', 'Section ID must identify an existing section in this runtime.');
  if (Object.hasOwn(item, 'cursor') && item.cursor !== null && !text(item.cursor, nativeSectionLimits.cursor)) return invalid('cursor', 'Invalid section cursor.');
  if (Object.hasOwn(item, 'limit') && item.limit !== null && (!Number.isSafeInteger(item.limit) || (item.limit as number) < 0 || (item.limit as number) > nativeSectionLimits.page)) return invalid('limit', 'Invalid section page size.');
  if (Object.hasOwn(item, 'appearance') && item.appearance !== null) {
    const raw = item.appearance;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('appearance', 'Invalid section appearance.');
    const fields = nativeObject(raw, Object.keys(raw));
    for (const [key, value] of Object.entries(fields)) if (!['icon', 'color'].includes(key) || value !== null
      && (!text(value, nativeSectionLimits.appearanceBytes) || new TextEncoder().encode(value).byteLength > nativeSectionLimits.appearanceBytes)) return invalid('appearance', 'Section appearance requires icon and color values of at most 64 UTF-8 bytes each.');
  }
  const params = structuredClone(item); if (method === 'threadSection/list') params.limit ??= 8; return params;
}
