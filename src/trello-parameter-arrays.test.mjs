// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { trelloArrayPaths, trelloParameterSourceSha256 } from './lib/trello-parameter-arrays.ts';
import { applySchemaPatches, trelloParameterArrays, schemaPatchName } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const id = '5abbe4b7ddc1b351ef961414', other = '5abbe4b7ddc1b351ef961415';
const ids = new Set(trelloArrayPaths.map(path => `trello:GET ${path}`));
const model = async () => inspectServiceSchema(await readServiceSchema('trello'), 'trello', ids).operations;
const failAt = key => error => error instanceof InputValidationError && error.fieldKey === key;

Then('the three native Trello array operations prepare exact validated requests', async () => {
  const document = await readServiceSchema('trello'), selected = structuredClone(document);
  selected.paths = Object.fromEntries(trelloArrayPaths.map(path => [path, structuredClone(document.paths[path])]));
  for (const item of Object.values(selected.paths)) for (const method of ['post', 'put', 'delete', 'patch']) delete item[method];
  // Isolate strict input parsing from the native OAuth permission annotations,
  // which the complete service importer retains in the canonical models below.
  selected.security = []; for (const item of Object.values(selected.paths)) item.get.security = [];
  const source = inspectServiceSchema(document, 'trello', ids).operations, strict = extractOperations(selected, 'trello');
  assert.equal(source.length, 3); assert.equal(strict.length, 3);
  for (const operation of [...source, ...strict]) {
    assert.equal(operation.unavailableReason, undefined, operation.id);
    const attachment = operation.path.startsWith('/cards/');
    const values = attachment ? { 'path:id': id, 'path:idAttachment': other, 'query:fields': '["id","name"]' }
      : { 'path:id': id, 'path:idOrganizations': JSON.stringify([id, other]) };
    const request = prepareRequest(operation, values);
    const expected = attachment ? `/cards/${id}/attachments/${other}?fields=id,name`
      : operation.path.replace('{id}', id).replace('{idOrganizations}', `${id},${other}`);
    assert.equal(workflowRequestUrl(request, 'https://api.trello.com/1'), `https://api.trello.com/1${expected}`);
    const key = attachment ? 'query:fields' : 'path:idOrganizations';
    for (const invalid of [null, [{ id }], [null], ['not-an-id-or-field'], ...(attachment ? [] : [[]])])
      assert.throws(() => prepareRequest(operation, { ...values, [key]: JSON.stringify(invalid) }), failAt(key));
    if (!attachment) {
      const absent = { ...values }; delete absent[key]; assert.throws(() => prepareRequest(operation, absent), failAt(key));
      assert.equal(operation.fields.find(field => field.key === key).schema.items.pattern, '^[0-9a-fA-F]{24}$');
    } else assert.deepEqual(operation.fields.find(field => field.key === key).schema.items.enum, document.components.schemas.AttachmentFields.enum);
  }
});

Then('Trello array corrections preserve native evidence and reject changed contracts', async () => {
  const native = await readServiceSchemaUpstream('trello'), descriptor = serviceSchemaDescriptors.find(item => item.id === 'trello');
  assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'), trelloParameterSourceSha256);
  assert.equal(schemaPatchName(trelloParameterArrays), 'Trello primitive parameter arrays');
  const before = applySchemaPatches(native, descriptor.patches.filter(patch => patch.id !== trelloParameterArrays.id));
  const original = JSON.stringify(before), fixed = applySchemaPatches(before, [trelloParameterArrays]), restored = structuredClone(fixed);
  for (const path of trelloArrayPaths) {
    const operation = restored.paths[path].get, original = operation['x-upstream-array-items'];
    const parameter = operation.parameters.find(parameter => parameter.name === original.name);
    assert.deepEqual(original.items, before.paths[path].get.parameters.find(item => item.name === parameter.name).schema.items);
    parameter.schema.items = original.items; delete operation['x-upstream-array-items'];
  }
  assert.deepEqual(restored, before); assert.equal(JSON.stringify(before), original);
  for (const mutate of [
    value => { value.info.version = 'new'; }, value => { value.info.title = 'Other'; },
    value => { value.components.schemas.TrelloID.pattern = '.*'; },
    value => { value.paths[trelloArrayPaths[0]].get.operationId = 'other'; },
    value => { value.paths[trelloArrayPaths[1]].get.parameters[1].schema.items = { type: 'object' }; },
    value => { value.paths[trelloArrayPaths[0]].get['x-upstream-array-items'] = {}; }
  ]) {
    const changed = structuredClone(before); mutate(changed); const snapshot = JSON.stringify(changed);
    assert.throws(() => applySchemaPatches(changed, [trelloParameterArrays]), /reviewed source contract/); assert.equal(JSON.stringify(changed), snapshot);
  }
  assert.throws(() => applySchemaPatches(fixed, [trelloParameterArrays]), /reviewed source contract/);
});

Then('a Trello bulk request keeps credentials private and rejects invalid identifiers before fetch', async () => {
  const operation = (await model()).find(operation => operation.path === trelloArrayPaths[1]), descriptor = await approvedOperation(operation, 'https://api.trello.com/1');
  const alternative = operation.security.findIndex(option => option.length && option.every(scheme => scheme.kind === 'apiKey'));
  assert.ok(alternative >= 0);
  const schemes = operation.security[alternative], credentials = schemes.map((scheme, index) => ({ id: `trello-key-${index}`, label: scheme.name,
    kind: 'secret', value: `trello-synthetic-private-${index}-68302`, grants: [] }));
  const binding = { alternative, fingerprint: descriptor.fingerprint, credentials: Object.fromEntries(schemes.map((scheme, index) => [scheme.name, credentials[index].id])) };
  let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async url => {
    calls++; const request = new URL(url);
    assert.equal(request.pathname, `/1/enterprises/${id}/organizations/bulk/${id},${other}`);
    schemes.forEach((scheme, index) => assert.equal(request.searchParams.get(scheme.query), credentials[index].value));
    return Response.json({ organizations: [id, other], echo: credentials.map(item => item.value) });
  } };
  await assert.rejects(executeCredentialed(descriptor, { 'path:id': id, 'path:idOrganizations': '[{}]' }, binding, credentials, options), failAt('path:idOrganizations'));
  assert.equal(calls, 0);
  const result = await executeCredentialed(descriptor, { 'path:id': id, 'path:idOrganizations': JSON.stringify([id, other]) }, binding, credentials, options);
  assert.equal(calls, 1); for (const item of credentials) assert.equal(JSON.stringify(result).includes(item.value), false);
  const changed = structuredClone(operation); changed.fields.find(field => field.key === 'path:idOrganizations').schema.items.minLength = 1;
  const stale = await approvedOperation(changed, descriptor.origin);
  await assert.rejects(executeCredentialed(stale, {}, binding, credentials, options), error => error.code === 'PERMISSION'); assert.equal(calls, 1);
});
