// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { nativeConfigurationReadParams, publicNativeConfigurationResult } from '../../src/lib/native-configuration-read.ts';

export async function prepareNativeConfigurationRead(method, input, workspace, home) {
  const params = nativeConfigurationReadParams(method, input);
  const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
  const directory = async value => {
    const candidate = resolve(workspace, value);
    if (!within(workspace, candidate) || within(home, candidate)) throw new Error('Configuration directory is outside the paired workspace.');
    const path = await realpath(candidate);
    if (!within(workspace, path) || within(home, path) || !(await stat(path)).isDirectory()) throw new Error('Configuration directory is outside the paired workspace.');
    return path;
  };
  if (typeof params.cwd === 'string') params.cwd = await directory(params.cwd);
  if (Array.isArray(params.cwds)) params.cwds = await Promise.all(params.cwds.map(directory));
  return params;
}
export function reviewNativeConfigurationRead(method, _params, result) {
  return method === 'config/read' ? publicNativeConfigurationResult(result) : result;
}
