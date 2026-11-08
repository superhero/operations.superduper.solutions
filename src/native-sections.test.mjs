// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeSectionSdkFixture } from '../tests/native-section-sdk.fixture.mjs';
import { nativeSectionsFixture } from '../tests/native-sections.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { nativeRpcOperation, scopeNativeRpcSchema } from './lib/native-rpc.ts';
import { nativeSectionMethods } from './lib/native-runtime-contract.ts';
import { nativeSectionParams } from './lib/native-section-contract.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-sections-sdk' }, function () { this.sectionSdks = []; });
After({ tags: '@native-sections-sdk' }, async function () { for (const f of this.sectionSdks.reverse()) await f.close(); });
Before({ tags: '@native-sections' }, function () { this.sectionContexts = []; });
After({ tags: '@native-sections' }, async function () { for (const { f, v } of this.sectionContexts.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options) {
  const f = await nativeSectionsFixture(options), v = await nativeVaultFixture(f), source = await readServiceSchema('codex'); world.sectionContexts.push({ f, v });
  const selections = Object.fromEntries(nativeSectionMethods.map(method => { const document = scopeNativeRpcSchema(source, method); return [method, { document, operation: nativeRpcOperation(document, 'codex:' + method) }]; }));
  const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  return { f, v, selections, paired, async call(method, params = {}, signal) { return v.session.executeNativeQuery(nativeReference(paired), v.selection, selections[method], params, signal); } };
}
const calls = (f, method) => f.frames.filter(frame => frame.method === method);
const stopped = f => waitForWatch(() => f.starts === f.stops);

Then('encrypted section requests preserve SDK results and isolate every mutation', async function () {
  const c = await setup(this), { f } = c;
  const created = await c.call('threadSection/create', { name: '  First section  ', appearance: { icon: 'book', color: null } });
  assert.equal(created.response.result.section.name, 'First section'); assert.equal(created.request.params.name, '  First section  ');
  assert.deepEqual(created.response.result.section.appearance, { icon: 'book', color: null }); await stopped(f);
  const id = created.response.result.section.id, before = f.starts;
  await c.call('threadSection/create', { name: 'Second section' }); await stopped(f); assert.equal(f.starts, before + 1);
  const first = await c.call('threadSection/list', { limit: 1 }); assert.equal(first.response.result.data.length, 1); assert.ok(first.response.result.nextCursor);
  const page = await c.call('threadSection/list', { cursor: first.response.result.nextCursor, limit: 1 }); assert.equal(page.response.result.data[0].name, 'Second section');
  const readStarts = f.starts; await c.call('threadSection/list'); assert.equal(f.starts, readStarts, 'Only the exact read peer, never its returned result, is reused.');
  const updated = await c.call('threadSection/update', { sectionId: id, name: 'Renamed section' }); assert.deepEqual(updated.response.result.section.appearance, created.response.result.section.appearance); await stopped(f);
  const cleared = await c.call('threadSection/update', { sectionId: id, name: 'Renamed section', appearance: null }); assert.equal(cleared.response.result.section.appearance, null); await stopped(f);
  assert.deepEqual((await c.call('threadSection/delete', { sectionId: id })).response, { protocol: 'json-rpc', result: {} }); await stopped(f);
  await assert.rejects(c.call('threadSection/update', { sectionId: id, name: 'Missing section' }), error => error.code === 'NATIVE_SECTIONS');
  assert.equal(calls(f, 'threadSection/create').length, 2); assert.equal(calls(f, 'threadSection/delete').length, 1);
});

Then('native sections cannot borrow other grants or widen a read ticket', async function () {
  for (const [read, write] of [[true, false], [false, true], [false, false]]) {
    const c = await setup(this, { allowSectionsRead: read, allowSectionsWrite: write, allowMetadata: true, allowApps: true, allowAgent: true, allowFilesystemRead: true, allowFilesystemWrite: true });
    if (read) await c.call('threadSection/list'); else await assert.rejects(c.call('threadSection/list'), error => error.code === 'NATIVE_SECTIONS');
    if (write) await c.call('threadSection/create', { name: 'Explicit write' }); else await assert.rejects(c.call('threadSection/create', { name: 'Denied write' }), error => error.code === 'NATIVE_SECTIONS');
    assert.equal(calls(c.f, 'threadSection/create').length, write ? 1 : 0);
  }
  const { f, v } = await setup(this); v.session.lock(); await stopped(f);
  const ticket = await f.ticket({ connectionId: crypto.randomUUID(), method: 'threadSection/list', fingerprint: 'c'.repeat(64) }), socket = await f.socket(ticket.value.ticket);
  await socket.next(); socket.ws.send(JSON.stringify({ id: 'initialize', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } }));
  await socket.next(); socket.ws.send(JSON.stringify({ method: 'initialized' }));
  socket.ws.send(JSON.stringify({ id: 'wrong-method', method: 'threadSection/delete', params: { sectionId: 'foreign' } }));
  await waitForWatch(() => socket.ws.readyState === 3); await stopped(f); assert.equal(calls(f, 'threadSection/delete').length, 0);
  const mutationTicket = await f.ticket({ connectionId: crypto.randomUUID(), method: 'threadSection/create', fingerprint: 'd'.repeat(64) }), mutation = await f.socket(mutationTicket.value.ticket);
  await mutation.next(); mutation.ws.send(JSON.stringify({ id: 'initialize', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } }));
  await mutation.next(); mutation.ws.send(JSON.stringify({ method: 'initialized' }));
  mutation.ws.send(JSON.stringify({ id: 'first-create', method: 'threadSection/create', params: { name: 'One mutation' } }));
  assert.equal((await mutation.next()).id, 'first-create');
  mutation.ws.send(JSON.stringify({ id: 'second-create', method: 'threadSection/create', params: { name: 'Must not dispatch' } }));
  await waitForWatch(() => mutation.ws.readyState === 3); assert.equal(calls(f, 'threadSection/create').length, 1);
});

Then('native section inputs reject unreviewed fields and malformed presentation values', async function () {
  const c = await setup(this), operation = c.selections['threadSection/create'].operation;
  assert.deepEqual(prepareNativeRequest(operation, { 'params:name': 'Public name', 'params:appearance': '{"icon":null,"color":"blue"}' }).params,
    { name: 'Public name', appearance: { icon: null, color: 'blue' } });
  assert.deepEqual(nativeSectionParams('threadSection/create', { name: 'Unicode', appearance: { icon: '🌿'.repeat(16) } }).appearance, { icon: '🌿'.repeat(16) });
  assert.equal(prepareNativeRequest(operation, { 'params:name': '🌿'.repeat(200) }).params.name, '🌿'.repeat(200));
  assert.throws(() => prepareNativeRequest(operation, { 'params:name': '🌿'.repeat(201) }), error => error.fieldKey === 'params:name');
  for (const [method, input] of [['threadSection/create', { name: ' ' }], ['threadSection/create', { name: 'N', appearance: { icon: '🌿'.repeat(17) } }],
    ['threadSection/create', { name: 'N', appearance: { accessToken: 'unreviewed' } }], ['threadSection/update', { sectionId: '', name: 'N' }],
    ['threadSection/delete', { sectionId: 'x', force: true }], ['threadSection/list', { limit: 65 }], ['threadSection/list', { cursor: '\0' }]]) {
    const count = c.f.frames.length; await assert.rejects(c.call(method, input)); assert.equal(c.f.frames.length, count);
  }
  assert.throws(() => prepareNativeRequest(operation, { 'params:name': 'N', 'params:appearance': JSON.stringify({ color: '🌿'.repeat(17) }) }), error => error.fieldKey === 'params:appearance');
});

Then('native section outputs preserve typed contracts and withhold private values', async function () {
  const c = await setup(this), { f, v } = c, secret = 'SYNTHETIC_NATIVE_SECTION_SECRET';
  await v.session.put(null, { label: 'Section privacy fixture', kind: 'secret', value: secret });
  const before = f.frames.length; await assert.rejects(c.call('threadSection/create', { name: secret }), error => error.code === 'REDACTED'); assert.equal(f.frames.length, before);
  for (const result of [{ data: [{ id: 'x', name: 'Public', appearance: { icon: null, color: 'blue', accessToken: 'unreviewed' } }] },
    { data: [{ id: 'x' }] }, { data: [{ id: 'x', name: secret }] }]) {
    f.sectionOverride = result;
    await assert.rejects(c.call('threadSection/list'), error => result.data[0].name === secret ? error.code === 'REDACTED' : error.code === 'NATIVE_CONTRACT');
    await stopped(f);
  }
  delete f.sectionOverride;
  const created = await c.call('threadSection/create', { name: 'Delete acknowledgement fixture' });
  f.sectionOverride = { unexpected: true };
  await assert.rejects(c.call('threadSection/delete', { sectionId: created.response.result.section.id }), error => error.code === 'NATIVE_CONTRACT');
});

Then('native section mutations stop their owned request without replay or rollback claims', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'storage']) {
    const c = await setup(this), { f, v } = c, controller = new AbortController(); f.holdSection = true;
    const result = c.call('threadSection/create', { name: 'Applied before response' }, controller.signal); void result.catch(() => {});
    await waitForWatch(() => f.release.length === 1);
    if (mode === 'cancel') controller.abort();
    else { if (mode === 'source') v.enabled = false; else if (mode === 'identity') f.identity.accountEpoch = crypto.randomUUID(); else await v.storage.lock(); f.release[0](); }
    await assert.rejects(result, error => mode === 'cancel' ? error.code === 'CANCELLED' : ['PERMISSION', 'CONFLICT', 'NATIVE_SECTIONS'].includes(error.code));
    await stopped(f); assert.equal(calls(f, 'threadSection/create').length, 1); assert.equal(f.sections.size, 1, 'An already applied native mutation is not rolled back or retried.');
  }
});

Then('native section workflow models preserve typed outputs and nullable appearance inputs', async function () {
  const c = await setup(this);
  for (const { operation, document } of Object.values(c.selections)) {
    assert.equal(operation.unavailableReason, undefined); assert.equal(operation.rpc.result, true);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document), saved = { version: 3, id: 'section-model', name: 'Section model', ...graph,
      viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(saved))), saved);
    if (operation.path !== 'threadSection/list' && operation.path !== 'threadSection/delete') {
      assert.equal(operation.fields.find(field => field.name === 'appearance').schema.properties.icon.nullable, true);
      assert.ok(graph.nodes.some(node => node.type === 'data' && node.data.fields.some(field => decodeURIComponent(field.id).includes('/result/section/id') && field.type === 'Text')));
    }
  }
});

Then('the pinned SDK section store crosses encrypted pairing and exact native method scopes', { timeout: 30_000 }, async function () {
  const c = await setup(this, { real: true }), created = await c.call('threadSection/create', { name: 'HTTPS section', appearance: { color: 'blue', icon: null } });
  const id = created.response.result.section.id; await stopped(c.f);
  assert.ok((await c.call('threadSection/list')).response.result.data.some(section => section.id === id));
  const updated = await c.call('threadSection/update', { sectionId: id, name: 'HTTPS renamed', appearance: null }); assert.equal(updated.response.result.section.name, 'HTTPS renamed');
  assert.deepEqual((await c.call('threadSection/delete', { sectionId: id })).response.result, {}); await stopped(c.f);
});
Then('the pinned SDK persists section metadata across children and rejects foreign section IDs', { timeout: 30_000 }, async function () {
  const first = await nativeSectionSdkFixture(); this.sectionSdks.push(first);
  const created = await first.call('threadSection/create', { name: '  Owned section  ', appearance: { icon: 'book', color: 'blue' } });
  assert.equal(created.section.name, 'Owned section'); assert.match(created.section.id, /^[a-f0-9-]{36}$/i);
  await first.restart();
  const listed = await first.call('threadSection/list', { limit: 8 }); assert.ok(listed.data.some(section => section.id === created.section.id));
  const updated = await first.call('threadSection/update', { sectionId: created.section.id, name: 'Renamed section' });
  assert.equal(updated.section.name, 'Renamed section'); assert.deepEqual(updated.section.appearance, created.section.appearance);
  const cleared = await first.call('threadSection/update', { sectionId: created.section.id, name: 'Renamed section', appearance: null }); assert.equal(cleared.section.appearance ?? null, null);
  const other = await nativeSectionSdkFixture(); this.sectionSdks.push(other);
  await assert.rejects(other.call('threadSection/update', { sectionId: created.section.id, name: 'Foreign edit' }), error => error.code === -32602);
  assert.deepEqual(await first.call('threadSection/delete', { sectionId: created.section.id }), {});
  assert.equal((await first.call('threadSection/list', { limit: 8 })).data.some(section => section.id === created.section.id), false);
  await assert.rejects(first.call('threadSection/delete', { sectionId: created.section.id }), error => error.code === -32602);
});
