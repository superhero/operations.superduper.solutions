// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, githubAuthentication, githubClassroomRetirement, schemaPatchName } from './lib/schema-patches.ts';
import { retiredGithubClassroom } from './lib/github-classroom-retirement.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { securityRequiresCredentials } from './lib/operation-security.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed, CredentialResponseError } from './lib/secrets/execution.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { operations, operationSourceIdentity, publishPreparedCatalogs, extractOperations } from './lib/catalog.ts';
import { readGithubAuthenticationContracts } from './lib/github-authentication-data.ts';
import { githubClassicCases, githubClassicRequest } from '../tests/github-classic-auth.fixture.mjs';
import { githubUserApiCases, githubUserApiRequest } from '../tests/github-user-api.fixture.mjs';
import { credentialResultProfile, supportsCredentialResults } from './lib/credential-results.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { VaultError } from './lib/secrets/types.ts';
import { encodeWorkflowBinary, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';
import { githubAutomationCases, githubAutomationRequest } from '../tests/github-automation.fixture.mjs';
import { readGithubAutomationContracts, githubAutomationWirePath } from './lib/github-automations.ts';

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

Then('GitHub watching requests preserve method body scopes and private token roles', async () => {
  const { models, corrected, published, contracts } = await fixture();
  const review = contracts.additionalReviews['github-watching'];
  assert.equal(review.revision, 'd0c59c59fadf92c3a44676a3ed7ed38a015379ca');
  assert.equal(review.operations.length, 3);
  const secret = credential('synthetic-watching-user-credential');
  let previous;
  for (const [id, method] of [['activity/get-repo-subscription', 'GET'],
    ['activity/set-repo-subscription', 'PUT'], ['activity/delete-repo-subscription', 'DELETE']]) {
    const op = models.get(id), contract = contracts.operations[id];
    assert.ok(review.operations.includes(id));
    assert.equal(op.unavailableReason, undefined);
    assert.deepEqual(contract.profiles, ['classic-user']);
    assert.equal(contract.anonymous, false);
    assert.match(contract.notes.join(' '), /notifications scope/);
    assert.deepEqual(op.security.map(option => option.map(scheme => scheme.name)), [['GitHubClassicUserToken']]);
    assert.equal(securityRequiresCredentials(op.security), true);
    const native = published.paths[contract.path][contract.method];
    assert.equal(native.security, undefined);
    assert.equal(corrected.paths[contract.path][contract.method].operationId, native.operationId);
    const descriptor = await approvedOperation(op, 'https://api.github.com');
    const selected = binding(descriptor, 'GitHubClassicUserToken', secret.id);
    const values = { 'path:owner': 'fixture-owner', 'path:repo': 'fixture-repo',
      ...(method === 'PUT' ? { 'body:subscribed': 'true', 'body:ignored': 'false' } : {}) };
    const sent = [];
    const options = { assertCurrent() {}, fetchRequest: async (url, init) => {
      sent.push({ url: String(url), init });
      return method === 'DELETE' ? new Response(null, { status: 204 })
        : Response.json({ subscribed: true, ignored: false, echoed: init.headers.get('Authorization') });
    } };
    for (const invalid of [{ ...selected, credentials: {} }, { ...selected, alternative: 1 },
      ...['GitHubPersonalAccessToken', 'GitHubAppUserToken', 'GitHubInstallationToken', 'GitHubAppJWT']
        .map(name => ({ ...selected, credentials: { [name]: secret.id } })), ...(previous ? [previous] : [])])
      await assert.rejects(() => executeCredentialed(descriptor, values, invalid, [secret], options));
    assert.equal(sent.length, 0, 'Invalid token roles or another method approval must fail before fetch.');
    const result = await executeCredentialed(descriptor, values, selected, [secret], options);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.github.com/repos/fixture-owner/fixture-repo/subscription');
    assert.equal(sent[0].init.method, method);
    assert.equal(sent[0].init.headers.get('Authorization'), 'Bearer ' + secret.value);
    assert.equal(sent[0].init.credentials, 'omit');
    assert.equal(sent[0].init.redirect, 'error');
    if (method === 'PUT') assert.deepEqual(JSON.parse(sent[0].init.body), { subscribed: true, ignored: false });
    else assert.equal(sent[0].init.body == null, true);
    assert.equal(result.response.status, method === 'DELETE' ? 204 : 200);
    assert.ok(!JSON.stringify(result).includes(secret.value));
    previous = selected;
  }
});

Then('GitHub classic route families preserve exact scopes account roles and native identities', async () => {
  const { models, published, corrected, contracts } = await fixture();
  const review = contracts.additionalReviews['github-classic-families'];
  assert.equal(review.revision, 'd0c59c59fadf92c3a44676a3ed7ed38a015379ca');
  assert.equal(githubClassicCases.length, 27);
  assert.deepEqual(new Set(review.operations), new Set(githubClassicCases.map(row => row.id)));
  assert.deepEqual(Object.keys(review.sources).sort(), ['code-security', 'copilot', 'copilot-spaces', 'dependabot']);
  for (const test of githubClassicCases) {
    const op = models.get(test.id), contract = contracts.operations[test.id];
    assert.equal(op.unavailableReason, undefined, test.id);
    assert.equal(contract.path, test.path); assert.equal(contract.method, test.method.toLowerCase());
    assert.equal(contract.serverUrl, 'https://api.github.com');
    assert.deepEqual(contract.profiles, ['classic-user']); assert.equal(contract.anonymous, false);
    assert.ok(contract.notes.some(note => note.includes('Required token scope: ' + test.scope + '.')), test.id);
    assert.ok(contract.notes.some(note => /GitHub enforces/.test(note)), test.id);
    const native = published.paths[test.path][test.method.toLowerCase()];
    const effective = corrected.paths[test.path][test.method.toLowerCase()];
    assert.equal(native.operationId, test.id); assert.equal(native.security, undefined);
    assert.equal(effective.operationId, test.id);
    assert.deepEqual(effective.requestBody, native.requestBody);
    assert.deepEqual(op.security.map(option => option.map(scheme => scheme.name)), [['GitHubClassicUserToken']]);
    assert.equal(securityRequiresCredentials(op.security), true);
  }
  assert.match(contracts.operations['code-security/create-configuration-for-enterprise'].notes.join(' '), /administrator/);
  assert.match(contracts.operations['copilot/set-enterprise-coding-agent-policy'].notes.join(' '), /enterprise owners/i);
  assert.match(contracts.operations['dependabot/list-alerts-for-enterprise'].notes.join(' '), /security manager/);
  assert.match(contracts.operations['copilot-spaces/add-collaborator-for-user'].notes.join(' '), /Team collaborators are not supported/);
  assert.match(contracts.operations['copilot-spaces/delete-for-user'].notes.join(' '), /owner/);
});

Then('GitHub classic route requests preserve all methods bodies and token role boundaries', async () => {
  const { models } = await fixture();
  const secret = credential('synthetic-classic-family-user-credential');
  let previous;
  for (const test of githubClassicCases) {
    const op = models.get(test.id), descriptor = await approvedOperation(op, 'https://api.github.com');
    const { values, url } = githubClassicRequest(test);
    const selected = binding(descriptor, 'GitHubClassicUserToken', secret.id);
    const sent = [];
    const options = { assertCurrent() {}, fetchRequest: async (target, init) => {
      sent.push({ url: String(target), init });
      return Response.json({ accepted: true, echoed: init.headers.get('Authorization') });
    } };
    for (const invalid of [{ ...selected, credentials: {} }, { ...selected, alternative: 1 },
      ...['GitHubPersonalAccessToken', 'GitHubAppUserToken', 'GitHubInstallationToken', 'GitHubAppJWT']
        .map(name => ({ ...selected, credentials: { [name]: secret.id } })), ...(previous ? [previous] : [])])
      await assert.rejects(() => executeCredentialed(descriptor, values, invalid, [secret], options));
    assert.equal(sent.length, 0, test.id);
    const result = await executeCredentialed(descriptor, values, selected, [secret], options);
    assert.equal(sent.length, 1); assert.equal(sent[0].url, url); assert.equal(sent[0].init.method, test.method);
    assert.equal(sent[0].init.headers.get('Authorization'), 'Bearer ' + secret.value);
    assert.equal(sent[0].init.credentials, 'omit'); assert.equal(sent[0].init.redirect, 'error');
    if (test.body) assert.deepEqual(JSON.parse(sent[0].init.body), test.body, test.id);
    else assert.equal(sent[0].init.body == null, true, test.id);
    assert.equal(result.response.body.accepted, true); assert.equal(result.response.redacted, true);
    assert.ok(!JSON.stringify(result).includes(secret.value));
    previous = selected;
  }
});

Then('GitHub classic scope role and entitlement failures remain provider denials', async () => {
  const { models } = await fixture();
  for (const id of ['code-security/create-configuration-for-enterprise', 'copilot/set-enterprise-coding-agent-policy',
    'dependabot/list-alerts-for-enterprise', 'copilot-spaces/create-resource-for-user']) {
    const test = githubClassicCases.find(row => row.id === id);
    const op = models.get(id), descriptor = await approvedOperation(op, 'https://api.github.com');
    const secret = credential('synthetic-denied-classic-user-credential');
    const selected = binding(descriptor, 'GitHubClassicUserToken', secret.id);
    let calls = 0;
    await assert.rejects(() => executeCredentialed(descriptor, githubClassicRequest(test).values, selected, [secret], {
      assertCurrent() {}, fetchRequest: async (_url, init) => {
        calls++; assert.equal(init.headers.get('Authorization'), 'Bearer ' + secret.value);
        return Response.json({ message: 'Insufficient scope, role or entitlement', echoed: secret.value }, { status: 403 });
      },
    }), error => {
      assert.ok(error instanceof CredentialResponseError);
      assert.equal(error.response.status, 403);
      assert.match(error.message, /HTTP 403/);
      assert.ok(!JSON.stringify(error).includes(secret.value));
      assert.ok(!String(error).includes(secret.value));
      return true;
    });
    assert.equal(calls, 1);
  }
});

const userApiNames = { personal: 'GitHubPersonalAccessToken', 'app-user': 'GitHubAppUserToken', 'classic-user': 'GitHubClassicUserToken' };

const automationNames = { ...userApiNames, installation: 'GitHubInstallationToken' };
Then('GitHub automation correction preserves native IDs original evidence and strict model parity', async () => {
  const { models, contracts, published, corrected } = await fixture();
  const data = readGithubAutomationContracts(); assert.equal(data.operations.length, 10);
  const subset = { ...corrected, paths: Object.fromEntries([...new Set(githubAutomationCases.map(row => row.path))]
    .map(path => [path, corrected.paths[path]])) };
  const strict = new Map(extractOperations(subset, 'github').map(operation => [operation.id, operation]));
  assert.equal(strict.size, 10);
  assert.equal(githubAutomationCases.filter(row => row.path !== row.wirePath).length, 4);
  for (const test of githubAutomationCases) {
    const op = models.get(test.id), contract = data.operations.find(row => row.id === test.id);
    const raw = published.paths[test.path][test.method.toLowerCase()];
    const effective = corrected.paths[test.path][test.method.toLowerCase()];
    assert.equal(raw.operationId, test.id); assert.equal(effective.operationId, test.id);
    assert.deepEqual(effective['x-upstream-github-automation'], contract.upstream);
    for (const key of ['parameters', 'requestBody', 'responses'])
      assert.deepEqual(effective[key] ?? null, contract.effective[key]);
    assert.equal(op.unavailableReason, undefined, test.id);
    assert.equal(op.path, test.path, 'Discovery still addresses the native source location.');
    assert.equal(githubAutomationWirePath(op), test.wirePath);
    const semanticField = field => {
      const { key, name, location, required, defaultValue, label, description, schema, ...constraints } = field;
      return { key, name, location, required, defaultValue: defaultValue ?? null, schema: schema ?? constraints };
    };
    const strictOperation = strict.get('github:' + test.id);
    assert.deepEqual(op.fields.map(semanticField), strictOperation.fields.map(semanticField));
    const input = githubAutomationRequest(test, 'personal', op).values;
    assert.deepEqual(prepareRequest(op, input), prepareRequest(strictOperation, input));
    assert.equal(githubAutomationWirePath(strict.get('github:' + test.id)), test.wirePath);
    assert.deepEqual(contracts.operations[test.id].profiles, test.profiles);
    if (test.path !== test.wirePath) for (const name of ['owner', 'repo']) {
      assert.equal(op.fields.find(field => field.key === 'path:' + name).required, true);
      assert.equal(op.fields.find(field => field.key === 'path:' + name).defaultValue, undefined);
    }
  }
});

Then('GitHub automation wires retain ownership types repository inputs and token alternatives', async () => {
  const { models } = await fixture(), secret = credential('SYNTHETIC_AUTOMATION_AUTH_173420');
  let requests = 0;
  for (const test of githubAutomationCases) {
    const op = models.get(test.id), descriptor = await approvedOperation(op, 'https://api.github.com');
    for (const profile of test.profiles) {
      const f = githubAutomationRequest(test, profile, op), selected = binding(descriptor, automationNames[profile], secret.id);
      let calls = 0;
      const result = await executeCredentialed(descriptor, f.values, selected, [secret], { assertCurrent() {}, fetchRequest: async (url, init) => {
        calls++; assert.equal(String(url), f.url); assert.equal(init.method, test.method);
        assert.equal(init.headers.get('Authorization'), 'Bearer ' + secret.value);
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        if (f.body) assert.deepEqual(JSON.parse(init.body), f.body); else assert.equal(init.body == null, true);
        return test.method === 'DELETE' ? new Response(null, { status: 204 })
          : Response.json({ id: 'fixture-automation', type: profile === 'installation' ? 'shared' : 'personal',
            continuous_history: true, created_by: { id: 42 }, echoed: secret.value }, { status: test.method === 'POST' ? 201 : 200 });
      } });
      assert.equal(calls, 1); noSecrets(result, [secret.value]); requests++;
    }
  }
  assert.equal(requests, 38);
});

Then('GitHub automation legacy fields missing repositories and incompatible token context never dispatch', async () => {
  const { models } = await fixture(), secret = credential('SYNTHETIC_AUTOMATION_GUARD_173420');
  let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({ accepted: true }); } };
  for (const test of githubAutomationCases) {
    const op = models.get(test.id), descriptor = await approvedOperation(op, 'https://api.github.com');
    const f = githubAutomationRequest(test, 'personal', op), selected = binding(descriptor, 'GitHubPersonalAccessToken', secret.id);
    await assert.rejects(() => executeCredentialed(descriptor, f.values, { ...selected, credentials: {} }, [secret], options));
    await assert.rejects(() => executeCredentialed(descriptor, f.values, { ...selected, credentials: { GitHubAppJWT: secret.id } }, [secret], options));
    if (test.path !== test.wirePath) for (const key of ['path:owner', 'path:repo']) {
      const missing = { ...f.values }; delete missing[key];
      await assert.rejects(() => executeCredentialed(descriptor, missing, selected, [secret], options));
    }
    if (test.method === 'POST' || test.method === 'PATCH') {
      for (const name of ['owner_type', 'write_scope', 'allowed_custom_agents', ...(test.method === 'PATCH' ? ['type'] : [])])
        await assert.rejects(() => executeCredentialed(descriptor, { ...f.values, ['body:' + name]: 'legacy' }, selected, [secret], options),
          error => error.fieldKey === 'body:' + name);
      const oldTriggers = op.bodyValue ? { ...f.values, 'body:$': JSON.stringify({ ...f.body, triggers: { issue_opened: { query: 'is:issue', write_scope: 'repository' } } }) }
        : { ...f.values, 'body:triggers': JSON.stringify({ issue_opened: { query: 'is:issue', write_scope: 'repository' } }) };
      await assert.rejects(() => executeCredentialed(descriptor, oldTriggers, selected, [secret], options), error => error.fieldKey === 'body:triggers');
    }
    if (test.id.endsWith('/create-repo-automation') || test.id.endsWith('/list-repo-automations')) {
      const installation = binding(descriptor, 'GitHubInstallationToken', secret.id);
      await assert.rejects(() => executeCredentialed(descriptor, f.values, installation, [secret], options),
        error => error.fieldKey === (test.method === 'POST' ? 'body:type' : 'query:type'));
    }
    if (test.id.endsWith('/list-automations'))
      await assert.rejects(() => executeCredentialed(descriptor, f.values, { ...selected, credentials: { GitHubInstallationToken: secret.id } }, [secret], options));
  }
  assert.equal(calls, 0);
});

Then('GitHub automation source and marker changes cannot bypass their pinned wire contracts', async () => {
  const { published, corrected, models } = await fixture();
  const data = readGithubAutomationContracts();
  for (const contract of data.operations) {
    const native = structuredClone(published), target = native.paths[contract.path][contract.method.toLowerCase()];
    target.responses = { '200': { description: 'Changed native contract' } };
    const before = JSON.stringify(native);
    assert.throws(() => applySchemaPatches(native, [githubAuthentication]), /GitHub automation correction/);
    assert.equal(JSON.stringify(native), before);
    const source = structuredClone(corrected), operation = source.paths[contract.path][contract.method.toLowerCase()];
    operation['x-upstream-github-automation'] = {};
    const inspected = inspectServiceSchema(source, 'github', new Set(['github:' + contract.id])).operations[0];
    assert.match(inspected.unavailableReason, /GitHub automation correction/);
    const model = structuredClone(models.get(contract.id)); model.githubAutomation = 'forged';
    assert.throws(() => githubAutomationWirePath(model), /GitHub automation correction/);
    delete model.githubAutomation;
    assert.throws(() => githubAutomationWirePath(model), /GitHub automation correction/);
    delete operation['x-operations-github-automation'];
    delete operation['x-upstream-github-automation'];
    const stripped = inspectServiceSchema(source, 'github', new Set(['github:' + contract.id])).operations[0];
    assert.match(stripped.unavailableReason, /GitHub automation correction/);
  }
});

Then('GitHub manifest and upload contracts keep private code and upload host boundaries', async () => {
  const { models, contracts, published, corrected } = await fixture();
  const review = contracts.additionalReviews['github-manifest-upload'];
  assert.deepEqual(new Set(review.operations), new Set(['apps/create-from-manifest', 'repos/upload-release-asset']));
  const manifest = models.get('apps/create-from-manifest');
  assert.equal(manifest.unavailableReason, undefined);
  assert.equal(supportsCredentialResults(manifest), true);
  assert.deepEqual(credentialResultProfile(manifest).privateInputs, ['path:code']);
  assert.equal(securityRequiresCredentials(manifest.security), false, 'The temporary private code authorizes this exchange.');
  assert.deepEqual(contracts.operations['apps/create-from-manifest'].profiles, []);
  assert.equal(contracts.operations['apps/create-from-manifest'].anonymous, true);
  assert.match(contracts.operations['apps/create-from-manifest'].notes.join(' '), /one hour/);
  const upload = models.get('repos/upload-release-asset');
  assert.equal(upload.unavailableReason, undefined);
  assert.deepEqual(upload.security.map(option => option.map(scheme => scheme.name)), [['GitHubClassicUserToken']]);
  assert.deepEqual(upload.binaryMediaTypes, ['application/octet-stream']);
  assert.match(contracts.operations['repos/upload-release-asset'].notes.join(' '), /repo scope/);
  assert.equal(contracts.operations['repos/upload-release-asset'].serverUrl, 'https://uploads.github.com');
  for (const id of review.operations) {
    const contract = contracts.operations[id];
    const native = published.paths[contract.path][contract.method], effective = corrected.paths[contract.path][contract.method];
    assert.equal(native.operationId, id); assert.equal(effective.operationId, id);
    assert.deepEqual(effective.requestBody, native.requestBody);
    assert.equal(native.security, undefined);
  }
});

async function manifestFixture() {
  const { models } = await fixture(), operation = models.get('apps/create-from-manifest');
  const descriptor = await approvedOperation(operation, 'https://api.github.com');
  const vault = await privateVault(), code = 'SYNTHETIC_MANIFEST_CODE_628104';
  const summaries = await vault.session.put(null, { label: 'Manifest code fixture', kind: 'secret', value: code });
  const credentialId = summaries.find(item => item.label === 'Manifest code fixture').id;
  return { operation, descriptor, vault, code, binding: { fingerprint: descriptor.fingerprint, alternative: 0, credentials: {} },
    values: { 'path:code': vaultVariablePlaceholder }, variables: [{ key: 'path:code', path: [], credentialId }] };
}
const manifestResponse = nullable => ({ id: 42, client_id: 'fixture-public-client-id', name: 'Fixture app',
  client_secret: 'SYNTHETIC_MANIFEST_CLIENT_SECRET_628104', pem: 'SYNTHETIC_MANIFEST_PEM_628104\nfixture-秘密',
  webhook_secret: nullable ? null : 'SYNTHETIC_MANIFEST_WEBHOOK_SECRET_628104' });

Then('GitHub manifest codes and acquired credentials remain encrypted across vault locking', async () => {
  for (const nullable of [false, true]) {
    const f = await manifestFixture(), reply = manifestResponse(nullable), previous = globalThis.fetch;
    const secrets = [f.code, reply.client_secret, reply.pem, ...(reply.webhook_secret ? [reply.webhook_secret] : [])];
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++; assert.equal(String(url), 'https://api.github.com/app-manifests/' + f.code + '/conversions');
      assert.equal(init.method, 'POST'); assert.equal(init.headers.get('Authorization'), null);
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
      return Response.json({ ...reply, unreviewed_secret: reply.pem }, { status: 201, headers: { 'x-private-echo': f.code } });
    };
    try {
      await assert.rejects(f.vault.session.execute(f.descriptor, { 'path:code': f.code }, f.binding), error => error instanceof VaultError && error.code === 'PERMISSION');
      await assert.rejects(f.vault.session.execute(f.descriptor, f.values, f.binding), error => error instanceof VaultError && error.code === 'PERMISSION');
      assert.equal(calls, 0);
      const result = await f.vault.session.execute(f.descriptor, f.values, f.binding, undefined, f.variables);
      assert.equal(calls, 1); assert.equal(result.response.status, 201);
      assert.equal(result.response.body.id, 42); assert.equal(result.response.body.client_id, reply.client_id);
      assert.equal(result.response.body.unreviewed_secret, undefined); assert.equal(result.response.headers['x-private-echo'], undefined);
      const references = ['client_secret', 'pem', ...(nullable ? [] : ['webhook_secret'])];
      if (nullable) assert.equal(result.response.body.webhook_secret, null);
      assert.equal((await f.vault.session.list()).length, 1 + references.length);
      for (const name of references) assert.equal(await f.vault.session.copyCredential(result.response.body[name].credentialId), reply[name]);
      noSecrets(result, secrets); noSecrets(f.vault.storage.state, secrets); noSecrets(await f.vault.session.backup(), secrets);
      f.vault.session.lock();
      await assert.rejects(f.vault.session.execute(f.descriptor, f.values, f.binding, undefined, f.variables), error => error.code === 'LOCKED');
      assert.equal(calls, 1);
      await f.vault.session.unlock(f.vault.proof);
      for (const name of references) assert.equal(await f.vault.session.copyCredential(result.response.body[name].credentialId), reply[name]);
    } finally { globalThis.fetch = previous; f.vault.session.lock(); }
  }
});

Then('GitHub manifest expiry revocation and storage failure leave no partial acquisition', async () => {
  for (const mode of ['expired', 'malformed', 'missing', 'storage', 'revoke', 'lock']) {
    const f = await manifestFixture(), reply = manifestResponse(false), previous = globalThis.fetch;
    const secrets = [f.code, reply.client_secret, reply.pem, reply.webhook_secret]; let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (mode === 'revoke') f.vault.live = false;
      if (mode === 'lock') f.vault.session.lock();
      if (mode === 'expired') return Response.json({ message: 'Expired code', ...reply }, { status: 400 });
      if (mode === 'malformed') return Response.json({ ...reply, pem: {} }, { status: 201 });
      if (mode === 'missing') { const body = { ...reply }; delete body.pem; return Response.json(body, { status: 201 }); }
      return Response.json(reply, { status: 201 });
    };
    try {
      if (mode === 'storage') f.vault.storage.fail = true;
      await assert.rejects(f.vault.session.execute(f.descriptor, f.values, f.binding, undefined, f.variables), error => {
        assert.ok(error instanceof CredentialResponseError); assert.equal(error.response.body, null);
        assert.deepEqual(error.response.headers, {}); noSecrets([String(error), error.response], secrets); return true;
      });
      assert.equal(calls, 1, mode);
      assert.equal(f.vault.storage.state.snapshot.records.length, 1, mode);
      noSecrets(f.vault.storage.state, secrets);
    } finally { globalThis.fetch = previous; f.vault.session.lock(); }
  }
});

Then('GitHub release asset requests preserve binary content names media and mutation failures', async () => {
  const { models } = await fixture(), op = models.get('repos/upload-release-asset');
  const descriptor = await approvedOperation(op, 'https://uploads.github.com');
  const secret = credential('SYNTHETIC_RELEASE_UPLOAD_AUTH_628104');
  const selected = binding(descriptor, 'GitHubClassicUserToken', secret.id);
  const bytes = Uint8Array.from([0, 255, 1, 128, 10, 13, 65, 90]);
  const file = encodeWorkflowBinary('fixture.zip', bytes, 'application/zip');
  const values = { 'path:owner': 'fixture-owner', 'path:repo': 'fixture-repo', 'path:release_id': '42',
    'query:name': 'release asset + 世界.zip', 'query:label': 'Fixture label', 'body:$': JSON.stringify(file) };
  let calls = 0, fail = false;
  const options = { assertCurrent() {}, fetchRequest: async (url, init) => {
    calls++; const target = new URL(url);
    assert.equal(target.origin, 'https://uploads.github.com');
    assert.equal(target.pathname, '/repos/fixture-owner/fixture-repo/releases/42/assets');
    assert.equal(target.searchParams.get('name'), values['query:name']); assert.equal(target.searchParams.get('label'), 'Fixture label');
    assert.equal(init.method, 'POST'); assert.equal(init.headers.get('Authorization'), 'Bearer ' + secret.value);
    assert.equal(init.headers.get('Content-Type'), 'application/zip'); assert.equal(init.headers.get('Content-Length'), null);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    assert.ok(init.body instanceof Blob); assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), bytes);
    return Response.json({ id: 43, state: fail ? 'starter' : 'uploaded', echoed: secret.value }, { status: fail ? 502 : 201 });
  } };
  for (const invalid of [{ ...selected, credentials: {} }, { ...selected, alternative: 1 },
    ...['GitHubPersonalAccessToken', 'GitHubAppUserToken', 'GitHubInstallationToken', 'GitHubAppJWT']
      .map(name => ({ ...selected, credentials: { [name]: secret.id } }))])
    await assert.rejects(() => executeCredentialed(descriptor, values, invalid, [secret], options));
  for (const invalid of [{ ...values, 'query:name': '' }, { ...values, 'body:$': 'not a file' },
    { ...values, 'body:$': JSON.stringify({ ...file, size: maxWorkflowUploadBytes + 1 }) }])
    await assert.rejects(() => executeCredentialed(descriptor, invalid, selected, [secret], options));
  await assert.rejects(() => executeCredentialed({ ...descriptor, origin: 'https://other.example.test' }, values, selected, [secret], options));
  assert.equal(calls, 0);
  const result = await executeCredentialed(descriptor, values, selected, [secret], options);
  assert.equal(result.response.status, 201); assert.equal(result.response.body.state, 'uploaded'); noSecrets(result, [secret.value]);
  fail = true;
  await assert.rejects(() => executeCredentialed(descriptor, values, selected, [secret], options), error => {
    assert.ok(error instanceof CredentialResponseError); assert.equal(error.response.status, 502);
    assert.match(error.message, /before retrying/); noSecrets(error, [secret.value]); return true;
  });
  assert.equal(calls, 2, 'The failed mutation has exactly one request and is not automatically retried.');
});
Then('GitHub user API contracts keep token roles ownership scopes and native request schemas', async () => {
  const { models, contracts, published, corrected } = await fixture();
  const review = contracts.additionalReviews['github-user-apis'];
  assert.equal(githubUserApiCases.length, 30);
  assert.deepEqual(new Set(review.operations), new Set(githubUserApiCases.map(test => test.id)));
  for (const test of githubUserApiCases) {
    const op = models.get(test.id), contract = contracts.operations[test.id];
    assert.equal(op.unavailableReason, undefined, test.id);
    assert.equal(contract.method, test.method.toLowerCase()); assert.equal(contract.path, test.path);
    assert.equal(contract.serverUrl, 'https://api.github.com'); assert.equal(contract.anonymous, false);
    assert.deepEqual(contract.profiles, test.profiles);
    assert.deepEqual(op.security.map(option => option.map(scheme => scheme.name)), test.profiles.map(profile => [userApiNames[profile]]));
    const native = published.paths[test.path][test.method.toLowerCase()];
    const effective = corrected.paths[test.path][test.method.toLowerCase()];
    assert.equal(native.operationId, test.id); assert.equal(native.security, undefined);
    assert.deepEqual(effective.requestBody, native.requestBody); assert.equal(effective.operationId, native.operationId);
    assert.equal(securityRequiresCredentials(op.security), true);
    const notes = contract.notes.join(' ');
    if (test.id.startsWith('agent-tasks/')) {
      assert.match(notes, /Agent tasks/); assert.match(notes, /installation.*not supported/);
      assert.equal(contract.permissions[0]['Agent tasks repository permissions'], test.method === 'POST' ? 'read and write' : 'read');
    } else if (test.id.startsWith('migrations/')) {
      assert.match(notes, /owner/); assert.match(notes, /seven days/); assert.match(notes, /classic/);
    } else {
      assert.match(notes, test.method === 'GET' ? /read:project/ : /project scope/);
      assert.match(notes, /user-owned/);
    }
  }
  assert.match(contracts.operations['agent-tasks/create-task-in-repo'].notes.join(' '), /Business or.*Enterprise/);
});

Then('GitHub user API wires preserve body variants arrays null and method scoped approval', async () => {
  const { models } = await fixture();
  const secret = credential('synthetic-reviewed-user-api-credential');
  let previous;
  let requests = 0;
  for (const test of githubUserApiCases) {
    const op = models.get(test.id), descriptor = await approvedOperation(op, 'https://api.github.com');
    const { values, url } = githubUserApiRequest(test);
    for (const profile of test.profiles) {
      const name = userApiNames[profile], selected = binding(descriptor, name, secret.id);
      const sent = [];
      const options = { assertCurrent() {}, fetchRequest: async (target, init) => {
        sent.push({ url: String(target), init });
        return test.status === 204 ? new Response(null, { status: 204 })
          : Response.json({ accepted: true, echoed: init.headers.get('Authorization') }, { status: test.status });
      } };
      const unavailable = ['GitHubAppJWT', 'GitHubInstallationToken', 'GitHubOAuthApp',
        ...Object.values(userApiNames).filter(candidate => !test.profiles.some(profile => userApiNames[profile] === candidate))];
      for (const invalid of [{ ...selected, credentials: {} }, { ...selected, alternative: -1 },
        ...unavailable.map(name => ({ ...selected, credentials: { [name]: secret.id } })), ...(previous ? [previous] : [])])
        await assert.rejects(() => executeCredentialed(descriptor, values, invalid, [secret], options));
      assert.equal(sent.length, 0, test.id);
      const result = await executeCredentialed(descriptor, values, selected, [secret], options).catch(error => {
        error.message = test.id + ': ' + error.message;
        throw error;
      });
      assert.equal(sent.length, 1); assert.equal(sent[0].url, url); assert.equal(sent[0].init.method, test.method);
      assert.equal(sent[0].init.headers.get('Authorization'), 'Bearer ' + secret.value);
      assert.equal(sent[0].init.credentials, 'omit'); assert.equal(sent[0].init.redirect, 'error');
      if (test.body) assert.deepEqual(JSON.parse(sent[0].init.body), test.body, test.id);
      else assert.equal(sent[0].init.body == null, true, test.id);
      assert.equal(result.response.status, test.status);
      assert.ok(!JSON.stringify(result).includes(secret.value));
      requests++;
    }
    previous = binding(descriptor, userApiNames[test.profiles[0]], secret.id);
  }
  assert.equal(requests, 35);
});

Then('GitHub user API denials fail without credential fallback or automatic mutation retries', async () => {
  const { models } = await fixture();
  for (const id of ['agent-tasks/create-task-in-repo', 'migrations/start-for-org',
    'migrations/start-for-authenticated-user', 'projects/create-draft-item-for-authenticated-user']) {
    const test = githubUserApiCases.find(test => test.id === id);
    const descriptor = await approvedOperation(models.get(id), 'https://api.github.com');
    const secret = credential('synthetic-denied-user-api-credential');
    const selected = binding(descriptor, userApiNames[test.profiles[0]], secret.id);
    let calls = 0;
    await assert.rejects(() => executeCredentialed(descriptor, githubUserApiRequest(test).values, selected, [secret], {
      assertCurrent() {}, fetchRequest: async () => {
        calls++; return Response.json({ message: 'Scope role or entitlement denied', echoed: secret.value }, { status: 403 });
      },
    }), error => {
      assert.ok(error instanceof CredentialResponseError); assert.equal(error.response.status, 403);
      assert.ok(!JSON.stringify(error).includes(secret.value)); assert.ok(!String(error).includes(secret.value));
      return true;
    });
    assert.equal(calls, 1);
  }
});

Then('GitHub Classroom retirement preserves the upstream source and every nonretired operation', async () => {
  const { published, corrected, inspection } = await fixture();
  const original = JSON.stringify(published);
  const authenticated = applySchemaPatches(published, [githubAuthentication]);
  const before = JSON.stringify(authenticated);
  const active = applySchemaPatches(authenticated, [githubClassroomRetirement]);
  const expected = structuredClone(authenticated);
  for (const [path, id] of retiredGithubClassroom) {
    assert.equal(published.paths[path].get.operationId, id);
    assert.equal(active.paths[path], undefined);
    assert.equal(corrected.paths[path], undefined);
    assert.equal(inspection.operations.some(operation => operation.id === 'github:' + id), false);
    delete expected.paths[path];
  }
  const marker = active['x-operations-github-classroom-retirement'];
  assert.equal(marker.retiredOn, '2026-08-28'); assert.match(marker.reason, /HTTP 410 Gone/);
  assert.deepEqual(marker.operationIds, retiredGithubClassroom.map(([, id]) => id));
  expected['x-operations-github-classroom-retirement'] = marker;
  assert.deepEqual(active, expected, 'Every nonretired operation and its metadata remain unchanged.');
  assert.deepEqual(applySchemaPatches(active, [githubAuthentication, githubClassroomRetirement]), active);
  const nativeModels = inspectServiceSchema(authenticated, 'github').operations;
  assert.equal(nativeModels.length, 1242);
  assert.equal(nativeModels.filter(operation => operation.unavailableReason?.includes('GitHubAuthenticationNotReviewed')).length, 6);
  assert.equal(JSON.stringify(published), original); assert.equal(JSON.stringify(authenticated), before);
});

Then('GitHub Classroom retirement rejects changed routes authentication and retirement markers', async () => {
  const { published, corrected } = await fixture();
  const [path] = retiredGithubClassroom[0];
  const authenticated = applySchemaPatches(published, [githubAuthentication]);
  const mutants = [
    d => { d.info.version = 'changed'; }, d => { d.openapi = '3.0.0'; },
    d => { d.servers[0].url = 'https://other.example.test'; }, d => { d.security = []; },
    d => { delete d['x-operations-github-authentication']; },
    d => { d['x-operations-github-authentication'].version = 0; },
    d => { delete d.paths[path]; }, d => { d.paths[path].get.operationId = 'classroom/changed'; },
    d => { d.paths[path].get.security = []; },
    d => { d.paths[path].get.servers = [{ url: 'https://other.example.test' }]; },
    d => { d.paths[path].post = structuredClone(d.paths[path].get); },
    d => { d.paths['/unexpected'] = { get: { operationId: 'classroom/new-operation' } }; },
    d => { d.paths['/moved'] = structuredClone(d.paths[path]); },
    d => { d['x-operations-github-classroom-retirement'] = { version: 1 }; },
  ];
  for (const mutate of mutants) {
    const document = structuredClone(authenticated); mutate(document);
    const before = JSON.stringify(document);
    assert.throws(() => applySchemaPatches(document, [githubClassroomRetirement]), /GitHub Classroom retirement/);
    assert.equal(JSON.stringify(document), before);
  }
  for (const mutate of [
    d => { d['x-operations-github-classroom-retirement'].reason = 'changed'; },
    d => { d.paths[path] = structuredClone(authenticated.paths[path]); },
    d => { d.paths['/restored'] = structuredClone(authenticated.paths[path]); },
  ]) {
    const document = structuredClone(corrected); mutate(document);
    assert.throws(() => applySchemaPatches(document, [githubClassroomRetirement]), /GitHub Classroom retirement/);
  }
  assert.throws(() => applySchemaPatches(published, [githubClassroomRetirement]), /authentication provenance/);
});

Then('GitHub authentication covers the native inventory and separates public access from permission-free access', async () => {
  const { source, published, corrected, inspection, models, contracts } = await fixture();
  assert.deepEqual(source.patches, [githubAuthentication, githubClassroomRetirement, { id:"private-credential-results", version:1 }]);
  assert.equal(source.sha256, 'f9293195f0097a6ae134f8652fca11d15dc26638ee312dd3ce35d5723d56925a');
  assert.equal(createHash('sha256').update(JSON.stringify(published)).digest('hex'), source.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(corrected)).digest('hex'), source.effectiveSha256);
  assert.equal(published.security, undefined); assert.equal(published.components.securitySchemes, undefined);
  assert.equal(corrected.security, undefined, 'No blanket global bearer requirement.');
  assert.equal(inspection.operations.length, 1236);
  assert.equal(Object.keys(contracts.operations).length, 1242);
  assert.equal(inspection.operations.filter(op => !op.unavailableReason).length, 1236);
  let publicCount = 0, unreviewed = 0, results = 0;
  for (const [id, contract] of Object.entries(contracts.operations)) {
    const native = published.paths[contract.path][contract.method];
    const effective = corrected.paths[contract.path]?.[contract.method];
    assert.equal(native.operationId, id); assert.equal(native.security, undefined);
    if (contract.profiles.includes('unreviewed')) {
      unreviewed++;
      assert.ok(retiredGithubClassroom.some(([, retiredId]) => id === retiredId));
      assert.equal(effective, undefined); assert.equal(models.has(id), false);
      continue;
    }
    assert.equal(effective['x-upstream-security'], null);
    assert.ok(Array.isArray(effective.security));
    assert.equal(effective.security.length > 0 && effective.security.every(option => Object.keys(option).length > 0), !contract.anonymous);
    if (models.get(id).security) assert.equal(securityRequiresCredentials(models.get(id).security), !contract.anonymous);
    else assert.ok(models.get(id).unavailableReason, 'An unqualified profile cannot dispatch anonymously.');
    if (contract.anonymous) publicCount++;
    if (contract.credentialFields?.length) { results++; assert.equal(models.get(id).credentialResult, true); assert.equal(models.get(id).credentialResultProfile, "private-result-v1");
      if (!contract.profiles.includes("unreviewed")) assert.equal(models.get(id).unavailableReason, undefined); }
  }
  assert.equal(publicCount, 215); assert.equal(unreviewed, 6); assert.equal(results, 19);
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

Then('GitHub OAuth app references dispatch Basic privately while credential results stay private', async () => {
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
    assert.equal(blocked.credentialResult, true);
    if (blocked.unavailableReason) await assert.rejects(() => approvedOperation(blocked, 'https://api.github.com'));
    else {
      const approved = await approvedOperation(blocked, 'https://api.github.com');
      await assert.rejects(executeCredentialed(approved, {}, { alternative:0, fingerprint:approved.fingerprint, credentials:{} }, [],
        { assertCurrent() {}, fetchRequest:async()=>assert.fail('Credential result bypassed private storage') }), { code:'PERMISSION' });
    }
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
    d => { d.paths['/app'].get['x-operations-credential-result'] = false; }, d => { d.paths['/malformed'] = null; }];
  for (const mutate of mutants) {
    const document = structuredClone(published); mutate(document);
    const before = JSON.stringify(document);
    assert.throws(() => applySchemaPatches(document, [githubAuthentication]), /GitHub authentication/);
    assert.equal(JSON.stringify(document), before);
  }
  const upstream = structuredClone(published); upstream.security = [];
  const metadata = structuredClone(published); metadata.paths['/user'].summary = 'Retained path metadata';
  assert.equal(applySchemaPatches(metadata, [githubAuthentication]).paths['/user'].summary, 'Retained path metadata');
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
