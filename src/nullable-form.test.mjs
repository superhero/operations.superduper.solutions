// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { nullableFormDocument } from '../tests/nullable-form.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { supportedSecurityAlternative } from './lib/operation-security.ts';

const body = document => document.paths['/items'].post.requestBody.content['multipart/form-data'].schema;
const file = document => body(document).properties.file;
const inspect = document => inspectServiceSchema(document, 'nullable-files').operations[0];
const bytes = Uint8Array.of(0, 1, 127, 255, 65);
const data = () => encodeWorkflowBinary('payload.bin', bytes, 'image/png');
const input = value => ({ 'body:file': value === null ? null : JSON.stringify(value) });
const fieldError = key => error => error instanceof InputValidationError && error.fieldKey === key;
function credentials(descriptor, alternative = 0) {
  return { binding: { fingerprint: descriptor.fingerprint, alternative, credentials: Object.fromEntries(descriptor.operation.security[alternative].map(scheme => [scheme.name, 'file-key'])) },
    records: [{ id: 'file-key', label: 'File key', kind: 'secret', value: 'nullable-file-private-canary-7129', grants: [] }] };
}
async function multipart(init) {
  const request = new Request('https://files.example.test', init);
  assert.match(request.headers.get('content-type'), /^multipart\/form-data;\s*boundary=/);
  return request.formData();
}

Then('nullable file declarations preserve filename media and bytes in canonical private multipart requests', async () => {
  for (const union of [false, true]) {
    const document = nullableFormDocument(undefined, true);
    if (union) { delete file(document).nullable; file(document).type = ['null', 'string']; }
    for (const operation of [extractOperations(document, 'nullable-files')[0], inspect(document)]) {
      assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields.find(field => field.name === 'file').format, 'binary');
      const values = { ...input(data()), 'body:caption': 'ok' }, prepared = prepareRequest(operation, values);
      const form = await multipart({ method: 'POST', body: requestBody(prepared) });
      assert.equal(form.get('file').name, 'payload.bin'); assert.equal(form.get('file').type, 'image/png');
      assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), bytes); assert.equal(form.get('caption'), 'ok');
      const descriptor = await approvedOperation(operation, 'https://files.example.test'), authority = credentials(descriptor); let calls = 0;
      await executeCredentialed(descriptor, values, authority.binding, authority.records, { assertCurrent() {}, fetchRequest: async (_url, init) => {
        calls++; assert.equal(new Headers(init.headers).has('content-type'), false);
        const privateForm = await multipart(init); assert.equal(privateForm.get('file').name, 'payload.bin'); assert.equal(privateForm.get('file').type, 'image/png');
        assert.deepEqual(new Uint8Array(await privateForm.get('file').arrayBuffer()), bytes); return Response.json({ uploaded: true });
      } });
      assert.equal(calls, 1);
    }
  }
});

Then('required optional empty and null file values have separate preparation outcomes', () => {
  const document = nullableFormDocument(), operation = inspect(document);
  assert.throws(() => prepareRequest(operation, {}), fieldError('body:file'));
  assert.throws(() => prepareRequest(operation, input(null)), error => fieldError('body:file')(error) && /explicit null/.test(error.message));
  body(document).required = []; const optional = inspect(document);
  assert.equal(requestBody(prepareRequest(optional, { 'body:caption': 'ok' })).has('file'), false);
  assert.throws(() => prepareRequest(optional, input(null)), fieldError('body:file'));
  document.paths['/items'].post.requestBody.required = false;
  assert.equal(requestBody(prepareRequest(inspect(document), {})), null);
  file(document).minLength = 0;
  const empty = encodeWorkflowBinary('empty.bin', new Uint8Array());
  const form = requestBody(prepareRequest(inspect(document), input(empty)));
  assert.equal(form.get('file').size, 0); assert.equal(form.get('file').name, 'empty.bin');
});

Then('nullable primitive form fields accept constrained values while rejecting explicit null', () => {
  for (const media of ['multipart/form-data', 'application/x-www-form-urlencoded']) {
    const document = nullableFormDocument(); delete body(document).properties.file; body(document).required = ['caption'];
    body(document).properties.count = { type: 'integer', nullable: true, minimum: 1, maximum: 3 };
    body(document).properties.flag = { type: 'boolean', nullable: true };
    const content = document.paths['/items'].post.requestBody.content;
    if (media !== 'multipart/form-data') { content[media] = content['multipart/form-data']; delete content['multipart/form-data']; }
    for (const operation of [inspect(document), extractOperations(document, 'nullable-files')[0]]) {
      assert.equal(operation.unavailableReason, undefined);
      const encoded = requestBody(prepareRequest(operation, { 'body:caption': 'null', 'body:count': '2', 'body:flag': 'false' }));
      assert.equal(encoded.get('caption'), 'null'); assert.equal(encoded.get('count'), '2'); assert.equal(encoded.get('flag'), 'false');
      assert.throws(() => prepareRequest(operation, { 'body:caption': null }), fieldError('body:caption'));
      assert.throws(() => prepareRequest(operation, { 'body:caption': 'other' }), fieldError('body:caption'));
      assert.throws(() => prepareRequest(operation, { 'body:caption': 'ok', 'body:count': '0' }), fieldError('body:count'));
    }
  }
});

Then('nullable files retain schema and global byte limits with no private dispatch on failure', async () => {
  const document = nullableFormDocument(undefined, true); file(document).minLength = 2; file(document).maxLength = 4;
  const operation = inspect(document), descriptor = await approvedOperation(operation, 'https://files.example.test'), authority = credentials(descriptor); let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); } };
  for (const value of [encodeWorkflowBinary('small.bin', Uint8Array.of(1)), data(), { ...data(), size: maxWorkflowUploadBytes + 1 }, null]) {
    assert.throws(() => prepareRequest(operation, input(value)), fieldError('body:file'));
    await assert.rejects(executeCredentialed(descriptor, input(value), authority.binding, authority.records, options));
  }
  assert.equal(calls, 0); assert.throws(() => encodeWorkflowBinary('large.bin', new Uint8Array(maxWorkflowUploadBytes + 1)), /500 kB/);
});

Then('nullable file models reject enum pattern malformed bounds unknown unions and unsupported transports', () => {
  for (const edit of [f => f.enum = ['file'], f => f.pattern = '.*', f => f.const = 'file', f => f.minLength = '1', f => f.maxLength = -1,
    f => f.minLength = 20, f => f.nullable = 'true', f => f.type = ['string', 'null', 'null']]) {
    const document = nullableFormDocument(); edit(file(document));
    assert.ok(inspect(document).unavailableReason, JSON.stringify(file(document))); assert.throws(() => extractOperations(document, 'nullable-files'));
  }
  for (const wrapper of [f => ({ anyOf: [f, { type: 'null' }], maxLength: 1 }), () => ({ anyOf: [{ type: 'string' }, { type: 'null' }], format: 'binary' })]) {
    const document = nullableFormDocument(); body(document).properties.file = wrapper({ type: 'string', format: 'binary' }); assert.ok(inspect(document).unavailableReason);
  }
  for (const invalid of [{ type: 'array', nullable: true, items: { type: 'string' } }, { type: 'array', items: { type: 'string', nullable: true } },
    { type: 'string', nullable: true, enum: [null] }, { type: 'string', nullable: true, enum: [7] }]) {
    const document = nullableFormDocument(); body(document).properties.extra = invalid; assert.ok(inspect(document).unavailableReason);
  }
  const raw = nullableFormDocument(); raw.paths['/items'].post.requestBody.content = { 'application/octet-stream': { schema: { type: 'string', format: 'binary', nullable: true } } };
  assert.ok(inspect(raw).unavailableReason); assert.throws(() => extractOperations(raw, 'nullable-files'));
  for (const media of ['multipart/form-data', 'application/x-www-form-urlencoded'])
    for (const value of [null, [], 'text', { file: null }]) assert.throws(() => requestBody({ method: 'POST', path: '/', query: {}, contentType: media, body: value }));
});

Then('stale private bindings cannot change nullable file constraints or encodings', async () => {
  const document = nullableFormDocument(undefined, true), operation = inspect(document), first = await approvedOperation(operation, 'https://files.example.test');
  const changed = structuredClone(document); file(changed).maxLength = 12;
  const second = await approvedOperation(inspect(changed), 'https://files.example.test'); assert.notEqual(first.fingerprint, second.fingerprint);
  const other = structuredClone(document); file(other).nullable = false; assert.notEqual(first.fingerprint, (await approvedOperation(inspect(other), 'https://files.example.test')).fingerprint);
  const authority = credentials(first); let calls = 0;
  await assert.rejects(executeCredentialed(second, input(data()), authority.binding, authority.records, { assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); } }), error => error.code === 'PERMISSION');
  assert.equal(calls, 0);
});

Then('the native GitLab upload prepares its canonical file without changing its source', async () => {
  const document = await readServiceSchema('gitlab'), original = JSON.stringify(document), id = 'gitlab:postApiV4ProjectsIdUploads';
  const operation = inspectServiceSchema(document, 'gitlab', new Set([id])).operations[0]; assert.equal(operation.id, id); assert.equal(operation.unavailableReason, undefined);
  const declared = operation.fields.find(field => field.key === 'body:file'); assert.equal(declared.format, 'binary'); assert.equal(declared.required, true); assert.equal(declared.nullable, true);
  const values = { 'path:id': '123', ...input(data()) }, prepared = prepareRequest(operation, values); assert.equal(prepared.path, '/api/v4/projects/123/uploads');
  const descriptor = await approvedOperation(operation, operationServerUrl(document, operation));
  const alternative = operation.security.findIndex(option => supportedSecurityAlternative(option) && option.every(scheme => ['bearer', 'apiKey'].includes(scheme.kind)));
  assert.ok(alternative >= 0); const authority = credentials(descriptor, alternative); let calls = 0;
  await executeCredentialed(descriptor, values, authority.binding, authority.records, { assertCurrent() {}, fetchRequest: async (url, init) => {
    calls++; assert.equal(new URL(url).pathname, '/api/v4/projects/123/uploads'); const form = await multipart(init);
    assert.equal(form.get('file').name, 'payload.bin'); assert.equal(form.get('file').type, 'image/png'); assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), bytes);
    return Response.json({ uploaded: true });
  } });
  assert.equal(calls, 1); assert.equal(JSON.stringify(document), original);
});
