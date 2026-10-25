// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { dockerNativeFixture } from '../tests/docker-native.fixture.mjs';
import { DockerCompanionBroker } from './lib/secrets/docker-companion.ts';
import { dockerNativeProfile, dockerReadParams } from './lib/docker-native-contract.ts';
import { openDockerSocket } from '../companions/docker/runtime.mjs';
import { VaultError } from './lib/secrets/types.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { approvedDockerOperation } from './lib/secrets/docker-policy.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { dockerVaultFixture } from '../tests/docker-vault.fixture.mjs';
import { dockerReference } from './lib/secrets/docker-config.ts';
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
