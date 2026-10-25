// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { signOAuth1 } from './lib/secrets/oauth1.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultError } from './lib/secrets/types.ts';
import { validateCredentialBinding, credentialReferenceIds, oauth1CredentialParts } from './lib/secrets/bindings.ts';
import { createHttpConnection, httpConnectionReference, invalidateHttpConnections, resolveHttpConnection } from './lib/secrets/http-connections.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, xOauth1Signing, xOauth1SourceSha256 } from './lib/schema-patches.ts';
import { createWorkflowExecution } from './lib/workflow-execution.ts';
import { portableWorkflowDocument } from './lib/workflow-document.ts';

const endpoint = 'https://api.x.com';
const clock = { nonce: () => 'synthetic_nonce_5729', timestamp: () => 1700000000 };
const values = { consumerKey: 'X_CONSUMER_KEY_5729', consumerSecret: 'X_CONSUMER_SECRET_5729', accessToken: 'X_ACCESS_TOKEN_5729', tokenSecret: 'X_TOKEN_SECRET_5729' };
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%'+c.charCodeAt(0).toString(16).toUpperCase());
const oauth = header => Object.fromEntries(header.slice(6).split(', ').map(part => {
  const [key, value] = part.split('='); return [key, decodeURIComponent(value.slice(1, -1))];
}));
const signature = result => oauth(result.authorization).oauth_signature;
const response = { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } } };
function document() {
  const security = [{ Bearer: [] }, { OAuth2: [] }, { UserToken: [] }];
  const parameters = [{ in: 'query', name: 'search', schema: { type: 'string' } }];
  const operation = media => ({ operationId: media === 'application/json' ? 'postJson' : 'postForm', security,
    parameters, responses: response, requestBody: { required: true, content: { [media]: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } } } });
  return { openapi: '3.0.0', info: { title: 'X signing fixture', version: '1' }, servers: [{ url: endpoint }],
    components: { securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' }, OAuth2: { type: 'http', scheme: 'bearer' },
      UserToken: { type: 'http', scheme: 'OAuth', 'x-operations-oauth1': 'x-hmac-sha1' } } },
    paths: { '/2/read': { get: { operationId: 'read', security, parameters, responses: response } },
      '/2/json': { post: operation('application/json') }, '/2/form': { post: operation('application/x-www-form-urlencoded') } } };
}
async function setup(operation = extractOperations(document(), 'x-fixture')[0]) {
  const descriptor = await approvedOperation(operation, endpoint);
  const records = oauth1CredentialParts.map(part => ({ id: crypto.randomUUID(), label: part, kind: 'secret', value: values[part], grants: [] }));
  const reference = Object.fromEntries(oauth1CredentialParts.map((part, index) => [part, records[index].id]));
  return { descriptor, records, reference, binding: { alternative: 2, credentials: { UserToken: reference }, fingerprint: descriptor.fingerprint } };
}
const permission = error => error instanceof VaultError && error.code === 'PERMISSION';
const options = fetchRequest => ({ assertCurrent() {}, oauth1Clock: clock, fetchRequest });
const safe = result => { for (const value of Object.values(values)) assert.ok(!JSON.stringify(result).includes(value)); };
const expectedSignature = (method, url, normalized, v = values) => createHmac('sha1', encode(v.consumerSecret)+'&'+encode(v.tokenSecret))
  .update([method, url, normalized].map(encode).join('&')).digest('base64');

Then('OAuth1 signing matches the published photo vector and normalized form example', async () => {
  // OAuth 1.0a Core section 9.1.1; RFC 5849 sections 3.4.1.1 and 3.4.1.3.
  const photo = await signOAuth1('GET', 'http://photos.example.net/photos?file=vacation.jpg&size=original', null, null,
    { consumerKey: 'dpf43f3p2l4k3l03', consumerSecret: 'kd94hf93k423kf44', accessToken: 'nnch734d00sl2jdk', tokenSecret: 'pfkkdhi9sl3r4s00' },
    { nonce: () => 'kllo9940pd9333jh', timestamp: () => 1191242096 });
  assert.equal(signature(photo), 'tR3+Ty81lMeYAr/Fid0kMTYa/WM=');
  const form = await signOAuth1('POST', 'http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b', 'application/x-www-form-urlencoded', 'c2&a3=2+q',
    { consumerKey: '9djdj82h48djs9d2', consumerSecret: 'j49sk3j29djd', accessToken: 'kkk9d7dh3k39sjv7', tokenSecret: 'dh893hdasih9' },
    { nonce: () => '7d8f3e4a', timestamp: () => 137131201 }, false);
  const normalized = 'a2=r%20b&a3=2%20q&a3=a&b5=%3D%253D&c%40=&c2=&oauth_consumer_key=9djdj82h48djs9d2&oauth_nonce=7d8f3e4a&oauth_signature_method=HMAC-SHA1&oauth_timestamp=137131201&oauth_token=kkk9d7dh3k39sjv7';
  assert.ok(form.secrets.includes(normalized));
  assert.equal(signature(form), expectedSignature('POST', 'http://example.com/request', normalized,
    { consumerSecret: 'j49sk3j29djd', tokenSecret: 'dh893hdasih9' }));
  assert.equal(signature(form), 'r6/TJjbCOr97/+UU0NsvSne7s5g=');
});

Then('OAuth1 signs duplicate query and form values while excluding JSON and multipart bodies', async () => {
  const url = endpoint+'/2/form?z=&a=two+words&a=%21&utf=%E2%98%83';
  const signed = await signOAuth1('POST', url, 'application/x-www-form-urlencoded; charset=UTF-8', new URLSearchParams('a=%2A&empty&z=last'), values, clock);
  const normalized = 'a=%21&a=%2A&a=two%20words&empty=&oauth_consumer_key=X_CONSUMER_KEY_5729&oauth_nonce=synthetic_nonce_5729&oauth_signature_method=HMAC-SHA1&oauth_timestamp=1700000000&oauth_token=X_ACCESS_TOKEN_5729&oauth_version=1.0&utf=%E2%98%83&z=&z=last';
  assert.equal(signature(signed), expectedSignature('POST', endpoint+'/2/form', normalized));
  const base = await signOAuth1('POST', url, null, null, values, clock);
  for (const [type, body] of [['application/json', '{"oauth_nonce":"body-only"}'], ['multipart/form-data', new FormData()]])
    assert.equal(signature(await signOAuth1('POST', url, type, body, values, clock)), signature(base));
  assert.equal(signature(await signOAuth1('POST', 'https://API.X.COM:443/2/form?z=&a=two+words&a=%21&utf=%E2%98%83', null, null, values, clock)), signature(base));
  for (const query of ['oauth_signature=forged', 'OAuth_Token=forged', 'bad=%GG', 'bad=%C3%28'])
    await assert.rejects(signOAuth1('GET', endpoint+'/2/read?'+query, null, null, values, clock), permission);
  await assert.rejects(signOAuth1('POST', url, 'application/x-www-form-urlencoded', 'oauth_nonce=forged', values, clock), permission);
});

Then('the pinned X recipe enables only reviewed OAuth1 choices without replacing OAuth2', async () => {
  const raw = await readServiceSchemaUpstream('x'), patched = await readServiceSchema('x');
  assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), xOauth1SourceSha256);
  assert.deepEqual(serviceSchemaDescriptors.find(item => item.id === 'x').patches, [xOauth1Signing]);
  const expected = structuredClone(raw); expected.components.securitySchemes.UserToken['x-operations-oauth1'] = 'x-hmac-sha1';
  assert.deepEqual(patched, expected); assert.deepEqual(applySchemaPatches(patched, [xOauth1Signing]), patched);
  const before = inspectServiceSchema(raw, 'x').operations, after = inspectServiceSchema(patched, 'x').operations;
  const affected = Object.values(raw.paths).flatMap(item => Object.values(item)).filter(operation => operation?.security?.some(option => Object.hasOwn(option, 'UserToken'))).length;
  let usable = 0;
  for (const model of after) {
    const old = before.find(item => item.id === model.id); assert.equal(model.unavailableReason, old.unavailableReason);
    if (model.security?.some(option => option.some(scheme => scheme.kind === 'oauth1'))) {
      if (!model.unavailableReason) usable++;
      assert.deepEqual(model.security.map(option => option.map(s => s.name)), old.security.map(option => option.map(s => s.name)));
      for (let i = 0; i < model.security.length; i++) if (!model.security[i].some(s => s.kind === 'oauth1')) assert.deepEqual(model.security[i], old.security[i]);
    }
  }
  assert.equal(affected, 101); assert.equal(usable, 51);
  for (const change of [doc => { doc.info.version = 'future'; }, doc => { doc.servers[0].url = 'https://evil.example.test'; },
    doc => { doc.paths['/2/users/me'].get.servers = [{ url: endpoint+'/other' }]; }]) {
    const changed = structuredClone(raw); change(changed); assert.throws(() => applySchemaPatches(changed, [xOauth1Signing]), /reviewed/);
  }
  console.log('X qualification: '+JSON.stringify({ methods: after.length, oauth1: affected, usableOAuth1: usable, independentLimitations: affected-usable }));
});

Then('X requests dispatch once with private signatures over the final method URL and form body', async () => {
  const doc = document(), models = extractOperations(doc, 'x-fixture'), previous = [...catalogs];
  updateCatalogs([...previous, { id: 'x-fixture', name: 'X fixture', file: 'x-fixture.json', document: doc, groups: [], execution: { kind: 'http', origin: endpoint } }]);
  try {
    let count = 0;
    for (const model of models) {
      const f = await setup(model), input = { 'query:search': 'snow ☃ + !', ...(model.method === 'POST' ? { 'body:text': 'hello + % & !' } : {}) };
      const executor = createWorkflowExecution((descriptor, values, context) => executeCredentialed(descriptor, values, context.binding, f.records,
        options(async (url, init) => {
          count++; assert.equal(new URL(url).searchParams.get('search'), input['query:search']);
          assert.equal(init.method, model.method); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
          assert.equal(init.referrerPolicy, 'no-referrer');
          const expected = await signOAuth1(init.method, String(url), init.headers.get('Content-Type'), init.body, valuesForTest(), clock);
          assert.equal(init.headers.get('Authorization'), expected.authorization);
          if (model.path === '/2/json') assert.deepEqual(JSON.parse(init.body), { text: input['body:text'] });
          if (model.path === '/2/form') assert.equal(String(init.body), 'text=hello+%2B+%25+%26+%21');
          return Response.json({ accepted: true });
        })));
      const result = await executor.execute(model, input, undefined, { binding: f.binding, runId: crypto.randomUUID(), nodeId: 'x' });
      safe(result); assert.equal(result.response.status, 200); assert.equal(result.request.headers?.Authorization, undefined);
    }
    assert.equal(count, 3);
  } finally { updateCatalogs(previous); }
  const native = inspectServiceSchema(await readServiceSchema('x'), 'x').operations.find(item => item.id === 'x:deletePosts');
  const f = await setup(native); f.binding.alternative = 1;
  await executeCredentialed(f.descriptor, { 'path:id': '123' }, f.binding, f.records, options(async url => { assert.equal(String(url), endpoint+'/2/tweets/123'); return Response.json({ data: { id: 'synthetic' } }); }));
});
function valuesForTest() { return values; }

Then('OAuth1 connection references validate all four keys and invalidate on rotation or removal', async () => {
  const f = await setup(), selection = validateCredentialBinding(JSON.parse(JSON.stringify(f.binding)));
  assert.deepEqual(credentialReferenceIds(selection.credentials.UserToken), f.records.map(item => item.id));
  for (const malformed of [{ ...f.reference, tokenSecret: 'not-an-id' }, { ...f.reference, extra: crypto.randomUUID() }, { consumerKey: f.records[0].id }])
    assert.throws(() => validateCredentialBinding({ ...f.binding, credentials: { UserToken: malformed } }));
  const profile = await createHttpConnection({ label: 'X account', account: 'Synthetic', format: 'schema' }, f.descriptor, selection, f.records);
  const owner = f.records.find(record => record.id === credentialReferenceIds(f.reference).sort()[0]); owner.connections = [profile];
  const saved = { ...f.binding, credentials: {}, connection: httpConnectionReference(profile) };
  assert.deepEqual((await resolveHttpConnection(f.descriptor, saved, f.records)).binding.credentials, selection.credentials);
  await invalidateHttpConnections(f.records, f.reference.tokenSecret);
  await assert.rejects(resolveHttpConnection(f.descriptor, saved, f.records), permission);
  const current = { ...saved, connection: httpConnectionReference(owner.connections[0]) };
  await assert.rejects(resolveHttpConnection(f.descriptor, current, f.records.filter(record => record.id !== f.reference.accessToken)), permission);
  const portable = portableWorkflowDocument({ version: 3, id: 'x-fixture', name: 'X', nodes: [{ id: 'x', type: 'operation', position: { x: 0, y: 0 }, data: { operationId: f.descriptor.operation.id, name: 'Read', description: '', method: 'GET', path: '/2/read', credentialBinding: saved } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false });
  assert.ok(!JSON.stringify(portable).includes(profile.id)); assert.ok(!JSON.stringify(portable).includes('credentialBinding'));
});

Then('OAuth1 rejects changed destinations missing references protocol collisions and stale authority', async () => {
  const f = await setup(); let calls = 0, checks = 0;
  const opts = options(async () => { calls++; return Response.json({ ok: true }); });
  for (const endpoint of ['https://evil.example.test', 'https://api.x.com/other']) await assert.rejects(approvedOperation(f.descriptor.operation, endpoint), permission);
  for (const records of [f.records.slice(1), [...f.records, f.records[0]]]) await assert.rejects(executeCredentialed(f.descriptor, {}, f.binding, records, opts), permission);
  await assert.rejects(executeCredentialed(f.descriptor, {}, { ...f.binding, fingerprint: '0'.repeat(64) }, f.records, opts), permission);
  for (const [location, name] of [['header', 'Authorization'], ['header', 'authorization'], ['query', 'oauth_nonce']]) {
    const operation = { ...f.descriptor.operation, fields: [{ key: location+':'+name, name, location, type: 'string', required: false }] };
    const descriptor = await approvedOperation(operation, endpoint);
    await assert.rejects(executeCredentialed(descriptor, { [location+':'+name]: 'override' }, { ...f.binding, fingerprint: descriptor.fingerprint }, f.records, opts), permission);
  }
  await assert.rejects(executeCredentialed(f.descriptor, {}, f.binding, f.records, { ...opts,
    assertCurrent() { checks++; throw new VaultError('PERMISSION'); } }), permission);
  assert.ok(checks > 0); assert.equal(calls, 0);
});

Then('OAuth1 raw encoded and derived authorization material is removed from responses and errors', async () => {
  const f = await setup();
  const signed = await signOAuth1('GET', endpoint+'/2/read', null, null, values, clock);
  const canaries = [...Object.values(values), ...signed.secrets].flatMap(value => [value, encodeURIComponent(value), new URLSearchParams({ x: value }).toString().slice(2)]);
  for (const status of [200, 403]) {
    const execute = executeCredentialed(f.descriptor, {}, f.binding, f.records, options(async () => Response.json({ echo: canaries }, { status, headers: { 'X-Echo': signature(signed), Authorization: signed.authorization } })));
    const result = status === 200 ? await execute : await execute.catch(error => error);
    assert.equal((result.response).redacted, true); assert.equal(result.response.headers.authorization, undefined);
    for (const value of canaries) assert.ok(!JSON.stringify(result).includes(value)); safe(result);
  }
  const failure = await executeCredentialed(f.descriptor, {}, f.binding, f.records, options(async () => { throw new Error(signed.authorization); })).catch(error => error);
  assert.equal(failure.code, 'NETWORK'); assert.equal(failure.cause, undefined); safe(failure);
});

Then('X bearer and OAuth2 alternatives execute at their original indexes without signing', async () => {
  const model = extractOperations(document(), 'x-fixture')[0], approved = await approvedOperation(model, endpoint);
  assert.deepEqual(model.security.map(option => option[0].kind), ['bearer', 'bearer', 'oauth1']);
  for (const alternative of [0, 1]) {
    const credential = { id: crypto.randomUUID(), kind: 'bearer', value: 'X_EXISTING_BEARER_5729', label: 'Existing token', grants: [] };
    let calls = 0;
    await executeCredentialed(approved, {}, { alternative, fingerprint: approved.fingerprint, credentials: { [model.security[alternative][0].name]: credential.id } }, [credential], {
      assertCurrent() {}, oauth1Clock: { nonce() { assert.fail('Bearer called the OAuth1 signer'); }, timestamp() { assert.fail('Bearer requested a timestamp'); } },
      fetchRequest: async (_url, init) => { calls++; assert.equal(init.headers.get('Authorization'), 'Bearer '+credential.value); return Response.json({ data: [] }); },
    });
    assert.equal(calls, 1);
  }
  const native = inspectServiceSchema(await readServiceSchema('x'), 'x').operations.find(item => item.id === 'x:deletePosts');
  const descriptor = await approvedOperation(native, endpoint), record = { id: crypto.randomUUID(), kind: 'bearer', value: 'X_NATIVE_OAUTH2_5729', label: 'OAuth2', grants: [] };
  await executeCredentialed(descriptor, { 'path:id': '123' }, { alternative: 0, fingerprint: descriptor.fingerprint, credentials: { OAuth2UserToken: record.id } }, [record], {
    assertCurrent() {}, fetchRequest: async (_url, init) => { assert.equal(init.headers.get('Authorization'), 'Bearer '+record.value); return Response.json({ deleted: true }); },
  });
});

Then('repeated OAuth1 requests use fresh unpredictable nonces without exposing authorization', async () => {
  const f = await setup(), seen = [];
  for (let i = 0; i < 2; i++) {
    const result = await executeCredentialed(f.descriptor, {}, f.binding, f.records, { assertCurrent() {}, fetchRequest: async (_url, init) => {
      const fields = oauth(init.headers.get('Authorization')); seen.push(fields.oauth_nonce);
      assert.match(fields.oauth_nonce, /^[a-f0-9]{64}$/); assert.ok(Math.abs(Number(fields.oauth_timestamp)-Date.now()/1000) < 10);
      return Response.json({ accepted: true });
    } }); safe(result);
  }
  assert.notEqual(seen[0], seen[1]);
});

Then('OAuth1 rejects oversized ambiguous or unsupported signing inputs without leaking key material', async () => {
  for (const [method, url] of [['get', endpoint+'/2/read'], ['GET', 'ftp://api.x.com/2/read'], ['GET', 'https://user:password@api.x.com/2/read'], ['GET', endpoint+'/2/read#fragment']])
    await assert.rejects(signOAuth1(method, url, null, null, values, clock), permission);
  for (const runtime of [{ ...clock, nonce: () => 'bad nonce' }, { ...clock, timestamp: () => 0 }, { ...clock, timestamp: () => 1.5 }])
    await assert.rejects(signOAuth1('GET', endpoint+'/2/read', null, null, values, runtime), error => error.code === 'INVALID');
  await assert.rejects(signOAuth1('POST', endpoint+'/2/read', 'application/x-www-form-urlencoded', new Blob(['a=1']), values, clock), permission);
  for (const query of ['a='+'x'.repeat(1024*1024), Array.from({ length: 10001 }, () => 'a=1').join('&'), 'a='+'%26'.repeat(230000)])
    await assert.rejects(signOAuth1('GET', endpoint+'/2/read?'+query, null, null, values, clock), error => error.code === 'LIMIT');
  const empty = await signOAuth1('POST', endpoint+'/2/read', 'application/x-www-form-urlencoded', new URLSearchParams(), values, clock);
  assert.ok(empty.authorization.startsWith('OAuth '));
  const spy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error(values.consumerSecret));
  try {
    await assert.rejects(signOAuth1('GET', endpoint+'/2/read', null, null, values, clock), error => { safe({ message: error.message }); assert.equal(error.cause, undefined); return permission(error); });
  } finally { spy.mockRestore(); }
});
