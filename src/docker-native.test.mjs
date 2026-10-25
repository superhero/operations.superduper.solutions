// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { dockerNativeFixture } from '../tests/docker-native.fixture.mjs';
import { DockerCompanionBroker } from './lib/secrets/docker-companion.ts';
import { dockerNativeProfile, dockerReadParams, dockerIdentity, dockerScope, dockerReadPath, dockerNativeLimits } from './lib/docker-native-contract.ts';
import { prepareDockerReadRequest } from './lib/docker-operation-input.ts';
import { dockerNativeReadOperation } from './lib/docker-native-model.ts';
import { openDockerSocket } from '../companions/docker/runtime.mjs';
import { VaultError } from './lib/secrets/types.ts';
import { decryptJSON, encryptJSON, recoveryKey, unwrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { approvedDockerOperation } from './lib/secrets/docker-policy.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { dockerVaultFixture } from '../tests/docker-vault.fixture.mjs';
import { dockerReference, validateDockerBinding, validateDockerConnection, storedDockerConnections } from './lib/secrets/docker-config.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { publishPreparedCatalogs, installOperationModel, updateCatalogs } from './lib/catalog.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { portableWorkflowDocument } from './lib/workflow-document.ts';
import { createWorkflowRequestExecution, workflowExecutionForOperation } from './lib/workflow-execution.ts';

Before({ tags: '@docker-native' }, function () { this.dockerFixtures = []; this.dockerVaults = []; this.dockerCatalogs = catalogs; });
After({ tags: '@docker-native' }, async function () {
  for (const value of this.dockerVaults) value.session.lock();
  for (const value of this.dockerFixtures.reverse()) { value.broker.clear(); await value.f.close(); }
  updateCatalogs(this.dockerCatalogs);
});
const wait = async predicate => {
  const deadline = Date.now() + 1800;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('Docker fixture did not reach its owned transition.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function setup(world) {
  const f = await dockerNativeFixture(), broker = new DockerCompanionBroker(f.runtime);
  const value = { f, broker, enabled: true, guard: async () => { if (!value.enabled) throw new VaultError('PERMISSION'); } };
  value.pair = expected => broker.check(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, expected, value.guard);
  value.read = (identity, params = {}, signal) => broker.read(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, identity, params, value.guard, signal);
  world.dockerFixtures.push(value); return value;
}

Then('Docker native access rejects unauthorized origins keys and profiles before daemon reads', async function () {
  const v = await setup(this), f = v.f;
  assert.equal((await f.call('/v1/docker/pair', undefined, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.call('/v1/docker/pair', undefined, { Authorization: '' })).status, 401);
  assert.equal((await f.call('/v1/docker/pair', { profile: 'codex-stdio-paired-v1', scope: f.scope })).status, 400);
  assert.deepEqual(f.engineRequests, []);
  const preflight = await f.fetch(f.host + '/v1/docker/pair', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), f.applicationOrigin);
  assert.deepEqual(f.engineRequests, []);
});

Then('Docker native listing preserves HTTP results and only uses the configured socket routes', async function () {
  const v = await setup(this), pair = await v.pair();
  assert.equal(pair.identity.apiVersion, '1.57'); assert.equal(pair.identity.daemonId, v.f.daemonId);
  const response = await v.read(pair.identity, { all: true, limit: 12, size: false, filters: '{"status":["running"]}' });
  assert.equal(response.status, 200); assert.equal(response.mediaType, 'application/json'); assert.equal(response.body[0].Id, 'synthetic-container');
  const list = v.f.engineRequests.filter(value => value.path.startsWith('/v1.57/containers/json'));
  assert.equal(list.length, 1); const query = new URL(list[0].path, 'http://fixture').searchParams;
  assert.equal(query.get('all'), 'true'); assert.equal(query.get('limit'), '12'); assert.equal(query.get('filters'), '{"status":["running"]}');
  assert.ok(v.f.engineRequests.every(value => value.method === 'GET' && /^\/(?:version$|v1\.57\/(?:info$|containers\/json(?:\?|$)))/.test(value.path)));
  assert.equal(JSON.stringify(pair).includes(v.f.key), false); assert.ok(v.f.requests.every(value => !value.cookie));
  v.f.status = 400; v.f.body = { message: 'Synthetic bad parameter' };
  assert.equal((await v.read(pair.identity)).status, 400);
});

Then('Docker native access rejects changed daemon identity and stale source scope', async function () {
  const v = await setup(this), pair = await v.pair(), before = v.f.engineRequests.length;
  const stale = await v.f.call('/v1/docker/read', { profile: dockerNativeProfile, identity: pair.identity, scope: { ...v.f.scope, fingerprint: 'd'.repeat(64) }, params: {} });
  assert.equal(stale.value.error, 'DOCKER_AUTHORITY'); assert.equal(v.f.engineRequests.length, before);
  v.f.daemonId = 'different-daemon-9182';
  await assert.rejects(v.read(pair.identity), error => error.code === 'DOCKER_AUTHORITY');
  assert.equal(v.f.engineRequests.filter(value => value.path.startsWith('/v1.57/containers/json')).length, 0);
});

Then('Docker native access rejects older and incompatible daemon API versions', async function () {
  for (const [minimum, maximum] of [['1.44', '1.56'], ['1.58', '1.60'], ['invalid', '1.57']]) {
    const v = await setup(this); v.f.apiMin = minimum; v.f.apiMax = maximum;
    await assert.rejects(v.pair(), error => error.code === 'DOCKER_VERSION');
    assert.equal(v.f.engineRequests.some(value => value.path.includes('/containers/')), false);
  }
});

Then('Docker native access refuses upgrades and unsupported payloads without replay', async function () {
  for (const mode of ['upgrade', 'mime']) {
    const v = await setup(this), pair = await v.pair();
    if (mode === 'upgrade') v.f.duplex = true; else v.f.media = 'text/html';
    await assert.rejects(v.read(pair.identity), error => error.code === (mode === 'upgrade' ? 'DOCKER_DUPLEX' : 'DOCKER_UNAVAILABLE'));
    assert.equal(v.f.engineRequests.filter(value => value.path.startsWith('/v1.57/containers/json')).length, 1);
  }
});

Then('Docker native cancellation and source invalidation stop owned response propagation', async function () {
  const v = await setup(this), pair = await v.pair(), cancel = new AbortController(); v.f.hold = true;
  const run = v.read(pair.identity, {}, cancel.signal);
  await wait(() => v.f.held.length); cancel.abort(); await assert.rejects(run, error => error.code === 'CANCELLED');
  await wait(() => v.f.aborted > 0); assert.equal(v.f.engineRequests.filter(value => value.path.includes('/containers/')).length, 1);
  const other = await setup(this), paired = await other.pair(); other.f.hold = true;
  const result = other.read(paired.identity); await wait(() => other.f.held.length); other.enabled = false; other.f.held[0]();
  await assert.rejects(result, error => error.code === 'PERMISSION');
});

Then('Docker native access rejects arbitrary commands sockets parameters and aliases', async function () {
  const v = await setup(this), pair = await v.pair();
  for (const input of [{ socketPath: '/var/run/docker.sock' }, { command: 'docker run arbitrary' }, { stream: true }, { method: 'POST' }, { filters: '{"name":true}' }]) {
    assert.throws(() => dockerReadParams(input)); await assert.rejects(v.read(pair.identity, input));
  }
  assert.equal(v.f.engineRequests.some(value => value.path.includes('/containers/')), false);
  const file = join(v.f.directory, 'regular-file'), alias = join(v.f.directory, 'alias.sock'); await writeFile(file, 'not a socket'); await symlink(v.f.socketPath, alias);
  for (const path of [undefined, 'relative.sock', file, alias]) await assert.rejects(openDockerSocket({ hostId: v.f.hostId, socketPath: path }));
});

Then('Docker native models bind the pinned source while configured HTTP remains supported', async function () {
  const source = await readServiceSchema('docker'), inspected = inspectServiceSchema(source, 'docker');
  assert.equal(inspected.operations.length, 108);
  const operation = inspected.operations.find(value => value.id === 'docker:ContainerList');
  assert.equal(operation.unavailableReason, undefined); assert.equal(operation.fields.length, 4); assert.equal(operation.dockerNative.profile, dockerNativeProfile);
  const document = scopeOperationSchema(source, operation.path, operation.method, true).schema;
  const descriptor = await approvedDockerOperation(operation, document); assert.match(descriptor.fingerprint, /^[a-f0-9]{64}$/);
  await assert.rejects(approvedOperation(operation, ''), error => error.code === 'PERMISSION');
  await assert.rejects(approvedDockerOperation({ ...operation, path: '/containers/create' }, document), error => error.code === 'PERMISSION');
  const changed = structuredClone(document); changed.info.version = '1.56';
  await assert.rejects(approvedDockerOperation(operation, changed), error => error.code === 'PERMISSION');
  const acquisition = structuredClone(document); acquisition.paths['/containers/json'].get['x-operations-credential-result'] = true;
  await assert.rejects(approvedDockerOperation(operation, acquisition), error => error.code === 'PERMISSION');
  const configured = structuredClone(source); configured.servers = [{ url: 'https://docker.example.test/v1.57' }];
  const ordinary = inspectServiceSchema(configured, 'docker', new Set(['docker:ContainerList']));
  assert.equal(ordinary.serverUrl, 'https://docker.example.test/v1.57'); assert.equal(ordinary.operations[0].unavailableReason, undefined);
  assert.equal((await approvedOperation(ordinary.operations[0], ordinary.serverUrl)).origin, ordinary.serverUrl);
});

async function privateHost(world) {
  const value = await setup(world), vault = await dockerVaultFixture(value.f); world.dockerVaults.push(vault);
  const connection = await vault.session.pairDockerHost(vault.input, vault.selection);
  const descriptor = await approvedDockerOperation(vault.selection.operation, vault.selection.document);
  return { ...value, vault, connection, binding: { host: dockerReference(connection), fingerprint: descriptor.fingerprint } };
}

Then('Docker private profiles persist encrypted and key edits revoke their selected hosts', async function () {
  const v = await privateHost(this);
  assert.equal(v.connection.identity.daemonId, v.f.daemonId); assert.equal(v.connection.profile, dockerNativeProfile);
  assert.equal(JSON.stringify(v.vault.storage.state).includes(v.f.key), false);
  const result = await v.vault.session.executeDockerRead(v.binding, v.vault.selection, { 'query:all': 'true' });
  assert.equal(result.request.path, '/v1.57/containers/json'); assert.equal(result.response.body[0].Id, 'synthetic-container');
  v.vault.session.lock(); v.vault.session = v.vault.newSession(); await v.vault.session.unlock(v.vault.proof);
  assert.equal((await v.vault.session.dockerConnections())[0].connected, false);
  await v.vault.session.checkDockerHost(dockerReference(v.connection), v.vault.selection);
  assert.equal((await v.vault.session.dockerConnections())[0].connected, true);
  await v.vault.session.put(null, { id: v.vault.keyId, label: 'Replaced Docker key', kind: 'secret', value: 'replacement-docker-key-value-9182' });
  assert.deepEqual(await v.vault.session.dockerConnections(), []);
  const before = v.f.engineRequests.length;
  await assert.rejects(v.vault.session.executeDockerRead(v.binding, v.vault.selection, {}), error => error.code === 'CONFLICT');
  assert.equal(v.f.engineRequests.length, before);
});

Then('Docker private execution rejects credential echoes and stale source results', async function () {
  const v = await privateHost(this); v.f.body = [{ Id: v.f.key }];
  await assert.rejects(v.vault.session.executeDockerRead(v.binding, v.vault.selection, {}), error => error.code === 'REDACTED');
  const before = v.f.engineRequests.length, forged = structuredClone(v.vault.selection); forged.operation.fields = [];
  await assert.rejects(v.vault.session.executeDockerRead(v.binding, forged, {}), error => error.code === 'PERMISSION');
  assert.equal(v.f.engineRequests.length, before);
  v.f.body = [{ Id: 'safe-container' }]; v.f.hold = true;
  const result = v.vault.session.executeDockerRead(v.binding, v.vault.selection, {});
  await wait(() => v.f.held.length); v.vault.enabled = false; v.f.held[0]();
  await assert.rejects(result, error => error.code === 'PERMISSION');
});

Then('Docker graph reads use private bindings while configured HTTP uses its own endpoint', async function () {
  const v = await privateHost(this), source = await readServiceSchema('docker');
  const register = document => {
    const inspected = inspectServiceSchema(document, 'docker'), discovery = createSchemaDiscovery(inspected, 'docker-source-test');
    publishPreparedCatalogs([{ catalog: { id: 'docker', name: inspected.name, file: 'docker.openapi.json', document: discovery.document,
      groups: discovery.groups, execution: { kind: 'http', origin: inspected.serverUrl } }, operations: discovery.operations, sourceIdentity: 'docker-source-test' }]);
    const operation = inspected.operations.find(value => value.id === 'docker:ContainerList'), scoped = scopeOperationSchema(document, operation.path, operation.method, true).schema;
    installOperationModel({ operation, document: scoped, origin: inspected.serverUrl, sourceIdentity: 'docker-source-test', bytes: Buffer.byteLength(JSON.stringify([operation, scoped])) });
    return operation;
  };
  const operation = register(source), graph = createOperationGraph(operation, { x: 0, y: 0 }, 'list', v.vault.selection.document);
  graph.nodes.find(node => node.type === 'operation').data.dockerBinding = v.binding;
  const document = { version: 3, id: 'docker-graph-test', name: 'Docker graph', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  const runner = createWorkflowRunner(document, 'list', { execute() { assert.fail('Socket binding entered direct HTTP.'); },
    executeDocker(_operation, values, binding, signal) { return v.vault.session.executeDockerRead(binding, v.vault.selection, values, signal); } });
  const visit = runner.next(), result = await runner.submit(visit.values);
  assert.equal(result.response.status, 200); assert.equal(runner.next().kind, 'complete');
  assert.equal(JSON.stringify(portableWorkflowDocument(document)).includes('dockerBinding'), false);
  assert.throws(() => workflowExecutionForOperation(operation), /paired Docker host|HTTP server/);
  const placeholder = structuredClone(source); placeholder.servers = [{ url: 'https://no-default/v1.57' }];
  assert.throws(() => workflowExecutionForOperation(register(placeholder)), /paired Docker host|HTTP server/);
  const configured = structuredClone(source); configured.servers = [{ url: 'https://docker.example.test/v1.57' }]; const ordinary = register(configured);
  const count = v.f.engineRequests.length, requests = [];
  const http = createWorkflowRequestExecution(async (url, init) => { requests.push({ url, init }); return Response.json([{ Id: 'ordinary-http-container' }]); });
  assert.equal((await http.execute(ordinary, { 'query:all': 'true' })).response.body[0].Id, 'ordinary-http-container');
  assert.equal(new URL(requests[0].url).origin, 'https://docker.example.test'); assert.equal(new URL(requests[0].url).pathname, '/v1.57/containers/json');
  assert.equal(requests[0].init.credentials, 'omit'); assert.equal(v.f.engineRequests.length, count);
});

function scriptedDocker(world, options = {}) {
  const f = { host: 'https://docker.example.test', key: 'K'.repeat(43), now: Date.now(), calls: [],
    identity: { hostId: randomUUID(), generation: randomUUID(), configuration: 'a'.repeat(64), socket: 'b'.repeat(64), daemonId: 'daemon-9182', apiVersion: '1.57' },
    async close() {} };
  f.runtime = { now: () => f.now, fetchRequest: async (url, init) => {
    const request = JSON.parse(init.body); f.calls.push({ url, request });
    const value = { profile: dockerNativeProfile, scope: request.scope, identity: { ...f.identity },
      ...(url.endsWith('/pair') ? { expiresAt: f.now + 10000 } : { response: {
        status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, mediaType: 'application/json', body: [] } }) };
    return options.fetch ? options.fetch(value, f, init) : Response.json(value);
  } };
  const broker = new DockerCompanionBroker(f.runtime), id = randomUUID();
  world.dockerFixtures.push({ f, broker });
  f.broker = broker; f.id = id;
  f.check = (owner = id, signal, guard = async () => {}) => broker.check(owner, f.host, f.key, 'c'.repeat(64), undefined, guard, signal);
  f.read = (input = {}, signal, expected = f.identity) => broker.read(id, f.host, f.key, 'c'.repeat(64), expected, input, async () => {}, signal);
  return f;
}

Then('Docker contracts reject invalid identity scope filters and unsupported model input', async () => {
  for (const input of [null, [], 1, { all: 'true' }, { size: 1 }, { limit: 1.5 }, { limit: 2147483648 }, { limit: -2147483649 },
    { filters: 1 }, { filters: 'x'.repeat(16385) }, { filters: 'null' }, { filters: '[]' },
    { filters: JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => ['name' + i, []]))) },
    { filters: '{"1invalid":[]}' }, { filters: '{"status":[1]}' }, { filters: JSON.stringify({ status: Array(65).fill('x') }) },
    { filters: JSON.stringify({ status: ['x'.repeat(1025)] }) }]) assert.throws(() => dockerReadParams(input));
  assert.equal(dockerReadPath({ all: undefined }), '/v1.57/containers/json');
  const identity = { hostId: randomUUID(), generation: randomUUID(), configuration: 'a'.repeat(64), socket: 'b'.repeat(64), daemonId: 'daemon-9182', apiVersion: '1.57' };
  for (const change of [{ hostId: 'bad' }, { generation: 'bad' }, { configuration: 1 }, { socket: 'bad' }, { daemonId: 1 }, { daemonId: 'short' }, { apiVersion: '1.56' }])
    assert.throws(() => dockerIdentity({ ...identity, ...change }));
  const scope = { connectionId: randomUUID(), operation: 'docker:ContainerList', apiVersion: '1.57', fingerprint: 'c'.repeat(64) };
  for (const change of [{ connectionId: 'bad' }, { operation: 'docker:ContainerCreate' }, { apiVersion: '1.56' }, { fingerprint: 'bad' }]) assert.throws(() => dockerScope({ ...scope, ...change }));
  const source = await readServiceSchema('docker'), base = { id: 'docker:ContainerList', method: 'GET', path: '/containers/json' };
  const operation = dockerNativeReadOperation(source, base); assert.ok(operation);
  for (const [values, fieldKey] of [[{ extra: 'x' }, 'extra'], [{ 'query:limit': '2147483648' }, 'query:limit'],
    [{ 'query:filters': '{"status":true}' }, 'query:filters']]) assert.throws(() => prepareDockerReadRequest(operation, values), error => error.fieldKey === fieldKey);
  assert.throws(() => prepareDockerReadRequest({ ...operation, method: 'POST' }, {}), /reviewed Docker/);
  const header = { key: 'header:extra', name: 'extra', label: 'Extra', location: 'header', type: 'string', required: false, schema: { type: 'string' } };
  assert.throws(() => prepareDockerReadRequest({ ...operation, fields: [...operation.fields, header] }, { 'header:extra': 'unreviewed' }), error => error.fieldKey === 'query:filters');
  for (const mutate of [
    document => document.paths['/containers/json'].get.parameters[0].name = 'unknown',
    document => document.paths['/containers/json'].get.parameters[1].name = document.paths['/containers/json'].get.parameters[0].name,
    document => document.paths['/containers/json'].get.parameters[0].in = 'header',
    document => document.paths['/containers/json'].get.parameters[0].required = true,
    document => document.paths['/containers/json'].get.parameters[0].content = {},
    document => document.paths['/containers/json'].get.parameters[0].style = 'deepObject',
    document => document.paths['/containers/json'].get.parameters[0].explode = false,
    document => document.paths['/containers/json'].get.parameters[0].schema = { type: 'object' },
    document => document.paths['/containers/json'].get.parameters[0].schema.oneOf = [],
  ]) { const changed = structuredClone(source); mutate(changed); assert.equal(dockerNativeReadOperation(changed, base), undefined); }
  const minimal = structuredClone(source), method = minimal.paths['/containers/json'].get;
  delete method.tags; delete method.summary; delete method.description;
  for (const parameter of method.parameters) delete parameter.description;
  method.parameters.find(value => value.name === 'filters').schema.default = '{}';
  const fallback = dockerNativeReadOperation(minimal, base); assert.equal(fallback.name, 'List containers'); assert.equal(fallback.group, 'Operations');
  assert.equal(fallback.fields.find(value => value.name === 'filters').defaultValue, '{}');
  for (const layer of ['document', 'path', 'method']) for (const security of [{}, [{ privateKey: [] }]]) {
    const changed = structuredClone(source), target = layer === 'document' ? changed : layer === 'path' ? changed.paths[base.path] : changed.paths[base.path].get;
    target.security = security; assert.equal(dockerNativeReadOperation(changed, base), undefined);
  }
  const publicRead = structuredClone(source); publicRead.security = []; publicRead.paths[base.path].security = []; publicRead.paths[base.path].get.security = [];
  assert.ok(dockerNativeReadOperation(publicRead, base));
});

Then('Docker broker rejects malformed envelopes opaque errors and oversized private responses', async function () {
  for (const fetch of [
    () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json([]), () => Response.json(null),
    () => Response.json({ error: 'private upstream detail' }, { status: 500 }),
    () => { throw new Error('private upstream detail'); },
  ]) {
    const f = scriptedDocker(this, { fetch }); await assert.rejects(f.check(), error => error.code === 'DOCKER_UNAVAILABLE' && !error.message.includes('private upstream'));
    assert.equal(f.broker.connected(f.id), false);
  }
  for (const error of ['PERMISSION', 'LIMIT', 'DOCKER_UNAVAILABLE', 'DOCKER_VERSION', 'DOCKER_AUTHORITY', 'DOCKER_DUPLEX']) {
    const f = scriptedDocker(this, { fetch: () => Response.json({ error }, { status: 403 }) }); await assert.rejects(f.check(), { code: error });
  }
  const echo = scriptedDocker(this, { fetch: (_value, f) => Response.json({ privateValue: f.key }) }); await assert.rejects(echo.check(), { code: 'REDACTED' });
  const huge = scriptedDocker(this, { fetch: () => Response.json({ padding: 'x'.repeat(dockerNativeLimits.response + 65536) }) });
  await assert.rejects(huge.check(), { code: 'LIMIT' });
  const invalid = scriptedDocker(this); await assert.rejects(invalid.broker.check(invalid.id, invalid.host, 'bad', 'c'.repeat(64), undefined, async () => {}), { code: 'PERMISSION' });
  assert.deepEqual(invalid.calls, []);
});

Then('Docker pairing and response metadata preserve exact daemon and source authority', async function () {
  for (const mutate of [value => value.profile = 'unreviewed', value => value.scope.fingerprint = 'd'.repeat(64),
    value => value.expiresAt = 0, value => value.expiresAt = Date.now() + dockerNativeLimits.sessionMs + 10000,
    value => value.expiresAt = 1.5]) {
    const f = scriptedDocker(this, { fetch: value => { mutate(value); return Response.json(value); } });
    await assert.rejects(f.check(), { code: 'DOCKER_AUTHORITY' }); assert.equal(f.broker.connected(f.id), false);
  }
  for (const mutate of [value => value.profile = 'unreviewed', value => value.scope.fingerprint = 'd'.repeat(64),
    value => value.identity.daemonId = 'foreign-daemon']) {
    const f = scriptedDocker(this, { fetch: value => { if (value.response) mutate(value); return Response.json(value); } });
    await f.check(); await assert.rejects(f.read(), { code: 'DOCKER_AUTHORITY' }); assert.equal(f.broker.connected(f.id), false);
  }
  for (const change of [{ status: 199 }, { status: 600 }, { status: 200.5 }, { statusText: 1 }, { statusText: 'x'.repeat(257) },
    { mediaType: 'text/html' }, { headers: null }, { headers: [] }, { headers: { 'set-cookie': 'private' } },
    { headers: { server: 1 } }, { headers: { server: 'x'.repeat(4097) } }, { body: {} }]) {
    const f = scriptedDocker(this, { fetch: value => { if (value.response) Object.assign(value.response, change); return Response.json(value); } });
    await assert.rejects(f.read(), { code: 'DOCKER_UNAVAILABLE' }); assert.equal(f.broker.connected(f.id), false);
  }
  const expired = scriptedDocker(this, { fetch: (value, f) => { if (value.response) f.now += 10000; return Response.json(value); } });
  await assert.rejects(expired.read(), { code: 'DOCKER_AUTHORITY' });
  const largeInput = scriptedDocker(this); await largeInput.check();
  await assert.rejects(largeInput.read({}, undefined, { ...largeInput.identity, padding: 'x'.repeat(dockerNativeLimits.input) }), { code: 'LIMIT' });
});

Then('Docker request ownership limits cancellation and expiry release only their owned work', async function () {
  const f = scriptedDocker(this);
  for (let index = 0; index < 4; index++) await f.check(index ? randomUUID() : f.id);
  await assert.rejects(f.check(randomUUID()), { code: 'LIMIT' }); f.now += 10001;
  assert.equal(f.broker.connected(f.id), false); await f.check(); assert.equal(f.broker.connected(f.id), true);
  const held = scriptedDocker(this, { fetch: (_value, _f, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('private cancellation detail')), { once: true });
  }) });
  const owners = Array.from({ length: 4 }, () => randomUUID()), runs = owners.map(id => held.check(id));
  const failures = runs.map(run => assert.rejects(run, { code: 'CANCELLED' })); await wait(() => held.calls.length === 4);
  await assert.rejects(held.check(owners[0]), { code: 'PERMISSION' });
  held.broker.close(owners[1]); await failures[1]; assert.equal(held.calls.length, 4);
  held.broker.clear(); await Promise.all(failures);
  const cancel = new AbortController(); cancel.abort(); const before = scriptedDocker(this);
  await assert.rejects(before.check(before.id, cancel.signal), { code: 'CANCELLED' }); assert.deepEqual(before.calls, []);
  const after = new AbortController(), late = scriptedDocker(this);
  await assert.rejects(late.check(late.id, after.signal, async () => { if (late.calls.length) after.abort(); }), { code: 'CANCELLED' });
  assert.equal(late.calls.length, 1);
});

Then('Docker saved authority removal stale bindings and daemon errors preserve private ownership', async function () {
  const v = await privateHost(this), { connected: _connected, ...connection } = v.connection, reference = dockerReference(connection);
  for (const binding of [{ host: reference, fingerprint: 1 }, { host: reference, fingerprint: 'bad' }, { host: { ...reference, revision: 0 }, fingerprint: 'a'.repeat(64) }])
    assert.throws(() => validateDockerBinding(binding), { code: 'INVALID' });
  for (const change of [{ host: v.f.host + '/' }, { profile: 'unreviewed' }, { keyHash: 'bad' }, { modelFingerprint: 'bad' }])
    assert.throws(() => validateDockerConnection({ ...connection, ...change }), { code: 'INVALID' });
  assert.throws(() => storedDockerConnections([{ id: randomUUID(), dockerConnections: [connection] }]), { code: 'INVALID' });
  assert.throws(() => storedDockerConnections([{ id: v.vault.keyId, dockerConnections: [connection, connection] }]), { code: 'LIMIT' });
  await assert.rejects(v.vault.session.pairDockerHost({ ...v.vault.input, pairingKeyId: randomUUID() }, v.vault.selection), { code: 'PERMISSION' });
  const before = v.f.engineRequests.length;
  for (const binding of [{ ...v.binding, fingerprint: 'd'.repeat(64) }, v.binding]) {
    await assert.rejects(v.vault.session.executeDockerRead(binding, v.vault.selection, binding === v.binding ? { extra: 'x' } : {}), { code: 'PERMISSION' });
  }
  await assert.rejects(v.vault.session.executeDockerRead(v.binding, v.vault.selection, { 'query:filters': JSON.stringify({ name: [v.f.key] }) }), { code: 'REDACTED' });
  assert.equal(v.f.engineRequests.length, before);
  v.f.status = 404; v.f.body = { message: 'Synthetic missing container' };
  await assert.rejects(v.vault.session.executeDockerRead(v.binding, v.vault.selection, {}), error => error.response?.status === 404);
  await assert.rejects(v.vault.session.checkDockerHost({ ...reference, revision: 2 }, v.vault.selection), { code: 'CONFLICT' });
  await assert.rejects(v.vault.session.disconnectDockerHost(reference, 'yes'), { code: 'CONFLICT' });
  assert.equal((await v.vault.session.disconnectDockerHost(reference))[0].connected, false);
  assert.deepEqual(await v.vault.session.disconnectDockerHost(reference, true), []);
  await assert.rejects(v.vault.session.disconnectDockerHost(reference), { code: 'CONFLICT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(v.vault.session.pairDockerHost(v.vault.input, v.vault.selection, controller.signal), { code: 'CANCELLED' });
});

async function rewriteDockerRecord(v, snapshot, mutate) {
  v.session.lock();
  const context = item => ({ vaultId: snapshot.id, epoch: snapshot.epoch, kind: item.kind, id: item.id, revision: item.revision });
  const envelope = snapshot.envelopes.find(item => item.id === v.proof.methodId);
  const key = await unwrapVaultKey(envelope.wrappedKey, await recoveryKey(v.proof.secret, envelope.salt), context(envelope));
  const values = await Promise.all(snapshot.records.map(record => decryptJSON(key, record.ciphertext, context(record))));
  await mutate(values);
  const records = await Promise.all(snapshot.records.map(async (record, index) => ({ ...record, ciphertext: await encryptJSON(key, values[index], context(record)) })));
  v.storage.state.snapshot = await sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision, envelopes: snapshot.envelopes, records }, key);
  v.storage.state.revision++; v.storage.state.lockEpoch++;
  v.session = v.newSession(); await v.session.unlock(v.proof); return values;
}

Then('Docker encrypted records reject malformed collections altered fingerprints and excessive saved authority', async function () {
  const value = await privateHost(this), v = value.vault, snapshot = structuredClone(v.storage.state.snapshot);
  for (const mutate of [owner => owner.dockerConnections = {}, owner => owner.dockerConnections = Array(33).fill(owner.dockerConnections[0]),
    owner => owner.dockerConnections.push(owner.dockerConnections[0])]) {
    await rewriteDockerRecord(v, snapshot, values => mutate(values.find(value => value.id === v.keyId)));
    await assert.rejects(v.session.dockerConnections(), { code: 'LIMIT' });
  }
  await rewriteDockerRecord(v, snapshot, values => values.find(value => value.id === v.keyId).dockerConnections[0].pairingKeyId = randomUUID());
  await assert.rejects(v.session.dockerConnections(), { code: 'INVALID' });
  for (const mutate of [owner => owner.value = 'R'.repeat(43), owner => owner.dockerConnections[0].keyHash = 'd'.repeat(64),
    owner => owner.dockerConnections[0].modelFingerprint = 'd'.repeat(64), owner => owner.dockerConnections[0].fingerprint = 'd'.repeat(64)]) {
    const values = await rewriteDockerRecord(v, snapshot, records => mutate(records.find(value => value.id === v.keyId)));
    const connection = values.find(value => value.id === v.keyId).dockerConnections[0], before = value.f.requests.length;
    await assert.rejects(v.session.checkDockerHost(dockerReference(connection), v.selection), { code: 'DOCKER_AUTHORITY' });
    assert.equal(value.f.requests.length, before, 'Altered encrypted authority cannot reach the companion.');
  }
  await rewriteDockerRecord(v, snapshot, values => {
    const owner = values.find(value => value.id === v.keyId), connection = owner.dockerConnections[0];
    owner.dockerConnections = Array.from({ length: 32 }, () => ({ ...connection, id: randomUUID() }));
  });
  await assert.rejects(v.session.pairDockerHost(v.input, v.selection), { code: 'LIMIT' });
});

Then('Docker default transport clock and TLS trust preserve exact read authority', async function () {
  const v = await setup(this), f = v.f, defaults = new DockerCompanionBroker({ fetchRequest: f.fetch });
  this.dockerFixtures.push({ f: { async close() {} }, broker: defaults });
  const pair = await defaults.check(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, undefined, async () => {});
  assert.equal(defaults.connected(f.scope.connectionId), true);
  assert.equal((await defaults.read(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, pair.identity, {}, async () => {})).status, 200);
  const rechecked = await defaults.check(f.scope.connectionId, f.host, f.key, f.scope.fingerprint, pair.identity, async () => {});
  assert.deepEqual(rechecked.identity, pair.identity, 'A default-clock health check retains the paired daemon authority.');
  const untrusted = new DockerCompanionBroker(); this.dockerFixtures.push({ f: { async close() {} }, broker: untrusted });
  const before = f.engineRequests.length;
  await assert.rejects(untrusted.check(randomUUID(), f.host, f.key, f.scope.fingerprint, undefined, async () => {}), { code: 'DOCKER_UNAVAILABLE' });
  assert.equal(f.engineRequests.length, before, 'Default fetch cannot bypass TLS trust.');
});

Then('Docker vault cancellation redaction and credential removal release the selected profiles', async function () {
  const value = await privateHost(this), v = value.vault;
  await v.session.put(null, { label: 'Private Docker value', kind: 'secret', value: 'docker-private-value-9182' });
  value.f.body = [{ Id: 'docker-private-value-9182' }];
  await assert.rejects(v.session.executeDockerRead(value.binding, v.selection, {}), { code: 'REDACTED' });
  const cancel = new AbortController(); v.onSchema = () => cancel.abort(); const before = value.f.requests.length;
  await assert.rejects(v.session.checkDockerHost(dockerReference(value.connection), v.selection, cancel.signal), { code: 'CANCELLED' });
  assert.equal(value.f.requests.length, before); v.onSchema = undefined;
  const sibling = await v.session.pairDockerHost({ ...v.input, label: 'Sibling Docker profile' }, v.selection);
  assert.deepEqual((await v.session.disconnectDockerHost(dockerReference(sibling), true)).map(connection => connection.id), [value.connection.id]);
  await v.session.remove(null, v.keyId); assert.deepEqual(await v.session.dockerConnections(), []);
  await assert.rejects(v.session.checkDockerHost(dockerReference(value.connection), v.selection), { code: 'CONFLICT' });
});

Then('Docker pairing cancelled while encrypting its profile cannot replace encrypted storage', async function () {
  const value = await setup(this), v = await dockerVaultFixture(value.f); this.dockerVaults.push(v);
  const before = structuredClone(v.storage.state), cancel = new AbortController(), subtle = crypto.subtle;
  const descriptor = Object.getOwnPropertyDescriptor(subtle, 'encrypt'), encrypt = subtle.encrypt; let encrypted = 0;
  Object.defineProperty(subtle, 'encrypt', { configurable: true, writable: true, value: async (...args) => {
    const result = await Reflect.apply(encrypt, subtle, args); encrypted++; cancel.abort(); return result;
  } });
  try {
    await assert.rejects(v.session.pairDockerHost(v.input, v.selection, cancel.signal), { code: 'CANCELLED' });
  } finally {
    if (descriptor) Object.defineProperty(subtle, 'encrypt', descriptor); else delete subtle.encrypt;
  }
  assert.ok(encrypted > 0, 'Cancellation follows real encryption after the private pairing completes.');
  assert.ok(value.f.engineRequests.some(request => request.path === '/v1.57/info'));
  assert.deepEqual(v.storage.state, before); assert.deepEqual(await v.session.dockerConnections(), []);
});
