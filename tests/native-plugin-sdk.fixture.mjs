// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { nativeInitializeParams } from '../src/lib/native-initialize.ts';
import { seedNativeAccountBackend } from './native-account-read-sdk.fixture.mjs';
import { nativeMarketplaceMethods } from '../src/lib/native-marketplace.ts';
import { nativePluginInstallMethods } from '../src/lib/native-plugin-install.ts';
import { nativeWindowsSandboxReadinessMethod, nativeWindowsSandboxSetupMethod } from '../src/lib/native-windows-sandbox.ts';
import { nativePluginShareMethods } from '../src/lib/native-plugin-share.ts';

export const pluginReadFixtureMethods = ['plugin/installed', 'plugin/list', 'plugin/read', 'plugin/skill/read', 'plugin/share/list'];
export const ownedRemotePluginId = 'plugins~Plugin_00000000000000000000000000000000';
const pagination = { has_more: false, next_cursor: null };
export const ownedRemotePlugin = () => ({ id: ownedRemotePluginId, name: 'owned-plugin', scope: 'WORKSPACE', discoverability: 'PRIVATE',
  installation_policy: 'AVAILABLE', authentication_policy: 'ON_USE', share_principals: [{ principal_type: 'user', principal_id: 'owned-user', role: 'owner', name: 'Owned user' }],
  release: { version: '1.0.0', display_name: 'Owned plugin', description: 'Owned plugin fixture', skills: [], interface: { short_description: 'Owned plugin' } } });

/** Exact pinned SDK routes, served locally with generated fixture credentials. */
export async function seedNativePluginBackend(home, workspace, options = {}) {
  const backend = await seedNativeAccountBackend(home, { async route({ request, url, send, fixture, body }) {
    if (await options.route?.({ request, url, send, fixture, body })) return true;
    if (request.method !== 'GET' || !url.pathname.startsWith('/ps/plugins/')) return false;
    if (url.pathname === '/ps/plugins/' + ownedRemotePluginId + '/skills/owned-skill')
      send(200, { plugin_id: ownedRemotePluginId, status: 'ENABLED', plugin_release_id: 'owned-release', name: 'owned-skill',
        description: 'Owned skill', plugin_release_skill_id: 'owned-skill-id', skill_md_contents: fixture.pluginSkillContents ?? '# Owned remote skill\n\nOwned fixture content.' });
    else if (url.pathname === '/ps/plugins/' + ownedRemotePluginId) send(200, ownedRemotePlugin());
    else if (url.pathname === '/ps/plugins/workspace/created') send(200, { plugins: [ownedRemotePlugin()], pagination });
    else if (url.pathname === '/ps/plugins/installed') send(200, { plugins: [], pagination });
    else if (['/ps/plugins', '/ps/plugins/featured', '/ps/plugins/workspace', '/ps/plugins/vertical'].includes(url.pathname)) send(200, { plugins: [], pagination });
    else return false;
    return true;
  } });
  await appendFile(join(home, 'config.toml'), '\n[features]\nplugins=true\nplugin_sharing=true\n');
  await mkdir(join(workspace, '.git'), { recursive: true });
  await mkdir(join(workspace, '.agents/plugins'), { recursive: true });
  await writeFile(join(workspace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'owned-market', plugins: [{ name: 'owned-plugin', source: { source: 'local', path: './owned-plugin' } }] }));
  const plugin = join(workspace, 'owned-plugin');
  await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
  await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'owned-plugin', version: '1.0.0', description: 'Owned local plugin' }));
  await mkdir(join(plugin, 'skills/owned-skill'), { recursive: true });
  await writeFile(join(plugin, 'skills/owned-skill/SKILL.md'), '---\nname: owned-skill\ndescription: Owned local skill\n---\nOwned local fixture content.\n');
  backend.marketplacePath = join(workspace, '.agents/plugins/marketplace.json');
  return backend;
}

/** Qualification only: no generic browser RPC and no public model inference. */
export async function nativePluginSdkFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'operations-native-plugin-')), home = join(directory, 'home'), workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
  let backend, child, sequence = 0; const pending = new Map(), events = [], calls = [];
  const fail = () => { for (const p of pending.values()) p.reject(new Error('Owned plugin SDK closed.')); pending.clear(); };
  const f = { home, workspace, calls, events };
  f.call = (method, params = {}) => {
    if (!['initialize', 'config/read', ...pluginReadFixtureMethods, ...nativeMarketplaceMethods, ...nativePluginInstallMethods, ...nativePluginShareMethods, nativeWindowsSandboxReadinessMethod, nativeWindowsSandboxSetupMethod].includes(method)) throw new Error('Unreviewed plugin qualification method.');
    calls.push({ method, params: structuredClone(params) }); const id = 'plugin_' + ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Owned plugin RPC timed out: ' + method)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.send({ id, method, params });
    });
  };
  f.close = async () => { try { await child?.close(); } finally { fail(); await backend?.close(); await rm(directory, { recursive: true, force: true }); } };
  try {
    backend = await (options.backendFactory ?? seedNativePluginBackend)(home, workspace); f.backend = backend;
    await options.seedRuntime?.(f);
    const runtime = await openCodexRuntime({ runtimeId: randomUUID(), caCertificate: f.caCertificate, executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY,
      binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256, home, workspace }); f.runtime = runtime;
    child = await runtime.start(frame => {
      if (Object.hasOwn(frame, 'method')) {
        if (Object.hasOwn(frame, 'id')) child.send({ id: frame.id, error: { code: -32601, message: 'Owned plugin fixture has no interactions.' } });
        else events.push(frame); return;
      }
      const p = pending.get(frame.id); if (!p) return; pending.delete(frame.id);
      if (Object.hasOwn(frame, 'result')) p.resolve(frame.result);
      else p.reject(new Error('Owned plugin SDK failed: ' + String(frame.error?.message).replaceAll(home, '<owned-home>').slice(0, 600)));
    }, fail);
    await f.call('initialize', nativeInitializeParams()); child.send({ method: 'initialized' }); return f;
  } catch (error) { await f.close(); throw error; }
}
