// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, symlink, link, readlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeFilesystemWriteFixture, nativeFilesystemMutationInputs as inputs, nativeFilesystemMutationObserved } from '../tests/native-filesystem-write.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeFilesystemWriteMethods as methods } from './lib/native-runtime-contract.ts';
import { nativeInitializeParams } from './lib/native-initialize.ts';
import { nativeFilesystemWriteParams, nativeFilesystemWriteLimits as limits } from './lib/native-filesystem-write.ts';
import { prepareNativeFilesystemWrite } from '../companions/codex/filesystem-write.mjs';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { parseWorkflowDocument, portableWorkflowDocument } from './lib/workflow-document.ts';

Before({ tags: '@native-filesystem-write' }, function () { this.fileWrites = []; });
After({ tags: '@native-filesystem-write' }, async function () { for (const { v, f } of this.fileWrites.reverse()) { v.session.lock(); await f.close(); } });
const wait = async predicate => { const end = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < end, 'Mutation transition timed out.'); await new Promise(resolve => setTimeout(resolve, 5)); } };
async function setup(world, options = {}) {
  const f = await nativeFilesystemWriteFixture(options), v = await nativeVaultFixture(f); world.fileWrites.push({ f, v });
  const source = await readServiceSchema('codex'), selections = Object.fromEntries(methods.map(method => {
    const document = scopeNativeRpcSchema(source, method); return [method, { document, operation: nativeRpcOperation(document, 'codex:' + method) }];
  }));
  const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const execute = (method, params, signal) => v.session.executeNativeQuery(nativeReference(paired), v.selection, selections[method], params, signal);
  return { f, v, selections, paired, execute };
}
Then('native filesystem write authority stays separate from every other grant', async function () {
  const disabled = await setup(this, { allowFilesystemWrite: false, allowAgent: true }), before = disabled.f.starts;
  for (const method of methods) await assert.rejects(disabled.execute(method, inputs[method]), error => error.code === 'NATIVE_FILESYSTEM');
  assert.equal(disabled.f.starts, before);
  const { f, execute } = await setup(this, { allowMetadata: false, allowApps: false, allowFilesystemRead: false });
  for (const method of methods) { assert.deepEqual((await execute(method, inputs[method])).response.result, {}); await wait(() => f.starts === f.stops); }
  for (const method of ['fs/watch', 'fs/unwatch', 'command/exec']) assert.equal((await f.ticket({ connectionId: crypto.randomUUID(), method, fingerprint: 'c'.repeat(64) })).status, 400);
  for (const method of ['fs/readFile', 'model/list', 'app/list']) assert.equal((await f.ticket({ connectionId: crypto.randomUUID(), method, fingerprint: 'c'.repeat(64) })).status, 400);
  const ticket = await f.ticket({ connectionId: crypto.randomUUID(), method: 'fs/writeFile', fingerprint: 'c'.repeat(64) });
  const socket = await f.socket(ticket.value.ticket); assert.equal((await socket.next()).type, 'paired');
  socket.ws.send(JSON.stringify({ id: 1, method: 'initialize', params: nativeInitializeParams() })); await socket.next();
  socket.ws.send(JSON.stringify({ method: 'initialized' }));
  const beforeRepeat = f.frames.filter(frame => frame.method === 'fs/writeFile').length;
  socket.ws.send(JSON.stringify({ id: 2, method: 'fs/writeFile', params: { path: join(f.workspace, 'once.bin'), dataBase64: '' } }));
  assert.deepEqual((await socket.next()).result, {});
  socket.ws.send(JSON.stringify({ id: 3, method: 'fs/writeFile', params: { path: join(f.workspace, 'twice.bin'), dataBase64: '' } }));
  await wait(() => socket.ws.readyState === 3 && f.starts === f.stops);
  assert.equal(f.frames.filter(frame => frame.method === 'fs/writeFile').length, beforeRepeat + 1);
  await assert.rejects(lstat(join(f.workspace, 'twice.bin')), error => error.code === 'ENOENT');
});
Then('native filesystem mutations preserve their exact parameters results and portable models', async function () {
  const { f, selections, execute } = await setup(this);
  for (const method of methods) {
    const params = inputs[method];
    assert.deepEqual((await execute(method, params)).response.result, {}); await wait(() => f.starts === f.stops);
    assert.equal(await nativeFilesystemMutationObserved(f.workspace, method), true, method);
    const sent = f.frames.find(frame => frame.method === method);
    assert.deepEqual(sent.params, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, k === 'path' || k.endsWith('Path') ? join(f.workspace, v) : v])));
    const { operation, document } = selections[method];
    const values = Object.fromEntries(Object.entries(params).map(([k, v]) => ['params:' + k, typeof v === 'string' ? v : JSON.stringify(v)]));
    assert.deepEqual(prepareNativeRequest(operation, values).params, params);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'mutation', document);
    const saved = { version: 3, id: 'native-mutation', name: 'Native mutation', ...graph, viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false };
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)), saved); assert.deepEqual(portableWorkflowDocument(saved), saved);
    assert.ok(graph.nodes.flatMap(node => node.data?.fields ?? []).some(field => JSON.parse(decodeURIComponent(field.id))[1] === '/result' && field.type === 'Object' && field.connectable));
  }
  assert.equal(await readlink(join(f.workspace, 'write-link.bin')), 'written.bin');
  const before = f.frames.filter(frame => methods.includes(frame.method)).length;
  await assert.rejects(execute('fs/createDirectory', { path: 'missing/child', recursive: false }), error => error.code === 'NATIVE_FILESYSTEM');
  await wait(() => f.starts === f.stops);
  await assert.rejects(execute('fs/remove', { path: 'missing', force: false }), error => error.code === 'NATIVE_FILESYSTEM');
  await wait(() => f.starts === f.stops);
  await execute('fs/remove', { path: 'missing', recursive: null, force: null }); await wait(() => f.starts === f.stops);
  assert.equal(f.frames.filter(frame => methods.includes(frame.method)).length, before + 3);
});
Then('filesystem mutations validate every source destination and recursive tree before dispatch', async function () {
  const { f, execute } = await setup(this);
  await writeFile(join(f.home, 'private.txt'), 'private'); await symlink(f.home, join(f.workspace, 'escape'));
  await link(join(f.home, 'private.txt'), join(f.workspace, 'hard-link')); execFileSync('mkfifo', [join(f.workspace, 'pipe')], { timeout: 1000 });
  await symlink(join(f.home, 'missing'), join(f.workspace, 'dangling-parent'));
  const invalid = ['.', '..', f.home, 'escape/private.txt', 'escape/missing/new', 'dangling-parent/new', 'hard-link', 'pipe', '.codex/config.toml'];
  for (const path of invalid) for (const method of ['fs/writeFile', 'fs/createDirectory', 'fs/remove'])
    await assert.rejects(execute(method, { ...(method === 'fs/writeFile' ? { dataBase64: '' } : {}), path }), error => error.code === 'NATIVE_FILESYSTEM');
  for (const destinationPath of invalid) await assert.rejects(execute('fs/copy', { sourcePath: 'fixture.txt', destinationPath }), error => error.code === 'NATIVE_FILESYSTEM');
  for (const sourcePath of ['escape/private.txt', 'hard-link', 'pipe', '.codex/config.toml']) await assert.rejects(execute('fs/copy', { sourcePath, destinationPath: 'not-copied' }), error => error.code === 'NATIVE_FILESYSTEM');
  const executable = join(f.workspace, 'protected-executable'); await writeFile(executable, 'Pinned fixture.');
  await assert.rejects(prepareNativeFilesystemWrite('fs/writeFile', { path: executable, dataBase64: '' }, f.workspace, f.home, [executable]));
  await mkdir(join(f.workspace, 'invalid-name'));
  await writeFile(Buffer.concat([Buffer.from(join(f.workspace, 'invalid-name') + '/'), Buffer.from([255])]), 'Unrepresentable filename.');
  await assert.rejects(execute('fs/copy', { sourcePath: 'invalid-name', destinationPath: 'invalid-name-copy', recursive: true }), error => error.code === 'NATIVE_FILESYSTEM');
  await symlink(f.home, join(f.workspace, 'source-tree/private-link'));
  await assert.rejects(execute('fs/copy', inputs['fs/copy']), error => error.code === 'NATIVE_FILESYSTEM');
  await assert.rejects(execute('fs/remove', { path: 'source-tree' }), error => error.code === 'NATIVE_FILESYSTEM');
  await mkdir(join(f.workspace, 'large-tree'));
  await Promise.all(Array.from({ length: limits.treeEntries }, (_, i) => writeFile(join(f.workspace, 'large-tree', String(i)), '')));
  await assert.rejects(execute('fs/remove', { path: 'large-tree' }), error => error.code === 'NATIVE_FILESYSTEM');
  await writeFile(join(f.workspace, 'large'), Buffer.alloc(limits.treeBytes + 1));
  await assert.rejects(execute('fs/copy', { sourcePath: 'large', destinationPath: 'large-copy' }), error => error.code === 'NATIVE_FILESYSTEM');
  assert.equal(f.frames.some(frame => methods.includes(frame.method)), false);
});
Then('native mutation inputs and acknowledgements reject private bytes and unknown fields', async function () {
  const { f, v, execute } = await setup(this), secret = 'SYNTHETIC_NATIVE_MUTATION_SECRET';
  await v.session.put(null, { label: 'Native mutation privacy fixture', kind: 'secret', value: secret });
  for (const value of [secret, encodeURIComponent(secret), f.key]) await assert.rejects(execute('fs/writeFile', { path: 'private', dataBase64: Buffer.from(value).toString('base64') }), error => error.code === 'REDACTED');
  assert.equal(f.frames.some(frame => frame.method === 'fs/writeFile'), false);
  for (const p of [{ path: 'x', dataBase64: 'bad!' }, { path: 'x', dataBase64: Buffer.alloc(limits.fileBytes + 1).toString('base64') }, { path: 'x', recursive: 1 }, { path: 'x', command: 'pwd' }])
    assert.throws(() => nativeFilesystemWriteParams(p.dataBase64 === undefined ? 'fs/remove' : 'fs/writeFile', p));
  for (const result of [{ accessToken: secret }, null, []]) {
    f.mutationResult = result;
    await assert.rejects(execute('fs/writeFile', inputs['fs/writeFile']), error => error.code === 'NATIVE_CONTRACT');
    await wait(() => f.starts === f.stops); assert.equal(await nativeFilesystemMutationObserved(f.workspace, 'fs/writeFile'), true);
  }
  assert.equal(f.frames.filter(frame => frame.method === 'fs/writeFile').length, 3);
});
Then('native filesystem mutations discard late acknowledgements without replay or rollback claims', async function () {
  for (const mode of ['cancel', 'source', 'identity', 'transport']) {
    const { f, v, execute } = await setup(this), controller = new AbortController();
    f.holdMutation = true; const result = execute('fs/writeFile', inputs['fs/writeFile'], controller.signal); await wait(() => f.release.length === 1);
    assert.equal(await nativeFilesystemMutationObserved(f.workspace, 'fs/writeFile'), true);
    if (mode === 'cancel') controller.abort(); else if (mode === 'transport') f.exit();
    else { if (mode === 'source') v.enabled = false; else f.identity.workspace = 'd'.repeat(64); f.release.shift()(); }
    await assert.rejects(result, error => ['CANCELLED', 'PERMISSION', 'NATIVE_FILESYSTEM'].includes(error.code));
    await wait(() => f.starts === f.stops); assert.equal(f.frames.filter(frame => frame.method === 'fs/writeFile').length, 1);
    assert.equal(await nativeFilesystemMutationObserved(f.workspace, 'fs/writeFile'), true);
  }
});
