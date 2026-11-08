// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readCatalogPathBindings } from './lib/catalog-path-bindings.ts';
import { applySchemaPatches, catalogPathBindings, schemaPatchName } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { InputValidationError, prepareRequest } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const contracts = readCatalogPathBindings();
async function baseline(catalog) {
  const native = await readServiceSchemaUpstream(catalog), descriptor = serviceSchemaDescriptors.find(source => source.id === catalog);
  return { native, source: applySchemaPatches(native, descriptor.patches.slice(0, descriptor.patches.findIndex(patch => patch.id === catalogPathBindings.id))) };
}
async function model(id) {
  const catalog = id.slice(0, id.indexOf(':')), source = await readServiceSchema(catalog);
  return inspectServiceSchema(source, catalog, new Set([id])).operations[0];
}

Then('all 51 corrected catalog bindings retain their source identities and available models', async () => {
  assert.equal(contracts.operations.length, 51); assert.equal(new Set(contracts.operations.map(operation => operation.id)).size, 51);
  assert.equal(schemaPatchName(catalogPathBindings), 'Reviewed catalog path parameter bindings');
  for (const [catalog, pin] of Object.entries(contracts.sources)) {
    const { native, source } = await baseline(catalog), original = JSON.stringify(source), corrected = await readServiceSchema(catalog);
    assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'), pin.sha256);
    const descriptor = serviceSchemaDescriptors.find(source => source.id === catalog);
    assert.deepEqual(corrected, applySchemaPatches(source, descriptor.patches.slice(descriptor.patches.findIndex(patch => patch.id === catalogPathBindings.id)))); assert.equal(JSON.stringify(source), original);
    const expected = contracts.operations.filter(operation => operation.catalog === catalog), ids = new Set(expected.map(operation => operation.id));
    const operations = inspectServiceSchema(corrected, catalog, ids).operations; assert.equal(operations.length, ids.size);
    for (const operation of operations) {
      assert.equal(operation.unavailableReason, undefined, operation.id);
      const raw = source.paths[operation.path][operation.method.toLowerCase()], repaired = corrected.paths[operation.path][operation.method.toLowerCase()];
      assert.equal(operation.id, `${catalog}:${raw.operationId}`); assert.equal(repaired.operationId, raw.operationId);
      assert.deepEqual(repaired['x-upstream-parameters'], raw.parameters ?? null); assert.deepEqual(repaired.security, raw.security);
    }
    const rebuilt = applySchemaPatches(source, [catalogPathBindings]);
    for (const contract of expected) {
      const operation = rebuilt.paths[contract.path][contract.method.toLowerCase()];
      if (contract.parameters === null) delete operation.parameters; else operation.parameters = structuredClone(contract.parameters);
      delete operation['x-upstream-parameters'];
    }
    assert.deepEqual(rebuilt, source, 'Only the explicitly selected operation parameters change.');
  }
});

Then('corrected identifier bindings prepare exact paths and reject missing required values', async () => {
  const cases = [
    ['atlassian-admin-organizations:GET /v2/orgs/{orgId}/directories/{directoryId}/users/{userId}',
      { orgId: 'org-1', directoryId: 'dir-1', userId: 'account-1' }, '/v2/orgs/org-1/directories/dir-1/users/account-1'],
    ['atlassian-incidents:GET /jsm/incidents/cloudId/{cloudId}/v1/incident/{issueID}',
      { cloudId: 'site-1', issueID: '123' }, '/jsm/incidents/cloudId/site-1/v1/incident/123'],
    ['bitbucket-dc:GET /api/latest/projects/{projectKey}/repos/{repositorySlug}/secret-scanning/exempt',
      { projectKey: 'TEAM', repositorySlug: 'repo-name' }, '/api/latest/projects/TEAM/repos/repo-name/secret-scanning/exempt'],
    ['jira-service-management-ops:GET /api/{cloudId}/v1/integrations/{integrationId}/actions',
      { cloudId: 'site-1', integrationId: 'integration-1' }, '/api/site-1/v1/integrations/integration-1/actions']
  ];
  for (const [id, paths, expected] of cases) {
    const operation = await model(id), values = Object.fromEntries(Object.entries(paths).map(([name, value]) => [`path:${name}`, value]));
    assert.equal(prepareRequest(operation, values).path, expected);
    for (const name of Object.keys(paths)) {
      const omitted = { ...values }; delete omitted[`path:${name}`];
      assert.throws(() => prepareRequest(operation, omitted), error => error instanceof InputValidationError && error.fieldKey === `path:${name}`);
    }
  }
  const trello = await model('trello:PUT /cards/{idCard}/customFields');
  assert.equal(trello.fields.find(field => field.key === 'path:idCard').pattern, '^[0-9a-fA-F]{24}$');
  assert.throws(() => prepareRequest(trello, { 'path:idCard': 'invalid' }), error => error instanceof InputValidationError && error.fieldKey === 'path:idCard');
});

Then('corrected query parameters and removed aliases preserve their documented request locations', async () => {
  for (const catalog of ['jira-dc', 'jira-service-management-dc']) {
    const operation = await model(`${catalog}:DELETE /api/2/issuetype/{id}`);
    const moved = operation.fields.find(field => field.name === 'alternativeIssueTypeId'); assert.equal(moved.location, 'query'); assert.equal(moved.required, false);
    const prepared = prepareRequest(operation, { 'path:id': '10000', 'query:alternativeIssueTypeId': '10001' });
    assert.equal(workflowRequestUrl(prepared, 'https://jira.synthetic.example.test/rest'),
      'https://jira.synthetic.example.test/rest/api/2/issuetype/10000?alternativeIssueTypeId=10001');
    assert.deepEqual(prepareRequest(operation, { 'path:id': '10000' }).query, {});
    const permission = await model(`${catalog}:DELETE /api/2/filter/{id}/permission/{permission-id}`);
    assert.equal(permission.fields.some(field => field.key === 'path:permissionId'), false);
    assert.equal(prepareRequest(permission, { 'path:id': '1', 'path:permission-id': '2' }).path, '/api/2/filter/1/permission/2');
  }
  const session = await model('bamboo:DELETE /admin/latest/session/{name}');
  assert.equal(session.fields.some(field => field.name === 'user'), false);
  assert.equal(prepareRequest(session, { 'path:name': 'user-1', 'path:user': 'ignored' }).path, '/admin/latest/session/user-1');
});

Then('catalog path corrections reject drift unresolved references and provenance overwrites', async () => {
  const { source } = await baseline('atlassian-admin-organizations'), contract = contracts.operations.find(operation => operation.catalog === 'atlassian-admin-organizations');
  const target = document => document.paths[contract.path][contract.method.toLowerCase()];
  for (const change of [
    document => { document.info.version = 'future'; }, document => { document.servers = []; },
    document => { target(document).operationId = 'other'; }, document => { target(document).parameters = []; },
    document => { target(document)['x-upstream-parameters'] = null; },
    document => { delete document.components.parameters.accountIdParam; },
    document => { document.components.parameters.accountIdParam = { $ref: '#/components/parameters/accountIdParam' }; },
    document => { document.components.parameters.accountIdParam = { $ref: 'https://unrelated.example.test/parameter' }; },
    document => { document.components.parameters.accountIdParam = { $ref: '#/components/parameters/orgIdParam', description: 'sibling' }; }
  ]) {
    const modified = structuredClone(source); change(modified); const original = JSON.stringify(modified);
    assert.throws(() => applySchemaPatches(modified, [catalogPathBindings]), /reviewed source contract/); assert.equal(JSON.stringify(modified), original);
  }
  const repaired = applySchemaPatches(source, [catalogPathBindings]); assert.throws(() => applySchemaPatches(repaired, [catalogPathBindings]), /reviewed source contract/);
});

Then('a corrected organization user request retains private authorization and exact identifiers', async () => {
  const operation = await model('atlassian-admin-organizations:GET /v2/orgs/{orgId}/directories/{directoryId}/users/{userId}');
  const descriptor = await approvedOperation(operation, 'https://admin.synthetic.example.test');
  const alternative = operation.security.findIndex(option => option.length === 1 && option[0].kind === 'bearer'); assert.ok(alternative >= 0);
  const name = operation.security[alternative][0].name, value = 'binding-private-synthetic-token-7234';
  const credentials = [{ id: 'binding-key', label: 'Binding key', kind: 'secret', value, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { [name]: 'binding-key' } }; let calls = 0;
  const output = await executeCredentialed(descriptor, { 'path:orgId': 'org-1', 'path:directoryId': 'dir-1', 'path:userId': 'account-1' }, binding, credentials,
    { assertCurrent() {}, fetchRequest: async (url, init) => { calls++; assert.equal(String(url), 'https://admin.synthetic.example.test/v2/orgs/org-1/directories/dir-1/users/account-1');
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${value}`); return Response.json({ safe: true }); } });
  assert.equal(calls, 1); assert.equal(JSON.stringify(output).includes(value), false);
  const changed = structuredClone(operation); changed.fields.find(field => field.key === 'path:userId').schema = { type: 'string', minLength: 2 };
  const other = await approvedOperation(changed, descriptor.origin); assert.notEqual(other.fingerprint, descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other, {}, binding, credentials, { assertCurrent() {} }), error => error.code === 'PERMISSION');
});
