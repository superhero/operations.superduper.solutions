// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { realpath, stat, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, basename } from 'node:path';
import { nativeFilesystemReadParams, nativeFilesystemReadLimits as limits, nativeReadFileBytes } from '../../src/lib/native-filesystem-read.ts';

const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
async function checkedPath(input, workspace, home) {
  const requested = resolve(workspace, input), canonical = await realpath(requested);
  if (!within(workspace, requested) || !within(workspace, canonical) || within(home, canonical)) throw new Error('Filesystem path is outside the authorized workspace.');
  return { requested, canonical, info: await stat(canonical) };
}
export async function prepareNativeFilesystemRead(method, input, workspace, home) {
  const params = nativeFilesystemReadParams(method, input);
  if (method === 'fuzzyFileSearch') {
    params.roots = await Promise.all(params.roots.map(async root => {
      const path = await checkedPath(root, workspace, home);
      if (!path.info.isDirectory() || within(path.canonical, home)) throw new Error('Search roots must be workspace directories outside the credential home.');
      return path.canonical;
    }));
  } else {
    const path = await checkedPath(params.path, workspace, home);
    if (method === 'fs/readFile' && (!path.info.isFile() || path.info.nlink !== 1 || path.info.size > limits.fileBytes)) throw new Error('File read requires a bounded regular workspace file.');
    if (method === 'fs/readDirectory' && (!path.info.isDirectory() || (await readdir(path.canonical)).length > limits.entries)) throw new Error('Directory listing exceeds the workspace limits.');
    params.path = method === 'fs/getMetadata' ? path.requested : path.canonical;
  }
  return params;
}
/** Check returned path authority before native results leave the companion. */
export async function reviewNativeFilesystemRead(method, params, result, workspace, home) {
  if (method === 'fs/readFile') { nativeReadFileBytes(result); await prepareNativeFilesystemRead(method, params, workspace, home); }
  else if (method === 'fs/getMetadata') await checkedPath(params.path, workspace, home);
  else if (method === 'fs/readDirectory') {
    if (!Array.isArray(result?.entries) || result.entries.length > limits.entries) throw new Error('Directory listing exceeds the workspace limits.');
    for (const entry of result.entries) if (typeof entry.fileName !== 'string' || !entry.fileName || entry.fileName !== basename(entry.fileName)
      || entry.fileName.includes('\0') || ['.', '..'].includes(entry.fileName)) throw new Error('Invalid direct directory entry.');
    await checkedPath(params.path, workspace, home);
  } else {
    if (!Array.isArray(result?.files) || result.files.length > limits.matches) throw new Error('Search response exceeds the native match limit.');
    for (const file of result.files) {
      if (!params.roots.includes(file.root) || typeof file.path !== 'string' || !file.path || typeof file.file_name !== 'string'
        || file.file_name !== basename(file.path)) throw new Error('Invalid workspace search match.');
      const path = await checkedPath(resolve(file.root, file.path), workspace, home);
      if (!within(file.root, path.canonical)) throw new Error('Search match escaped its selected root.');
    }
  }
}
