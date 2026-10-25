// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { providerPathBindings, applySchemaPatches, schemaPatchName } from './lib/schema-patches.ts';
import { providerPathBindingSources } from './lib/provider-path-bindings.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const gitlab = 'gitlab', jsm = 'jira-service-management-ops';
const scanOld = '/api/v4/jobs/{id}/sbom_scans/{sbom_digest}', scanNew = '/api/v4/jobs/{id}/sbom_scans/{sbom_scan_id}';
const epicOld = '/api/v4/groups/{id}/(-/)epics/{epic_iid}/issues/{epic_issue_id}', epicNew = '/api/v4/groups/{id}/epics/{epic_iid}/issues/{issue_id}';
const schedule = '/api/{cloudId}/v1/schedules', cloud = '11223344-a1b2-3b33-c444-def123456789';
const scanId = 'gitlab:getApiV4JobsIdSbomScansSbomScanId', epicId = 'gitlab:postApiV4GroupsIdDashEpicsEpicIidIssuesIssueId';
const methods = new Set(['get','post','put','patch','delete','head','options','trace']);
const entries = document => Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item).filter(([method]) => methods.has(method)).map(([method, operation]) => ({ path, method, operation })));
const inspect = (document, pack, id) => inspectServiceSchema(document, pack, new Set([id])).operations[0];
function credentials(descriptor) {
  const username = crypto.randomUUID(), password = crypto.randomUUID(), scheme = descriptor.operation.security[0][0];
  const records = [{ id: username, label: 'Synthetic credential', kind: 'secret', value: 'provider-path-private-canary-6112', grants: [] },
    { id: password, label: 'Synthetic password', kind: 'secret', value: 'provider-path-password-canary-6112', grants: [] }];
  return { records, binding: { fingerprint: descriptor.fingerprint, alternative: 0,
    credentials: { [scheme.name]: scheme.kind === 'basic' ? { username, password } : username } } };
}
async function contract(name) {
  const pack = name.startsWith('GitLab') ? gitlab : jsm, document = await readServiceSchema(pack);
  const id = name === 'GitLab scan' ? scanId : name === 'GitLab epic' ? epicId : `${jsm}:${name === 'JSM create' ? 'POST' : 'GET'} ${schedule}`;
  const operation = inspect(document, pack, id); assert.ok(operation); assert.equal(operation.unavailableReason, undefined);
  const origin = operationServerUrl(document, operation), descriptor = await approvedOperation(operation, origin), authority = credentials(descriptor);
  const values = name === 'GitLab scan' ? { 'path:id': '42', 'path:sbom_scan_id': '77' }
    : name === 'GitLab epic' ? { 'path:id': '1', 'path:epic_iid': '5', 'path:issue_id': '55' }
    : { 'path:cloudId': cloud, ...(name === 'JSM create' ? { 'body:name': 'Support schedule', 'body:timezone': 'UTC', 'body:enabled': 'true' } : { 'query:query': 'A & B', 'query:size': '5' }) };
  return { document, pack, operation, origin, descriptor, authority, values };
}

Then('GitLab path corrections retain native IDs source bytes and peer methods', async () => {
  const raw = await readServiceSchemaUpstream(gitlab), before = JSON.stringify(raw), corrected = await readServiceSchema(gitlab);
  assert.equal(createHash('sha256').update(before).digest('hex'), providerPathBindingSources.gitlab);
  assert.equal(serviceSchemaDescriptors.find(value => value.id === gitlab).sha256, providerPathBindingSources.gitlab);
  assert.deepEqual(entries(corrected).map(value => value.operation.operationId).sort(), entries(raw).map(value => value.operation.operationId).sort());
  assert.equal(entries(corrected).length, 1869); assert.equal(corrected.paths[scanNew].get.operationId, scanId.slice(7));
  assert.equal(corrected.paths[epicNew].post.operationId, epicId.slice(7));
  assert.deepEqual(corrected.paths[scanOld].post, raw.paths[scanOld].post);
  for (const method of ['put','delete']) assert.deepEqual(corrected.paths[epicOld][method], raw.paths[epicOld][method]);
  assert.equal(corrected.paths[scanNew].get['x-upstream-path'], scanOld); assert.equal(corrected.paths[epicNew].post['x-upstream-path'], epicOld);
  assert.deepEqual(corrected.paths[scanNew].get.parameters, raw.paths[scanOld].get.parameters);
  assert.deepEqual(corrected.paths[epicNew].post.parameters, raw.paths[epicOld].post.parameters);
  assert.deepEqual(corrected.paths[scanNew].get.security, [{ GitLabJobToken: [] }]);
  assert.deepEqual(corrected.components.securitySchemes.GitLabJobToken, { type: 'apiKey', in: 'header', name: 'JOB-TOKEN' });
  assert.deepEqual(corrected.paths[scanNew].get['x-upstream-security'], raw.security);
  assert.equal(corrected.paths[epicNew].post.deprecated, true); assert.equal(JSON.stringify(raw), before);
  assert.equal(schemaPatchName(providerPathBindings), 'Qualified provider path bindings');
});
Then('the pinned JSM Ops correction declares missing cloud IDs without inventing other parameters', async () => {
  const raw = await readServiceSchemaUpstream(jsm), corrected = await readServiceSchema(jsm), original = entries(raw), current = entries(corrected);
  assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), providerPathBindingSources[jsm]);
  assert.deepEqual(current.map(value => [value.path, value.method, value.operation.operationId]), original.map(value => [value.path, value.method, value.operation.operationId]));
  assert.equal(current.length, 240); let added = 0;
  for (let index = 0; index < current.length; index++) {
    const old = original[index].operation, operation = current[index].operation;
    assert.equal(operation['x-upstream-operation-id'], old['x-upstream-operation-id']);
    const declared = operation.parameters.filter(value => value.in === 'path' && value.name === 'cloudId'); assert.equal(declared.length, 1);
    assert.equal(declared[0].required, true); assert.equal(declared[0].schema.default, undefined);
    if (!(old.parameters ?? []).some(value => value.in === 'path' && value.name === 'cloudId')) {
      added++; assert.deepEqual(operation.parameters.slice(0,-1), old.parameters ?? []); assert.equal(declared[0].schema.title, 'Cloud ID');
    } else assert.deepEqual(operation.parameters, old.parameters);
    assert.deepEqual(operation.security, old.security); assert.deepEqual(operation.responses, old.responses);
  }
  assert.equal(added, 236); assert.deepEqual(corrected.servers, raw.servers);
});
Then('the corrected {string} operation prepares its exact private URL and authentication', async name => {
  const state = await contract(name); let captured;
  await executeCredentialed(state.descriptor, state.values, state.authority.binding, state.authority.records, { assertCurrent() {}, fetchRequest: async (url, init) => {
    assert.equal(captured, undefined); captured = { url: String(url), init }; return Response.json({ accepted: true });
  } }); assert.ok(captured);
  const url = new URL(captured.url), headers = new Headers(captured.init.headers);
  if (name === 'GitLab scan') {
    assert.equal(url.origin, 'https://gitlab.com'); assert.equal(url.pathname, '/api/v4/jobs/42/sbom_scans/77');
    assert.equal(headers.get('JOB-TOKEN'), state.authority.records[0].value); assert.equal(headers.has('Authorization'), false);
    assert.equal(url.search, '');
  } else if (name === 'GitLab epic') {
    assert.equal(url.origin, 'https://gitlab.com'); assert.equal(url.pathname, '/api/v4/groups/1/epics/5/issues/55'); assert.match(headers.get('Authorization'), /^Bearer /);
  } else {
    assert.equal(url.origin, 'https://api.atlassian.com'); assert.equal(url.pathname, `/jsm/ops/api/${cloud}/v1/schedules`); assert.match(headers.get('Authorization'), /^Basic /);
    if (name === 'JSM create') assert.deepEqual(JSON.parse(captured.init.body), { name: 'Support schedule', timezone: 'UTC', enabled: true });
    else { assert.equal(url.searchParams.get('query'), 'A & B'); assert.equal(url.searchParams.get('size'), '5'); }
  }
  assert.ok(!captured.url.includes(state.authority.records[0].value)); assert.ok(!captured.url.includes('{'));
});
Then('JSM cloud bindings reject missing null placeholder and unsafe identities before dispatch', async () => {
  const state = await contract('JSM list'); let calls = 0;
  for (const value of [undefined, '', ' ', null, '{cloudId}', '../other', 'site/other', 'site?x=1']) {
    const values = { ...state.values, 'path:cloudId': value };
    assert.throws(() => prepareRequest(state.operation, values), error => error instanceof InputValidationError && error.fieldKey === 'path:cloudId');
    await assert.rejects(executeCredentialed(state.descriptor, values, state.authority.binding, state.authority.records, {
      assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); },
    }));
  } assert.equal(calls, 0);
});
Then('provider path recipes reject changed identities ambiguous inputs and destination collisions', async () => {
  for (const pack of [gitlab,jsm]) {
    const source = await readServiceSchemaUpstream(pack);
    const edits = pack === gitlab ? [d => d.info.version = '20', d => d.servers[0].url = 'https://other.example.test',
      d => d.paths[scanOld].get.operationId = 'other', d => d.paths[scanNew] = { get: {} },
      d => d.paths[scanOld].get.parameters.push(structuredClone(d.paths[scanOld].get.parameters[1])),
      d => d.paths[epicOld].post.parameters[2].name = 'epic_issue_id']
      : [d => d.info.version = '2', d => d.servers[0].url = 'https://other.example.test',
        d => d.paths[schedule].get.operationId = 'other',
        d => d.paths[schedule].get.parameters.push({ name: 'cloudId', in: 'path', required: false, schema: { type: 'string' } }),
        d => d.paths[schedule].parameters = [{ name: 'cloudId', in: 'path', required: true, schema: { type: 'string' } }]];
    for (const edit of edits) { const changed = structuredClone(source);edit(changed);const before = JSON.stringify(changed);assert.throws(() => applySchemaPatches(changed,[providerPathBindings]), /reviewed source contract/);assert.equal(JSON.stringify(changed),before); }
    assert.throws(() => applySchemaPatches(source,[providerPathBindings,providerPathBindings]), /duplicated/);
  }
  assert.throws(() => applySchemaPatches({},[providerPathBindings]), /reviewed source contract/);
});
Then('unresolved JSM parameters stay guarded while the reviewed server override resolves', async () => {
  const source = await readServiceSchema(jsm);
  const missing = inspect(source,jsm,`${jsm}:GET /api/{cloudId}/v1/integrations/{integrationId}/actions`);
  assert.ok(missing.unavailableReason); assert.ok(missing.fields.some(value => value.name === 'cloudId')); assert.ok(!missing.fields.some(value => value.name === 'integrationId'));
  const server = inspect(source,jsm,`${jsm}:POST /stakeholder-comms/cloudId/{cloudId}/api/subscribers/delete`); assert.equal(server.unavailableReason, undefined);
  assert.equal(operationServerUrl(source, server), 'https://api.atlassian.com/jsm/ops');
  const document = { openapi:'3.1.0',info:{title:'Unrelated',version:'1'},servers:[{url:'https://other.example.test'}],paths:{'/items/{id}':{get:{operationId:'unbound',responses:{200:{description:'OK'}}}}} };
  assert.ok(inspectServiceSchema(document,'unrelated').operations[0].unavailableReason);
});
Then('corrected provider bindings reject stale private destination approval', async () => {
  const state = await contract('JSM list'), next = await approvedOperation(state.operation,'https://api.atlassian.com/jsm/ops/changed');assert.notEqual(next.fingerprint,state.descriptor.fingerprint);let calls=0;
  await assert.rejects(executeCredentialed(next,state.values,state.authority.binding,state.authority.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}}),error=>error.code==='PERMISSION');assert.equal(calls,0);
});
Then('JSM preserves the unqualified OAuth choice with a routing reason and rejects its dispatch', async () => {
  const state = await contract('JSM list'), alternative = state.operation.security.findIndex(value => value.some(scheme => scheme.name === 'OAuth2'));
  assert.ok(alternative >= 0); assert.equal(state.operation.security[0][0].kind, 'basic');
  const scheme = state.operation.security[alternative][0]; assert.equal(scheme.kind, 'unsupported'); assert.match(scheme.reason, /separate gateway route/);
  assert.deepEqual(state.operation.oauthScopes[alternative].OAuth2, ['read:ops-config:jira-service-management']);
  const diagnostic = state.operation.capabilities.alternatives[alternative]; assert.equal(diagnostic.supported, false); assert.ok(diagnostic.reasons.some(value => /separate gateway route/.test(value)));
  let calls = 0; const binding = { fingerprint: state.descriptor.fingerprint, alternative, credentials: { OAuth2: state.authority.records[0].id } };
  await assert.rejects(executeCredentialed(state.descriptor,state.values,binding,state.authority.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}}),error=>error.code==='PERMISSION');assert.equal(calls,0);
});
