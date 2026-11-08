// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import nativeOperations from '../tests/json-media-operations.json' with { type: 'json' };
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { isJsonRequestMediaType } from './lib/request-media.ts';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const mediaTypes = ['application/json-patch+json', 'application/scim+json', 'application/vnd.atl.bitbucket.bulk+json', 'Application/Example+JSON'];
const objectSchema = { type: 'object', properties: { name: { type: 'string', enum: ['café & +'] } }, required: ['name'], additionalProperties: false };
const patchSchema = { type: 'object', properties: { op: { type: 'string', enum: ['add', 'replace'] }, path: { type: 'string' },
  value: { type: 'string', enum: ['café & +', 'second'] } }, required: ['op', 'path', 'value'], additionalProperties: false };
function fixture(media, array = false, privateRequest = false) {
  const source = queryArrayDocument(undefined, privateRequest), operation = source.paths['/items'].get;
  operation.parameters = []; operation.requestBody = { required: true, content: { [media]: { schema: array ? { type: 'array', minItems: 1, items: patchSchema } : objectSchema } } };
  source.paths['/items'] = { patch: operation }; return source;
}
const inspect = source => inspectServiceSchema(source, 'json-media').operations[0];
const strict = source => extractOperations(source, 'json-media')[0];
const patchValues = (value = 'café & +') => [{ op: 'add', path: '/a~1b', value }, { op: 'replace', path: '/b', value: 'second' }];
const values = (array, name = 'café & +') => array ? { 'body:$': JSON.stringify(patchValues(name)) } : { 'body:name': name };

Then('JSON request media preserve typed objects ordered patch arrays and exact wire headers', () => {
  for (const media of mediaTypes) for (const array of [false, true]) {
    assert.equal(isJsonRequestMediaType(media), true);
    const source = fixture(media, array), original = JSON.stringify(source), expected = array ? patchValues() : { name: 'café & +' };
    for (const operation of [inspect(source), strict(source)]) {
      assert.equal(operation.unavailableReason, undefined); assert.equal(operation.bodyMediaType, media);
      const prepared = prepareRequest(operation, values(array)); assert.deepEqual(prepared.body, expected); assert.equal(prepared.contentType, media);
      assert.equal(requestBody(prepared), JSON.stringify(expected));
      assert.throws(() => prepareRequest(operation, values(array, 'invalid')), InputValidationError);
      assert.throws(() => prepareRequest(operation, {}), InputValidationError);
    }
    assert.equal(JSON.stringify(source), original);
  }
  assert.equal(isJsonRequestMediaType('application/json'), true);
  const source = fixture('application/json'); assert.equal(prepareRequest(inspect(source), values(false)).contentType, undefined);
});

Then('JSON request media reject streams wildcards malformed types and unknown encodings', () => {
  for (const media of ['application/jsonl', 'application/json-seq', 'application/x-ndjson', 'text/event-stream', 'application/*+json',
    'text/json', 'application/+json', 'application/scim+json\n', ' application/scim+json', 'application/scim+json; charset=utf-16', 'application/json-patch']) {
    assert.equal(isJsonRequestMediaType(media), false, media);
    const source = fixture(media); assert.ok(inspect(source).unavailableReason, media); assert.throws(() => strict(source));
  }
  const unknown = fixture('application/unreviewed'); assert.match(inspect(unknown).unavailableReason, /Declared request media types: application\/unreviewed/);
  const mixed = fixture('application/json-patch+json'); mixed.paths['/items'].patch.requestBody.content['application/scim+json'] = { schema: objectSchema };
  assert.throws(() => strict(mixed), /choose one/);
});

Then('private JSON media requests preserve exact bytes and canonical binding constraints', async () => {
  const source = fixture('application/json-patch+json', true, true), operation = inspect(source), origin = 'https://arrays.example.test';
  const descriptor = await approvedOperation(operation, origin), value = 'json-media-synthetic-key-9913';
  const credentials = [{ id: 'media-key', label: 'JSON media key', kind: 'secret', value, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'media-key' } }; let calls = 0;
  const output = await executeCredentialed(descriptor, values(true), binding, credentials, { assertCurrent() {}, fetchRequest: async (url, init) => {
    calls++; assert.equal(new URL(url).searchParams.get('api_key'), value); assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json-patch+json');
    assert.equal(init.body, '[{"op":"add","path":"/a~1b","value":"café & +"},{"op":"replace","path":"/b","value":"second"}]'); return Response.json({ accepted: true });
  } });
  assert.equal(calls, 1); assert.equal(JSON.stringify(output).includes(value), false);
  const changed = { ...operation, bodyMediaType: 'application/scim+json' }, other = await approvedOperation(changed, origin);
  assert.notEqual(other.fingerprint, descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other, values(true), binding, credentials, { assertCurrent() {} }), error => error.code === 'PERMISSION');
});

Then('all 16 JSON media operations preserve native identity and declared schemas', async () => {
  assert.equal(Object.values(nativeOperations).flat().length, 16);
  for (const [catalog, ids] of Object.entries(nativeOperations)) {
    const source = await readServiceSchema(catalog), original = JSON.stringify(source);
    const operations = inspectServiceSchema(source, catalog, new Set(ids)).operations; assert.equal(operations.length, ids.length);
    for (const operation of operations) {
      assert.equal(operation.unavailableReason, undefined, operation.id);
      const native = source.paths[operation.path][operation.method.toLowerCase()]; assert.equal(operation.id, `${catalog}:${native.operationId}`);
      assert.equal(isJsonRequestMediaType(operation.bodyMediaType), true);
      assert.ok(Object.hasOwn(native.requestBody.content, operation.bodyMediaType)); assert.ok(operation.bodySchema);
    }
    assert.equal(JSON.stringify(source), original);
  }
});
