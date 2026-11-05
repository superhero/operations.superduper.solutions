// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { readWorkflowResponseBody } from './lib/workflow-response-body.ts';

function fixture(required) {
  const source = queryArrayDocument(), operation = source.paths['/items'].get;
  operation.parameters = []; operation.requestBody = { ...(required === undefined ? {} : { required }), content: {} };
  source.paths['/items'] = { post: operation }; return source;
}
const inspect = source => inspectServiceSchema(source, 'empty-body').operations[0];
const strict = source => extractOperations(source, 'empty-body')[0];
const native = async () => {
  const source = await readServiceSchema('render');
  return { source, operation: inspectServiceSchema(source, 'render', new Set(['render:purge-cache'])).operations[0] };
};

Then('optional empty content has no body fields payload or content type in either importer', () => {
  for (const required of [undefined, false]) {
    const source = fixture(required), original = JSON.stringify(source);
    for (const operation of [inspect(source), strict(source)]) {
      assert.equal(operation.unavailableReason, undefined); assert.equal(operation.bodyRequired, false);
      assert.equal(operation.bodySchema, undefined); assert.equal(operation.bodyMediaType, undefined);
      assert.equal(operation.fields.length, 0);
      const prepared = prepareRequest(operation, { 'body:$': '{"untrusted":"ignored"}' });
      assert.equal(prepared.body, undefined); assert.equal(prepared.contentType, undefined); assert.equal(requestBody(prepared), null);
    }
    assert.equal(JSON.stringify(source), original);
  }
});

Then('empty body support rejects required malformed and unsupported media declarations', () => {
  const required = fixture(true); assert.match(inspect(required).unavailableReason, /Required request body has no declared media types/);
  assert.throws(() => strict(required), /required request body has no declared media types/);
  for (const body of [{ required: 'false', content: {} }, { content: null }, { content: [] }, {},
    { required: false, content: { 'application/unknown': { schema: { type: 'string' } } } }]) {
    const source = fixture(); source.paths['/items'].post.requestBody = body;
    assert.ok(inspect(source).unavailableReason, JSON.stringify(body)); assert.throws(() => strict(source));
  }
});

Then('the native Render cache purge accepts its optional empty body unchanged', async () => {
  const { source, operation } = await native(), original = JSON.stringify(source);
  assert.equal(operation.id, 'render:purge-cache'); assert.equal(operation.path, '/services/{serviceId}/cache/purge');
  assert.equal(operation.method, 'POST'); assert.equal(operation.unavailableReason, undefined);
  assert.equal(operation.bodyRequired, false); assert.equal(operation.fields.some(field => field.location === 'body'), false);
  assert.equal(prepareRequest(operation, { 'path:serviceId': 'srv-synthetic' }).path, '/services/srv-synthetic/cache/purge');
  assert.deepEqual(source.paths[operation.path].post.requestBody, { required: false, content: {} }); assert.equal(JSON.stringify(source), original);
});

Then('Render cache purge sends its private bearer request without a fabricated body', async () => {
  const { source, operation } = await native(), descriptor = await approvedOperation(operation, operationServerUrl(source, operation));
  const scheme = operation.security[0][0]; assert.equal(scheme.kind, 'bearer');
  const value = 'render-synthetic-bearer-88302', credentials = [{ id: 'render-key', label: 'Render key', kind: 'secret', value, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { [scheme.name]: 'render-key' } }; let sent = 0;
  const options = { assertCurrent() {}, fetchRequest: async (url, init) => {
    sent++; assert.equal(String(url), 'https://api.render.com/v1/services/srv-synthetic/cache/purge'); assert.equal(init.method, 'POST');
    assert.equal(init.body, null); const headers = new Headers(init.headers);
    assert.equal(headers.get('Content-Type'), null); assert.equal(headers.get('Authorization'), `Bearer ${value}`);
    return new Response(null, { status: 202 });
  } };
  const output = await executeCredentialed(descriptor, { 'path:serviceId': 'srv-synthetic' }, binding, credentials, options);
  assert.equal(sent, 1); assert.equal(output.response.body, null); assert.equal(JSON.stringify(output).includes(value), false);
  await assert.rejects(executeCredentialed(descriptor, {}, binding, [], options), error => error.code === 'PERMISSION'); assert.equal(sent, 1);
});

Then('empty untyped responses produce null while declared JSON remains strictly decoded', async () => {
  const { operation } = await native();
  const read = (response, model = operation) => readWorkflowResponseBody(response, model, 'POST', new AbortController().signal);
  for (const status of [200, 202]) for (const body of [null, new ReadableStream({ start(controller) { controller.close(); } })]) {
    assert.deepEqual(await read(new Response(body, { status })), { body: null });
  }
  for (const [response, model] of [
    [new Response(null, { status: 202, headers: { 'Content-Type': 'application/json' } }), operation],
    [new Response(null, { status: 202 }), { ...operation, responseMediaType: 'application/json' }]
  ]) assert.equal((await read(response, model)).malformedJson, true);
  const text = await read(new Response(null, { status: 202, headers: { 'Content-Type': 'text/plain' } })); assert.equal(text.body, '');
  const error = await read(new Response(null, { status: 400 })); assert.equal(error.body, '');
  assert.equal((await read(Response.json({ accepted: true }, { status: 202 }))).body.accepted, true);
});
