// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { relative, isAbsolute, sep } from 'node:path';
import { nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { nativeConfigurationControlParams } from '../../src/lib/native-configuration-control.ts';
import { prepareNativeConfigurationRead } from './configuration-read.mjs';

export async function prepareNativeConfigurationControl(method, input, workspace, home) {
  const params = nativeConfigurationControlParams(method, input);
  if (method === 'skills/extraRoots/set') {
    params.extraRoots = (await prepareNativeConfigurationRead('skills/list', { cwds: params.extraRoots }, workspace, home)).cwds;
    for (const root of params.extraRoots) {
      const rel = relative(root, home);
      if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) throw new Error('A skill root must not contain the private runtime home.');
    }
  }
  return params;
}
export async function reviewNativeConfigurationControl(method, params, value, workspace, home) {
  if (method === 'experimentalFeature/enablement/set') {
    const result = nativeObject(value, ['enablement']), map = nativeObject(result.enablement, Object.keys(params.enablement));
    if (Object.keys(map).length !== Object.keys(params.enablement).length || Object.keys(params.enablement).some(key => map[key] !== params.enablement[key])) throw new Error('Runtime feature acknowledgement did not match the requested overrides.');
  } else nativeObject(value, []);
  await prepareNativeConfigurationControl(method, params, workspace, home);
  return value;
}
