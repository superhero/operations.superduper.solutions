// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { applySchemaPatches, dockerHttpContracts } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { operationInsertionBlockReason } from './lib/operation-capabilities.ts';
import { bindDockerHttp, dockerHttpEndpoint, dockerHttpSourceSha256, dockerProgressIds } from './lib/docker-http.ts';
import { dockerReadOperations, dockerNativeOperationId, dockerNativeAttachOperationId, dockerAttachParams, dockerReadOperationIds } from './lib/docker-native-contract.ts';
import { prepareDockerReadRequest } from './lib/docker-operation-input.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { readWorkflowResponseBody } from './lib/workflow-response-body.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { approvedDockerOperation } from './lib/secrets/docker-policy.ts';
import { credentialResultProfile, privateResultInputKeys } from './lib/credential-results.ts';
import { prepareCredentialResults } from './lib/secrets/credential-results.ts';
import { assertDockerPrivateBindings } from './lib/secrets/docker-http.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { DockerCompanionBroker } from './lib/secrets/docker-companion.ts';
import { dockerNativeFixture } from '../tests/docker-native.fixture.mjs';
import { dockerVaultFixture } from '../tests/docker-vault.fixture.mjs';
import { dockerReference } from './lib/secrets/docker-config.ts';
import { privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';

const origin = 'https://docker.synthetic.example.test/v1.57';
const denied = error => error?.code === 'PERMISSION';
const binding = descriptor => ({ alternative: 0, fingerprint: descriptor.fingerprint, credentials: {} });
async function models() {
  const document = structuredClone(await readServiceSchema('docker'));
  document.servers[0].variables.docker_endpoint.default = origin;
  return { document, operations: inspectServiceSchema(document, 'docker').operations };
}
async function model(id) {
  const { document, operations } = await models(), operation = operations.find(op => op.id === 'docker:' + id);
  assert.ok(operation && !operation.unavailableReason, `${id}: ${operation?.unavailableReason}`);
  return { document, operation, descriptor: operation.dockerNative ? undefined : await approvedOperation(operation, origin) };
}
const decode = (operation, text, type = 'application/json') => readWorkflowResponseBody(new Response(text, { headers: { 'Content-Type': type } }), operation, 'GET', new AbortController().signal);

Then('Docker HTTP source corrections preserve all native routes and refuse source drift', async () => {
  const raw = await readServiceSchemaUpstream('docker'), before = JSON.stringify(raw);
  assert.equal(createHash('sha256').update(before).digest('hex'), dockerHttpSourceSha256);
  const fixed = applySchemaPatches(raw, [dockerHttpContracts]); assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(fixed['x-upstream-docker-http'].servers, raw.servers);
  const { document, operations } = await models(); assert.equal(operations.length, 108);
  for (const operation of operations) {
    assert.equal(operationInsertionBlockReason(operation), undefined, `${operation.id}: ${operation.unavailableReason}`);
    assert.equal(operationServerUrl(document, operation), origin);
    assert.equal(raw.paths[operation.path][operation.method.toLowerCase()].operationId, operation.id.slice(7));
  }
  for (const mutate of [d => { d.info.version = 'unreviewed'; }, d => { d.paths['/unknown'] = { get: { operationId: 'unknown' } }; },
    d => { d.paths['/auth'].post.responses['200'].content = {}; }, d => { d.servers = [{ url: 'https://unexpected.test' }]; }]) {
    const changed = structuredClone(raw); mutate(changed); const prior = JSON.stringify(changed);
    assert.throws(() => bindDockerHttp(changed), /reviewed native contract/); assert.equal(JSON.stringify(changed), prior);
  }
  for (const endpoint of ['https://docker.test/v1.57', 'http://127.0.0.1:2375/v1.57', 'https://docker.test/proxy/v1.57/']) assert.ok(dockerHttpEndpoint(endpoint));
  for (const endpoint of ['https://u:p@docker.test/v1.57', 'https://docker.test/v1.57?key=a', 'https://docker.test/v1.57#x',
    'https://docker.test/v1.56', 'https://docker.test/%2f/v1.57', 'https://docker.test/a/../v1.57']) assert.throws(() => dockerHttpEndpoint(endpoint));
  assert.throws(() => dockerReadOperations(['docker:ContainerDelete']));
  assert.throws(() => dockerReadOperations([dockerNativeOperationId, dockerNativeOperationId]));
  assert.deepEqual(dockerReadOperations(), [dockerNativeOperationId]);
  const image = await model('ImageCreate'), request = prepareRequest(image.operation, { 'query:fromImage': 'synthetic:latest' });
  assert.equal(request.body, undefined); assert.equal(request.query.fromImage, 'synthetic:latest');
});

Then('Docker HTTP progress and events decode bounded JSON lines including legacy media labels', async () => {
  for (const id of dockerProgressIds) {
    const { operation } = await model(id), expected = [{ status: 'Downloading Ω', id: 'layer' }, { aux: { ID: 'sha256:synthetic' } }];
    for (const type of ['application/json', 'application/x-ndjson']) {
      const result = await decode(operation, expected.map(value => JSON.stringify(value)).join('\r\n'), type);
      assert.deepEqual(result.body, { messages: expected }, id); assert.equal(result.stream.events, 2);
      assert.equal(result.transportMediaType, type); assert.equal(result.mediaType, 'application/json');
    }
    assert.deepEqual((await decode(operation, '')).body, { messages: [] });
    await assert.rejects(decode(operation, '{"status":"started"}\n{"errorDetail":{"message":"synthetic failure"},"error":"synthetic failure"}\n'), error => error.code === 'PROVIDER');
    await assert.rejects(decode(operation, '{"status":'), error => error.code === 'FRAME');
    await assert.rejects(decode(operation, '[]\n'), error => error.code === 'FRAME');
  }
  const { operation } = await model('SystemEvents'), event = { Type: 'container', Action: 'start', time: 1, Actor: { ID: 'synthetic' } };
  const result = await decode(operation, JSON.stringify(event) + '\n'); assert.deepEqual(result.body, event); assert.equal(result.stream.events, 1);
  const ordinary = await model('SystemInfo'); assert.deepEqual((await decode(ordinary.operation, '{"ID":"synthetic"}')).body, { ID: 'synthetic' });
});

Then('Docker HTTP registry and signing inputs require private bindings and redact decoded values', async () => {
  const username = 'SYNTHETIC_REGISTRY_USERNAME_012', password = 'SYNTHETIC_REGISTRY_PASSWORD_012';
  const auth = Buffer.from(JSON.stringify({ username, password, auth: Buffer.from(username + ':' + password).toString('base64') })).toString('base64url');
  const record = { id: crypto.randomUUID(), label: 'Registry fixture', value: auth, kind: 'secret', grants: [] };
  for (const id of ['ImageBuild', 'ImageCreate', 'ImagePush', 'PluginPull', 'PluginPush', 'PluginUpgrade', 'ServiceCreate', 'ServiceUpdate', 'GetPluginPrivileges', 'DistributionInspect', 'ImageSearch']) {
    const { operation, descriptor } = await model(id), key = id === 'ImageBuild' ? 'header:X-Registry-Config' : 'header:X-Registry-Auth';
    assert.ok(privateResultInputKeys(operation).includes(key), id);
    const values = { [key]: vaultVariablePlaceholder };
    for (const field of operation.fields.filter(field => field.required && field.key !== key && (field.location !== 'body' || operation.bodyRequired))) values[field.key] = field.type === 'json'
      ? JSON.stringify(field.schema?.type === 'array' ? [] : {}) : field.type === 'integer' ? '1' : field.type === 'boolean' ? 'false' : 'synthetic';
    if (id === 'ImageCreate') values['query:fromImage'] = 'synthetic:latest';
    if (id === 'ImageBuild') values['body:$'] = JSON.stringify(encodeWorkflowBinary('context.tar', Buffer.from('synthetic tar fixture')));
    let calls = 0;
    const options = { assertCurrent() {}, variables: [{ key, path: [], credentialId: record.id }], fetchRequest: async (_url, init) => {
      calls++; assert.equal(init.headers.get(key.slice(7)), auth); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
      return operation.responseStream ? new Response(JSON.stringify({ status: password, detail: username }) + '\n', { headers: { 'Content-Type': 'application/json' } })
        : Response.json({ message: password, detail: username });
    } };
    const result = await executeCredentialed(descriptor, values, binding(descriptor), [record], options).catch(error => { error.message = id + ': ' + error.message; throw error; });
    assert.equal(calls, 1); noSecrets(result, [auth, username, password]);
    await assert.rejects(executeCredentialed(descriptor, { ...values, [key]: auth }, binding(descriptor), [record], options), denied); assert.equal(calls, 1);
  }
  const { operation } = await model('SwarmUpdate'), raw = { 'body:CAConfig': JSON.stringify({ SigningCAKey: password }) };
  assert.throws(() => assertDockerPrivateBindings(operation, raw, []), denied);
  assertDockerPrivateBindings(operation, { 'body:CAConfig': JSON.stringify({ SigningCAKey: vaultVariablePlaceholder }) },
    [{ key: 'body:CAConfig', path: ['SigningCAKey'], credentialId: record.id }]);
  const original = (await model('PluginPush')).operation, alias = { ...original, fields: original.fields.map(field => field.name === 'X-Registry-Auth'
    ? { ...field, name: 'x-registry-auth', key: 'header:x-registry-auth' } : field) };
  assert.ok(privateResultInputKeys(alias).includes('header:x-registry-auth'));
  const descriptor = await approvedOperation(alias, origin);
  await assert.rejects(executeCredentialed(descriptor, { 'path:name': 'synthetic', 'header:x-registry-auth': auth }, binding(descriptor), [record],
    { assertCurrent() {}, fetchRequest: async () => { assert.fail('A raw header alias reached fetch.'); } }), denied);
});

Then('Docker HTTP registry and swarm results adopt credentials without publishing their raw values', async () => {
  const token = 'SYNTHETIC_DOCKER_IDENTITY_TOKEN_012', previous = globalThis.fetch;
  for (const [id, body, paths] of [
    ['SystemAuth', { Status: 'Login Succeeded', IdentityToken: token }, [['IdentityToken']]],
    ['SwarmInspect', { ID: 'synthetic', JoinTokens: { Worker: token + '_WORKER', Manager: token + '_MANAGER' }, Spec: { CAConfig: { SigningCAKey: token + '_CA' } } }, [['JoinTokens', 'Worker'], ['JoinTokens', 'Manager'], ['Spec', 'CAConfig', 'SigningCAKey']]],
    ['SwarmUnlockkey', { UnlockKey: token + '_UNLOCK' }, [['UnlockKey']]],
  ]) {
    const { operation, descriptor } = await model(id), vault = await privateVault(), secrets = paths.map(path => path.reduce((parent, key) => parent[key], body));
    let calls = 0; globalThis.fetch = async () => { calls++; return Response.json(body); };
    try {
      const result = await vault.session.execute(descriptor, {}, binding(descriptor)); assert.equal(calls, 1); noSecrets(result, secrets);
      for (const [index, path] of paths.entries()) { const reference = path.reduce((parent, key) => parent[key], result.response.body); assert.equal(await vault.session.copyCredential(reference.credentialId), secrets[index]); }
      assert.equal(JSON.stringify(vault.storage.state).includes(token), false);
      await vault.session.lock(); await vault.session.unlock(vault.proof);
      assert.equal((await vault.session.list()).length, paths.length);
    } finally { vault.session.lock(); globalThis.fetch = previous; }
  }
  const { operation } = await model('SystemAuth'), contract = credentialResultProfile(operation);
  for (const body of [{ Status: 'ok' }, { Status: 'ok', IdentityToken: '' }]) assert.equal(prepareCredentialResults(contract, 200, body).values.length, 0);
  assert.equal(prepareCredentialResults(contract, 204, null).complete([]), null);
  for (const body of [{}, { Status: 'ok', IdentityToken: {} }, { Status: 'ok', IdentityToken: '\ud800' }]) assert.throws(() => prepareCredentialResults(contract, 200, body));
  assert.throws(() => prepareCredentialResults(contract, 204, { token }));
  assert.throws(() => prepareCredentialResults(contract, 200, { Status: 'ok', IdentityToken: token }).complete([{ credentialId: {}, label: 'forged' }]));
});

Then('Docker HTTP secret reads reject unexpected private data in JSON or legacy text replies', async () => {
  for (const id of ['SecretInspect', 'SecretList']) {
    const { operation } = await model(id), secret = { ID: 'synthetic', Spec: { Name: 'public-name' } };
    for (const type of ['application/json', 'text/plain']) {
      const body = id === 'SecretList' ? [secret] : secret;
      assert.deepEqual((await decode(operation, JSON.stringify(body), type)).body, body);
      const unsafe = { ...secret, Spec: { ...secret.Spec, Data: 'SYNTHETIC_UNEXPECTED_SECRET' } };
      await assert.rejects(decode(operation, JSON.stringify(id === 'SecretList' ? [unsafe] : unsafe), type));
      await assert.rejects(decode(operation, 'not-json', type));
    }
  }
});

async function attachmentFixture() {
  const f = await dockerNativeFixture({ operations: [...dockerReadOperationIds], operation: dockerNativeAttachOperationId, socketName: 'engine:read?.sock' });
  const broker = new DockerCompanionBroker(f.runtime), guard = async () => {};
  const pair = () => broker.check(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, undefined, guard, undefined, dockerNativeAttachOperationId);
  const read = (identity, params = { id: 'synthetic' }, signal) => broker.read(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, identity, params, guard, signal, dockerNativeAttachOperationId);
  return { f, broker, pair, read, async close() { broker.clear(); await f.close(); } };
}
Then('Docker read only attachment preserves real WebSocket bytes and exact pairing scope', async () => {
  const ordinary = await dockerNativeFixture();
  try { const answer = await ordinary.call('/v1/docker/pair', { profile: 'docker-unix-read-v1', scope: { ...ordinary.scope, operation: dockerNativeAttachOperationId } }); assert.equal(answer.value.error, 'PERMISSION'); assert.equal(ordinary.engineRequests.length, 0); }
  finally { await ordinary.close(); }
  const v = await attachmentFixture();
  try {
    const bytes = [Buffer.from([0, 255, 13, 10]), Buffer.from('output Ω\n')]; v.f.attachment = bytes;
    const pair = await v.pair(), result = await v.read(pair.identity);
    assert.equal(result.status, 101); assert.equal(result.bodyType, 'binary'); assert.deepEqual(Buffer.from(result.body.base64, 'base64'), Buffer.concat(bytes));
    const request = v.f.engineRequests.find(row => row.path.includes('/attach/ws')); assert.ok(request);
    assert.equal(request.authorization, false); assert.equal(request.cookie, false); assert.equal(v.f.stdinMessages, 0);
    const query = new URL(request.path, 'http://fixture').searchParams; assert.equal(query.get('stdin'), 'false'); assert.equal(query.get('logs'), 'true');
    const before = v.f.engineRequests.length, changed = await v.f.call('/v1/docker/read', { profile: 'docker-unix-read-v1', scope: { ...pair.scope, operation: dockerNativeOperationId }, identity: pair.identity, params: {} });
    assert.equal(changed.value.error, 'DOCKER_AUTHORITY'); assert.equal(v.f.engineRequests.length, before);
    const { operation, document } = await model('ContainerAttachWebsocket');
    const scoped = scopeOperationSchema(document, operation.path, operation.method, true).schema;
    await approvedDockerOperation(operation, scoped); await assert.rejects(approvedOperation(operation, origin), denied);
    assert.equal(prepareDockerReadRequest(operation, { 'path:id': '/synthetic' }).query.id, 'synthetic');
    assert.throws(() => prepareDockerReadRequest(operation, { 'path:id': 'synthetic', 'query:stdin': 'true' }));
  } finally { await v.close(); }
});

Then('Docker read only attachment rejects stdin oversized truncated and cancelled responses', async () => {
  for (const input of [{ id: '../other' }, { id: 'synthetic', stdin: true }, { id: 'synthetic', command: 'write' }, { id: 'synthetic', stdout: 'true' }]) assert.throws(() => dockerAttachParams(input));
  for (const mode of ['oversize', 'truncated', 'cancelled']) {
    const v = await attachmentFixture();
    try {
      const pair = await v.pair(), controller = new AbortController();
      if (mode === 'oversize') v.f.attachment = [Buffer.alloc(300_000), Buffer.alloc(300_000)];
      if (mode === 'truncated') v.f.attachmentCode = 1006;
      if (mode === 'cancelled') v.f.attachmentHold = true;
      const result = v.read(pair.identity, { id: 'synthetic' }, controller.signal);
      if (mode === 'cancelled') { await new Promise(resolve => setTimeout(resolve, 50)); controller.abort(); }
      await assert.rejects(result, error => ['LIMIT', 'DOCKER_UNAVAILABLE', 'CANCELLED'].includes(error.code));
      assert.equal(v.broker.connected(v.f.scope.connectionId), false);
    } finally { await v.close(); }
  }
});

Then('Docker read only attachment uses encrypted profiles and withholds binary credential echoes', async () => {
  const v = await attachmentFixture(), vault = await dockerVaultFixture(v.f);
  try {
    const connection = await vault.session.pairDockerHost(vault.input, vault.selection), approved = await approvedDockerOperation(vault.selection.operation, vault.selection.document);
    assert.equal(connection.operation, dockerNativeAttachOperationId);
    const input = { host: dockerReference(connection), fingerprint: approved.fingerprint };
    const result = await vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }); assert.equal(result.response.status, 101);
    assert.equal(JSON.stringify(vault.storage.state).includes(v.f.key), false);
    await vault.session.lock(); await vault.session.unlock(vault.proof);
    v.f.attachment = [Buffer.from(v.f.key)];
    await assert.rejects(vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }), error => error.code === 'REDACTED');
    v.f.attachment = [Buffer.from('safe')]; vault.enabled = false;
    await assert.rejects(vault.session.executeDockerRead(input, vault.selection, { 'path:id': 'synthetic' }), denied);
  } finally { vault.session.lock(); await v.close(); }
});
