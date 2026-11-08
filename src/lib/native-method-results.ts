// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { decodeNativeMethodResultsData } from './native-method-results-data.ts';
const data = decodeNativeMethodResultsData();
type Document = Record<string, unknown>;
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const results: Record<string, string> = data.results;
export const nativeMethodSourceSha256 = data.source.schemaSha256;

/** Response declarations describe wire data; they grant no execution permission. */
export function nativeMethodResult(document: Document, method: string): { $ref: string } | undefined {
  if (!object(document.info) || document.info.version !== data.source.version || !Object.hasOwn(results, method)) return;
  const ref = results[method]!;
  let target: unknown = document;
  for (const key of ref.slice(2).split('/')) target = object(target) && Object.hasOwn(target, key) ? target[key] : undefined;
  // Custom/minimal models without the pinned response declaration stay generic.
  return object(target) || typeof target === 'boolean' ? { $ref: ref } : undefined;
}

export function validateNativeMethodResults(document: Document): void {
  const requests = object(document.definitions) && object(document.definitions.ClientRequest) && document.definitions.ClientRequest.oneOf;
  if (!Array.isArray(requests) || requests.length !== Object.keys(results).length) throw new Error('Native method result inventory requires requalification.');
  const seen = new Set<string>();
  for (const request of requests) {
    const method = object(request) && object(request.properties) && object(request.properties.method) && request.properties.method.enum;
    if (!Array.isArray(method) || method.length !== 1 || typeof method[0] !== 'string' || seen.has(method[0]) || !nativeMethodResult(document, method[0]))
      throw new Error('Native method result declarations require their reviewed version, identity and schemas.');
    seen.add(method[0]);
  }
}
