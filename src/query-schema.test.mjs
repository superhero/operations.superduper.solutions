// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import nativeOperations from '../tests/query-schema-operations.json' with { type: 'json' };
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { normalizeStringUnion } from './lib/form-input.ts';
import { InputValidationError, prepareRequest, validateInputValue } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const parameter = source => source.paths['/items'].get.parameters[0];
const inspect = source => inspectServiceSchema(source, 'query-schema').operations[0];
const strict = source => extractOperations(source, 'query-schema')[0];
const request = (operation, value) => prepareRequest(operation, { 'query:colors': JSON.stringify(value) });
function fixture(privateRequest = false) {
  const source = queryArrayDocument(undefined, privateRequest);
  Object.assign(parameter(source).schema, { uniqueItems: true, minItems: 1, maxItems: 4 });
  return source;
}

Then('unique query arrays preserve values enums bounds omission and duplicate rejection', () => {
  for (const mode of [undefined, false, true]) for (const [type, values] of [
    ['string', ['a,b', 'café + &']], ['integer', [0, -2]], ['number', [0.5, -1]], ['boolean', [true, false]]
  ]) {
    const source = fixture(); parameter(source).explode = mode; parameter(source).schema.items = { type, enum: values };
    for (const operation of [inspect(source), strict(source)]) {
      assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields[0].schema.uniqueItems, true);
      const prepared = request(operation, values), url = new URL(workflowRequestUrl(prepared, 'https://arrays.example.test'));
      assert.deepEqual(prepared.query.colors, values);
      if (mode === false) assert.deepEqual(url.search.slice('?colors='.length).split(',').map(decodeURIComponent), values.map(String));
      else assert.deepEqual(url.searchParams.getAll('colors'), values.map(String));
      for (const invalid of [[], [values[0], values[0]], [values[0], values[0], values[0], values[0], values[0]], [null]])
        assert.throws(() => request(operation, invalid), InputValidationError);
      assert.deepEqual(prepareRequest(operation, {}).query, {});
    }
  }
  for (const flag of [undefined, false]) {
    const source = fixture(); parameter(source).schema.uniqueItems = flag;
    for (const operation of [inspect(source), strict(source)]) assert.deepEqual(request(operation, ['same', 'same']).query.colors, ['same', 'same']);
  }
  for (const uniqueItems of [null, 'true', 1, {}]) {
    const source = fixture(); parameter(source).schema.uniqueItems = uniqueItems;
    assert.ok(inspect(source).unavailableReason); assert.throws(() => strict(source), /uniqueItems/);
  }
  const misplaced = fixture(); parameter(misplaced).schema = { type: 'string', uniqueItems: true };
  assert.ok(inspect(misplaced).unavailableReason); assert.throws(() => strict(misplaced), /uniqueItems/);
});

Then('unique input arrays distinguish JSON types and reject structurally equal members', () => {
  const field = { type: 'array', uniqueItems: true, name: 'values', key: 'body:values', location: 'body', label: 'Values', required: true };
  validateInputValue(field, [null, false, 0, '0', {}, [], [1, 2], [2, 1], { a: 1 }, { a: '1' }, 'é', 'e\u0301']);
  for (const values of [[0, -0], [1, 1.0], [null, null], [[1, 2], [1, 2]],
    [{ a: 1, b: [2, { c: true }] }, { b: [2, { c: true }], a: 1 }]]) {
    assert.throws(() => validateInputValue(field, values), error => error instanceof InputValidationError && error.fieldKey === 'body:values' && /unique/.test(error.message));
  }
  assert.throws(() => validateInputValue(field, [Infinity, Infinity]), /valid JSON/);
});

Then('disjoint query string alternatives accept identifiers or literals while overlapping unions remain guarded', () => {
  const source = fixture(); source.components = { schemas: { Identifier: { type: 'string', pattern: '^[0-9a-fA-F]{24}$' } } };
  parameter(source).schema = { oneOf: [{ type: 'string', enum: ['mine', '(all)'] }, { $ref: '#/components/schemas/Identifier' }] };
  for (const operation of [inspect(source), strict(source)]) {
    assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields[0].type, 'string');
    for (const value of ['mine', '(all)', 'a'.repeat(24)]) assert.equal(prepareRequest(operation, { 'query:colors': value }).query.colors, value);
    for (const value of ['other', 'mine\n', 'x'.repeat(24), null]) assert.throws(() => prepareRequest(operation, { 'query:colors': value }), InputValidationError);
  }
  for (const variants of [
    [{ type: 'string' }, { type: 'string', enum: ['mine'] }],
    [{ type: 'string', pattern: '^mine$' }, { type: 'string', enum: ['mine'] }],
    [{ type: 'string', pattern: '^id$' }, { type: 'string', enum: ['mine'] }, { type: 'string', enum: ['all'] }],
    [{ type: 'string', pattern: '^id$' }, { type: 'null' }],
    [{ type: 'string', enum: ['a'] }, { type: 'string', enum: ['b'] }]
  ]) { const shape = { oneOf: variants }; assert.equal(normalizeStringUnion(shape), shape); }
  const both = { oneOf: [{ type: 'string' }], anyOf: [{ type: 'string' }] }; assert.equal(normalizeStringUnion(both), both);
});

Then('all 79 query schema operations preserve their source and canonical constraints', async () => {
  assert.equal(Object.values(nativeOperations).flat().length, 79);
  for (const [catalog, ids] of Object.entries(nativeOperations)) {
    const source = await readServiceSchema(catalog), original = JSON.stringify(source);
    const operations = inspectServiceSchema(source, catalog, new Set(ids)).operations; assert.equal(operations.length, ids.length);
    for (const operation of operations) {
      assert.equal(operation.unavailableReason, undefined, operation.id);
      if (catalog === 'x') assert.ok(operation.fields.some(field => field.schema?.uniqueItems === true), operation.id);
      else {
        const field = operation.fields.find(field => field.name === 'idBoards'); assert.equal(field.type, 'string');
        assert.equal(prepareRequest(operation, { 'query:query': 'cards', 'query:idBoards': 'mine' }).query.idBoards, 'mine');
      }
    }
    assert.equal(JSON.stringify(source), original);
  }
});

Then('private unique queries reject duplicates and stale constraints before dispatch', async () => {
  const source = fixture(true), operation = inspect(source), descriptor = await approvedOperation(operation, 'https://arrays.example.test');
  const credential = 'unique-synthetic-token-7832', credentials = [{ id: 'unique-key', label: 'Unique key', kind: 'secret', value: credential, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'unique-key' } }; let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async (url) => { calls++; assert.equal(new URL(url).searchParams.get('api_key'), credential); return Response.json({ safe: true }); } };
  await assert.rejects(executeCredentialed(descriptor, { 'query:colors': '["same","same"]' }, binding, credentials, options), InputValidationError);
  assert.equal(calls, 0);
  const output = await executeCredentialed(descriptor, { 'query:colors': '["one","two"]' }, binding, credentials, options);
  assert.equal(calls, 1); assert.equal(JSON.stringify(output).includes(credential), false);
  parameter(source).schema.uniqueItems = false; const other = await approvedOperation(inspect(source), 'https://arrays.example.test');
  assert.notEqual(other.fingerprint, descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other, {}, binding, credentials, options), error => error.code === 'PERMISSION'); assert.equal(calls, 1);
});
