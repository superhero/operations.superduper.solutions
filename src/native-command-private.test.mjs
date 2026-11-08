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
import { nativeCommandMethods, isNativeCommandValue, nativeCommandApprovalMethod, nativeCommandDispatchedMethod, nativeCommandOutputMethod } from './lib/native-command.ts';
import { canStartVaultRequest } from './lib/secrets/request-policy.ts';
import { NativeCommandBroker, nativeCommandReview } from './lib/secrets/native-command.ts';
import { VaultError } from './lib/secrets/types.ts';

Before({ tags: '@native-command-private' }, function () { this.privateCommands = []; });
After({ tags: '@native-command-private' }, async function () { for (const { f, v } of this.privateCommands.reverse()) { v.session.lock(); await f.close(); } });
async function setup(world, options = {}) {
  const f = await nativeCommandFixture({ autoTerminate: true, ...options });
  if (options.editFrames) {
    const Socket = f.runtime.WebSocket;
    f.runtime.WebSocket = class extends Socket {
      addEventListener(name, listener, config) {
        if (name !== 'message') return super.addEventListener(name, listener, config);
        return super.addEventListener(name, event => {
          for (const frame of options.editFrames(JSON.parse(event.data))) listener({ data: JSON.stringify(frame) });
        }, config);
      }
    };
  }
  const v = await nativeVaultFixture(f); world.privateCommands.push({ f, v });
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

Then('private command preparation cannot replace its argv directory cap environment or request owner', { timeout: 60000 }, async function () {
  for (const mode of ['argv', 'cwd', 'cap', 'environment', 'path', 'approval-id', 'request-id', 'early-output']) {
    const c = await setup(this, { editFrames(frame) {
      if (frame.method !== nativeCommandApprovalMethod) return [frame];
      const next = structuredClone(frame), p = next.params.params;
      if (mode === 'argv') p.command = ['unreviewed'];
      if (mode === 'cwd') p.cwd = 'relative';
      if (mode === 'cap') p.outputBytesCap = 1;
      if (mode === 'environment') p.env.OWNED = 'changed';
      if (mode === 'path') p.env.PATH = '/unowned/bin';
      if (mode === 'approval-id') next.id = 'not-an-owned-uuid';
      if (mode === 'request-id') next.params.requestId = 'foreign_request';
      if (mode === 'early-output') return [{ method: nativeCommandOutputMethod,
        params: { processId: 'guarded', stream: 'stdout', deltaBase64: 'YQ==', capReached: false } }, next];
      return [next];
    } });
    const run = start(c, { command: ['owned'], processId: 'guarded', env: { OWNED: 'expected', PATH: '/owned/bin' } });
    await assert.rejects(run.result, error => error.code === 'NATIVE_CONTRACT', mode);
    assert.deepEqual(run.notices, []); assert.deepEqual(run.values, []); assert.equal(calls(c, 'command/exec').length, 0);
    await stopped(c);
  }
});

Then('private command preparation preserves owned PATH prefixes and unrelated environment values', { timeout: 60000 }, async function () {
  for (const mode of ['default', 'same', 'prefix']) {
    const c = await setup(this, { configureRuntime(runtime) {
      const prepare = runtime.prepareCommand;
      runtime.prepareCommand = async input => {
        const plan = await prepare(input);
        plan.params.env = { ...plan.params.env, PATH: mode === 'default' ? '/owned/dispatcher' : mode === 'same' ? input.env.PATH : '/owned/dispatcher:' + input.env.PATH };
        return plan;
      };
    } });
    const env = mode === 'default' ? { OWNED: 'retained' } : { OWNED: 'retained', PATH: '/owned/bin' };
    const run = start(c, { command: ['owned'], processId: 'environment', env });
    await approve(c, run); assert.equal(run.notices[0].params.env.OWNED, 'retained');
    c.f.finishCommand('environment', { exitCode: 0, stdout: 'owned terminal', stderr: '' });
    assert.equal((await run.result).response.result.stdout, 'owned terminal');
    assert.equal(calls(c, 'command/exec').length, 1); await stopped(c);
  }
});

Then('private command dispatch and output cannot acquire another process or exceed their approved cap', { timeout: 60000 }, async function () {
  for (const mode of ['dispatch', 'foreign-output', 'unknown-output', 'cap']) {
    const c = await setup(this, { editFrames(frame) {
      const next = structuredClone(frame);
      if (mode === 'dispatch' && next.method === nativeCommandDispatchedMethod) next.params.processId = 'foreign_process';
      if (mode === 'foreign-output' && next.method === nativeCommandOutputMethod) next.params.processId = 'foreign_process';
      if (mode === 'unknown-output' && next.method === nativeCommandOutputMethod) next.method = 'unreviewed/output';
      if (mode === 'cap' && next.method === nativeCommandOutputMethod) next.params.deltaBase64 = Buffer.from('too much').toString('base64');
      return [next];
    } });
    const run = start(c, { command: ['owned'], processId: 'bounded', streamStdoutStderr: true, ...(mode === 'cap' ? { outputBytesCap: 1 } : {}) });
    await waitForWatch(() => run.notices.length === 1);
    await c.v.session.replyNativeCommand(c.paired.id, run.notices[0].token, 'accept');
    if (mode !== 'dispatch') { await waitForWatch(() => run.values.length === 1); c.f.outputCommand('bounded', 'x'); }
    await assert.rejects(run.result, error => error.code === (mode === 'cap' ? 'LIMIT' : 'NATIVE_CONTRACT'), mode);
    assert.equal(run.values.filter(value => value.stage === 'output' || value.stage === 'completed').length, 0);
    assert.equal(calls(c, 'command/exec').length, 1); await stopped(c);
  }
});

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

function commandGate() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function controlledCommands(world, options = {}) {
  const c = { options, channels: new Map(), requests: [], jobs: [] };
  const runtime = { commanding: id => c.channels.has(id), close(id) {
    const channel = c.channels.get(id); c.channels.delete(id); channel?.events.closed();
    for (const request of c.requests.filter(request => request.owner === id)) request.reject?.(new VaultError('NETWORK'));
  }, async commandChannel(id, _host, _key, _fingerprint, identity, _guard, events) {
    c.events = events;
    const peer = { close: () => runtime.close(id), request(method, params, _signal, requestId) {
      const request = { method, params, requestId, owner: id }; c.requests.push(request);
      if (method === 'command/exec') return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; options.request?.(request); });
      if (options.control) return options.control(request);
      if (method === 'command/exec/terminate') queueMicrotask(() => c.requests.find(item => item.method === 'command/exec' && item.owner === id && item.params.processId === params.processId)?.resolve({ exitCode: 0, stdout: '', stderr: '' }));
      return Promise.resolve({});
    }, reply(_hostId, result) {
      options.reply?.(result);
      const request = c.requests.findLast(item => item.owner === id && item.method === 'command/exec');
      if (result.decision !== 'accept') request.reject(new VaultError('NATIVE_COMMAND'));
    } };
    c.channels.set(id, { peer, identity, events }); if (options.openGate) await options.openGate.promise; options.onOpen?.(c); return peer;
  } };
  c.broker = new NativeCommandBroker(runtime);
  c.authority = { id: randomUUID(), host: 'https://owned.example.test', key: 'K'.repeat(43), fingerprint: 'a'.repeat(64), identity: {
    runtimeId: randomUUID(), generation: randomUUID(), accountEpoch: randomUUID(), version: '0.163.0', configuration: 'b'.repeat(64), workspace: 'c'.repeat(64) }, guard: async () => options.guard?.(c) };
  c.start = (params = { command: ['owned'], processId: 'owned' }, signal, authority = c.authority) => {
    const run = { params, authority, values: [], notices: [] };
    run.result = c.broker.execute(authority, params, options.review ?? nativeCommandReview([]), value => run.notices.push(value), value => run.values.push(value), signal);
    void run.result.catch(() => {}); c.jobs.push(run.result); return run;
  };
  c.request = run => c.requests.findLast(request => request.owner === run.authority.id && request.method === 'command/exec' && request.params.processId === run.params.processId);
  c.emit = (frame, identity = c.authority.identity) => c.events.frame(frame, identity);
  c.prompt = async run => {
    await waitForWatch(() => c.request(run));
    c.emit({ id: randomUUID(), method: nativeCommandApprovalMethod, params: { requestId: c.request(run).requestId,
      params: { ...structuredClone(run.params), cwd: '/owned', outputBytesCap: run.params.outputBytesCap ?? 16384 } } });
  };
  c.dispatch = run => c.emit({ method: nativeCommandDispatchedMethod, params: { requestId: c.request(run).requestId, processId: run.params.processId ?? null } });
  c.accept = async run => { await c.prompt(run); await waitForWatch(() => run.notices.length === 1); await c.broker.reply(run.authority.id, run.notices[0].token, 'accept'); c.dispatch(run); await waitForWatch(() => run.values.length === 1); };
  world.privateCommands.push({ v: { session: { lock: () => c.broker.clear() } }, f: { async close() { options.openGate?.resolve(); c.broker.clear(); await Promise.allSettled(c.jobs); } } }); return c;
}

Then('private command owners preserve stamped authority shared capacity and finite event queues', async function () {
  const c = controlledCommands(this), authorities = Array.from({ length: 4 }, () => ({ ...c.authority, id: randomUUID() })), running = authorities.map(authority => c.start(undefined, undefined, authority));
  await waitForWatch(() => c.requests.length === 4);
  await assert.rejects(c.start(undefined, undefined, { ...c.authority, id: randomUUID() }).result, { code: 'LIMIT' });
  await assert.rejects(c.start(undefined, undefined, authorities[1]).result, { code: 'CONFLICT' });
  await assert.rejects(c.start(undefined, undefined, { ...authorities[0], fingerprint: 'd'.repeat(64) }).result, { code: 'CONFLICT' });
  await assert.rejects(running[0].result, { code: 'CONFLICT' }); c.broker.clear();
  await Promise.all(running.slice(1).map(run => assert.rejects(run.result, { code: 'CANCELLED' })));
  for (const mode of ['identity', 'queue', 'guard']) {
    const gate = commandGate(), owner = controlledCommands(this), work = owner.start(); await waitForWatch(() => owner.requests.length === 1);
    if (mode === 'identity') assert.throws(() => owner.emit({ method: 'unowned' }, { ...owner.authority.identity, workspace: 'e'.repeat(64) }), { code: 'NATIVE_CONTRACT' });
    else if (mode === 'queue') {
      owner.options.guard = () => gate.promise;
      for (let index = 0; index < 32; index++) owner.emit({ method: 'unowned' });
      assert.throws(() => owner.emit({ method: 'unowned' }), { code: 'NATIVE_CONTRACT' }); gate.resolve();
    } else { owner.options.guard = () => { throw new Error('untrusted guard detail'); }; owner.emit({ method: 'unowned' }); }
    await assert.rejects(work.result, { code: 'NATIVE_CONTRACT' });
    assert.throws(() => owner.emit({ method: 'unowned' }), { code: 'NATIVE_CONTRACT' }); assert.deepEqual(work.values, []);
  }
});

Then('private command cancellation retains opening approval and dispatch barriers including anonymous processes', async function () {
  const aborted = controlledCommands(this); await assert.rejects(aborted.start(undefined, AbortSignal.abort()).result, { code: 'CANCELLED' }); assert.equal(aborted.channels.size, 0);
  for (const phase of ['opening', 'ready', 'registration', 'approval', 'approved', 'anonymous']) {
    const gate = commandGate(), controller = new AbortController();
    const options = phase === 'opening' ? { openGate: gate } : phase === 'ready' ? { onOpen: owner => { options.guard = () => owner.broker.close(owner.authority.id); } }
      : phase === 'registration' ? { guard: () => controller.abort() } : {};
    const c = controlledCommands(this, options), run = c.start(phase === 'anonymous' ? { command: ['owned'] } : undefined, controller.signal);
    if (phase === 'opening') { await waitForWatch(() => c.channels.size === 1); c.broker.close(c.authority.id); gate.resolve(); }
    else if (phase !== 'ready') {
      await waitForWatch(() => c.requests.length === 1);
      if (phase === 'approved') {
        await c.prompt(run); await waitForWatch(() => run.notices.length === 1); await c.broker.reply(c.authority.id, run.notices[0].token, 'accept'); controller.abort(); c.dispatch(run);
      } else if (phase === 'anonymous') { await c.accept(run); controller.abort(); }
      else { controller.abort(); await c.prompt(run); }
    }
    await assert.rejects(run.result, { code: 'CANCELLED' }); await waitForWatch(() => c.channels.size === 0);
    assert.equal(run.values.some(value => value.stage === 'completed'), false);
  }
  const anonymous = controlledCommands(this), run = anonymous.start({ command: ['owned'] }); await anonymous.accept(run);
  anonymous.request(run).resolve({ exitCode: 0, stdout: 'complete anonymous output', stderr: '' });
  assert.equal((await run.result).stdout, 'complete anonymous output'); assert.equal(run.values.at(-1).processId, null);
});

Then('private command controls retain signal identity authority and post-request cancellation', async function () {
  const c = controlledCommands(this), run = c.start(); await c.accept(run);
  const review = nativeCommandReview([]), params = { processId: 'owned', size: { cols: 80, rows: 24 } };
  await assert.rejects(c.broker.control(c.authority, 'command/exec/resize', params, review, AbortSignal.abort()), { code: 'CANCELLED' });
  await assert.rejects(c.broker.control({ ...c.authority, fingerprint: 'd'.repeat(64) }, 'command/exec/resize', params, review), { code: 'CONFLICT' });
  const controller = new AbortController(); c.options.control = () => { controller.abort(); return {}; };
  await assert.rejects(c.broker.control(c.authority, 'command/exec/resize', params, review, controller.signal), { code: 'CANCELLED' });
  c.broker.clear(); await assert.rejects(run.result, { code: 'CANCELLED' });
  const closed = controlledCommands(this), pending = closed.start(); await closed.prompt(pending); await waitForWatch(() => pending.notices.length === 1);
  closed.options.guard = owner => owner.broker.close(owner.authority.id);
  await assert.rejects(closed.broker.reply(closed.authority.id, pending.notices[0].token, 'accept'), { code: 'PERMISSION' });
  await assert.rejects(pending.result, { code: 'CANCELLED' });
  const early = controlledCommands(this), unfinished = early.start(); await waitForWatch(() => early.requests.length === 1);
  early.request(unfinished).resolve({ exitCode: 0, stdout: '', stderr: '' }); await assert.rejects(unfinished.result, { code: 'NATIVE_CONTRACT' });
});

Then('private command cancellation callback faults remain contained and buffered output stays private', async function () {
  const broken = controlledCommands(this, { reply() { throw new Error('controlled cancellation reply failed'); } }), controller = new AbortController(), run = broken.start(undefined, controller.signal);
  await waitForWatch(() => broken.requests.length === 1); controller.abort(); await broken.prompt(run);
  await assert.rejects(run.result, { code: 'NATIVE_CONTRACT' }); assert.deepEqual(run.values, []);
  const dispatched = controlledCommands(this, { request() { throw new Error('controlled dispatcher failed'); } });
  await assert.rejects(dispatched.start().result, { code: 'NATIVE_CONTRACT' });
  const cancelled = new AbortController(), buffered = controlledCommands(this, { review: nativeCommandReview(['OWNED_SECRET_PRIVATE_8469']) }), pending = buffered.start(undefined, cancelled.signal);
  await buffered.accept(pending);
  buffered.emit({ method: nativeCommandOutputMethod, params: { processId: 'owned', stream: 'stdout', deltaBase64: Buffer.from('OWNED_SECRET_').toString('base64'), capReached: false } });
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(pending.values.length, 1);
  cancelled.abort(); await assert.rejects(pending.result, { code: 'CANCELLED' });
  assert.equal(pending.values.some(value => value.stage === 'output' || value.stage === 'completed'), false);
});
