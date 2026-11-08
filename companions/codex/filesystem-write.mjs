// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { lstat, stat, realpath, opendir, readlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nativeFilesystemWriteParams, nativeFilesystemWriteLimits as limits } from '../../src/lib/native-filesystem-write.ts';

const within = (root, path) => { const r = relative(root, path); return !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };
/** Preserve SDK leaf-symlink semantics: copying retains the link, removing
 * unlinks it, and writing follows it. Only parent directories are canonicalized. */
export async function prepareNativeFilesystemWrite(method, input, workspace, home, protectedPaths = []) {
  const params = nativeFilesystemWriteParams(method, input), protectedRoots = [home, join(workspace, '.codex'), ...protectedPaths];
  const allowed = path => {
    if (path === workspace || !within(workspace, path) || protectedRoots.some(root => within(root, path) || within(path, root))) throw new Error('Filesystem mutation crosses protected workspace authority.');
  };
  async function inspect(input, depth = 0) {
    if (depth > limits.depth) throw new Error('Filesystem path exceeds its link/depth limit.');
    const requested = resolve(workspace, input); allowed(requested);
    let parent = dirname(requested), suffix = [];
    while (true) {
      let info;
      try {
        info = await lstat(parent);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        suffix.unshift(basename(parent)); parent = dirname(parent);
        if (suffix.length > limits.depth) throw new Error('Filesystem path exceeds its depth limit.');
        continue;
      }
      parent = await realpath(parent);
      if (!info.isDirectory() && !(await stat(parent)).isDirectory()) throw new Error('Filesystem parent is not a directory.');
      break;
    }
    const path = join(parent, ...suffix, basename(requested)); allowed(path);
    let info;
    try { info = await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let link;
    if (info?.isSymbolicLink()) { link = await readlink(path); await inspect(resolve(dirname(path), link), depth + 1); }
    else if (info && !info.isDirectory() && (!info.isFile() || info.nlink !== 1)) throw new Error('Filesystem mutation requires ordinary unshared workspace entries.');
    return { path, info, link };
  }
  let entries = 0, bytes = 0;
  async function tree(input, destination, depth = 0) {
    if (++entries > limits.treeEntries || depth > limits.depth) throw new Error('Filesystem tree exceeds its entry/depth limit.');
    const item = await inspect(input);
    if (!item.info) throw new Error('Filesystem tree changed before mutation dispatch.');
    if (destination) await inspect(destination);
    if (item.info?.isSymbolicLink()) {
      if (destination) await inspect(resolve(dirname(destination), item.link));
    } else if (item.info?.isDirectory()) {
      for await (const entry of await opendir(item.path, { encoding: 'buffer' })) {
        const name = entry.name.toString('utf8');
        if (!Buffer.from(name).equals(entry.name)) throw new Error('Filesystem entry cannot be represented by the native path contract.');
        await tree(join(item.path, name), destination ? join(destination, name) : undefined, depth + 1);
      }
    } else if (item.info?.isFile()) {
      bytes += item.info.size;
      if (bytes > limits.treeBytes) throw new Error('Filesystem tree exceeds its byte limit.');
    }
    return item;
  }
  if (method === 'fs/copy') {
    const source = await inspect(params.sourcePath), destination = await inspect(params.destinationPath);
    if (!source.info) throw new Error('Filesystem copy source is missing.');
    if (source.info.isDirectory() && params.recursive !== true) throw new Error('Directory copy requires recursive true.');
    if (source.path === destination.path || source.info.isDirectory() && within(source.path, destination.path)) throw new Error('Filesystem copy destination overlaps its source.');
    await tree(source.path, destination.path); params.sourcePath = source.path; params.destinationPath = destination.path;
  } else {
    const item = await inspect(params.path);
    if (method === 'fs/writeFile' && item.info) {
      const target = await stat(item.path);
      if (!target.isFile() || target.nlink !== 1) throw new Error('File writes require an ordinary unshared workspace file.');
    }
    if (method === 'fs/remove' && item.info?.isDirectory() && params.recursive !== false) await tree(item.path);
    params.path = item.path;
  }
  return params;
}
