// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile } from 'node:fs/promises';
const base = 'https://www.dukascopy.com/trading-tools/api/documentation';
async function read(target) {
  const response = await fetch(`${base}/${target}.json`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Dukascopy documentation: HTTP ${response.status}`);
  return response.json();
}
const index = await read('groups');
const methods = [];
const parameters = new Map();
for (const group of Object.values(index.groups)) {
  const document = await read(group.slug);
  for (const method of document.methods.filter(method => method.active)) {
    const url = new URL(method.name);
    if (url.origin !== 'https://freeserv.dukascopy.com' || url.pathname !== '/2.0/' || method.method !== 'GET')
      throw new Error('Dukascopy endpoint transport changed; inspect before regenerating.');
    methods.push({ path: url.searchParams.get('path'), description: method.description, parameters: method.parameters });
    for (const parameter of method.parameters.filter(parameter => parameter.active)) {
      const type = document.types[parameter.type].name;
      const mapped = { char: 'string', date: 'string', jsonp: 'string' }[type] ?? type;
      if (!['string', 'integer', 'boolean', 'number'].includes(mapped)) throw new Error(`Unsupported documented parameter: ${type}`);
      const previous = parameters.get(parameter.name);
      if (previous && previous.schema.type !== mapped) throw new Error(`Conflicting parameter: ${parameter.name}`);
      parameters.set(parameter.name, { name: parameter.name, in: 'query', required: parameter.name === 'key',
        description: parameter.description, schema: { type: mapped } });
    }
  }
}
// The provider dispatches four procedures through one HTTP GET endpoint. Query
// strings cannot form distinct OpenAPI paths; retain the selector and all docs.
const document = { openapi: '3.1.0', info: { title: 'Dukascopy Trading Tools', version: '2.0',
  description: 'Trading Tools query API. Choose a procedure with the path parameter. Historical prices additionally require instrument. See the original procedure definitions in x-dukascopy-procedures.' },
  servers: [{ url: 'https://freeserv.dukascopy.com' }], paths: { '/2.0/': { get: {
    operationId: 'queryTradingTools', summary: 'Query instruments, quotes or historical candles', tags: ['Trading data'],
    externalDocs: { url: base }, parameters: [{ name: 'path', in: 'query', required: true,
      description: methods.map(method => `${method.path}: ${method.description}`).join('\n'), schema: { type: 'string', enum: methods.map(method => method.path) } }, ...parameters.values()],
    responses: { '200': { description: 'Instrument list, quotes or candle data for the selected procedure.', content: { 'application/json': { schema: { type: 'array', items: {} } } } } },
    'x-dukascopy-procedures': methods
  } } } };
await mkdir('build/schema-documents', { recursive: true });
await writeFile('build/schema-documents/dukascopy.json', `${JSON.stringify(document, null, 2)}\n`);
console.log(`Dukascopy: ${methods.length} documented procedures through one HTTP endpoint.`);
