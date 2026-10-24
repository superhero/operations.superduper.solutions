// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { decodeServiceSchema, readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { adaptGoogleOauthSchema } from '../build/google-oauth-schema.mjs';
import { annotateCodexSchema } from '../build/codex-schema.mjs';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { validateSchemaDocument, operationServerUrl } from './lib/schema-documents.ts';
import { createSchemaDiscovery, validateSchemaDiscovery } from './lib/schema-index.ts';
import { codexExecutionLimitation } from './lib/codex-schema.ts';
import { extractOperationSecurity, supportedSecurityAlternative, securityRequiresCredentials } from './lib/operation-security.ts';

Then('pinned Twilio and Atlassian Basic operations dispatch selected username and token references privately', async () => {
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const { executeCredentialed } = await import('./lib/secrets/execution.ts');
  const census = {};
  for (const [id, operationId, username, password] of [
    ['twilio', 'twilio:CreateAccount', 'synthetic-twilio-account', 'twilio-private-auth-token'],
    ['bitbucket', 'bitbucket:DELETE /addon', 'private-user@example.test', 'atlassian-private-api-token'],
  ]) {
    const document = await readServiceSchema(id), before = JSON.stringify(document), inspection = inspectServiceSchema(document, id);
    const available = inspection.operations.filter(operation => !operation.unavailableReason);
    census[id] = { total: inspection.operations.length, available: available.length,
      unavailable: inspection.operations.filter(operation => operation.unavailableReason).map(operation => ({ id: operation.id, reason: operation.unavailableReason })) };
    if (id === 'twilio') {
      assert.equal(inspection.operations.length, 197);
      assert.equal(available.length, 189);
      assert.equal(census[id].unavailable.length, 8);
      assert.ok(census[id].unavailable.every(operation => /form.*structured/.test(operation.reason)));
      assert.ok(available.every(operation => operation.security.some(option => option.some(scheme => scheme.kind === 'basic'))));
    }
    const operation = available.find(operation => operation.id === operationId);
    assert.ok(operation, operationId);
    const alternative = operation.security.findIndex(option => option.length === 1 && option[0].kind === 'basic');
    assert.ok(alternative >= 0);
    const scheme = operation.security[alternative][0], descriptor = await approvedOperation(operation, operationServerUrl(document, operation));
    const credentials = [{ id: crypto.randomUUID(), label: 'Username', kind: 'secret', value: username, grants: [] },
      { id: crypto.randomUUID(), label: 'API token', kind: 'apiKey', value: password, grants: [] }];
    const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { [scheme.name]: { username: credentials[0].id, password: credentials[1].id } } };
    const header = 'Basic '+Buffer.from(`${username}:${password}`, 'ascii').toString('base64');
    const friendlyName = operation.fields.find(field => field.name === 'FriendlyName');
    if (id === 'twilio') assert.ok(friendlyName, 'Use a real supported scalar form field.');
    const values = id === 'twilio' ? { [friendlyName.key]: 'Synthetic account' } : {};
    let sent = 0;
    const result = await executeCredentialed(descriptor, values, binding, credentials, { assertCurrent() {}, fetchRequest: async (url, options) => {
      sent++; assert.equal(options.headers.get('Authorization'), header);
      assert.equal(options.method, operation.method); assert.equal(options.credentials, 'omit');
      assert.ok(String(url).startsWith(descriptor.origin+operation.path));
      if (id === 'twilio') {
        assert.equal(options.headers.get('Content-Type'), 'application/x-www-form-urlencoded');
        assert.match(String(options.body), /FriendlyName=Synthetic\+account/);
      }
      return Response.json({ accepted: true, echoed: header });
    } });
    assert.equal(sent, 1); assert.equal(result.response.body.accepted, true); assert.equal(result.response.redacted, true);
    for (const value of [username, password, header, header.slice(6)]) assert.ok(!JSON.stringify(result).includes(value));
    assert.equal(JSON.stringify(document), before, 'Published provider contract remains untouched.');
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile('tmp/basic-provider-census.json', JSON.stringify(census, null, 2)+'\n');
});

Then('pinned Atlassian and X authentication alternatives retain independently usable choices and original identities', async () => {
  const census = { atlassian: { mixed: 0, available: 0, otherLimitations: 0 }, x: { mixed: 0, available: 0, otherLimitations: 0 }, samples: [] };
  for (const source of serviceSchemaDescriptors.filter(source => source.provider === 'atlassian' || source.id.startsWith('bitbucket') || source.id === 'x')) {
    const document = await readServiceSchema(source.id), inspection = inspectServiceSchema(document, source.id);
    const models = new Map(inspection.operations.map(model => [model.id, model]));
    const cache = new Map(), family = source.id === 'x' ? census.x : census.atlassian;
    for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(method)) continue;
      const declaration = operation.security ?? document.security, key = JSON.stringify(declaration);
      if (!cache.has(key)) {
        const probe = { ...document, servers: [{ url: 'https://auth-probe.example.test' }], paths: { '/auth-probe': { get: {
          operationId: 'auth-probe', security: declaration, responses: { 200: { description: 'Auth probe' } },
        } } } };
        const checked = inspectServiceSchema(probe, source.id).operations[0];
        cache.set(key, checked.security?.some(option => option.some(scheme => scheme.kind === 'basic' || scheme.kind === 'unsupported'))
          && checked.security.some(option => supportedSecurityAlternative(option) && option.every(scheme => scheme.kind !== 'basic')));
      }
      if (!cache.get(key)) continue;
      family.mixed++;
      const id = `${source.id}:${operation.operationId ?? `${method.toUpperCase()} ${path}`}`;
      const model = models.get(id);
      assert.ok(model, `Missing original operation: ${id}`);
      if (model.unavailableReason) {
        assert.doesNotMatch(model.unavailableReason, /only HTTP bearer|unsupported security|OAuth scopes|Security scheme|Security requirements/);
        family.otherLimitations++;
      } else {
        family.available++;
        assert.equal(model.security.length, declaration.length, 'Source alternatives are never filtered or renumbered.');
        for (const [index, option] of model.security.entries())
          assert.deepEqual(option.map(scheme => scheme.name), Object.keys(declaration[index]));
        if (census.samples.length < 4 || id === 'x:validateAccountActivitySubscription')
          census.samples.push({ id, choices: model.security.map(option => ({ names: option.map(scheme => scheme.name), usable: supportedSecurityAlternative(option) })) });
      }
    }
  }
  assert.equal(census.atlassian.mixed, 1678);
  assert.equal(census.x.mixed, 101);
  const { writeFile } = await import('node:fs/promises');
  await writeFile('tmp/provider-census.json', JSON.stringify(census, null, 2)+'\n');
  console.log(JSON.stringify(census));
});

Then('Event Grid management retains its published source and requires a private Azure bearer token', async () => {
  const { executeCredentialed } = await import('./lib/secrets/execution.ts');
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const { createWorkflowExecution, createWorkflowRequestExecution } = await import('./lib/workflow-execution.ts');
  const { operations, publishPreparedCatalogs, operationSourceIdentity, installOperationModel } = await import('./lib/catalog.ts');
  const { scopeOperationSchema } = await import('./lib/operation-report.ts');
  const { catalogs } = await import('./lib/catalog-registry.ts');
  const source = serviceSchemaDescriptors.find(source => source.id === 'azure-eventgrid');
  assert.deepEqual(source.patches, [{ id: 'azure-eventgrid-management-auth', version: 1 }]);
  const published = await readServiceSchemaUpstream(source.id), corrected = await readServiceSchema(source.id);
  assert.equal(source.sha256, '08622bcbdec69b39057e298e06bf8a51c7ca1e339c9becbae2cc129b1fb8aad1');
  assert.equal(createHash('sha256').update(JSON.stringify(published)).digest('hex'), source.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(corrected)).digest('hex'), source.effectiveSha256);
  assert.equal(Buffer.byteLength(JSON.stringify(corrected)), source.effectiveBytes);
  assert.equal(Object.hasOwn(published, 'security'), false);
  assert.equal(corrected['x-upstream-security'], null);
  assert.deepEqual(corrected.components, published.components);
  assert.deepEqual(corrected.paths, published.paths, 'The complete route inventory and explicit exceptions are preserved.');
  const before = inspectServiceSchema(published, source.id), after = inspectServiceSchema(corrected, source.id);
  assert.equal(before.operations.length, 170); assert.equal(after.operations.length, 170);
  assert.ok(before.operations.every(operation => !securityRequiresCredentials(operation.security)));
  assert.ok(after.operations.every(operation => securityRequiresCredentials(operation.security)));
  for (const operation of after.operations) {
    assert.equal(operation.unavailableReason, undefined);
    assert.deepEqual(operation.security, [[{ name: 'azure_auth', kind: 'bearer', header: 'Authorization' }]]);
    assert.deepEqual(operation.oauthScopes, [{ azure_auth: ['user_impersonation'] }]);
    assert.equal(operationServerUrl(corrected, operation), 'https://management.azure.com');
  }
  const previous = catalogs.map(catalog => ({ catalog, sourceIdentity: operationSourceIdentity(`${catalog.id}:`),
    operations: operations.filter(operation => operation.id.startsWith(`${catalog.id}:`)) }));
  const discovery = createSchemaDiscovery(after, source.effectiveSha256);
  const catalog = { id: source.id, file: 'azure-eventgrid.json', name: after.name, document: discovery.document, groups: discovery.groups,
    execution: { kind: 'http', origin: 'https://management.azure.com' } };
  publishPreparedCatalogs([...previous.filter(entry => entry.catalog.id !== source.id), {
    catalog, operations: discovery.operations, sourceIdentity: source.effectiveSha256,
  }]);
  try {
    const model = after.operations.find(operation => operation.id === 'azure-eventgrid:Operations_List');
    const document = scopeOperationSchema(corrected, model.path, model.method, true).schema;
    const operation = installOperationModel({ operation: model, document, origin: catalog.execution.origin,
      sourceIdentity: source.effectiveSha256, bytes: Buffer.byteLength(JSON.stringify(document)) });
    assert.ok(operation && !operation.unavailableReason);
    const values = { 'query:api-version': '2025-02-15' };
    const descriptor = await approvedOperation(operation, 'https://management.azure.com');
    assert.equal(descriptor.origin, 'https://management.azure.com', 'The approval binds the management resource, not the publishing audience.');
    assert.deepEqual(descriptor.operation.oauthScopes, [{ azure_auth: ['user_impersonation'] }]);
    const secret = 'azure-private-token-canary+/._-';
    const credential = { id: crypto.randomUUID(), label: 'Azure management token', kind: 'secret', value: secret, grants: [] };
    const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { azure_auth: credential.id } };
    const context = { binding, runId: crypto.randomUUID(), nodeId: 'azure-operation' };
    let calls = 0;
    const fetchRequest = async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://management.azure.com/providers/Microsoft.EventGrid/operations?api-version=2025-02-15');
      assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
      assert.equal(init.headers.get('Authorization'), `Bearer ${secret}`);
      return new Response(JSON.stringify({ value: [], reflected: secret }), { headers: { 'Content-Type': 'application/json' } });
    };
    const executor = createWorkflowExecution((approved, input, selected) => executeCredentialed(approved, input, selected.binding,
      [credential], { assertCurrent() {}, fetchRequest }));
    await assert.rejects(executor.execute(operation, values), { code: 'PERMISSION' });
    await assert.rejects(executor.execute(operation, values, undefined, { ...context, binding: { ...binding, credentials: {} } }), { code: 'PERMISSION' });
    const anonymous = createWorkflowRequestExecution(() => assert.fail('The anonymous executor must not dispatch an Azure management request.'));
    await assert.rejects(anonymous.execute(operation, values), { code: 'PERMISSION' });
    await assert.rejects(anonymous.execute({ ...operation, security: [] }, values), { code: 'PERMISSION' });
    await assert.rejects(executeCredentialed(descriptor, values, binding, [], { assertCurrent() {}, fetchRequest }), { code: 'PERMISSION' });
    const old = await approvedOperation(before.operations.find(operation => operation.id === 'azure-eventgrid:Operations_List'), descriptor.origin);
    assert.notEqual(old.fingerprint, descriptor.fingerprint);
    await assert.rejects(executor.execute(operation, values, undefined, { ...context, binding: { ...binding, fingerprint: old.fingerprint } }), { code: 'PERMISSION' });
    assert.equal(calls, 0, 'Missing credentials, anonymous bypasses and old anonymous approvals fail before network dispatch.');
    const result = await executor.execute(operation, values, undefined, context);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret), 'Private results and previews scrub reflected credentials.');
    assert.ok(!JSON.stringify(descriptor).includes(secret), 'Portable approval metadata contains no bearer value.');
    const changed = await approvedOperation({ ...operation, oauthScopes: [{ azure_auth: ['changed-permission'] }] }, descriptor.origin);
    assert.notEqual(changed.fingerprint, descriptor.fingerprint, 'Permission metadata participates in approval identity.');
    await assert.rejects(executeCredentialed(changed, values, binding, [credential], { assertCurrent() {}, fetchRequest }), { code: 'PERMISSION' });
    assert.equal(calls, 1);
  } finally { publishPreparedCatalogs(previous); }
  console.log(JSON.stringify({ provider: source.id, operations: 170, anonymousBefore: 170, credentialRequiredAfter: 170,
    resource: 'https://management.azure.com/', permission: 'user_impersonation', privateDispatch: 'passed', missingToken: 'rejected' }));
});

Then('Gemini published SDK authentication enables private API key and bearer requests without changing its source', async () => {
  const { executeCredentialed } = await import('./lib/secrets/execution.ts');
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const source = serviceSchemaDescriptors.find(source => source.id === 'gemini');
  assert.deepEqual(source.patches, [{ id: 'gemini-auth-alternatives', version: 1 }]);
  const published = await readServiceSchemaUpstream('gemini');
  const corrected = await readServiceSchema('gemini');
  assert.equal(source.sha256, 'c1187de634a269841d465bf550d90be48464ca5b206f7b0987375b208cb0c324');
  assert.equal(createHash('sha256').update(JSON.stringify(published)).digest('hex'), source.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(corrected)).digest('hex'), source.effectiveSha256);
  assert.equal(Buffer.byteLength(JSON.stringify(corrected)), source.effectiveBytes);
  assert.deepEqual(corrected.components.securitySchemes.googleGenAIAuth, published.components.securitySchemes.googleGenAIAuth);
  assert.deepEqual(corrected['x-upstream-security'], published.security);
  const before = inspectServiceSchema(published, 'gemini').operations;
  const after = inspectServiceSchema(corrected, 'gemini').operations;
  assert.equal(before.length, 37); assert.equal(after.length, 37);
  let originalAuthFailures = 0;
  for (const [path, item] of Object.entries(published.paths)) for (const [method, operation] of Object.entries(item)) {
    if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) continue;
    assert.throws(() => extractOperationSecurity(published, operation), /only HTTP bearer and Basic authentication are supported/);
    originalAuthFailures++;
    const alternatives = extractOperationSecurity(corrected, corrected.paths[path][method]);
    assert.deepEqual(alternatives, [
      [{ name: 'GeminiApiKey', kind: 'apiKey', header: 'x-goog-api-key' }],
      [{ name: 'GeminiAccessToken', kind: 'bearer', header: 'Authorization' }],
    ]);
  }
  assert.equal(originalAuthFailures, 37);
  assert.ok(after.every(operation => !/security|authentication/i.test(operation.unavailableReason ?? '')));
  const operation = after.find(operation => operation.id === 'gemini:ListAgents');
  assert.equal(operation.unavailableReason, undefined);
  const version = operation.fields.find(field => field.name === 'api_version');
  assert.ok(version, 'The declared path version remains an ordinary workflow input.');
  const descriptor = await approvedOperation(operation, 'https://generativelanguage.googleapis.com');
  for (const [alternative, requirements] of operation.security.entries()) {
    const scheme = requirements[0];
    const secret = `gemini-${scheme.kind}-private-canary+/._-`;
    const credential = { id: 'gemini-credential', label: 'Gemini credential', kind: 'secret', value: secret, grants: [] };
    const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { [scheme.name]: credential.id } };
    let calls = 0;
    const result = await executeCredentialed(descriptor, { [version.key]: 'v1beta' }, binding, [credential], {
      assertCurrent() {}, fetchRequest: async (url, init) => {
        calls++;
        assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/agents');
        assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
        assert.equal(init.headers.get(scheme.header), scheme.kind === 'bearer' ? `Bearer ${secret}` : secret);
        assert.equal(init.headers.has(scheme.kind === 'bearer' ? 'x-goog-api-key' : 'Authorization'), false,
          'Only the selected credential alternative is sent.');
        return new Response(JSON.stringify({ agents: [], reflected: secret }), { headers: { 'Content-Type': 'application/json' } });
      },
    });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret), 'Private results and previews scrub reflected credentials.');
    assert.ok(!JSON.stringify(descriptor).includes(secret), 'The portable approval retains no secret.');
    const changed = await approvedOperation({ ...operation, path: '/v1beta/other' }, descriptor.origin);
    await assert.rejects(executeCredentialed(changed, {}, binding, [credential], { assertCurrent() {}, fetchRequest: async () => {
      assert.fail('A stale destination binding must be rejected before fetch.');
    } }), { code: 'PERMISSION' });
  }
  console.log(JSON.stringify({ provider: 'gemini', operations: after.length, independentAuthBefore: originalAuthFailures,
    independentAuthAfter: 0, available: after.filter(operation => !operation.unavailableReason).length,
    limitations: after.flatMap(operation => operation.unavailableReason ? [{ id: operation.id, reason: operation.unavailableReason }] : []) }));
});

Then('DigitalOcean published permissions become canonical metadata and dispatch private unchanged bearer tokens', async () => {
  const { executeCredentialed } = await import('./lib/secrets/execution.ts');
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const source = serviceSchemaDescriptors.find(source => source.id === 'digitalocean');
  assert.deepEqual(source.patches, [{ id: 'digitalocean-bearer-permissions', version: 1 }]);
  const published = await readServiceSchemaUpstream(source.id);
  const corrected = await readServiceSchema(source.id);
  assert.equal(source.sha256, '4bcce59b45927194934c760b8201d34bcde63a7caea21840aaa2f6dc68c5b0fd', 'The published pack stays immutable.');
  assert.equal(createHash('sha256').update(JSON.stringify(published)).digest('hex'), source.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(corrected)).digest('hex'), source.effectiveSha256);
  assert.equal(Buffer.byteLength(JSON.stringify(corrected)), source.effectiveBytes);
  const originalModels = inspectServiceSchema(published, source.id).operations;
  const correctedModels = inspectServiceSchema(corrected, source.id).operations;
  const authErrors = document => Object.values(document.paths).flatMap(item => Object.entries(item)
    .filter(([method]) => ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)))
    .filter(([, operation]) => { try { extractOperationSecurity(document, operation); return false; } catch { return true; } }).length;
  assert.equal(originalModels.length, 855);
  assert.equal(correctedModels.length, 855);
  assert.equal(authErrors(published), 831);
  assert.equal(authErrors(corrected), 0);
  assert.equal(originalModels.filter(operation => /only empty scope arrays/.test(operation.unavailableReason ?? '')).length, 828);
  assert.ok(correctedModels.every(operation => !/security|authentication|scope arrays/i.test(operation.unavailableReason ?? '')));
  let permissionOperations = 0, permissionAlternatives = 0;
  for (const [path, item] of Object.entries(published.paths)) for (const [method, operation] of Object.entries(item)) {
    if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) continue;
    const requirements = operation.security ?? published.security;
    if (!requirements?.some(requirement => requirement.bearer_auth?.length)) continue;
    permissionOperations++;
    permissionAlternatives += requirements.filter(requirement => requirement.bearer_auth?.length).length;
    const effective = corrected.paths[path][method];
    assert.deepEqual(effective['x-upstream-security'], requirements);
    assert.deepEqual(effective['x-credential-permissions'], requirements.map(requirement => requirement.bearer_auth?.length
      ? { bearer_auth: requirement.bearer_auth } : {}));
    const model = correctedModels.find(candidate => candidate.path === path && candidate.method === method.toUpperCase());
    if (!model.unavailableReason) assert.deepEqual(model.credentialPermissions, effective['x-credential-permissions']);
  }
  assert.equal(permissionOperations, 831);
  assert.equal(permissionAlternatives, 835);
  const secret = 'do-test-token-canary.exact_bytes+/_-';
  const credential = { id: 'do-token', label: 'DO token', kind: 'secret', value: secret, grants: [] };
  for (const [id, path, permission] of [['digitalocean:account_get', '/v2/account', 'account:read'], ['digitalocean:droplets_list', '/v2/droplets', 'droplet:read']]) {
    const operation = correctedModels.find(operation => operation.id === id);
    assert.match(originalModels.find(operation => operation.id === id).unavailableReason, /only empty scope arrays/);
    assert.equal(operation.unavailableReason, undefined);
    assert.deepEqual(operation.credentialPermissions, [{ bearer_auth: [permission] }]);
    const descriptor = await approvedOperation(operation, 'https://api.digitalocean.com');
    assert.deepEqual(descriptor.operation.credentialPermissions, operation.credentialPermissions);
    const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { bearer_auth: credential.id } };
    let calls = 0;
    const result = await executeCredentialed(descriptor, {}, binding, [credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls++;
      assert.equal(String(url), `https://api.digitalocean.com${path}`);
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.get('Authorization'), `Bearer ${secret}`);
      assert.equal(init.credentials, 'omit');
      return new Response(JSON.stringify({ status: 'ok', reflected: secret }), { headers: { 'Content-Type': 'application/json' } });
    } });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret), 'Private results scrub echoed tokens.');
    assert.ok(!JSON.stringify(descriptor).includes(secret), 'Approvals retain permissions without tokens.');
    const changed = await approvedOperation({ ...operation, credentialPermissions: [{ bearer_auth: [permission, 'account:write'] }] }, descriptor.origin);
    assert.notEqual(changed.fingerprint, descriptor.fingerprint);
    await assert.rejects(executeCredentialed(changed, {}, binding, [credential], { assertCurrent() {}, fetchRequest: async () => {
      assert.fail('A stale permission binding must be rejected before fetch.');
    } }), { code: 'PERMISSION' });
  }
  console.log(JSON.stringify({ provider: 'digitalocean', operations: correctedModels.length, independentAuthBefore: 831,
    independentAuthAfter: 0, primaryFailuresBefore: originalModels.filter(operation => operation.unavailableReason).length,
    primaryFailuresAfter: correctedModels.filter(operation => operation.unavailableReason).length,
    limitations: [...new Set(correctedModels.flatMap(operation => operation.unavailableReason ? [operation.unavailableReason] : []))] }));
});

Then('Google grant normalization preserves scope alternatives without weakening unrelated authentication', () => {
  const permissions = { read: 'Read data', write: 'Write data' };
  const authorizationUrl = 'https://accounts.google.com/o/oauth2/auth';
  const document = { openapi: '3.0.3', info: { title: 'Google grant fixture', version: 'v1' },
    components: { securitySchemes: {
      Oauth2: { type: 'oauth2', flows: { implicit: { authorizationUrl, scopes: permissions } } },
      Oauth2c: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl, scopes: permissions,
        tokenUrl: 'https://accounts.google.com/o/oauth2/token' } } },
      ProjectKey: { type: 'apiKey', in: 'query', name: 'key' },
    } },
    security: [{ Oauth2: ['read'], Oauth2c: ['read'], ProjectKey: [] }],
    paths: { '/items': {
      get: { security: [{ Oauth2: ['read'], Oauth2c: ['read'] }, { Oauth2: ['write'], Oauth2c: ['write'] }] },
      post: { security: [{ Oauth2: ['read', 'write'], Oauth2c: ['write', 'read'] }] },
      options: { security: [] },
      head: { security: [{}] },
      delete: { security: [{ ProjectKey: [] }] },
    } },
  };
  const before = structuredClone(document);
  const adapted = adaptGoogleOauthSchema(document);
  assert.deepEqual(document, before, 'Source input must remain unchanged.');
  assert.deepEqual(adaptGoogleOauthSchema(adapted), adapted, 'Repeated adaptation must be byte-stable.');
  assert.deepEqual(adapted.components, before.components, 'Both original OAuth flow descriptions stay inspectable.');
  assert.deepEqual(adapted.security, [{ ProjectKey: [], Oauth2: ['read'] }, { ProjectKey: [], Oauth2c: ['read'] }], 'A separate API key remains required with either OAuth flow.');
  assert.deepEqual(adapted['x-upstream-security'], before.security);
  assert.deepEqual(adapted.paths['/items'].get.security, [{ Oauth2: ['read'] }, { Oauth2c: ['read'] }, { Oauth2: ['write'] }, { Oauth2c: ['write'] }]);
  assert.deepEqual(adapted.paths['/items'].post.security, [{ Oauth2: ['read', 'write'] }, { Oauth2c: ['write', 'read'] }]);
  for (const method of ['get', 'post'])
    assert.deepEqual(adapted.paths['/items'][method]['x-upstream-security'], before.paths['/items'][method].security);
  for (const method of ['options', 'head', 'delete']) assert.deepEqual(adapted.paths['/items'][method], before.paths['/items'][method]);
  for (const corrupt of [
    source => { source.paths['/items'].get.security[0].Oauth2c = ['write']; },
    source => { source.components.securitySchemes.Oauth2c.flows.authorizationCode.tokenUrl = 'https://example.com/token'; },
    source => { source.components.securitySchemes.Oauth2.flows.implicit.scopes = {}; },
    source => { source.paths['/items'].get.security[0].Oauth2c = [42]; },
    source => { delete source.components.securitySchemes.Oauth2; },
    source => { source.paths['/items'].get['x-upstream-security'] = []; },
  ]) {
    const invalid = structuredClone(document); corrupt(invalid);
    assert.throws(() => adaptGoogleOauthSchema(invalid), /Google OAuth adaptation/);
  }
});

Then('Google Cloud corrections preserve published packs and enable both private bearer alternatives', async () => {
  const { executeCredentialed } = await import('./lib/secrets/execution.ts');
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const sources = serviceSchemaDescriptors.filter(source => source.provider === 'gcp');
  assert.equal(sources.length, 52);
  let available = 0, unavailable = 0;
  for (const source of sources) {
    assert.deepEqual(source.patches, [{ id: 'google-oauth-alternatives', version: 1 }]);
    const document = await readServiceSchema(source.id);
    assert.equal(createHash('sha256').update(JSON.stringify(document)).digest('hex'), source.effectiveSha256);
    const inspection = inspectServiceSchema(document, source.id);
    available += inspection.operations.filter(operation => !operation.unavailableReason).length;
    unavailable += inspection.operations.filter(operation => operation.unavailableReason).length;
  }
  assert.equal(available, 2121);
  assert.equal(unavailable, 7, 'Separate request-media limitations remain explicit.');
  const original = await readServiceSchemaUpstream('gcp-speech');
  const corrected = await readServiceSchema('gcp-speech');
  const id = 'gcp-speech:speech.operations.list';
  const before = inspectServiceSchema(original, 'gcp-speech', new Set([id])).operations[0];
  assert.match(before.unavailableReason, /duplicate credential header/i);
  const operation = inspectServiceSchema(corrected, 'gcp-speech', new Set([id])).operations[0];
  assert.equal(operation.unavailableReason, undefined);
  const descriptor = await approvedOperation(operation, 'https://speech.googleapis.com');
  const secret = 'google-test-token-canary';
  const credential = { id: 'google-token', label: 'Google token', kind: 'secret', value: secret, grants: [] };
  assert.equal(operation.security.length, 2);
  for (const [alternative, schemes] of operation.security.entries()) {
    assert.equal(schemes.length, 1);
    assert.ok(operation.oauthScopes[alternative][schemes[0].name].length);
    assert.deepEqual(descriptor.operation.oauthScopes, operation.oauthScopes);
    const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { [schemes[0].name]: credential.id } };
    let calls = 0;
    const result = await executeCredentialed(descriptor, {}, binding, [credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
      calls++;
      assert.equal(String(url), 'https://speech.googleapis.com/v1/operations');
      assert.equal(init.method, operation.method);
      assert.equal(init.headers.get('Authorization'), `Bearer ${secret}`);
      assert.equal(init.credentials, 'omit');
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    } });
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(secret));
  }
  assert.notDeepEqual(original, corrected);
});

const fixture = data => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  return { pack: `data:application/gzip;base64,${gzipSync(bytes).toString('base64')}`,
    descriptor: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
};
Then('corrected schema packs reject stale revision metadata while retaining the published source', async () => {
  const source = serviceSchemaDescriptors.find(source => source.id === 'gcp-speech');
  const original = await readServiceSchemaUpstream(source.id);
  const packed = fixture(original);
  const descriptor = { ...source, ...packed.descriptor };
  const library = { descriptors: [descriptor], packs: { [`../catalogs/services/${source.id}.json.gz`]: packed.pack } };
  assert.deepEqual(await readServiceSchema(source.id, library), await readServiceSchema(source.id));
  for (const stale of [{ effectiveBytes: source.effectiveBytes + 1 }, { effectiveSha256: '0'.repeat(64) }]) {
    const invalid = { ...library, descriptors: [{ ...descriptor, ...stale }] };
    await assert.rejects(readServiceSchema(source.id, invalid), /corrected schema does not match its reviewed revision/);
    assert.deepEqual(await readServiceSchema(source.id, invalid, true), original,
      'Invalid correction metadata cannot alter the independently verified published source.');
  }
});
Then('all service schema packs match their size hash and operation inventory', async () => {
  const ids = serviceSchemaDescriptors.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(serviceSchemaDescriptors.map(item => item.provider ?? item.id))].sort(), [
    'anthropic', 'atlassian', 'aws', 'azure', 'bluesky', 'cloudflare', 'cohere', 'deepseek',
    'digitalocean', 'discord', 'docker', 'dukascopy', 'ecb', 'elevenlabs', 'frankfurter', 'fred', 'gcp',
    'gemini', 'github', 'gitlab', 'google', 'groq', 'hetzner', 'huggingface', 'mistral', 'ollama', 'openai',
    'openrouter', 'render', 'replicate', 'resend', 'telegram', 'together', 'twilio', 'vercel', 'x', 'xai'
  ]);
  for (const descriptor of serviceSchemaDescriptors) {
    const document = await readServiceSchema(descriptor.id);
    assert.equal(document.openapi, descriptor.openapi, descriptor.id);
    assert.equal(document.info.version, descriptor.version, descriptor.id);
    const seen = new Set();
    function references(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string' && !seen.has(value.$ref)) {
        seen.add(value.$ref);
        assert.ok(value.$ref.startsWith('#/'), `${descriptor.id}: external reference ${value.$ref}`);
        const target = decodeURIComponent(value.$ref.slice(2)).split('/').reduce((parent, part) =>
          parent?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], document);
        assert.notEqual(target, undefined, `${descriptor.id}: unresolved reference ${value.$ref}`);
      }
      for (const [key, child] of Object.entries(value))
        if (!['example', 'examples', 'default'].includes(key)) references(child);
    }
    references(document);
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    assert.equal(descriptor.protocol === 'json-rpc' ? document.definitions.ClientRequest.oneOf.length
      : Object.values(document.paths).reduce((count, item) => count + Object.keys(item).filter(key => methods.has(key)).length, 0),
      descriptor.operations, descriptor.id);
  }
  const large = fixture({ description: 'test '.repeat(20_000) });
  assert.deepEqual(await decodeServiceSchema(large.pack, large.descriptor), { description: 'test '.repeat(20_000) });
  await assert.rejects(readServiceSchema('does-not-exist'), /unavailable/);
  await assert.rejects(readServiceSchema(serviceSchemaDescriptors[0].id, { descriptors: serviceSchemaDescriptors, packs: {} }), /unavailable/);
});

Then('the pinned Codex schema preserves requests responses and events with execution unavailable', async () => {
  const source = serviceSchemaDescriptors.find(source => source.id === 'codex');
  assert.equal(source.name, 'OpenAI / Codex / App Server');
  assert.equal(source.version, '0.163.0');
  assert.equal(source.protocol, 'json-rpc');
  assert.equal(source.operations, 105);
  assert.ok(source.url.includes('/openai/codex/rust-v0.163.0/'));
  const document = await readServiceSchema(source.id);
  const { info, 'x-codex-app-server': metadata, ...native } = document;
  assert.equal(info.license.name, 'Apache-2.0');
  assert.equal(metadata.protocol, 'json-rpc');
  assert.equal(document.openapi, undefined);
  assert.equal(document.paths, undefined);
  assert.equal(document.servers, undefined);
  assert.equal(native.definitions.ServerRequest.oneOf.length, 10);
  assert.equal(native.definitions.ServerNotification.oneOf.length, 85);
  assert.equal(native.definitions.ClientNotification.oneOf.length, 1);
  const original = structuredClone(native);
  assert.deepEqual(annotateCodexSchema(native, source), document);
  assert.deepEqual(native, original, 'Adding catalog annotations preserves every original definition.');
  const inspected = inspectServiceSchema(document, source.id);
  const withoutDescription = structuredClone(document);
  delete withoutDescription.info.description;
  assert.equal(inspectServiceSchema(withoutDescription, source.id).groups[0].description, '', 'A native bundle does not require an optional description.');
  assert.deepEqual(validateSchemaDocument(document, source.id), inspected, 'Downloaded native schemas remain importable.');
  assert.equal(inspected.serverUrl, '');
  assert.equal(inspected.operations.length, source.operations);
  for (const method of ['initialize', 'account/login/start', 'account/read', 'model/list', 'thread/start', 'thread/resume', 'turn/start', 'turn/interrupt'])
    assert.ok(inspected.operations.some(operation => operation.id === `codex:${method}`), method);
  for (const operation of inspected.operations) {
    assert.equal(operation.method, 'RPC');
    assert.equal(operation.unavailableReason, codexExecutionLimitation);
    assert.throws(() => operationServerUrl(document, operation), /paths/);
  }
  const discovery = createSchemaDiscovery(inspected, source.sha256);
  assert.deepEqual(validateSchemaDiscovery(discovery, source.id, source.sha256), discovery);
  assert.equal(discovery.summary.protocol, 'json-rpc');
  assert.equal(discovery.summary.unavailableCount, 105);
  assert.equal(discovery.document.openapi, undefined);
  assert.equal(discovery.document.paths, undefined);
  assert.equal(discovery.document.definitions, undefined, 'Discovery does not copy the full protocol bundle.');
  assert.ok(discovery.operations.every(operation => operation.deferred && operation.unavailableReason));
  assert.deepEqual(inspectServiceSchema(document, source.id, new Set(['codex:turn/start'])).operations,
    inspected.operations.filter(operation => operation.id === 'codex:turn/start'));
  assert.equal((await readServiceSchema('openai')).openapi, '3.1.0', 'The separate OpenAI HTTP schema remains available.');
});

Then('Codex inspection rejects incomplete protocols duplicate methods and forged HTTP routes', async () => {
  const document = await readServiceSchema('codex');
  for (const corrupt of [
    value => { value['x-codex-app-server'] = null; },
    value => { value.info.title = ''; },
    value => { value.info.version = 'another-version'; },
    value => { value.$schema = 'another-dialect'; },
    value => { delete value.definitions.JSONRPCResponse; },
    value => { value.definitions.ClientRequest.oneOf = []; },
    value => { value.definitions.ClientRequest.oneOf.push(value.definitions.ClientRequest.oneOf[0]); },
    value => { value.definitions.ClientRequest.oneOf[0].properties.method.enum = ['initialize', 'another']; },
    value => { value.definitions.ClientRequest.oneOf[0].properties.method.enum = ['https://example.com']; },
    value => { value.definitions.ClientRequest.oneOf[0].required = ['method']; },
    value => { value.openapi = '3.1.0'; value.paths = { '/turn/start': { post: {} } }; },
  ]) {
    const invalid = structuredClone(document); corrupt(invalid);
    assert.throws(() => inspectServiceSchema(invalid, 'codex'), /Invalid Codex App Server schema/);
    assert.throws(() => validateSchemaDocument(invalid, 'codex'), /Invalid Codex App Server schema/);
  }
  const { info: _info, 'x-codex-app-server': _metadata, ...native } = document;
  assert.throws(() => annotateCodexSchema(native, { id: 'codex', version: '', provenance: 'https://example.com' }), /pinned version/);
  assert.throws(() => annotateCodexSchema(native, { id: 'codex', version: '0.163.0' }), /provenance/);
});

Then('embedded ReDoc exports preserve OpenAPI data and reject missing malformed or incomplete contracts', async () => {
  const { extractRedocSchema } = await import('../build/redoc-schema.mjs');
  const document = { openapi: '3.0.3', info: { title: 'Status API', version: '1', description: 'Braces { } and escaped "quotes" \\ are data.' },
    paths: { '/status': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } } } } } },
    components: { schemas: { Status: { type: 'string', enum: ['operational', 'degraded'] } } } };
  for (const declaration of ['const', 'let', 'var']) {
    const before = globalThis.__redocExecuted;
    const html = `<html><script>${declaration} __redoc_state = ${JSON.stringify({ spec: { data: document }, menu: {} })};\n`
      + 'globalThis.__redocExecuted = true; Redoc.hydrate(__redoc_state);</script></html>';
    assert.deepEqual(extractRedocSchema(html), document);
    assert.equal(globalThis.__redocExecuted, before, 'Only JSON is parsed; surrounding JavaScript must never execute.');
  }
  for (const html of ['', '<html>Missing contract</html>', 'const __redoc_state = {"spec":',
    'const __redoc_state = {spec: {data: {}}};', 'const __redoc_state = {"spec":{"data":[]}};',
    'const __redoc_state = {"spec":{"data":{"openapi":"2.0","info":{},"paths":{}}}};'])
    assert.throws(() => extractRedocSchema(html));
});

Then('method and path identities preserve aliased operations and recursive models without changing existing contracts', async () => {
  const { useMethodPathOperationIds } = await import('../build/service-operation-identities.mjs');
  const document = { openapi: '3.0.3', info: { title: 'Aliased API', version: '1' },
    paths: {
      '/v1/items/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'read', security: [{ Token: [] }], responses: { '200': { description: 'OK',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } } } },
      '/latest/items/{id}': { $ref: '#/paths/~1v1~1items~1%7Bid%7D' },
      '/other': { get: { operationId: 'read', responses: { '200': { description: 'OK' } } } },
    }, components: { schemas: { Item: { type: 'object', properties: {
      operationId: { type: 'string', example: 'data, not a workflow identity' },
      child: { $ref: '#/components/schemas/Item' },
    } } } } };
  const before = structuredClone(document);
  const adapted = useMethodPathOperationIds(document);
  assert.deepEqual(document, before);
  for (const [path, item] of Object.entries(adapted.paths)) assert.equal(item.get.operationId, `GET ${path}`);
  assert.equal(adapted.paths['/latest/items/{id}']['x-upstream-path-ref'], document.paths['/latest/items/{id}'].$ref);
  assert.equal(adapted.paths['/latest/items/{id}'].get['x-upstream-operation-id'], 'read');
  assert.deepEqual(adapted.paths['/latest/items/{id}'].parameters, document.paths['/v1/items/{id}'].parameters);
  assert.deepEqual(adapted.paths['/latest/items/{id}'].get.security, [{ Token: [] }]);
  assert.deepEqual(adapted.components, document.components);
  assert.equal(adapted.paths['/v1/items/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/Item');
  const invalid = structuredClone(document);
  invalid.paths['/v1/items/{id}'] = { $ref: '#/paths/~1latest~1items~1%7Bid%7D' };
  assert.throws(() => useMethodPathOperationIds(invalid), /cyclic/);
});
Then('service schema decoding rejects corrupt metadata compressed data and JSON', async () => {
  const valid = fixture({ openapi: '3.1.0' });
  for (const bytes of [0, -1, 1.5, 65 * 1024 * 1024])
    await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes }), /metadata/);
  await assert.rejects(decodeServiceSchema('not-a-data-url', valid.descriptor), /metadata/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: 1 }), /recorded size/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: valid.descriptor.bytes + 1 }), /incomplete/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, sha256: '0'.repeat(64) }), /hash/);
  await assert.rejects(decodeServiceSchema('data:application/gzip;base64,YmFk', valid.descriptor));
  for (const value of [null, [], true, 'schema', 12]) {
    const item = fixture(value);
    await assert.rejects(decodeServiceSchema(item.pack, item.descriptor), /schema document/);
  }
  for (const bytes of [Buffer.from('{broken'), Buffer.from([255])]) {
    const item = fixture(bytes);
    await assert.rejects(decodeServiceSchema(item.pack, item.descriptor));
  }
});

Then('native and compatible schema decoders retain identical data and corruption guards', async () => {
  const property = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  const native = Uint8Array.fromBase64;
  assert.equal(typeof native, 'function', 'The pinned Node runtime must exercise the native decoder.');
  const document = { openapi: '3.1.0', description: 'Élément 中 𠀀 😀 '.repeat(10_000), paths: {} };
  const valid = fixture(document);
  let nativeCalls = 0;
  try {
    for (const enabled of [true, false]) {
      Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: enabled ? value => {
        nativeCalls++; return native(value);
      } : undefined });
      assert.deepEqual(await decodeServiceSchema(valid.pack, valid.descriptor), document);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, sha256: '0'.repeat(64) }), /hash/);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: 1 }), /recorded size/);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: valid.descriptor.bytes + 1 }), /incomplete/);
      await assert.rejects(decodeServiceSchema('data:application/gzip;base64,YmFk', valid.descriptor));
      await assert.rejects(decodeServiceSchema('data:application/gzip;base64,A', valid.descriptor));
    }
    assert.ok(nativeCalls > 0, 'The native path must not silently fall back.');
  } finally {
    if (property) Object.defineProperty(Uint8Array, 'fromBase64', property);
    else delete Uint8Array.fromBase64;
  }
});

Then('external Swagger references remain valid after bundling and OpenAPI conversion', async () => {
  const { bundleSwaggerReferences } = await import('../build/swagger-references.mjs');
  const { default: converter } = await import('swagger2openapi');
  const source = { swagger: '2.0', info: { title: 'Recursive API', version: '1' }, host: 'api.example.com', schemes: ['https'], produces: ['application/json'],
    paths: { '/errors': { get: { parameters: [{ $ref: 'types.json#/parameters/ApiVersion' }], responses: { '200': {
      description: 'Errors', schema: { $ref: 'types.json#/definitions/Error' }
    } }, 'x-examples': { Example: { $ref: 'example.json' } } } } } };
  const external = {
    'https://schemas.test/types.json': { definitions: { Error: { type: 'object', properties: { details: {
      type: 'array', items: { $ref: '#/definitions/Error' }
    } } } }, parameters: { ApiVersion: { name: 'api-version', in: 'query', type: 'string', required: true } } },
    'https://schemas.test/example.json': { parameters: { 'api-version': '1' }, responses: { '200': { details: [] } } }
  };
  const calls = [];
  const download = async url => { calls.push(url); return JSON.stringify(external[url]); };
  const bundled = await bundleSwaggerReferences(source, 'https://schemas.test/root.json', download);
  const { openapi } = await converter.convertObj(bundled, { patch: true, warnOnly: false });
  const get = ref => ref.slice(2).split('/').reduce((value, key) => value[key], openapi);
  const response = openapi.paths['/errors'].get.responses['200'].content['application/json'].schema;
  const error = get(response.$ref);
  assert.equal(get(error.properties.details.items.$ref), error);
  const parameter = get(openapi.paths['/errors'].get.parameters[0].$ref);
  assert.equal(parameter.schema.type, 'string');
  assert.deepEqual(calls.sort(), Object.keys(external).sort());
  await assert.rejects(bundleSwaggerReferences({ definitions: { Invalid: { $ref: 'types.json#/missing/Test' } } },
    'https://schemas.test/root.json', download), /Unsupported external/);
  await assert.rejects(bundleSwaggerReferences({ definitions: { Invalid: { $ref: 'types.json#/definitions/Absent' } } },
    'https://schemas.test/root.json', download), /Missing Swagger reference/);
});
