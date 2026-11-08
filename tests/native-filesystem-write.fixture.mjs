// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile, readFile, readlink, lstat, readdir, copyFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeQueryFixture, nativeFilesystemBytes } from './native-query.fixture.mjs';
import { isNativeFilesystemWriteMethod } from '../src/lib/native-runtime-contract.ts';

export async function seedNativeFilesystemWrites(workspace) {
  await writeFile(join(workspace, 'written.bin'), 'Previous contents.');
  await symlink('written.bin', join(workspace, 'write-link.bin'));
  for (const directory of ['source-tree/sub', 'remove-me/sub']) {
    await mkdir(join(workspace, directory), { recursive: true });
    await writeFile(join(workspace, directory, 'data.bin'), nativeFilesystemBytes);
  }
  await symlink('sub/data.bin', join(workspace, 'source-tree/link.bin'));
}
async function copy(source, destination, recursive) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) return symlink(await readlink(source), destination);
  if (info.isFile()) return copyFile(source, destination);
  if (!recursive) throw new Error('Directory copy requires recursive true.');
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source)) await copy(join(source, entry), join(destination, entry), recursive);
}
export async function nativeFilesystemMutationObserved(workspace, method) {
  if (method === 'fs/writeFile') return (await readFile(join(workspace, 'written.bin'))).equals(nativeFilesystemBytes)
    && await readlink(join(workspace, 'write-link.bin')) === 'written.bin';
  if (method === 'fs/createDirectory') return (await lstat(join(workspace, 'created/nested'))).isDirectory();
  if (method === 'fs/copy') return (await readFile(join(workspace, 'copied-tree/sub/data.bin'))).equals(nativeFilesystemBytes)
    && await readlink(join(workspace, 'copied-tree/link.bin')) === 'sub/data.bin';
  if (method === 'fs/remove') { try { await lstat(join(workspace, 'remove-me')); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
  return false;
}
export const nativeFilesystemMutationInputs = {
  'fs/writeFile': { path: 'write-link.bin', dataBase64: nativeFilesystemBytes.toString('base64') },
  'fs/createDirectory': { path: 'created/nested' },
  'fs/copy': { sourcePath: 'source-tree', destinationPath: 'copied-tree', recursive: true },
  'fs/remove': { path: 'remove-me', force: false }
};
export async function nativeFilesystemWriteFixture(options = {}) {
  const f = await nativeQueryFixture({ ...options, allowFilesystemWrite: options.allowFilesystemWrite ?? true, onFrame(frame, f, receive) {
    if (!isNativeFilesystemWriteMethod(frame.method)) return options.onFrame?.(frame, f, receive);
    const send = async () => {
      try {
        if (f.failMutation) throw new Error('Synthetic SDK error.');
        const p = frame.params;
        if (frame.method === 'fs/writeFile') await writeFile(p.path, Buffer.from(p.dataBase64, 'base64'));
        if (frame.method === 'fs/createDirectory') await mkdir(p.path, { recursive: p.recursive ?? true });
        if (frame.method === 'fs/copy') await copy(p.sourcePath, p.destinationPath, p.recursive === true);
        if (frame.method === 'fs/remove') await rm(p.path, { recursive: p.recursive ?? true, force: p.force ?? true });
        const reply = () => receive({ id: frame.id, result: structuredClone(Object.hasOwn(f, 'mutationResult') ? f.mutationResult : {}) });
        if (f.holdMutation) f.release.push(reply); else reply();
      } catch { receive({ id: frame.id, error: { code: -32000, message: 'Private filesystem fixture failure.' } }); }
    };
    void send(); return true;
  } });
  await seedNativeFilesystemWrites(f.workspace); return f;
}
