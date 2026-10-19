// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { parse } from 'yaml';

/** Import external Swagger definitions under stable root names before conversion.
 * An inline bundle may put a recursive target inside a property the converter
 * later replaces. Stable root definitions preserve those references through it.
 */
export async function bundleSwaggerReferences(document, origin, download) {
  const imported = new Map();
  const sources = new Map([[origin, Promise.resolve(document)]]);
  async function reference(value, context) {
    const url = new URL(value, context);
    const fragment = url.hash;
    url.hash = '';
    const source = url.href;
    if (source === origin) return fragment;
    const identity = `${source}${fragment}`;
    if (imported.has(identity)) return imported.get(identity);
    const parts = decodeURIComponent(fragment.slice(2)).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    const collection = fragment ? parts[0] : 'x-bundled';
    if (fragment && (!fragment.startsWith('#/') || !['definitions', 'parameters', 'responses'].includes(collection)))
      throw new Error(`Unsupported external Swagger reference: ${identity}`);
    const name = `imported_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
    const local = `#/${collection}/${name}`;
    imported.set(identity, local);
    const destination = document[collection] ??= {};
    destination[name] = {};
    if (!sources.has(source)) sources.set(source, download(source).then(parse));
    const sourceDocument = await sources.get(source);
    const target = fragment ? parts.reduce((parent, key) => parent?.[key], sourceDocument) : sourceDocument;
    if (!target || typeof target !== 'object') throw new Error(`Missing Swagger reference: ${identity}`);
    destination[name] = await walk(target, source);
    return local;
  }
  async function walk(value, context) {
    if (Array.isArray(value)) return Promise.all(value.map(item => walk(item, context)));
    if (!value || typeof value !== 'object') return value;
    const entries = [];
    for (const [key, child] of Object.entries(value))
      entries.push([key, key === '$ref' ? await reference(child, context) : await walk(child, context)]);
    return Object.fromEntries(entries);
  }
  // Imported definitions are added to the original root while its authored
  // children are normalized. Merge them after walking the original entries.
  const normalized = await walk(document, origin);
  for (const collection of ['definitions', 'parameters', 'responses', 'x-bundled'])
    if (document[collection]) normalized[collection] = { ...normalized[collection], ...Object.fromEntries(
      Object.entries(document[collection]).filter(([name]) => name.startsWith('imported_'))) };
  return normalized;
}
