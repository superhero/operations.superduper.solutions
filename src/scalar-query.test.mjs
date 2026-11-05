// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import nativeOperations from '../tests/scalar-query-operations.json' with { type: 'json' };
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { normalizeStringUnion } from './lib/form-input.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const inspect = source => inspectServiceSchema(source, 'scalar-query').operations[0];
const strict = source => extractOperations(source, 'scalar-query')[0];
const parameter = source => source.paths['/items'].get.parameters[0];
function fixture(explode = false, privateRequest = false) {
  const source = queryArrayDocument(undefined, privateRequest);
  source.paths['/items'].get.parameters = [{ name: 'value', in: 'query', style: 'form',
    ...(explode === undefined ? {} : { explode }), schema: { type: 'string' } }];
  return source;
}

Then('scalar query values use identical typed and escaped requests in both explode modes', () => {
  const fields = [['text', 'string', 'a,b&c=d + café%'], ['number', 'number', '0.5'], ['integer', 'integer', '-2'], ['boolean', 'boolean', 'false']];
  for (const mode of [undefined, false, true]) {
    const source = fixture(mode);
    source.paths['/items'].get.parameters = fields.map(([name, type]) => ({ name, in: 'query', style: 'form',
      ...(mode === undefined ? {} : { explode: mode }), schema: { type } }));
    for (const operation of [inspect(source), strict(source)]) {
      assert.equal(operation.unavailableReason, undefined);
      assert.ok(operation.fields.every(field => field.querySerialization === undefined));
      const request = prepareRequest(operation, Object.fromEntries(fields.map(([name, , value]) => [`query:${name}`, value])));
      assert.deepEqual(request.query, { text: fields[0][2], number: 0.5, integer: -2, boolean: false });
      assert.equal(workflowRequestUrl(request, 'https://arrays.example.test'),
        'https://arrays.example.test/items?text=a%2Cb%26c%3Dd+%2B+caf%C3%A9%25&number=0.5&integer=-2&boolean=false');
      assert.equal(new URL(workflowRequestUrl(request, 'https://arrays.example.test')).searchParams.getAll('text').length, 1);
    }
  }
  const explicitDefaults = fixture(); parameter(explicitDefaults).allowReserved = false; parameter(explicitDefaults).allowEmptyValue = false;
  assert.equal(inspect(explicitDefaults).unavailableReason, undefined); assert.equal(strict(explicitDefaults).fields[0].type, 'string');
});

Then('scalar query support rejects malformed flags and unrelated serialization modes', () => {
  const patches = [{ explode: 'false' }, { explode: 0 }, { explode: null }, { explode: {} }, { style: 'spaceDelimited' },
    { allowReserved: true }, { allowEmptyValue: true }, { schema: { type: 'string', format: 'binary' } },
    { schema: { type: 'object', properties: { value: { type: 'string' } } } },
    { schema: { type: 'array', items: { type: 'object' } } }, { in: 'header', explode: true }];
  for (const patch of patches) {
    const source = fixture(); Object.assign(parameter(source), patch);
    assert.ok(inspect(source).unavailableReason, JSON.stringify(patch));
    assert.throws(() => strict(source), undefined, JSON.stringify(patch));
  }
});

Then('referenced pattern and enum string alternatives retain their exact validation', () => {
  const source = fixture();
  source.components = { schemas: { Identifier: { type: 'string', pattern: '^[a-f0-9]{32}$', 'x-auditable': true } } };
  parameter(source).schema = { anyOf: [{ $ref: '#/components/schemas/Identifier' }, { type: 'string', enum: ['null'] }] };
  const original = JSON.stringify(source);
  for (const operation of [inspect(source), strict(source)]) {
    assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields[0].type, 'string');
    for (const value of ['a'.repeat(32), 'null']) assert.equal(prepareRequest(operation, { 'query:value': value }).query.value, value);
    for (const value of ['NULL', 'null\n', 'a'.repeat(31), 'x'.repeat(32), null]) {
      assert.throws(() => prepareRequest(operation, { 'query:value': value }), InputValidationError, String(value));
    }
  }
  assert.equal(JSON.stringify(source), original);
  const special = normalizeStringUnion({ anyOf: [{ type: 'string', pattern: 'token' }, { type: 'string', enum: ['a.b', '(x)', '', '\\'] }] });
  const pattern = new RegExp(special.pattern, 'u');
  for (const value of ['before token after', 'a.b', '(x)', '', '\\']) assert.ok(pattern.test(value), value);
  for (const value of ['axb', 'xa.b', '(x)\n']) assert.equal(pattern.test(value), false, value);
  for (const pattern of [12, '[']) {
    const invalid = fixture(); parameter(invalid).schema.pattern = pattern;
    assert.throws(() => strict(invalid), /pattern/);
  }
});

Then('scalar query normalization preserves ambiguous or unsupported string unions', () => {
  const string = { type: 'string' }, pattern = { type: 'string', pattern: '^id$' }, enumeration = { type: 'string', enum: ['null'] };
  for (const source of [
    { oneOf: [pattern, { type: 'string', enum: ['id'] }] }, { anyOf: [] }, { anyOf: [null, string] }, { anyOf: [[string], string] },
    { anyOf: [pattern, enumeration], minLength: 2 }, { anyOf: [{ ...pattern, minLength: 2 }, enumeration] },
    { anyOf: [{ ...pattern, enum: ['id'] }, enumeration] }, { anyOf: [{ type: 'string', pattern: '[' }, enumeration] },
    { anyOf: [{ type: 'string', pattern: 2 }, enumeration] }, { anyOf: [{ type: 'string', enum: [] }, string] },
    { anyOf: [{ type: 'string', enum: [12] }, string] }, { anyOf: [{ type: 'integer' }, string] },
    { anyOf: [pattern, pattern, enumeration] }, { anyOf: [pattern] }, { anyOf: [pattern, enumeration, { type: 'null' }] }
  ]) assert.equal(normalizeStringUnion(source), source, JSON.stringify(source));
  assert.deepEqual(normalizeStringUnion({ description: 'Open suggestions', anyOf: [enumeration, string, { type: 'null' }] }),
    { description: 'Open suggestions', type: 'string', nullable: true });
});

Then('all fifty reviewed scalar query operations preserve source identity and become available', async () => {
  assert.equal(nativeOperations.length, 50); assert.equal(new Set(nativeOperations.map(row => row.id)).size, 50);
  for (const catalog of new Set(nativeOperations.map(row => row.catalog))) {
    const source = await readServiceSchema(catalog), original = JSON.stringify(source);
    const ids = new Set(nativeOperations.filter(row => row.catalog === catalog).map(row => row.id));
    const operations = inspectServiceSchema(source, catalog, ids).operations;
    assert.equal(operations.length, ids.size);
    for (const operation of operations) { assert.ok(ids.has(operation.id)); assert.equal(operation.unavailableReason, undefined, operation.id); }
    assert.equal(JSON.stringify(source), original);
  }
});

Then('private scalar queries retain exact values without exposing or replacing credentials', async () => {
  const operation = inspect(fixture(false, true)), descriptor = await approvedOperation(operation, 'https://arrays.example.test');
  const value = 'scalar-synthetic-key-47291', credentials = [{ id: 'scalar-key', label: 'Scalar key', kind: 'secret', value,
    grants: [{ id: 'scalar-grant', scheme: 'Key', descriptor }] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'scalar-key' } };
  const text = 'a,b&c=d + café%', urls = [];
  const output = await executeCredentialed(descriptor, { 'query:value': text }, binding, credentials, {
    assertCurrent() {}, fetchRequest: async url => { urls.push(String(url)); return Response.json({ safe: true }); } });
  const url = new URL(urls[0]); assert.equal(url.searchParams.get('value'), text); assert.equal(url.searchParams.get('api_key'), value);
  assert.deepEqual(url.searchParams.getAll('value'), [text]); assert.equal(JSON.stringify(output).includes(value), false);
  const changed = structuredClone(operation); changed.fields.push({ ...changed.fields[0], key: 'query:api_key', name: 'api_key' });
  const forged = await approvedOperation(changed, 'https://arrays.example.test'); let dispatched = false;
  await assert.rejects(executeCredentialed(forged, { 'query:api_key': 'replace' }, { ...binding, fingerprint: forged.fingerprint }, credentials,
    { assertCurrent() {}, fetchRequest: async () => { dispatched = true; return Response.json({}); } }), error => error.code === 'PERMISSION');
  assert.equal(dispatched, false);
});
