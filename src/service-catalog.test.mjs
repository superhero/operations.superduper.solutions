// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { adaptFredSchema } from '../build/fred-schema.mjs';

Then('FRED and ALFRED retain the economic API inventory and prepare authenticated historical and bulk requests', async () => {
  const expected = ['category', 'category/children', 'category/related', 'category/series', 'category/tags', 'category/related_tags',
    'releases', 'releases/dates', 'release', 'release/dates', 'release/series', 'release/sources', 'release/tags', 'release/related_tags', 'release/tables',
    'series', 'series/categories', 'series/observations', 'series/release', 'series/search', 'series/search/tags', 'series/search/related_tags',
    'series/tags', 'series/updates', 'series/vintagedates', 'sources', 'source', 'source/releases', 'tags', 'related_tags', 'tags/series']
    .map(path => `/fred/${path}`).sort();
  const documents = Object.fromEntries(await Promise.all(['fred', 'alfred'].map(async id => [id, await readServiceSchema(id)])));
  const requests = [];
  for (const [id, document] of Object.entries(documents)) {
    assert.deepEqual(Object.keys(document.paths).filter(path => path.startsWith('/fred/') && !path.includes('/v2/')).sort(), expected);
    const catalog = inspectServiceSchema(document, id);
    assert.equal(catalog.operations.length, id === 'fred' ? 36 : 31);
    assert.ok(catalog.operations.filter(operation => operation.path.startsWith('/fred/')).every(operation => !operation.unavailableReason));
    assert.match(catalog.name, id === 'fred' ? /FRED \/ Federal Reserve Economic Data/ : /ALFRED \/ Archival Federal Reserve Economic Data/);
    const observations = catalog.operations.find(operation => operation.path === '/fred/series/observations');
    assert.equal(observations.id, `${id}:getSeriesObservations`, 'Existing FRED workflow identities stay stable.');
    assert.deepEqual(observations.security, [[{ name: 'ApiKeyAuth', kind: 'apiKey', query: 'api_key' }]]);
    assert.equal(observations.fields.some(field => field.name === 'api_key'), false, 'Keys belong to the vault binding, not public workflow inputs.');
    const defaults = Object.fromEntries(observations.fields.filter(field => field.defaultValue !== undefined).map(field => [field.key, field.defaultValue]));
    assert.equal(defaults['query:file_type'], 'json');
    const values = { ...defaults, 'query:series_id': 'GNPCA', 'query:realtime_start': '2010-01-01', 'query:realtime_end': '2010-01-01',
      'query:vintage_dates': '2009-01-01,2010-01-01', 'query:output_type': '2', 'query:limit': '2' };
    const descriptor = await approvedOperation(observations, operationServerUrl(document, observations));
    const secret = 'synthetic-fred-key-7392';
    const result = await executeCredentialed(descriptor, values,
      { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { ApiKeyAuth: 'fred-key' } },
      [{ id: 'fred-key', label: 'FRED', kind: 'secret', value: secret }], {
        assertCurrent() {}, fetchRequest: async (url, options) => {
          const parsed = new URL(url);
          requests.push(parsed);
          assert.equal(parsed.origin, 'https://api.stlouisfed.org');
          assert.equal(parsed.searchParams.get('api_key'), secret);
          assert.equal(options.headers.has('Authorization'), false);
          assert.equal(parsed.searchParams.get('file_type'), 'json');
          assert.equal(parsed.searchParams.get('realtime_start'), '2010-01-01');
          assert.equal(parsed.searchParams.get('vintage_dates'), '2009-01-01,2010-01-01');
          return new Response('{"observations":[{"date":"2000-01-01","value":"."}]}', { headers: { 'Content-Type': 'application/json' } });
        },
      });
    assert.deepEqual(result.response.body.observations, [{ date: '2000-01-01', value: '.' }]);
    assert.ok(!JSON.stringify(result).includes(secret));
    const response = document.paths['/fred/series/observations'].get.responses['200'].content['application/json'].schema;
    assert.equal(response.properties.observations.items.properties.value.type, 'string');
    assert.equal(document.paths['/fred/series/vintagedates'].get.responses['200'].content['application/json'].schema.properties.vintage_dates.type, 'array');
    const search = catalog.operations.find(operation => operation.path === '/fred/series/search');
    assert.equal(search.fields.find(field => field.name === 'search_text').required, true);
    const before = structuredClone(document);
    assert.deepEqual(adaptFredSchema(document, id), document, 'Profiles are deterministic and do not mutate their input.');
    assert.deepEqual(document, before);
  }
  assert.equal(requests.length, 2);
  assert.equal(Object.keys(documents.alfred.paths).some(path => path.startsWith('/geofred/') || path.includes('/v2/')), false);
  const bulk = inspectServiceSchema(documents.fred, 'fred').operations.find(operation => operation.path === '/fred/v2/release/observations');
  assert.deepEqual(bulk.security, [[{ name: 'FredV2ApiKey', kind: 'bearer', header: 'Authorization' }]]);
  const descriptor = await approvedOperation(bulk, operationServerUrl(documents.fred, bulk));
  const result = await executeCredentialed(descriptor,
    { 'query:release_id': '53', 'query:format': 'json', 'query:limit': '2', 'query:next_cursor': 'SERIES,2010-01-01' },
    { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { FredV2ApiKey: 'fred-key' } },
    [{ id: 'fred-key', label: 'FRED', kind: 'secret', value: 'synthetic-fred-key-7392' }], {
      assertCurrent() {}, fetchRequest: async (url, options) => {
        assert.equal(options.headers.get('Authorization'), 'Bearer synthetic-fred-key-7392');
        const parsed = new URL(url);
        assert.equal(parsed.pathname, '/fred/v2/release/observations');
        assert.equal(parsed.searchParams.has('api_key'), false);
        assert.equal(parsed.searchParams.get('next_cursor'), 'SERIES,2010-01-01');
        assert.equal(parsed.searchParams.get('format'), 'json');
        return new Response('{"has_more":false,"series":[]}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
  assert.equal(result.response.body.has_more, false);
});

Then('Telegram placeholder defaults remain visible in the source and cannot produce an executable endpoint', async () => {
  const document = await readServiceSchema('telegram');
  const before = structuredClone(document);
  const inspected = inspectServiceSchema(document, 'telegram');
  assert.equal(inspected.operations.length, serviceSchemaDescriptors.find(source => source.id === 'telegram').operations);
  assert.ok(inspected.operations.every(operation => /server variable botToken still contains a placeholder/.test(operation.unavailableReason)));
  assert.equal(inspected.serverUrl, '');
  assert.deepEqual(document, before);
  document.servers[0].variables.botToken.default = '123456:sample-token';
  const configured = inspectServiceSchema(document, 'telegram');
  const getMe = configured.operations.find(operation => operation.path === '/getMe');
  assert.equal(getMe.unavailableReason, undefined);
  assert.equal(operationServerUrl(document, getMe), 'https://api.telegram.org/bot123456:sample-token');
});

Then('the default service index retains every packaged operation and reports execution limits', { timeout: 60_000 }, async () => {
  let count = 0;
  let runnable = 0;
  for (const descriptor of serviceSchemaDescriptors) {
    const document = await readServiceSchema(descriptor.id);
    const catalog = inspectServiceSchema(document, descriptor.id);
    assert.equal(catalog.document, document);
    assert.equal(catalog.operations.length, descriptor.operations, descriptor.id);
    assert.equal(new Set(catalog.operations.map(operation => operation.id)).size, descriptor.operations, descriptor.id);
    assert.equal(catalog.groups[0].children.reduce((total, group) => total + group.operationIds.length, 0), descriptor.operations);
    count += catalog.operations.length;
    runnable += catalog.operations.filter(operation => !operation.unavailableReason).length;
    if (descriptor.id === 'ollama') assert.ok(catalog.operations.some(operation => operation.path === '/api/generate' && !operation.unavailableReason));
    if (descriptor.id === 'frankfurter') assert.ok(catalog.operations.some(operation => !operation.unavailableReason));
  }
  assert.equal(count, 13891);
  assert.ok(runnable > 0);
});
Then('service inputs preserve standard validation and explicitly use server validation for complex JSON', () => {
  const document = { openapi: '3.1.0', info: { title: 'Example service', version: '1' }, servers: [{ url: 'https://example.com' }],
    paths: { '/items/{id}': { post: { operationId: 'create', parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^item-[0-9]+$' } },
      { name: 'version', in: 'header', required: true, schema: { type: 'string', default: '1' } }
    ], requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [
      { type: 'object', required: ['foo'] }, { type: 'object', required: ['bar'] }
    ] } } } }, responses: { '200': { description: 'Created' } } } } } };
  const before = JSON.stringify(document);
  const operation = inspectServiceSchema(document, 'service-test').operations[0];
  assert.equal(operation.unavailableReason, undefined);
  assert.equal(operation.fields.find(field => field.name === 'version').defaultValue, '1');
  assert.equal(operation.fields.find(field => field.location === 'body').type, 'json');
  assert.match(operation.fields.find(field => field.location === 'body').description, /validated by the API/);
  const values = { 'path:id': 'item-2', 'header:version': '1', 'body:$': '{"foo":true}' };
  assert.deepEqual(prepareRequest(operation, values), { method: 'POST', path: '/items/item-2', query: {}, headers: { version: '1' }, body: { foo: true } });
  assert.throws(() => prepareRequest(operation, { ...values, 'path:id': 'bad' }), /pattern/);
  assert.throws(() => prepareRequest(operation, { ...values, 'body:$': '{' }), /valid JSON/);
  assert.equal(JSON.stringify(document), before);
  const unsupported = structuredClone(document);
  unsupported.paths['/items/{id}'].post.security = [{ login: [] }];
  unsupported.components = { securitySchemes: { login: { type: 'http', scheme: 'basic' } } };
  const unavailable = inspectServiceSchema(unsupported, 'service-test').operations[0];
  assert.match(unavailable.unavailableReason, /bearer/);
  assert.throws(() => prepareRequest(unavailable, values), /bearer/);
});

Then('service OAuth tokens use bearer credentials with scope-bound operation fingerprints', async () => {
  const { approvedOperation } = await import('./lib/secrets/policy.ts');
  const document = { openapi: '3.1.0', info: { title: 'OAuth service', version: '1' }, servers: [{ url: 'https://example.com' }],
    components: { securitySchemes: { login: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://example.com/token', scopes: { read: 'Read' } } } } } },
    security: [{ login: ['read'] }], paths: { '/items': { get: { operationId: 'items', responses: { '200': { description: 'OK' } } } } } };
  const original = JSON.stringify(document);
  const operation = inspectServiceSchema(document, 'oauth-test').operations[0];
  assert.equal(operation.unavailableReason, undefined);
  assert.deepEqual(operation.security, [[{ name: 'login', kind: 'bearer', header: 'Authorization' }]]);
  assert.deepEqual(operation.oauthScopes, [{ login: ['read'] }]);
  const first = await approvedOperation(operation, 'https://example.com');
  const changed = await approvedOperation({ ...operation, oauthScopes: [{ login: ['write'] }] }, 'https://example.com');
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.equal(JSON.stringify(document), original);
  document.security = [{ login: [42] }];
  assert.match(inspectServiceSchema(document, 'oauth-test').operations[0].unavailableReason, /OAuth scopes/);
  document.security = [null];
  assert.match(inspectServiceSchema(document, 'oauth-test').operations[0].unavailableReason, /Security requirements/);
});

Then('service contract guards reject invalid operations without dropping their source', () => {
  const base = () => ({ openapi: '3.1.0', info: { title: 'Guard fixture' }, servers: [{ url: 'https://example.com' }],
    paths: { '/items': { get: { responses: {} } } } });
  assert.throws(() => inspectServiceSchema({}, 'guard'), /must declare/);
  const empty = base(); empty.paths = { ignored: {} };
  assert.throws(() => inspectServiceSchema(empty, 'guard'), /no HTTP operations/);
  const duplicate = base(); duplicate.paths['/other'] = { get: { operationId: 'same' } };
  duplicate.paths['/items'].get.operationId = 'same';
  assert.throws(() => inspectServiceSchema(duplicate, 'guard'), /Duplicate/);
  for (const [patch, expected] of [
    [{ parameters: {} }, /must be an array/],
    [{ parameters: [{ in: 'cookie', name: 'token' }] }, /Cookie/],
    [{ requestBody: { content: { 'text/plain': { schema: { type: 'integer' } } } } }, /text body/],
    [{ parameters: [{ $ref: '#/missing/path' }] }, /Unresolved/],
    [{ parameters: [{ $ref: '#/info/title/missing' }] }, /Unresolved/]
  ]) {
    const doc = base(); Object.assign(doc.paths['/items'].get, patch);
    assert.match(inspectServiceSchema(doc, 'guard').operations[0].unavailableReason, expected);
  }
  for (const schema of [
    { type: 'string', enum: [{}] }, { type: 'string', const: {} },
    { $ref: '#/components/schemas/loop' }, { $ref: 'https://example.com/schema' }
  ]) {
    const doc = base(); doc.components = { schemas: { loop: { $ref: '#/components/schemas/loop' } } };
    doc.paths['/items'].get.parameters = [{ name: 'value', in: 'query', schema }];
    assert.equal(inspectServiceSchema(doc, 'guard').operations[0].fields[0].type, 'json');
  }
});

Then('service reference defaults and form guards preserve their declared behavior', () => {
  const base = () => ({ openapi: '3.1.0', info: { title: 'References' }, servers: [{ url: 'https://example.com' }],
    paths: { '/items': { post: { responses: {} } } } });
  const parameter = schema => ({ name: 'value', in: 'query', required: true, schema });
  for (const [schema, expected] of [
    [{ const: 'fixed' }, 'string'],
    [{ items: { type: 'string' } }, 'array'],
    [{ oneOf: [{ type: 'object' }, { type: 'string' }], default: 'draft' }, 'json']
  ]) {
    const doc = base(); doc.paths['/items'].post.parameters = [parameter(schema)];
    const input = inspectServiceSchema(doc, 'guard').operations[0].fields[0];
    assert.equal(input.type, expected);
    if (expected === 'json') assert.equal(input.defaultValue, '"draft"');
  }
  const refs = base();
  refs.paths['/items'].post.parameters = [parameter({ type: 'string' }), { $ref: '#/paths/~1items/post/parameters/0' }];
  assert.equal(inspectServiceSchema(refs, 'guard').operations[0].fields.length, 1);
  const form = base();
  form.paths['/items'].post.requestBody = { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } };
  assert.equal(inspectServiceSchema(form, 'guard').operations[0].unavailableReason, undefined);
  const required = base();
  required.paths['/items'].post.requestBody = { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } };
  assert.equal(inspectServiceSchema(required, 'guard').operations[0].fields[0].required, false);
  const thrown = base();
  Object.defineProperty(thrown.paths['/items'].post, 'parameters', { get() { throw 'non-Error failure'; } });
  assert.equal(inspectServiceSchema(thrown, 'guard').operations[0].unavailableReason, 'non-Error failure');
});

Then('service request preparation rejects unsupported structured parameter values', () => {
  const operation = { id: 'guard:request', name: 'Request', group: 'Guard', description: '', method: 'GET', path: '/{value}', fields: [], bodyRequired: false };
  for (const [location, type, raw, message] of [
    ['path', 'json', '{}', /path values must be primitive/],
    ['header', 'json', '[]', /header values must be primitive/],
    ['query', 'json', '{}', /structured query serialization/],
    ['query', 'json', '[{}]', /structured query serialization/]
  ]) {
    const input = { key: `${location}:value`, name: 'value', label: 'Value', location, type, required: true };
    assert.throws(() => prepareRequest({ ...operation, fields: [input] }, { [input.key]: raw }), message);
  }
  const input = { key: 'query:value', name: 'value', label: 'Value', location: 'query', type: 'json', required: true };
  assert.deepEqual(prepareRequest({ ...operation, fields: [input] }, { [input.key]: '[1,2]' }).query, { value: [1,2] });
  assert.deepEqual(prepareRequest({ ...operation, fields: [input] }, { [input.key]: 'null' }).query, { value: null });
});
