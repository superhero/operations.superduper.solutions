// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

export const configurationSdkSecret = 'OWNED_SDK_CONFIGURATION_SECRET_7319';
export async function seedNativeConfigurationRead(home, workspace) {
  await writeFile(join(home, 'config.toml'), 'model="owned-fixture-model"\nmodel_reasoning_effort="medium"\n'
    + '[model_providers.private_fixture]\nname="Private fixture provider"\nbase_url="http://127.0.0.1:9/v1"\nexperimental_bearer_token="' + configurationSdkSecret + '"\n', { mode: 0o600 });
  const directory = join(workspace, '.agents/skills/owned-configuration-skill'); await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'SKILL.md'), '---\nname: owned-configuration-skill\ndescription: An owned configuration qualification skill.\n---\nRead the owned workspace metadata.\n');
}
export async function nativeConfigurationReadFixture(options = {}) {
  const allowConfigurationRead = options.allowConfigurationRead ?? true, allowAgent = options.allowAgent ?? false;
  const f = await nativeAgentFixture({ ...options, allowAgent, allowConfigurationRead, account: null, requiresOpenaiAuth: options.requiresOpenaiAuth ?? true,
    ...(options.real ? { async runtimeFactory(f) {
      await seedNativeConfigurationRead(f.home, f.workspace); await options.seedRuntime?.(f);
      const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowAgent, allowConfigurationRead, allowConfigurationControl: options.allowConfigurationControl === true, allowMcpTools: options.allowMcpTools === true,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
      return { authority: real.authority, prepareConfigurationControl: real.prepareConfigurationControl, reviewConfigurationControl: real.reviewConfigurationControl, prepareConfigurationRead: real.prepareConfigurationRead, reviewConfigurationRead: real.reviewConfigurationRead, async start(receive, exited) {
        f.starts++; const child = await real.start(receive, exited); let closed = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
      } };
    } } : {}), onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      if (!['config/read', 'configRequirements/read', 'experimentalFeature/list', 'skills/list'].includes(frame.method)) return false;
      let result;
      if (frame.method === 'config/read') {
        const config = { model: f.configModel ?? 'owned-fixture-model', model_provider: 'openai', model_reasoning_effort: 'medium', sandbox_mode: 'read-only',
          model_providers: { private_fixture: { experimental_bearer_token: configurationSdkSecret } }, desktop: { secret: configurationSdkSecret } };
        const name = { type: 'user', file: join(f.home, 'config.toml') }, metadata = { name, version: 'owned-v1' };
        result = { config, origins: { model: metadata, 'model_providers.private_fixture.experimental_bearer_token': metadata },
          layers: frame.params.includeLayers ? [{ config, name, version: 'owned-v1', disabledReason: null }] : null };
      } else if (frame.method === 'configRequirements/read') result = { requirements: null, supportsIndependentSpeedModes: true };
      else if (frame.method === 'experimentalFeature/list') result = { data: [{ name: 'memories', stage: 'beta', defaultEnabled: false, enabled: false }], nextCursor: null };
      else result = { data: [{ cwd: f.workspace, errors: [], skills: [{ name: 'owned-configuration-skill', description: f.skillDescription ?? 'An owned configuration qualification skill.',
        enabled: true, scope: 'repo', path: join(f.workspace, '.agents/skills/owned-configuration-skill/SKILL.md') }] }] };
      const reply = () => emit({ id: frame.id, result });
      if (f.holdConfiguration) (f.configurationReplies ??= []).push(reply); else queueMicrotask(reply); return true;
    } });
  return f;
}
