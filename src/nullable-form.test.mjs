// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
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

const suggestedModel = () => ({ title: 'Model ID', anyOf: [
  { type: 'string', enum: ['dubbing_v1', 'dubbing_v2'] }, { type: 'string' }, { type: 'null' },
] });
function suggestedForm(media = 'multipart/form-data') {
  const document = nullableFormDocument();
  const schema = body(document); schema.required = []; schema.properties = { model_id: suggestedModel() };
  const content = document.paths['/items'].post.requestBody.content;
  if (media !== 'multipart/form-data') { content[media] = content['multipart/form-data']; delete content['multipart/form-data']; }
  return document;
}

Then('form string suggestions preserve arbitrary strings null rejection and omission', () => {
  for (const media of ['multipart/form-data', 'application/x-www-form-urlencoded']) {
    const document = suggestedForm(media), original = JSON.stringify(document);
    for (const operation of [inspect(document), extractOperations(document, 'nullable-files')[0]]) {
      assert.equal(operation.unavailableReason, undefined);
      const model = operation.fields.find(field => field.name === 'model_id');
      assert.equal(model.type, 'string'); assert.equal(model.nullable, true); assert.equal(model.enum, undefined);
      for (const value of ['dubbing_v1', 'dubbing_v2', 'future-model + & 東京']) {
        const form = requestBody(prepareRequest(operation, { 'body:model_id': value }));
        assert.equal(form.get('model_id'), value);
      }
      assert.equal(requestBody(prepareRequest(operation, {})).has('model_id'), false);
      assert.throws(() => prepareRequest(operation, { 'body:model_id': null }), fieldError('body:model_id'));
    }
    assert.equal(JSON.stringify(document), original);
  }
});

Then('form unions keep exclusive mixed binary and constrained schemas unavailable', () => {
  const exclusive = suggestedModel(); exclusive.oneOf = exclusive.anyOf; delete exclusive.anyOf;
  for (const model of [exclusive, { ...suggestedModel(), maxLength: 4 },
    { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
    { anyOf: [{ type: 'string', format: 'binary' }, { type: 'string' }, { type: 'null' }] },
    { anyOf: [{ type: 'string', enum: [1] }, { type: 'string' }, { type: 'null' }] },
    { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'string', enum: ['b'] }, { type: 'null' }] },
    { anyOf: [{ type: 'string' }, { type: 'null' }], minLength: 1 }]) {
    const document = suggestedForm(); body(document).properties.model_id = model;
    assert.match(inspect(document).unavailableReason, /(?:Form field|Field) "model_id"/);
    assert.throws(() => extractOperations(document, 'nullable-files'), /model_id/);
  }
});

Then('both importers name unsupported structured form fields and custom encoding parts', () => {
  for (const media of ['multipart/form-data', 'application/x-www-form-urlencoded']) {
    const document = suggestedForm(media), content = document.paths['/items'].post.requestBody.content[media];
    content.schema.properties.settings = { type: 'object', properties: { enabled: { type: 'boolean' } } };
    content.schema.properties.chunks = { type: 'array', items: { type: 'object', properties: {} } };
    content.encoding = { model_id: { headers: { 'X-Part': { schema: { type: 'string' } } } }, settings: { style: 'deepObject' } };
    const message = inspect(document).unavailableReason;
    for (const expected of ['Form field "settings" (type=object)', 'Form field "chunks" (type=array)',
      'Form part "model_id": custom encoding (headers)', 'Form part "settings": custom encoding (style)'])
      assert.ok(message.includes(expected), message);
    assert.throws(() => extractOperations(document, 'nullable-files'), error => error.message.endsWith(message));
    const defaultDocument = suggestedForm(media); defaultDocument.paths['/items'].post.requestBody.content[media].encoding = {};
    assert.equal(inspect(defaultDocument).unavailableReason, undefined);
    assert.equal(extractOperations(defaultDocument, 'nullable-files')[0].bodyMediaType, media);
  }
});

Then('ElevenLabs dubbing forms preserve model strings files lists and private credentials', async () => {
  const document = await readServiceSchema('elevenlabs'), original = JSON.stringify(document), id = 'elevenlabs:dubbing_project_create';
  const operation = inspectServiceSchema(document, 'elevenlabs', new Set([id])).operations[0];
  assert.equal(operation.unavailableReason, undefined); assert.equal(operation.path, '/v1/dubbing/project');
  const model = operation.fields.find(field => field.key === 'body:model_id');
  assert.equal(model.type, 'string'); assert.equal(model.nullable, true); assert.equal(model.enum, undefined);
  const index = JSON.parse(gunzipSync(await readFile(new URL('./catalogs/services/indexes/elevenlabs.json.gz', import.meta.url))));
  assert.equal(index.operations.find(entry => entry.id === id).unavailableReason, undefined);
  const descriptor = await approvedOperation(operation, operationServerUrl(document, operation));
  const key = 'elevenlabs-form-private-canary-8173';
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { ElevenLabsApiKey: 'dubbing-key' } };
  const records = [{ id: 'dubbing-key', label: 'Dubbing key', kind: 'secret', value: key, grants: [] }];
  for (const withFile of [false, true]) {
    const values = { 'body:model_id': 'dubbing_v2', 'body:keyterms': '["Super & duper","Ada Lovelace"]',
      'body:webhook_ids': '["hook-one","hook-two"]', 'body:target_language': 'sv',
      ...(withFile ? { 'body:file': JSON.stringify(encodeWorkflowBinary('source.wav', bytes, 'audio/wav')) }
        : { 'body:source_url': 'https://media.example.test/source.mp4' }) };
    const verify = async form => {
      assert.equal(form.get('model_id'), 'dubbing_v2'); assert.equal(form.get('target_language'), 'sv');
      assert.deepEqual(form.getAll('keyterms'), ['Super & duper', 'Ada Lovelace']);
      assert.deepEqual(form.getAll('webhook_ids'), ['hook-one', 'hook-two']);
      assert.equal(form.has('xi-api-key'), false); assert.equal(form.has('transcript'), false);
      if (withFile) {
        assert.equal(form.has('source_url'), false); assert.equal(form.get('file').name, 'source.wav');
        assert.equal(form.get('file').type, 'audio/wav');
        assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), bytes);
      } else { assert.equal(form.has('file'), false); assert.equal(form.get('source_url'), values['body:source_url']); }
    };
    await verify(requestBody(prepareRequest(operation, values))); let calls = 0;
    const result = await executeCredentialed(descriptor, values, binding, records, { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls++; assert.equal(String(url), 'https://api.elevenlabs.io/v1/dubbing/project');
      assert.equal(new Headers(init.headers).get('xi-api-key'), key);
      assert.equal(new Headers(init.headers).has('content-type'), false);
      await verify(await multipart(init)); return Response.json({ project_id: 'test-project' });
    } });
    assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes(key), false);
  }
  assert.throws(() => prepareRequest(operation, { 'body:model_id': null }), fieldError('body:model_id'));
  assert.equal(JSON.stringify(document), original);
});
