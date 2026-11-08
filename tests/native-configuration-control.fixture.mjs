// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeConfigurationReadFixture } from './native-configuration-read.fixture.mjs';
import { nativeConfigurationControlMethods, nativeRuntimeFeatureKeys } from '../src/lib/native-configuration-control.ts';
import { seedNativeMcpTool } from './native-mcp-tool.fixture.mjs';

export async function seedNativeConfigurationControl(workspace) {
  const root = join(workspace, 'runtime-skills'), skill = join(root, 'owned-runtime-extra');
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), '---\nname: owned-runtime-extra\ndescription: Owned runtime-only skill.\n---\nRead the owned fixture metadata.\n');
  return root;
}
export async function nativeConfigurationControlFixture(options = {}) {
  let provider;
  let f;
  try { f = await nativeConfigurationReadFixture({ ...options, allowConfigurationControl: options.allowConfigurationControl ?? true,
    async seedRuntime(f) {
      f.extraRoot = await seedNativeConfigurationControl(f.workspace);
      if (options.withMcp) provider = f.provider = await seedNativeMcpTool(f.home);
      await options.seedRuntime?.(f);
    }, onClose(f) { delete f.runtimeFeatures; delete f.extraRoots; options.onClose?.(f); },
    onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      let result;
      if (nativeConfigurationControlMethods.includes(frame.method)) {
        f.runtimeFeatures ??= {};
        if (frame.method === 'experimentalFeature/enablement/set') {
          Object.assign(f.runtimeFeatures, frame.params.enablement); result = { enablement: structuredClone(frame.params.enablement) };
        } else { if (frame.method === 'skills/extraRoots/set') f.extraRoots = structuredClone(frame.params.extraRoots); result = {}; }
        if (f.controlResult !== undefined) result = f.controlResult;
        const reply = () => emit(f.failControl ? { id: frame.id, error: { code: -32602, message: 'Private owned SDK configuration failure.' } } : { id: frame.id, result });
        if (f.holdControl) (f.controlReplies ??= []).push(reply); else queueMicrotask(reply); return true;
      }
      if (frame.method === 'experimentalFeature/list') result = { data: nativeRuntimeFeatureKeys.map(name => ({ name, stage: 'beta', defaultEnabled: false, enabled: f.runtimeFeatures?.[name] ?? false })), nextCursor: null };
      if (frame.method === 'skills/list') result = { data: [{ cwd: f.workspace, errors: [], skills: f.extraRoots?.length ? [{ name: 'owned-runtime-extra', description: 'Owned runtime-only skill.', enabled: true, scope: 'user', path: join(f.extraRoot, 'owned-runtime-extra/SKILL.md') }] : [] }] };
      if (frame.method === 'mcpServer/tool/call') result = { content: [{ type: 'text', text: 'Owned MCP tool: ' + frame.params.arguments.message }], isError: false };
      if (result === undefined) return false;
      queueMicrotask(() => emit({ id: frame.id, result })); return true;
    } }); } catch (error) { await provider?.close(); throw error; }
  if (!f.extraRoot) f.extraRoot = await seedNativeConfigurationControl(f.workspace);
  const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } };
  if (options.real) f.runtime.requestMs = 10000;
  return f;
}
