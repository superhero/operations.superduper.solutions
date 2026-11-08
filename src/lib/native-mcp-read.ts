// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from './native-runtime-contract.ts';

export const nativeMcpReadMethods = ['mcpServerStatus/list', 'mcpServer/resource/read'] as const;
export type NativeMcpReadMethod = typeof nativeMcpReadMethods[number];
export const isNativeMcpReadMethod = (method: unknown): method is NativeMcpReadMethod => nativeMcpReadMethods.includes(method as NativeMcpReadMethod);
export class NativeMcpInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) { super(message); this.field = field; }
}
const bad = (field: string, message: string): never => { throw new NativeMcpInputError(field, message); };
type Property = Record<string, unknown>;
export function nativeMcpReadInputSchema(method: NativeMcpReadMethod) {
  const text = (title: string, maxLength = 512): Property => ({ type: 'string', title, minLength: 1, maxLength });
  const properties: Record<string, Property> = method === 'mcpServerStatus/list' ? {
    serverName: { ...text('Server name', 256), type: ['string', 'null'] },
    cursor: { type: ['string', 'null'], maxLength: 2048, title: 'Cursor' },
    limit: { type: ['integer', 'null'], minimum: 0, maximum: 64, default: 8, title: 'Page size' },
    detail: { type: ['string', 'null'], enum: ['full', 'toolsAndAuthOnly', null], title: 'Inventory detail' }
  } : {
    server: text('Server name', 256), uri: text('Resource URI', 4096),
    connectorId: { ...text('Connector ID'), type: ['string', 'null'] },
    target: { type: ['object', 'null'], title: 'Hosted app account', additionalProperties: false,
      description: 'For codex_apps only. A null link ID explicitly selects no-auth access under the app resource policy.',
      properties: { connectorId: text('Connector ID'), linkId: { ...text('Account link ID'), type: ['string', 'null'] } }, required: ['connectorId', 'linkId'] }
  };
  return { type: 'object', additionalProperties: false as const, properties, required: method === 'mcpServer/resource/read' ? ['server', 'uri'] : [] };
}
export function nativeMcpReadParams(method: NativeMcpReadMethod, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('params', 'Enter MCP parameters as an object.');
  const item = nativeObject(value, Object.keys(value)), allowed = nativeMcpReadInputSchema(method).properties;
  for (const name of Object.keys(item)) if (!Object.hasOwn(allowed, name)) bad(name, 'This standalone MCP read cannot use thread state or override runtime configuration.');
  const text = (field: string, value: unknown, maximum: number, empty = false): string => {
    if (typeof value !== 'string' || !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value)
      || [...value].length > maximum || !empty && !value.trim()) return bad(field, 'Enter bounded, nonempty MCP text without control characters.');
    return value;
  };
  if (method === 'mcpServerStatus/list') {
    if (item.serverName != null) text('serverName', item.serverName, 256);
    if (item.cursor != null) text('cursor', item.cursor, 2048, true);
    if (item.detail != null && (typeof item.detail !== 'string' || !['full', 'toolsAndAuthOnly'].includes(item.detail))) bad('detail', 'Select full or toolsAndAuthOnly inventory.');
    if (item.limit != null && (!Number.isSafeInteger(item.limit) || Number(item.limit) < 0 || Number(item.limit) > 64)) bad('limit', 'Page size must be an integer between 0 and 64.');
    return { ...structuredClone(item), limit: item.limit ?? 8 };
  }
  text('server', item.server, 256); const uri = text('uri', item.uri, 4096);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) bad('uri', 'Enter an absolute resource URI advertised by the configured MCP server.');
  if (item.connectorId != null) text('connectorId', item.connectorId, 512);
  if (item.target != null) {
    if (item.server !== 'codex_apps') bad('target', 'Hosted app targets require the codex_apps server.');
    let target: Record<string, unknown>;
    try { target = nativeObject(item.target, ['connectorId', 'linkId']); } catch { return bad('target', 'A target requires exactly connectorId and linkId.'); }
    text('target.connectorId', target.connectorId, 512);
    if (target.linkId !== null) {
      const link = text('target.linkId', target.linkId, 512);
      if (link.startsWith('synthetic_link::')) bad('target.linkId', 'Use a real hosted account link ID, or null for explicit no-auth access.');
    }
  }
  return structuredClone(item);
}

/** Resource bodies keep their wire encoding. Decoded bytes receive a separate credential scan. */
export function nativeMcpResourceBodies(value: unknown): Uint8Array[] {
  const result = value as { contents?: { text?: string; blob?: string }[] };
  if (!Array.isArray(result.contents) || result.contents.length > 64) throw new Error('Invalid MCP resource inventory.');
  return result.contents.map(content => {
    if (typeof content.text === 'string') {
      const bytes = new TextEncoder().encode(content.text); if (bytes.length > 32768) throw new Error('MCP resource exceeds its byte budget.'); return bytes;
    }
    const encoded = content.blob;
    if (typeof encoded !== 'string' || encoded.length > 43692 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Invalid MCP resource encoding.');
    const decoded = atob(encoded); if (decoded.length > 32768 || btoa(decoded) !== encoded) throw new Error('Invalid MCP resource encoding.');
    return Uint8Array.from(decoded, character => character.charCodeAt(0));
  });
}
