// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeMcpOAuthFixture } from '../tests/native-mcp-oauth.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { nativeMcpOAuthMethod, nativeMcpOAuthParams, nativeMcpAuthorizationUrl } from './lib/native-mcp-oauth.ts';
import { NativeMcpOAuthFlow } from './lib/secrets/native-mcp-oauth.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-mcp-oauth' }, function () { this.mcpOAuthContexts = []; });
After({ tags: '@native-mcp-oauth' }, async function () { for (const { f, v } of this.mcpOAuthContexts.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeMcpOAuthFixture(options), v = await nativeVaultFixture(f), source = await readServiceSchema('codex'); world.mcpOAuthContexts.push({ f, v });
  const document = scopeNativeRpcSchema(source, nativeMcpOAuthMethod), selection = { document, operation: nativeRpcOperation(document, 'codex:' + nativeMcpOAuthMethod) };
  let connection = await v.session.pairNativeRuntime(v.input, v.selection), selections = [];
  if (options.allowAgent) { selections = await v.workflowSelections(); connection = await v.session.enableNativeWorkflow(nativeReference(connection), selections); }
  const notices = [], c = { f, v, selection, selections, connection, notices };
  c.call = (params = { name: 'oauth_fixture' }, signal) => v.session.executeNativeMcpOAuth(nativeReference(connection), v.selection, selection, params, selections, signal, notice => notices.push(notice));
  c.workflow = (method, params = {}) => v.session.executeNativeRuntime(nativeReference(connection), selections, selections.find(s => s.operation.rpc.method === method), params);
  c.thread = async () => (await c.workflow('thread/start')).response.result.thread.id;
  return c;
}
const calls = f => f.frames.filter(frame => frame.method === nativeMcpOAuthMethod);
const stopped = f => waitForWatch(() => f.starts === f.stops);
async function pending(c, params, signal) { const result = c.call(params, signal); await waitForWatch(() => c.notices.length === 1); return { result }; }

Then('standalone MCP sign-in keeps its owned child until the matching login completes', async function () {
  for (const early of [false, true]) {
    const c = await setup(this, { early }), promise = c.call(); let settled = false;
    void promise.then(() => { settled = true; });
    if (!early) {
      await waitForWatch(() => c.notices.length === 1); assert.equal(settled, false); assert.equal(c.f.starts - c.f.stops, 1);
      assert.equal(c.notices[0].kind, 'mcp-login'); assert.equal(c.notices[0].server, 'oauth_fixture'); c.f.finishMcp();
    }
    const result = await promise; assert.equal(result.response.result.success, true); assert.equal(result.response.result.name, 'oauth_fixture');
    assert.equal(Object.hasOwn(result.response.result, 'authorizationUrl'), false); assert.equal(calls(c.f).length, 1); await stopped(c.f);
    assert.equal(c.f.frames.some(frame => frame.method === 'account/login/start'), false);
  }
});

Then('MCP sign-in cannot borrow other grants scopes approvals or foreign thread ownership', async function () {
  const denied = await setup(this, { allowMcpOAuth: false, allowMetadata: true, allowApps: true, allowMcpRead: true, allowMcpTools: true });
  await assert.rejects(denied.call(), error => error.code === 'NATIVE_MCP_OAUTH'); assert.equal(calls(denied.f).length, 0);
  const c = await setup(this, { allowAgent: true, allowMcpTools: true, account: { type: 'apiKey' } }), threadId = await c.thread(), starts = c.f.starts;
  const { result } = await pending(c, { name: 'oauth_fixture', threadId }); c.f.finishMcp(); await result;
  assert.equal(c.f.starts, starts); await c.workflow('mcpServer/tool/call', { threadId, server: 'oauth_fixture', tool: 'owned_echo', arguments: {} });
  assert.equal(c.f.starts, starts); c.notices.length = 0;
  await assert.rejects(c.call({ name: 'oauth_fixture', threadId: 'foreign-thread' })); assert.equal(calls(c.f).length, 1);
  const unenabled = await setup(this); await assert.rejects(unenabled.call({ name: 'oauth_fixture', threadId }), error => error.code === 'PERMISSION');
  assert.equal(calls(unenabled.f).length, 0);
  c.v.session.lock(); await stopped(c.f);
  const ticket = await c.f.ticket({ connectionId: randomUUID(), method: nativeMcpOAuthMethod, fingerprint: 'c'.repeat(64) }), socket = await c.f.socket(ticket.value.ticket); await socket.next();
  socket.ws.send(JSON.stringify({ id: 'init', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } })); await socket.next();
  socket.ws.send(JSON.stringify({ method: 'initialized' })); socket.ws.send(JSON.stringify({ id: 'borrow', method: 'thread/start', params: {} }));
  await waitForWatch(() => socket.ws.readyState === 3); await socket.close(); assert.equal(c.f.frames.filter(frame => frame.method === 'thread/start').length, 1);
});

Then('MCP sign-in preserves supported options and rejects callback credential and malformed overrides', async function () {
  const c = await setup(this);
  for (const options of [{ scopes: [] }, { scopes: null, clientRegistration: null, timeoutSecs: null, threadId: null }, { scopes: ['owned.read', 'offline_access'], clientRegistration: 'cimd', timeoutSecs: 1 }]) {
    const input = { name: 'oauth_fixture', ...options }; assert.deepEqual(nativeMcpOAuthParams(input), input);
  }
  for (const input of [{ name: '' }, { name: 'bad\0name' }, { name: 'oauth_fixture', callbackUrl: 'https://foreign.invalid' }, { name: 'oauth_fixture', clientSecret: 'private' },
    { name: 'oauth_fixture', timeoutSecs: 0 }, { name: 'oauth_fixture', timeoutSecs: 301 }, { name: 'oauth_fixture', timeoutSecs: 1.5 },
    { name: 'oauth_fixture', scopes: ['two scopes'] }, { name: 'oauth_fixture', scopes: Array(17).fill('read') }, { name: 'oauth_fixture', scopes: ['quoted"scope'] },
    { name: 'oauth_fixture', clientRegistration: 'unknown' }, { name: 'oauth_fixture', threadId: '../foreign' }]) {
    await assert.rejects(c.call(input)); assert.equal(calls(c.f).length, 0);
  }
  const prepared = prepareNativeRequest(c.selection.operation, { 'params:name': 'oauth_fixture', 'params:scopes': '[]', 'params:clientRegistration': 'dcr', 'params:timeoutSecs': '2' });
  assert.deepEqual(prepared.params, { name: 'oauth_fixture', scopes: [], clientRegistration: 'dcr', timeoutSecs: 2 });
});

Then('MCP sign-in withholds foreign duplicate malformed and failed completion messages', async function () {
  for (const patch of [{ name: 'foreign' }, { loginId: randomUUID() }, { threadId: 'foreign' }, { success: 'true' }, { success: false, error: 'Owned synthetic denial' },
    { success: true, error: 'Contradictory' }, { accessToken: 'unclassified' }]) {
    const c = await setup(this), { result } = await pending(c); c.f.finishMcp(patch); await assert.rejects(result); await stopped(c.f); assert.equal(calls(c.f).length, 1);
  }
  for (const acknowledgement of [{ authorizationUrl: 'https://oauth.operations.test/' }, { authorizationUrl: 'https://oauth.operations.test/', loginId: null },
    { authorizationUrl: 'https://oauth.operations.test/', loginId: randomUUID(), accessToken: 'unclassified' }]) {
    const c = await setup(this); c.f.mcpAcknowledgement = acknowledgement; await assert.rejects(c.call()); await stopped(c.f); assert.equal(c.notices.length, 0);
  }
  const duplicate = await setup(this); duplicate.f.holdMcpAck = true;
  const result = duplicate.call(); await waitForWatch(() => duplicate.f.release.length === 1);
  duplicate.f.finishMcp(); duplicate.f.finishMcp(); await assert.rejects(result); await stopped(duplicate.f); assert.equal(duplicate.notices.length, 0);
});

Then('MCP sign-in links and results reject unsafe URLs and known credential echoes', async function () {
  for (const url of ['javascript:alert(1)', 'data:text/plain,owned', 'http://auth.invalid/authorize', 'https://user:password@auth.invalid/',
    'https://auth.invalid/#secret', 'https://auth.invalid/?access_token=private', 'https://auth.invalid/?code_verifier=private', 'https://auth.invalid/\n']) assert.throws(() => nativeMcpAuthorizationUrl(url));
  for (const url of ['https://auth.example.test/authorize?state=public&code_challenge=public', 'http://127.0.0.1:3210/authorize', 'http://[::1]:3210/authorize']) assert.equal(nativeMcpAuthorizationUrl(url), url);
  const c = await setup(this), secret = 'SYNTHETIC_MCP_OAUTH_PRIVATE_VALUE'; await c.v.session.put(null, { label: 'OAuth echo fixture', kind: 'secret', value: secret });
  c.f.mcpAcknowledgement = { authorizationUrl: 'https://auth.example.test/authorize?q=' + secret, loginId: randomUUID() };
  await assert.rejects(c.call(), error => error.code === 'REDACTED'); assert.equal(c.notices.length, 0); await stopped(c.f);
  const before = calls(c.f).length; await assert.rejects(c.call({ name: secret }), error => error.code === 'REDACTED'); assert.equal(calls(c.f).length, before);
});

Then('MCP sign-in cancellation source changes and deadlines close the owned attempt without replay', { timeout: 20000 }, async function () {
  for (const mode of ['cancel', 'source', 'identity', 'deadline']) {
    const c = await setup(this), controller = new AbortController(), { result } = await pending(c, { name: 'oauth_fixture', timeoutSecs: 1 }, controller.signal);
    if (mode === 'cancel') controller.abort();
    if (mode === 'source') { c.v.enabled = false; c.f.finishMcp(); }
    if (mode === 'identity') { c.f.identity.accountEpoch = randomUUID(); c.f.finishMcp(); }
    await assert.rejects(result, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'NATIVE_UNKNOWN', 'NATIVE_MCP_OAUTH'].includes(error.code));
    await stopped(c.f); assert.equal(calls(c.f).length, 1); assert.equal(c.f.frames.some(frame => frame.method === 'account/logout'), false);
  }
});

Then('MCP sign-in models roundtrip their options and expose typed terminal fields with the original response', async function () {
  const c = await setup(this), { operation, document } = c.selection;
  assert.deepEqual(operation.capabilities.requirements.map(requirement => requirement.code), ['native-host', 'native-method', 'native-terminal']);
  assert.equal(document['x-operations-native-workflow'].wireResult.$ref, '#/definitions/v2/McpServerOauthLoginResponse');
  assert.equal(operation.rpc.workflowResult.$ref, '#/definitions/v2/McpServerOauthLoginCompletedNotification');
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'oauth', document), saved = { version: 3, id: 'oauth-model', name: 'OAuth model', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
  const fields = graph.nodes.filter(node => node.type === 'data' && node.data.direction === 'outputs').flatMap(node => node.data.fields);
  for (const path of ['/result/name', '/result/success', '/result/loginId']) assert.ok(fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === path && field.connectable));
  assert.equal(fields.some(field => JSON.parse(decodeURIComponent(field.id))[1] === '/result/authorizationUrl'), false);
});

Then('the real MCP OAuth SDK completes owned registrations and uses its private stored credentials', { timeout: 45000 }, async function () {
  for (const strategy of ['auto', 'cimd', 'dcr']) {
    const c = await setup(this, { real: true, allowMcpRead: true }), { result } = await pending(c, { name: 'oauth_fixture', clientRegistration: strategy, scopes: ['owned.read'], timeoutSecs: 10 });
    assert.equal(await c.f.authorityServer.authorize(c.notices[0].authorizationUrl), 200); const completed = await result; assert.equal(completed.response.result.success, true); await stopped(c.f);
    assert.deepEqual(await c.f.authorityServer.stored(), { access: true, refresh: true }); assert.equal(c.f.authorityServer.pkceVerified, 1);
    assert.equal(c.f.authorityServer.registrations, strategy === 'dcr' ? 1 : 0);
    const source = await readServiceSchema('codex'), document = scopeNativeRpcSchema(source, 'mcpServer/resource/read'), selection = { document, operation: nativeRpcOperation(document, 'codex:mcpServer/resource/read') };
    const resource = await c.v.session.executeNativeQuery(nativeReference(c.connection), c.v.selection, selection, { server: 'oauth_fixture', uri: 'owned:oauth-resource' });
    assert.equal(resource.response.result.contents[0].text, 'Owned OAuth resource available.'); assert.equal(c.f.authorityServer.resourceReads, 1);
    const serialized = JSON.stringify({ notices: c.notices, completed, resource }); for (const value of Object.values(c.f.authorityServer.tokens)) assert.equal(serialized.includes(value), false);
    c.v.session.lock(); await stopped(c.f);
  }
});

Then('the real MCP OAuth SDK rejects foreign state and cancellation without storing credentials', { timeout: 30000 }, async function () {
  for (const mode of ['state', 'cancel']) {
    const c = await setup(this, { real: true }), controller = new AbortController(), { result } = await pending(c, { name: 'oauth_fixture', clientRegistration: 'dcr', timeoutSecs: 2 }, controller.signal);
    if (mode === 'cancel') controller.abort(); else { c.f.authorityServer.badState = true; await c.f.authorityServer.authorize(c.notices[0].authorizationUrl); }
    await assert.rejects(result); await stopped(c.f); assert.deepEqual(await c.f.authorityServer.stored(), { access: false, refresh: false }); assert.equal(c.f.authorityServer.pkceVerified, 0);
  }
});

Then('the real MCP OAuth SDK signs in its loaded thread and retains it for tool calls', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true, allowAgent: true, allowMcpTools: true }), threadId = await c.thread(), starts = c.f.starts;
  const { result } = await pending(c, { name: 'oauth_fixture', threadId, clientRegistration: 'dcr', timeoutSecs: 10 }); await c.f.authorityServer.authorize(c.notices[0].authorizationUrl);
  assert.equal((await result).response.result.threadId, threadId); assert.equal(c.f.starts, starts);
  const tool = await c.workflow('mcpServer/tool/call', { threadId, server: 'oauth_fixture', tool: 'owned_echo', arguments: {} });
  assert.equal(tool.response.result.content[0].text, 'Owned authenticated tool.'); assert.equal(c.f.starts, starts); c.v.session.lock(); await stopped(c.f);
});

Then('private MCP login flow retains early completion and cancellation after the final guard', async () => {
  const params = { name: 'owned', timeoutSecs: 1 }, completion = { name: 'owned', success: true, loginId: 'owned_login', threadId: null, error: null };
  for (const mode of ['early', 'already-aborted', 'late-abort', 'closed']) {
    const flow = new NativeMcpOAuthFlow(params), controller = new AbortController(), notices = [];
    assert.equal(flow.frame({ method: 'unrelated/nativeHint', params: {} }), false);
    const peer = { socket: { readyState: 1 }, request: async () => ({ authorizationUrl: 'https://owned.example.test/authorize', loginId: 'owned_login' }) };
    if (mode === 'already-aborted') controller.abort();
    else assert.equal(flow.frame({ method: 'mcpServer/oauthLogin/completed', params: completion }), true);
    let guards = 0;
    const work = flow.execute(peer, params, async () => {
      if (++guards === 2) { if (mode === 'late-abort') controller.abort(); if (mode === 'closed') peer.socket.readyState = 3; }
    }, controller.signal, notice => notices.push(notice));
    if (mode === 'early') { assert.deepEqual(await work, completion); assert.deepEqual(notices, []); }
    else await assert.rejects(work, { code: mode === 'closed' ? 'NATIVE_UNKNOWN' : 'CANCELLED' });
  }
});
