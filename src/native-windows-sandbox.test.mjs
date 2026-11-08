// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeWindowsSandboxParams, nativeWindowsSandboxReadiness, nativeWindowsSandboxCompletion, nativeWindowsSandboxReadinessMethod as ready, nativeWindowsSandboxSetupMethod as setup } from './lib/native-windows-sandbox.ts';
import { nativeWindowsSandboxSdkFixture, nativeWindowsReadinessFixture } from '../tests/native-windows-sandbox.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectCodexSchema } from './lib/codex-schema.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { isNativePairedOperation } from './lib/native-account.ts';
import { createCodexAgentSession } from '../companions/codex/agent.mjs';
import { prepareNativeWindowsReadiness, reviewNativeWindowsReadiness } from '../companions/codex/windows-sandbox.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';

Before({ tags: '@native-windows-sandbox' }, function () { this.windowsFixtures = []; });
After({ tags: '@native-windows-sandbox' }, async function () { for (const c of this.windowsFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function paired(world, options = {}) {
  const f = await nativeWindowsReadinessFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.windowsFixtures.push(c);
  c.selections = await v.workflowSelections(); c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.execute = signal => v.session.executeNativeRuntime(c.reference, c.selections, c.selections.find(s => s.operation.rpc.method === ready), {}, signal); return c;
}
Then('only Windows setup is excluded and every other native method retains its model', async function () {
  const source = await readServiceSchema('codex'), before = structuredClone(source);
  const original = source.definitions.ClientRequest.oneOf.map(request => request.properties.method.enum[0]);
  assert.equal(original.length, 105); assert.ok(original.includes(setup));
  const catalog = inspectCodexSchema(source, 'codex');
  assert.deepEqual(catalog.operations.map(op => op.path), original.filter(method => method !== setup));
  assert.equal(catalog.operations.length, 104);
  assert.equal(catalog.operations.filter(op => op.unavailableReason).length, 0);
  assert.deepEqual(inspectCodexSchema(source, 'codex', new Set(['codex:' + setup])).operations, []);
  for (const method of original.filter(method => method !== setup)) {
    const [selected] = inspectCodexSchema(source, 'codex', new Set(['codex:' + method])).operations;
    assert.deepEqual(selected, nativeRpcOperation(scopeNativeRpcSchema(source, method), 'codex:' + method), method);
  }
  assert.ok(nativeRpcOperation(scopeNativeRpcSchema(source, setup), 'codex:' + setup).unavailableReason);
  assert.deepEqual(source, before, 'The full pinned schema and completion definitions remain intact.');
});
Then('Windows sandbox contracts preserve modes nullable project scope and correlated completion without treating started as success', function () {
  for (const input of [{}, null, undefined]) assert.deepEqual(nativeWindowsSandboxParams(ready, input), {});
  for (const input of [{ mode: 'unelevated' }, { mode: 'elevated', cwd: null }, { mode: 'unelevated', cwd: 'C:\\workspace' }, { mode: 'elevated', cwd: '/owned/project' }]) assert.deepEqual(nativeWindowsSandboxParams(setup, input), input);
  for (const [method, params, field] of [[ready, { cwd: '/owned' }, 'cwd'], [setup, {}, 'mode'], [setup, { mode: 'admin' }, 'mode'], [setup, { mode: 'elevated', env: {} }, 'env'], [setup, { mode: 'unelevated', cwd: 'relative' }, 'cwd']])
    assert.throws(() => nativeWindowsSandboxParams(method, params), e => e.field === field);
  for (const status of ['ready', 'notConfigured', 'updateRequired']) assert.deepEqual(nativeWindowsSandboxReadiness({ status }), { status });
  for (const value of [{ status: true }, { status: 'unknown' }, { status: 'ready', token: 'unexpected' }]) assert.throws(() => nativeWindowsSandboxReadiness(value));
  assert.deepEqual(nativeWindowsSandboxCompletion({ mode: 'unelevated', success: false, error: 'Unsupported platform' }, 'unelevated'), { mode: 'unelevated', success: false, error: 'Unsupported platform' });
  for (const value of [{ started: true }, { mode: 'elevated', success: true, error: null }, { mode: 'unelevated', success: true, error: 'Failed' }]) assert.throws(() => nativeWindowsSandboxCompletion(value, 'unelevated'));
});
Then('Windows readiness models keep their native enum and standalone portable workflow while setup stays guarded', async function () {
  const source = await readServiceSchema('codex'), document = scopeNativeRpcSchema(source, ready), operation = nativeRpcOperation(document, 'codex:' + ready);
  assert.equal(operation.unavailableReason, undefined); assert.equal(isNativePairedOperation(ready), true); assert.deepEqual(operation.rpc.workflowResult, document['x-operations-native-workflow'].wireResult);
  const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document), doc = { version: 3, id: 'readiness', name: 'Readiness', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
  assert.ok(!operation.capabilities.requirements.some(r => ['native-account', 'native-terminal', 'native-workspace'].includes(r.code)));
  assert.ok(nativeRpcOperation(scopeNativeRpcSchema(source, setup), 'codex:' + setup).unavailableReason);
});
Then('Windows readiness requires its owner grant and stable platform account workspace and configuration authority', async function () {
  const identity = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const context = { authority: async () => ({ ...identity }), platform: 'linux' }, plan = await prepareNativeWindowsReadiness({}, context);
  assert.deepEqual(await reviewNativeWindowsReadiness(plan, { status: 'notConfigured' }, context), { status: 'notConfigured' });
  await assert.rejects(reviewNativeWindowsReadiness(plan, { status: 'ready' }, context));
  for (const changed of [{ configuration: 'c'.repeat(64) }, { accountEpoch: randomUUID() }, { workspace: 'd'.repeat(64) }]) await assert.rejects(reviewNativeWindowsReadiness(plan, { status: 'notConfigured' }, { ...context, authority: async () => ({ ...identity, ...changed }) }));
  let prepared = 0;
  for (const granted of [false, true]) {
    const session = createCodexAgentSession({ identity: { ...identity }, authority: context.authority, send() {}, write() {}, threads: new Map(), allowAgent: !granted, allowWindowsSandboxReadiness: granted,
      prepareWindowsReadiness: async input => { prepared++; return prepareNativeWindowsReadiness(input, context); }, reviewWindowsReadiness: (plan, result) => reviewNativeWindowsReadiness(plan, result, context) });
    try {
      if (granted) assert.equal((await session.request({ id: 'owned_readiness', method: ready, params: {} })).params, null);
      else await assert.rejects(session.request({ id: 'denied', method: ready, params: {} }));
      await assert.rejects(session.request({ id: 'setup_denied', method: setup, params: { mode: 'unelevated' } }));
      assert.equal(prepared, Number(granted));
    } finally { session.close(); }
  }
});
Then('the actual SDK reports Linux Windows readiness and terminal setup failures without changing configuration', { timeout: 60000 }, async function () {
  const f = await nativeWindowsSandboxSdkFixture();
  try {
    const file = join(f.home, 'config.toml'), before = await readFile(file, 'utf8');
    assert.deepEqual(await f.call(ready, null), { status: 'notConfigured' });
    for (const mode of ['unelevated', 'elevated']) {
      const count = f.events.filter(e => e.method === 'windowsSandbox/setupCompleted').length;
      assert.deepEqual(await f.call(setup, { mode }), { started: true });
      await waitForWatch(() => f.events.filter(e => e.method === 'windowsSandbox/setupCompleted').length > count);
      const event = f.events.filter(e => e.method === 'windowsSandbox/setupCompleted')[count];
      const result = nativeWindowsSandboxCompletion(event.params, mode); assert.equal(result.success, false); assert.match(result.error, /only supported on Windows/);
      assert.equal(await readFile(file, 'utf8'), before);
    }
    const count = f.events.filter(e => e.method === 'windowsSandbox/setupCompleted').length;
    await assert.rejects(f.call(setup, { mode: 'unelevated', cwd: 'relative' })); assert.equal(f.events.filter(e => e.method === 'windowsSandbox/setupCompleted').length, count);
  } finally { await f.close(); }
});
Then('actual paired Windows readiness works without account or agent approval and keeps later calls available', { timeout: 60000 }, async function () {
  const c = await paired(this), before = await readFile(join(c.f.home, 'config.toml'), 'utf8');
  assert.equal(c.connection.accountType, 'none');
  for (let i = 0; i < 2; i++) assert.deepEqual((await c.execute()).response.result, { status: 'notConfigured' });
  assert.equal(await readFile(join(c.f.home, 'config.toml'), 'utf8'), before);
  assert.equal(c.f.frames.filter(f => f.method === ready).length, 2); assert.ok(c.f.frames.filter(f => f.method === ready).every(f => f.params === null));
  assert.equal(c.f.frames.some(f => ['thread/start', 'turn/start', setup].includes(f.method)), false);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1);
});
Then('malformed platform readiness changed authority and cancellation never return a verified status', { timeout: 90000 }, async function () {
  for (const mode of ['platform', 'shape', 'configuration', 'cancel']) {
    const controller = new AbortController();
    const c = await paired(this, { async beforeReview(f, plan, result) {
      if (mode === 'platform') result.status = 'ready';
      if (mode === 'shape') result.extra = 'Unreviewed';
      if (mode === 'configuration') await writeFile(join(f.home, 'config.toml'), 'model="unrequested"\n', { mode: 0o600 });
    }, afterReview() { if (mode === 'cancel') controller.abort(); } });
    const before = structuredClone(c.v.storage.state.snapshot); await assert.rejects(c.execute(controller.signal));
    await waitForWatch(() => c.f.starts === c.f.stops); assert.equal(c.f.reachedReview, true); assert.deepEqual(c.v.storage.state.snapshot, before);
  }
});
