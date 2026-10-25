// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export function nullableFormDocument(origin = 'https://files.example.test', privateRequest = false) {
  const schema = { type: 'object', required: ['file'], properties: {
    file: { type: 'string', format: 'binary', nullable: true, minLength: 1, maxLength: 16 },
    caption: { type: 'string', nullable: true, enum: ['ok', 'null', null] },
  } };
  const operation = { operationId: 'upload', summary: 'Upload nullable file',
    ...(privateRequest ? { security: [{ Bearer: [] }] } : {}),
    requestBody: { required: true, content: { 'multipart/form-data': { schema } } },
    responses: { '200': { description: 'Uploaded', content: { 'application/json': { schema: { type: 'object' } } } } } };
  return { openapi: '3.1.0', info: { title: 'Nullable files', version: '1' }, servers: [{ url: origin }],
    ...(privateRequest ? { components: { securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } } } } : {}),
    paths: { '/items': { post: operation } } };
}
