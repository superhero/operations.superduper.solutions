// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { InputValidationError, prepareRequest, validateInputValue } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const schema = () => ({ type: 'object', additionalProperties: { type: 'string', minLength: 0, maxLength: 512 },
  propertyNames: { type: 'string', minLength: 1, maxLength: 64 }, minProperties: 0, maxProperties: 16 });
function fixture(privateRequest = false) {
  const source = queryArrayDocument(undefined, privateRequest);
  source.paths['/items'].get.parameters = [{ name: 'metadata', in: 'query', required: false, style: 'deepObject', explode: true, schema: schema() }];
  return source;
}
const parameter = source => source.paths['/items'].get.parameters[0];
const inspect = source => inspectServiceSchema(source, 'metadata-query').operations[0];
const strict = source => extractOperations(source, 'metadata-query')[0];
const values = metadata => ({ 'query:metadata': JSON.stringify(metadata) });
const denied = error => error instanceof InputValidationError && error.fieldKey === 'query:metadata';

Then('both importers preserve metadata bounds names and exact deepObject encoding', () => {
  const source = fixture();
  for (const operation of [inspect(source), strict(source)]) {
    const field = operation.fields[0]; assert.equal(operation.unavailableReason, undefined); assert.deepEqual(field.schema.propertyNames, schema().propertyNames);
    assert.equal(field.schema.maxProperties, 16); assert.equal(field.schema.minProperties, 0);
    const prepared = prepareRequest(operation, values({ region: 'café & +', empty: '' }));
    assert.deepEqual(prepared.query, { 'metadata[region]': 'café & +', 'metadata[empty]': '' });
    assert.equal(workflowRequestUrl(prepared, 'https://arrays.example.test'), 'https://arrays.example.test/items?metadata%5Bregion%5D=caf%C3%A9+%26+%2B&metadata%5Bempty%5D=');
    assert.deepEqual(prepareRequest(operation, values({})).query, {}); assert.deepEqual(prepareRequest(operation, {}).query, {});
    assert.equal(Object.keys(prepareRequest(operation, values(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`key${i}`, 'value'])))).query).length, 16);
    prepareRequest(operation, values({ ['é'.repeat(64)]: 'x'.repeat(512) }));
    const body = { key: 'body:metadata', name: 'metadata', label: 'Metadata', location: 'body', required: true, type: 'object', schema: field.schema };
    validateInputValue(body, { region: 'value' }); assert.throws(() => validateInputValue(body, { '': 'value' }), InputValidationError);
  }
});

Then('metadata dictionaries reject excess pairs invalid names values and malformed constraints', () => {
  for (const operation of [inspect(fixture()), strict(fixture())]) for (const invalid of [
    { '': 'value' }, { ['é'.repeat(65)]: 'value' }, { region: 'x'.repeat(513) }, { region: null }, { region: [] },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`key${i}`, 'value']))
  ]) assert.throws(() => prepareRequest(operation, values(invalid)), denied);
  const constrained = fixture(); Object.assign(parameter(constrained).schema, { minProperties: 1, propertyNames: { type: 'string', pattern: '^[a-z]+$' } });
  for (const operation of [inspect(constrained), strict(constrained)]) {
    assert.throws(() => prepareRequest(operation, values({})), denied); assert.throws(() => prepareRequest(operation, values({ 'bad-key': 'value' })), denied);
    prepareRequest(operation, values({ region: 'value' }));
  }
  for (const patch of [{ minProperties: -1 }, { maxProperties: 1.5 }, { maxProperties: '16' }, { minProperties: 17 },
    { propertyNames: { type: 'object' } }, { propertyNames: { type: 'string', format: 'binary' } }]) {
    const source = fixture(); Object.assign(parameter(source).schema, patch);
    assert.ok(inspect(source).unavailableReason, JSON.stringify(patch)); assert.throws(() => strict(source));
  }
  const misplaced = fixture(); parameter(misplaced).schema = { type: 'string', maxProperties: 2 };
  assert.ok(inspect(misplaced).unavailableReason); assert.throws(() => strict(misplaced), /constraint/);
});

Then('both native OpenAI vault metadata filters retain their schemas and exact request values', async () => {
  const source = await readServiceSchema('openai'), original = JSON.stringify(source), ids = new Set(['openai:listVaults', 'openai:listVaultCredentials']);
  const operations = inspectServiceSchema(source, 'openai', ids).operations; assert.equal(operations.length, 2);
  for (const operation of operations) {
    assert.equal(operation.unavailableReason, undefined, operation.id);
    const field = operation.fields.find(field => field.name === 'metadata'); assert.equal(field.type, 'object'); assert.equal(field.schema.maxProperties, 16);
    assert.deepEqual(field.schema.propertyNames, { type: 'string', minLength: 1, maxLength: 64 });
    const input = { ...values({ region: 'café & +' }), ...(operation.path.includes('{vault_id}') ? { 'path:vault_id': 'vault-synthetic' } : {}) };
    const request = prepareRequest(operation, input); assert.equal(request.query['metadata[region]'], 'café & +');
    assert.throws(() => prepareRequest(operation, { ...input, ...values({ '': 'invalid' }) }), denied);
  }
  assert.equal(JSON.stringify(source), original);
});

Then('private metadata filters enforce limits preserve credentials and reject stale constraints', async () => {
  const source = fixture(true), operation = inspect(source), descriptor = await approvedOperation(operation, 'https://arrays.example.test');
  const value = 'metadata-synthetic-private-token-6153', credentials = [{ id: 'metadata-key', label: 'Metadata key', kind: 'secret', value, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'metadata-key' } }; let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async url => { calls++; const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('metadata[region]'), 'café & +'); assert.equal(parsed.searchParams.get('api_key'), value); return Response.json({ safe: true }); } };
  await assert.rejects(executeCredentialed(descriptor, values({ '': 'invalid' }), binding, credentials, options), denied); assert.equal(calls, 0);
  const output = await executeCredentialed(descriptor, values({ region: 'café & +' }), binding, credentials, options);
  assert.equal(calls, 1); assert.equal(JSON.stringify(output).includes(value), false);
  parameter(source).schema.maxProperties = 8; const other = await approvedOperation(inspect(source), descriptor.origin);
  assert.notEqual(other.fingerprint, descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other, {}, binding, credentials, options), error => error.code === 'PERMISSION'); assert.equal(calls, 1);
});
