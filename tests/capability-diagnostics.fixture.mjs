// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export function capabilityDocument() {
  return { openapi: '3.1.0', info: { title: 'Capability fixture', version: '1' }, servers: [{ url: 'https://no-default' }],
    components: { securitySchemes: { Digest: { type: 'http', scheme: 'digest' }, Bearer: { type: 'http', scheme: 'bearer' } } },
    paths: { '/items': { post: { operationId: 'inspect', summary: 'Inspect capability limits', security: [{ Digest: [] }],
      parameters: [{ name: 'session', in: 'cookie', schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/xml': { schema: { type: 'string' } } } },
      'x-operations-response-stream': 'unreviewed-stream', responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
}
