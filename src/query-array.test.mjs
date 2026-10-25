// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { appendRequestQuery, encodeQueryComponent } from './lib/query-serialization.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';

const inspect = document => inspectServiceSchema(document, 'query-fixture').operations[0];
const parameter = document => document.paths['/items'].get.parameters[0];
const request = (operation, value) => prepareRequest(operation, { 'query:colors': value === null ? null : JSON.stringify(value) });
const denied = error => error.code === 'PERMISSION';

Then('comma-separated query members round trip reserved characters Unicode and empty strings', () => {
  const document = queryArrayDocument(), operation = inspect(document), strict = extractOperations(document, 'query-fixture')[0];
  assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields[0].querySerialization, 'form-csv');
  assert.equal(strict.fields[0].querySerialization, 'form-csv');
  const defaults = structuredClone(document); parameter(defaults).allowEmptyValue = false; parameter(defaults).allowReserved = false;
  assert.equal(extractOperations(defaults, 'query-fixture')[0].fields[0].querySerialization, 'form-csv');
  const values = ['a,b', 'x&y=z', '%2C', 'a b', 'c+d', 'café', '', "'()*!~"];
  const prepared = request(operation, values), query = 'colors=a%2Cb,x%26y%3Dz,%252C,a%20b,c%2Bd,caf%C3%A9,,%27%28%29%2A%21~';
  assert.deepEqual(prepared.query.colors, values); assert.deepEqual(prepared.querySerialization, { colors: 'form-csv' });
  const url = workflowRequestUrl(prepared, 'https://arrays.example.test/v1?legacy=space%20value');
  assert.equal(url, `https://arrays.example.test/v1/items?legacy=space+value&${query}`);
  assert.deepEqual(new URL(url).search.slice(1).split('&')[1].slice('colors='.length).split(',').map(decodeURIComponent), values);
  for (const [type, value, encoded] of [['integer', [0, -2, 10], '0,-2,10'], ['number', [0.5, -3], '0.5,-3'], ['boolean', [true, false], 'true,false']]) {
    const source = queryArrayDocument(); parameter(source).schema.items = { type };
    assert.equal(new URL(workflowRequestUrl(request(inspect(source), value), 'https://arrays.example.test')).search, '?colors=' + encoded);
  }
});

Then('comma-separated arrays omit optional empty lists and reject required empty or explicit null values', () => {
  const document = queryArrayDocument(); parameter(document).schema.nullable = true;
  const operation = inspect(document);
  assert.deepEqual(prepareRequest(operation, {}).query, {}); assert.deepEqual(request(operation, []).query, {});
  assert.equal(request(operation, []).querySerialization, undefined);
  assert.throws(() => request(operation, null), error => error instanceof InputValidationError && /omit a nullable array/.test(error.message));
  assert.equal(new URL(workflowRequestUrl(request(operation, ['']), 'https://arrays.example.test')).search, '?colors=');
  parameter(document).required = true;
  assert.throws(() => request(inspect(document), []), /empty array/);
  parameter(document).schema.minItems = 1;
  assert.throws(() => request(inspect(document), []), /item count/);
});

Then('comma-separated query models reject nested nullable binary reserved and custom serialization', () => {
  for (const change of [p => p.schema.items = { type: 'object' }, p => p.schema.items = { type: 'array', items: { type: 'string' } },
    p => p.schema.items.nullable = true, p => p.schema.items.format = 'binary', p => p.schema.items = { oneOf: [{ type: 'string' }, { type: 'object' }] },
    p => p.allowReserved = true, p => p.allowEmptyValue = true, p => p.name = '', p => p.style = 'pipeDelimited', p => p.content = { 'application/json': { schema: p.schema } },
    p => p.in = 'header']) {
    const document = queryArrayDocument(); change(parameter(document));
    assert.ok(inspect(document).unavailableReason, JSON.stringify(parameter(document)));
    assert.throws(() => extractOperations(document, 'query-fixture'));
  }
  for (const value of [null, ['a', null], [['a']], [{ x: 'a' }]]) assert.throws(() => appendRequestQuery(new URL('https://arrays.example.test'), { query: { colors: value }, querySerialization: { colors: 'form-csv' } }));
});

Then('scalar repeated-array and deep-object queries retain their exact encoding', () => {
  const document = queryArrayDocument(); document.paths['/items'].get.parameters = [
    { name: 'text', in: 'query', schema: { type: 'string' } },
    { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
    { name: 'filter', in: 'query', style: 'deepObject', explode: true, schema: { type: 'object', properties: { name: { type: 'string' } } } }];
  for (const operation of [inspect(document), extractOperations(document, 'query-fixture')[0]]) {
    const prepared = prepareRequest(operation, { 'query:text': 'a b', 'query:tags': '["a,b","c+d"]', 'query:filter': '{"name":"x&y"}' });
    assert.equal(prepared.querySerialization, undefined);
    assert.equal(workflowRequestUrl(prepared, 'https://arrays.example.test'), 'https://arrays.example.test/items?text=a+b&tags=a%2Cb&tags=c%2Bd&filter%5Bname%5D=x%26y');
  }
});

async function privateFixture() {
  const document = queryArrayDocument(undefined, true), operation = inspect(document), descriptor = await approvedOperation(operation, 'https://arrays.example.test');
  const value = "query-array*'()!-canary-39271";
  const credentials = [{ id: 'array-key', label: 'Array key', kind: 'secret', value, grants: [{ id: 'array-grant', scheme: 'Key', descriptor }] }];
  return { document, operation, descriptor, value, credentials, binding: { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'array-key' } } };
}

Then('private array requests retain exact delimiters and privately injected query keys', async () => {
  const v = await privateFixture(), urls = [];
  const output = await executeCredentialed(v.descriptor, { 'query:colors': '["a,b","space value","%2C"]' }, v.binding, v.credentials, {
    assertCurrent() {}, fetchRequest: async url => { urls.push(String(url)); return Response.json({ safe: true }); } });
  assert.equal(urls[0], `https://arrays.example.test/items?colors=a%2Cb,space%20value,%252C&${new URLSearchParams({ api_key: v.value })}`);
  assert.equal(JSON.stringify(output).includes(v.value), false);
  assert.deepEqual(output.request.query.colors, ['a,b', 'space value', '%2C']);
  const echo = await executeCredentialed(v.descriptor, { 'query:colors': JSON.stringify([v.value]) }, v.binding, v.credentials, {
    assertCurrent() {}, fetchRequest: async url => Response.json({ echo: String(url) }) });
  assert.equal(JSON.stringify(echo).includes(encodeQueryComponent(v.value)), false);
  assert.equal(JSON.stringify(echo).includes(v.value), false);
  const bad = structuredClone(v.operation); bad.fields.push({ ...bad.fields[0], name: 'api_key', key: 'query:api_key' });
  const descriptor = await approvedOperation(bad, 'https://arrays.example.test'); let dispatched = false;
  await assert.rejects(executeCredentialed(descriptor, { 'query:api_key': '["x"]' }, { ...v.binding, fingerprint: descriptor.fingerprint }, v.credentials,
    { assertCurrent() {}, fetchRequest: async () => { dispatched = true; return Response.json({}); } }), denied);
  assert.equal(dispatched, false);
});

Then('changed or forged array serialization cannot reuse private approval or workflow fields', async () => {
  const v = await privateFixture(), repeated = structuredClone(v.document); parameter(repeated).explode = true;
  const other = await approvedOperation(inspect(repeated), 'https://arrays.example.test'); assert.notEqual(v.descriptor.fingerprint, other.fingerprint);
  await assert.rejects(executeCredentialed(v.descriptor, {}, { ...v.binding, fingerprint: other.fingerprint }, v.credentials, { assertCurrent() {} }), denied);
  const forgedFields = v.operation.fields.map(field => ({ ...field, querySerialization: undefined }));
  const prepared = prepareRequest(v.operation, { 'query:colors': '["a,b","c"]' }, forgedFields);
  assert.equal(workflowRequestUrl(prepared, 'https://arrays.example.test'), 'https://arrays.example.test/items?colors=a%2Cb,c');
  assert.throws(() => appendRequestQuery(new URL('https://arrays.example.test'), { query: { colors: ['x'] }, querySerialization: { colors: 'unknown' } }));
});

Then('native GitLab checkpoints preserve source identity and prepare channel arrays', async () => {
  const source = await readServiceSchema('gitlab'), original = JSON.stringify(source), id = 'gitlab:getApiV4AiDuoWorkflowsWorkflowsIdCheckpoints';
  const operation = inspectServiceSchema(source, 'gitlab', new Set([id])).operations[0];
  assert.equal(operation.id, id); assert.equal(operation.unavailableReason, undefined);
  assert.equal(operation.fields.find(field => field.name === 'channels').querySerialization, 'form-csv');
  const prepared = prepareRequest(operation, { 'path:id': '42', 'query:channels': '["one","two"]' });
  const url = new URL(workflowRequestUrl(prepared, operationServerUrl(source, operation)));
  assert.equal(url.pathname, '/api/v4/ai/duo_workflows/workflows/42/checkpoints'); assert.equal(url.search, '?channels=one,two');
  assert.equal(JSON.stringify(source), original);
});
