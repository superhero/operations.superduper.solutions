// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeThreadShellFixture } from '../tests/native-thread-shell.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-thread-shell' }, function () { this.shellFixtures = []; });
After({ tags: '@native-thread-shell' }, async function () { for (const c of this.shellFixtures.reverse()) { c.v.session.lock(); await c.f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeThreadShellFixture(options), v = await nativeVaultFixture(f), c = { f, v }; world.shellFixtures.push(c);
  const selections = await v.workflowSelections(), paired = await v.session.pairNativeRuntime(v.input, v.selection);
  c.connection = await v.session.enableNativeWorkflow(nativeReference(paired), selections); c.reference = nativeReference(c.connection); c.selections = selections;
  c.selection = selections.find(s => s.operation.rpc.method === 'thread/shellCommand');
  c.execute = (method, input, signal, progress) => v.session.executeNativeRuntime(c.reference, selections, selections.find(s => s.operation.rpc.method === method), input, signal, progress);
  if (!options.noThread) c.threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
  return c;
}
function run(c, extra = {}, signal) {
  const notices = [], result = c.execute('thread/shellCommand', { threadId: c.threadId, command: 'printf OWNED_SHELL_OUTPUT; exit 17', ...extra }, signal, p => notices.push(p));
  void result.catch(() => {}); return { notices, result, signal };
}
const calls = (c, method = 'thread/shellCommand') => c.f.frames.filter(f => f.method === method);
async function approve(c, r, decision = 'accept') {
  await waitForWatch(() => r.notices.some(n => n.kind === 'shell-approval'));
  const token = r.notices.find(n => n.kind === 'shell-approval').token;
  await c.v.session.replyNativeRuntime(c.connection.id, token, decision, r.signal);
  if (decision === 'accept') await waitForWatch(() => r.notices.some(n => n.kind === 'running')); return token;
}
const ended = c => waitForWatch(() => c.f.starts === c.f.stops);
Then('thread shell models retain typed command and completion events with field diagnostics', async function () {
  const c = await setup(this), graph = createOperationGraph(c.selection.operation, { x: 0, y: 0 }, 'shell', c.selection.document);
  const doc = { version: 3, id: 'shell-model', name: 'Shell model', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(portableWorkflowDocument(doc))), doc);
  const fields = graph.nodes.filter(n => n.type === 'data').flatMap(n => n.data.fields);
  for (const [path, type] of [['/result/command/params/item/exitCode', 'Integer'], ['/result/command/params/item/aggregatedOutput', 'Text'], ['/result/completion/params/turn/id', 'Text']])
    assert.ok(fields.some(f => JSON.parse(decodeURIComponent(f.id))[1] === path && f.type === type), 'Missing typed shell result: ' + path);
  for (const [field, value] of [['command', ' '], ['timeoutMs', '-1'], ['timeoutMs', '300001'], ['threadId', '../foreign']])
    assert.throws(() => prepareNativeRequest(c.selection.operation, { 'params:threadId': c.threadId, 'params:command': 'pwd', ['params:' + field]: value }), e => e.fieldKey === 'params:' + field);
  assert.equal(prepareNativeRequest(c.selection.operation, { 'params:threadId': c.threadId, 'params:command': '  pwd  ' }).params.timeoutMs, 300000);
});
Then('thread shell rejects missing grants foreign threads stale selections and unloaded peers', async function () {
  const denied = await setup(this, { allowThreadShell: false }); await assert.rejects(run(denied).result); assert.equal(calls(denied).length, 0);
  const c = await setup(this); await assert.rejects(run(c, { threadId: 'foreign' }).result); assert.equal(calls(c).length, 0);
  const stale = await setup(this); await assert.rejects(stale.v.session.executeNativeRuntime({ ...stale.reference, revision: stale.reference.revision + 1 }, stale.selections, stale.selection, { threadId: stale.threadId, command: 'pwd' }));
  await assert.rejects(stale.v.session.executeNativeRuntime(stale.reference, stale.selections.toReversed(), stale.selection, { threadId: stale.threadId, command: 'pwd' })); assert.equal(calls(stale).length, 0);
  const unloaded = await setup(this); await unloaded.v.session.disconnectNativeRuntime(unloaded.reference);
  await assert.rejects(run(unloaded).result); assert.equal(calls(unloaded).length, 0);
});
Then('private thread shell approval binds its request and waits for item and turn completion', async function () {
  const c = await setup(this), controller = new AbortController(); c.f.holdShellAck = true;
  const r = run(c, {}, controller.signal); await waitForWatch(() => r.notices.length === 1); assert.equal(calls(c).length, 0);
  assert.equal(r.notices[0].unsandboxed, true);
  await assert.rejects(c.v.session.replyNativeRuntime(c.connection.id, r.notices[0].token, 'accept', new AbortController().signal));
  const token = await approve(c, r); await assert.rejects(c.v.session.replyNativeRuntime(c.connection.id, token, 'accept', controller.signal));
  let settled = false; void r.result.then(() => { settled = true; }, () => {}); c.f.finishShell(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(settled, false);
  c.f.shellAck(); const result = await r.result;
  assert.equal(result.response.result.command.params.item.exitCode, 17); assert.equal(result.response.result.command.params.item.aggregatedOutput, 'OWNED_SHELL_OUTPUT');
  assert.equal(result.response.result.completion.method, 'turn/completed'); assert.equal(result.response.result.completion.params.turn.items.length, 0);
  assert.equal(calls(c).length, 1); assert.equal(JSON.stringify(await c.v.storage.read()).includes(c.f.key), false);
  const declined = run(c); await approve(c, declined, 'decline'); await assert.rejects(declined.result, e => e.code === 'CANCELLED'); assert.equal(calls(c).length, 1); await ended(c);
});
Then('thread shell input and actual encoded terminal values withhold vault secrets', async function () {
  for (const mode of ['input', 'base64-input', 'output', 'base64-output', 'utf16-output']) {
    const c = await setup(this), secret = 'saved-shell-secret-' + randomUUID(); await c.v.session.put(null, { label: 'Shell privacy fixture', kind: 'secret', value: secret });
    // Saving a credential revokes peers; reopen and load an owned thread first.
    c.threadId = (await c.execute('thread/start', { model: 'owned-fixture-model' })).response.result.thread.id;
    if (mode.endsWith('input')) { const text = mode === 'input' ? secret : Buffer.from(secret).toString('base64'); await assert.rejects(run(c, { command: 'printf ' + text }).result, e => e.code === 'REDACTED'); assert.equal(calls(c).length, 0); continue; }
    const r = run(c); await approve(c, r);
    c.f.finishShell({ output: mode === 'output' ? secret : mode === 'base64-output' ? Buffer.from(secret).toString('base64') : Buffer.from(secret, 'utf16le').toString('utf8') });
    await assert.rejects(r.result, e => e.code === 'REDACTED'); assert.equal(JSON.stringify(r.notices).includes(secret), false); await ended(c);
  }
});
Then('thread shell cancellation interrupts an accepted command and revokes pending approvals', async function () {
  for (const mode of ['cancel-pending', 'cancel-running', 'source', 'lock', 'identity-running']) {
    const c = await setup(this), controller = new AbortController(), r = run(c, {}, controller.signal); await waitForWatch(() => r.notices.length === 1);
    if (mode === 'cancel-running') { await approve(c, r); controller.abort(); }
    else if (mode === 'identity-running') { await approve(c, r); c.f.identity.generation = randomUUID(); c.f.finishShell(); }
    else if (mode === 'cancel-pending') controller.abort();
    else { if (mode === 'source') c.v.enabled = false; else c.v.session.lock(); await assert.rejects(c.v.session.replyNativeRuntime(c.connection.id, r.notices[0].token, 'accept', controller.signal)); }
    await assert.rejects(r.result); await ended(c);
    assert.equal(calls(c).length, mode === 'cancel-running' || mode === 'identity-running' ? 1 : 0); if (mode === 'cancel-running') assert.equal(c.f.interrupts, 1);
  }
});
Then('thread shell rejects foreign item identities duplicate events and terminal item omissions', async function () {
  for (const mode of ['foreign-item', 'duplicate', 'omitted']) {
    const c = await setup(this), r = run(c); await approve(c, r);
    if (mode === 'omitted') {
      const started = r.notices.find(n => n.kind === 'running'); c.f.emit({ method: 'turn/completed', params: { threadId: c.threadId, turn: { id: started.turnId, items: [], status: 'completed', error: null } } });
    } else if (mode === 'foreign-item') c.f.finishShell({ itemOverride: { id: 'foreign' } });
    else { const started = r.notices.find(n => n.kind === 'running'); c.f.emit({ method: 'turn/started', params: { threadId: c.threadId, turn: { id: started.turnId, items: [], status: 'inProgress' } } }); }
    await assert.rejects(r.result); await ended(c); assert.equal(calls(c).length, 1);
  }
});
Then('the pinned SDK preserves approved unsandboxed shell output exit code and no provider inference', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }), marker = join(c.f.workspace, 'shell-write-proof');
  const r = run(c, { command: 'printf approved > ' + JSON.stringify(marker) + '; printf OWNED_SHELL_OUTPUT; printf OWNED_SHELL_ERROR >&2; exit 17' });
  await approve(c, r); const result = await r.result;
  assert.equal(await readFile(marker, 'utf8'), 'approved'); assert.equal(result.response.result.command.params.item.exitCode, 17);
  assert.equal(result.response.result.command.params.item.aggregatedOutput, 'OWNED_SHELL_OUTPUTOWNED_SHELL_ERROR');
  assert.equal(result.response.result.completion.params.turn.status, 'completed'); assert.deepEqual(c.f.provider.requests, []);
});
Then('the pinned SDK interrupts a cancelled shell process before releasing its owned runtime', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }), marker = join(c.f.workspace, 'shell-owned-pid'), controller = new AbortController();
  const r = run(c, { command: 'echo $$ > ' + JSON.stringify(marker) + '; sleep 60' }, controller.signal); await approve(c, r);
  let pid; const deadline = Date.now() + 10000;
  while (!pid) { try { pid = Number((await readFile(marker, 'utf8')).trim()); } catch { if (Date.now() > deadline) throw new Error('Owned shell PID marker was not created.'); await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(Number.isSafeInteger(pid) && pid > 1); controller.abort(); await assert.rejects(r.result, e => e.code === 'CANCELLED'); await ended(c);
  await assert.rejects(access('/proc/' + pid)); assert.equal(calls(c, 'turn/interrupt').length, 1); assert.deepEqual(c.f.provider.requests, []);
});
