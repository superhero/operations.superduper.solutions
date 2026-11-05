// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import corrections from './lib/operation-display.json' with { type: 'json' };
import { operationDisplayName } from './lib/operation-display.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';

const firstId = 'twilio:CreateAddress';
const first = { id: firstId, ...corrections[firstId], name: '' };
Then('operation display names only repair the qualified invalid metadata', () => {
  for (const name of ['', '   ', 'x'.repeat(201)]) assert.equal(operationDisplayName({ ...first, name }), corrections[firstId].name);
  for (const name of ['Repaired upstream label', 'x'.repeat(200)]) assert.equal(operationDisplayName({ ...first, name }), name);
  for (const change of [{ id: 'unknown:CreateAddress' }, { method: 'GET' }, { path: '/different' }])
    assert.equal(operationDisplayName({ ...first, ...change }), '');
  const operation = { ...first, id: 'unknown:CreateAddress', description: '', fields: [], bodyRequired: false, group: 'Test' };
  assert.throws(() => validateWorkflowDocument(document(createOperationGraph(operation, { x: 0, y: 0 }, 'node'))), /Operation name/);
});

function document(graph) {
  return { version: 2, id: 'metadata-test', name: 'Metadata test', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
}
Then('the corrected operation {string} has persistable display metadata and retains its source documentation', async id => {
  const correction = corrections[id]; assert.ok(correction, `Missing correction for ${id}`);
  const catalog = id.slice(0, id.indexOf(':')), schema = await readServiceSchema(catalog), original = JSON.stringify(schema);
  const operation = inspectServiceSchema(schema, catalog, new Set([id])).operations[0];
  assert.ok(operation); assert.equal(operation.id, id); assert.equal(operation.method, correction.method); assert.equal(operation.path, correction.path);
  assert.equal(operation.unavailableReason, undefined);
  const item = schema.paths[operation.path], source = item[operation.method.toLowerCase()];
  // The strict example parser accepts a deliberately smaller schema dialect.
  // Exercise its metadata projection without substituting it for service hydration.
  const parameters = operation.fields.filter(field => field.location === 'path').map(field =>
    ({ name: field.name, in: 'path', required: true, schema: { type: 'string' } }));
  const fixture = { openapi: '3.1.0', info: { title: 'Metadata', version: '1' }, servers: [{ url: 'https://example.test' }],
    paths: { [operation.path]: { [operation.method.toLowerCase()]: { operationId: source.operationId, summary: source.summary,
      description: source.description, parameters, responses: { '200': { description: 'Success' } } } } } };
  const strict = extractOperations(fixture, catalog).find(row => row.id === id);
  assert.ok(strict); assert.equal(strict.name, operation.name);
  assert.equal(operation.description, source.description ?? '', 'Canonical documentation remains complete.');
  if (correction.name) assert.equal(operation.name, correction.name);
  else assert.equal(operation.name, source.summary ?? source.operationId);
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'node', schema), data = graph.nodes[0].data;
  assert.equal(data.name, operation.name); assert.equal(data.description, correction.description ?? operation.description);
  assert.ok(data.name.trim() && data.name.length <= 200); assert.ok(data.description.length <= 4000);
  const saved = validateWorkflowDocument(document(graph));
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved);
  const index = JSON.parse(gunzipSync(await readFile(new URL(`./catalogs/services/indexes/${catalog}.json.gz`, import.meta.url))));
  assert.equal(index.operations.find(row => row.id === id).name, operation.name);
  assert.equal(JSON.stringify(schema), original, 'Display projection must not mutate source schemas.');
});
