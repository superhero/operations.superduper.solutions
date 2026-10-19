// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

const methods = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options', 'trace']);

function resolve(value, document) {
  const seen = new Set();
  while (value && typeof value === 'object' && typeof value.$ref === 'string') {
    const reference = value.$ref;
    if (!reference.startsWith('#/') || seen.has(reference) || Object.keys(value).length !== 1)
      throw new Error(`Unsupported or cyclic operation reference: ${reference}`);
    seen.add(reference);
    const pointer = decodeURIComponent(reference.slice(2));
    if (/~(?:[^01]|$)/.test(pointer)) throw new Error(`Invalid operation reference: ${reference}`);
    value = pointer.split('/').reduce((parent, part) => {
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
      return parent && typeof parent === 'object' && Object.hasOwn(parent, key) ? parent[key] : undefined;
    }, document);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Missing operation reference target.');
  return value;
}

/** New catalogs can opt into stable method/path IDs when upstream IDs collide.
 * Expand only path/operation references; recursive data models remain references.
 */
export function useMethodPathOperationIds(input) {
  const document = structuredClone(input);
  const paths = {};
  for (const [path, raw] of Object.entries(document.paths)) {
    const item = { ...resolve(raw, document) };
    if (raw.$ref) item['x-upstream-path-ref'] = raw.$ref;
    for (const [method, value] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      const operation = resolve(value, document);
      item[method] = { ...operation,
        ...(typeof operation.operationId === 'string' ? { 'x-upstream-operation-id': operation.operationId } : {}),
        operationId: `${method.toUpperCase()} ${path}` };
    }
    paths[path] = item;
  }
  document.paths = paths;
  return document;
}
