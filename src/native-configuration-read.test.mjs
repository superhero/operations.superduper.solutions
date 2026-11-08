// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeConfigurationReadFixture, configurationSdkSecret } from '../tests/native-configuration-read.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeConfigurationReadMethods } from './lib/native-configuration-read.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-configuration-read' }, function () { this.configurationFixtures = []; });
After({ tags: '@native-configuration-read' }, async function () { for (const c of this.configurationFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeConfigurationReadFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.configurationFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(s => s.operation.rpc.method === method);
  c.execute = (method, params = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), params, signal);
  return c;
}
const calls = c => c.f.frames.filter(f => nativeConfigurationReadMethods.includes(f.method));
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);
Then('configuration read models preserve wire declarations typed ports and parameter diagnostics', async function () {
  const c = await setup(this);
  for (const method of nativeConfigurationReadMethods) {
    const selected = c.select(method), graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'owner', selected.document);
    const doc = { version: 3, id: 'configuration-read', name: 'Configuration read', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc); assert.equal(selected.operation.unavailableReason, undefined);
    assert.equal(selected.operation.rpc.result, true);
    assert.ok(selected.operation.capabilities.requirements.some(r => r.code === 'native-method'));
    assert.ok(!selected.operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
  }
  const selected = c.select('config/read'), graph = createOperationGraph(selected.operation, { x: 0, y: 0 }, 'owner', selected.document);
  assert.ok(graph.nodes.filter(n => n.type === 'data').flatMap(n => n.data.fields).some(f => JSON.parse(decodeURIComponent(f.id))[1] === '/result/config/model' && f.type === 'Text'));
  for (const [method, field, value] of [['config/read', 'includeLayers', '42'], ['experimentalFeature/list', 'limit', '65'], ['experimentalFeature/list', 'threadId', '../foreign'], ['skills/list', 'cwds', '[false]']])
    assert.throws(() => prepareNativeRequest(c.select(method).operation, { ['params:' + field]: value }), e => e.fieldKey === 'params:' + field);
});
async function allReads(world, real) {
  const c = await setup(world, { real }); assert.equal(c.connection.accountType, 'none'); assert.equal(c.connection.requiresOpenaiAuth, true); assert.equal(c.connection.workflowFingerprint, undefined);
  for (const method of nativeConfigurationReadMethods) {
    const result = await c.execute(method, method === 'config/read' ? { includeLayers: true, cwd: '.' } : {});
    assert.equal(result.response.protocol, 'json-rpc'); assert.equal(result.request.method, method);
    assert.equal(JSON.stringify(result).includes(configurationSdkSecret), false);
    if (method === 'config/read') { assert.equal(result.response.result.config.model, 'owned-fixture-model'); assert.ok(Array.isArray(result.response.result.layers)); }
    if (method === 'skills/list') assert.ok(result.response.result.data.some(entry => entry.skills.some(skill => skill.name === 'owned-configuration-skill')));
  }
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1); assert.equal(calls(c).length, 4);
  assert.equal(c.f.frames.find(f => f.method === 'configRequirements/read').params, null);
  assert.ok(!c.f.frames.some(f => ['thread/start', 'turn/start', 'config/value/write', 'account/login/start'].includes(f.method)));
}
Then('all four configuration reads use the same paired session without account or agent authority', async function () { await allReads(this, false); });
Then('the pinned SDK reads configuration policy features and real skills without provider authentication', { timeout: 30000 }, async function () { await allReads(this, true); });
Then('configuration reads reject missing grants agent escalation and workspace escapes', async function () {
  const denied = await setup(this, { allowConfigurationRead: false, allowAgent: true }); await assert.rejects(denied.execute('config/read')); assert.equal(calls(denied).length, 0);
  for (const path of ['../home', '/outside']) { const c = await setup(this); await assert.rejects(c.execute('config/read', { cwd: path })); assert.equal(calls(c).length, 0); }
  const escaped = await setup(this); await symlink(escaped.f.home, join(escaped.f.workspace, 'escape')); await assert.rejects(escaped.execute('skills/list', { cwds: ['escape'] })); assert.equal(calls(escaped).length, 0);
  const c = await setup(this); await c.v.session.disconnectNativeRuntime(c.reference); await ended(c);
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: 'codex-workflow', fingerprint: 'd'.repeat(64) });
  assert.equal(ticket.status, 200); const socket = await c.f.socket(ticket.value.ticket); await socket.next(); socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: nativeInitializeParams() })); await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'agent', method: 'thread/start', params: {} })); await waitForWatch(() => socket.ws.readyState === 3);
  assert.ok(!c.f.frames.some(f => f.method === 'thread/start')); socket.ws.terminate();
});
Then('configuration read projections withhold private settings and reject credential echoes', async function () {
  const c = await setup(this), result = (await c.execute('config/read', { includeLayers: true })).response.result;
  assert.equal(result.config.model_providers, undefined); assert.equal(result.config.desktop, undefined); assert.deepEqual(Object.keys(result.origins), ['model']);
  assert.equal(JSON.stringify(result).includes(configurationSdkSecret), false); assert.equal(result.layers[0].config.model, 'owned-fixture-model');
  for (const encoding of ['plain', 'base64', 'utf16']) {
    const c = await setup(this), secret = 'saved-config-secret-' + randomUUID(); await c.v.session.put(null, { label: 'Configuration privacy fixture', kind: 'secret', value: secret });
    c.f.configModel = encoding === 'plain' ? secret : encoding === 'base64' ? Buffer.from(secret).toString('base64') : Buffer.from(secret, 'utf16le').toString('utf8');
    await assert.rejects(c.execute('config/read'), e => e.code === 'REDACTED'); await ended(c);
  }
});
Then('feature reads accept only an owned loaded thread on the same approved session', async function () {
  const denied = await setup(this); await assert.rejects(denied.execute('experimentalFeature/list', { threadId: 'foreign' })); assert.equal(calls(denied).length, 0);
  const c = await setup(this, { allowAgent: true, requiresOpenaiAuth: false }); c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  const threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  assert.ok((await c.execute('experimentalFeature/list', { threadId })).response.result.data.length); assert.equal(c.f.starts, 2);
  await c.v.session.disconnectNativeRuntime(c.reference); await assert.rejects(c.execute('experimentalFeature/list', { threadId }));
});
Then('pending configuration reads revoke their owned attempt without replay or false completion', async function () {
  for (const mode of ['source', 'identity', 'lock', 'cancel']) {
    const c = await setup(this), controller = new AbortController(); c.f.holdConfiguration = true;
    const pending = c.execute('config/read', {}, controller.signal); void pending.catch(() => {}); await waitForWatch(() => c.f.configurationReplies?.length === 1);
    if (mode === 'source') c.v.enabled = false; else if (mode === 'identity') c.f.identity.generation = randomUUID(); else if (mode === 'lock') c.v.session.lock(); else controller.abort();
    if (mode === 'source' || mode === 'identity') c.f.configurationReplies[0]();
    await assert.rejects(pending); await ended(c); assert.equal(calls(c).length, 1);
  }
});
