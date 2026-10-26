// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { assistantSettingsKey, bonsaiRuntime, bonsaiModels, assistantModels, settingsForAssistantModel, defaultAssistantSettings, validateAssistantSettings } from './lib/assistant/config.ts';
import { assistantSkills, readAssistantSkill } from './lib/assistant/skills.ts';
import { assistantToolDefinitions, enabledAssistantTools, executeAssistantTool, validateToolObject, assistantReadable } from './lib/assistant/tools.ts';
import { editAssistantWorkspace } from './lib/assistant/workspace.ts';
import { fetchBonsaiRuntime, loadBonsaiEngine } from './lib/assistant/engine.ts';
import { probeAssistantCompatibility, probeCompute } from './lib/assistant/compatibility.ts';
import { localAssistantStream, nativeMessages, nativeToolCalls, createAssistantSession } from './lib/assistant/pi-session.ts';
import { encodeError, decodeError } from './lib/worker-rpc.ts';
import { readWorkflowFile } from './lib/workflow-file.ts';
import { renderMarkdown } from './lib/markdown.ts';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { createOperationGraph, createUtilityNode } from './lib/workflow-graph.ts';

const settings = () => ({ ...defaultAssistantSettings });
const operation = (id = 'demo:test') => ({ id, name: 'Test operation', description: 'Find a test', method: 'GET', path: '/test', group: 'Tests', fields: [], bodyRequired: false });
const document = (nodes = [], edges = []) => ({ version: 3, id: 'current', name: 'Example', description: 'A saved workflow', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: true });
const signal = () => new AbortController().signal;
const edit = (kind, rest) => ({ workflowId: 'current', kind, ...rest });
const controller = () => new AbortController();
const reject = (fn, pattern) => assert.rejects(fn, pattern);
const okResult = text => ({ message: { content: text }, usage: { prompt_tokens: 15, completion_tokens: 2, cached_tokens: 3 } });
const callResult = (name, args) => ({ message: { tool_calls: [{ id: 'call', function: { name, arguments: args } }] } });

Then('assistant publication coalesces token bursts and retains image message identity', async () => {
  const updates = []; let pending, scheduled = 0;
  const session = createAssistantSession({ async reset() {}, async generate(messages, { onText }) {
    assert.ok(messages.some(message => message.role === 'user' && Array.isArray(message.content) && message.content.some(part => part.type === 'image')));
    for (let i = 0; i < 100; i++) onText('delta ');
    return okResult('delta '.repeat(100));
  } }, { ...settings(), tools: false }, () => assert.fail(), part => ({ type: 'image', mimeType: part.mimeType }), state => updates.push(state), callback => { scheduled++; pending = callback; });
  await session.send('', [{ type: 'image', mimeType: 'image/png', data: 'image-payload' }]);
  assert.ok(scheduled > 100); assert.equal(updates.length, 0);
  pending();
  assert.equal(updates.length, 1); assert.equal(updates[0].messages[0].imageCount, 1);
  assert.equal(updates[0].messages[0].text, ''); assert.equal(updates[0].messages[1].text, 'delta '.repeat(100));
  assert.ok(!JSON.stringify(updates[0]).includes('image-payload'));
  await session.reset(); pending(); assert.deepEqual(updates.at(-1), { messages: [], error: '' });
});

Then('the local assistant preserves accepted profiles and rejects unsupported engine settings', () => {
  assert.equal(assistantSettingsKey, 'v1/settings/assistant');
  assert.deepEqual(bonsaiModels.map(m => m.id), ['2b', '4b', '9b', '27b']);
  for (const model of bonsaiModels) { assert.match(model.revision, /^[0-9a-f]{40}$/); assert.equal(model.projector, null); assert.match(model.file, /PTQ1_0/); assert.ok(model.bytes > 400e6); assert.match(model.run, new RegExp(model.attempt)); }
  assert.match(bonsaiRuntime.url, /621e20782f208660f4f58283c2ce58430020f243/);
  assert.equal(assistantModels.length, 8);
  for (const profile of assistantModels) {
    const configured = settingsForAssistantModel(profile.id, settings());
    assert.equal(configured.model, profile.id); assert.equal(profile.projector, null);
    assert.ok(configured.maxTokens < configured.context);
  }
  const gemma = settingsForAssistantModel('gemma-e2b', settings());
  assert.equal(gemma.maxTokens, 256); assert.equal(gemma.requestTimeout, 1200000);
  for (const unsupported of [{sampling:true}, {thinking:true}, {prefixCache:true}, {executionMode:'cpu'}, {context:8192}])
    assert.throws(() => validateAssistantSettings({...gemma, ...unsupported}), /Gemma/);
  assert.throws(() => validateAssistantSettings({...settingsForAssistantModel('ornith-q4', settings()), executionMode:'cpu'}), /4 GiB/);
  assert.equal(validateAssistantSettings({...settingsForAssistantModel('minicpm5-2b', settings()), executionMode:'cpu'}).executionMode, 'cpu');

  assert.deepEqual(validateAssistantSettings({}), settings());
  for (const value of [null, [], 3, { bad: 1 }, { model: 'unavailable-model' }, {executionMode:'unknown'}, {executionMode:'cpu'}]) assert.throws(() => validateAssistantSettings(value));
  for (const key of ['sampling', 'thinking', 'prefixCache', 'tools', 'editing', 'skills']) assert.throws(() => validateAssistantSettings({ [key]: 1 }));
  for (const key of ['context', 'maxTokens', 'topK', 'seed', 'imagePixels', 'maxTurns', 'maxToolCalls', 'responseTimeout', 'requestTimeout', 'loadTimeout'])
    for (const value of [-1, Infinity, 1.1, '2']) assert.throws(() => validateAssistantSettings({ [key]: value }));
  for (const key of ['temperature', 'topP', 'minP']) for (const value of [-1, 10, NaN, Infinity]) assert.throws(() => validateAssistantSettings({ [key]: value }));
  assert.throws(() => validateAssistantSettings({ context: 512, maxTokens: 512 }), /Output tokens/);
  assert.throws(() => validateAssistantSettings({ responseTimeout: 10000, requestTimeout: 1000 }), /Response timeout/);
  assert.equal(validateAssistantSettings({ model: '9b', context: 32768, maxTokens: 20000, seed: 4294967295 }).model, '9b');
});

function hostFixture() {
  const state = document([createUtilityNode('cast', { x: 0, y: 0 }, 'cast')]);
  return { application: () => ({ summary: { app: 'Operations' }, settings: { theme: 'dark' }, catalogs: ['one', 'two'], workflows: ['example'] }),
    operations: () => [operation(), operation('other:demo')], operation: async id => ({ id, inputs: [] }),
    schema: async () => ({ paths: { '/test~name': { get: { summary: 'Operation' } } }, items: [null, true], count: 2, missing: null }),
    workflow: id => { assert.ok(!id || id === state.id); return state; }, ports: async id => [{ nodeId: id, handle: 'result', direction: 'output', label: 'Text', available: true }],
    edit: async value => ({ applied: value.kind }) };
}
Then('assistant tools page application state and reject unavailable capabilities', async () => {
  const host = hostFixture(), s = settings(), run = (name, args, config = s) => executeAssistantTool(host, config, name, args, signal());
  assert.equal(enabledAssistantTools({ tools: false, editing: true, skills: true }).length, 0);
  assert.equal(enabledAssistantTools({ tools: true, editing: false, skills: false }).length, 6);
  assert.equal(enabledAssistantTools(s).length, 10);
  await reject(() => run('run_workflow', {}), /not available/);
  await reject(() => run('add_operation', {}, { ...s, editing: false }), /not available/);
  const aborted = controller(); aborted.abort(); await reject(() => executeAssistantTool(host, s, 'read_application', { section: 'summary' }, aborted.signal));
  assert.deepEqual(await run('read_application', { section: 'summary' }), { app: 'Operations' });
  assert.deepEqual((await run('read_application', { section: 'catalogs', limit: 1 })).items, ['one']);
  assert.equal((await run('read_application', { section: 'catalogs', limit: 1 })).nextOffset, 1);
  assert.equal((await run('read_application', { section: 'catalogs', offset: 1, limit: 1 })).nextOffset, null);
  assert.equal((await run('search_operations', { query: 'GET test', catalogId: 'demo', limit: 1 })).total, 1);
  assert.equal((await run('search_operations', { query: '' })).total, 2);
  assert.equal((await run('search_operations', { query: 'not-found' })).total, 0);
  assert.equal((await run('read_operation', { operationId: 'demo:test' })).id, 'demo:test');
  const root = await run('read_schema', { catalogId: 'demo', pointer: '' });
  assert.deepEqual(root.items[0].value.keys, ['/test~name']);
  assert.equal((await run('read_schema', { catalogId: 'demo', pointer: '/paths' })).items[0].pointer, '/paths/~1test~0name');
  assert.equal((await run('read_schema', { catalogId: 'demo', pointer: '/paths/~1test~0name/get/summary' })), 'Operation');
  assert.equal((await run('read_schema', { catalogId: 'demo', pointer: '/items' })).items[1].value, true);
  assert.equal((await run('read_schema', { catalogId: 'demo', pointer: '/count' })), 2);
  assert.equal((await run('read_schema', { catalogId: 'demo', pointer: '/missing' })), null);
  for (const pointer of ['bad', '/~x', '/absent', '/missing/child', '/count/no']) await reject(() => run('read_schema', { catalogId: 'demo', pointer }));
  assert.equal((await run('read_workflow', { section: 'summary' })).workflowId, 'current');
  assert.equal((await run('read_workflow', { section: 'nodes', nodeId: 'cast', workflowId: 'current' })).items.length, 1);
  assert.equal((await run('read_workflow', { section: 'nodes' })).total, 1);
  host.workflow = () => document([], [{ id: 'a', source: 'a', target: 'b' }, { id: 'b', source: 'c', target: 'a' }, { id: 'c', source: 'c', target: 'd' }]);
  assert.equal((await run('read_workflow', { section: 'connections' })).total, 3);
  assert.equal((await run('read_workflow', { section: 'connections', nodeId: 'a' })).total, 2);
  assert.equal((await run('read_ports', { nodeId: 'cast' }))[0].handle, 'result');
  assert.match(await run('read_skill', { path: assistantSkills[0].path }), /Never run/);
  assert.throws(() => readAssistantSkill('/etc/passwd'), /Unknown/);
  assert.deepEqual(await run('add_operation', { workflowId: 'current', operationId: 'demo:test', x: 10, y: -10 }), { applied: 'add_operation' });
  host.operation = async () => ({ long: 'x'.repeat(12001) }); await reject(() => run('read_operation', { operationId: 'demo:test' }), /too large/);
  const cancel = controller(); host.ports = async () => { cancel.abort(); return []; };
  await reject(() => executeAssistantTool(host, s, 'read_ports', { nodeId: 'cast' }, cancel.signal));
});
Then('assistant tools validate every argument and omit credential and file payloads', () => {
  assert.doesNotMatch(renderMarkdown('![<private>](https://example.com/leak)', 'assistant', false), /<img/);
  assert.match(renderMarkdown('![<private>](https://example.com/leak)', 'assistant', false), /&lt;private&gt;/);
  const schema = assistantToolDefinitions.find(tool => tool.name === 'move_nodes').parameters;
  for (const value of [null, [], {}, { workflowId: 'w', bad: 2 }, { workflowId: 5, moves: [] }, { workflowId: 'w', moves: [] }, { workflowId: 'w', moves: Array(21).fill({}) },
    { workflowId: 'w', moves: [{ nodeId: 'n', x: NaN, y: 0 }] }, { workflowId: 'w', moves: [{ nodeId: 'n', x: 1e9, y: 0 }] },
    { workflowId: 'w', moves: [{ nodeId: 'x'.repeat(513), x: 0, y: 0 }] }, { workflowId: 'w', moves: 'no' }]) assert.throws(() => validateToolObject(schema, value));
  validateToolObject(schema, { workflowId: 'w', moves: [{ nodeId: 'n', x: -1.5, y: 100 }] });
  assert.throws(() => validateToolObject({ type: 'integer', minimum: 0, maximum: 20 }, 1.5));
  assert.throws(() => validateToolObject({ enum: ['summary'] }, 'run'));
  assert.deepEqual(assistantReadable({ credentialBinding: { id: 'secret' }, credentialId: 'vault', file: { name: 'data.json', format: 'json', source: 'private', value: 'private' }, ordinary: { content: 'schema data', password: 'secret' } }),
    { credentialBinding: '[omitted]', credentialId: '[omitted]', file: { name: 'data.json', format: 'json', payload: '[omitted]' }, ordinary: { content: 'schema data', password: '[omitted]' } });
});

Then('assistant workspace edits add move and connect without running operations', () => {
  const op = operation(), schema = { type: 'object', properties: { result: { type: 'string' } } };
  const added = editAssistantWorkspace(document(), edit('add_operation', { operationId: op.id, x: 128, y: 256 }), [], { value: op, schema });
  assert.ok(added.nodeId); assert.equal(added.document.nodes.find(n => n.id === added.nodeId).data.operationId, op.id);
  assert.equal(added.document.nodes.find(n => n.id === added.nodeId).position.x, 128);
  const moved = editAssistantWorkspace(added.document, edit('move_nodes', { moves: [{ nodeId: added.nodeId, x: 500, y: -100 }] }), []);
  assert.equal(moved.document.nodes.find(n => n.id === added.nodeId).position.y, -100);
  assert.deepEqual(moved.document.edges, added.document.edges);
  assert.throws(() => editAssistantWorkspace(document(), { ...edit('move_nodes', { moves: [] }), workflowId: 'old' }, []), /changed/);
  for (const value of [undefined, { value: operation('other'), schema }, { value: { ...op, unavailableReason: 'disabled' }, schema }])
    assert.throws(() => editAssistantWorkspace(document(), edit('add_operation', { operationId: op.id, x: 0, y: 0 }), [], value), /unavailable/);
  for (const moves of [[{ nodeId: 'missing', x: 0, y: 0 }], [{ nodeId: added.nodeId, x: 1, y: 0 }, { nodeId: added.nodeId, x: 2, y: 0 }]])
    assert.throws(() => editAssistantWorkspace(added.document, edit('move_nodes', { moves }), []), /distinct visible/);
  const a = createUtilityNode('cast', { x: 0, y: 0 }, 'a'), b = createUtilityNode('stop', { x: 200, y: 0 }, 'b');
  const ports = [{ nodeId: 'a', handle: 'result', direction: 'output', available: true }, { nodeId: 'b', handle: 'value', direction: 'input', available: true }];
  const connection = edit('connect_nodes', { source: 'a', sourceHandle: 'result', target: 'b', targetHandle: 'value' });
  const connected = editAssistantWorkspace(document([a, b]), connection, ports);
  assert.equal(connected.document.edges[0].kind, 'mapping');
  assert.throws(() => editAssistantWorkspace(connected.document, connection, ports), /incompatible/);
  assert.throws(() => editAssistantWorkspace(document([a, b]), connection, []), /unavailable/);
  const fieldSchema = { type: 'object', properties: { value: { type: 'string' } } };
  const requestOp = { ...operation('demo:request'), method: 'POST', path: '/request', bodyRequired: true, bodyMediaType: 'application/json' };
  const requestSchema = { paths: { '/request': { post: { requestBody: { required: true, content: { 'application/json': { schema: fieldSchema } } }, responses: { 200: { description: 'OK', content: { 'application/json': { schema: fieldSchema } } }, 404: { description: 'Missing', content: { 'application/json': { schema: fieldSchema } } } } } } } };
  const firstGraph = createOperationGraph(requestOp, { x: 0, y: 0 }, 'first', requestSchema);
  const secondGraph = createOperationGraph(requestOp, { x: 800, y: 0 }, 'second', requestSchema);
  const combined = document([...firstGraph.nodes, ...secondGraph.nodes], [...firstGraph.edges, ...secondGraph.edges]);
  const body = firstGraph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs');
  const secondBody = secondGraph.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs');
  const attachment = secondGraph.edges.find(edge => edge.source === secondBody.id && edge.target === 'second');
  const inputPorts = [{ nodeId: body.id, handle: 'value', direction: 'output', available: true }, { nodeId: 'second', handle: attachment.targetHandle, direction: 'input', available: true }];
  const inputLink = editAssistantWorkspace(combined, edit('connect_nodes', { source: body.id, sourceHandle: 'value', target: 'second', targetHandle: attachment.targetHandle }), inputPorts);
  assert.equal(inputLink.document.edges.at(-1).kind, 'input');
  const responseEdges = firstGraph.edges.filter(edge => edge.source === 'first' && edge.kind === 'schema');
  const original = responseEdges[0], other = responseEdges[1];
  const responsePorts = [{ nodeId: 'first', handle: other.sourceHandle, direction: 'output', available: true }, { nodeId: original.target, handle: 'value', direction: 'input', available: true }];
  const responseLink = editAssistantWorkspace(combined, edit('connect_nodes', { source: 'first', sourceHandle: other.sourceHandle, target: original.target, targetHandle: 'value' }), responsePorts);
  assert.equal(responseLink.document.edges.at(-1).kind, 'response');
  const file = { id: 'file', type: 'file', position: { x: 0, y: 0 }, data: { file: readWorkflowFile('source.bin', new Uint8Array([0, 1, 2])) } };
  const binaryTarget = { id: 'binary', type: 'data', position: { x: 400, y: 0 }, data: { ownerId: 'owner', direction: 'inputs', label: 'Body', fields: [{ id: 'upload', label: 'Upload', type: 'Binary', required: true, description: '', connectable: true }] } };
  const owner = firstGraph.nodes.find(node => node.id === 'first');
  const binaryDoc = document([file, binaryTarget, { ...owner, id: 'owner' }], [{ id: 'schema:binary', kind: 'schema', source: 'binary', sourceHandle: 'value', target: 'owner', targetHandle: 'schema:binary' }]);
  const binaryPorts = [{ nodeId: 'file', handle: 'value', direction: 'output', available: true }, { nodeId: 'binary', handle: 'upload', direction: 'input', available: true }];
  const binary = editAssistantWorkspace(binaryDoc, edit('connect_nodes', { source: 'file', sourceHandle: 'value', target: 'binary', targetHandle: 'upload' }), binaryPorts);
  assert.ok(binary.document.nodes.some(node => node.type === 'cast' && node.data.targetType === 'Binary'));
  const plain = document([{ id: 'first', position: { x: 0, y: 0 }, data: { operationId: op.id, name: op.name, description: op.description, method: op.method, path: op.path } }, { id: 'second', position: { x: 500, y: 0 }, data: { operationId: op.id, name: op.name, description: op.description, method: op.method, path: op.path } }]);
  const plainPorts = [{ nodeId: 'first', handle: null, direction: 'output', available: true }, { nodeId: 'second', handle: null, direction: 'input', available: true }];
  assert.equal(editAssistantWorkspace({ ...plain, version: 1 }, edit('connect_nodes', { source: 'first', target: 'second' }), plainPorts).document.version, 2);
});

function fakeAdapter({ value = 3.5, validation = null, failAt = '', features = true, info = { vendor: 'test' } } = {}) {
  const record = { destroyed: 0, buffers: 0, shader: '' };
  const device = { pushErrorScope() {}, async popErrorScope() { return validation; }, createShaderModule({ code }) { record.shader = code; return {}; },
    async createComputePipelineAsync() { if (failAt === 'pipeline') throw new Error('pipeline failed'); return { getBindGroupLayout: () => ({}) }; },
    createBuffer() { record.buffers++; return { destroy() { record.destroyed++; }, async mapAsync() {}, getMappedRange: () => new Float32Array([value]).buffer, unmap() {} }; },
    createBindGroup: () => ({}), createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), copyBufferToBuffer() {}, finish: () => ({}) }),
    queue: { writeBuffer() {}, submit() {} }, destroy() { record.destroyed++; } };
  return { adapter: { features: new Set(features ? ['shader-f16'] : []), info, requestDevice: async () => device }, record };
}
Then('assistant compatibility probes verify GPU readback and release every device', async () => {
  for (const fp16 of [false, true]) { const { adapter, record } = fakeAdapter(); await probeCompute(adapter, fp16); assert.equal(record.destroyed, 4); assert.equal(record.shader.includes('enable f16'), fp16); }
  for (const options of [{ value: 1 }, { validation: { message: 'invalid' } }, { failAt: 'pipeline' }]) { const { adapter, record } = fakeAdapter(options); await reject(() => probeCompute(adapter, false)); assert.equal(record.destroyed, record.buffers + 1); }
  assert.equal((await probeAssistantCompatibility({})).ready, false);
  assert.equal((await probeAssistantCompatibility({ isSecureContext: true })).ready, false);
  assert.equal((await probeAssistantCompatibility({ isSecureContext: true, navigator: {} })).ready, false);
  const env = requestAdapter => ({ isSecureContext: true, navigator: { gpu: { requestAdapter } } });
  assert.equal((await probeAssistantCompatibility(env(async () => null))).ready, false);
  assert.match((await probeAssistantCompatibility(env(async () => { throw 'driver unavailable'; }))).detail, /driver/);
  const noF16 = fakeAdapter({ features: false, info: {} }); assert.equal((await probeAssistantCompatibility(env(async () => noF16.adapter))).ready, true);
  const gpu = fakeAdapter(); const result = await probeAssistantCompatibility(env(async () => gpu.adapter)); assert.equal(result.fp16, true); assert.equal(result.adapter, 'test');
  let n = 0; const optional = await probeAssistantCompatibility(env(async () => ++n === 1 ? gpu.adapter : null)); assert.equal(optional.ready, true); assert.equal(optional.fp16, false);
});

Then('assistant model loading verifies runtime integrity and forwards pinned native settings', async () => {
  const source = new ArrayBuffer(bonsaiRuntime.bytes), response = () => new Response(source);
  await reject(() => fetchBonsaiRuntime(signal(), async () => new Response('', { status: 404 })), /404/);
  await reject(() => fetchBonsaiRuntime(signal(), async () => new Response('bad')), /size/);
  await reject(() => fetchBonsaiRuntime(signal(), async () => response()), /checksum/);
  const hash = Uint8Array.from(bonsaiRuntime.sha256.match(/../g).map(byte => parseInt(byte, 16)));
  const spy = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(hash.buffer);
  try {
    let imported = '';
    const module = { Qwen3_5ForConditionalGeneration: {} };
    assert.equal(await fetchBonsaiRuntime(signal(), async (url, options) => { assert.equal(url, bonsaiRuntime.url); assert.equal(options.credentials, 'omit'); return response(); }, async url => { imported = url; return module; }), module);
    assert.match(imported, /^blob:/);
    await reject(() => fetchBonsaiRuntime(signal(), async () => response()));
    const abort = controller(); abort.abort(); await reject(() => fetchBonsaiRuntime(abort.signal, async () => response(), async () => module));
    await reject(() => fetchBonsaiRuntime(signal(), async () => response(), async () => { throw Error('module failure'); }), /module failure/);
  } finally { spy.mockRestore(); }
  const events = [], captured = {}, record = { resets: 0, sessionDisposed: 0, rawDisposed: 0 };
  const fakeSession = { async reset() { record.resets++; }, async dispose() { record.sessionDisposed++; }, generate(messages, options) {
    captured.generation = options;
    return Object.assign((async function* () { yield { type: 'text', text: 'Hello' }; yield { type: 'reasoning', text: 'Think' }; yield { type: 'other' }; })(), { result: Promise.resolve(okResult('Hello')) });
  } };
  const raw = { create_session: () => fakeSession, async dispose() { record.rawDisposed++; } };
  const runtime = async () => ({ Qwen3_5ForConditionalGeneration: { from_pretrained: async (model, options) => { captured.model = model; captured.load = options; options.onProgress('loading'); return raw; } } });
  for (const sampling of [false, true]) {
    const engine = await loadBonsaiEngine({ ...settings(), sampling, prefixCache: sampling }, event => events.push(event), signal(), { fp16: true }, runtime);
    await engine.reset();
    const result = await engine.generate([], { tools: [], signal: signal(), maxTokens: 13, onText: text => events.push(text), onThinking: text => events.push(text) });
    assert.equal(result.message.content, 'Hello'); assert.equal(captured.generation.temperature, sampling ? 0.7 : 0);
    assert.equal(captured.load.revision, bonsaiModels[0].revision); assert.equal(captured.load.cache, false); assert.equal(captured.load.mmproj, null); assert.equal(captured.load.prefixSnapshotStore, null);
    await engine.dispose();
  }
  assert.equal(record.resets, 3); assert.ok(events.includes('Think'));
  const abort = controller(); abort.abort(); await reject(() => loadBonsaiEngine(settings(), () => {}, abort.signal, { fp16: true }, runtime));
  raw.create_session = () => { throw Error('session error'); }; await reject(() => loadBonsaiEngine(settings(), () => {}, signal(), { fp16: true }, runtime), /session error/);
  assert.equal(record.rawDisposed, 4);
});

Then('assistant loading keeps a failed FP16 compute probe disabled in the native runtime', async () => {
  for (const fp16Works of [false, true]) {
    let probes = 0, loads = 0;
    const compatibility = await probeAssistantCompatibility({ isSecureContext: true, navigator: { gpu: {
      requestAdapter: async () => fakeAdapter(++probes === 2 && !fp16Works ? { failAt: 'pipeline' } : {}).adapter,
    } } });
    assert.equal(compatibility.ready, true);
    assert.equal(compatibility.fp16, fp16Works);
    const raw = { create_session: () => ({ async reset() {}, async dispose() {} }), async dispose() {} };
    const runtime = async () => ({ Qwen3_5ForConditionalGeneration: { async from_pretrained(model, options) {
      loads++;
      const fp16Enabled = !options.runtimeOptions?.disabledFeatures?.includes('shader-f16');
      if (fp16Enabled && !fp16Works) throw new Error('FP16 compute failed on an adapter advertising shader-f16.');
      assert.equal(fp16Enabled, fp16Works);
      assert.equal(options.maxLength, settings().context);
      return raw;
    } } });
    const engine = await loadBonsaiEngine(settings(), () => {}, signal(), compatibility, runtime);
    assert.equal(loads, 1);
    await engine.dispose();
  }
});

const model = { id: '2b', api: 'browser-local', provider: 'browser-local' };
Then('assistant failures retain native stacks causes codes and GPU diagnostics across the worker boundary', async () => {
  const native = new Error('GPU buffer mapping failed', { cause: new DOMException('Device reset', 'OperationError') });
  const runtime = async () => ({ Qwen3_5ForConditionalGeneration: { async from_pretrained(_model, options) {
    for (const event of [null, true, {}, { message: 5 }, { message: 'Compiling kernels (warmup)' }]) options.onProgress(event);
    for (let index = 0; index < 5; index++) options.runtimeOptions.diagnosticSink({ message: `Driver diagnostic ${index}` });
    throw native;
  } } });
  await assert.rejects(loadBonsaiEngine(settings(), () => {}, signal(), { fp16: true }, runtime), error => {
    const copy = decodeError(structuredClone(encodeError(error)));
    assert.match(copy.message, /Compiling kernels \(warmup\).*GPU buffer mapping failed/);
    assert.equal(copy.cause.stack, native.stack);
    assert.equal(copy.cause.cause.name, 'OperationError');
    assert.equal(copy.cause.cause.code, native.cause.code);
    assert.equal(copy.errors.length, 4);
    assert.equal(copy.errors[0].message, 'Driver diagnostic 1');
    assert.equal(copy.errors[0].stack, undefined, 'Do not replace a missing worker stack with a UI stack.');
    return true;
  });
  for (const cause of [native, 'Range request failed: 416']) {
    const failing = async () => ({ Qwen3_5ForConditionalGeneration: { async from_pretrained() { throw cause; } } });
    await assert.rejects(loadBonsaiEngine(settings(), () => {}, signal(), { fp16: false }, failing), error => {
      assert.match(error.message, /GPU initialization/);
      assert.equal(error.cause, cause);
      return true;
    });
  }
  const reported = [], updates = [];
  const session = createAssistantSession({ async reset() {}, async generate() { throw native; } }, settings(), async () => ({}), async () => ({}),
    state => updates.push(state), undefined, error => reported.push(error));
  await session.send('Hi');
  assert.equal(reported.length, 1); assert.equal(reported[0], native);
  assert.match(updates.at(-1).error, /GPU buffer mapping failed/);
  const abort = controller(); abort.abort();
  const stream = localAssistantStream({ async generate() { assert.fail('Cancelled work must not start.'); } }, settings(), async () => ({}), error => reported.push(error))
    (model, normalizeContext({ messages: [] }), { signal: abort.signal });
  for await (const _ of stream) { /* Drain the native cancellation result. */ }
  assert.equal((await stream.result()).stopReason, 'aborted');
  assert.equal(reported.length, 1, 'Explicit cancellation is not recorded as a failure.');
});

async function streamResult(engine, messages = [], options, overrides = {}) {
  const stream = localAssistantStream(engine, { ...settings(), ...overrides }, async part => ({ type: 'image', data: part.data }))(model, normalizeContext({ messages }), options);
  const events = []; for await (const event of stream) events.push(event);
  return { result: await stream.result(), events };
}
Then('the local Pi agent streams answers and uses fresh application tool results', async () => {
  const first = await streamResult({ async generate(messages, { onText, onThinking }) { onText('He'); onText('llo'); onThinking('Think'); onThinking(' more'); return { ...okResult('Hello'), message: { content: 'Hello', reasoning_content: 'Think more' } }; } });
  assert.equal(first.result.usage.totalTokens, 17); assert.equal(first.events.filter(e => e.type === 'text_delta').length, 2);
  assert.equal(first.result.content[0].thinking, 'Think more');
  const native = await nativeMessages(normalizeContext({ systemPrompt: 'test system', messages: [
    { role: 'user', content: [{ type: 'text', text: 'Image' }, { type: 'image', mimeType: 'image/png', data: 'abc' }], timestamp: 0 },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason' }, { type: 'toolCall', id: 'a', name: 'read_skill', arguments: { path: 'skill' } }], timestamp: 0 },
    { role: 'toolResult', toolCallId: 'a', toolName: 'read_skill', content: [{ type: 'text', text: 'skill text' }], timestamp: 0 },
    { role: 'assistant', content: [{ type: 'text', text: 'answer' }], timestamp: 0 },
    { role: 'user', content: 'plain string', timestamp: 0 },
  ] }).messages, async part => ({ type: 'image', payload: part.data }));
  assert.equal(native[0].content, 'test system'); assert.equal(native[1].content[1].payload, 'abc'); assert.equal(native[2].reasoning_content, 'reason'); assert.equal(native[3].tool_call_id, 'a');
  assert.equal(nativeToolCalls([{ function: { name: 'read_skill', arguments: '{}' } }])[0].type, 'toolCall');
  const confirmation = crypto.randomUUID(), invocations = [], updates = [];
  let rounds = 0;
  const engine = { async reset() {}, async generate(messages, { tools, onText }) {
    rounds++;
    assert.ok(tools.some(tool => tool.function.name === 'read_skill'));
    if (rounds === 1) return callResult('read_skill', { path: assistantSkills[0].path });
    if (rounds === 2) { assert.match(messages.at(-1).content, /Workspace design/); return callResult('read_application', { section: 'summary' }); }
    assert.ok(messages.some(m => m.role === 'tool' && m.content.includes(confirmation)));
    onText('Confirmed ' + confirmation); return { ...okResult('Confirmed ' + confirmation), message: { content: 'Confirmed ' + confirmation, reasoning_content: 'Verified' } };
  } };
  const session = createAssistantSession(engine, settings(), async (name, args) => { invocations.push(name); return name === 'read_skill' ? readAssistantSkill(args.path) : { confirmation }; }, async () => ({}), state => updates.push(state));
  await session.send('Inspect this workspace using the skill');
  assert.deepEqual(invocations, ['read_skill', 'read_application']); assert.ok(updates.at(-1).messages.at(-1).text.includes(confirmation));
  assert.equal(updates.at(-1).messages.filter(m => m.role === 'tool').length, 2);
  await session.reset(); assert.deepEqual(updates.at(-1).messages, []);
  const noTools = createAssistantSession({ async reset() {}, async generate(messages, { tools }) { assert.equal(tools.length, 0); return okResult('Hi'); } }, { ...settings(), tools: false }, async () => assert.fail(), async () => ({}), () => {});
  await noTools.send('Hi');
});
Then('the local Pi agent reports parser failures cancellation and request limits', async () => {
  assert.deepEqual(nativeToolCalls(), []);
  assert.deepEqual(nativeToolCalls([{ function: { name: 'read', arguments: '{}' }, errors: ['bad call'] }])[0].nativeErrors, ['bad call']);
  for (const call of [{ function: { name: 'bad name', arguments: {} } }, { function: { name: 'read', arguments: [] } }, { function: { name: 'read', arguments: null } }, { function: { name: 'read', arguments: '[' } }]) assert.throws(() => nativeToolCalls([call]));
  const abort = controller(); abort.abort(); assert.equal((await streamResult({ generate: () => assert.fail() }, [], { signal: abort.signal })).result.stopReason, 'aborted');
  for (const failure of [new Error('engine error'), 'string error']) { const { result } = await streamResult({ async generate() { throw failure; } }); assert.equal(result.stopReason, 'error'); }
  assert.equal((await streamResult({ async generate() { return { message: {}, finish_reason: 'cancelled' }; } })).result.stopReason, 'error');
  assert.equal((await streamResult({ async generate() { return { message: {}, finish_reason: 'length' }; } })).result.stopReason, 'length');
  const updates = [], engine = { async reset() {}, async generate() { return callResult('read_application', { section: 'summary' }); } };
  const limited = createAssistantSession(engine, { ...settings(), maxTurns: 1 }, async () => ({ good: true }), async () => ({}), state => updates.push(state));
  await limited.send('Read the app'); assert.match(updates.at(-1).error, /round limit/);
  let rounds = 0;
  const callLimited = createAssistantSession({ ...engine, async generate() { return ++rounds < 4 ? callResult('read_application', { section: 'summary' }) : okResult('Done'); } }, { ...settings(), maxToolCalls: 1 }, async () => ({}), async () => ({}), state => updates.push(state));
  await callLimited.send('Read'); assert.ok(updates.flatMap(u => u.messages).some(m => m.failed && m.text.includes('limit')));
  let parserRounds = 0;
  const parserSession = createAssistantSession({ ...engine, async generate(messages) {
    if (++parserRounds === 1) { const result = callResult('read_application', { section: 'summary' }); result.message.tool_calls[0].errors = ['native syntax']; return result; }
    assert.match(messages.at(-1).content, /Native tool parser/); return okResult('Recovered');
  } }, settings(), async () => assert.fail('Invalid native calls must not execute'), async () => ({}), state => updates.push(state));
  await parserSession.send('Read the app'); assert.equal(updates.at(-1).messages.at(-1).text, 'Recovered');
  const errorSession = createAssistantSession({ ...engine, async generate() { throw Error('bad generation'); } }, settings(), async () => ({}), async () => ({}), state => updates.push(state));
  await errorSession.send('Hi'); assert.match(updates.at(-1).error, /bad generation/);
  const lengthSession = createAssistantSession({ ...engine, async generate() { return { message: {}, finish_reason: 'length' }; } }, settings(), async () => ({}), async () => ({}), state => updates.push(state));
  await lengthSession.send('Hi'); assert.match(updates.at(-1).error, /length/);
  let entered; const enteredPromise = new Promise(resolve => entered = resolve);
  const cancellable = createAssistantSession({ ...engine, async generate(_messages, { signal }) { entered(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); signal.throwIfAborted(); } }, settings(), async () => ({}), async () => ({}), state => updates.push(state));
  const pending = cancellable.send('Wait'); await enteredPromise;
  await reject(() => cancellable.send('Other'), /One assistant/); await reject(() => cancellable.reset(), /Stop/); cancellable.stop(); await pending;
  assert.ok(updates.at(-1).error);
  for (const args of [[''], ['x'.repeat(16001)], ['x', [{}, {}]]]) await reject(() => cancellable.send(...args), /Enter a message/);
  vi.useFakeTimers();
  try {
    const deadline = createAssistantSession({ ...engine, async generate(_messages, { signal }) { await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); signal.throwIfAborted(); } }, { ...settings(), requestTimeout: 1000 }, async () => ({}), async () => ({}), state => updates.push(state));
    const request = deadline.send('Deadline'); await vi.advanceTimersByTimeAsync(1001); await request; assert.match(updates.at(-1).error, /deadline|abort/i);
  } finally { vi.useRealTimers(); }
});
