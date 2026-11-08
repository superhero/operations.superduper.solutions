// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, symlink, rename, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeCommandFixture, nativeCommandSocket, commandTicketScope } from '../tests/native-command.fixture.mjs';
import { waitForWatch } from '../tests/native-watch-transport.fixture.mjs';
import { nativeCommandParams, nativeCommandMethods, nativeCommandOutputMethod } from './lib/native-command.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';

Before({ tags: '@native-command-transport' }, function () { this.commandFixtures = []; });
After({ tags: '@native-command-transport' }, async function () { for (const f of this.commandFixtures.reverse()) await f.close(); });
async function setup(world, options = {}) { const f = await nativeCommandFixture(options); world.commandFixtures.push(f); return f; }
const frames = f => f.frames.filter(frame => frame.method?.startsWith('command/exec'));
const notes = socket => socket.messages.filter(frame => frame.method === nativeCommandOutputMethod);
const output = socket => Buffer.concat(notes(socket).map(frame => Buffer.from(frame.params.deltaBase64, 'base64')));
const stopped = f => waitForWatch(() => f.starts === f.stops);
async function closed(f, socket) { await waitForWatch(() => socket.ws.readyState === 3); await stopped(f); }

Then('command transport cannot borrow agent read write or MCP grants', async function () {
  const denied = await setup(this, { allowCommands: false, allowAgent: true, allowFilesystemRead: true, allowFilesystemWrite: true, allowFilesystemWatch: true, allowMcpRead: true, allowMcpTools: true, allowMcpOAuth: true });
  assert.equal((await denied.ticket(commandTicketScope())).status, 400); assert.equal(denied.starts, 0);
  const f = await setup(this);
  for (const method of ['codex-workflow', 'fs/readFile', 'fs/writeFile', 'codex-filesystem-watch', 'mcpServer/oauth/login', 'command/exec']) assert.equal((await f.ticket({ ...commandTicketScope(), method })).status, 400);
  const socket = await nativeCommandSocket(f); socket.send('thread/start', {}); await closed(f, socket); assert.equal(frames(f).length, 0);
});

Then('command approval gates exact prepared arguments and refuses unrelated replies', { timeout: 20000 }, async function () {
  for (const decision of ['accept', 'decline', 'cancel']) {
    const f = await setup(this), socket = await nativeCommandSocket(f), id = socket.send('command/exec', { command: ['/bin/echo', 'one literal; argument'], processId: 'owned' }), prompt = await socket.approval(id);
    assert.equal(frames(f).length, 0); assert.deepEqual(prompt.params.params.command, ['/bin/echo', 'one literal; argument']); assert.equal(prompt.params.params.cwd, f.workspace);
    socket.approve(prompt, decision);
    if (decision === 'accept') { await socket.dispatched(id); await waitForWatch(() => frames(f).length === 1); f.finishCommand('owned', { exitCode: 17, stdout: 'same argv', stderr: 'owned stderr' }); assert.equal((await socket.response(id)).result.exitCode, 17); }
    else { assert.ok((await socket.response(id)).error); assert.equal(frames(f).length, 0); }
    socket.approve(prompt); await closed(f, socket);
  }
  const f = await setup(this), socket = await nativeCommandSocket(f), id = socket.send('command/exec', { command: ['pwd'] }), prompt = await socket.approval(id);
  socket.approve({ ...prompt, id: randomUUID() }); await closed(f, socket); assert.equal(frames(f).length, 0);
  const bounded = await setup(this), limited = await nativeCommandSocket(bounded);
  for (let n = 0; n < 4; n++) await limited.approval(limited.send('command/exec', { command: ['owned'], processId: 'pending_' + n }));
  limited.send('command/exec', { command: ['must not enter'], processId: 'fifth' }); await closed(bounded, limited); assert.equal(frames(bounded).length, 0);
});

Then('only the owned running process accepts stdin terminal resize and termination', { timeout: 20000 }, async function () {
  const f = await setup(this), socket = await nativeCommandSocket(f), { id } = await socket.start({ command: ['owned'], processId: 'pty', tty: true, size: { rows: 24, cols: 80 } });
  assert.deepEqual((await socket.call('command/exec/resize', { processId: 'pty', size: { rows: 40, cols: 120 } })).result, {});
  assert.deepEqual((await socket.call('command/exec/write', { processId: 'pty', deltaBase64: Buffer.from([0, 255, 65]).toString('base64') })).result, {});
  assert.deepEqual((await socket.call('command/exec/terminate', { processId: 'pty' })).result, {});
  f.finishCommand('pty'); assert.deepEqual((await socket.response(id)).result, { exitCode: 0, stdout: '', stderr: '' });
  socket.send('command/exec/write', { processId: 'pty', closeStdin: true }); await closed(f, socket); assert.equal(frames(f).length, 4);
  for (const mode of ['foreign', 'not-tty', 'not-stdin', 'reused']) {
    const f = await setup(this), socket = await nativeCommandSocket(f), { id } = await socket.start({ command: ['owned'], processId: 'plain' });
    if (mode === 'reused') { f.finishCommand('plain'); await socket.response(id); socket.send('command/exec', { command: ['owned'], processId: 'plain' }); }
    else socket.send(mode === 'not-tty' ? 'command/exec/resize' : 'command/exec/write', mode === 'not-tty' ? { processId: 'plain', size: { rows: 1, cols: 1 } } : { processId: mode === 'foreign' ? 'other' : 'plain', closeStdin: true });
    await closed(f, socket); assert.equal(frames(f).length, 1);
  }
});

Then('command transport validates argv environment dimensions bytes and option bounds', async function () {
  const valid = { command: ['program', '', 'a|b', 'line\n'], env: JSON.parse('{"__proto__":"literal","REMOVE":null}'), processId: null, timeoutMs: null, cwd: null };
  assert.deepEqual(nativeCommandParams('command/exec', valid), valid);
  for (const params of [{ command: [] }, { command: [''] }, { command: ['a\0b'] }, { command: ['x'], sandboxPolicy: { type: 'danger-full-access' } },
    { command: ['x'], permissionProfile: 'foreign' }, { command: ['x'], tty: true }, { command: ['x'], size: { rows: 1, cols: 1 } },
    { command: ['x'], processId: 'a', tty: true, size: { rows: 0, cols: 1 } }, { command: ['x'], timeoutMs: -1 }, { command: ['x'], timeoutMs: 300001 },
    { command: ['x'], timeoutMs: 1, disableTimeout: true }, { command: ['x'], disableOutputCap: true }, { command: ['x'], outputBytesCap: 16385 },
    { command: ['x'], env: { 'INVALID=NAME': 'x' } }, { command: ['x'], env: { A: 2 } }, { command: ['x'], env: { PATH: null } }, { command: ['x'], streamStdin: 'true' }]) assert.throws(() => nativeCommandParams('command/exec', params));
  for (const params of [{ processId: 'x' }, { processId: 'x', deltaBase64: 'AB==' }, { processId: 'x', deltaBase64: 'YQ' }, { processId: 'x', closeStdin: 'true' }]) assert.throws(() => nativeCommandParams('command/exec/write', params));
});

Then('command transport rejects foreign symlinked and replaced working directories', { timeout: 20000 }, async function () {
  for (const path of ['..', 'escape']) {
    const f = await setup(this); await symlink(f.home, join(f.workspace, 'escape')); const socket = await nativeCommandSocket(f);
    socket.send('command/exec', { command: ['pwd'], cwd: path }); await closed(f, socket); assert.equal(frames(f).length, 0);
  }
  const f = await setup(this); await mkdir(join(f.workspace, 'directory')); const socket = await nativeCommandSocket(f), id = socket.send('command/exec', { command: ['pwd'], cwd: 'directory' }), prompt = await socket.approval(id);
  await rename(join(f.workspace, 'directory'), join(f.workspace, 'old')); await symlink(f.home, join(f.workspace, 'directory')); socket.approve(prompt);
  await closed(f, socket); assert.equal(frames(f).length, 0);
});

Then('command output enforces caps correlation and decoded credential checks', { timeout: 20000 }, async function () {
  const f = await setup(this), socket = await nativeCommandSocket(f), { id } = await socket.start({ command: ['owned'], processId: 'binary', streamStdoutStderr: true });
  await waitForWatch(() => f.outputCommand); f.outputCommand('binary', Buffer.from([0, 255, 128, 65, 255])); await waitForWatch(() => notes(socket).length === 1);
  assert.deepEqual(output(socket), Buffer.from([0, 255, 128, 65, 255])); f.finishCommand('binary'); assert.equal((await socket.response(id)).result.stdout, '');
  for (const mode of ['foreign', 'malformed', 'cap', 'secret', 'split-secret', 'terminal', 'malformed-terminal']) {
    const f = await setup(this), socket = await nativeCommandSocket(f), { id } = await socket.start({ command: ['owned'], processId: 'output', streamStdoutStderr: mode !== 'terminal', outputBytesCap: mode === 'cap' ? 1 : 16384 }); await waitForWatch(() => f.outputCommand);
    if (mode === 'malformed-terminal') f.finishCommand('output', { exitCode: '0', stdout: '', stderr: '' });
    else if (mode === 'terminal') f.finishCommand('output', { exitCode: 0, stdout: 'private ' + f.key, stderr: '' });
    else if (mode === 'split-secret') { f.outputCommand('output', f.key.slice(0, 10)); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(notes(socket).length, 0); f.outputCommand('output', f.key.slice(10)); }
    else f.outputCommand(mode === 'foreign' ? 'unowned' : 'output', mode === 'secret' ? f.key : 'too many bytes', 'stdout', mode === 'malformed' ? { deltaBase64: 'AB==' } : {});
    await closed(f, socket); assert.equal(output(socket).includes(Buffer.from(f.key)), false); assert.equal(socket.messages.some(frame => frame.id === id && frame.result), false);
  }
});

Then('command cancellation and authority changes close owned sessions without replay', { timeout: 20000 }, async function () {
  for (const mode of ['cancel', 'identity', 'workspace', 'source-before-approval']) {
    const f = await setup(this), socket = await nativeCommandSocket(f), id = socket.send('command/exec', { command: ['owned'], processId: 'cancel', streamStdoutStderr: true }), prompt = await socket.approval(id);
    if (mode === 'source-before-approval') { f.identity.configuration = 'e'.repeat(64); socket.approve(prompt); }
    else {
      socket.approve(prompt); await socket.dispatched(id); await waitForWatch(() => f.outputCommand);
      if (mode === 'cancel') socket.ws.send(JSON.stringify({ type: 'cancel', id }));
      else { f.identity[mode === 'identity' ? 'accountEpoch' : 'workspace'] = mode === 'identity' ? randomUUID() : 'e'.repeat(64); f.outputCommand('cancel', 'late output'); }
    }
    await closed(f, socket); const count = frames(f).length, replay = await f.socket(socket.ticket.value.ticket); await waitForWatch(() => replay.ws.readyState === 3); assert.equal(frames(f).length, count);
  }
});

Then('a standalone command role cannot issue thread shell requests', async function () {
  const f = await setup(this, { allowAgent: true, allowThreadShell: true }), socket = await nativeCommandSocket(f);
  socket.send('thread/shellCommand', { threadId: 'foreign', command: 'pwd' }); await closed(f, socket);
  assert.equal(f.frames.filter(frame => frame.method === 'thread/shellCommand').length, 0);
});

Then('the pinned command SDK executes approved buffered commands with its configured boundaries', { timeout: 30000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeCommandSocket(f); await writeFile(join(f.home, 'private-probe'), 'PRIVATE_COMMAND_HOME');
  const { id } = await socket.start({ command: ['/bin/sh', '-c', 'printf "%s|%s|" "$OWNED_VALUE" "${REMOVE_ME-unset}"; pwd; printf "owned stderr" >&2; exit 17'], env: { OWNED_VALUE: 'literal;$(no expansion)', REMOVE_ME: null } });
  const result = (await socket.response(id)).result; assert.equal(result.exitCode, 17); assert.equal(result.stderr, 'owned stderr'); assert.ok(result.stdout.startsWith('literal;$(no expansion)|unset|')); assert.ok(result.stdout.includes(f.workspace));
  const denied = await socket.start({ command: ['/bin/cat', join(f.home, 'private-probe')] }), denial = (await socket.response(denied.id)).result;
  assert.notEqual(denial.exitCode, 0); assert.equal(denial.stdout.includes('PRIVATE_COMMAND_HOME'), false);
  const write = await socket.start({ command: ['/bin/sh', '-c', 'printf x > command-write-denied'] }); assert.notEqual((await socket.response(write.id)).result.exitCode, 0);
  let connections = 0; const server = createServer(client => { connections++; client.destroy(); }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const command = [process.execPath, '-e', `const s=require('node:net').connect(${server.address().port},'127.0.0.1');s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(77));setTimeout(()=>process.exit(78),1000);`];
    const started = await socket.start({ command }); assert.equal((await socket.response(started.id)).result.exitCode, 77); assert.equal(connections, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await socket.close(); await stopped(f);
});

Then('the pinned command SDK preserves stdin bytes and ordered binary output', { timeout: 30000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeCommandSocket(f), bytes = Buffer.from([0, 255, 128, 65, 10]);
  const { id } = await socket.start({ command: [process.execPath, '-e', 'process.stdin.on("data",b=>process.stdout.write(b));'], processId: 'owned-pipe', streamStdin: true, streamStdoutStderr: true });
  assert.deepEqual((await socket.call('command/exec/write', { processId: 'owned-pipe', deltaBase64: bytes.toString('base64'), closeStdin: true })).result, {});
  const result = (await socket.response(id)).result; assert.deepEqual(result, { exitCode: 0, stdout: '', stderr: '' }); assert.deepEqual(output(socket), bytes);
  const count = notes(socket).length; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(notes(socket).length, count);
  await socket.close(); await stopped(f);
});

async function markerPids(marker) {
  const matches = [];
  for (const name of await readdir('/proc')) if (/^[0-9]+$/.test(name)) {
    try { const command = await readFile('/proc/' + name + '/cmdline'); if (command.includes(Buffer.from(marker))) matches.push(Number(name)); } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
  }
  return matches;
}
Then('the pinned command SDK resizes and terminates its owned PTY and closes child processes', { timeout: 30000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeCommandSocket(f);
  const { id } = await socket.start({ command: ['/bin/sh', '-c', 'printf "OWNED_READY\\n"; IFS= read -r value; stty size; printf "GOT:%s\\n" "$value"; sleep 30'], processId: 'owned-pty', tty: true, size: { rows: 24, cols: 80 } });
  await waitForWatch(() => output(socket).includes(Buffer.from('OWNED_READY')) || socket.messages.some(frame => frame.id === id) || socket.ws.readyState === 3);
  assert.ok(output(socket).includes(Buffer.from('OWNED_READY')), 'PTY startup: ' + JSON.stringify({ frames: socket.messages, errors: f.commandErrors }));
  assert.deepEqual((await socket.call('command/exec/resize', { processId: 'owned-pty', size: { rows: 40, cols: 120 } })).result, {});
  assert.deepEqual((await socket.call('command/exec/write', { processId: 'owned-pty', deltaBase64: Buffer.from('typed input\n').toString('base64') })).result, {});
  await waitForWatch(() => output(socket).includes(Buffer.from('GOT:typed input'))); assert.ok(output(socket).includes(Buffer.from('40 120')));
  assert.deepEqual((await socket.call('command/exec/terminate', { processId: 'owned-pty' })).result, {}); assert.ok(Number.isInteger((await socket.response(id)).result.exitCode));
  const marker = 'owned-command-cleanup-' + randomUUID();
  const running = await socket.start({ command: [process.execPath, '-e', 'process.stdout.write("CLEANUP_READY\\n");setInterval(()=>{},1000);', marker], processId: 'disconnect-owned', streamStdoutStderr: true });
  await waitForWatch(() => output(socket).includes(Buffer.from('CLEANUP_READY'))); assert.ok((await markerPids(marker)).length > 0);
  await socket.close(); await stopped(f);
  const end = Date.now() + 4000; while ((await markerPids(marker)).length) { assert.ok(Date.now() < end, 'Owned command survived disconnect.'); await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(socket.messages.some(frame => frame.id === running.id && frame.result), false);
});

Then('the pinned command dispatcher stays pinned across PATH overrides and approval changes', { timeout: 30000 }, async function () {
  const f = await setup(this, { real: true }), socket = await nativeCommandSocket(f), directory = join(f.workspace, 'caller-bin'); await mkdir(directory);
  await writeFile(join(directory, 'codex-linux-sandbox'), '#!/bin/sh\nprintf "DISPATCH_HIJACKED\\n"\n', { mode: 0o700 });
  const { id } = await socket.start({ command: ['/bin/echo', 'PINNED_DISPATCH'], processId: 'pinned-dispatch', tty: true, env: { PATH: directory + ':/usr/bin:/bin' } });
  assert.equal((await socket.response(id)).result.exitCode, 0); assert.ok(output(socket).includes(Buffer.from('PINNED_DISPATCH'))); assert.equal(output(socket).includes(Buffer.from('DISPATCH_HIJACKED')), false);
  await socket.close(); await stopped(f);
  const changed = await setup(this, { real: true }), owned = await nativeCommandSocket(changed), request = owned.send('command/exec', { command: ['/bin/echo', 'must not run'], processId: 'changed-dispatch', tty: true });
  const prompt = await owned.approval(request), alias = join(changed.home, '.operations-dispatch', 'codex-linux-sandbox');
  await unlink(alias); await symlink('/bin/sh', alias); owned.approve(prompt); await closed(changed, owned); assert.equal(frames(changed).length, 0);
});
