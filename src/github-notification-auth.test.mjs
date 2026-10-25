// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { readGithubAuthenticationContracts } from './lib/github-authentication-data.ts';
import { applySchemaPatches, githubAuthentication } from './lib/schema-patches.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { CredentialResponseError, executeCredentialed } from './lib/secrets/execution.ts';

const host = 'https://api.github.com', role = 'GitHubClassicPersonalAccessToken';
const timestamp = '2026-10-25T10:00:00Z';
const routes = [
  ['list-notifications-for-authenticated-user', 'GET', '/notifications', { 'query:per_page': '5' }, 200],
  ['mark-notifications-as-read', 'PUT', '/notifications', { 'body:last_read_at': timestamp }, 202],
  ['get-thread', 'GET', '/notifications/threads/7', { 'path:thread_id': '7' }, 200],
  ['mark-thread-as-read', 'PATCH', '/notifications/threads/7', { 'path:thread_id': '7' }, 205],
  ['mark-thread-as-done', 'DELETE', '/notifications/threads/7', { 'path:thread_id': '7' }, 204],
  ['get-thread-subscription-for-authenticated-user', 'GET', '/notifications/threads/7/subscription', { 'path:thread_id': '7' }, 200],
  ['set-thread-subscription', 'PUT', '/notifications/threads/7/subscription', { 'path:thread_id': '7', 'body:ignored': 'true' }, 200],
  ['delete-thread-subscription', 'DELETE', '/notifications/threads/7/subscription', { 'path:thread_id': '7' }, 204],
  ['list-repo-notifications-for-authenticated-user', 'GET', '/repos/synthetic-owner/synthetic-repo/notifications',
    { 'path:owner': 'synthetic-owner', 'path:repo': 'synthetic-repo', 'query:per_page': '5' }, 200],
  ['mark-repo-notifications-as-read', 'PUT', '/repos/synthetic-owner/synthetic-repo/notifications',
    { 'path:owner': 'synthetic-owner', 'path:repo': 'synthetic-repo', 'body:last_read_at': timestamp }, 202],
];
let pending;
const fixture = () => pending ??= (async () => {
  const document = await readServiceSchema('github'), contracts = readGithubAuthenticationContracts();
  const selected = new Set(routes.map(([name]) => `github:activity/${name}`));
  const models = new Map(inspectServiceSchema(document, 'github', selected).operations.map(operation => [operation.id.slice('github:activity/'.length), operation]));
  const credential = { id: crypto.randomUUID(), label: 'Synthetic classic PAT', kind: 'secret', value: 'github-notification-private-canary-7931', grants: [] };
  return { document, contracts, models, credential };
})();
const binding = (descriptor, credential) => ({ fingerprint: descriptor.fingerprint, alternative: 0, credentials: { [role]: credential.id } });

Then('the ten GitHub Notifications contracts preserve their pinned source and distinct classic personal profile', async () => {
  const f = await fixture(), native = await readServiceSchemaUpstream('github');
  assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'), f.contracts.sourceSha256);
  assert.equal(serviceSchemaDescriptors.find(source => source.id === 'github').sha256, f.contracts.sourceSha256);
  assert.equal(f.contracts.version, 2); assert.equal(f.contracts.sourceVersion, '1.1.4'); assert.equal(f.contracts.apiVersion, '2022-11-28');
  assert.equal(f.models.size, 10);
  for (const [name] of routes) {
    const contract = f.contracts.operations[`activity/${name}`], operation = f.models.get(name);
    assert.deepEqual(contract.profiles, ['classic-personal']); assert.equal(contract.anonymous, false);
    assert.equal(contract.category, 'activity'); assert.equal(contract.subcategory, 'notifications');
    assert.match(contract.notes.join(' '), /notifications or repo scope/);
    assert.equal(operation.unavailableReason, undefined); assert.equal(operationServerUrl(f.document, operation), host);
    assert.deepEqual(operation.security.map(option => option.map(scheme => scheme.name)), [[role]]);
    const original = native.paths[contract.path][contract.method], effective = f.document.paths[contract.path][contract.method];
    assert.equal(original.operationId, `activity/${name}`); assert.equal(effective['x-upstream-security'], null);
    const restored = structuredClone(effective); delete restored.security; delete restored['x-upstream-security']; delete restored['x-github-authentication'];
    assert.deepEqual(restored, original, 'Authentication qualification does not change request/result schemas or operation identity.');
  }
  assert.match(f.document.components.securitySchemes[role].description, /personal access token \(classic\)/);
  assert.notEqual(role, 'GitHubClassicUserToken');
  assert.deepEqual(f.contracts.sources['notifications-classic-pat'], {
    sha256: 'b067c5a93ac281aeff91568acec00b1b1085bbe761afab76c7f06849b70deaf9', bytes: 231,
    url: 'https://raw.githubusercontent.com/github/docs/02c25d16369fe27f9bdb28d1201f6b452f0d21dd/data/reusables/user-settings/notifications-api-classic-pat-only.md',
  });
  const previous = structuredClone(f.document); previous['x-operations-github-authentication'].version = 1;
  assert.throws(() => applySchemaPatches(previous, [githubAuthentication]), /another contract revision/);
});

Then('all ten GitHub Notifications methods send exact private paths inputs and bounded results', async () => {
  const f = await fixture();
  for (const [name, method, path, values, status] of routes) {
    const operation = f.models.get(name), descriptor = await approvedOperation(operation, host), selected = binding(descriptor, f.credential);
    const calls = [];
    const result = await executeCredentialed(descriptor, values, selected, [f.credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls.push({ url: String(url), init });
      return status === 204 || status === 205 ? new Response(null, { status })
        : Response.json({ accepted: name, tokenEcho: f.credential.value }, { status });
    } });
    assert.equal(calls.length, 1); const { url, init } = calls[0], target = new URL(url);
    assert.equal(target.origin + target.pathname, host + path); assert.equal(init.method, method);
    assert.deepEqual([...target.searchParams], values['query:per_page'] ? [['per_page', '5']] : []);
    assert.equal(init.headers.get('Authorization'), `Bearer ${f.credential.value}`); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const expected = values['body:last_read_at'] ? { last_read_at: timestamp } : values['body:ignored'] ? { ignored: true } : undefined;
    if (expected) { assert.equal(init.headers.get('Content-Type'), 'application/json'); assert.deepEqual(JSON.parse(init.body), expected); }
    else assert.equal(init.body, null);
    assert.equal(result.response.status, status); assert.ok(!JSON.stringify(result).includes(f.credential.value));
  }
});

Then('GitHub Notifications reject anonymous wrong-role missing and stale credential bindings before fetch', async () => {
  const f = await fixture(), operation = f.models.get('get-thread'), descriptor = await approvedOperation(operation, host), selected = binding(descriptor, f.credential);
  let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; throw Error('Unexpected fetch'); } };
  const invalid = [{ ...selected, alternative: -1 }, { ...selected, alternative: 1 }, { ...selected, credentials: {} },
    ...['GitHubPersonalAccessToken', 'GitHubAppUserToken', 'GitHubInstallationToken', 'GitHubAppJWT', 'GitHubClassicUserToken', 'GitHubOAuthApp']
      .map(name => ({ ...selected, credentials: { [name]: f.credential.id } }))];
  for (const choice of invalid) await assert.rejects(executeCredentialed(descriptor, { 'path:thread_id': '7' }, choice, [f.credential], options), { code: 'PERMISSION' });
  await assert.rejects(executeCredentialed(descriptor, { 'path:thread_id': '7' }, selected, [], options), { code: 'PERMISSION' });
  const other = await approvedOperation(f.models.get('mark-thread-as-read'), host);
  await assert.rejects(executeCredentialed(other, { 'path:thread_id': '7' }, selected, [f.credential], options), { code: 'PERMISSION' });
  assert.equal(calls, 0);
});

Then('GitHub Notifications never fall back after denial and retain unreviewed and credential-result guards', async () => {
  const f = await fixture(), operation = f.models.get('get-thread'), descriptor = await approvedOperation(operation, host);
  let calls = 0;
  await assert.rejects(executeCredentialed(descriptor, { 'path:thread_id': '7' }, binding(descriptor, f.credential), [f.credential], {
    assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({ message: f.credential.value }, { status: 401 }); },
  }), error => { assert.ok(error instanceof CredentialResponseError); assert.equal(error.response.status, 401);
    assert.ok(!JSON.stringify(error.response).includes(f.credential.value)); return true; });
  assert.equal(calls, 1);
  assert.equal(Object.values(f.contracts.operations).filter(contract => contract.profiles.includes('unreviewed')).length, 80);
  assert.equal(Object.values(f.contracts.operations).filter(contract => contract.credentialFields?.length).length, 19);
  const selected = new Set(['github:activity/get-repo-subscription', 'github:agent-tasks/list-tasks', 'github:apps/create-from-manifest']);
  const residuals = inspectServiceSchema(f.document, 'github', selected).operations;
  assert.equal(residuals.length, 3);
  for (const residual of residuals) { assert.ok(residual.unavailableReason); await assert.rejects(approvedOperation(residual, host), { code: 'PERMISSION' }); }
});
