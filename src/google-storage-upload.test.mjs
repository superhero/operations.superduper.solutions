// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, googleOauthAlternatives, googleStorageMedia, googleStorageMediaSourceSha256, schemaPatchName } from './lib/schema-patches.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { CredentialResponseError, executeCredentialed } from './lib/secrets/execution.ts';

const pack = 'gcp-storage', path = '/b/{bucket}/o', id = `${pack}:storage.objects.insert`;
const origin = 'https://storage.googleapis.com/upload/storage/v1', metadataOrigin = 'https://storage.googleapis.com/storage/v1';
const select = document => inspectServiceSchema(document, pack, new Set([id])).operations[0];
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const identities = document => Object.entries(document.paths).flatMap(([route, item]) => Object.entries(item)
  .filter(([method]) => methods.has(method)).map(([method, operation]) => [route, method, operation.operationId]));
const bytes = Uint8Array.of(0, 255, 13, 10, 128, 1), objectName = 'folder/A & Ω+.bin';
const file = encodeWorkflowBinary('source.bin', bytes, 'application/x-custom');
const values = { 'path:bucket': 'synthetic-bucket', 'query:name': objectName, 'query:uploadType': 'media',
  'query:ifGenerationMatch': '0', 'body:$': JSON.stringify(file) };
async function fixture() {
  const document = await readServiceSchema(pack), operation = select(document), descriptor = await approvedOperation(operation, origin);
  const credential = { id: crypto.randomUUID(), label: 'Synthetic Google token', kind: 'secret', value: 'google-media-private-canary-7854', grants: [] };
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { [operation.security[0][0].name]: credential.id } };
  return { document, operation, descriptor, credential, binding };
}

Then('Google Storage media correction retains source provenance and all native identities', async () => {
  const raw = await readServiceSchemaUpstream(pack), before = JSON.stringify(raw), normalized = applySchemaPatches(raw, [googleOauthAlternatives]);
  const document = await readServiceSchema(pack), operation = document.paths[path].post;
  assert.equal(createHash('sha256').update(before).digest('hex'), googleStorageMediaSourceSha256);
  const descriptor = serviceSchemaDescriptors.find(source => source.id === pack);
  assert.equal(descriptor.sha256, googleStorageMediaSourceSha256); assert.deepEqual(descriptor.patches, [googleOauthAlternatives, googleStorageMedia]);
  assert.deepEqual(identities(document), identities(raw)); assert.equal(identities(document).length, 76);
  assert.deepEqual(operation['x-upstream-google-storage-contract'], { requestBody: raw.paths[path].post.requestBody,
    parameters: raw.paths[path].post.parameters, description: raw.paths[path].post.description });
  assert.deepEqual(operation.responses, raw.paths[path].post.responses); assert.deepEqual(operation.security, normalized.paths[path].post.security);
  const restored = structuredClone(document), target = restored.paths[path].post;
  Object.assign(target, target['x-upstream-google-storage-contract']); delete target['x-upstream-google-storage-contract']; delete target.servers;
  assert.deepEqual(restored, normalized, 'All other operations and provider contracts are unchanged.');
  assert.ok(select(raw).unavailableReason); assert.equal(select(document).unavailableReason, undefined);
  assert.equal(operationServerUrl(document, { method: 'GET', path }), metadataOrigin, 'The neighboring list method retains the metadata route.');
  assert.equal(JSON.stringify(raw), before); assert.equal(schemaPatchName(googleStorageMedia), 'Google Storage media upload');
});

Then('Google Storage media dispatch sends one private raw file and receives bounded Object JSON', async () => {
  const f = await fixture(); assert.equal(operationServerUrl(f.document, f.operation), origin);
  assert.equal(f.operation.bodyRequired, true); assert.equal(f.operation.bodyValue, true);
  const request = prepareRequest(f.operation, values); assert.equal(request.bodyFormat, 'binary'); assert.deepEqual(request.body, file);
  assert.equal(request.contentType, file.mediaType); assert.equal(f.operation.fields.find(field => field.key === 'query:uploadType').defaultValue, 'media');
  for (const alternative of [0, 1]) {
    const binding = { ...f.binding, alternative, credentials: { [f.operation.security[alternative][0].name]: f.credential.id } };
    let calls = 0, fetchError;
    const result = await executeCredentialed(f.descriptor, values, binding, [f.credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
      try {
        calls++; const target = new URL(url);
        assert.equal(target.origin + target.pathname, `${origin}/b/synthetic-bucket/o`);
        assert.equal(target.search, '?uploadType=media&ifGenerationMatch=0&name=folder%2FA+%26+%CE%A9%2B.bin');
        assert.equal(target.searchParams.get('name'), objectName); assert.equal(init.method, 'POST');
        assert.equal(init.headers.get('Authorization'), `Bearer ${f.credential.value}`); assert.equal(init.headers.get('Content-Type'), file.mediaType);
        assert.equal(init.headers.has('Content-Length'), false, 'Fetch owns the raw Blob length in a browser.');
        assert.ok(init.body instanceof Blob); assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), bytes);
        assert.equal(init.body.type, file.mediaType); assert.equal(init.credentials, 'omit');
        return Response.json({ kind: 'storage#object', name: objectName, generation: '1', size: String(bytes.length), diagnostic: f.credential.value });
      } catch (error) { fetchError = error; throw error; }
    } }).catch(error => { throw fetchError ?? error; });
    assert.equal(calls, 1); assert.equal(result.response.body.name, objectName); assert.equal(result.response.body.size, String(bytes.length));
    assert.ok(!JSON.stringify(result).includes(f.credential.value));
  }
});

Then('Google Storage media rejects missing names files multipart resumable and malformed binary inputs', async () => {
  const f = await fixture(); let calls = 0;
  const changes = [{ 'query:name': '' }, { 'query:name': null }, { 'query:uploadType': '' }, { 'query:uploadType': 'multipart' },
    { 'query:uploadType': 'resumable' }, { 'body:$': '' }, { 'body:$': null }, { 'body:$': '{"name":"metadata-only"}' },
    { 'body:$': JSON.stringify({ ...file, size: file.size + 1 }) }, { 'body:$': JSON.stringify({ ...file, mediaType: 'text/plain\r\nX-Test: yes' }) },
    { 'body:$': JSON.stringify({ ...file, size: 500001, base64: Buffer.alloc(500001).toString('base64') }) }];
  for (const changed of changes) await assert.rejects(executeCredentialed(f.descriptor, { ...values, ...changed }, f.binding, [f.credential], {
    assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); },
  }));
  assert.equal(calls, 0); assert.ok(!f.operation.fields.some(field => field.name === 'metadata'));
});

Then('Google Storage media failure recovery never retries implicitly or leaks a bearer token', async () => {
  const f = await fixture(); let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => {
    calls++; if (calls === 1) return Response.json({ error: { message: f.credential.value } }, { status: 403 });
    return Response.json({ name: objectName, size: '6' });
  } };
  await assert.rejects(executeCredentialed(f.descriptor, values, f.binding, [f.credential], options), error => {
    assert.ok(error instanceof CredentialResponseError); assert.equal(error.response.status, 403);
    assert.ok(!JSON.stringify(error.response).includes(f.credential.value)); return true;
  });
  assert.equal(calls, 1);
  const result = await executeCredentialed(f.descriptor, values, f.binding, [f.credential], options);
  assert.equal(calls, 2); assert.equal(result.response.status, 200); assert.equal(result.response.body.name, objectName);
});

Then('Google Storage media rejects missing credentials and stale destination bindings before dispatch', async () => {
  const f = await fixture(); let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; throw Error('Unexpected fetch'); } };
  await assert.rejects(executeCredentialed(f.descriptor, values, f.binding, [], options), { code: 'PERMISSION' });
  const old = await approvedOperation(f.operation, metadataOrigin);
  await assert.rejects(executeCredentialed(f.descriptor, values, { ...f.binding, fingerprint: old.fingerprint }, [f.credential], options), { code: 'PERMISSION' });
  assert.equal(calls, 0); assert.notEqual(old.fingerprint, f.descriptor.fingerprint);
});

Then('Google Storage media rejects changed destinations parameters shapes and provenance', async () => {
  const raw = await readServiceSchemaUpstream(pack), op = ['paths', path, 'post'], body = [...op, 'requestBody'];
  const parameters = raw.paths[path].post.parameters;
  const changedParams = change => { const next = structuredClone(parameters); change(next); return next; };
  const variants = [
    [['openapi'], '3.1.0'], [['info'], undefined], [['info', 'title'], 'Other'], [['info', 'version'], 'v2'],
    [['servers'], undefined], [['servers'], []], [['servers'], [null]], [['servers'], [{ url: 'https://example.com' }]],
    [['paths'], undefined], [['paths', path], []], [['paths', path, 'servers'], []], [op, undefined], [op, []],
    [[...op, 'operationId'], 'foreign'], [[...op, 'servers'], []], [body, undefined], [body, []],
    [[...body, 'content'], undefined], [[...body, 'content'], []], [[...body, 'content'], {}], [[...body, 'content'], { 'text/plain': {} }],
    [[...body, 'content'], { 'application/octet-stream': {}, 'application/json': {} }],
    [[...body, 'content'], { 'application/octet-stream': { schema: { type: 'object' } } }],
    [['components'], undefined], [['components', 'schemas'], undefined], [['components', 'schemas', 'Object'], undefined], [['components', 'schemas', 'Object', 'type'], 'string'],
    [[...op, 'responses'], undefined], [[...op, 'responses', '200'], undefined], [[...op, 'responses', '200', 'content'], undefined],
    [[...op, 'responses', '200', 'content', 'application/json'], undefined], [[...op, 'responses', '200', 'content', 'application/json', 'schema'], undefined],
    [[...op, 'responses', '200', 'content', 'application/json', 'schema', '$ref'], '#/components/schemas/Other'],
    [[...op, 'parameters'], undefined], [[...op, 'parameters'], []], [[...op, 'parameters'], changedParams(p => { p[1] = null; })],
    [[...op, 'parameters'], changedParams(p => { p[0].in = 'query'; })], [[...op, 'parameters'], changedParams(p => { p[0].required = false; })],
    [[...op, 'parameters'], changedParams(p => { delete p[0].schema; })], [[...op, 'parameters'], changedParams(p => { p[0].schema.type = 'integer'; })],
    [[...op, 'parameters'], changedParams(p => { p.find(p => p.name === 'name').in = 'path'; })],
    [[...op, 'parameters'], changedParams(p => { delete p.find(p => p.name === 'name').schema; })],
    [[...op, 'parameters'], changedParams(p => { p.find(p => p.name === 'name').schema.type = 'integer'; })],
    [[...op, 'parameters'], changedParams(p => { p[1].name = 'uploadType'; })], [[...op, 'x-upstream-google-storage-contract'], {}],
  ];
  for (const [parts, value] of variants) {
    const input = structuredClone(raw), parent = parts.slice(0, -1).reduce((target, key) => target[key], input); parent[parts.at(-1)] = value;
    const before = structuredClone(input);
    assert.throws(() => applySchemaPatches(input, [googleStorageMedia]), /Google Storage media/, parts.join('/')); assert.deepEqual(input, before);
  }
});
