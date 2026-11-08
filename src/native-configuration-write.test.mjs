// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeConfigurationWriteMethods, nativeConfigurationWriteParams as params, nativeConfigurationWriteInputSchema,
  nativeConfigurationTransition, nativeConfigurationWriteHash } from './lib/native-configuration-write.ts';
import { nativeHash } from './lib/secrets/native-runtime-config.ts';
import { NativeReferenceContinuations } from './lib/secrets/native-reference-continuations.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { portableWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { nativeConfigurationWriteFixture } from '../tests/native-configuration-write.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { inspectServiceSchema } from './lib/service-catalog.ts';

Before({ tags: '@native-configuration-write' }, function () { this.writeVaultFixtures = []; });
After({ tags: '@native-configuration-write' }, async function () {
  for (const c of this.writeVaultFixtures.reverse()) { c.v?.session.lock(); await c.f.close(); }
});
async function setup(world, options = {}) {
  const f = await nativeConfigurationWriteFixture(options), c = { f, adopted: [] }; world.writeVaultFixtures.push(c);
  if (options.mutateFrames) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, options) {
        if (name !== 'message') return super.addEventListener(name, listener, options);
        return super.addEventListener(name, event => {
          for (const frame of c.mutateFrames(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) });
        }, options);
      }
    };
    c.mutateFrames = options.mutateFrames;
  }
  const v = c.v = await nativeVaultFixture(f); c.selections = await v.workflowSelections();
  c.connection = await v.session.pairNativeRuntime(v.input, v.selection); c.reference = nativeReference(c.connection);
  c.select = method => c.selections.find(item => item.operation.rpc.method === method);
  c.execute = (method, input = {}, signal) => v.session.executeNativeRuntime(c.reference, c.selections, c.select(method), input, signal, undefined,
    next => { c.adopted.push(structuredClone(next)); c.reference = next; });
  return c;
}
const writeInput = { keyPath: 'model', value: 'owned-private-model', mergeStrategy: 'replace' };
Then('the private vault adopts verified writes and keeps direct stale references invalid', { timeout: 60000 }, async function () {
  const c = await setup(this), original = structuredClone(c.reference);
  assert.equal(c.connection.accountType, 'none'); assert.equal(c.connection.workflowFingerprint, undefined);
  await c.execute('config/value/write', writeInput); assert.equal(c.reference.revision, original.revision + 1);
  const beforeNoop = structuredClone(c.reference); await c.execute('config/batchWrite', { edits: [] }); assert.deepEqual(c.reference, beforeNoop);
  await c.execute('config/batchWrite', { edits: [{ keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'upsert' }], reloadUserConfig: true });
  await c.execute('skills/config/write', { path: '.agents/skills/owned-configuration-skill/SKILL.md', enabled: false });
  await c.execute('skills/config/write', { path: '.agents/skills/owned-configuration-skill/SKILL.md', enabled: true });
  const result = (await c.execute('config/read', {})).response.result;
  assert.equal(result.config.model, writeInput.value); assert.equal(result.config.model_verbosity, 'low');
  await assert.rejects(c.v.session.executeNativeRuntime(original, c.selections, c.select('config/read'), {}), e => e.code === 'CONFLICT');
  assert.deepEqual(nativeReference((await c.v.session.nativeConnections())[0]), c.reference);
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1);
  assert.equal(c.adopted.length, 5); assert.equal(JSON.stringify(c.v.storage.state).includes(writeInput.value), false);
  const saved = structuredClone(c.reference); c.v.session.lock(); c.v.session = c.v.newSession(); await c.v.session.unlock(c.v.proof);
  assert.deepEqual(nativeReference((await c.v.session.nativeConnections())[0]), saved);
});
Then('the private vault preserves unrelated records and its loaded thread across writes', { timeout: 60000 }, async function () {
  let c;
  c = await setup(this, { withMcp: true, beforeReview: async () => {
    await c.v.session.put(null, { label: 'Unrelated during configuration write', kind: 'secret', value: 'UNRELATED_OWNED_WRITE_SECRET' });
  } });
  c.connection = await c.v.session.enableNativeWorkflow(c.reference, c.selections); c.reference = nativeReference(c.connection);
  const threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  await c.execute('config/value/write', { keyPath: 'model_reasoning_effort', value: 'high', mergeStrategy: 'replace' });
  assert.deepEqual((await c.execute('config/mcpServer/reload')).response.result, {});
  assert.ok(JSON.stringify((await c.execute('mcpServer/tool/call', { threadId, server: 'operations_fixture', tool: 'display_only', arguments: { message: 'private adopted thread' } })).response.result).includes('private adopted thread'));
  assert.ok((await c.v.session.list()).some(item => item.label === 'Unrelated during configuration write'));
  assert.equal(c.f.starts, 2); assert.equal(c.f.stops, 1);
  assert.ok(c.f.provider.requests.every(r => r.path.startsWith('/v1/models') && !r.hasAuthorization));
});
Then('the private vault rejects missing replayed or mismatched configuration receipts', { timeout: 60000 }, async function () {
  for (const mode of ['input', 'result', 'duplicate', 'missing', 'ack']) {
    const c = await setup(this, { mutateFrames(frame) {
      if (frame.type === 'authority' && frame.reason === 'configuration') {
        if (mode === 'missing') return [];
        if (mode === 'duplicate') return [frame, structuredClone(frame)];
        if (mode === 'input') frame.paramsHash = 'f'.repeat(64);
        if (mode === 'result') frame.resultHash = 'f'.repeat(64);
      }
      if (mode === 'ack' && frame.result?.version && frame.result?.filePath) frame.result.version = 'unowned-result-version';
      return [frame];
    } });
    const original = structuredClone(c.reference);
    await assert.rejects(c.execute('config/value/write', writeInput)); await waitForWatch(() => c.f.starts === c.f.stops);
    assert.deepEqual(c.reference, original); assert.equal(c.adopted.length, 0);
    assert.deepEqual(nativeReference((await c.v.session.nativeConnections())[0]), original);
    assert.ok((await readFile(join(c.f.home, 'config.toml'), 'utf8')).includes(writeInput.value));
  }
});
Then('the private vault does not adopt cancelled revoked conflicting or newly private results', { timeout: 60000 }, async function () {
  for (const mode of ['cancel', 'source', 'cas', 'new-secret']) {
    let c, release, prepared = false;
    const held = new Promise(resolve => { release = resolve; });
    c = await setup(this, { beforeReview: async (_f, _context, result) => {
      if (mode === 'cancel' || mode === 'source') { prepared = true; await held; }
      if (mode === 'new-secret') await c.v.session.put(null, { label: 'Newly private write version', kind: 'secret', value: result.version });
      if (mode === 'cas') {
        const replace = c.v.storage.replace.bind(c.v.storage);
        c.v.storage.replace = async (...args) => { c.v.storage.state.revision++; c.v.storage.state.lockEpoch++; return replace(...args); };
      }
    } });
    const original = structuredClone(c.reference), controller = new AbortController(), pending = c.execute('config/value/write', writeInput, controller.signal); void pending.catch(() => {});
    if (mode === 'cancel' || mode === 'source') {
      await waitForWatch(() => prepared);
      if (mode === 'cancel') controller.abort(); else c.v.enabled = false;
      release();
    }
    await assert.rejects(pending, mode === 'new-secret' ? e => e.code === 'REDACTED' : undefined);
    await waitForWatch(() => c.f.starts === c.f.stops); assert.deepEqual(c.reference, original); assert.equal(c.adopted.length, 0);
    assert.equal(c.f.frames.filter(f => f.method === 'config/value/write').length, 1);
    assert.ok((await readFile(join(c.f.home, 'config.toml'), 'utf8')).includes(writeInput.value));
    if (mode === 'new-secret') assert.ok((await c.v.session.list()).some(item => item.label === 'Newly private write version'));
  }
});

Then('configuration write inputs preserve public preference types null removal and both selectors', async () => {
  const values = { model: 'owned-model', review_model: 'owned-review', model_reasoning_effort: 'advertised-effort', model_reasoning_summary: 'none', model_verbosity: 'low',
    model_context_window: -1, model_auto_compact_token_limit: 4096, model_auto_compact_token_limit_scope: 'body_after_prefix', service_tier: 'flex', web_search: 'cached', 'analytics.enabled': false };
  for (const [keyPath, value] of Object.entries(values)) for (const mergeStrategy of ['replace', 'upsert']) {
    const input = { keyPath, value, mergeStrategy }, normalized = params('config/value/write', input);
    assert.deepEqual(normalized, input); assert.deepEqual(params('config/value/write', { ...input, value: null }), { ...input, value: null });
    assert.equal(await nativeHash(normalized), await nativeHash(params('config/value/write', normalized)));
    assert.equal(await nativeConfigurationWriteHash(normalized), await nativeHash(normalized));
  }
  assert.deepEqual(params('config/batchWrite', { edits: [] }), { edits: [], reloadUserConfig: false });
  assert.deepEqual(params('skills/config/write', { name: '\u0085owned-skill\u0085', enabled: false, path: null }), { name: 'owned-skill', enabled: false });
  assert.deepEqual(params('skills/config/write', { path: 'skills/owned/SKILL.md', enabled: true }), { path: 'skills/owned/SKILL.md', enabled: true });
  for (const method of nativeConfigurationWriteMethods) assert.equal(nativeConfigurationWriteInputSchema(method).additionalProperties, false);
});
Then('configuration writes reject authority changes invalid values and ambiguous selectors by name', () => {
  const rejects = (method, input, field) => assert.throws(() => params(method, input), error => error.field === field);
  for (const keyPath of ['model_provider', 'sandbox_mode', 'approval_policy', 'model_providers.private.api_key', '__proto__', 'profiles.default']) rejects('config/value/write', { keyPath, value: 'unreviewed', mergeStrategy: 'replace' }, 'keyPath');
  for (const value of [{ unsafe: true }, '', NaN, Number.MAX_SAFE_INTEGER + 1]) rejects('config/value/write', { keyPath: 'model_context_window', value, mergeStrategy: 'replace' }, 'value');
  rejects('config/value/write', { keyPath: 'model', mergeStrategy: 'replace' }, 'value');
  let coerced = false; rejects('config/value/write', { keyPath: 'model', value: 'owned', mergeStrategy: { toString() { coerced = true; return 'replace'; } } }, 'mergeStrategy'); assert.equal(coerced, false);
  rejects('skills/config/write', { path: 'a', name: 'b', enabled: false }, 'path'); rejects('skills/config/write', { enabled: true }, 'path');
  rejects('skills/config/write', { name: 'owned', enabled: 'true' }, 'enabled');
  rejects('config/batchWrite', { edits: Array(17).fill({ keyPath: 'model', value: 'owned', mergeStrategy: 'replace' }) }, 'edits');
  assert.throws(() => params('config/batchWrite', { edits: [{ keyPath: 'model', value: 'owned', mergeStrategy: 'replace' }, { keyPath: 'sandbox_mode', value: 'danger-full-access', mergeStrategy: 'replace' }] }), e => e.field === 'edits' && e.message.includes('edits[1].keyPath'));
});
Then('configuration transitions bind method request input result and unchanged runtime authority', () => {
  const before = { runtimeId: randomUUID(), generation: randomUUID(), version: '0.163.0', configuration: 'a'.repeat(64), workspace: 'b'.repeat(64), accountEpoch: randomUUID() };
  const receipt = { type: 'authority', reason: 'configuration', requestId: 'owned_write', method: 'config/value/write', paramsHash: 'd'.repeat(64), resultHash: 'e'.repeat(64), beforeConfiguration: before.configuration, identity: { ...before, configuration: 'c'.repeat(64) } };
  const parse = value => nativeConfigurationTransition(value, before, 'config/value/write', 'owned_write', 'd'.repeat(64), 'e'.repeat(64));
  assert.deepEqual(parse(receipt), receipt); assert.notEqual(parse(receipt).identity, receipt.identity);
  assert.equal(parse({ ...receipt, identity: { ...before } }).identity.configuration, before.configuration);
  for (const [key, value] of [['reason', 'login'], ['requestId', 'foreign'], ['method', 'config/batchWrite'], ['paramsHash', 'f'.repeat(64)], ['resultHash', 'invalid'], ['resultHash', 'f'.repeat(64)], ['beforeConfiguration', 'c'.repeat(64)]]) assert.throws(() => parse({ ...receipt, [key]: value }));
  for (const [key, value] of [['runtimeId', randomUUID()], ['generation', randomUUID()], ['workspace', 'f'.repeat(64)], ['accountEpoch', randomUUID()], ['version', '0.164.0']]) assert.throws(() => parse({ ...receipt, identity: { ...receipt.identity, [key]: value } }));
  assert.throws(() => parse({ ...receipt, extra: true }));
  assert.throws(() => nativeConfigurationTransition(receipt, receipt.identity, 'config/value/write', 'owned_write', receipt.paramsHash));
});
Then('configuration write models preserve native results graph persistence and named JSON fields', async () => {
  const source = await readServiceSchema('codex'), discovery = inspectServiceSchema(source, 'codex');
  for (const method of nativeConfigurationWriteMethods) {
    const document = scopeNativeRpcSchema(source, method), operation = nativeRpcOperation(document, 'codex:' + method);
    assert.equal(operation.unavailableReason, undefined);
    assert.ok(!operation.capabilities.requirements.some(r => ['native-account', 'native-workspace', 'native-terminal'].includes(r.code)));
    assert.deepEqual(discovery.operations.find(item => item.id === operation.id).capabilities.requirements, operation.capabilities.requirements);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'owner', document);
    const doc = { version: 3, id: 'configuration-write', name: 'Configuration write', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
    if (method === 'config/value/write') {
      const values = { 'params:keyPath': 'analytics.enabled', 'params:value': 'false', 'params:mergeStrategy': 'replace' };
      assert.equal(prepareNativeRequest(operation, values).params.value, false);
      assert.equal(prepareNativeRequest(operation, { ...values, 'params:value': 'null' }).params.value, null);
      assert.throws(() => prepareNativeRequest(operation, { ...values, 'params:value': '"invalid"' }), e => e.fieldKey === 'params:value');
    }
    if (method === 'skills/config/write') assert.deepEqual(prepareNativeRequest(operation, { 'params:name': 'owned-skill', 'params:enabled': 'false' }).params, { name: 'owned-skill', enabled: false });
  }
});
Then('workflow references advance only through exact owned worker transitions and clear on revocation', () => {
  const refs = new NativeReferenceContinuations(), original = { id: randomUUID(), revision: 1, fingerprint: 'a'.repeat(64) };
  let current = original;
  for (let i = 2; i <= 260; i++) {
    const next = { ...original, revision: i, fingerprint: i.toString(16).padStart(64, '0') };
    assert.deepEqual(refs.accept(current, { before: current, after: next }).after, next); current = next;
  }
  assert.deepEqual(refs.resolve(original), current); assert.deepEqual(refs.resolve(current), current);
  const forged = { ...original, fingerprint: 'f'.repeat(64) }; assert.deepEqual(refs.resolve(forged), forged);
  const evicted = { ...original, revision: 2, fingerprint: '2'.padStart(64, '0') }; assert.deepEqual(refs.resolve(evicted), evicted);
  assert.throws(() => refs.accept(current, { before: original, after: current }));
  assert.throws(() => refs.accept(current, { before: current, after: { ...current, id: randomUUID() } }));
  assert.throws(() => refs.accept(current, { before: current, after: { ...current, revision: current.revision + 2 } }));
  assert.deepEqual(refs.accept(current, { before: current, after: current }).after, current);
  refs.clear(original.id); assert.deepEqual(refs.resolve(original), original);
  const second = { ...original, revision: 2, fingerprint: 'b'.repeat(64) }; refs.accept(original, { before: original, after: second });
  refs.clear(); assert.deepEqual(refs.resolve(original), original);
});
