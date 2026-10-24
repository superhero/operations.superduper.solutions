// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { adaptFredSchema } from '../build/fred-schema.mjs';

Then('anonymous service operations reject permission metadata without a security declaration', () => {
  const document = { openapi: '3.1.0', info: { title: 'Anonymous', version: '1' }, servers: [{ url: 'https://example.com' }],
    paths: { '/items': { get: { operationId: 'read', responses: { '200': { description: 'OK' } } } } } };
  assert.equal(inspectServiceSchema(document, 'anonymous').operations[0].unavailableReason, undefined);
  document['x-credential-permissions'] = [{ Bearer: ['read'] }];
  const operation = inspectServiceSchema(document, 'anonymous').operations[0];
  assert.match(operation.unavailableReason, /Credential permissions must match/);
  assert.equal(operation.credentialPermissions, undefined);
});

Then('Google product catalogs retain these collections and prepare scoped Gmail and Drive requests', async table => {
  const expected = ['google-gmail', 'google-drive', 'google-calendar', 'google-sheets', 'google-docs', 'google-slides',
    'google-forms', 'google-tasks', 'google-people', 'google-chat', 'google-apps-script', 'google-keep', 'google-classroom',
    'google-vault', 'google-admin-directory', 'google-admin-reports', 'google-admin-data-transfer', 'google-drive-activity',
    'google-drive-labels', 'google-youtube', 'google-youtube-analytics', 'google-analytics-admin', 'google-analytics-data',
    'google-search-console'];
  const collection = serviceSchemaDescriptors.filter(source => source.provider === 'google');
  assert.deepEqual(collection.map(source => source.id).sort(), expected.sort());
  for (const { prefix, count } of table.hashes())
    assert.equal(collection.filter(source => source.name === prefix || source.name.startsWith(`${prefix} / `)).length, Number(count), prefix);
  const catalogs = new Map();
  let supported = 0;
  for (const source of collection) {
    assert.equal(source.sourceKind, 'community-adapted');
    assert.equal(source.profile, 'google-oauth');
    assert.ok(source.provenance.startsWith('https://'));
    const document = await readServiceSchema(source.id);
    const catalog = inspectServiceSchema(document, source.id);
    catalogs.set(source.id, { document, catalog });
    assert.equal(catalog.operations.length, source.operations, source.id);
    assert.equal(new Set(catalog.operations.map(operation => operation.id)).size, source.operations, source.id);
    assert.ok(catalog.operations.some(operation => !operation.unavailableReason), source.id);
    for (const operation of catalog.operations) {
      const raw = document.paths[operation.path][operation.method.toLowerCase()];
      if (raw['x-upstream-security']) {
        assert.deepEqual(raw.security, raw['x-upstream-security'].flatMap(({ Oauth2, Oauth2c, ...required }) => [
          { ...required, Oauth2 }, { ...required, Oauth2c },
        ]), `${operation.id}: both published grants remain separate alternatives with their original scopes.`);
      }
      if (operation.unavailableReason) {
        assert.match(operation.unavailableReason, /unsupported binary or streaming media type/, operation.id);
        continue;
      }
      supported++;
      const declaration = raw.security ?? document.security;
      if (declaration?.length && declaration.every(alternative => Object.keys(alternative).length)) {
        assert.ok(operation.security?.every(alternative => alternative.length === 1), operation.id);
        assert.deepEqual(operation.oauthScopes, declaration, `${operation.id}: every scope alternative stays in the approval.`);
        assert.ok(operation.security.flat().every(scheme => ['Oauth2', 'Oauth2c'].includes(scheme.name) && scheme.kind === 'bearer'
          && scheme.header === 'Authorization'), operation.id);
      }
    }
  }
  assert.equal(collection.reduce((count, source) => count + source.operations, 0), 655);
  assert.equal(supported, 640, 'Unsupported binary uploads stay visible instead of losing their request bodies.');
  for (const [id, operationId, values, expectedUrl, response] of [
    ['google-gmail', 'gmail.users.getProfile', { 'path:userId': 'me' }, 'https://gmail.googleapis.com/gmail/v1/users/me/profile', { emailAddress: 'test@example.com' }],
    ['google-drive', 'drive.about.get', { 'query:fields': 'user,storageQuota' }, 'https://www.googleapis.com/drive/v3/about?fields=user%2CstorageQuota', { storageQuota: { usage: '123' } }],
  ]) {
    const { document, catalog } = catalogs.get(id);
    const operation = catalog.operations.find(operation => operation.id === `${id}:${operationId}`);
    assert.equal(operation.unavailableReason, undefined);
    const descriptor = await approvedOperation(operation, operationServerUrl(document, operation));
    for (const scheme of ['Oauth2', 'Oauth2c']) {
      const alternative = operation.oauthScopes.findIndex(option => option[scheme]?.some(scope => scope.endsWith('.readonly')));
      assert.ok(alternative >= 0, `${id}: ${scheme} retains a read-only scope option.`);
      const token = 'synthetic-google-access-token';
      let requests = 0;
      const options = { assertCurrent() {}, fetchRequest: async (url, request) => {
        requests++;
        assert.equal(String(url), expectedUrl);
        assert.equal(request.headers.get('Authorization'), `Bearer ${token}`);
        assert.ok(!String(url).includes(token));
        return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
      } };
      const binding = { fingerprint: descriptor.fingerprint, alternative, credentials: { [scheme]: 'google-token' } };
      await assert.rejects(executeCredentialed(descriptor, values, binding, [], options));
      assert.equal(requests, 0, 'Private Google operations cannot run without their bound token.');
      const result = await executeCredentialed(descriptor, values, binding,
        [{ id: 'google-token', label: 'Google access token', kind: 'secret', value: token }], options);
      assert.equal(requests, 1);
      assert.deepEqual(result.response.body, response);
      assert.ok(!JSON.stringify(result).includes(token));
      const changed = structuredClone(operation);
      changed.oauthScopes[alternative][scheme].push('https://www.googleapis.com/auth/additional');
      assert.notEqual((await approvedOperation(changed, operationServerUrl(document, operation))).fingerprint, descriptor.fingerprint);
    }
  }
});

Then('Cloudflare retains its account API and adds the published Realtime SFU contracts with their own credentials', async () => {
  const collection = serviceSchemaDescriptors.filter(source => source.provider === 'cloudflare');
  assert.deepEqual(collection.map(source => source.id), ['cloudflare', 'cloudflare-realtime-sfu']);
  assert.equal(collection[0].sha256, '5999fa69349d2e160e58bac0f9603f110c2937d67dbf6dac3a1bed9f3859c778',
    'Existing account API payloads and workflow identities remain unchanged.');
  const source = collection[1];
  assert.equal(source.name, 'Cloudflare / Realtime / SFU');
  assert.equal(source.provenance, 'https://developers.cloudflare.com/realtime/sfu/api/');
  const document = await readServiceSchema(source.id);
  const catalog = inspectServiceSchema(document, source.id);
  const expected = [
    'POST /apps/{appId}/sessions/new',
    'POST /apps/{appId}/adapters/websocket/new',
    'POST /apps/{appId}/adapters/websocket/close',
    'POST /apps/{appId}/sessions/{sessionId}/tracks/new',
    'PUT /apps/{appId}/sessions/{sessionId}/renegotiate',
    'PUT /apps/{appId}/sessions/{sessionId}/tracks/close',
    'PUT /apps/{appId}/sessions/{sessionId}/tracks/update',
    'POST /apps/{appId}/sessions/{sessionId}/datachannels/establish',
    'POST /apps/{appId}/sessions/{sessionId}/datachannels/new',
    'PUT /apps/{appId}/sessions/{sessionId}/datachannels/update',
    'PUT /apps/{appId}/sessions/{sessionId}/datachannels/close',
    'GET /apps/{appId}/sessions/{sessionId}',
  ];
  assert.equal(source.operations, expected.length);
  assert.deepEqual(catalog.operations.map(operation => `${operation.method} ${operation.path}`).sort(), expected.sort());
  for (const operation of catalog.operations) {
    assert.equal(operation.id, `${source.id}:${operation.method} ${operation.path}`);
    assert.equal(operation.unavailableReason, undefined, operation.id);
    assert.equal(operationServerUrl(document, operation), 'https://rtc.live.cloudflare.com/v1');
    assert.deepEqual(operation.security, [[{ name: 'secret', kind: 'bearer', header: 'Authorization' }]]);
  }
  const session = catalog.operations.find(operation => operation.method === 'GET');
  const descriptor = await approvedOperation(session, operationServerUrl(document, session));
  const values = { 'path:appId': 'sample-app', 'path:sessionId': 'sample-session' };
  const credentials = [{ id: 'app-secret', label: 'SFU App Secret', kind: 'secret', value: 'synthetic-sfu-app-secret' }];
  let requests = 0;
  const result = await executeCredentialed(descriptor, values,
    { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { secret: 'app-secret' } }, credentials, {
      assertCurrent() {}, fetchRequest: async (url, options) => {
        requests++;
        assert.equal(String(url), 'https://rtc.live.cloudflare.com/v1/apps/sample-app/sessions/sample-session');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.get('Authorization'), 'Bearer synthetic-sfu-app-secret');
        return new Response('{"tracks":[],"dataChannels":[]}', { headers: { 'Content-Type': 'application/json' } });
      },
    });
  assert.equal(requests, 1);
  assert.deepEqual(result.response.body, { tracks: [], dataChannels: [] });
  assert.ok(!JSON.stringify(result).includes(credentials[0].value));
});

Then('{string} has {int} cloud schemas under {string} including {string}', async (provider, count, prefix, services) => {
  const collection = serviceSchemaDescriptors.filter(source => source.provider === provider);
  assert.equal(collection.length, count);
  for (const id of services.split(',')) assert.ok(collection.some(source => source.id === id), `${provider} includes ${id}`);
  for (const source of collection) {
    assert.ok(source.name.startsWith(`${prefix} / `), source.id);
    assert.ok(source.operations > 0, source.id);
    assert.ok(source.provenance.startsWith('https://'), source.id);
    if (provider !== 'azure') assert.equal(source.sourceKind, 'community-conversion', 'Converted contracts must retain their provenance.');
    else assert.ok(source.url.startsWith('https://raw.githubusercontent.com/Azure/azure-rest-api-specs/'));
  }
  const established = {
    'aws-lambda': 'da4be377c6195d8d2a9d6ef71d18ce4b93f21021ec7924e407753535f60ae2a1',
    'aws-s3': '2c1283af457c374eea21b36eda33edbebd1d331b8954dff16c332d22881d212d',
    'gcp-compute': '33803659d1a38271f3b910f3358fe6b248980f11e397b543e51b1ac120ea1cd8',
    'gcp-storage': '89fce203814a45b34a3f61504d99453530579866c55554b400e0d52dc8d42d8e',
    'azure-resources': '3229eb7c17e2b7737c4cfafe7671d3729a1f0bb71062f9411473224425637534',
  };
  for (const source of collection.filter(source => Object.hasOwn(established, source.id)))
    assert.equal(source.sha256, established[source.id], `${source.id}: existing workflow contracts stay unchanged.`);
  const id = { aws: 'aws-ec2', gcp: 'gcp-pubsub', azure: 'azure-keyvault' }[provider];
  const document = await readServiceSchema(id);
  const catalog = inspectServiceSchema(document, id);
  assert.ok(document.components.securitySchemes, `${id}: retain the published authentication.`);
  assert.equal(catalog.operations.length, collection.find(source => source.id === id).operations);
  assert.ok(catalog.operations.every(operation => operation.unavailableReason || operation.security?.some(option => option.length)),
    'Adding service descriptions must not turn authenticated requests into anonymous requests.');
  if (provider === 'aws') assert.ok(catalog.operations.every(operation => operation.unavailableReason), 'AWS signing remains explicitly unsupported.');
});

Then('the Atlassian collection includes its published product APIs without changing established catalog identities', async () => {
  const expected = ['bitbucket', 'jira', 'confluence', 'trello', 'statuspage', 'opsgenie', 'bamboo', 'bitbucket-dc', 'confluence-dc', 'crowd-dc',
    'jira-dc', 'jira-software', 'jira-service-management', 'jira-service-management-dc', 'jira-service-management-ops',
    'atlassian-admin-api-access', 'atlassian-admin-control', 'atlassian-admin-dlp', 'atlassian-admin-organizations',
    'atlassian-admin-users', 'atlassian-admin-provisioning', 'atlassian-app-migration', 'atlassian-assets', 'atlassian-automation',
    'atlassian-backup-management', 'atlassian-capacity-planning', 'atlassian-commerce', 'atlassian-commerce-it', 'atlassian-compass',
    'atlassian-confluence-v1', 'atlassian-customer-service-management', 'atlassian-focus', 'atlassian-forge-storage', 'atlassian-forge-containers',
    'atlassian-forms', 'atlassian-incidents', 'atlassian-marketplace', 'atlassian-marketplace-product-tags', 'atlassian-migration-api',
    'atlassian-migration-utilities', 'atlassian-privacy-consent', 'atlassian-security-vulnerabilities', 'atlassian-teams'];
  const sources = serviceSchemaDescriptors.filter(source => source.provider === 'atlassian');
  assert.deepEqual(sources.map(source => source.id).sort(), expected.sort());
  for (const source of sources) {
    assert.ok(source.name.startsWith('Atlassian / '), source.id);
    assert.ok(source.provenance.startsWith('https://'), source.id);
    const document = await readServiceSchema(source.id);
    const catalog = inspectServiceSchema(document, source.id);
    assert.equal(catalog.operations.length, source.operations, source.id);
    assert.equal(new Set(catalog.operations.map(operation => operation.id)).size, source.operations, source.id);
    if (!['bitbucket', 'jira', 'confluence'].includes(source.id)) {
      for (const operation of catalog.operations) assert.equal(operation.id, `${source.id}:${operation.method} ${operation.path}`);
    } else {
      for (const [path, item] of Object.entries(document.paths)) for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (typeof item[method]?.operationId === 'string')
          assert.ok(catalog.operations.some(operation => operation.id === `${source.id}:${item[method].operationId}` && operation.path === path));
      }
    }
    if (source.id === 'atlassian-automation') {
      for (const path of ['/rest/v1/rule/manual/search', '/rest/latest/rule/manual/search']) {
        assert.equal(document.paths[path].get['x-upstream-operation-id'], 'searchManualRulesWithGet');
        assert.ok(catalog.operations.some(operation => operation.id === `${source.id}:GET ${path}`));
      }
      assert.equal(source.operations, 30, 'Versioned and latest paths remain independently addressable.');
    }
    if (source.id === 'trello') {
      assert.equal(document.components.securitySchemes.APIKey.in, 'query');
      assert.equal(document.components.securitySchemes.APIToken.in, 'query');
      assert.deepEqual(document.security, [{ APIKey: [], APIToken: [] }]);
      assert.ok(catalog.operations.some(operation => operation.security?.some(alternative =>
        alternative.some(scheme => scheme.query === 'key') && alternative.some(scheme => scheme.query === 'token'))));
    }
    if (source.id === 'atlassian-compass') {
      assert.equal(document.components.securitySchemes.basicAuth.scheme, 'basic');
      assert.ok(catalog.operations.some(operation => !operation.unavailableReason && operation.security?.flat().some(scheme => scheme.kind === 'basic')),
        'Supported Basic authentication remains explicit rather than becoming anonymous.');
    }
    if (source.id === 'statuspage') {
      assert.equal(document.info.title, 'Statuspage API');
      assert.equal(source.operations, 112);
    }
  }
});

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
    assert.equal(catalog.name, `Federal Reserve / ${id.toUpperCase()}`);
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

Then('Telegram templates remain non-secret and only reviewed private connections can execute them', async () => {
  const document = await readServiceSchema('telegram');
  const before = structuredClone(document);
  const inspected = inspectServiceSchema(document, 'telegram');
  assert.equal(inspected.operations.length, serviceSchemaDescriptors.find(source => source.id === 'telegram').operations);
  const getMe = inspected.operations.find(operation => operation.path === '/getMe');
  assert.equal(getMe.privatePath, 'telegram-bot'); assert.equal(getMe.unavailableReason, undefined);
  assert.equal(operationServerUrl(document, getMe), 'https://api.telegram.org');
  assert.deepEqual(document, before);
  document.servers[0].variables.botToken.default = '123456:sample-token';
  const configured = inspectServiceSchema(document, 'telegram');
  assert.match(configured.operations.find(operation => operation.path === '/getMe').unavailableReason, /reviewed Telegram HTTPS template/);
  const original = await readServiceSchemaUpstream('telegram');
  assert.match(inspectServiceSchema(original, 'telegram').operations[0].unavailableReason, /placeholder/);
  original.servers[0].variables.botToken.default = '123456:sample-token';
  assert.match(inspectServiceSchema(original, 'telegram').operations[0].unavailableReason, /private bot token connection/);
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
  assert.equal(count, 27225);
  assert.equal(serviceSchemaDescriptors.filter(source => source.protocol !== 'json-rpc')
    .reduce((total, source) => total + source.operations, 0), 27120, 'Existing HTTP inventory remains unchanged.');
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
  unsupported.components = { securitySchemes: { login: { type: 'http', scheme: 'digest' } } };
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
