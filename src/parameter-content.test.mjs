// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import operations from '../tests/content-parameter-operations.json' with { type: 'json' };
import { queryArrayDocument } from '../tests/query-array.fixture.mjs';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, bitbucketContentParameters } from './lib/schema-patches.ts';
import { bitbucketContentSourceSha256, bitbucketContentPaths } from './lib/parameter-content.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';

const parameter = (schema, location = 'query') => ({ name: 'filter', in: location, ...(location === 'path' ? { required: true } : {}), content: { 'application/json': { schema } } });
function fixture(param, privateRequest = false) {
  const doc = queryArrayDocument(undefined, privateRequest), item = doc.paths['/items']; item.get.parameters = [param];
  if (param.in === 'path') { doc.paths['/items/{filter}'] = item; delete doc.paths['/items']; }
  return doc;
}
const models = doc => [inspectServiceSchema(doc, 'content').operations[0], extractOperations(doc, 'content')[0]];

Then('both importers serialize content parameters as one JSON value', () => {
  const object = { type: ['object', 'null'], properties: { region: { type: 'string', maxLength: 20 }, nested: { type: 'object', additionalProperties: true } }, additionalProperties: false };
  const filter = { region: 'café & +', nested: { tags: ['a,b', 'x/y'], enabled: true, count: 2 } };
  for (const operation of models(fixture(parameter(object)))) {
    assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields[0].parameterContentType, 'application/json');
    const request = prepareRequest(operation, { 'query:filter': JSON.stringify(filter) });
    assert.deepEqual(request.query, { filter: JSON.stringify(filter) });
    assert.deepEqual(JSON.parse(new URL(workflowRequestUrl(request, 'https://content.example.test')).searchParams.get('filter')), filter);
    assert.equal(prepareRequest(operation, { 'query:filter': 'null' }).query.filter, 'null');
    assert.deepEqual(prepareRequest(operation, {}).query, {});
    assert.throws(() => prepareRequest(operation, { 'query:filter': '{bad' }), InputValidationError);
    assert.throws(() => prepareRequest(operation, { 'query:filter': '{"region":"too-long-for-the-declared-bound"}' }), InputValidationError);
  }
  for (const [schema, input, expected] of [
    [{ type: 'string', maxLength: 20 }, 'hello & /', '"hello & /"'],
    [{ type: 'array', items: { type: 'integer' } }, '[1,2]', '[1,2]']
  ]) for (const operation of models(fixture(parameter(schema, 'path')))) {
    assert.equal(prepareRequest(operation, { 'path:filter': input }).path, '/items/'+encodeURIComponent(expected));
    assert.throws(() => prepareRequest(operation, {}), InputValidationError);
  }
});

Then('invalid mixed and unsupported content parameter declarations remain unavailable', () => {
  for (const mutate of [
    value => { value.schema = { type: 'object' }; }, value => { value.style = 'deepObject'; }, value => { value.explode = true; },
    value => { value.allowReserved = true; }, value => { value.allowEmptyValue = false; },
    value => { value.content['application/json'].schema = { type: 'string', format: 'binary' }; },
    value => { value.in = 'header'; }, value => { value.content['text/plain'] = { schema: { type: 'string' } }; },
    value => { value.content = { 'text/plain': { schema: { type: 'string' } } }; }, value => { value.content = {}; },
    value => { delete value.content['application/json'].schema; }, value => { value.content['application/json'].encoding = {}; }
  ]) {
    const param = parameter({ type: 'object' }); mutate(param); const doc = fixture(param);
    const imported = inspectServiceSchema(doc, 'content').operations[0]; assert.match(imported.unavailableReason, /filter/);
    assert.throws(() => extractOperations(doc, 'content'), /filter/);
  }
});

Then('all five native content parameter cases preserve JSON filters or corrected scalar identifiers', async () => {
  assert.equal(operations.length, 5);
  for (const id of operations) {
    const catalog = id.split(':')[0], document = await readServiceSchema(catalog);
    const operation = inspectServiceSchema(document, catalog, new Set([id])).operations[0]; assert.equal(operation.unavailableReason, undefined, id);
    if (catalog === 'mistral') {
      const filter = { region: 'café & +', nested: { labels: ['one', 'two'], value: null } }, field = operation.fields.find(field => field.name === 'metadata');
      assert.equal(field.parameterContentType, 'application/json'); assert.equal(field.nullable, true);
      assert.equal(prepareRequest(operation, { 'query:metadata': JSON.stringify(filter) }).query.metadata, JSON.stringify(filter));
    } else if (operation.method === 'GET') {
      const request = prepareRequest(operation, { 'path:projectKey': 'TEAM', 'path:repositorySlug': 'sample', 'path:commitId': 'abcdef1234' });
      assert.equal(request.path, '/branch-utils/latest/projects/TEAM/repos/sample/branches/info/abcdef1234');
      assert.throws(() => prepareRequest(operation, { 'path:projectKey': 'TEAM', 'path:repositorySlug': 'sample', 'path:commitId': 'a'.repeat(41) }), InputValidationError);
    } else {
      const request = prepareRequest(operation, { 'query:user': 'alice & bob', 'body:text': 'ssh-ed25519 synthetic-public-key' });
      assert.equal(request.query.user, 'alice & bob'); assert.equal(request.body.text, 'ssh-ed25519 synthetic-public-key');
      assert.equal(operation.fields.find(field => field.key === 'query:user').type, 'string');
      assert.equal(operation.fields.find(field => field.key === 'query:user').parameterContentType, undefined);
    }
  }
});

Then('Bitbucket content parameter corrections are source pinned and reject drift', async () => {
  const native = await readServiceSchemaUpstream('bitbucket-dc'), descriptor = serviceSchemaDescriptors.find(item => item.id === 'bitbucket-dc');
  assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'), bitbucketContentSourceSha256);
  const source = applySchemaPatches(native, descriptor.patches.filter(patch => patch.id !== bitbucketContentParameters.id));
  const fixed = applySchemaPatches(source, [bitbucketContentParameters]), restored = structuredClone(fixed);
  for (const [index, path] of bitbucketContentPaths.entries()) {
    const operation = restored.paths[path][index === 0 ? 'get' : 'post'], original = operation['x-upstream-content-parameter'];
    operation.parameters[operation.parameters.findIndex(parameter => parameter.name === original.name && parameter.in === original.in)] = original;
    delete operation['x-upstream-content-parameter'];
  }
  assert.deepEqual(restored, source);
  for (const mutate of [
    doc => { doc.info.version = 'new'; }, doc => { doc.paths[bitbucketContentPaths[0]].get.operationId = 'other'; },
    doc => { doc.paths[bitbucketContentPaths[1]].post.parameters.find(parameter => parameter.name === 'user').content = {}; },
    doc => { doc.paths[bitbucketContentPaths[0]].get['x-upstream-content-parameter'] = {}; }
  ]) { const changed = structuredClone(source); mutate(changed); const before = JSON.stringify(changed);
    assert.throws(() => applySchemaPatches(changed, [bitbucketContentParameters]), /reviewed source contract/); assert.equal(JSON.stringify(changed), before); }
  assert.throws(() => applySchemaPatches(fixed, [bitbucketContentParameters]), /reviewed source contract/);
});

Then('private content parameters redact JSON escapes and reject stale serialization', async () => {
  const source = fixture(parameter({ type: 'object', properties: { token: { type: 'string' } }, additionalProperties: false }), true);
  const operation = inspectServiceSchema(source, 'content').operations[0], descriptor = await approvedOperation(operation, 'https://content.example.test');
  const secret = 'content-private-"quoted"-\\slash-63529', credential = { id: '35be2377-cad0-4b93-bc28-929a3ad26867', label: 'Content key', kind: 'secret', value: secret, grants: [] };
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: credential.id } };
  const variables = [{ key: 'query:filter', path: ['token'], credentialId: credential.id }]; let calls = 0;
  const values = { 'query:filter': JSON.stringify({ token: vaultVariablePlaceholder }) };
  const options = { assertCurrent() {}, variables, fetchRequest: async url => { calls++;
    assert.equal(JSON.parse(new URL(url).searchParams.get('filter')).token, secret); return Response.json({ echo: secret, safe: true }); } };
  const result = await executeCredentialed(descriptor, values, binding, [credential], options);
  for (const value of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(JSON.stringify(secret).slice(1, -1))]) assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(calls, 1);
  const changed = structuredClone(operation); delete changed.fields[0].parameterContentType;
  const stale = await approvedOperation(changed, descriptor.origin); assert.notEqual(stale.fingerprint, descriptor.fingerprint);
  await assert.rejects(executeCredentialed(stale, values, binding, [credential], options), error => error.code === 'PERMISSION'); assert.equal(calls, 1);
});
