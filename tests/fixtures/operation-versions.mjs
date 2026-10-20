// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Two real contracts for one endpoint, plus a descendant and a mapping destination. */
export function versionedSchema(server = 'https://versions.example.test') {
  const query = (name, type = 'string') => ({ name, in: 'query', required: false, schema: { type } });
  const response = properties => ({ 200: { description: 'Success', content: {
    'application/json': { schema: { type: 'object', properties } },
  } } });
  const operation = (id, summary, next) => ({ operationId: id, summary,
    parameters: [query('keep'), query('changed', next ? 'integer' : 'string'), query(next ? 'newOnly' : 'oldOnly')],
    responses: response({ same: { type: 'string' }, changed: { type: next ? 'integer' : 'string' },
      ...(next ? { added: { type: 'object', properties: { value: { type: 'boolean' } } } }
        : { removed: { type: 'object', properties: { value: { type: 'string' } } } }) }),
  });
  return { openapi: '3.1.0', info: { title: 'Versioned resource fixture', version: '1' },
    servers: [{ url: server }], paths: {
      '/v1/foo': { get: operation('readV1', 'Read foo v1', false) },
      '/version-2/foo': { get: operation('readV2', 'Read foo v2', true) },
      '/v1/foo/{id}/bar': { get: { operationId: 'readBar', summary: 'Read bar',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: response({}) } },
      '/sink': { get: { operationId: 'sink', summary: 'Read sink', parameters: [query('same'), query('changed'), query('removed')], responses: response({}) } },
    } };
}
