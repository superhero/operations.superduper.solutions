// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import operations from '../tests/atlassian-dc-operations.json' with { type: 'json' };
import catalogSources from './catalogs/services/index.json' with { type: 'json' };
import { atlassianDcAuthenticationSources } from './lib/atlassian-dc-authentication.ts';
import { applySchemaPatches, atlassianDcAuthentication, schemaPatchName } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperationSecurity } from './lib/operation-security.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const rows = document => Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item)
  .filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path, method, operation })));
const patch = document => applySchemaPatches(document, [atlassianDcAuthentication]);

Then('all 699 reviewed Data Center operations retain source scopes alternatives and identity', async () => {
  assert.equal(Object.values(operations).flat().length, 699);
  assert.equal(new Set(Object.values(operations).flat()).size, 699);
  assert.equal(schemaPatchName(atlassianDcAuthentication), 'Atlassian Data Center bearer permissions');
  for (const [catalog, ids] of Object.entries(operations)) {
    const upstream = await readServiceSchemaUpstream(catalog), original = JSON.stringify(upstream), source = await readServiceSchema(catalog);
    assert.equal(createHash('sha256').update(original).digest('hex'), atlassianDcAuthenticationSources[catalog]);
    const descriptor = catalogSources.find(source => source.id === catalog);
    assert.deepEqual(source, applySchemaPatches(upstream, descriptor.patches)); assert.equal(JSON.stringify(upstream), original);
    assert.deepEqual(source.components.securitySchemes, patch(upstream).components.securitySchemes);
    assert.deepEqual(source['x-upstream-security-schemes'], upstream.components.securitySchemes);
    const selected = inspectServiceSchema(source, catalog, new Set(ids)).operations;
    assert.equal(selected.length, ids.length);
    for (const model of selected) {
      assert.equal(model.unavailableReason, undefined, model.id);
      const native = upstream.paths[model.path][model.method.toLowerCase()], corrected = source.paths[model.path][model.method.toLowerCase()];
      assert.equal(model.id, `${catalog}:${native.operationId}`); assert.equal(corrected.operationId, native.operationId);
      assert.deepEqual(corrected['x-upstream-security'], native.security);
      assert.deepEqual(model.security.map(option => option.map(scheme => scheme.name)), native.security.map(option => Object.keys(option)));
      assert.deepEqual(model.credentialPermissions, native.security.map(option => option.OAuth2 ? { OAuth2: option.OAuth2 } : {}));
      assert.ok(model.security.flat().some(scheme => scheme.name === 'OAuth2' && scheme.kind === 'bearer'));
    }
  }
});

Then('Data Center authentication corrections reject source drift and permission overwrites', async () => {
  const source = await readServiceSchemaUpstream('bamboo');
  const scoped = document => rows(document).find(row => row.operation.security?.some(option => option.OAuth2)).operation;
  const changes = [
    document => { document.info.title = 'Other'; }, document => { document.info.version = 'future'; },
    document => { document.openapi = '3.1.0'; }, document => { document.servers[0].url = 'https://unrelated.example.test'; },
    document => { document.security = []; }, document => { document.components.securitySchemes.OAuth2 = { type: 'http', scheme: 'bearer' }; },
    document => { document.components.securitySchemes.basic.scheme = 'bearer'; },
    document => { document['x-upstream-security-schemes'] = {}; },
    document => { scoped(document).security = 'bad'; }, document => { scoped(document).security = [null]; },
    document => { scoped(document).security = [{ OAuth2: ['READ'], basic: [] }]; },
    document => { scoped(document).security = [{ basic: ['READ'] }]; },
    document => { scoped(document).security = [{ OAuth2: ['READ', 'WRITE'] }]; },
    document => { scoped(document).security = [{ OAuth2: ['unreviewed'] }]; },
    document => { scoped(document)['x-upstream-security'] = []; },
    document => { scoped(document)['x-credential-permissions'] = []; },
    document => { delete document.paths[rows(document)[0].path]; },
    document => { scoped(document).security = []; }, document => { document.paths['/bad'] = null; },
    document => { document.paths['/bad'] = { get: null }; }
  ];
  for (const change of changes) {
    const changed = structuredClone(source); change(changed); const original = JSON.stringify(changed);
    assert.throws(() => patch(changed), /reviewed source contract/); assert.equal(JSON.stringify(changed), original);
  }
  assert.throws(() => patch(patch(source)), /reviewed source contract/);
  assert.throws(() => applySchemaPatches(source, [atlassianDcAuthentication, atlassianDcAuthentication]), /duplicated/);
});

Then('Data Center authentication repairs preserve unaffected Basic and anonymous declarations', async () => {
  for (const catalog of Object.keys(operations)) {
    const source = await readServiceSchemaUpstream(catalog), corrected = patch(source);
    for (const { path, method, operation } of rows(source)) {
      if (operation.security?.some(option => option.OAuth2)) continue;
      assert.deepEqual(corrected.paths[path][method], operation, `${catalog}:${method} ${path}`);
    }
    assert.deepEqual(corrected.servers, source.servers); assert.deepEqual(corrected.components.securitySchemes.basic, source.components.securitySchemes.basic);
  }
});

Then('Data Center bearer dispatch retains permissions credentials and destination approval', async () => {
  const source = await readServiceSchema('jira-dc'), id = 'jira-dc:GET /api/2/worklog/updated';
  const operation = inspectServiceSchema(source, 'jira-dc', new Set([id])).operations[0];
  const origin = 'https://jira.synthetic.example.test/rest', descriptor = await approvedOperation(operation, origin);
  const value = 'dc-private-synthetic-token-88302', credentials = [{ id: 'dc-token', label: 'Data Center token', kind: 'secret', value,
    grants: [{ id: 'dc-grant', scheme: 'OAuth2', descriptor }] }];
  const alternative = operation.security.findIndex(option => option.length === 1 && option[0].name === 'OAuth2');
  const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { OAuth2: 'dc-token' } };
  const calls = [], output = await executeCredentialed(descriptor, { 'query:since': '0' }, binding, credentials, {
    assertCurrent() {}, fetchRequest: async (url, init) => { calls.push({ url: String(url), headers: new Headers(init.headers) }); return Response.json({ safe: true }); } });
  assert.equal(calls[0].url, `${origin}/api/2/worklog/updated?since=0`);
  assert.equal(calls[0].headers.get('Authorization'), `Bearer ${value}`); assert.equal(JSON.stringify(output).includes(value), false);
  for (const changed of [{ ...operation, credentialPermissions: [{ OAuth2: ['WRITE'] }] }]) {
    const other = await approvedOperation(changed, origin); assert.notEqual(other.fingerprint, descriptor.fingerprint);
    await assert.rejects(executeCredentialed(other, {}, binding, credentials, { assertCurrent() {} }), error => error.code === 'PERMISSION');
  }
  const other = await approvedOperation(operation, 'https://other.synthetic.example.test/rest');
  await assert.rejects(executeCredentialed(other, {}, binding, credentials, { assertCurrent() {} }), error => error.code === 'PERMISSION');
  await assert.rejects(approvedOperation(operation, 'http://jira.synthetic.example.test/rest'));
});

Then('unqualified scoped bearer requirements and missing schemes remain rejected', () => {
  for (const definition of [undefined, { type: 'http', scheme: 'bearer' }]) {
    const source = { components: { securitySchemes: definition ? { OAuth2: definition } : {} } };
    assert.throws(() => extractOperationSecurity(source, { security: [{ OAuth2: ['READ'] }] }), /empty scope arrays/);
    if (!definition) assert.throws(() => extractOperationSecurity(source, { security: [{ OAuth2: [] }] }), /OAuth2/);
  }
});
