// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export function queryArrayDocument(origin = 'https://arrays.example.test', privateRequest = false) {
  const operation = { operationId: 'read', summary: 'Read arrays',
    ...(privateRequest ? { security: [{ Key: [] }] } : {}),
    parameters: [{ name: 'colors', in: 'query', style: 'form', explode: false, schema: { type: 'array', items: { type: 'string' } } }],
    responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } } };
  return { openapi: '3.1.0', info: { title: 'Query arrays', version: '1' }, servers: [{ url: origin }],
    ...(privateRequest ? { components: { securitySchemes: { Key: { type: 'apiKey', in: 'query', name: 'api_key' } } } } : {}),
    paths: { '/items': { get: operation } } };
}
