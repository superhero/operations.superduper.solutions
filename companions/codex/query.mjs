// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { nativeQueryParams } from '../../src/lib/native-query-contract.ts';
import { isNativeFilesystemReadMethod, isNativeFilesystemWriteMethod } from '../../src/lib/native-runtime-contract.ts';
import { prepareNativeFilesystemWrite } from './filesystem-write.mjs';
import { prepareNativeFilesystemRead } from './filesystem-read.mjs';

/** Browser paths are confined to the operator's canonical workspace. */
export async function prepareNativeQueryPaths(method, input, workspace, home, protectedPaths = []) {
  const params = nativeQueryParams(method, input);
  if (isNativeFilesystemWriteMethod(method)) return prepareNativeFilesystemWrite(method, params, workspace, home, protectedPaths);
  if (isNativeFilesystemReadMethod(method)) return prepareNativeFilesystemRead(method, params, workspace, home);
  const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
  async function directory(input) {
    const candidate = resolve(workspace, input);
    if (!within(workspace, candidate) || within(home, candidate)) throw new Error('Metadata directory is outside the authorized workspace.');
    const canonical = await realpath(candidate);
    if (!within(workspace, canonical) || within(home, canonical) || !(await stat(canonical)).isDirectory()) throw new Error('Metadata directory is outside the authorized workspace.');
    return canonical;
  }
  if (method === 'permissionProfile/list' && typeof params.cwd === 'string') params.cwd = await directory(params.cwd);
  if (method === 'hooks/list') params.cwds = await Promise.all(params.cwds.map(directory));
  return params;
}
