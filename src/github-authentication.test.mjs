// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, githubAuthentication, schemaPatchName } from './lib/schema-patches.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { securityRequiresCredentials } from './lib/operation-security.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { operations, operationSourceIdentity, publishPreparedCatalogs } from './lib/catalog.ts';
import { readGithubAuthenticationContracts } from './lib/github-authentication-data.ts';

let pending;
function fixture() {
  return pending ??= (async () => {
    const source = serviceSchemaDescriptors.find(source => source.id === 'github');
    const published = await readServiceSchemaUpstream('github'), corrected = await readServiceSchema('github');
    const inspection = inspectServiceSchema(corrected, 'github');
    const models = new Map(inspection.operations.map(op => [op.id.slice('github:'.length), op]));
    return { source, published, corrected, inspection, models, contracts: readGithubAuthenticationContracts() };
  })();
}
const tokenName = { personal: 'GitHubPersonalAccessToken', user: 'GitHubAppUserToken', installation: 'GitHubInstallationToken', jwt: 'GitHubAppJWT' };
function credential(value, label = 'Synthetic credential') { return { id: crypto.randomUUID(), label, kind: 'secret', value, grants: [] }; }
function binding(descriptor, name, id) {
  const alternative = descriptor.operation.security.findIndex(option => option.length === 1 && option[0].name === name);
  assert.ok(alternative >= 0, name);
  return { fingerprint: descriptor.fingerprint, alternative, credentials: { [name]: id } };
}

Then('GitHub authentication covers the native inventory and separates public access from permission-free access', async () => {
  const { source, published, corrected, inspection, models, contracts } = await fixture();
  assert.deepEqual(source.patches, [githubAuthentication]);
  assert.equal(source.sha256, 'f9293195f0097a6ae134f8652fca11d15dc26638ee312dd3ce35d5723d56925a');
  assert.equal(createHash('sha256').update(JSON.stringify(published)).digest('hex'), source.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(corrected)).digest('hex'), source.effectiveSha256);
  assert.equal(published.security, undefined); assert.equal(published.components.securitySchemes, undefined);
  assert.equal(corrected.security, undefined, 'No blanket global bearer requirement.');
  assert.equal(inspection.operations.length, 1242);
  assert.equal(Object.keys(contracts.operations).length, 1242);
  assert.equal(inspection.operations.filter(op => !op.unavailableReason).length, 1144);
  let publicCount = 0, unreviewed = 0, results = 0;
  for (const [id, contract] of Object.entries(contracts.operations)) {
    const native = published.paths[contract.path][contract.method];
    const effective = corrected.paths[contract.path][contract.method];
    assert.equal(native.operationId, id); assert.equal(native.security, undefined);
    assert.equal(effective['x-upstream-security'], null);
    assert.ok(Array.isArray(effective.security));
    assert.equal(effective.security.length > 0 && effective.security.every(option => Object.keys(option).length > 0), !contract.anonymous);
    if (models.get(id).security) assert.equal(securityRequiresCredentials(models.get(id).security), !contract.anonymous);
    else assert.ok(models.get(id).unavailableReason, 'An unqualified profile cannot dispatch anonymously.');
    if (contract.anonymous) publicCount++;
    if (contract.profiles.includes('unreviewed')) { unreviewed++; assert.match(models.get(id).unavailableReason, /GitHubAuthenticationNotReviewed/); }
    if (contract.credentialFields?.length) { results++; assert.equal(models.get(id).credentialResult, true); assert.ok(models.get(id).unavailableReason); }
  }
  assert.equal(publicCount, 214); assert.equal(unreviewed, 80); assert.equal(results, 19);
  for (const id of ['users/get-authenticated', 'apps/get-authenticated', 'apps/list-repos-accessible-to-installation',
    'apps/revoke-installation-access-token', 'codespaces/list-for-authenticated-user', 'users/list-public-emails-for-authenticated-user',
    'projects/create-draft-item-for-org', 'issues/add-blocked-by-dependency']) assert.ok(securityRequiresCredentials(models.get(id).security), id);
  for (const id of ['repos/get', 'users/get-by-id', 'markdown/render', 'credentials/revoke']) assert.equal(securityRequiresCredentials(models.get(id).security), false, id);
  assert.deepEqual(models.get('apps/get-authenticated').security.map(option => option.map(scheme => scheme.name)), [['GitHubAppJWT']]);
  assert.deepEqual(models.get('apps/list-repos-accessible-to-installation').security.map(option => option.map(scheme => scheme.name)), [['GitHubInstallationToken']]);
  assert.deepEqual(models.get('apps/list-plans').security.map(option => option.map(scheme => scheme.name)), [['GitHubAppJWT'], ['GitHubOAuthApp']]);
  assert.equal(corrected.paths['/repos/{owner}/{repo}/releases/{release_id}/assets'].post.servers[0].url, 'https://uploads.github.com');
});

Then('GitHub token roles dispatch privately without anonymous or cross-profile fallback', async () => {
  const { models } = await fixture();
  let firstBinding;
  for (const [id, profile] of [['users/get-authenticated', 'personal'], ['users/get-authenticated', 'user'],
    ['apps/get-authenticated', 'jwt'], ['apps/list-repos-accessible-to-installation', 'installation']]) {
    const op = models.get(id); assert.equal(op.unavailableReason, undefined);
    const descriptor = await approvedOperation(op, 'https://api.github.com');
    const secret = credential(`synthetic-github-${profile}-credential`);
    const selected = binding(descriptor, tokenName[profile], secret.id);
    let calls = 0;
    const seen = [];
    const options = { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls++; seen.push({ url: String(url), init });
      return Response.json({ accepted: true, echoed: init.headers.get('Authorization') });
    } };
    for (const invalid of [{ ...selected, credentials: {} }, { ...selected, alternative: -1 },
      { ...selected, credentials: { WrongTokenRole: secret.id } }, ...(firstBinding && profile !== 'user' ? [firstBinding] : [])])
      await assert.rejects(() => executeCredentialed(descriptor, {}, invalid, [secret], options));
    assert.equal(calls, 0);
    const result = await executeCredentialed(descriptor, {}, selected, [secret], options);
    assert.equal(calls, 1); assert.equal(seen[0].url, 'https://api.github.com'+op.path);
    assert.equal(seen[0].init.headers.get('Authorization'), 'Bearer '+secret.value);
    assert.equal(seen[0].init.credentials, 'omit'); assert.equal(seen[0].init.redirect, 'error');
    assert.equal(result.response.body.accepted, true); assert.equal(result.response.redacted, true);
    assert.ok(!JSON.stringify(result).includes(secret.value));
    firstBinding ??= selected;
  }
});

Then('GitHub public choices dispatch without credentials and cannot unlock private routes', async () => {
  const { corrected, inspection, source, models } = await fixture();
  const previous = catalogs.map(catalog => ({ catalog, sourceIdentity: operationSourceIdentity(catalog.id+':'),
    operations: operations.filter(op => op.id.startsWith(catalog.id+':')) }));
  publishPreparedCatalogs([...previous.filter(entry => entry.catalog.id !== 'github'), { sourceIdentity: source.effectiveSha256,
    catalog: { id: 'github', file: 'github.json', name: inspection.name, document: corrected, groups: inspection.groups,
      execution: { kind: 'http', origin: 'https://api.github.com' } }, operations: inspection.operations }]);
  try {
    const seen = [];
    const executor = createWorkflowRequestExecution(async (url, init) => { seen.push({ url: String(url), init }); return Response.json({ public: true }); });
    for (const [id, values, path] of [['repos/get', { 'path:owner': 'fixture-owner', 'path:repo': 'fixture-repo' }, '/repos/fixture-owner/fixture-repo'],
      ['users/get-by-id', { 'path:account_id': '42' }, '/user/42']]) {
      const op = models.get(id), descriptor = await approvedOperation(op, 'https://api.github.com');
      const context = { runId: crypto.randomUUID(), nodeId: 'public', binding: { fingerprint: descriptor.fingerprint,
        alternative: op.security.findIndex(option => !option.length), credentials: {} } };
      assert.deepEqual((await executor.execute(op, values, undefined, context)).response.body, { public: true });
      const sent = seen.at(-1);
      assert.equal(sent.url, 'https://api.github.com'+path);
      assert.equal(new Headers(sent.init.headers).get('Authorization'), null); assert.equal(sent.init.credentials, 'omit');
    }
    const count = seen.length;
    const privateOp = models.get('users/get-authenticated'), descriptor = await approvedOperation(privateOp, 'https://api.github.com');
    const context = { runId: crypto.randomUUID(), nodeId: 'private', binding: { fingerprint: descriptor.fingerprint, alternative: 0, credentials: {} } };
    await assert.rejects(() => executor.execute(privateOp, {}, undefined, context));
    await assert.rejects(() => executor.execute({ ...privateOp, security: [] }, {}, undefined, context));
    assert.equal(seen.length, count);
  } finally { publishPreparedCatalogs(previous); }
});

Then('GitHub OAuth app references dispatch Basic privately while credential results remain blocked', async () => {
  const { models } = await fixture();
  const op = models.get('apps/delete-authorization'); assert.equal(op.unavailableReason, undefined);
  const descriptor = await approvedOperation(op, 'https://api.github.com');
  const client = credential('fixture-client-id'), secret = credential('fixture-client-secret'), token = credential('fixture-private-access-token');
  const selected = binding(descriptor, 'GitHubOAuthApp', { username: client.id, password: secret.id });
  const values = { 'path:client_id': client.value, 'body:access_token': '[Vault variable]' };
  const variables = [{ key: 'body:access_token', path: [], credentialId: token.id }];
  const seen = [];
  const options = { assertCurrent() {}, variables, fetchRequest: async (url, init) => { seen.push({ url: String(url), init }); return new Response(null, { status: 204 }); } };
  await assert.rejects(() => executeCredentialed(descriptor, values, selected, [client, secret], options));
  assert.equal(seen.length, 0);
  const result = await executeCredentialed(descriptor, values, selected, [client, secret, token], options);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.github.com/applications/fixture-client-id/grant');
  const authorization = 'Basic '+Buffer.from(client.value+':'+secret.value).toString('base64');
  assert.equal(seen[0].init.headers.get('Authorization'), authorization);
  assert.deepEqual(JSON.parse(seen[0].init.body), { access_token: token.value });
  assert.equal(result.response.status, 204);
  for (const value of [secret.value, token.value, authorization]) assert.ok(!JSON.stringify(result).includes(value));
  for (const id of ['apps/create-from-manifest', 'apps/create-installation-access-token', 'apps/check-token', 'apps/reset-token',
    'actions/create-registration-token-for-repo']) {
    const blocked = models.get(id); assert.ok(blocked, id);
    assert.equal(blocked.credentialResult, true); assert.ok(blocked.unavailableReason);
    assert.throws(() => prepareRequest(blocked, {}));
    await assert.rejects(() => approvedOperation(blocked, 'https://api.github.com'));
  }
});

Then('GitHub corrections are isolated idempotent and bounded to their reviewed routes and origins', async () => {
  const { published, corrected } = await fixture();
  const original = JSON.stringify(published);
  assert.equal(schemaPatchName(githubAuthentication), 'GitHub operation authentication');
  assert.deepEqual(applySchemaPatches(corrected, [githubAuthentication]), corrected);
  const mutants = [d => { d.servers[0].url = 'https://other.example.test'; }, d => { d.info.version = '2'; },
    d => { d.paths['/user'].get.operationId = 'unknown'; }, d => { d.paths['/app'].get.operationId = 'users/get-authenticated'; },
    d => { d.paths['/changed'] = d.paths['/user']; delete d.paths['/user']; }, d => { delete d.paths['/user']; },
    d => { d.paths['/app'].get.servers = [{ url: 'https://other.example.test' }]; },
    d => { d.components.securitySchemes = { GitHubAppJWT: { type: 'http', scheme: 'bearer' } }; },
    d => { d.paths['/user'].get['x-upstream-security'] = null; },
    d => { d.paths['/app'].get['x-operations-credential-result'] = false; }];
  for (const mutate of mutants) {
    const document = structuredClone(published); mutate(document);
    const before = JSON.stringify(document);
    assert.throws(() => applySchemaPatches(document, [githubAuthentication]), /GitHub authentication/);
    assert.equal(JSON.stringify(document), before);
  }
  const upstream = structuredClone(published); upstream.security = [];
  assert.deepEqual(applySchemaPatches(upstream, [githubAuthentication]), upstream, 'Preserve an explicit upstream root decision.');
  const fixed = structuredClone(published); fixed.paths['/user'].get.security = [];
  assert.deepEqual(applySchemaPatches(fixed, [githubAuthentication]).paths['/user'].get.security, [], 'Preserve explicit operation overrides.');
  const altered = structuredClone(corrected); altered['x-operations-github-authentication'].docsRevision = 'unknown';
  assert.throws(() => applySchemaPatches(altered, [githubAuthentication]), /contract revision/);
  corrected.paths['/user'].get['x-github-authentication'].profiles.push('unreviewed');
  assert.deepEqual(applySchemaPatches(published, [githubAuthentication]).paths['/user'].get.security,
    [{ GitHubPersonalAccessToken: [] }, { GitHubAppUserToken: [] }], 'An editable document cannot mutate the cached contracts.');
  corrected.paths['/user'].get['x-github-authentication'].profiles.pop();
  assert.equal(JSON.stringify(published), original);
});
