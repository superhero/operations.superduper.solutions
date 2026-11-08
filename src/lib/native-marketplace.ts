// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';
import { NativeCommandInputError } from './native-command.ts';

/** Native contracts under qualification; enrollment is a separate verified gate. */
export const nativeMarketplaceMethods = ['marketplace/add', 'marketplace/remove', 'marketplace/upgrade'] as const;
export type NativeMarketplaceMethod = typeof nativeMarketplaceMethods[number];
export const isNativeMarketplaceMethod = (value: unknown): value is NativeMarketplaceMethod => nativeMarketplaceMethods.includes(value as NativeMarketplaceMethod);
export const nativeMarketplaceResultTypes: Record<NativeMarketplaceMethod, string> = {
  'marketplace/add': 'MarketplaceAddResponse', 'marketplace/remove': 'MarketplaceRemoveResponse', 'marketplace/upgrade': 'MarketplaceUpgradeResponse'
};
export function nativeMarketplaceInputSchema(method: NativeMarketplaceMethod) {
  const text = (title: string, maxLength = 512): Record<string, unknown> => ({ type: 'string', minLength: 1, maxLength, title });
  const properties: Record<string, Record<string, unknown>> = method === 'marketplace/add' ? {
    source: { ...text('Marketplace source', 4096), description: 'A workspace directory, Git URL or owner/repository. Adding registers a local source or clones a Git source into the paired runtime.' },
    refName: { ...text('Git reference'), type: ['string', 'null'] },
    sparsePaths: { type: ['array', 'null'], maxItems: 32, title: 'Sparse directories', items: text('Directory', 1024) }
  } : { marketplaceName: { ...text('Marketplace name', 128), ...(method === 'marketplace/upgrade' ? { type: ['string', 'null'], description: 'Omit to upgrade all configured Git marketplaces.' } : {}) } };
  return { type: 'object', additionalProperties: false as const, properties,
    required: method === 'marketplace/add' ? ['source'] : method === 'marketplace/remove' ? ['marketplaceName'] : [] };
}
export function nativeMarketplaceParams(method: NativeMarketplaceMethod, value: unknown): Record<string, unknown> {
  const bad = (field: string, message: string): never => { throw new NativeCommandInputError(field, message); };
  if (!isNativeMarketplaceMethod(method) || !value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Supply marketplace parameters as an object.');
  const p = nativeObject(value, Object.keys(value)), schema = nativeMarketplaceInputSchema(method);
  for (const key of Object.keys(p)) if (!Object.hasOwn(schema.properties, key)) bad(key, 'This parameter is not supported by the selected marketplace method.');
  const text = (key: string, v: unknown, maximum: number) => {
    if (typeof v !== 'string' || !v.trim() || !v.isWellFormed() || v.length > maximum || /[\u0000-\u001f\u007f]/.test(v)) bad(key, 'Use bounded, nonempty text without control characters.');
  };
  for (const key of schema.required) if (!Object.hasOwn(p, key) || p[key] === null) bad(key, 'This marketplace parameter is required.');
  if (Object.hasOwn(p, 'source')) text('source', p.source, 4096);
  if (p.refName != null) text('refName', p.refName, 512);
  if (p.marketplaceName != null) text('marketplaceName', p.marketplaceName, 128);
  if (p.sparsePaths != null) {
    if (!Array.isArray(p.sparsePaths) || p.sparsePaths.length > 32) return bad('sparsePaths', 'Use at most 32 sparse directories.');
    for (const path of p.sparsePaths) text('sparsePaths', path, 1024);
  }
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 32768) bad('params', 'Marketplace parameters must fit 32 KiB.');
  return structuredClone(p);
}
