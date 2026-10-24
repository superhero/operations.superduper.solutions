// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { mergeSchemaDocuments, sameSchemaValue, schemaChanges } from './lib/schema-merge.ts';
import { applySchemaPatches, azureEventGridManagementAuth, digitalOceanBearerPermissions, geminiAuthAlternatives, googleOauthAlternatives, schemaPatchName } from './lib/schema-patches.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { schemaLineDiff, schemaPointerValue } from './lib/schema-diff.ts';

Then('schema merges preserve unrelated edits deletions and identical changes', () => {
  const base = { info: { title: 'Published', version: '1', description: 'Old' }, paths: { '/items': {} }, obsolete: true };
  const current = structuredClone(base); current.info.title = 'Personal name';
  const incoming = structuredClone(base); incoming.info.version = '2'; incoming.info.description = 'New'; incoming.paths['/new'] = {}; delete incoming.obsolete;
  const before = structuredClone([base, current, incoming]);
  const merged = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(merged, { conflicts: [], document: { info: { title: 'Personal name', version: '2', description: 'New' }, paths: { '/items': {}, '/new': {} } } });
  assert.deepEqual([base, current, incoming], before);
  assert.deepEqual(mergeSchemaDocuments(base, incoming, incoming), { conflicts: [], document: incoming });
  assert.ok(sameSchemaValue({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }));
});

Then('schema merge conflicts distinguish missing null arrays and concurrent object edits', () => {
  const base = { info: { title: 'Original' }, nullable: null, security: [{ token: [] }], removed: { a: 1 } };
  const current = structuredClone(base); current.info.title = 'Local'; current.security = [{ local: [] }]; current.removed.a = 2; delete current.nullable;
  const incoming = structuredClone(base); incoming.info.title = 'Upstream'; incoming.security = [{ remote: [] }]; incoming.nullable = 'new'; delete incoming.removed;
  const result = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(result.conflicts.map(item => item.path).sort(), ['/info/title', '/nullable', '/removed', '/security']);
  assert.deepEqual(result.document, current);
  assert.equal(Object.hasOwn(result.conflicts.find(item => item.path === '/nullable'), 'current'), false);
  const resolved = mergeSchemaDocuments(base, current, incoming, { '/info/title': 'current', '/nullable': 'incoming', '/removed': 'incoming', '/security': 'incoming' });
  assert.deepEqual(resolved, { conflicts: [], document: { info: { title: 'Local' }, nullable: 'new', security: [{ remote: [] }] } });
  assert.throws(() => mergeSchemaDocuments(base, current, incoming, { '/info/title': 'unknown' }), /Choose/);
  const additions = mergeSchemaDocuments({}, { created: { title: 'Local' } }, { created: { title: 'Published' } });
  assert.deepEqual(additions, { document: { created: { title: 'Local' } }, conflicts: [
    { path: '/created', current: { title: 'Local' }, incoming: { title: 'Published' } },
  ] }, 'Concurrent additions conflict without inventing a base value.');
});

Then('schema merge paths preserve special keys and bound changed-field reports', () => {
  const base = JSON.parse('{"__proto__":{"safe":1},"a/b~c":1}');
  const current = JSON.parse('{"__proto__":{"safe":2},"a/b~c":2}');
  const incoming = JSON.parse('{"__proto__":{"safe":3},"a/b~c":3}');
  const result = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(result.conflicts.map(item => item.path), ['/__proto__/safe', '/a~1b~0c']);
  assert.equal(Object.getPrototypeOf(result.document), Object.prototype);
  assert.equal(Object.hasOwn(result.document, '__proto__'), true);
  assert.equal({}.safe, undefined);
  const diff = schemaChanges(base, incoming, 1);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.truncated, true);
  assert.deepEqual(schemaChanges(base, { 'a/b~c': 1 }).changes, [{ path: '/__proto__', kind: 'removed', before: { safe: 1 } }]);
  assert.deepEqual(schemaChanges({ removed: null }, { added: null }), { changes: [
    { path: '/removed', kind: 'removed', before: null }, { path: '/added', kind: 'added', after: null },
  ], truncated: false }, 'Missing values and explicit null stay distinct in either direction.');
  assert.deepEqual(schemaChanges('before', 'after'), { changes: [
    { path: '/', kind: 'changed', before: 'before', after: 'after' },
  ], truncated: false }, 'A complete value replacement has a root path.');
});

Then('reviewed schema corrections preserve upstream-fixed data and reject unknown recipes', () => {
  const fixed = { openapi: '3.0.3', security: [{ Oauth2: ['scope'] }, { Oauth2c: ['scope'] }], paths: {} };
  assert.equal(applySchemaPatches(fixed), fixed, 'Documents without corrections retain their original identity.');
  assert.equal(applySchemaPatches(fixed, []), fixed);
  assert.equal(schemaPatchName(googleOauthAlternatives), 'Google OAuth alternatives');
  assert.equal(schemaPatchName({ id: 'unrecognized', version: 1 }), 'Unknown schema correction');
  assert.deepEqual(applySchemaPatches(fixed, [googleOauthAlternatives]), fixed);
  assert.deepEqual(applySchemaPatches(applySchemaPatches(fixed, [googleOauthAlternatives]), [googleOauthAlternatives]), fixed);
  assert.throws(() => applySchemaPatches(fixed, [{ id: 'arbitrary', version: 1 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [{ ...googleOauthAlternatives, version: 2 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [googleOauthAlternatives, googleOauthAlternatives]), /duplicated/);
  const incomplete = { openapi: '3.1.0', info: { title: 'No paths' } };
  assert.deepEqual(applySchemaPatches(incomplete, [googleOauthAlternatives]), incomplete);
  const metadata = { paths: { '/missing': null, '/items': { summary: 'Metadata', get: null, post: [] } } };
  assert.deepEqual(applySchemaPatches(metadata, [googleOauthAlternatives]), metadata,
    'Corrections leave non-operation path metadata and malformed entries untouched.');
});

const digitalOceanFixture = () => ({ openapi: '3.0.0', info: { title: 'DigitalOcean', version: '2' },
  servers: [{ url: 'https://api.digitalocean.com' }], components: { securitySchemes: {
    bearer_auth: { type: 'http', scheme: 'bearer' },
    inference_bearer_auth: { type: 'http', scheme: 'bearer' },
    Project: { type: 'apiKey', in: 'header', name: 'X-Project' },
  } }, security: [{ bearer_auth: ['account:read'] }], paths: { '/v2/items': {
    get: { security: [{ bearer_auth: ['droplet:read'], Project: [] }, {}, { inference_bearer_auth: [] }, { bearer_auth: [] }] },
    post: {}, head: { security: [] }, options: { security: [{}] }, delete: { security: [{ Project: [] }] },
  } },
});

const geminiFixture = () => ({ openapi: '3.0.3', info: { title: 'Gemini API', version: 'v1beta' },
  servers: [{ url: 'https://generativelanguage.googleapis.com' }], components: { securitySchemes: {
    googleGenAIAuth: { type: 'http', scheme: 'custom', 'x-speakeasy-custom-security-scheme': { schema: {
      type: 'object', properties: { apiKey: { type: 'string' }, accessToken: { type: 'string' },
        defaultHeaders: { type: 'object', additionalProperties: { type: 'string' } } }, required: [],
    } } }, Project: { type: 'apiKey', in: 'header', name: 'X-Project' },
  } }, security: [{ googleGenAIAuth: [] }], paths: { '/v1beta/agents': {
    get: { security: [{ googleGenAIAuth: [], Project: [] }, {}, { Project: [] }] },
    post: {}, head: { security: [] }, options: { security: [{}] }, delete: { security: [{ Project: [] }] },
  } },
});

const eventGridFixture = () => ({ openapi: '3.0.0', info: { title: 'EventGridManagementClient', version: '2025-02-15' },
  servers: [{ url: 'https://management.azure.com' }], components: { securitySchemes: {
    azure_auth: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/authorize',
      scopes: { user_impersonation: 'impersonate your user account' } } } },
    Project: { type: 'apiKey', in: 'header', name: 'X-Project' },
  } }, paths: {
    '/providers/Microsoft.EventGrid/operations': { summary: 'Management', get: {}, post: {
      security: [{ azure_auth: ['user_impersonation'], Project: [] }],
    } },
    '/public': { get: { security: [], servers: [{ url: 'https://public.example.test' }] }, head: { security: [{}] } },
  },
});

Then('Event Grid corrections attach existing Azure permissions while preserving public and protected overrides', () => {
  const source = eventGridFixture(), before = structuredClone(source);
  const corrected = applySchemaPatches(source, [azureEventGridManagementAuth]);
  assert.deepEqual(source, before);
  assert.equal(schemaPatchName(azureEventGridManagementAuth), 'Azure Event Grid management authentication');
  assert.deepEqual(corrected.security, [{ azure_auth: ['user_impersonation'] }]);
  assert.equal(corrected['x-upstream-security'], null, 'Missing upstream security is distinct from an anonymous requirement.');
  assert.deepEqual(corrected.paths, before.paths, 'Public and AND-protected operation overrides stay unchanged.');
  assert.deepEqual(corrected.components, before.components, 'The existing Azure flow and its permissions stay intact.');
  assert.deepEqual(applySchemaPatches(corrected, [azureEventGridManagementAuth]), corrected);
  const operations = inspectServiceSchema(corrected, 'azure-eventgrid').operations;
  const inherited = operations.find(operation => operation.method === 'GET' && operation.path.endsWith('/operations'));
  assert.deepEqual(inherited.security, [[{ name: 'azure_auth', kind: 'bearer', header: 'Authorization' }]]);
  assert.deepEqual(inherited.oauthScopes, [{ azure_auth: ['user_impersonation'] }]);
  const publicOperation = operations.find(operation => operation.path === '/public' && operation.method === 'GET');
  assert.deepEqual(publicOperation.security, []);
  assert.equal(publicOperation.oauthScopes, undefined);
  assert.equal(operations.find(operation => operation.method === 'POST').security[0].length, 2);
  for (const declaration of [[{ azure_auth: ['user_impersonation'] }], [], [{}], null]) {
    const fixed = structuredClone(source); fixed.security = declaration;
    assert.deepEqual(applySchemaPatches(fixed, [azureEventGridManagementAuth]), fixed,
      'An explicit published requirement is not overwritten or repaired into different authority.');
  }
  const local = structuredClone(corrected); local.info.description = 'My Azure account';
  const published = structuredClone(source); published.info.version = 'next';
  const merged = mergeSchemaDocuments(corrected, local, applySchemaPatches(published, [azureEventGridManagementAuth]));
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.document.info.description, local.info.description);
  assert.equal(merged.document.info.version, 'next');
  const overrides = eventGridFixture(); overrides.paths['/providers/Microsoft.EventGrid/operations'].servers = overrides.servers;
  overrides.paths['/providers/Microsoft.EventGrid/operations'].get.servers = overrides.servers;
  overrides.paths['/missing'] = null; overrides.paths['/metadata'] = { summary: 'metadata', get: null };
  assert.deepEqual(applySchemaPatches(overrides, [azureEventGridManagementAuth]).security, corrected.security);
});

Then('Event Grid correction rejects the unreviewed contract {string}', kind => {
  const changes = {
    'wrong provider': doc => { doc.info.title = 'Another Azure service'; },
    'wrong version': doc => { doc.openapi = '2.0'; },
    'missing paths': doc => { delete doc.paths; },
    'wrong audience': doc => { doc.servers = [{ url: 'https://eventgrid.azure.net' }]; },
    'empty servers': doc => { doc.servers = []; },
    'malformed server': doc => { doc.servers = [null]; },
    'missing OAuth': doc => { delete doc.components.securitySchemes.azure_auth; },
    'wrong OAuth type': doc => { doc.components.securitySchemes.azure_auth.type = 'http'; },
    'additional flow': doc => { doc.components.securitySchemes.azure_auth.flows.clientCredentials = {}; },
    'different flow': doc => { doc.components.securitySchemes.azure_auth.flows = { password: {} }; },
    'wrong issuer': doc => { doc.components.securitySchemes.azure_auth.flows.implicit.authorizationUrl = 'https://example.test/authorize'; },
    'missing permissions': doc => { delete doc.components.securitySchemes.azure_auth.flows.implicit.scopes; },
    'different permission': doc => { doc.components.securitySchemes.azure_auth.flows.implicit.scopes = { read: 'Read' }; },
    'blank permission': doc => { doc.components.securitySchemes.azure_auth.flows.implicit.scopes.user_impersonation = ''; },
    'public inherited route': doc => { doc.paths['/health'] = { get: {} }; },
    'operation destination': doc => { doc.paths['/providers/Microsoft.EventGrid/operations'].get.servers = [{ url: 'https://other.example.test' }]; },
    'path destination': doc => { doc.paths['/providers/Microsoft.EventGrid/operations'].servers = [{ url: 'https://other.example.test' }]; },
    'provenance collision': doc => { doc['x-upstream-security'] = []; },
    'permission collision': doc => { doc['x-credential-permissions'] = []; },
  };
  assert.ok(changes[kind], `Unknown Event Grid contract: ${kind}`);
  const source = eventGridFixture(); changes[kind](source); const before = structuredClone(source);
  assert.throws(() => applySchemaPatches(source, [azureEventGridManagementAuth]), /Azure Event Grid authentication adaptation/);
  assert.deepEqual(source, before, 'Rejected corrections cannot partially modify a published schema.');
});

Then('Gemini corrections preserve published SDK metadata AND credentials and anonymous overrides', () => {
  const source = geminiFixture(), before = structuredClone(source);
  const corrected = applySchemaPatches(source, [geminiAuthAlternatives]);
  assert.deepEqual(source, before);
  assert.equal(schemaPatchName(geminiAuthAlternatives), 'Gemini authentication alternatives');
  assert.deepEqual(corrected.security, [{ GeminiApiKey: [] }, { GeminiAccessToken: [] }]);
  assert.deepEqual(corrected['x-upstream-security'], before.security);
  assert.deepEqual(corrected.components.securitySchemes.googleGenAIAuth, before.components.securitySchemes.googleGenAIAuth);
  assert.deepEqual(corrected.components.securitySchemes.GeminiApiKey, { type: 'apiKey', in: 'header', name: 'x-goog-api-key' });
  assert.deepEqual(corrected.components.securitySchemes.GeminiAccessToken, { type: 'http', scheme: 'bearer' });
  assert.deepEqual(corrected.paths['/v1beta/agents'].get.security, [
    { Project: [], GeminiApiKey: [] }, { Project: [], GeminiAccessToken: [] }, {}, { Project: [] },
  ]);
  assert.deepEqual(corrected.paths['/v1beta/agents'].get['x-upstream-security'], before.paths['/v1beta/agents'].get.security);
  for (const method of ['post', 'head', 'options', 'delete'])
    assert.deepEqual(corrected.paths['/v1beta/agents'][method], before.paths['/v1beta/agents'][method]);
  assert.ok(inspectServiceSchema(corrected, 'gemini').operations.every(operation => !operation.unavailableReason));
  assert.deepEqual(applySchemaPatches(corrected, [geminiAuthAlternatives]), corrected, 'Reapplying the recipe is byte-stable.');
  const local = structuredClone(corrected); local.info.title = 'My Gemini';
  const published = structuredClone(source); published.info.version = 'next'; published.paths['/v1beta/new'] = { get: {} };
  const merged = mergeSchemaDocuments(corrected, local, applySchemaPatches(published, [geminiAuthAlternatives]));
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.document.info.title, local.info.title);
  assert.equal(merged.document.info.version, 'next');
  for (const definition of [{ type: 'apiKey', in: 'header', name: 'x-goog-api-key' }, { type: 'http', scheme: 'bearer' }]) {
    const fixed = structuredClone(source); fixed.components.securitySchemes.googleGenAIAuth = definition;
    assert.deepEqual(applySchemaPatches(fixed, [geminiAuthAlternatives]), fixed, 'An upstream standard authentication fix is retained.');
  }
  assert.deepEqual(applySchemaPatches({ info: { title: 'Unrelated document' } }, [geminiAuthAlternatives]),
    { info: { title: 'Unrelated document' } }, 'A document without a Gemini declaration is not changed.');
  assert.deepEqual(applySchemaPatches({ paths: { '/missing': null, '/metadata': { summary: 'metadata', get: null } } }, [geminiAuthAlternatives]),
    { paths: { '/missing': null, '/metadata': { summary: 'metadata', get: null } } });
});

Then('Gemini credential applicability {string} stays explicit without executing custom schemes', kind => {
  const source = geminiFixture(); source.paths = { '/v1beta/agents': { get: {} } };
  const properties = source.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.properties;
  if (kind === 'key only') delete properties.accessToken;
  if (kind === 'bearer only') delete properties.apiKey;
  if (kind === 'headers only') {
    delete properties.apiKey; delete properties.accessToken;
    assert.throws(() => applySchemaPatches(source, [geminiAuthAlternatives]), /documented API key or access token/);
    return;
  }
  if (kind === 'unrelated custom scheme') {
    source.components.securitySchemes.OtherSDK = source.components.securitySchemes.googleGenAIAuth;
    delete source.components.securitySchemes.googleGenAIAuth;
    source.security = [{ OtherSDK: [] }];
    assert.deepEqual(applySchemaPatches(source, [geminiAuthAlternatives]), source);
  }
  const document = kind === 'unreviewed SDK extension' ? source : applySchemaPatches(source, [geminiAuthAlternatives]);
  const operation = inspectServiceSchema(document, 'gemini').operations[0];
  if (['unrelated custom scheme', 'unreviewed SDK extension'].includes(kind)) {
    assert.match(operation.unavailableReason, /only HTTP bearer and Basic authentication are supported/);
    return;
  }
  const names = operation.security.map(alternative => alternative.map(scheme => scheme.name));
  assert.deepEqual(names, kind === 'key only' ? [['GeminiApiKey']] : [['GeminiAccessToken']]);
  assert.equal(operation.unavailableReason, undefined);
});

Then('Gemini correction rejects the changed contract {string}', kind => {
  const changes = {
    'unknown server': doc => { doc.servers[0].url = 'https://example.test'; },
    'extra server': doc => { doc.servers.push({ url: 'https://example.test' }); },
    'missing server': doc => { delete doc.servers; },
    'unsupported version': doc => { doc.openapi = '2.0'; },
    'missing definition': doc => { delete doc.components.securitySchemes.googleGenAIAuth; },
    'different custom scheme': doc => { doc.components.securitySchemes.googleGenAIAuth.scheme = 'basic'; },
    'missing SDK contract': doc => { delete doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme']; },
    'executable SDK extension': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].code = 'throw new Error("must never execute")'; },
    'wrong SDK shape': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.type = 'string'; },
    'required credential': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.required = ['apiKey']; },
    'composed credentials': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.oneOf = [{ required: ['apiKey'] }]; },
    'unknown credential': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.properties.clientSecret = { type: 'string' }; },
    'malformed API key': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.properties.apiKey = { type: 'number' }; },
    'constrained token': doc => { doc.components.securitySchemes.googleGenAIAuth['x-speakeasy-custom-security-scheme'].schema.properties.accessToken.enum = ['only-token']; },
    'nonempty requirement': doc => { doc.security[0].googleGenAIAuth = ['unknown-scope']; },
    'invalid requirement': doc => { doc.security[0].googleGenAIAuth = null; },
    'scheme collision': doc => { doc.components.securitySchemes.GeminiApiKey = { type: 'http', scheme: 'bearer' }; },
    'credential collision': doc => { doc.security[0].GeminiApiKey = []; },
    'provenance collision': doc => { doc['x-upstream-security'] = []; },
    'permission collision': doc => { doc.paths['/v1beta/agents'].get['x-credential-permissions'] = []; },
  };
  assert.ok(changes[kind], `Unknown contract case: ${kind}`);
  const document = geminiFixture(); changes[kind](document);
  const before = structuredClone(document);
  assert.throws(() => applySchemaPatches(document, [geminiAuthAlternatives]), /Gemini authentication adaptation/);
  assert.deepEqual(document, before, 'A rejected correction cannot partially mutate the published source.');
});

Then('DigitalOcean corrections retain permissions provenance and authentication alternatives', () => {
  const source = digitalOceanFixture(), before = structuredClone(source);
  const corrected = applySchemaPatches(source, [digitalOceanBearerPermissions]);
  assert.deepEqual(source, before);
  assert.equal(schemaPatchName(digitalOceanBearerPermissions), 'DigitalOcean bearer permissions');
  assert.deepEqual(corrected.security, [{ bearer_auth: [] }]);
  assert.deepEqual(corrected['x-upstream-security'], before.security);
  assert.deepEqual(corrected['x-credential-permissions'], [{ bearer_auth: ['account:read'] }]);
  const operation = corrected.paths['/v2/items'].get;
  assert.deepEqual(operation.security, [{ bearer_auth: [], Project: [] }, {}, { inference_bearer_auth: [] }, { bearer_auth: [] }]);
  assert.deepEqual(operation['x-credential-permissions'], [{ bearer_auth: ['droplet:read'] }, {}, {}, {}]);
  assert.deepEqual(operation['x-upstream-security'], before.paths['/v2/items'].get.security);
  for (const method of ['post', 'head', 'options', 'delete'])
    assert.deepEqual(corrected.paths['/v2/items'][method], before.paths['/v2/items'][method]);
  assert.deepEqual(applySchemaPatches(corrected, [digitalOceanBearerPermissions]), corrected);
  const models = inspectServiceSchema(corrected, 'digitalocean').operations;
  assert.ok(models.every(model => !model.unavailableReason));
  assert.deepEqual(models.find(model => model.method === 'POST').credentialPermissions, [{ bearer_auth: ['account:read'] }]);
  assert.deepEqual(models.find(model => model.method === 'GET').credentialPermissions, operation['x-credential-permissions']);
  for (const method of ['HEAD', 'OPTIONS', 'DELETE'])
    assert.equal(models.find(model => model.method === method).credentialPermissions, undefined, 'Explicit overrides do not inherit root permissions.');
  const incoming = structuredClone(source); incoming.info.version = '3'; incoming.paths['/v2/new'] = { get: {} };
  const local = structuredClone(corrected); local.info.title = 'My DO account';
  const update = mergeSchemaDocuments(corrected, local, applySchemaPatches(incoming, [digitalOceanBearerPermissions]));
  assert.deepEqual(update.conflicts, []);
  assert.equal(update.document.info.title, local.info.title);
  assert.equal(update.document.info.version, '3');
  assert.deepEqual(update.document['x-credential-permissions'], corrected['x-credential-permissions']);
  const fixed = structuredClone(source); fixed.security = [{ bearer_auth: [] }]; fixed.paths = {};
  assert.deepEqual(applySchemaPatches(fixed, [digitalOceanBearerPermissions]), fixed, 'An upstream empty-array fix is not patched again.');
  assert.deepEqual(applySchemaPatches({ paths: { '/bad': null, '/metadata': { summary: 'metadata', get: null } } }, [digitalOceanBearerPermissions]),
    { paths: { '/bad': null, '/metadata': { summary: 'metadata', get: null } } });
});

Then('DigitalOcean corrections reject changed provider contracts and metadata collisions', () => {
  for (const corrupt of [
    doc => { doc.security[0].bearer_auth = null; },
    doc => { doc.security[0].bearer_auth = [42]; },
    doc => { doc.security[0].bearer_auth = ['']; },
    doc => { doc.security[0].bearer_auth = ['future-format']; },
    doc => { delete doc.components.securitySchemes.bearer_auth; },
    doc => { doc.components.securitySchemes.bearer_auth = { type: 'apiKey', in: 'header', name: 'Authorization' }; },
    doc => { doc.components.securitySchemes.bearer_auth.scheme = 'basic'; },
    doc => { doc.servers = [{ url: 'https://example.com' }]; },
    doc => { delete doc.servers; },
    doc => { doc.openapi = '2.0'; },
    doc => { doc['x-upstream-security'] = []; },
    doc => { doc['x-credential-permissions'] = []; },
  ]) {
    const doc = digitalOceanFixture(); corrupt(doc);
    assert.throws(() => applySchemaPatches(doc, [digitalOceanBearerPermissions]), /DigitalOcean bearer adaptation/);
  }
  assert.throws(() => applySchemaPatches({}, [digitalOceanBearerPermissions, digitalOceanBearerPermissions]), /duplicated/);
  assert.throws(() => applySchemaPatches({}, [{ ...digitalOceanBearerPermissions, version: 2 }]), /unknown/);
  const unrelated = digitalOceanFixture(); unrelated.paths['/v2/items'].delete.security = [{ Project: ['project:read'] }];
  const corrected = applySchemaPatches(unrelated, [digitalOceanBearerPermissions]);
  assert.deepEqual(corrected.paths['/v2/items'].delete, unrelated.paths['/v2/items'].delete);
  assert.match(inspectServiceSchema(corrected, 'digitalocean').operations.find(model => model.method === 'DELETE').unavailableReason, /only empty scope arrays/);
});

Then('schema line diffs preserve additions removals context and JSON pointer values', () => {
  const before = '[\n  {\n    "Oauth2": ["scope"],\n    "Oauth2c": ["scope"]\n  }\n]';
  const after = '[\n  {\n    "Oauth2": ["scope"]\n  },\n  {\n    "Oauth2c": ["scope"]\n  }\n]';
  const diff = schemaLineDiff(before, after);
  assert.equal(diff.truncated, false);
  assert.equal(diff.coarse, false);
  assert.equal(diff.rows.flatMap(row => row.before ? [row.before.text] : []).join('\n'), before);
  assert.equal(diff.rows.flatMap(row => row.after ? [row.after.text] : []).join('\n'), after);
  for (const side of ['before', 'after']) {
    const lines = diff.rows.flatMap(row => row[side] ? [row[side]] : []);
    assert.deepEqual(lines.map(line => line.number), lines.map((_, index) => index + 1));
  }
  assert.ok(diff.rows.some(row => row.before?.kind === 'removed'));
  assert.ok(diff.rows.some(row => row.after?.kind === 'added'));
  assert.ok(diff.rows.some(row => row.before?.kind === 'context' && row.after?.kind === 'context'));
  const addition = schemaLineDiff(undefined, 'null');
  assert.equal(addition.before, false);
  assert.equal(addition.after, true);
  assert.deepEqual(addition.rows, [{ after: { number: 1, kind: 'added', text: 'null' } }]);
  assert.deepEqual(schemaLineDiff('null', undefined).rows, [{ before: { number: 1, kind: 'removed', text: 'null' } }]);
  assert.deepEqual(schemaLineDiff('same', 'same').rows, []);
  // Repeated lines must not disappear or be paired out of order.
  for (const [left, right] of [['a\na\nb\na', 'a\nb\na\na'], ['one\ntwo\n', 'zero\none\n'], ['', 'x'], ['<script>&', '<b>']]) {
    const rows = schemaLineDiff(left, right).rows;
    assert.equal(rows.flatMap(row => row.before ? [row.before.text] : []).join('\n'), left);
    assert.equal(rows.flatMap(row => row.after ? [row.after.text] : []).join('\n'), right);
  }
  const document = JSON.parse('{"a/b~c":{"":null},"__proto__":{"safe":1}}');
  assert.equal(schemaPointerValue(document, '/a~1b~0c/'), null);
  assert.equal(schemaPointerValue(document, '/a~1b~0c/missing'), undefined);
  assert.equal(schemaPointerValue(document, '/__proto__/safe'), 1);
  assert.equal(schemaPointerValue(document, '/constructor'), undefined);
  assert.throws(() => schemaPointerValue(document, '/bad~2escape'), /valid/);
});

Then('schema line diffs fold context and expose bounded output without inventing source values', () => {
  const lines = Array.from({ length: 100 }, (_, index) => `unchanged ${index}`);
  const edited = [...lines]; edited[5] = 'first change'; edited[90] = 'last change';
  const diff = schemaLineDiff(lines.join('\n'), edited.join('\n'));
  assert.equal(diff.truncated, false);
  assert.ok(diff.rows.some(row => row.omitted > 0));
  assert.ok(diff.rows.some(row => row.after?.number === 6 && row.after.text === 'first change'));
  assert.ok(diff.rows.some(row => row.after?.number === 91 && row.after.text === 'last change'));
  assert.ok(diff.rows.length < 25);
  const added = schemaLineDiff(undefined, lines.join('\n'), 2);
  assert.equal(added.rows.length, 2); assert.equal(added.truncated, true);
  assert.equal(schemaLineDiff(undefined, lines.join('\n'), 100).truncated, false);
  const large = schemaLineDiff('a'.repeat(600_000), 'b'.repeat(600_000));
  assert.equal(large.truncated, true);
  assert.ok(large.rows.flatMap(row => [row.before?.text ?? '', row.after?.text ?? '']).join('').length <= 512 * 1024);
  const unicode = schemaLineDiff(undefined, '😀'.repeat(180_000));
  assert.equal(unicode.textTruncated, true);
  assert.ok(new TextEncoder().encode(unicode.rows[0].after.text).byteLength <= 512 * 1024);
  assert.equal(unicode.rows[0].after.text.slice(-2), '😀');
  const coarse = schemaLineDiff(Array.from({ length: 1200 }, (_, index) => `old ${index}`).join('\n'),
    Array.from({ length: 1200 }, (_, index) => `new ${index}`).join('\n'), 1500);
  assert.equal(coarse.coarse, true); assert.equal(coarse.truncated, false);
  assert.equal(coarse.rows.length, 1200);
  assert.equal(coarse.rows[1199].before.text, 'old 1199');
  assert.equal(coarse.rows[1199].after.text, 'new 1199');
  assert.throws(() => schemaLineDiff('a', 'b', 5001), /1–5000/);
});
