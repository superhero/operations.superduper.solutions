// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeQueryFixture, nativeFilesystemBytes } from '../tests/native-query.fixture.mjs';
import { nativeVaultFixture } from '../tests/native-vault.fixture.mjs';
import { nativeFilesystemReadMethods } from './lib/native-runtime-contract.ts';
import { nativeFilesystemReadLimits, nativeReadFileBytes } from './lib/native-filesystem-read.ts';
import { nativeReference } from './lib/secrets/native-runtime-config.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { scopeNativeRpcSchema, nativeRpcOperation } from './lib/native-rpc.ts';
import { prepareNativeRequest } from './lib/native-operation-input.ts';

Before({ tags: '@native-filesystem-read' }, function () { this.fileReads = []; });
After({ tags: '@native-filesystem-read' }, async function () { for (const { v, f } of this.fileReads.reverse()) { v.session.lock(); await f.close(); } });
const wait = async predicate => { const end = Date.now() + 2500; while (!predicate()) { assert.ok(Date.now() < end, 'Filesystem read transition timed out.'); await new Promise(resolve => setTimeout(resolve, 5)); } };
async function setup(world, options = {}) {
  const f = await nativeQueryFixture(options), v = await nativeVaultFixture(f); world.fileReads.push({ f, v });
  const source = await readServiceSchema('codex'), selections = Object.fromEntries(nativeFilesystemReadMethods.map(method => {
    const document = scopeNativeRpcSchema(source, method); return [method, { document, operation: nativeRpcOperation(document, 'codex:' + method) }];
  }));
  const paired = await v.session.pairNativeRuntime(v.input, v.selection);
  const execute = (method, params, signal) => v.session.executeNativeQuery(nativeReference(paired), v.selection, selections[method], params, signal);
  return { f, v, selections, paired, execute };
}
const input = method => method === 'fuzzyFileSearch' ? { query: 'fixture', roots: ['.'] } : { path: method === 'fs/readDirectory' ? '.' : 'fixture.txt' };

Then('filesystem read permissions stay separate from metadata apps agent and write methods', async function () {
  const disabled = await setup(this, { allowFilesystemRead: false, allowMetadata: true, allowApps: true, allowAgent: true }), before = disabled.f.starts;
  for (const method of nativeFilesystemReadMethods) await assert.rejects(disabled.execute(method, input(method)), error => error.code === 'NATIVE_FILESYSTEM');
  assert.equal(disabled.f.starts, before);
  const { f, v, paired, execute } = await setup(this, { allowFilesystemRead: true, allowMetadata: false, allowApps: false });
  for (const method of nativeFilesystemReadMethods) assert.deepEqual((await execute(method, input(method))).response.result, f.metadataResults[method]);
  await v.session.disconnectNativeRuntime(nativeReference(paired)); await wait(() => f.starts === f.stops);
  for (const method of ['fs/writeFile', 'fs/copy', 'fs/remove', 'fs/watch']) assert.equal((await f.ticket({ connectionId: crypto.randomUUID(), method, fingerprint: 'c'.repeat(64) })).status, 400);
});

Then('native reads resolve workspace paths and enforce complete file and directory bounds', async function () {
  const { f, selections, execute } = await setup(this);
  await writeFile(join(f.home, 'private.txt'), 'private'); await symlink(f.home, join(f.workspace, 'escape')); await link(join(f.home, 'private.txt'), join(f.workspace, 'linked.txt'));
  await mkdir(join(f.workspace, 'directory')); execFileSync('mkfifo', [join(f.workspace, 'pipe')], { timeout: 1000 });
  await writeFile(join(f.workspace, 'large.txt'), Buffer.alloc(nativeFilesystemReadLimits.fileBytes + 1));
  for (const path of ['..', f.home + '/private.txt', 'escape/private.txt', 'linked.txt', 'directory', 'pipe', 'large.txt'])
    await assert.rejects(execute('fs/readFile', { path }), error => error.code === 'NATIVE_FILESYSTEM');
  assert.equal(f.frames.some(frame => frame.method === 'fs/readFile'), false);
  await symlink(join(f.workspace, 'fixture.txt'), join(f.workspace, 'safe-link'));
  f.metadataResults['fs/getMetadata'].isSymlink = true; await execute('fs/getMetadata', { path: 'safe-link' });
  assert.equal(f.frames.find(frame => frame.method === 'fs/getMetadata').params.path, join(f.workspace, 'safe-link'));
  await execute('fs/readFile', { path: 'safe-link' }); assert.equal(f.frames.find(frame => frame.method === 'fs/readFile').params.path, join(f.workspace, 'fixture.txt'));
  await Promise.all(Array.from({ length: nativeFilesystemReadLimits.entries + 1 }, (_, i) => writeFile(join(f.workspace, 'directory', String(i)), '')));
  await assert.rejects(execute('fs/readDirectory', { path: 'directory' }), error => error.code === 'NATIVE_FILESYSTEM');
  const operation = selections.fuzzyFileSearch.operation;
  assert.deepEqual(prepareNativeRequest(operation, { 'params:query': 'fixture', 'params:roots': '["."]' }).params, { query: 'fixture', roots: ['.'] });
  for (const values of [{ 'params:query': 'x', 'params:roots': '1' }, { 'params:query': 'x', 'params:roots': '["."]', 'params:command': 'pwd' }]) assert.throws(() => prepareNativeRequest(operation, values));
});

Then('native file bytes remain exact and known credential echoes are withheld after decoding', async function () {
  const { f, v, execute } = await setup(this);
  const result = (await execute('fs/readFile', { path: 'fixture.txt' })).response.result;
  assert.deepEqual(nativeReadFileBytes(result), new Uint8Array(nativeFilesystemBytes));
  const secret = 'SYNTHETIC_NATIVE_FILE_SECRET'; await v.session.put(null, { label: 'Native file privacy fixture', kind: 'secret', value: secret });
  f.metadataResults['fs/readFile'] = { dataBase64: Buffer.concat([Buffer.from([0, 255]), Buffer.from(secret), Buffer.from([0])]).toString('base64') };
  await assert.rejects(execute('fs/readFile', { path: 'fixture.txt' }), error => error.code === 'REDACTED');
  for (const dataBase64 of ['not base64!', 'YQ=', Buffer.alloc(nativeFilesystemReadLimits.fileBytes + 1).toString('base64')]) {
    f.metadataResults['fs/readFile'] = { dataBase64 }; await assert.rejects(execute('fs/readFile', { path: 'fixture.txt' }), error => error.code === 'NATIVE_FILESYSTEM');
  }
  f.metadataResults['fs/readFile'] = { dataBase64: '', accessToken: 'unknown' };
  await assert.rejects(execute('fs/readFile', { path: 'fixture.txt' }), error => error.code === 'NATIVE_CONTRACT');
});

Then('native result review withholds escaped search matches and malformed directory entries', async function () {
  const { f, execute } = await setup(this); await writeFile(join(f.home, 'private.txt'), 'private');
  for (const patch of [{ root: f.home }, { path: '../home/private.txt', file_name: 'private.txt' }, { path: 'fixture.txt', file_name: 'mismatch' }]) {
    f.metadataResults.fuzzyFileSearch = { files: [{ file_name: 'fixture.txt', root: f.workspace, path: 'fixture.txt', match_type: 'file', score: 1, ...patch }] };
    await assert.rejects(execute('fuzzyFileSearch', input('fuzzyFileSearch')), error => error.code === 'NATIVE_FILESYSTEM');
  }
  f.metadataResults['fs/readDirectory'] = { entries: [{ fileName: '../private.txt', isDirectory: false, isFile: true }] };
  await assert.rejects(execute('fs/readDirectory', { path: '.' }), error => error.code === 'NATIVE_FILESYSTEM');
  f.metadataResults['fs/readDirectory'] = { entries: [{ fileName: 'fixture.txt', isDirectory: false, isFile: true, token: 'unknown' }] };
  await assert.rejects(execute('fs/readDirectory', { path: '.' }), error => error.code === 'NATIVE_CONTRACT');
  const fileName = 'back\\slash.txt'; await writeFile(join(f.workspace, fileName), '');
  f.metadataResults['fs/readDirectory'] = { entries: [{ fileName, isDirectory: false, isFile: true }] };
  assert.equal((await execute('fs/readDirectory', { path: '.' })).response.result.entries[0].fileName, fileName);
});

Then('native filesystem cancellation source drift and identity changes close owned reads', async function () {
  for (const mode of ['cancel', 'source', 'identity']) {
    const { f, v, execute } = await setup(this), controller = new AbortController();
    f.holdQuery = true; const result = execute('fs/readFile', { path: 'fixture.txt' }, controller.signal); await wait(() => f.release.length === 1);
    if (mode === 'cancel') controller.abort(); else { if (mode === 'source') v.enabled = false; else f.identity.workspace = 'd'.repeat(64); f.release.shift()(); }
    await assert.rejects(result, error => ['CANCELLED', 'PERMISSION', 'NATIVE_FILESYSTEM'].includes(error.code)); await wait(() => f.starts === f.stops);
    assert.equal(f.frames.filter(frame => frame.method === 'fs/readFile').length, 1);
  }
});
