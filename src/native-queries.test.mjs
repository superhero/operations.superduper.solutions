// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeQueryFixture, nativeMetadataResults } from '../tests/native-query.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeQueryMethods, nativeAppQueryMethods } from './lib/native-runtime-contract.ts';
import { nativeQueryParams } from './lib/native-query-contract.ts';
import { prepareNativeQueryPaths } from '../companions/codex/query.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-queries' }, function () { this.queries = []; });
After({ tags: '@native-queries' }, async function () { for (const { v, f } of this.queries.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options) {
  const f = await nativeQueryFixture(options), v = await nativeVaultFixture(f); world.queries.push({ f, v });
  const source = await readServiceSchema('codex');
  const selections = Object.fromEntries(nativeQueryMethods.map(method => {
    const document = scopeNativeRpcSchema(source, method); return [method, { document, operation: nativeRpcOperation(document, 'codex:' + method) }];
  }));
  return { f, v, selections };
}
const wait = async predicate => { const end = Date.now() + 2000; while (!predicate()) { assert.ok(Date.now() < end, 'Owned query transition timed out.'); await new Promise(resolve => setTimeout(resolve, 5)); } };
const execute = (v, paired, selection, params = {}, signal) => v.session.executeNativeQuery(nativeReference(paired), v.selection, selection, params, signal);

Then('all reviewed metadata queries run through encrypted pairing and exact method scopes', async function () {
  const { f, v, selections } = await setup(this), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  assert.equal(paired.accountType, 'none'); assert.equal(paired.workflowFingerprint, undefined);
  for (const method of nativeQueryMethods) {
    const selected = selections[method], params = method === 'model/list' ? { cursor: 'page-2', limit: 2, includeHidden: true }
      : method === 'permissionProfile/list' ? { cwd: '.', limit: 2 } : method === 'hooks/list' ? { cwds: ['.'] }
      : method === 'app/read' ? { appIds: ['fixture-app', 'fixture-app', 'missing-app'], includeTools: true }
      : method === 'app/installed' ? { forceRefresh: true } : method === 'app/list' ? { cursor: '2', limit: 2, forceRefetch: true }
      : method === 'fuzzyFileSearch' ? { query: 'fixture', roots: ['.'], cancellationToken: 'owned-search' }
      : method.startsWith('fs/') ? { path: method === 'fs/readDirectory' ? '.' : 'fixture.txt' } : {};
    const result = await execute(v, paired, selected, params);
    assert.deepEqual(result.request, { protocol: 'json-rpc', method, params: nativeQueryParams(method, params) });
    assert.deepEqual(result.response.result, f.metadataResults[method]);
    const frames = f.frames.filter(frame => frame.method === method); assert.equal(frames.length, 1);
    if (method === 'permissionProfile/list') assert.equal(frames[0].params.cwd, f.workspace);
    if (method === 'hooks/list') assert.deepEqual(frames[0].params.cwds, [f.workspace]);
    assert.deepEqual(selected.operation.capabilities.requirements.map(item => item.code), ['native-host', 'native-method']);
    const before = f.starts; await execute(v, paired, selected, params); assert.equal(f.starts, before, 'The same exact method scope can be reused.');
  }
  assert.ok(f.frames.every(frame => !frame.method || ['initialize', 'initialized', 'account/read', ...nativeQueryMethods].includes(frame.method)));
  assert.equal(JSON.stringify(v.storage.state).includes(f.key), false);
  v.session.lock(); await wait(() => f.stops === f.starts); await v.session.unlock(v.proof);
  assert.deepEqual((await execute(v, paired, selections['modelProvider/capabilities/read'])).response.result, f.metadataResults['modelProvider/capabilities/read']);
});

Then('native metadata tickets reject missing opt-in and methods outside their selected scope', async function () {
  const disabled = await setup(this, { allowMetadata: false, allowAgent: true }), paired = await disabled.v.session.pairNativeRuntime(disabled.v.input, disabled.v.selection);
  const starts = disabled.f.starts;
  await assert.rejects(execute(disabled.v, paired, disabled.selections['model/list']), error => error.code === 'NATIVE_QUERY');
  assert.equal(disabled.f.starts, starts, 'An unapproved metadata ticket cannot start a new child.');
  const { f } = await setup(this);
  const ticket = await f.ticket({ connectionId: randomUUID(), method: 'model/list', fingerprint: 'c'.repeat(64) }), socket = await f.socket(ticket.value.ticket);
  await socket.next(); socket.ws.send(JSON.stringify({ id: 'initialize', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } }));
  await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'wrong-method', method: 'thread/start', params: {} }));
  assert.equal(await socket.next(), undefined); await socket.close(); assert.equal(f.frames.some(frame => frame.method === 'thread/start'), false);
  assert.throws(() => nativeQueryParams('command/exec', {}));
});

Then('native metadata inputs and canonical directories reject overrides escapes and private homes', async function () {
  const { f, v, selections } = await setup(this), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const operation = selections['model/list'].operation;
  assert.deepEqual(prepareNativeRequest(operation, { 'params:limit': '2', 'params:includeHidden': 'false' }).params, { limit: 2, includeHidden: false });
  for (const input of [{ 'params:limit': '65' }, { 'params:limit': '1.5' }, { 'params:includeHidden': '1' }, { 'params:cwd': '/' }]) assert.throws(() => prepareNativeRequest(operation, input));
  for (const [method, params] of [['model/list', { apiKey: 'no' }], ['model/list', { limit: -1 }], ['model/list', { includeHidden: 'true' }],
    ['hooks/list', { cwds: Array(9).fill('.') }], ['hooks/list', { cwds: [null] }], ['permissionProfile/list', { cwd: '\0' }]]) {
    const before = f.frames.length; await assert.rejects(execute(v, paired, selections[method], params)); assert.equal(f.frames.length, before);
  }
  await mkdir(join(f.workspace, 'sub')); await mkdir(join(f.workspace, 'private-home')); await symlink(f.home, join(f.workspace, 'escape'));
  assert.deepEqual((await prepareNativeQueryPaths('hooks/list', { cwds: ['sub', '.'] }, f.workspace, f.home)).cwds, [join(f.workspace, 'sub'), f.workspace]);
  for (const cwd of ['..', f.home, 'escape']) {
    const before = f.frames.filter(frame => frame.method === 'permissionProfile/list').length;
    await assert.rejects(execute(v, paired, selections['permissionProfile/list'], { cwd }), error => error.code === 'NATIVE_QUERY');
    assert.equal(f.frames.filter(frame => frame.method === 'permissionProfile/list').length, before);
  }
  await assert.rejects(prepareNativeQueryPaths('permissionProfile/list', { cwd: 'private-home' }, f.workspace, join(f.workspace, 'private-home')));
});

Then('native metadata results validate nested variants required fields and private credential echoes', async function () {
  const { f, v, selections } = await setup(this), paired = await v.session.pairNativeRuntime(v.input, v.selection), example = nativeMetadataResults();
  const hooks = selections['hooks/list'], base = example['hooks/list'].data[0].hooks[0];
  for (const variant of [{ handlerType: 'command', command: 'echo test', async: false }, { handlerType: 'mcpTool', server: 'local', tool: 'read' },
    { handlerType: 'prompt' }, { handlerType: 'agent' }]) {
    const { handlerType: _kind, command: _command, async: _async, ...common } = base;
    const result = { data: [{ ...example['hooks/list'].data[0], hooks: [{ ...common, ...variant }] }] };
    assert.deepEqual(validateNativeQueryResult(result, hooks.operation.rpc.workflowResult, hooks.document), result);
  }
  for (const variant of [{ ...base, accessToken: 'unclassified' }, { ...base, handlerType: 'command', server: 'borrowed', tool: 'read' }, { ...base, timeoutSec: -1 }]) {
    assert.throws(() => validateNativeQueryResult({ data: [{ ...example['hooks/list'].data[0], hooks: [variant] }] }, hooks.operation.rpc.workflowResult, hooks.document), error => error.code === 'NATIVE_CONTRACT');
  }
  const secret = 'SYNTHETIC_NATIVE_METADATA_SECRET'; await v.session.put(null, { label: 'Metadata echo fixture', kind: 'secret', value: secret });
  f.metadataResults['model/list'].data[0].description = secret;
  await assert.rejects(execute(v, paired, selections['model/list']), error => error.code === 'REDACTED'); await wait(() => f.stops === f.starts);
  const before = f.frames.length; await assert.rejects(execute(v, paired, selections['model/list'], { cursor: secret }), error => error.code === 'REDACTED'); assert.equal(f.frames.length, before);
  f.metadataResults['model/list'] = { ...example['model/list'], accessToken: 'unclassified' };
  await assert.rejects(execute(v, paired, selections['model/list']), error => error.code === 'NATIVE_CONTRACT');
  f.metadataResults['modelProvider/capabilities/read'] = { imageGeneration: true };
  await assert.rejects(execute(v, paired, selections['modelProvider/capabilities/read']), error => error.code === 'NATIVE_CONTRACT');
});

Then('native metadata cancellation and stale authority stop their owned pending query', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'stale', 'sdk-error']) {
    const { f, v, selections } = await setup(this), paired = await v.session.pairNativeRuntime(v.input, v.selection), controller = new AbortController();
    const selection = selections['model/list'];
    if (mode === 'stale') {
      const before = f.frames.length;
      await assert.rejects(v.session.executeNativeQuery({ ...nativeReference(paired), revision: 2 }, v.selection, selection, {}), error => error.code === 'CONFLICT');
      assert.equal(f.frames.length, before); continue;
    }
    if (mode === 'sdk-error') { f.failQuery = true; await assert.rejects(execute(v, paired, selection), error => error.code === 'NATIVE_QUERY'); continue; }
    f.holdQuery = true; const result = execute(v, paired, selection, {}, controller.signal);
    await wait(() => f.release.length === 1);
    if (mode === 'cancel') controller.abort(); else { if (mode === 'source') v.enabled = false; else f.identity.workspace = 'd'.repeat(64); f.release[0](); }
    await assert.rejects(result, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'NATIVE_QUERY'].includes(error.code));
    await wait(() => f.stops === f.starts);
  }
});

Then('native metadata models expose native inputs and concrete result fields without HTTP adaptation', async function () {
  const { selections } = await setup(this);
  for (const [method, { operation, document }] of Object.entries(selections)) {
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'query', document);
    const saved = { version: 3, id: 'metadata-model', name: 'Metadata model', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved); assert.deepEqual(portableWorkflowDocument(saved), saved);
    const result = graph.nodes.find(node => node.type === 'data' && node.data.label === 'Result');
    assert.ok(result.data.fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === '/result' && field.type === 'Object' && field.connectable), method);
    const output = graph.nodes.filter(node => node.type === 'data' && node.data.direction === 'outputs').flatMap(node => node.data.fields);
    for (const [path, type] of method === 'modelProvider/capabilities/read'
      ? [['/result/imageGeneration', 'Boolean'], ['/result/webSearch', 'Boolean']] : method === 'fs/readFile' ? [['/result/dataBase64', 'Text']]
        : method === 'fs/getMetadata' ? [['/result/isFile', 'Boolean'], ['/result/modifiedAtMs', 'Integer']]
          : [[method === 'app/read' || method === 'app/installed' ? '/result/apps' : method === 'fs/readDirectory' ? '/result/entries' : method === 'fuzzyFileSearch' ? '/result/files' : '/result/data', 'Array']]) {
      const field = output.find(field => JSON.parse(decodeURIComponent(field.id))[1] === path);
      assert.ok(field?.connectable, method + path); assert.equal(field.type, type, method + path);
    }
    const fields = graph.nodes.filter(node => node.type === 'data').flatMap(node => node.data.fields);
    assert.equal(fields.some(field => /HTTP|status code/i.test(field.label)), false);
    assert.deepEqual(scopeNativeRpcSchema(document, method), document);
  }
});

Then('app metadata needs its own host opt-in and rejects loaded thread inputs', async function () {
  for (const flags of [{ allowMetadata: true, allowAgent: false }, { allowMetadata: false, allowAgent: true }]) {
    const { f, v, selections } = await setup(this, { ...flags, allowApps: false }), paired = await v.session.pairNativeRuntime(v.input, v.selection), before = f.starts;
    for (const method of nativeAppQueryMethods) await assert.rejects(execute(v, paired, selections[method], method === 'app/read' ? { appIds: [] } : {}), error => error.code === 'NATIVE_QUERY');
    assert.equal(f.starts, before);
  }
  const { f, v, selections } = await setup(this, { allowApps: true, allowMetadata: false }), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  for (const method of nativeAppQueryMethods) {
    const params = method === 'app/read' ? { appIds: ['fixture-app'], includeTools: true } : method === 'app/installed' ? { forceRefresh: true } : { forceRefetch: true };
    assert.deepEqual((await execute(v, paired, selections[method], params)).response.result, f.metadataResults[method]);
    const before = f.frames.length;
    await assert.rejects(execute(v, paired, selections[method], { ...params, threadId: 'foreign-thread' })); assert.equal(f.frames.length, before);
  }
  const invalid = [{}, { appIds: Array(101).fill('app') }, { appIds: ['\0'] }, { appIds: [1] }, { appIds: [], includeTools: 'true' }];
  for (const params of invalid) assert.throws(() => nativeQueryParams('app/read', params));
  const operation = selections['app/read'].operation;
  assert.deepEqual(prepareNativeRequest(operation, { 'params:appIds': '["one","one","two"]', 'params:includeTools': 'true' }).params, { appIds: ['one', 'one', 'two'], includeTools: true });
  assert.throws(() => nativeQueryParams('app/installed', { forceRefresh: null }));
  await assert.rejects(execute(v, paired, selections['model/list']), error => error.code === 'NATIVE_QUERY');
});

Then('app metadata validates structured display fields and withholds unknown or private values', async function () {
  const { f, v, selections } = await setup(this), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  await execute(v, paired, selections['app/list']);
  const secret = 'SYNTHETIC_APP_METADATA_SECRET'; await v.session.put(null, { label: 'App metadata fixture', kind: 'secret', value: secret });
  f.metadataResults['app/list'].data[0].labels.purpose = secret;
  await assert.rejects(execute(v, paired, selections['app/list']), error => error.code === 'REDACTED');
  const before = f.frames.length;
  await assert.rejects(execute(v, paired, selections['app/read'], { appIds: [secret] }), error => error.code === 'REDACTED'); assert.equal(f.frames.length, before);
  f.metadataResults['app/list'] = nativeMetadataResults()['app/list']; f.metadataResults['app/list'].data[0].labels.purpose = 1;
  await assert.rejects(execute(v, paired, selections['app/list']), error => error.code === 'NATIVE_CONTRACT');
  f.metadataResults['app/read'].apps[0].toolSummaries[0].inputSchema = { type: 'object' };
  await assert.rejects(execute(v, paired, selections['app/read'], { appIds: ['fixture-app'] }), error => error.code === 'NATIVE_CONTRACT');
  f.metadataResults['app/installed'].apps[0].accessToken = 'unclassified';
  await assert.rejects(execute(v, paired, selections['app/installed']), error => error.code === 'NATIVE_CONTRACT');
});

Then('app queries discard update notifications deny server interactions and never replay cancelled refreshes', async function () {
  const { f, v, selections } = await setup(this, { onFrame(frame, fixture) {
    if (frame.id === 'app-server-interaction') { fixture.serverReply = structuredClone(frame); return true; }
  } }), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  f.holdQuery = true; let result = execute(v, paired, selections['app/list']); await wait(() => f.release.length === 1);
  f.emit({ id: 'app-server-interaction', method: 'item/tool/call', params: { command: 'unapproved' } });
  await wait(() => !!f.serverReply); assert.equal(f.serverReply.error.code, -32601);
  f.emit({ method: 'app/list/updated', params: { data: [{ accessToken: 'never published' }] } });
  f.release.shift()(); assert.deepEqual((await result).response.result, f.metadataResults['app/list']);
  const controller = new AbortController(); result = execute(v, paired, selections['app/installed'], { forceRefresh: true }, controller.signal);
  await wait(() => f.release.length === 1); controller.abort(); await assert.rejects(result, error => error.code === 'CANCELLED');
  await wait(() => f.starts === f.stops);
  assert.equal(f.frames.filter(frame => frame.method === 'app/installed').length, 1);
});
