// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { capabilityDocument } from '../tests/capability-diagnostics.fixture.mjs';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationBlockReason, operationCapabilityHint, readOperationCapabilities } from './lib/operation-capabilities.ts';
import { createSchemaDiscovery, validateSchemaDiscovery, schemaIndexVersion } from './lib/schema-index.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { publishPreparedCatalogs, installOperationModel, updateCatalogs } from './lib/catalog.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';

Before({ tags: '@capability-diagnostics' }, function () { this.capabilityCatalogs = catalogs; });
After({ tags: '@capability-diagnostics' }, function () { updateCatalogs(this.capabilityCatalogs); });
const inspect = document => inspectServiceSchema(document, 'capability-fixture').operations[0];
const areas = operation => new Set(operation.capabilities?.issues.map(issue => issue.area));
function supported(document = capabilityDocument()) {
  document.servers = [{ url: 'https://example.test/v1' }];
  const operation = document.paths['/items'].post;
  delete operation.parameters; delete operation.requestBody; delete operation['x-operations-response-stream']; delete operation.security;
  return document;
}

Then('endpoint parameter body authentication and response limitations remain independent', () => {
  const document = capabilityDocument(), original = structuredClone(document), operation = inspect(document);
  assert.deepEqual(areas(operation), new Set(['endpoint', 'request', 'authentication', 'response']));
  assert.equal(operation.capabilities.issues.filter(issue => issue.area === 'request').length, 2);
  assert.equal(operation.unavailableReason, operation.capabilities.issues[0].message);
  assert.equal(operation.capabilities.alternatives[0].supported, false);
  assert.match(operationCapabilityHint(operation), /Endpoint:.*server URL/);
  for (const area of ['Request:', 'Authentication:', 'Response:']) assert.ok(operationCapabilityHint(operation).includes(area));
  assert.throws(() => prepareRequest(operation, {})); assert.deepEqual(document, original);
});

Then('resolving capability failures one by one retains the remaining guards', async () => {
  const document = capabilityDocument(), raw = document.paths['/items'].post;
  document.servers = [{ url: 'https://example.test' }];
  assert.deepEqual(areas(inspect(document)), new Set(['request', 'authentication', 'response']));
  delete raw.parameters; delete raw.requestBody;
  let operation = inspect(document); assert.deepEqual(areas(operation), new Set(['authentication', 'response']));
  raw.security = [{ Bearer: [] }]; operation = inspect(document); assert.deepEqual(areas(operation), new Set(['response']));
  assert.throws(() => prepareRequest(operation, {}));
  await assert.rejects(approvedOperation(operation, 'https://example.test'), error => error.code === 'PERMISSION');
  delete raw['x-operations-response-stream']; operation = inspect(document);
  assert.equal(operationBlockReason(operation), undefined); assert.equal(operation.capabilities.issues.length, 0);
  assert.equal(operation.capabilities.requirements[0].code, 'credentials');
  assert.equal(prepareRequest(operation, {}).path, '/items');
  assert.ok((await approvedOperation(operation, 'https://example.test')).fingerprint);
});

Then('capability alternatives keep unsupported positions anonymous choices and malformed declarations distinct', () => {
  const document = supported(), raw = document.paths['/items'].post;
  raw.security = [{ Digest: [], Bearer: [] }, { Bearer: [] }, {}];
  let operation = inspect(document);
  assert.equal(operation.capabilities.issues[0].code, 'invalid-contract'); assert.match(operationBlockReason(operation), /duplicate credential header/);
  raw.security = [{ Digest: [] }, { Bearer: [] }, {}]; operation = inspect(document);
  assert.equal(operationBlockReason(operation), undefined);
  assert.deepEqual(operation.capabilities.alternatives.map(value => [value.id, value.index, value.supported, value.names]),
    [['security-0', 0, false, ['Digest']], ['security-1', 1, true, ['Bearer']], ['security-2', 2, true, []]]);
  assert.equal(operation.capabilities.requirements, undefined);
  raw.security = [{ Missing: [] }, {}]; operation = inspect(document);
  assert.equal(operation.capabilities.issues[0].area, 'authentication'); assert.equal(operation.capabilities.issues[0].code, 'invalid-contract');
  assert.equal(operation.capabilities.alternatives, undefined);
  const combined = supported(); combined.components.securitySchemes.Key = { type: 'apiKey', in: 'header', name: 'X-Key' };
  combined.paths['/items'].post.security = [{ Bearer: [], Key: [] }];
  assert.deepEqual(inspect(combined).capabilities.alternatives[0].names, ['Bearer', 'Key']);
});

Then('supported authentication native and Docker operations describe their independent requirements', async () => {
  const document = supported(); assert.equal(inspect(document).capabilities, undefined);
  document.paths['/items'].post.security = [{ Bearer: [] }];
  const authenticated = inspect(document); assert.deepEqual(authenticated.capabilities.issues, []);
  assert.equal(authenticated.capabilities.requirements[0].code, 'credentials');
  const native = await readServiceSchema('codex'), operation = inspectServiceSchema(native, 'codex', new Set(['codex:thread/start'])).operations[0];
  assert.equal(operationBlockReason(operation), undefined);
  assert.deepEqual(operation.capabilities.requirements.map(value => value.code), ['native-host', 'native-account', 'native-workspace', 'native-method', 'native-terminal']);
  const old = structuredClone(native); old.info.version = old['x-codex-app-server'].version = '0.162.0';
  const incompatible = inspectServiceSchema(old, 'codex').operations.find(value => value.name === 'initialize');
  assert.deepEqual(incompatible.capabilities.issues.map(value => value.code), ['unsupported-native-method', 'runtime-version']);
  const docker = inspectServiceSchema(await readServiceSchema('docker'), 'docker', new Set(['docker:ContainerList'])).operations[0];
  assert.equal(docker.capabilities.requirements[0].code, 'docker-destination'); assert.equal(operationBlockReason(docker), undefined);
});

Then('discovery capabilities match canonical diagnostics and reject obsolete or malformed indexes', () => {
  const inspected = inspectServiceSchema(capabilityDocument(), 'capability-fixture'), index = createSchemaDiscovery(inspected, 'source1');
  assert.equal(index.version, schemaIndexVersion); assert.deepEqual(readOperationCapabilities(index.operations[0]), inspected.operations[0].capabilities);
  assert.ok(JSON.stringify(index.operations[0].capabilitySummary).length < JSON.stringify(inspected.operations[0].capabilities).length);
  assert.equal(index.operations[0].fields.length, 0); assert.equal(index.operations[0].deferred, true);
  assert.equal(index.operations[0].security, undefined); assert.equal(index.operations[0].bodySchema, undefined);
  assert.equal(validateSchemaDiscovery(index, 'capability-fixture', 'source1'), index);
  assert.throws(() => validateSchemaDiscovery({ ...index, version: 1 }, 'capability-fixture', 'source1'), /outdated/);
  const invalid = structuredClone(index); invalid.operations[0].capabilitySummary.a[0][1] = 'invalid';
  assert.throws(() => validateSchemaDiscovery(invalid, 'capability-fixture', 'source1'), /diagnostics/);
  index.operations[0].capabilitySummary.i.length = 0;
  assert.ok(inspected.operations[0].capabilities.issues.length, 'Discovery must not mutate canonical diagnostics.');
});

Then('current canonical capability failures stop graph HTTP and private approval dispatch', async () => {
  const document = capabilityDocument(), inspected = inspectServiceSchema(document, 'capability-fixture');
  const operation = inspected.operations[0], index = createSchemaDiscovery(inspected, 'source1'), discovery = index.operations[0];
  discovery.capabilities = { issues: [] }; delete discovery.unavailableReason; delete discovery.capabilitySummary;
  publishPreparedCatalogs([{ catalog: { id: 'capability-fixture', name: inspected.name, file: 'fixture.json', document: index.document,
    groups: index.groups, execution: { kind: 'http', origin: 'https://example.test' } }, operations: index.operations, sourceIdentity: 'source1' }]);
  const scoped = scopeOperationSchema(document, operation.path, operation.method, true).schema;
  const canonical = structuredClone(operation); delete canonical.unavailableReason;
  installOperationModel({ operation: canonical, document: scoped, origin: 'https://example.test', sourceIdentity: 'source1', bytes: 1000 });
  const caller = { ...canonical, capabilities: { issues: [] } };
  let dispatches = 0; const execution = createWorkflowRequestExecution(async () => { dispatches++; return Response.json({}); });
  await assert.rejects(execution.execute(caller, {}));
  await assert.rejects(approvedOperation(canonical, 'https://example.test'), error => error.code === 'PERMISSION');
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'inspect', scoped);
  const runner = createWorkflowRunner({ version: 3, id: 'capability-graph', name: 'Capability graph', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false }, 'inspect', execution);
  assert.throws(() => runner.next(), /server URL/); assert.equal(dispatches, 0);
});
