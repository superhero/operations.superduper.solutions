// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeCommandFixture } from '../tests/native-command.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { nativeCommandMethods, isNativeCommandValue } from './lib/native-command.ts';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';

Before({ tags: '@native-command-private' }, function () { this.privateCommands = []; });
After({ tags: '@native-command-private' }, async function () { for (const { f, v } of this.privateCommands.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeCommandFixture({ autoTerminate: true, ...options }), v = await nativeVaultFixture(f); world.privateCommands.push({ f, v });
  const source = await readServiceSchema('codex'), select = method => { const document = scopeNativeRpcSchema(source, method); return { document, operation: nativeRpcOperation(document, 'codex:' + method) }; };
  const paired = await v.session.pairNativeRuntime(v.input, v.selection), selections = nativeCommandMethods.map(select);
  return { f, v, paired, selections, select };
}
function start(c, params = { command: ['owned'], processId: 'owned', tty: true }, signal) {
  const notices = [], values = [], result = c.v.session.executeNativeCommand(nativeReference(c.paired), c.v.selection, c.selections, params, signal, notice => notices.push(notice), value => values.push(value));
  void result.catch(() => {}); return { notices, values, result, params, signal };
}
async function approve(c, run, decision = 'accept') {
  await waitForWatch(() => run.notices.length === 1); const token = run.notices[0].token;
  await c.v.session.replyNativeCommand(c.paired.id, token, decision, run.signal);
  if (decision === 'accept') await waitForWatch(() => run.values.length > 0); return token;
}
const control = (c, method, params) => c.v.session.controlNativeCommand(nativeReference(c.paired), c.v.selection, c.selections, method, params);
const stopped = c => waitForWatch(() => c.f.starts === c.f.stops);
const calls = (c, method) => c.f.frames.filter(frame => frame.method === method);

Then('private commands reject missing grants stale pairings and altered source selections', async function () {
  const disabled = await setup(this, { allowCommands: false, allowAgent: true, allowFilesystemRead: true, allowMcpOAuth: true }); await assert.rejects(start(disabled).result); assert.equal(calls(disabled, 'command/exec').length, 0);
  const c = await setup(this);
  for (const selections of [[], c.selections.toReversed(), [c.selections[0], ...c.selections.slice(1, 3)]]) await assert.rejects(c.v.session.executeNativeCommand(nativeReference(c.paired), c.v.selection, selections, { command: ['owned'] }));
  await assert.rejects(c.v.session.executeNativeCommand({ ...nativeReference(c.paired), revision: c.paired.revision + 1 }, c.v.selection, c.selections, { command: ['owned'] })); assert.equal(calls(c, 'command/exec').length, 0);
});

Then('private commands keep one owned child for approval streams and process controls', async function () {
  const c = await setup(this), run = start(c); await waitForWatch(() => run.notices.length === 1); assert.equal(calls(c, 'command/exec').length, 0);
  await approve(c, run); assert.deepEqual(run.values[0], { protocol: 'json-rpc', stage: 'dispatched', processId: 'owned' }); assert.equal('result' in run.values[0], false);
  const starts = c.f.starts;
  assert.deepEqual((await control(c, 'command/exec/resize', { processId: 'owned', size: { rows: 40, cols: 120 } })).response.result, {});
  assert.deepEqual((await control(c, 'command/exec/write', { processId: 'owned', deltaBase64: Buffer.from([0, 255, 128]).toString('base64') })).response.result, {});
  c.f.outputCommand('owned', Buffer.from([0, 255, 128, 255])); await waitForWatch(() => run.values.length === 2); assert.equal(run.values[1].stage, 'output');
  await control(c, 'command/exec/terminate', { processId: 'owned' }); assert.equal((await run.result).response.result.exitCode, 0); assert.equal(run.values.at(-1).stage, 'completed');
  assert.ok(run.values.every(isNativeCommandValue)); assert.equal(c.f.starts, starts); await stopped(c); assert.equal(JSON.stringify(c.v.storage.state).includes(c.f.key), false);
});

Then('private command approval cannot be replayed or borrowed by another request', async function () {
  const c = await setup(this), owner = new AbortController(), run = start(c, undefined, owner.signal); await waitForWatch(() => run.notices.length === 1); const token = run.notices[0].token;
  await assert.rejects(c.v.session.replyNativeCommand(c.paired.id, randomUUID(), 'accept', owner.signal));
  await assert.rejects(c.v.session.replyNativeCommand(c.paired.id, token, 'accept', new AbortController().signal)); assert.equal(calls(c, 'command/exec').length, 0);
  await approve(c, run); await assert.rejects(c.v.session.replyNativeCommand(c.paired.id, token, 'accept', owner.signal));
  await control(c, 'command/exec/terminate', { processId: 'owned' }); await run.result;
  const denied = start(c, { command: ['must not run'], processId: 'denied' }); await approve(c, denied, 'decline'); await assert.rejects(denied.result); assert.equal(calls(c, 'command/exec').length, 1); await stopped(c);
});

Then('private command cancellation stops only its named process and does not replay effects', { timeout: 20000 }, async function () {
  const c = await setup(this), controller = new AbortController(), first = start(c, { command: ['owned'], processId: 'first', tty: true }, controller.signal); await approve(c, first);
  const sibling = start(c, { command: ['owned'], processId: 'sibling', tty: true }); await approve(c, sibling);
  controller.abort(); await assert.rejects(first.result, error => error.code === 'CANCELLED'); assert.equal(calls(c, 'command/exec/terminate').length, 1); assert.equal(c.f.starts - c.f.stops, 1);
  c.f.outputCommand('sibling', 'still running\n'); await waitForWatch(() => sibling.values.length === 2);
  await control(c, 'command/exec/terminate', { processId: 'sibling' }); await sibling.result; await stopped(c); assert.equal(calls(c, 'command/exec').length, 2);
  const early = new AbortController(), pending = start(c, { command: ['no dispatch'], processId: 'early' }, early.signal); await waitForWatch(() => pending.notices.length === 1); early.abort();
  await assert.rejects(pending.result, error => error.code === 'CANCELLED'); assert.equal(calls(c, 'command/exec').length, 2); await stopped(c);
});

Then('private command input output and split encoded bytes withhold saved secrets', { timeout: 20000 }, async function () {
  for (const mode of ['input', 'stdin', 'output', 'split', 'utf16', 'encoded', 'encodedUtf16le', 'encodedUtf16be', 'terminal']) {
    const c = await setup(this), secret = 'SYNTHETIC_PRIVATE_COMMAND_SECRET_721'; await c.v.session.put(null, { label: 'Command privacy fixture', kind: 'secret', value: secret });
    if (mode === 'input') { await assert.rejects(start(c, { command: ['owned', secret] }).result, error => error.code === 'REDACTED'); assert.equal(calls(c, 'command/exec').length, 0); continue; }
    const run = start(c, mode === 'terminal' ? { command: ['owned'], processId: 'owned' } : undefined); await approve(c, run);
    if (mode === 'stdin') { await assert.rejects(control(c, 'command/exec/write', { processId: 'owned', deltaBase64: Buffer.from(secret).toString('base64') }), error => error.code === 'REDACTED'); await assert.rejects(run.result); assert.equal(calls(c, 'command/exec/write').length, 0); }
    else {
      if (mode === 'terminal') c.f.finishCommand('owned', { exitCode: 0, stdout: secret, stderr: '' });
      else if (mode === 'split') { c.f.outputCommand('owned', secret.slice(0, 12)); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(run.values.length, 1); c.f.outputCommand('owned', secret.slice(12)); }
      else if (mode === 'encodedUtf16le' || mode === 'encodedUtf16be') {
        const bytes = Buffer.from(secret, 'utf16le'); if (mode === 'encodedUtf16be') bytes.swap16();
        c.f.outputCommand('owned', Buffer.from(bytes.toString('base64')));
      } else c.f.outputCommand('owned', Buffer.from(mode === 'encoded' ? Buffer.from(secret).toString('base64') : secret, mode === 'utf16' ? 'utf16le' : 'utf8'));
      await assert.rejects(run.result, error => error.code === 'REDACTED'); assert.equal(run.values.length, 1);
    }
    await stopped(c);
  }
});

Then('private command source identity credential and lock changes revoke their owned attempts', { timeout: 20000 }, async function () {
  for (const mode of ['source', 'identity', 'credential', 'lock', 'approval-source']) {
    const c = await setup(this), run = start(c); await waitForWatch(() => run.notices.length === 1);
    if (mode === 'approval-source') { c.v.enabled = false; await assert.rejects(c.v.session.replyNativeCommand(c.paired.id, run.notices[0].token, 'accept')); }
    else {
      await approve(c, run);
      if (mode === 'source') { c.v.enabled = false; c.f.outputCommand('owned', 'withheld output'); }
      if (mode === 'identity') { c.f.identity.accountEpoch = randomUUID(); c.f.outputCommand('owned', 'withheld output'); }
      if (mode === 'credential') await c.v.session.put(null, { label: 'Revoke command epoch', kind: 'secret', value: 'OTHER_SYNTHETIC_VALUE' });
      if (mode === 'lock') c.v.session.lock();
    }
    await assert.rejects(run.result); await stopped(c); assert.equal(run.values.length, mode === 'approval-source' ? 0 : 1);
  }
});

Then('private command peers preserve active agent and watch ownership', { timeout: 20000 }, async function () {
  const onFrame = (frame, f, emit) => {
    if (frame.method === 'fs/watch') { queueMicrotask(() => emit({ id: frame.id, result: { path: f.workspace } })); return true; }
    if (frame.method === 'fs/unwatch') { queueMicrotask(() => emit({ id: frame.id, result: {} })); return true; }
    if (frame.method === 'thread/start') { queueMicrotask(() => emit({ id: frame.id, result: { thread: { id: 'owned_' + randomUUID() } } })); return true; }
    return false;
  };
  const c = await setup(this, { allowFilesystemWatch: true, allowAgent: true, account: { type: 'apiKey' }, onFrame });
  const watchSelections = ['fs/watch', 'fs/unwatch'].map(c.select), values = [];
  const watched = c.v.session.executeNativeWatch(nativeReference(c.paired), c.v.selection, watchSelections, { watchId: 'owned', path: '.' }, undefined, value => values.push(value)); void watched.catch(() => {});
  await waitForWatch(() => values.length === 1); let starts = c.f.starts;
  await assert.rejects(start(c).result, error => error.code === 'CONFLICT'); assert.equal(c.f.starts, starts); assert.equal(c.f.starts - c.f.stops, 1);
  await c.v.session.executeNativeUnwatch(nativeReference(c.paired), c.v.selection, watchSelections, { watchId: 'owned' }); await watched; await stopped(c);
  const selections = await c.v.workflowSelections(); c.paired = await c.v.session.enableNativeWorkflow(nativeReference(c.paired), selections);
  const thread = () => c.v.session.executeNativeRuntime(nativeReference(c.paired), selections, selections.find(item => item.operation.rpc.method === 'thread/start'), {});
  await thread(); starts = c.f.starts;
  await assert.rejects(start(c).result, error => error.code === 'CONFLICT'); await thread(); assert.equal(c.f.starts, starts); assert.equal(c.f.starts - c.f.stops, 1);
  c.v.session.lock(); await stopped(c);
  const owned = await setup(this, { allowFilesystemWatch: true, onFrame }), run = start(owned); await approve(owned, run); starts = owned.f.starts;
  for (const call of [() => owned.v.session.checkNativeRuntime(nativeReference(owned.paired), owned.v.selection),
    () => owned.v.session.executeNativeWatch(nativeReference(owned.paired), owned.v.selection, ['fs/watch', 'fs/unwatch'].map(owned.select), { watchId: 'unavailable', path: '.' })]) {
    await assert.rejects(call(), error => error.code === 'CONFLICT'); assert.equal(owned.f.starts, starts); assert.equal(owned.f.starts - owned.f.stops, 1);
  }
  await control(owned, 'command/exec/terminate', { processId: 'owned' }); await run.result; await stopped(owned);
});

Then('command stream admission preserves ordinary serialization and bounded concurrency', () => {
  assert.equal(canStartVaultRequest(['executeNativeCommand'], 'controlNativeCommand'), true);
  assert.equal(canStartVaultRequest(Array(7).fill('executeNativeCommand'), 'executeNativeCommand'), true);
  assert.equal(canStartVaultRequest(Array(8).fill('executeNativeCommand'), 'executeNativeCommand'), false);
  assert.equal(canStartVaultRequest(['executeNativeCommand', 'controlNativeCommand'], 'executeNativeCommand'), false);
  assert.equal(canStartVaultRequest(['executeNativeWatch', 'executeNativeCommand'], 'controlNativeCommand'), true);
  assert.equal(canStartVaultRequest(['execute'], 'controlNativeCommand'), false);
});

Then('encrypted private command approval and binary process controls use the real SDK', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }), bytes = Buffer.from([0, 255, 128, 65, 10]), run = start(c, { command: [process.execPath, '-e', 'process.stdin.on("data",b=>process.stdout.write(b));'], processId: 'private-pipe', streamStdin: true, streamStdoutStderr: true });
  await approve(c, run); await control(c, 'command/exec/write', { processId: 'private-pipe', deltaBase64: bytes.toString('base64'), closeStdin: true });
  assert.equal((await run.result).response.result.exitCode, 0); const received = Buffer.concat(run.values.filter(value => value.stage === 'output').map(value => Buffer.from(value.notification.params.deltaBase64, 'base64'))); assert.deepEqual(received, bytes); await stopped(c);
  const buffered = start(c, { command: ['/bin/sh', '-c', 'printf "private buffered result"; exit 17'] }); await approve(c, buffered); assert.equal((await buffered.result).response.result.exitCode, 17); await stopped(c);
});

Then('the real private command broker preserves a sibling while cancelling one process', { timeout: 30000 }, async function () {
  const c = await setup(this, { real: true }), controller = new AbortController(), first = start(c, { command: [process.execPath, '-e', 'process.stdout.write("FIRST_READY\\n");setInterval(()=>{},1000);'], processId: 'first', streamStdoutStderr: true }, controller.signal); await approve(c, first);
  const sibling = start(c, { command: [process.execPath, '-e', 'process.stdout.write("SIBLING_READY\\n");setInterval(()=>{},1000);'], processId: 'sibling', streamStdoutStderr: true }); await approve(c, sibling);
  await waitForWatch(() => first.values.length > 1 && sibling.values.length > 1); controller.abort(); await assert.rejects(first.result, error => error.code === 'CANCELLED'); assert.equal(c.f.starts - c.f.stops, 1);
  await control(c, 'command/exec/terminate', { processId: 'sibling' }); await sibling.result; await stopped(c); assert.equal(calls(c, 'command/exec').length, 2);
});
