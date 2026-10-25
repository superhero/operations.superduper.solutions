// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Then } from "@cucumber/cucumber";
import { vi } from "vitest";
import { approvedOperation, canonicalPolicyValue, normalizeCredentialOrigin, validateApprovedOperation } from "./lib/secrets/policy.ts";
import { CredentialResponseError, executeCredentialed } from "./lib/secrets/execution.ts";
import { InputValidationError } from "./lib/operation-input.ts";
import { extractOperations, updateCatalogs } from "./lib/catalog.ts";
import { catalogs } from "./lib/catalog-registry.ts";
import { createWorkflowExecution } from "./lib/workflow-execution.ts";
import { cloudflareOrigin, cloudflareUploadContracts, configureCloudflareUpload } from "./lib/cloudflare-upload.ts";
import { CloudflareUploadSessions } from "./lib/secrets/cloudflare-upload.ts";
import { createHttpConnection, createGitlabHttpConnection, httpConnectionReference } from "./lib/secrets/http-connections.ts";
import { VaultError, vaultLimits } from "./lib/secrets/types.ts";
import { vaultVariablePlaceholder } from "./lib/secrets/variables.ts";
import { assertRequestDeadline } from "../tests/workflow-deadline.fixture.mjs";

const canary = "credential-CANARY-17";
const bearer = { name: "Bearer", kind: "bearer", header: "Authorization" };
const key = { name: "Key", kind: "apiKey", header: "X-Api-Key" };
const queryKey = { name: "Query", kind: "apiKey", query: "api_key" };

function uploadOperation(profile, security) {
  const [method, path] = cloudflareUploadContracts[profile];
  const operation = { id: 'upload-guards:'+profile, name: profile, description: '', group: 'Upload guards', method, path,
    fields: [], bodyRequired: false, security };
  configureCloudflareUpload(operation, profile); return operation;
}

Then('private approval rejects malformed security and authentication outside its reviewed protocol profile', async () => {
  for (const security of [null, {}, [[], {}]]) await assert.rejects(() => approvedOperation({ ...baseOperation(), security }, 'https://api.example.test'), denied);
  const unavailable = [{ name: 'LegacyHeader', kind: 'unsupported', reason: 'This provider header requires an unavailable signing profile.', header: 'X-Legacy-Key' },
    { name: 'LegacyQuery', kind: 'unsupported', reason: 'This provider query requires an unavailable signing profile.', query: 'legacy_key' }];
  const mixed = await fixture({ ...baseOperation(), security: [[bearer], ...unavailable.map(scheme => [scheme])] });
  assert.deepEqual(mixed.descriptor.operation.security.slice(1), unavailable.map(scheme => [scheme]));
  let sent = 0;
  const fetchRequest = async (_url, init) => { sent++; assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer '+canary); return response(); };
  assert.equal((await execute(mixed, { fetchRequest })).response.status, 200);
  for (const [index, scheme] of unavailable.entries()) {
    await assert.rejects(() => executeCredentialed(mixed.descriptor, {}, { fingerprint: mixed.descriptor.fingerprint, alternative: index+1,
      credentials: { [scheme.name]: mixed.credentials[0].id } }, mixed.credentials, { assertCurrent() {}, fetchRequest }), denied);
  }
  assert.equal(sent, 1, 'Unavailable choices remain visible without becoming executable authentication.');
  for (const invalid of [
    ...[42, '', '   ', 'x'.repeat(4097)].map(reason => ({ ...unavailable[1], reason })),
    { ...unavailable[1], extra: true }, { name: 'Legacy', kind: 'unsupported', reason: 'Unavailable.', cookie: 'session' },
  ]) await assert.rejects(() => approvedOperation({ ...baseOperation(), security: [[bearer], [invalid]] }, mixed.descriptor.origin), denied);

  const authId = crypto.randomUUID(), otherId = crypto.randomUUID(), header = 'X-Api-Key';
  const headerDescriptor = await approvedOperation({ ...baseOperation(), security: [[key]], fields: [field('header', header)] }, 'https://api.example.test');
  const headerBinding = { fingerprint: headerDescriptor.fingerprint, alternative: 0, credentials: { Key: authId } };
  const records = [{ id: authId, label: 'Selected key', kind: 'secret', value: canary, grants: [] },
    { id: otherId, label: 'Other private input', kind: 'secret', value: 'different-private-key-5729', grants: [] }];
  let headerCalls = 0;
  const values = { ['header:'+header]: vaultVariablePlaceholder };
  const headerOptions = credentialId => ({ variables: [{ key: 'header:'+header, path: [], credentialId }], assertCurrent() {},
    fetchRequest: async (_url, init) => { headerCalls++; assert.equal(new Headers(init.headers).get(header), canary); return response(); } });
  await assert.rejects(() => executeCredentialed(headerDescriptor, values, headerBinding, records, headerOptions(otherId)), denied);
  assert.equal(headerCalls, 0, 'A different private field cannot overwrite the selected authentication key.');
  const retained = await executeCredentialed(headerDescriptor, values, headerBinding, records, headerOptions(authId));
  assert.equal(headerCalls, 1); assert.equal(retained.request.headers?.[header], undefined);
  assert.equal(JSON.stringify(retained).includes(canary), false);
  const account = [{ name: 'api_token', kind: 'bearer', header: 'Authorization' }];
  const legacy = [{ name: 'api_email', kind: 'apiKey', header: 'X-Auth-Email' }, { name: 'api_key', kind: 'apiKey', header: 'X-Auth-Key' }];
  assert.ok((await approvedOperation(uploadOperation('workers-session', [legacy]), cloudflareOrigin)).fingerprint);
  const wrongAccount = uploadOperation('workers-session', [[{ ...account[0], name: 'unreviewed_token' }]]);
  const wrongSession = uploadOperation('pages-check', [[{ name: 'unreviewed_session', kind: 'cloudflare-upload', header: 'Authorization', profile: 'pages' }]]);
  const standalone = { ...baseOperation(), security: [[{ name: 'assets_jwt', kind: 'cloudflare-upload', header: 'Authorization', profile: 'workers' }]] };
  for (const operation of [wrongAccount, wrongSession, standalone]) await assert.rejects(() => approvedOperation(operation, cloudflareOrigin), denied);
  await assert.rejects(() => approvedOperation({ ...baseOperation(), s3Files: 'get-object' }, 'https://api.example.test'), denied);
  await assert.rejects(() => approvedOperation(baseOperation(), 'https://api.telegram.org'), denied);
});

Then('private uploads require a session manager and a qualified reference and cancel before accepting a response', async () => {
  const operation = uploadOperation('workers-session', [[{ name: 'api_token', kind: 'bearer', header: 'Authorization' }]]);
  const descriptor = await approvedOperation(operation, cloudflareOrigin), id = crypto.randomUUID();
  const credentials = [{ id, label: 'Upload key', kind: 'bearer', value: canary, grants: [] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { api_token: id } };
  let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({}); } };
  await assert.rejects(() => executeCredentialed(descriptor, {}, binding, credentials, options), denied);
  const consumer = await approvedOperation(uploadOperation('pages-check', [[{ name: 'pages_upload_token', kind: 'cloudflare-upload', header: 'Authorization', profile: 'pages' }]]), cloudflareOrigin);
  const manager = new CloudflareUploadSessions(), clear = vi.spyOn(manager, 'clear');
  try {
    await assert.rejects(() => executeCredentialed(consumer, {}, { alternative: 0, fingerprint: consumer.fingerprint,
      credentials: { pages_upload_token: { username: id, password: id } } }, credentials, { ...options, uploadSessions: manager }), denied);
    assert.equal(calls, 0);
    const controller = new AbortController(); let checks = 0;
    await assert.rejects(() => executeCredentialed(descriptor, { 'path:account_id': 'a'.repeat(32), 'path:script_name': 'fixture', 'body:manifest': '{}' },
      binding, credentials, { ...options, uploadSessions: manager, signal: controller.signal,
        assertCurrent() { if (++checks === 2) controller.abort(); } }), error => error.code === 'CANCELLED');
    assert.equal(calls, 1); assert.equal(checks, 2); assert.ok(clear.mock.calls.length >= 2);
  } finally { clear.mockRestore(); manager.clear(); }
});

Then('private OAuth signing and final response acceptance stop when their owner cancels', async () => {
  const scheme = { name: 'OAuth', kind: 'oauth1', header: 'Authorization', profile: 'x-hmac-sha1' };
  const descriptor = await approvedOperation({ ...baseOperation(), path: '/2/users/me', security: [[scheme]] }, 'https://api.x.com');
  const parts = ['consumerKey', 'consumerSecret', 'accessToken', 'tokenSecret'];
  const credentials = parts.map(name => ({ id: crypto.randomUUID(), label: name, kind: 'secret', value: 'private-oauth-'+name+'-5729', grants: [] }));
  const reference = Object.fromEntries(parts.map((name, index) => [name, credentials[index].id]));
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { OAuth: reference } };
  let dispatched = 0;
  const fetchRequest = async () => { dispatched++; return Response.json({ ok: true }); };
  await assert.rejects(() => executeCredentialed(descriptor, {}, { ...binding, credentials: { OAuth: credentials[0].id } }, credentials,
    { assertCurrent() {}, fetchRequest }), denied);
  const controller = new AbortController();
  await assert.rejects(() => executeCredentialed(descriptor, {}, binding, credentials,
    { signal: controller.signal, assertCurrent() { controller.abort(); }, fetchRequest }), error => error.code === 'CANCELLED');
  assert.equal(dispatched, 0);
  const ordinary = await fixture(), late = new AbortController(); let checks = 0;
  await assert.rejects(() => execute(ordinary, { signal: late.signal, assertCurrent() { if (++checks === 2) late.abort(); }, fetchRequest }),
    error => error.code === 'CANCELLED');
  assert.equal(checks, 2); assert.equal(dispatched, 1);
});

Then('a saved connection that expires during policy confirmation cannot dispatch', async () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const state = await fixture(), id = crypto.randomUUID(); state.credentials[0].id = id; state.binding.credentials.Bearer = id;
    const connection = await createHttpConnection({ label: 'Short lived', account: 'Fixture', format: 'schema', expiresAt: now+1000 },
      state.descriptor, state.binding, state.credentials);
    state.credentials[0].connections = [connection];
    state.binding = { fingerprint: state.descriptor.fingerprint, alternative: 0, credentials: {}, connection: httpConnectionReference(connection) };
    let dispatched = 0;
    await assert.rejects(() => execute(state, { assertCurrent() { clock.mockReturnValue(now+1001); },
      fetchRequest: async () => { dispatched++; return response(); } }), denied);
    assert.equal(dispatched, 0);
  } finally { clock.mockRestore(); }
});

async function managedExecutionFixture(now) {
  const operation = { ...baseOperation(), id: 'managed-gitlab:user', path: '/api/v4/user', security: [[{ name: 'oauth2', kind: 'bearer', header: 'Authorization' }]] };
  const descriptor = await approvedOperation(operation, 'https://gitlab.com'), id = crypto.randomUUID();
  const oauth = { profile: 'gitlab-public-pkce-v1', clientId: 'a'.repeat(64), redirectUri: 'https://operations.example.test/?operations_oauth_callback=gitlab',
    scope: 'read_user', accountId: '42' };
  const state = { profile: 'gitlab-public-pkce-v1', oauth, username: 'fixture', accessToken: 'managed-access-private-5729',
    refreshToken: 'managed-refresh-private-5729', expiresAt: now+1000 };
  const connection = await createGitlabHttpConnection(descriptor, id, 'Managed fixture', state.username, oauth);
  const credential = { id, label: 'Managed token', kind: 'bearer', value: state.accessToken, oauthState: JSON.stringify(state), grants: [], connections: [connection] };
  return { descriptor, state, credential, binding: { fingerprint: descriptor.fingerprint, alternative: 0, credentials: {}, connection: httpConnectionReference(connection) } };
}

Then('managed private execution refuses stale token state account changes and expiry at every acceptance boundary', async () => {
  for (const failure of ['missing state', 'refresh pending', 'expired state', 'before send', 'wrong account', 'null account', 'array account', 'during response', 'before accept']) {
    const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const v = await managedExecutionFixture(now); let calls = 0, checks = 0;
      if (failure === 'missing state') delete v.credential.oauthState;
      if (failure === 'refresh pending') v.credential.oauthState = JSON.stringify({ ...v.state, refreshPending: true });
      if (failure === 'expired state') v.credential.oauthState = JSON.stringify({ ...v.state, expiresAt: now });
      await assert.rejects(() => executeCredentialed(v.descriptor, {}, v.binding, [v.credential], {
        assertCurrent() { checks++; if (failure === 'before send' || failure === 'before accept' && checks === 2) clock.mockReturnValue(now+1001); },
        fetchRequest: async (_url, init) => {
          calls++; assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer '+v.state.accessToken);
          if (failure === 'during response') clock.mockReturnValue(now+1001);
          return Response.json(failure === 'wrong account' ? { id: 99 } : failure === 'null account' ? null : failure === 'array account' ? [] : { id: 42 });
        },
      }), error => error.code === 'AUTHORIZATION' && !JSON.stringify(error).includes(v.state.accessToken) && !JSON.stringify(error).includes(v.state.refreshToken), failure);
      assert.equal(calls, ['missing state', 'refresh pending', 'expired state', 'before send'].includes(failure) ? 0 : 1, failure);
    } finally { clock.mockRestore(); }
  }
});

Then('the default workflow executor forwards native and Docker calls to their selected private bridge', async () => {
  const nativeModule = await import('./lib/secrets/native-workflow-executor.ts');
  const dockerModule = await import('./lib/secrets/docker-client.ts');
  const nativeResult = { request: { protocol: 'json-rpc', method: 'thread/start', params: {} },
    response: { protocol: 'json-rpc', result: { thread: { id: 'thread_fixture' } } } };
  const dockerResult = { request: { method: 'GET', path: '/containers/json', query: {} },
    response: { status: 200, statusText: 'OK', headers: {}, body: [] } };
  const nativeBridge = vi.spyOn(nativeModule, 'executeNativeWorkflow').mockResolvedValue(nativeResult);
  const dockerBridge = vi.spyOn(dockerModule, 'executeDockerWorkflow').mockResolvedValue(dockerResult);
  try {
    const executor = createWorkflowExecution(), values = {}, controller = new AbortController(), progress = () => {};
    const reference = { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
    const nativeBinding = { runtime: reference, fingerprint: 'b'.repeat(64) }, dockerBinding = { host: reference, fingerprint: 'c'.repeat(64) };
    const native = { id: 'codex:thread/start', method: 'RPC', path: 'thread/start', protocol: 'json-rpc' };
    const docker = { id: 'docker:ContainerList', method: 'GET', path: '/containers/json' };
    assert.equal(await executor.executeNative(native, values, nativeBinding, controller.signal, progress), nativeResult);
    assert.deepEqual(nativeBridge.mock.calls, [[native, values, nativeBinding, controller.signal, progress]]);
    assert.equal(await executor.executeDocker(docker, values, dockerBinding, controller.signal), dockerResult);
    assert.deepEqual(dockerBridge.mock.calls, [[docker, values, dockerBinding, controller.signal]]);
    const failure = new Error('The selected paired runtime is unavailable.');
    nativeBridge.mockRejectedValueOnce(failure); dockerBridge.mockRejectedValueOnce(failure);
    await assert.rejects(() => executor.executeNative(native, values, nativeBinding, controller.signal, progress), error => error === failure);
    await assert.rejects(() => executor.executeDocker(docker, values, dockerBinding, controller.signal), error => error === failure);
    assert.equal(nativeBridge.mock.calls.length, 2); assert.equal(dockerBridge.mock.calls.length, 2);
  } finally { nativeBridge.mockRestore(); dockerBridge.mockRestore(); }
});

Then('workflow credential connections cannot authorize public alternatives or an unsecured upload profile', async () => {
  const source = { openapi: '3.1.0', info: { title: 'Execution guard fixture', version: '1' }, servers: [{ url: 'https://guard.example.test' }],
    components: { securitySchemes: { Bearer: { type: 'http', scheme: 'bearer' } } }, paths: {
      '/public': { get: { operationId: 'public' } },
      '/optional': { get: { operationId: 'optional', security: [{}, { Bearer: [] }] } },
      '/pages/assets/check-missing': { post: { operationId: 'upload', 'x-operations-cloudflare-upload': 'pages-check' } },
    } };
  const previous = catalogs, models = extractOperations(source, 'execution-guards');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => assert.fail('A refused execution reached HTTP.'));
  let privateCalls = 0;
  try {
    updateCatalogs([...previous, { id: 'execution-guards', name: 'Execution guards', file: 'guards.json', document: source, groups: [],
      execution: { kind: 'http', origin: source.servers[0].url } }]);
    const executor = createWorkflowExecution(async () => { privateCalls++; assert.fail('A refused selection reached private execution.'); });
    for (const operation of models.filter(value => value.id !== 'execution-guards:upload')) {
      const descriptor = await approvedOperation(operation, source.servers[0].url);
      const context = { runId: crypto.randomUUID(), nodeId: operation.id, binding: { fingerprint: descriptor.fingerprint, alternative: 0, credentials: {},
        connection: { id: crypto.randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) } } };
      await assert.rejects(() => executor.execute(operation, {}, undefined, context), error => error.code === 'PERMISSION');
    }
    await assert.rejects(() => executor.execute(models.find(value => value.id === 'execution-guards:upload'), {}), error => error.code === 'PERMISSION');
    assert.equal(privateCalls, 0); assert.equal(fetch.mock.calls.length, 0);
  } finally { fetch.mockRestore(); updateCatalogs(previous); }
});
const baseOperation = () => ({ id: "schema:read", name: "Read", description: "", group: "Items", method: "GET", path: "/items",
  fields: [], bodyRequired: false, security: [[bearer]] });
const field = (location, name, extra = {}) => ({ key: `${location}:${name}`, location, name, label: name,
  description: "", type: "string", required: false, ...extra });
const response = () => new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
async function withApplicationOrigin(origin, action) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  if (origin === undefined) delete globalThis.location;
  else Object.defineProperty(globalThis, "location", { configurable: true, value: { origin } });
  try { return await action(); }
  finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else delete globalThis.location;
  }
}
async function fixture(operation = baseOperation(), origin = "https://api.example.test/v1") {
  const descriptor = await approvedOperation(operation, origin);
  const credentials = [{ id: "credential-one", label: "Account", kind: "bearer", value: canary,
    grants: [{ id: "grant-one", scheme: "Bearer", descriptor }] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Bearer: "credential-one" } };
  return { descriptor, credentials, binding };
}
const denied = error => error instanceof VaultError && error.code === "PERMISSION" && !error.cause;
async function execute(state, { values = {}, fetchRequest = async () => response(), ...options } = {}) {
  return executeCredentialed(state.descriptor, values, state.binding, state.credentials, { assertCurrent() {}, fetchRequest, ...options });
}

async function basicFixture() {
  const descriptor = await approvedOperation({ ...baseOperation(), security: [[{ name: 'Login', kind: 'basic', header: 'Authorization' }, key]] }, 'https://api.example.test/v1');
  const credentials = [
    { id: crypto.randomUUID(), kind: 'secret', label: 'Username', value: 'basic-USER-9182', grants: [] },
    { id: crypto.randomUUID(), kind: 'apiKey', label: 'Password token', value: 'basic-PASSWORD:9182', grants: [] },
    { id: crypto.randomUUID(), kind: 'apiKey', label: 'Extra key', value: 'basic-KEY-9182', grants: [] },
  ];
  return { descriptor, credentials, binding: { alternative: 0, fingerprint: descriptor.fingerprint,
    credentials: { Login: { username: credentials[0].id, password: credentials[1].id }, Key: credentials[2].id } } };
}
Then('Basic credentials are encoded privately and source joined token and header echoes stay redacted', async () => {
  const state = await basicFixture(), joined = `${state.credentials[0].value}:${state.credentials[1].value}`;
  const encoded = Buffer.from(joined, 'ascii').toString('base64'), header = `Basic ${encoded}`;
  const echoes = { username: state.credentials[0].value, password: state.credentials[1].value, joined, encoded, header,
    escaped: encodeURIComponent(encoded), form: new URLSearchParams({ v: encoded }).toString().slice(2) };
  let calls = 0, current = 0;
  for (const status of [200, 401]) {
    const pending = execute(state, { assertCurrent() { current++; }, fetchRequest: async (url, options) => {
      calls++; assert.equal(options.headers.get('Authorization'), header);
      assert.equal(options.headers.get('X-Api-Key'), state.credentials[2].value);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      return Response.json(echoes, { status, headers: { 'X-Reflected': header } });
    } });
    const result = status === 200 ? await pending : await pending.catch(error => { assert.ok(error instanceof CredentialResponseError); return error; });
    for (const secret of [...Object.values(echoes), state.credentials[2].value]) assert.ok(!JSON.stringify(result).includes(secret), 'No Basic source or derived value crosses private execution.');
    assert.equal(result.response.redacted, true);
  }
  assert.equal(calls, 2); assert.equal(current, 4);
});
Then('Basic execution rejects {string} before dispatch', async kind => {
  const state = await basicFixture(); let values = {};
  const change = {
    'missing username': () => { delete state.binding.credentials.Login.username; },
    'extra role': () => { state.binding.credentials.Login.extra = crypto.randomUUID(); },
    'single reference': () => { state.binding.credentials.Login = state.credentials[0].id; },
    'missing record': () => { state.credentials.shift(); },
    'duplicate record': () => { state.credentials.push({ ...state.credentials[0] }); },
    'stale fingerprint': () => { state.binding.fingerprint = '0'.repeat(64); },
    'username colon': () => { state.credentials[0].value = 'wrong:user'; },
    'non ASCII': () => { state.credentials[0].value = 'usér'; },
    'control character': () => { state.credentials[1].value = 'secret\nvalue'; },
    'empty password': () => { state.credentials[1].value = ''; },
    'oversized encoding': () => { state.credentials[1].value = 'x'.repeat(vaultLimits.secretBytes); },
    'public auth header': async () => {
      state.descriptor = await approvedOperation({ ...state.descriptor.operation, fields: [field('header', 'Authorization')] }, state.descriptor.origin);
      state.binding.fingerprint = state.descriptor.fingerprint; values = { 'header:Authorization': 'override' };
    },
    'pair for bearer': async () => {
      state.descriptor = await approvedOperation(baseOperation(), state.descriptor.origin);
      state.binding = { alternative: 0, fingerprint: state.descriptor.fingerprint, credentials: { Bearer: state.binding.credentials.Login } };
    },
  };
  assert.ok(change[kind]); await change[kind]();
  await assert.rejects(execute(state, { values, fetchRequest: () => assert.fail('Invalid Basic credentials dispatched') }), error => error instanceof VaultError);
});

Then('private JSON expressions retain null and structured values in approved request bodies', async () => {
  const operation = { ...baseOperation(), method: 'POST', bodyRequired: true, bodyValue: true, bodyMediaType: 'application/json',
    fields: [field('body', '$', { type: 'json', required: true, schema: { type: 'json', nullable: true } })],
    bodySchema: { type: 'json', nullable: true } };
  const state = await fixture(operation);
  for (const value of [null, { enabled: false, values: [0, 'safe'] }]) {
    let requests = 0, sentBody;
    await execute(state, { values: { 'body:$': vaultVariablePlaceholder },
      variables: [{ key: 'body:$', path: [], expression: { kind: 'literal', value } }],
      fetchRequest: async (_url, request) => { requests++; sentBody = request.body; return response(); } });
    assert.equal(requests, 1);
    assert.equal(typeof sentBody, 'string');
    assert.deepEqual(JSON.parse(sentBody), value);
  }
});

Then("credential approval fingerprints bind complete immutable operation definitions", async () => {
  const operation = baseOperation();
  operation.responseExample = undefined;
  operation.bodySchema = { type: "object", additionalProperties: true, properties: { z: { type: "number", minimum: 0 }, a: { type: "null" } } };
  const descriptor = await approvedOperation(operation, "https://api.example.test/v1/");
  const reordered = Object.fromEntries(Object.entries(operation).reverse());
  assert.deepEqual(descriptor, await approvedOperation(reordered, "https://api.example.test:443/v1"));
  assert.equal(descriptor.fingerprint.length, 64);
  assert.ok(Object.isFrozen(descriptor.operation.bodySchema.properties));
  operation.name = "Changed later";
  assert.equal(descriptor.operation.name, "Read");
  assert.throws(() => { descriptor.operation.path = "/changed"; }, TypeError);
  assert.equal(canonicalPolicyValue(Object.assign(Object.create(null), { z: 1, a: null })), '{"a":null,"z":1}');
  assert.deepEqual(await validateApprovedOperation(descriptor), descriptor);
});

Then(/^credential destination (.+) is rejected$/, async source => {
  await assert.rejects(() => approvedOperation(baseOperation(), JSON.parse(source)), denied);
});
Then("credential destination {string} normalizes to {string}", async (origin, expected) => {
  await withApplicationOrigin("http://localhost:5173", async () => {
    assert.equal(normalizeCredentialOrigin(origin), expected);
    assert.equal((await approvedOperation(baseOperation(), origin)).origin, expected);
  });
});
Then("application origin {string} {word} cleartext credential destination {string}", async (application, outcome, destination) => {
  await withApplicationOrigin(application === "absent" ? undefined : application, async () => {
    if (outcome === "allows") assert.equal((await approvedOperation(baseOperation(), destination)).origin, destination);
    else await assert.rejects(() => approvedOperation(baseOperation(), destination), denied);
  });
});

Then("invalid approval case {string} fails closed", async name => {
  const operation = baseOperation();
  const mutations = {
    "unknown method": () => { operation.method = "TRACE"; },
    "blank identity": () => { operation.id = " "; },
    "missing fields": () => { operation.fields = null; },
    "unsafe operation path": () => { operation.path = "//elsewhere.test"; },
    "invalid security container": () => { operation.security = {}; },
    "invalid alternative": () => { operation.security = [null]; },
    "missing security scheme": () => { operation.security = [[null]]; },
    "duplicate security name": () => { operation.security = [[bearer, bearer]]; },
    "duplicate credential header": () => { operation.security = [[key, { ...key, name: "Other" }]]; },
    "unsupported security kind": () => { operation.security = [[{ ...bearer, kind: "oauth2" }]]; },
    "inconsistent security name": () => { operation.security = [[key], [{ ...key, header: "X-Other" }]]; },
    "changed bearer placement": () => { operation.security = [[{ ...bearer, header: "X-Bearer" }]]; },
    "forbidden API key header": () => { operation.security = [[{ ...key, header: "Cookie" }]]; },
    "duplicate credential query": () => { operation.security = [[queryKey, { ...queryKey, name: "Other" }]]; },
    "ambiguous key placement": () => { operation.security = [[{ ...queryKey, header: "X-Key" }]]; },
    "changed bearer to query": () => { operation.security = [[{ name: "Bearer", kind: "bearer", query: "api_key" }]]; },
    "non-JSON metadata": () => { operation.responseExample = new Date(); },
    "accessor metadata": () => { Object.defineProperty(operation, "responseExample", { enumerable: true, get() { assert.fail("Approval must not invoke accessors"); } }); },
    "symbol metadata": () => { operation[Symbol("hidden")] = "unsafe"; },
    "excessive metadata nesting": () => { let nested = null; for (let i = 0; i < 42; i++) nested = { nested }; operation.responseExample = nested; },
  };
  if (mutations[name]) {
    mutations[name]();
    await assert.rejects(() => approvedOperation(operation, "https://api.example.test"), denied);
  } else {
    const descriptor = structuredClone((await fixture()).descriptor);
    if (name === "changed stored fingerprint") descriptor.fingerprint = "forged";
    if (name === "changed stored origin") descriptor.origin += "/changed";
    if (name === "extra descriptor properties") descriptor.extra = "ignored";
    await assert.rejects(() => validateApprovedOperation(descriptor), denied);
  }
});

Then("credential bindings reject operation drift in {string} before dispatch", async part => {
  const base = baseOperation();
  if (["query name", "key placement"].includes(part)) base.security = [[{ ...queryKey, name: "Bearer" }]];
  const state = await fixture(base);
  state.credentials[0].kind = "secret";
  const operation = structuredClone(state.descriptor.operation);
  let origin = state.descriptor.origin;
  if (part === "origin") origin = "https://different.example.test/v1";
  if (part === "base path") origin += "/new";
  if (part === "method") operation.method = "POST";
  if (part === "path") operation.path = "/admin";
  if (part === "fields") operation.fields.push(field("query", "extra"));
  if (part === "response") operation.responseMediaType = "text/plain";
  if (part === "header") operation.security = [[{ ...key, name: "Bearer" }]];
  if (part === "query name") operation.security = [[{ name: "Bearer", kind: "apiKey", query: "another_key" }]];
  if (part === "key placement") operation.security = [[{ name: "Bearer", kind: "apiKey", header: "api_key" }]];
  state.descriptor = await approvedOperation(operation, origin);
  let calls = 0;
  await assert.rejects(() => execute(state, { fetchRequest: async () => { calls++; return response(); } }), denied);
  assert.equal(calls, 0);
});

Then("selected alternatives use selected credentials without destination approval", async () => {
  const operation = baseOperation();
  operation.fields = [field("path", "id", { required: true }), field("query", "tags", { type: "array", schema: { type: "array", items: { type: "string" } } })];
  operation.path = "/items/{id}";
  operation.security = [[bearer, key], [key]];
  const state = await fixture(operation);
  state.credentials.push({ id: "credential-two", label: "Second", kind: "apiKey", value: "second-secret",
    grants: [{ id: "grant-two", scheme: "Key", descriptor: state.descriptor }] });
  state.binding.credentials.Key = "credential-two";
  const seen = [];
  const fetchRequest = async (url, init) => { seen.push({ url, init }); return response(); };
  await execute(state, { values: { "path:id": "42", "query:tags": '["a","b"]' }, fetchRequest });
  assert.equal(seen[0].url, "https://api.example.test/v1/items/42?tags=a&tags=b");
  assert.equal(seen[0].init.headers.get("authorization"), `Bearer ${canary}`);
  assert.equal(seen[0].init.headers.get("x-api-key"), "second-secret");
  state.binding = { ...state.binding, alternative: 1, credentials: { Key: "credential-two" } };
  await execute(state, { values: { "path:id": "43" }, fetchRequest });
  assert.equal(seen[1].init.headers.get("authorization"), null);
  assert.equal(seen[1].init.headers.get("x-api-key"), "second-secret");
  assert.equal(seen[0].init.redirect, "error");
  assert.equal(seen[0].init.credentials, "omit");
  assert.equal(seen[0].init.cache, "no-store");
  assert.equal(seen[0].init.referrerPolicy, "no-referrer");
  state.credentials.forEach(credential => { credential.kind = "secret"; });
  state.binding = { ...state.binding, alternative: 0, credentials: { Bearer: "credential-one", Key: "credential-two" } };
  await execute(state, { values: { "path:id": "44" }, fetchRequest });
  assert.equal(seen[2].init.headers.get("authorization"), `Bearer ${canary}`);
  assert.equal(seen[2].init.headers.get("x-api-key"), "second-secret");
  state.credentials[1].grants = [];
  state.credentials[0].grants = [];
  await execute(state, { values: { "path:id": "45" }, fetchRequest });
  assert.equal(seen.length, 4);
});

Then("credential binding case {string} fails before dispatch", async name => {
  const operation = baseOperation();
  if (name === "anonymous alternative") operation.security = [[], [bearer]];
  if (name === "no security") delete operation.security;
  if (name === "public auth collision") operation.fields = [field("header", "aUtHoRiZaTiOn")];
  if (name === "public alternate collision") { operation.security.push([key]); operation.fields = [field("header", "x-api-key")]; }
  if (name === "public query collision") {
    operation.security = [[bearer, queryKey]];
    operation.fields = [field("query", "api_key")];
  }
  if (name === "public alternate query collision") {
    operation.security.push([queryKey]); operation.fields = [field("query", "api_key")];
  }
  if (name === "duplicate public headers") operation.fields = [field("header", "X-Public"), field("header", "x-public")];
  if (name === "unsupported public header") operation.fields = [field("header", "bad header")];
  if (["path value traversal", "path value separator", "unresolved path"].includes(name)) {
    operation.path = "/items/{id}"; operation.fields = [field("path", "id")];
  }
  const state = await fixture(operation);
  if (name === "public query collision") {
    state.credentials.push({ id: "query-key", label: "Query key", kind: "apiKey", value: "query-canary" });
    state.binding.credentials.Query = "query-key";
  }
  const values = Object.fromEntries(operation.fields.map(value => [value.key, "public"]));
  const mutations = {
    "wrong fingerprint": () => { state.binding.fingerprint = "wrong"; },
    "missing alternative": () => { state.binding.alternative = 4; },
    "fractional alternative": () => { state.binding.alternative = 0.5; },
    "missing bindings": () => { state.binding.credentials = null; },
    "extra binding": () => { state.binding.credentials.extra = "credential-one"; },
    "wrong scheme": () => { state.binding.credentials = { Unknown: "credential-one" }; },
    "missing credential": () => { state.credentials = []; },
    "duplicate credential": () => { state.credentials.push(structuredClone(state.credentials[0])); },
    "wrong credential kind": () => { state.credentials[0].kind = "apiKey"; },
    "wrong grant scheme": () => { state.credentials[0].grants[0].scheme = "Other"; },
    "wrong grant descriptor": () => { state.credentials[0].grants[0].descriptor = { ...state.descriptor, fingerprint: "wrong" }; },
    "empty credential": () => { state.credentials[0].value = ""; },
    "padded credential": () => { state.credentials[0].value = " padded "; },
    "newline credential": () => { state.credentials[0].value = "bad\nvalue"; },
    "oversized credential": () => { state.credentials[0].value = "a".repeat(vaultLimits.secretBytes + 1); },
    "path value traversal": () => { values["path:id"] = ".."; },
    "path value separator": () => { values["path:id"] = "a/b"; },
    "unresolved path": () => { delete values["path:id"]; },
  };
  mutations[name]?.();
  let calls = 0;
  await assert.rejects(() => execute(state, { values, fetchRequest: async () => { calls++; return response(); } }), error =>
    error instanceof VaultError && ["PERMISSION", "INVALID"].includes(error.code));
  assert.equal(calls, 0);
});

Then("credential execution preserves sanitized public field validation errors", async () => {
  const operation = baseOperation();
  operation.fields = [field("query", `count-${canary}`, { type: "integer", required: true })];
  const state = await fixture(operation);
  await assert.rejects(() => execute(state), error => {
    assert.ok(error instanceof InputValidationError);
    assert.match(error.message, /field is required/);
    assert.doesNotMatch(error.message + error.fieldKey, new RegExp(canary));
    return true;
  });
});

Then("credentialed requests distinguish omitted null and literal null inputs before dispatch", async () => {
  const operation = extractOperations({ openapi: "3.1.0", components: {
    securitySchemes: { Bearer: { type: "http", scheme: "bearer" } }
  }, security: [{ Bearer: [] }], paths: { "/items": { post: { requestBody: { required: true,
    content: { "application/json": { schema: { type: "object", required: ["value"], properties: {
      value: { type: ["string", "null"] }, literal: { type: "string", nullable: true },
      omitted: { type: "string", nullable: true }, strict: { type: "string" },
      choice: { type: ["string", "null"], enum: ["yes"] }
    } } } } } } } } }, "nullable")[0];
  const state = await fixture(operation);
  const requests = [];
  const fetchRequest = async (_url, options) => { requests.push(options); return response(); };
  const values = { "body:value": null, "body:literal": "null", "body:omitted": undefined };
  const result = await execute(state, { values, fetchRequest });
  assert.deepEqual(result.request.body, { value: null, literal: "null" });
  assert.equal(requests[0].body, '{"value":null,"literal":"null"}');
  assert.equal(requests[0].headers.get("Authorization"), `Bearer ${canary}`);
  assert.equal(requests[0].headers.get("Content-Type"), "application/json");
  for (const invalid of [{ "body:value": undefined }, { ...values, "body:strict": null }, { ...values, "body:choice": null }])
    await assert.rejects(() => execute(state, { values: invalid, fetchRequest }), InputValidationError);
  for (const invalid of [null, [], new Date(), "text", { "body:value": 1 }, { "body:value": true }, { "body:value": [] }, { "body:value": {} }])
    await assert.rejects(() => execute(state, { values: invalid, fetchRequest }), error => error instanceof VaultError && error.code === "INVALID");
  assert.equal(requests.length, 1);
});

Then("credentialed requests preserve {string} body serialization", async media => {
  const operation = baseOperation();
  operation.method = "POST"; operation.bodyRequired = true; operation.bodyMediaType = media;
  operation.fields = [field("body", "message")];
  if (media === "text/plain") { operation.bodyValue = true; operation.fields = [field("body", "$", { required: true })]; }
  const state = await fixture(operation);
  let init;
  const result = await execute(state, { values: { "body:message": "hello", "body:$": "hello" }, fetchRequest: async (_url, options) => { init = options; return response(); } });
  if (media === "application/json") assert.equal(init.body, '{"message":"hello"}');
  if (media === "text/plain") assert.equal(init.body, "hello");
  if (media === "application/x-www-form-urlencoded") assert.equal(init.body.toString(), "message=hello");
  if (media === "multipart/form-data") { assert.ok(init.body instanceof FormData); assert.equal(init.body.get("message"), "hello"); }
  assert.equal(init.headers.get("content-type"), media === "multipart/form-data" ? null : media);
  assert.equal(result.request.headers, undefined);
});

Then("credential echoes split across chunks are removed from previews and results", async () => {
  const operation = baseOperation();
  operation.fields = [field("query", "public"), field("header", "X-Public")];
  const state = await fixture(operation);
  const chunks = [`before ${canary.slice(0, 7)}`, `${canary.slice(7)} after`];
  const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
  const result = await execute(state, { values: { "query:public": canary, "header:X-Public": "ordinary" }, fetchRequest: async () => new Response(body, {
    statusText: `OK ${canary}`, headers: { "Content-Type": "text/plain", "X-Echo": canary, Authorization: `Bearer ${canary}`, "Set-Cookie": "sensitive=remote", "WWW-Authenticate": "challenge" },
  }) });
  assert.equal(result.response.redacted, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
  assert.equal(result.response.headers.authorization, undefined);
  assert.equal(result.response.headers["set-cookie"], undefined);
  assert.equal(result.response.headers["www-authenticate"], undefined);
  assert.equal(result.request.headers.Authorization, undefined);
  assert.equal(result.request.headers["X-Public"], "ordinary");
});

Then("credentialed JSON responses sanitize nested strings and keys", async () => {
  const state = await fixture();
  const result = await execute(state, { fetchRequest: async () => new Response(JSON.stringify({ [canary]: [canary, { nested: canary, count: 2, valid: true, nil: null }] }), { headers: { "Content-Type": "application/json" } }) });
  assert.equal(result.response.redacted, true);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
});

Then("credential redaction removes marker values and newly joined secret fragments", async () => {
  const state = await fixture();
  state.credentials[0].value = "[REDACTED]";
  state.credentials.push({ id: "unselected", label: "Known", kind: "apiKey", value: "xy", grants: [] });
  const result = await execute(state, { fetchRequest: async () => new Response('x[REDACTED]y', { headers: { "Content-Type": "text/plain" } }) });
  assert.equal(result.response.body, "");
  assert.equal(result.response.redacted, true);
});

Then("credentialed response case {string} preserves safe HTTP semantics", async name => {
  const operation = baseOperation();
  let status = 200, body = '{"value":1}', media = "application/json";
  if (name === "plain text success") { body = "hello"; media = "text/plain"; }
  if (name === "declared JSON success") { operation.responseMediaType = "application/json"; media = "text/plain"; }
  if (name === "no content") { status = 204; body = null; }
  if (name === "reset content") { status = 205; body = null; }
  if (name === "HEAD") operation.method = "HEAD";
  if (name === "empty OPTIONS") { operation.method = "OPTIONS"; body = ""; }
  if (name === "bodyless text") { body = null; media = "text/plain"; }
  if (name.includes("HTTP error") || name === "malformed error JSON") { status = 400; body = JSON.stringify({ error: canary }); }
  if (name === "text HTTP error") { body = canary; media = "text/plain"; }
  if (name.startsWith("malformed")) body = `invalid ${canary}`;
  const state = await fixture(operation);
  const run = () => execute(state, { fetchRequest: async () => {
    const result = new Response(body, { status, headers: { "Content-Type": media } });
    if (name.startsWith("untyped")) result.headers.delete("Content-Type");
    return result;
  } });
  if (status === 400 || name === "malformed success JSON") {
    await assert.rejects(run, error => {
      assert.ok(error instanceof CredentialResponseError);
      assert.equal(error.response.status, status);
      assert.equal(error.response.redacted, true);
      assert.doesNotMatch(error.message + JSON.stringify(error.response), new RegExp(canary));
      return true;
    });
  } else {
    const result = await run();
    assert.equal(result.response.status, status);
    assert.equal(result.response.redacted, undefined);
    if (["no content", "reset content", "HEAD", "empty OPTIONS"].includes(name)) assert.equal(result.response.body, null);
    else if (name === "plain text success") assert.equal(result.response.body, "hello");
    else if (name === "bodyless text") assert.equal(result.response.body, "");
    else if (name === "declared JSON success") assert.equal(result.response.body, body, "Actual text cannot be forced through a declared JSON decoder.");
    else assert.deepEqual(result.response.body, { value: 1 });
  }
});

Then("credential execution stops {string} without accepting stale results", async name => {
  const state = await fixture();
  if (name === "timed out") {
    await assertRequestDeadline(fetchRequest => execute(state, { assertCurrent() {}, fetchRequest }), error => {
      assert.ok(error instanceof VaultError); assert.equal(error.code, "NETWORK");
      assert.doesNotMatch(error.message, new RegExp(canary)); assert.equal(error.cause, undefined);
      return true;
    });
    return;
  }
  const controller = new AbortController();
  let fetchCalls = 0, currentCalls = 0;
  if (name === "before dispatch") controller.abort();
  await assert.rejects(() => execute(state, { signal: controller.signal,
    assertCurrent() { currentCalls++; if (name === "policy before send" || name === "policy before accept" && currentCalls === 2) throw new VaultError("PERMISSION"); },
    fetchRequest: async () => {
      fetchCalls++;
      if (name === "while fetching") { controller.abort(); return response(); }
      if (name === "transport failure") throw new Error(canary);
      if (name === "redirected response") { const value = response(); Object.defineProperty(value, "redirected", { value: true }); return value; }
      if (name === "response read failure") return new Response(new ReadableStream({ start(stream) { stream.error(new Error(canary)); } }));
      if (name === "while streaming") return new Response(new ReadableStream({ pull() { controller.abort(); } }));
      return response();
    },
  }), error => {
    assert.ok(error instanceof VaultError);
    assert.equal(error.code, name.startsWith("policy") ? "PERMISSION" : ["before dispatch", "while fetching", "while streaming"].includes(name) ? "CANCELLED" : "NETWORK");
    assert.doesNotMatch(error.message, new RegExp(canary));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(fetchCalls, ["before dispatch", "policy before send"].includes(name) ? 0 : 1);
});

Then("credential response limit handles {string} before fully buffering", async name => {
  const state = await fixture();
  let emitted = 0, cancelled = false;
  const chunk = name === "multibyte decoded content" ? new TextEncoder().encode("€".repeat(32 * 1024)) : new Uint8Array(64 * 1024);
  const stream = new ReadableStream({ pull(controller) { emitted += chunk.byteLength; controller.enqueue(chunk); }, cancel() { cancelled = true; } });
  const headers = { "Content-Type": "text/plain" };
  if (name === "false Content-Length") headers["Content-Length"] = "1";
  await assert.rejects(() => execute(state, { fetchRequest: async () => new Response(stream, { headers }) }), error => error instanceof VaultError && error.code === "LIMIT");
  assert.equal(cancelled, true);
  assert.ok(emitted <= vaultLimits.responseBytes + chunk.byteLength * 2);
});

Then("real credentialed requests reject {string} redirects before a second dispatch", async kind => {
  const received = [];
  const target = createServer((_req, res) => { received.push("target"); res.end("unexpected"); });
  const source = createServer((req, res) => {
    received.push({ path: req.url, authorization: req.headers.authorization });
    res.writeHead(302, { Location: kind === "same-origin" ? "/redirected" : `http://127.0.0.1:${target.address().port}/redirected` }); res.end();
  });
  await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
  await new Promise(resolve => source.listen(0, "127.0.0.1", resolve));
  try {
    await withApplicationOrigin(`http://127.0.0.1:${source.address().port}`, async () => {
      const state = await fixture(baseOperation(), `http://127.0.0.1:${source.address().port}`);
      await assert.rejects(() => executeCredentialed(state.descriptor, {}, state.binding, state.credentials, { assertCurrent() {} }), error => error instanceof VaultError && error.code === "NETWORK");
      assert.deepEqual(received, [{ path: "/items", authorization: `Bearer ${canary}` }]);
    });
  } finally {
    await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => target.close(resolve))]);
  }
});

Then('vault variable execution rejects missing entries malformed slots and stale sessions before sending', async () => {
  const id = crypto.randomUUID(), operation = baseOperation();
  operation.security = [];
  operation.fields = [field('query', 'value')];
  const descriptor = await approvedOperation(operation, 'https://api.example.test');
  const binding = { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint };
  const credentials = [{ id, label: 'hidden', value: canary, kind: 'secret', grants: [] }];
  const variables = [{ key: 'query:value', path: [], credentialId: id }];
  const values = { 'query:value': '[Vault variable]' };
  let sent = 0;
  const options = { variables, assertCurrent: () => {}, fetchRequest: async () => { sent++; return response(); } };
  for (const patch of [
    { credentials: [] }, { variables: [...variables, ...variables] }, { variables: [{ ...variables[0], credentialId: 'invalid' }] },
    { variables: [{ ...variables[0], key: 'missing' }] }, { variables: [{ ...variables[0], path: ['missing'] }] },
    { values: { 'query:value': 'public value' } }, { assertCurrent: () => { throw new VaultError('LOCKED'); } },
    { binding: { ...binding, fingerprint: '0'.repeat(64) } },
  ]) {
    await assert.rejects(executeCredentialed(descriptor, patch.values ?? values, patch.binding ?? binding,
      patch.credentials ?? credentials, { ...options, ...patch }), error => error instanceof VaultError);
  }
  assert.equal(sent, 0);
  const echoed = await executeCredentialed(descriptor, values, binding, credentials,
    { ...options, fetchRequest: async () => Response.json({ echoed: canary }) });
  assert.equal(echoed.response.redacted, true); assert.ok(!JSON.stringify(echoed).includes(canary));
});

Then('vault variables resolve nested object and array leaves without changing public inputs', async () => {
  const id = crypto.randomUUID(), operation = baseOperation(); operation.method = 'POST'; operation.security = [];
  operation.fields = [field('body', 'payload', { type: 'object', schema: { type: 'object', properties: { token: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } } } })];
  const descriptor = await approvedOperation(operation, 'https://api.example.test');
  const binding = { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint };
  const input = { 'body:payload': JSON.stringify({ token: '[Vault variable]', values: ['public', '[Vault variable]'] }) };
  const before = structuredClone(input);
  const output = await executeCredentialed(descriptor, input, binding, [{ id, label: 'hidden', value: canary, kind: 'secret', grants: [] }], {
    variables: [{ key: 'body:payload', path: ['token'], credentialId: id }, { key: 'body:payload', path: ['values', '1'], credentialId: id }],
    assertCurrent: () => {}, fetchRequest: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { payload: { token: canary, values: ['public', canary] } });
      return response();
    },
  });
  assert.deepEqual(input, before); assert.ok(!JSON.stringify(output).includes(canary));
  assert.equal(output.request.body.payload.values[0], 'public');
});


Then('vault variables respect security alternatives additional properties and decrypted schema constraints', async () => {
  const id = crypto.randomUUID(), credentials = [{ id, label: 'hidden', value: canary, kind: 'secret', grants: [] }];
  for (const security of [undefined, [], [[bearer]], [[], [bearer]]]) {
    const operation = baseOperation(); operation.security = security;
    operation.method = 'POST'; operation.fields = [];
    operation.bodySchema = { type: 'object', additionalProperties: { type: 'string', minLength: 2 } };
    const descriptor = await approvedOperation(operation, 'https://api.example.test');
    const binding = { alternative: 0, credentials: security?.[0]?.length ? { Bearer: id } : {}, fingerprint: descriptor.fingerprint };
    const options = { variables: [{ key: 'body:dynamic', path: [], credentialId: id }], assertCurrent: () => {}, fetchRequest: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { dynamic: canary });
      assert.equal(new Headers(options.headers).get('Authorization'), security?.[0]?.length ? `Bearer ${canary}` : null);
      return response();
    } };
    const values = { 'body:dynamic': '[Vault variable]' };
    assert.ok(!JSON.stringify(await executeCredentialed(descriptor, values, binding, credentials, options)).includes(canary));
    const constrained = await approvedOperation({ ...operation, bodySchema: { ...operation.bodySchema, additionalProperties: false } }, descriptor.origin);
    await assert.rejects(executeCredentialed(constrained, values, { ...binding, fingerprint: constrained.fingerprint }, credentials, options), denied);
    const invalid = await approvedOperation({ ...operation, bodySchema: { ...operation.bodySchema, additionalProperties: { type: 'integer' } } }, descriptor.origin);
    await assert.rejects(executeCredentialed(invalid, values, { ...binding, fingerprint: invalid.fingerprint }, credentials, options), error => error instanceof VaultError);
  }
});


Then('vault variable path previews remove encoded values and invalid structured slots never dispatch', async () => {
  const id = crypto.randomUUID(), secret = 'private=value&with+reserved:characters';
  const credentials = [{ id, label: 'hidden', value: secret, kind: 'secret', grants: [] }];
  const operation = { ...baseOperation(), security: [], path: '/items/{token}', fields: [field('path', 'token', { required: true })] };
  const descriptor = await approvedOperation(operation, 'https://api.example.test');
  const binding = { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint };
  const output = await executeCredentialed(descriptor, { 'path:token': '[Vault variable]' }, binding, credentials, {
    variables: [{ key: 'path:token', path: [], credentialId: id }], assertCurrent: () => {}, fetchRequest: async url => {
      assert.equal(new URL(url).pathname, `/items/${encodeURIComponent(secret)}`); return response();
    },
  });
  assert.ok(!JSON.stringify(output).includes(secret)); assert.ok(!JSON.stringify(output).includes(encodeURIComponent(secret)));
  const nested = await approvedOperation({ ...operation, path: '/items', fields: [field('body', 'payload', { type: 'object' })] }, descriptor.origin);
  let sent = 0;
  const options = { assertCurrent: () => {}, fetchRequest: async () => { sent++; return response(); } };
  for (const [value, path] of [
    ['invalid JSON', ['token']], ['null', ['token']], ['{}', ['missing', 'token']],
    ['{"nested":null}', ['nested', 'token']], ['{"nested":"public"}', ['nested', 'token']],
    ['{"nested":{}}', ['nested', 'missing']], ['{"token":"public"}', ['token']],
  ]) await assert.rejects(executeCredentialed(nested, { 'body:payload': value }, { ...binding, fingerprint: nested.fingerprint }, credentials,
    { ...options, variables: [{ key: 'body:payload', path, credentialId: id }] }), error => error instanceof VaultError);
  assert.equal(sent, 0);
});

Then("query credentials reach only the approved URL and stay out of previews and echoed responses", async () => {
  const operation = baseOperation();
  operation.path = "/fred/series/observations";
  operation.fields = [field("query", "series_id", { required: true }), field("query", "tags", { type: "array", schema: { type: "array", items: { type: "string" } } })];
  operation.security = [[bearer, queryKey], [bearer]];
  const state = await fixture(operation, "https://api.example.test");
  const secret = "query-CANARY +&?=/17";
  const encoded = encodeURIComponent(secret);
  const formEncoded = new URLSearchParams({ v: secret }).toString().slice(2);
  state.credentials.push({ id: "query-key", label: "FRED", kind: "apiKey", value: secret });
  state.binding.credentials.Query = "query-key";
  const values = { "query:series_id": "GNPCA", "query:tags": '["a","b"]' };
  const before = structuredClone({ values, descriptor: state.descriptor, binding: state.binding, credentials: state.credentials });
  const seen = [];
  const result = await execute(state, { values, fetchRequest: async (url, init) => {
    seen.push({ url: new URL(url), init });
    return new Response(JSON.stringify({ [secret]: secret, raw: secret, encoded, formEncoded, request: url, series_id: "GNPCA" }),
      { headers: { "Content-Type": "application/json", "X-Echo": `${encoded} ${formEncoded}` } });
  } });
  assert.deepEqual({ values, descriptor: state.descriptor, binding: state.binding, credentials: state.credentials }, before);
  assert.deepEqual(seen[0].url.searchParams.getAll("api_key"), [secret]);
  assert.deepEqual(seen[0].url.searchParams.getAll("tags"), ["a", "b"]);
  assert.equal(seen[0].url.origin, "https://api.example.test");
  assert.equal(seen[0].url.pathname, operation.path);
  assert.equal(seen[0].init.headers.get("authorization"), `Bearer ${canary}`);
  assert.equal(seen[0].init.headers.has("api_key"), false);
  assert.equal(seen[0].init.redirect, "error");
  assert.equal(seen[0].init.credentials, "omit");
  assert.equal(seen[0].init.referrerPolicy, "no-referrer");
  assert.equal(seen[0].init.cache, "no-store");
  assert.deepEqual(result.request.query, { series_id: "GNPCA", tags: ["a", "b"] });
  assert.equal(result.response.body.series_id, "GNPCA");
  assert.equal(result.response.redacted, true);
  for (const value of [secret, encoded, formEncoded, canary]) assert.ok(!JSON.stringify(result).includes(value));
  state.binding = { ...state.binding, alternative: 1, credentials: { Bearer: "credential-one" } };
  await execute(state, { values, fetchRequest: async (url, init) => { seen.push({ url: new URL(url), init }); return response(); } });
  assert.equal(seen[1].url.searchParams.has("api_key"), false, "Unselected alternatives never inject query credentials.");
  state.binding = before.binding;
  const edited = structuredClone(operation);
  edited.security[0][1].query = "other_key";
  state.descriptor = await approvedOperation(edited, state.descriptor.origin);
  let requests = 0;
  await assert.rejects(() => execute(state, { values, fetchRequest: async () => { requests++; return response(); } }), denied);
  assert.equal(requests, 0, "Changing a query-key destination invalidates the saved binding.");
});
