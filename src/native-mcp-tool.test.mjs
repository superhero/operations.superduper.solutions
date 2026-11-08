// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeMcpToolFixture } from '../tests/native-mcp-tool.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeMcpToolParams, nativeMcpToolMethod } from './lib/native-mcp-tool.ts';
import { nativeAgentMethods } from './lib/native-agent-contract.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-mcp-tool' }, function () { this.mcpToolContexts = []; });
After({ tags: '@native-mcp-tool' }, async function () { for (const { f, v } of this.mcpToolContexts.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeMcpToolFixture(options), v = await nativeVaultFixture(f); world.mcpToolContexts.push({ f, v });
  const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const approved = await v.session.enableNativeWorkflow(nativeReference(paired), selections), reference = nativeReference(approved);
  const selection = selections.find(s => s.operation.rpc.method === nativeMcpToolMethod);
  const call = (method, params = {}, signal) => v.session.executeNativeRuntime(reference, selections, selections.find(s => s.operation.rpc.method === method), params, signal);
  return { f, v, selections, selection, reference, call, tool: (params, signal) => call(nativeMcpToolMethod, params, signal),
    async thread() { return (await call('thread/start')).response.result.thread.id; } };
}
const params = threadId => ({ threadId, server: 'operations_fixture', tool: 'display_only', arguments: { message: 'Hello' } });
const calls = f => f.frames.filter(frame => frame.method === nativeMcpToolMethod);
const stopped = f => waitForWatch(() => f.starts === f.stops);

Then('paired MCP tool calls preserve arguments metadata application errors and the loaded thread', async function () {
  const c = await setup(this), threadId = await c.thread(), starts = c.f.starts;
  const p = { ...params(threadId), _meta: { threadId: 'foreign-override', extra: [null, true, 7] } };
  const first = await c.tool(p); assert.equal(first.response.result.content[0].text, 'Owned MCP tool: Hello'); assert.deepEqual(first.request.params, p);
  assert.deepEqual(first.response.result.structuredContent.metadata, { threadId, extra: [null, true, 7] });
  assert.deepEqual(first.response.result._meta, { fixture: true });
  c.f.mcpToolResult = { content: [{ type: 'text', text: 'Application-level tool error.' }], isError: true, structuredContent: { reason: 'fixture' }, _meta: null };
  assert.equal((await c.tool(params(threadId))).response.result.isError, true);
  assert.equal(c.f.starts, starts, 'The loaded agent child survives repeated tool calls.'); assert.equal(calls(c.f).length, 2);
  assert.equal(c.f.frames.filter(frame => frame.method === 'thread/start').length, 1); assert.equal(c.f.frames.some(frame => frame.method === 'turn/start'), false);
});

Then('MCP tools reject missing grants old workflow approvals foreign threads and unloaded threads', { timeout: 60000 }, async function () {
  const denied = await setup(this, { allowMcpTools: false, allowMcpRead: true, allowMetadata: true, allowApps: true });
  await assert.rejects(denied.tool(params(await denied.thread()))); assert.equal(calls(denied.f).length, 0);
  const anonymous = await setup(this, { account: null, requiresOpenaiAuth: false }); await anonymous.tool(params(await anonymous.thread()));
  const required = await setup(this, { account: null, requiresOpenaiAuth: true }); await assert.rejects(required.thread(), error => error.code === 'AUTHORIZATION');
  const c = await setup(this), threadId = await c.thread();
  const prior = c.selections.filter(s => s.operation.rpc.method !== nativeMcpToolMethod);
  await assert.rejects(c.v.session.executeNativeRuntime(c.reference, prior, c.selection, params(threadId)), error => error.code === 'PERMISSION');
  assert.equal(calls(c.f).length, 0);
  await assert.rejects(c.v.session.executeNativeRuntime({ ...c.reference, requiresOpenaiAuth: false }, c.selections, c.selection, params(threadId)), error => error.code === 'INVALID');
  await assert.rejects(c.tool(params('foreign-thread'))); assert.equal(calls(c.f).length, 0); await stopped(c.f);
  await assert.rejects(c.tool(params(threadId))); assert.equal(calls(c.f).length, 0); await stopped(c.f);
  await c.call('thread/resume', { threadId }); await c.tool(params(threadId)); assert.equal(calls(c.f).length, 1);
  c.f.requiresOpenaiAuth = false;
  await assert.rejects(c.v.session.checkNativeRuntime(c.reference, c.v.selection), error => error.code === 'AUTHORIZATION');
});

Then('MCP tool parameters preserve JSON values and reject invalid or private inputs before dispatch', { timeout: 60000 }, async function () {
  const c = await setup(this), secret = 'SYNTHETIC_MCP_TOOL_PRIVATE_INPUT';
  await c.v.session.put(null, { label: 'Tool credential fixture', kind: 'secret', value: secret }); const threadId = await c.thread();
  for (const value of [null, true, 1.25, 'literal', ['a', { nested: null }], { message: 'Hello', nested: [false, 1] }]) {
    const p = { ...params(threadId), arguments: value, _meta: null }; assert.deepEqual(nativeMcpToolParams(p), p);
  }
  for (const p of [{ ...params(threadId), apiKey: 'override' }, { ...params(threadId), cwd: '/' }, { ...params(threadId), server: 'bad\0name' },
    { ...params(threadId), threadId: '../foreign' }, { ...params(threadId), arguments: undefined }, { ...params(threadId), _meta: Infinity },
    { ...params(threadId), arguments: { message: 'x'.repeat(32768) } }]) {
    const before = calls(c.f).length; await assert.rejects(c.tool(p)); assert.equal(calls(c.f).length, before);
  }
  for (const p of [{ ...params(threadId), arguments: { token: secret } }, { ...params(threadId), _meta: { nested: secret } }]) await assert.rejects(c.tool(p), error => error.code === 'REDACTED');
  assert.equal(calls(c.f).length, 0);
  const built = prepareNativeRequest(c.selection.operation, { 'params:threadId': threadId, 'params:server': 'operations_fixture', 'params:tool': 'display_only', 'params:arguments': 'true', 'params:_meta': 'null' });
  assert.equal(built.params.arguments, true); assert.equal(built.params._meta, null);
});

Then('MCP tool replies withhold malformed fields encodings and private structured or binary echoes', { timeout: 60000 }, async function () {
  const c = await setup(this), secret = 'SYNTHETIC_MCP_TOOL_PRIVATE_RESULT'; await c.v.session.put(null, { label: 'Tool echo fixture', kind: 'secret', value: secret });
  const publicResult = { content: [{ type: 'image', mimeType: 'image/png', data: 'AAEC/w==' }, { type: 'audio', mimeType: 'audio/wav', data: 'AAEC/w==' },
    { type: 'resource', resource: { uri: 'owned:resource', blob: 'AAEC/w==' } }, { type: 'resource_link', name: 'Owned link', uri: 'owned:resource' }], isError: false };
  c.f.mcpToolResult = publicResult; assert.deepEqual((await c.tool(params(await c.thread()))).response.result, publicResult);
  for (const result of [{ content: [], accessToken: 'unknown' }, { content: 'wrong' }, { content: [], isError: 'false' },
    { content: [{ type: 'image', data: 'AB==' }] }, { content: [{ type: 'audio', data: 'not base64' }] },
    { content: [{ type: 'resource', resource: { uri: 'test:owned', blob: 'invalid' } }] }, { content: Array(65).fill({ type: 'text', text: 'x' }) }]) {
    c.f.mcpToolResult = result; await assert.rejects(c.tool(params(await c.thread())), error => ['NATIVE_CONTRACT', 'LIMIT'].includes(error.code)); await stopped(c.f);
  }
  for (const result of [{ content: [], structuredContent: { nested: secret } }, { content: [], _meta: { nested: secret } },
    { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from('prefix:' + secret + ':suffix').toString('base64') }] },
    { content: [{ type: 'resource', resource: { uri: 'test:owned', blob: Buffer.from('prefix:' + secret).toString('base64') } }] }]) {
    c.f.mcpToolResult = result; await assert.rejects(c.tool(params(await c.thread())), error => error.code === 'REDACTED'); await stopped(c.f);
  }
});

Then('pending MCP tools deny server interactions and close without replay after cancellation or authority changes', { timeout: 60000 }, async function () {
  const c = await setup(this); c.f.interactMcpTool = true; await c.tool(params(await c.thread()));
  assert.equal(c.f.mcpReplies.length, 1); assert.equal(c.f.mcpReplies[0].error.code, -32601); assert.equal(c.f.mcpReplies[0].result, undefined);
  for (const mode of ['cancel', 'source', 'identity', 'sdk-error']) {
    const t = await setup(this), threadId = await t.thread(), controller = new AbortController();
    if (mode === 'sdk-error') { t.f.failMcpTool = true; await assert.rejects(t.tool(params(threadId)), error => error.code === 'NATIVE_MCP_TOOL'); continue; }
    t.f.holdMcpTool = true; const result = t.tool(params(threadId), controller.signal); await waitForWatch(() => t.f.release.length === 1);
    if (mode === 'cancel') controller.abort(); else { if (mode === 'source') t.v.enabled = false; else t.f.identity.workspace = 'd'.repeat(64); t.f.release[0](); }
    await assert.rejects(result, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'NATIVE_UNKNOWN'].includes(error.code));
    await stopped(t.f); assert.equal(calls(t.f).length, 1);
  }
});

Then('MCP tool models roundtrip JSON inputs and concrete result ports with the reviewed workflow profile', async function () {
  const c = await setup(this); assert.equal(nativeAgentMethods.includes(nativeMcpToolMethod), true);
  const { operation, document } = c.selection, graph = createOperationGraph(operation, { x: 0, y: 0 }, 'mcp-tool', document);
  const saved = { version: 3, id: 'tool-model', name: 'Tool model', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
  assert.equal(operation.fields.find(field => field.name === 'arguments').schema.type, 'json');
  const fields = graph.nodes.filter(node => node.type === 'data' && node.data.direction === 'outputs').flatMap(node => node.data.fields);
  for (const path of ['/result/content', '/result/isError', '/result/structuredContent']) assert.ok(fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === path && field.connectable));
});

Then('the real paired MCP tool runtime preserves its loaded thread and authoritative metadata', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }); let threadId;
  try { threadId = await c.thread(); } catch (error) { error.message += ' Owned SDK diagnostics: ' + JSON.stringify(c.f.sdkFailures ?? []); throw error; }
  const starts = c.f.starts;
  assert.equal((await c.v.session.nativeConnections())[0].requiresOpenaiAuth, false);
  for (const message of ['First call', 'Second call']) {
    const p = { ...params(threadId), arguments: { message }, _meta: { threadId: 'foreign-override', fixture: true } };
    const result = (await c.tool(p)).response.result; assert.equal(result.content[0].text, 'Owned MCP tool: ' + message);
    assert.equal(result.structuredContent.metadata.threadId, threadId); assert.equal(result.structuredContent.metadata.fixture, true);
    assert.ok(Number.isSafeInteger(result.structuredContent.metadata.progressToken), 'SDK progress metadata remains intact.'); assert.equal(result.isError, false);
  }
  assert.equal(c.f.starts, starts); assert.equal(calls(c.f).length, 2); assert.equal(c.f.provider.requests.some(r => /responses/.test(r.path)), false);
  c.v.session.lock(); await stopped(c.f);
});
