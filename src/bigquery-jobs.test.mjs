// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, bigqueryJobMetadata, bigqueryJobSourceSha256, googleOauthAlternatives, schemaPatchName } from './lib/schema-patches.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const pack = 'gcp-bigquery', path = '/projects/{projectId}/jobs', id = `${pack}:bigquery.jobs.insert`;
const origin = 'https://bigquery.googleapis.com/bigquery/v2';
const select = document => inspectServiceSchema(document, pack, new Set([id])).operations[0];
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const identities = document => Object.entries(document.paths).flatMap(([route, item]) => Object.entries(item)
  .filter(([method]) => methods.has(method)).map(([method, operation]) => [route, method, operation.operationId]));
const job = { configuration: { dryRun: true, query: { query: 'SELECT @value', useLegacySql: false,
  queryParameters: [{ name: 'value', parameterType: { type: 'STRING' }, parameterValue: { value: 'synthetic' } }] } },
  jobReference: { projectId: 'example-project', jobId: 'synthetic-job', location: 'EU' } };
const values = { 'path:projectId': 'example-project', 'body:configuration': JSON.stringify(job.configuration), 'body:jobReference': JSON.stringify(job.jobReference) };

Then('BigQuery metadata correction preserves its pinned source identities peers and scopes', async () => {
  const raw = await readServiceSchemaUpstream(pack), before = JSON.stringify(raw);
  const normalized = applySchemaPatches(raw, [googleOauthAlternatives]);
  const corrected = await readServiceSchema(pack), operation = corrected.paths[path].post;
  assert.equal(createHash('sha256').update(before).digest('hex'), bigqueryJobSourceSha256);
  const descriptor = serviceSchemaDescriptors.find(source => source.id === pack);
  assert.equal(descriptor.sha256, bigqueryJobSourceSha256);
  assert.deepEqual(descriptor.patches, [googleOauthAlternatives, bigqueryJobMetadata]);
  assert.equal(identities(corrected).length, 37); assert.deepEqual(identities(corrected), identities(raw));
  assert.deepEqual(corrected.servers, raw.servers);
  assert.deepEqual(operation.requestBody.content, { 'application/json': raw.paths[path].post.requestBody.content['application/octet-stream'] });
  assert.deepEqual(operation['x-upstream-request-body'], raw.paths[path].post.requestBody);
  assert.deepEqual(operation.responses, raw.paths[path].post.responses);
  assert.deepEqual(operation.security, normalized.paths[path].post.security);
  assert.deepEqual(operation['x-upstream-security'], raw.paths[path].post.security);
  const withoutMetadata = structuredClone(corrected);
  withoutMetadata.paths[path].post.requestBody = normalized.paths[path].post.requestBody;
  delete withoutMetadata.paths[path].post['x-upstream-request-body'];
  assert.deepEqual(withoutMetadata, normalized, 'Only the qualified Job request media changes after grant normalization.');
  assert.equal(JSON.stringify(raw), before);
  assert.equal(schemaPatchName(bigqueryJobMetadata), 'BigQuery JSON job metadata');
});

Then('BigQuery job configuration and reference prepare exact metadata without an upload route', async () => {
  const raw = await readServiceSchemaUpstream(pack), document = await readServiceSchema(pack), operation = select(document);
  assert.ok(select(raw).unavailableReason);
  assert.equal(operation.unavailableReason, undefined); assert.equal(operation.bodyMediaType, 'application/json');
  assert.equal(operationServerUrl(document, operation), origin);
  assert.deepEqual(operation.fields.filter(field => field.location === 'body').map(field => field.name), ['configuration', 'jobReference']);
  const request = prepareRequest(operation, values);
  assert.equal(request.method, 'POST'); assert.equal(request.path, '/projects/example-project/jobs');
  assert.deepEqual(request.body, job); assert.deepEqual(request.query, {});
  assert.equal(document.paths['/upload/bigquery/v2/projects/{projectId}/jobs'], undefined);
  assert.equal(operation.binaryBody, undefined);
  assert.equal(operation.security.length, 10);
  for (const [alternative, schemes] of operation.security.entries()) {
    assert.equal(schemes.length, 1); assert.equal(schemes[0].kind, 'bearer');
    assert.equal(operation.oauthScopes[alternative][schemes[0].name].length, 1);
  }
});

Then('BigQuery metadata dispatch uses one private bearer request and rejects stale authority', async () => {
  const document = await readServiceSchema(pack), operation = select(document), descriptor = await approvedOperation(operation, origin);
  const credential = { id: crypto.randomUUID(), label: 'Synthetic Google token', kind: 'secret', value: 'bigquery-private-canary-5321', grants: [] };
  const binding = alternative => ({ fingerprint: descriptor.fingerprint, alternative,
    credentials: { [operation.security[alternative][0].name]: credential.id } });
  for (const alternative of [0, 1]) {
    let calls = 0;
    const result = await executeCredentialed(descriptor, values, binding(alternative), [credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls++; assert.equal(String(url), `${origin}/projects/example-project/jobs`);
      assert.equal(init.method, 'POST'); assert.equal(init.headers.get('Content-Type'), 'application/json');
      assert.equal(init.headers.get('Authorization'), `Bearer ${credential.value}`);
      assert.equal(init.body, JSON.stringify(job)); assert.equal(init.credentials, 'omit');
      return Response.json({ ...job, diagnostic: credential.value });
    } });
    assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes(credential.value));
  }
  let forbiddenCalls = 0;
  const noFetch = { assertCurrent() {}, fetchRequest: async () => { forbiddenCalls++; throw Error('Unexpected dispatch'); } };
  await assert.rejects(executeCredentialed(descriptor, values, binding(0), [], noFetch), { code: 'PERMISSION' });
  const changed = await approvedOperation({ ...operation, path: `${path}/changed` }, origin);
  await assert.rejects(executeCredentialed(changed, values, binding(0), [credential], noFetch), { code: 'PERMISSION' });
  assert.equal(forbiddenCalls, 0); assert.ok(!JSON.stringify(prepareRequest(operation, values)).includes(credential.value));
});

Then('BigQuery metadata correction rejects changed destinations bodies and provenance', async () => {
  const raw = await readServiceSchemaUpstream(pack);
  const change = (object, parts, value) => { const parent = parts.slice(0, -1).reduce((current, key) => current[key], object); parent[parts.at(-1)] = value; };
  const op = ['paths', path, 'post'], body = [...op, 'requestBody'], content = [...body, 'content'];
  const variants = [
    [['openapi'], '3.1.0'], [['info'], undefined], [['info', 'title'], 'Foreign'], [['info', 'version'], 'v3'],
    [['servers'], undefined], [['servers'], []], [['servers'], [null]], [['servers'], [{ url: 'https://example.com' }]],
    [['servers'], [{ url: origin }, { url: origin }]], [['paths'], undefined], [['paths', path], null], [['paths', path], []],
    [['paths', path, 'servers'], []], [op, undefined], [op, []], [[...op, 'operationId'], 'foreign'], [[...op, 'servers'], []],
    [body, undefined], [body, []], [content, undefined], [content, []], [content, {}],
    [content, { 'application/json': {}, 'application/octet-stream': {} }], [content, { 'text/plain': {} }],
    [[...content, 'application/octet-stream'], null], [[...content, 'application/octet-stream'], []],
    [[...content, 'application/octet-stream', 'schema'], undefined], [[...content, 'application/octet-stream', 'schema'], { $ref: '#/components/schemas/Other' }],
    [['components'], undefined], [['components', 'schemas'], undefined], [['components', 'schemas', 'Job'], undefined],
    [['components', 'schemas', 'Job', 'type'], 'array'], [[...op, 'responses'], undefined], [[...op, 'responses', '200'], undefined],
    [[...op, 'responses', '200', 'content'], undefined], [[...op, 'responses', '200', 'content', 'application/json'], undefined],
    [[...op, 'responses', '200', 'content', 'application/json', 'schema'], undefined],
    [[...op, 'responses', '200', 'content', 'application/json', 'schema', '$ref'], '#/components/schemas/Other'],
    [[...op, 'x-upstream-request-body'], {}],
  ];
  for (const [parts, value] of variants) {
    const input = structuredClone(raw); change(input, parts, value); const before = structuredClone(input);
    assert.throws(() => applySchemaPatches(input, [bigqueryJobMetadata]), /BigQuery job metadata/, parts.join('/'));
    assert.deepEqual(input, before, 'A rejected correction cannot mutate its source.');
  }
});

Then('BigQuery metadata correction preserves an already correct Job body and reviewed provenance', async () => {
  const raw = await readServiceSchemaUpstream(pack), corrected = applySchemaPatches(raw, [bigqueryJobMetadata]);
  assert.deepEqual(applySchemaPatches(corrected, [bigqueryJobMetadata]), corrected);
  const upstream = structuredClone(raw), operation = upstream.paths[path].post;
  operation.requestBody = { required: true, description: 'Metadata only', content: { 'application/json': operation.requestBody.content['application/octet-stream'] } };
  assert.deepEqual(applySchemaPatches(upstream, [bigqueryJobMetadata]), upstream);
  assert.equal(upstream.paths[path].post['x-upstream-request-body'], undefined);
});
