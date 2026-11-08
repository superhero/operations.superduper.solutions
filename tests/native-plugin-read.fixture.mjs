// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { join } from 'node:path';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativePluginReadMethods } from '../src/lib/native-plugin-read.ts';
import { seedNativePluginBackend, ownedRemotePluginId } from './native-plugin-sdk.fixture.mjs';

export function ownedPluginReadResult(method, f, params) {
  const local = { id: 'owned-plugin@owned-market', name: 'owned-plugin', enabled: false, installed: false,
    installPolicy: 'AVAILABLE', authPolicy: 'ON_USE', source: { type: 'local', path: join(f.workspace, 'owned-plugin') } };
  const remote = { ...local, id: 'owned-plugin@workspace-shared-with-me', remotePluginId: ownedRemotePluginId, source: { type: 'remote' } };
  if (method === 'plugin/installed' || method === 'plugin/list') return { marketplaces: [{ name: 'owned-market', path: f.backend.marketplacePath, plugins: [local] }],
    marketplaceLoadErrors: [], ...(method === 'plugin/list' ? { featuredPluginIds: [] } : {}) };
  if (method === 'plugin/read') return { plugin: { marketplaceName: 'owned-market', marketplacePath: params.marketplacePath ?? null,
    summary: params.marketplacePath ? local : remote, description: 'Owned plugin details', skills: [{ name: 'owned-plugin:owned-skill', description: 'Owned local skill', enabled: false,
      path: params.marketplacePath ? join(f.workspace, 'owned-plugin/skills/owned-skill/SKILL.md') : null }], hooks: [], apps: [], appTemplates: [], mcpServers: [] } };
  if (method === 'plugin/skill/read') return { contents: f.skillContents ?? '# Owned remote skill\n\nOwned fixture content.' };
  return { data: [{ plugin: remote, localPluginPath: null }] };
}
export async function nativePluginReadFixture(options = {}) {
  let backend;
  const allowPluginsRead = options.allowPluginsRead ?? true;
  try {
    const f = await nativeAgentFixture({ ...options, allowAgent: options.allowAgent ?? false, allowPluginsRead,
      async runtimeFactory(f) {
        backend = await seedNativePluginBackend(f.home, f.workspace); f.backend = backend;
        await options.seedRuntime?.(f);
        if (!options.real) return;
        const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowPluginsRead,
          allowAgent: options.allowAgent === true, executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
          binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
        return { ...real, async start(receive, exited) {
          f.starts++; const child = await real.start(receive, exited); let closed = false;
          return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
        } };
      }, onFrame(frame, f, emit) {
        if (options.onFrame?.(frame, f, emit) === true) return true;
        if (!nativePluginReadMethods.includes(frame.method)) return false;
        const reply = () => emit({ id: frame.id, ...(f.pluginError ? { error: { code: -32603, message: f.pluginError } }
          : { result: f.pluginResult ?? ownedPluginReadResult(frame.method, f, frame.params) }) });
        if (f.holdPlugins) (f.pluginReplies ??= []).push(reply); else queueMicrotask(reply); return true;
      } });
    if (options.real) f.runtime.requestMs = 15000;
    const close = f.close; f.close = async () => { try { await close(); } finally { await backend?.close(); } }; return f;
  } catch (error) { await backend?.close(); throw error; }
}
