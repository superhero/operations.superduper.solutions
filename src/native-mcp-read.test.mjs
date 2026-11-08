// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeMcpReadFixture, nativeMcpResults } from '../tests/native-mcp-read.fixture.mjs';
import { nativeMcpUri, nativeMcpText } from '../tests/native-mcp-server.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { nativeMcpReadMethods, nativeMcpReadParams } from './lib/native-mcp-read.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { validateNativeQueryResult } from './lib/secrets/native-query-result.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-mcp-read' }, function () { this.mcpReadContexts = []; });
After({ tags: '@native-mcp-read' }, async function () { for (const { f, v } of this.mcpReadContexts.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options) {
  const f = await nativeMcpReadFixture(options), v = await nativeVaultFixture(f), source = await readServiceSchema('codex'); world.mcpReadContexts.push({ f, v });
  const selections = Object.fromEntries(nativeMcpReadMethods.map(method => { const document = scopeNativeRpcSchema(source, method); return [method, { document, operation: nativeRpcOperation(document, 'codex:' + method) }]; }));
  const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  return { f, v, selections, paired, call(method, params = {}, signal) { return v.session.executeNativeQuery(nativeReference(paired), v.selection, selections[method], params, signal); } };
}
const inputs = { server: 'operations_fixture', uri: nativeMcpUri };
const count = (f, method) => f.frames.filter(frame => frame.method === method).length;
const stopped = f => waitForWatch(() => f.starts === f.stops);

Then('paired MCP reads preserve complete typed inventories and resource metadata', async function () {
  const c = await setup(this), expected = nativeMcpResults();
  for (const method of nativeMcpReadMethods) {
    const params = method === 'mcpServerStatus/list' ? { limit: 0, cursor: null, detail: 'toolsAndAuthOnly', serverName: 'operations_fixture' } : inputs;
    const first = await c.call(method, params); assert.deepEqual(first.response.result, expected[method]); assert.deepEqual(first.request.params, params);
    const starts = c.f.starts; await c.call(method, params); assert.equal(c.f.starts, starts);
    assert.equal(count(c.f, method), 2, 'Each read is dispatched; results are never cached.');
  }
  assert.equal(count(c.f, 'mcpServer/tool/call'), 0); assert.equal(count(c.f, 'mcpServer/oauth/login'), 0);
});

Then('MCP read tickets cannot borrow other native grants or acquire tool or login authority', async function () {
  const denied = await setup(this, { allowMcpRead: false, allowMetadata: true, allowApps: true, allowAgent: true, allowFilesystemRead: true, allowSectionsRead: true });
  for (const method of nativeMcpReadMethods) {
    await assert.rejects(denied.call(method, method === 'mcpServerStatus/list' ? {} : inputs), error => error.code === 'NATIVE_MCP_READ'); assert.equal(count(denied.f, method), 0);
  }
  const c = await setup(this); c.v.session.lock(); await stopped(c.f);
  for (const method of ['mcpServer/tool/call', 'mcpServer/oauth/login']) assert.equal((await c.f.ticket({ connectionId: crypto.randomUUID(), method, fingerprint: 'c'.repeat(64) })).status, 400);
  const ticket = await c.f.ticket({ connectionId: crypto.randomUUID(), method: 'mcpServerStatus/list', fingerprint: 'c'.repeat(64) }); assert.equal(ticket.status, 200);
  const socket = await c.f.socket(ticket.value.ticket); await socket.next();
  socket.ws.send(JSON.stringify({ id: 'initialize', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1.0.0' }, capabilities: { experimentalApi: true } } })); await socket.next();
  socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'wrong-scope', method: 'mcpServer/resource/read', params: inputs }));
  await waitForWatch(() => socket.ws.readyState === 3); assert.equal(count(c.f, 'mcpServer/resource/read'), 0); await socket.close();
});

Then('MCP read parameters reject thread state configuration overrides and invalid hosted targets', async function () {
  const c = await setup(this);
  assert.deepEqual(nativeMcpReadParams('mcpServerStatus/list', { limit: null }), { limit: 8 });
  assert.deepEqual(nativeMcpReadParams('mcpServerStatus/list', { limit: 0 }), { limit: 0 });
  const target = { connectorId: 'owned-app', linkId: null }, request = { server: 'codex_apps', uri: 'app://owned/resource', target, connectorId: 'owned-app' };
  assert.deepEqual(nativeMcpReadParams('mcpServer/resource/read', request), request);
  for (const [method, params] of [
    ['mcpServerStatus/list', { limit: 65 }], ['mcpServerStatus/list', { limit: 1.5 }], ['mcpServerStatus/list', { detail: 'brief' }],
    ['mcpServerStatus/list', { threadId: 'foreign' }], ['mcpServerStatus/list', { serverName: 'bad\0name' }],
    ['mcpServer/resource/read', { ...inputs, uri: '/local/file' }], ['mcpServer/resource/read', { ...inputs, originCallId: 'foreign' }],
    ['mcpServer/resource/read', { ...inputs, target }], ['mcpServer/resource/read', { ...request, target: { connectorId: 'owned-app' } }],
    ['mcpServer/resource/read', { ...request, target: { ...target, linkId: 'synthetic_link::fake' } }],
    ['mcpServer/resource/read', { ...request, target: { ...target, authorization: 'override' } }]
  ]) { const before = c.f.frames.length; await assert.rejects(c.call(method, params)); assert.equal(c.f.frames.length, before); }
  assert.throws(() => prepareNativeRequest(c.selections['mcpServerStatus/list'].operation, { 'params:limit': '65' }));
  assert.throws(() => prepareNativeRequest(c.selections['mcpServer/resource/read'].operation, { 'params:server': 'codex_apps', 'params:uri': 'app://a', 'params:target': JSON.stringify({ connectorId: 'a', linkId: 'synthetic_link::x' }) }), error => error.fieldKey === 'params:target.linkId');
});

Then('MCP read results enforce typed fields bounded JSON canonical blobs and private credential scans', async function () {
  const c = await setup(this), s = c.selections['mcpServerStatus/list'], good = nativeMcpResults();
  const validate = value => validateNativeQueryResult(value, s.operation.rpc.workflowResult, s.document, true);
  assert.deepEqual(validate(good['mcpServerStatus/list']), good['mcpServerStatus/list']);
  assert.throws(() => validateNativeQueryResult(good['mcpServerStatus/list'], s.operation.rpc.workflowResult, s.document), error => error.code === 'NATIVE_CONTRACT', 'Unclassified JSON stays forbidden outside the explicit MCP result profile.');
  for (const patch of [{ authStatus: 'invented' }, { accessToken: 'unclassified' }, { serverInfo: { name: 'missing-version' } },
    { tools: { invalid: { name: 'invalid' } } }, { serverCapabilities: { nested: undefined } }, { serverCapabilities: { nested: Infinity } }]) {
    const data = structuredClone(good['mcpServerStatus/list']); Object.assign(data.data[0], patch);
    assert.throws(() => validate(data), error => error.code === 'NATIVE_CONTRACT');
  }
  c.f.mcpResults['mcpServerStatus/list'].data = Array.from({ length: 65 }, () => structuredClone(good['mcpServerStatus/list'].data[0]));
  await assert.rejects(c.call('mcpServerStatus/list'), error => error.code === 'LIMIT');
  const secret = 'OWNED_SYNTHETIC_MCP_CREDENTIAL'; await c.v.session.put(null, { label: 'MCP secret fixture', kind: 'secret', value: secret });
  for (const result of [{ contents: [{ uri: nativeMcpUri, text: secret }] }, { contents: [{ uri: nativeMcpUri, blob: Buffer.from('prefix:' + secret + ':suffix').toString('base64') }] },
    { contents: [{ uri: nativeMcpUri, text: 'safe', _meta: { nested: secret } }] }]) {
    c.f.mcpResults['mcpServer/resource/read'] = result; await assert.rejects(c.call('mcpServer/resource/read', inputs), error => error.code === 'REDACTED'); await stopped(c.f);
  }
  for (const content of [{ uri: nativeMcpUri, blob: 'AB==' }, { uri: nativeMcpUri, blob: 'not base64' }, { uri: nativeMcpUri, text: 'x'.repeat(32769) }]) {
    c.f.mcpResults['mcpServer/resource/read'] = { contents: [content] }; await assert.rejects(c.call('mcpServer/resource/read', inputs), error => error.code === 'NATIVE_CONTRACT');
  }
});

Then('pending MCP reads close on cancellation source changes and stale runtime authority', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'sdk-error']) {
    const c = await setup(this), controller = new AbortController();
    if (mode === 'sdk-error') { c.f.failMcp = true; await assert.rejects(c.call('mcpServer/resource/read', inputs), error => error.code === 'NATIVE_MCP_READ'); continue; }
    c.f.holdMcp = true; const pending = c.call('mcpServer/resource/read', inputs, controller.signal); await waitForWatch(() => c.f.release.length === 1);
    if (mode === 'cancel') controller.abort(); else { if (mode === 'source') c.v.enabled = false; else c.f.identity.configuration = 'd'.repeat(64); c.f.release[0](); }
    await assert.rejects(pending, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'NATIVE_MCP_READ'].includes(error.code));
    await stopped(c.f); assert.equal(count(c.f, 'mcpServer/resource/read'), 1);
  }
});

Then('MCP read models roundtrip nullable targets and expose concrete native result ports', async function () {
  const c = await setup(this);
  for (const [method, { operation, document }] of Object.entries(c.selections)) {
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'mcp', document), saved = { version: 3, id: 'mcp-model', name: 'MCP model', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
    const fields = graph.nodes.filter(node => node.type === 'data' && node.data.direction === 'outputs').flatMap(node => node.data.fields);
    assert.ok(fields.find(field => JSON.parse(decodeURIComponent(field.id))[1] === (method === 'mcpServerStatus/list' ? '/result/data' : '/result/contents'))?.connectable);
    assert.equal(operation.fields.some(field => field.name === 'threadId'), false);
  }
  const target = c.selections['mcpServer/resource/read'].operation.fields.find(field => field.name === 'target');
  assert.equal(target.schema.nullable, true); assert.equal(target.schema.properties.linkId.nullable, true);
});

Then('the real paired MCP runtime discovers its owned server and preserves resource encodings', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true });
  const inventory = (await c.call('mcpServerStatus/list', { serverName: 'operations_fixture', limit: 1 })).response.result;
  assert.equal(inventory.data.length, 1); const server = inventory.data[0]; assert.equal(server.name, 'operations_fixture'); assert.equal(server.serverInfo.name, 'operations-fixture');
  assert.ok(Object.values(server.tools).some(tool => tool.name === 'display_only')); assert.ok(server.resources.some(resource => resource.uri === nativeMcpUri));
  const result = (await c.call('mcpServer/resource/read', inputs)).response.result;
  assert.equal(result.contents[0].text, nativeMcpText); assert.deepEqual(result.contents[0]._meta, { fixture: [true, null, 2] }); assert.equal(result.contents[1].blob, 'AAEC/w==');
  await assert.rejects(c.call('mcpServer/resource/read', { ...inputs, server: 'missing-owned-server' }), error => error.code === 'NATIVE_MCP_READ');
  c.v.session.lock(); await stopped(c.f); assert.equal(count(c.f, 'mcpServer/tool/call'), 0); assert.equal(count(c.f, 'mcpServer/oauth/login'), 0);
});
