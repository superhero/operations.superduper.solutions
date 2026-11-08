// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { workflowRequestUrl } from './lib/workflow-execution.ts';
import { encodeQueryComponent } from './lib/query-serialization.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { applySchemaPatches, ecbRegistrationParameters, schemaPatchName } from './lib/schema-patches.ts';
import { operationServerUrl } from './lib/schema-documents.ts';

function source(privateRequest = false) {
  return { openapi: '3.0.3', info: { title: 'Path lists', version: '1' },
    servers: [{ url: 'https://paths.example.test' }],
    ...(privateRequest ? { components: { securitySchemes: { Key: { type: 'apiKey', in: 'query', name: 'api_key' } } } } : {}),
    paths: { '/items/{ids}': { get: { operationId: 'read',
      ...(privateRequest ? { security: [{ Key: [] }] } : {}),
      parameters: [{ name: 'ids', in: 'path', required: true, style: 'simple',
        schema: { type: 'array', items: { type: 'string' } } }],
      responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object' } } } } } } } } };
}
const parameter = document => document.paths['/items/{ids}'].get.parameters[0];
const inspect = document => inspectServiceSchema(document, 'path-fixture').operations[0];
const request = (operation, value, fields) => prepareRequest(operation,
  { 'path:ids': value === null ? null : JSON.stringify(value) }, fields);

Then('simple path lists preserve reserved characters Unicode and primitive types', () => {
  const members = ['a,b', 'c/d', 'x?y#z', '%2F', 'café', ' space ', "'()*!~"];
  const path = '/items/a%2Cb,c%2Fd,x%3Fy%23z,%252F,caf%C3%A9,%20space%20,%27%28%29%2A%21~';
  for (const style of [undefined, 'simple']) for (const explode of [undefined, false, true]) {
    const document = source(); Object.assign(parameter(document), { style, explode });
    for (const operation of [inspect(document), extractOperations(document, 'path-fixture')[0]]) {
      assert.equal(operation.unavailableReason, undefined);
      const prepared = request(operation, members);
      assert.equal(prepared.path, path);
      const url = new URL(workflowRequestUrl(prepared, 'https://paths.example.test/v1'));
      assert.equal(url.origin, 'https://paths.example.test');
      assert.equal(url.pathname, '/v1' + path); assert.equal(url.search, ''); assert.equal(url.hash, '');
      assert.deepEqual(url.pathname.slice('/v1/items/'.length).split(',').map(decodeURIComponent), members);
    }
  }
  for (const [type, members, encoded] of [['integer', [0, -2, 10], '0,-2,10'],
    ['number', [.5, -3], '0.5,-3'], ['boolean', [true, false], 'true,false']]) {
    const document = source(); parameter(document).schema.items = { type };
    for (const operation of [inspect(document), extractOperations(document, 'path-fixture')[0]])
      assert.equal(request(operation, members).path, '/items/' + encoded);
  }
});

Then('parameter diagnostics name every unsupported field and its serialization mode', () => {
  const document = source();
  parameter(document).style = 'label';
  document.paths['/items/{ids}'].get.parameters.push(
    { name: 'channels', in: 'query', style: 'pipeDelimited', explode: false, schema: { type: 'array', items: { type: 'string' } } },
    { name: 'X-Tags', in: 'header', schema: { type: 'array', items: { type: 'object', properties: {} } } });
  const message = inspect(document).capabilities.issues.map(issue => issue.message).join('\n');
  assert.match(message, /path parameter "ids" \(type=array, style="label", explode=false\)/);
  assert.match(message, /query parameter "channels" \(type=array, style="pipeDelimited", explode=false\)/);
  assert.match(message, /header parameter "X-Tags" \(type=array, style="simple", explode=false\)/);
  assert.throws(() => extractOperations(document, 'path-fixture'), /path parameter "ids".*style="label"/);
  for (const extra of [{ style: 'matrix' }, { explode: 'true' }, { allowReserved: true }, { allowEmptyValue: true }]) {
    const document = source(); Object.assign(parameter(document), extra);
    assert.match(inspect(document).unavailableReason, /path parameter "ids".*Simple path arrays require/);
    assert.throws(() => extractOperations(document, 'path-fixture'), /path parameter "ids".*Simple path arrays require/);
  }
  for (const items of [{ type: 'object', properties: {} }, { type: 'array', items: { type: 'string' } },
    { type: 'string', nullable: true }, { type: 'null' }]) {
    const document = source(); parameter(document).schema.items = items;
    assert.match(inspect(document).unavailableReason, /path parameter "ids".*non-null primitive/);
    assert.throws(() => extractOperations(document, 'path-fixture'), /path parameter "ids".*non-null primitive/);
  }
  const content = source(); delete parameter(content).schema;
  parameter(content).content = { 'application/json': { schema: { type: 'string' } } };
  assert.match(inspect(content).unavailableReason, /path parameter "ids".*JSON content parameters require/);
  assert.throws(() => extractOperations(content, 'path-fixture'), /path parameter "ids".*JSON content parameters require/);
  const cookie = source(); parameter(cookie).in = 'cookie'; delete parameter(cookie).style;
  assert.match(inspect(cookie).unavailableReason, /cookie parameter "ids".*style="form", explode=true/);
  assert.throws(() => extractOperations(cookie, 'path-fixture'), /cookie parameter "ids".*style="form", explode=true/);
});

Then('path lists reject missing values invalid members and traversal against the correct field', () => {
  const document = source(); parameter(document).schema.nullable = true;
  const operation = inspect(document);
  const rejected = error => error instanceof InputValidationError && error.fieldKey === 'path:ids';
  assert.throws(() => prepareRequest(operation, {}), rejected);
  for (const value of [[], null, {}, [null], [{}], [[]], ['..'], ['.'], [''], ['\ud800']])
    assert.throws(() => request(operation, value), rejected);
  assert.throws(() => prepareRequest(operation, { 'path:ids': 'not-json' }), rejected);
  const numbers = source(); parameter(numbers).schema.items = { type: 'number' };
  assert.throws(() => prepareRequest(inspect(numbers), { 'path:ids': '[1e400]' }), rejected);
  const bounded = source(); Object.assign(parameter(bounded).schema, { minItems: 2, maxItems: 3 });
  for (const value of [['one'], ['one', 'two', 'three', 'four']])
    assert.throws(() => request(inspect(bounded), value), rejected);
  assert.equal(request(inspect(bounded), ['one', 'two']).path, '/items/one,two');
  const forged = operation.fields.map(field => ({ ...field, type: 'string', schema: undefined }));
  assert.equal(request(operation, ['a,b', 'c/d'], forged).path, '/items/a%2Cb,c%2Fd');
});

Then('private path lists preserve delimiters credentials and approval boundaries', async () => {
  const operation = inspect(source(true));
  const descriptor = await approvedOperation(operation, 'https://paths.example.test');
  const value = "path-key*!'()-canary-74193";
  const credentials = [{ id: 'path-key', label: 'Path key', kind: 'secret', value,
    grants: [{ id: 'path-grant', scheme: 'Key', descriptor }] }];
  const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Key: 'path-key' } };
  const urls = [];
  const result = await executeCredentialed(descriptor, { 'path:ids': '["a,b","x-y"]' }, binding, credentials, {
    assertCurrent() {}, fetchRequest: async url => { urls.push(String(url)); return Response.json({ ok: true }); } });
  assert.equal(urls[0], 'https://paths.example.test/items/a%2Cb,x-y?' + new URLSearchParams({ api_key: value }));
  assert.equal(JSON.stringify(result).includes(value), false);
  const echoed = await executeCredentialed(descriptor, { 'path:ids': JSON.stringify([value]) }, binding, credentials, {
    assertCurrent() {}, fetchRequest: async url => Response.json({ echo: String(url) }) });
  assert.equal(JSON.stringify(echoed).includes(value), false);
  assert.equal(JSON.stringify(echoed).includes(encodeQueryComponent(value)), false);
  let unsafeDispatched = false;
  await assert.rejects(executeCredentialed(descriptor, { 'path:ids': '["x/y"]' }, binding, credentials, {
    assertCurrent() {}, fetchRequest: async () => { unsafeDispatched = true; return Response.json({}); } }),
  error => error.code === 'PERMISSION');
  assert.equal(unsafeDispatched, false);
  const changed = structuredClone(operation); changed.fields[0].schema.items = { type: 'integer' };
  const different = await approvedOperation(changed, 'https://paths.example.test');
  assert.notEqual(different.fingerprint, descriptor.fingerprint);
  let dispatched = false;
  await assert.rejects(executeCredentialed(different, {}, binding, credentials, {
    assertCurrent() {}, fetchRequest: async () => { dispatched = true; return Response.json({}); } }),
  error => error.code === 'PERMISSION');
  assert.equal(dispatched, false);
});

Then('ECB data queries prepare their native path and current discovery descriptor', async () => {
  const document = await readServiceSchema('ecb'), original = JSON.stringify(document);
  const operation = inspectServiceSchema(document, 'ecb').operations.find(operation => operation.name === 'Data queries');
  assert.ok(operation); assert.equal(operation.unavailableReason, undefined);
  assert.deepEqual(operation.fields.filter(field => field.location === 'path' && field.type === 'array').map(field => field.name),
    ['agencyID', 'resourceID', 'version', 'key']);
  const prepared = prepareRequest(operation, { 'path:context': 'dataflow', 'path:agencyID': '["ECB","BIS"]',
    'path:resourceID': '["EXR","ICP"]', 'path:version': '["1.0"]', 'path:key': '["D.USD.EUR.SP00.A"]',
    'query:attributes': '["UNIT","UNIT_MULT"]' });
  const url = new URL(workflowRequestUrl(prepared, operationServerUrl(document, operation)));
  assert.equal(url.pathname, '/service/data/dataflow/ECB,BIS/EXR,ICP/1.0/D.USD.EUR.SP00.A');
  assert.equal(url.search, '?attributes=UNIT,UNIT_MULT');
  const index = JSON.parse(gunzipSync(await readFile(new URL('./catalogs/services/indexes/ecb.json.gz', import.meta.url))));
  assert.equal(index.operations.find(entry => entry.id === operation.id).unavailableReason, undefined);
  assert.equal(JSON.stringify(document), original);
});

Then('both importers name missing and unused path parameters without guessing bindings', () => {
  const cases = [
    { name: 'resourceID', location: 'path', missing: true, unused: 'resourceID' },
    { name: 'IDS', location: 'path', missing: true, unused: 'IDS' },
    { name: 'ids', location: 'query', missing: true },
    { name: 'ids', location: 'path', extra: true, unused: 'extra' },
  ];
  for (const sample of cases) {
    const document = source();
    Object.assign(parameter(document), { name: sample.name, in: sample.location });
    if (sample.location === 'query') delete parameter(document).style;
    if (sample.extra) document.paths['/items/{ids}'].get.parameters.push(
      { name: 'extra', in: 'path', required: true, schema: { type: 'string' } });
    const operation = inspect(document);
    const issue = operation.capabilities.issues.find(issue => issue.area === 'endpoint');
    assert.equal(issue.code, 'invalid-contract');
    const message = issue.message;
    assert.match(message, /Path parameter mismatch for "\/items\/\{ids\}"/);
    if (sample.missing) assert.ok(message.includes('missing path parameter declarations for "{ids}"'));
    else assert.equal(message.includes('missing path'), false);
    if (sample.unused) assert.ok(message.includes('unused path parameter declarations "' + sample.unused + '"'));
    else assert.equal(message.includes('unused path'), false);
    assert.throws(() => extractOperations(document, 'path-fixture'), error => error.message.endsWith(message));
  }
  const valid = source();
  valid.paths['/items/{ids}'].parameters = [{ name: 'ids', in: 'path', required: true, schema: { type: 'string' } }];
  assert.equal(inspect(valid).unavailableReason, undefined);
  assert.equal(request(extractOperations(valid, 'path-fixture')[0], ['one', 'two']).path, '/items/one,two');
  const repeated = source();
  repeated.paths['/items/{ids}/{ids}'] = repeated.paths['/items/{ids}']; delete repeated.paths['/items/{ids}'];
  assert.equal(inspect(repeated).unavailableReason, undefined);
  assert.equal(request(extractOperations(repeated, 'path-fixture')[0], ['one']).path, '/items/one/one');
});

const registrationPaths = ['/registration/id/{registrationID}', '/registration/provider/{agencyID}/{providerID}'];

Then('ECB registration queries preserve upstream data and prepare their declared identifiers', async () => {
  const upstream = await readServiceSchemaUpstream('ecb'), original = JSON.stringify(upstream);
  const corrected = await readServiceSchema('ecb');
  const inspected = inspectServiceSchema(corrected, 'ecb').operations;
  const values = [{ 'path:registrationID': '["reg_1","reg_2"]' },
    { 'path:agencyID': '["ECB","BIS"]', 'path:providerID': '["PROVIDER_A","PROVIDER_B"]', 'query:updatedAfter': '2025-01-01T00:00:00Z' }];
  const expected = ['/service/registration/id/reg_1,reg_2', '/service/registration/provider/ECB,BIS/PROVIDER_A,PROVIDER_B'];
  const index = JSON.parse(gunzipSync(await readFile(new URL('./catalogs/services/indexes/ecb.json.gz', import.meta.url))));
  for (const [i, path] of registrationPaths.entries()) {
    const inspectedOperation = inspected.find(operation => operation.path === path);
    assert.equal(inspectedOperation.unavailableReason, undefined);
    assert.ok(!inspectedOperation.fields.some(field => field.name === 'resourceID'));
    const prepared = prepareRequest(inspectedOperation, values[i]);
    const url = new URL(workflowRequestUrl(prepared, operationServerUrl(corrected, inspectedOperation)));
    assert.equal(url.pathname, expected[i]);
    if (i) assert.equal(url.searchParams.get('updatedAfter'), values[i]['query:updatedAfter']);
    assert.equal(index.operations.find(entry => entry.id === inspectedOperation.id).unavailableReason, undefined);
    assert.deepEqual(corrected.paths[path].get['x-upstream-parameters'], upstream.paths[path].get.parameters);
    const broken = inspectServiceSchema(upstream, 'ecb').operations.find(operation => operation.path === path);
    assert.ok(broken.unavailableReason.includes(i ? '{providerID}' : '{registrationID}'));
    assert.ok(broken.unavailableReason.includes('"resourceID"'));
  }
  assert.deepEqual(corrected.components, upstream.components);
  for (const [path, item] of Object.entries(upstream.paths)) if (!registrationPaths.includes(path)) assert.deepEqual(corrected.paths[path], item);
  assert.equal(JSON.stringify(upstream), original);
});

Then('ECB registration corrections are repeatable and preserve reviewed contract boundaries', async () => {
  const upstream = await readServiceSchemaUpstream('ecb');
  const corrected = applySchemaPatches(upstream, [ecbRegistrationParameters]);
  assert.equal(schemaPatchName(ecbRegistrationParameters), 'ECB registration path parameters');
  assert.deepEqual(applySchemaPatches(corrected, [ecbRegistrationParameters]), corrected);
  const fixed = structuredClone(corrected);
  for (const path of registrationPaths) delete fixed.paths[path].get['x-upstream-parameters'];
  assert.deepEqual(applySchemaPatches(fixed, [ecbRegistrationParameters]), fixed);
  const changes = [
    document => { document.info.version = '3.0'; },
    document => { document.servers[0].url = 'https://other.example.test'; },
    document => { document.paths[registrationPaths[0]].get.parameters = []; },
    document => { document.paths[registrationPaths[1]].get.parameters[1].$ref = '#/components/parameters/agencyID'; },
    document => { document.paths[registrationPaths[0]].get['x-upstream-parameters'] = []; },
    document => { document.components.parameters.providers.name = 'different'; },
    document => { document.paths[registrationPaths[1]].get.servers = [{ url: 'https://other.example.test' }]; },
  ];
  for (const change of changes) {
    const document = structuredClone(upstream); change(document); const original = JSON.stringify(document);
    assert.throws(() => applySchemaPatches(document, [ecbRegistrationParameters]), /ECB registration correction requires/);
    assert.equal(JSON.stringify(document), original);
  }
});
