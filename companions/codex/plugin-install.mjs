// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativePluginInstallParams } from '../../src/lib/native-plugin-install.ts';
import { isNativePluginRemoteId as remoteId } from '../../src/lib/native-plugin-id.ts';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { configFile, userLayer, checkConfigurationWriteAuthority } from './configuration-write.mjs';
import { captureNativeMigrationPaths, inspectNativeMigrationPath, readNativeMigrationJson } from './migration-paths.mjs';
import { prepareNativePluginRead, reviewNativePluginRead, inspectNativePluginResources } from './plugin-read.mjs';
import { reviewNativeAccountPrivateEcho } from './account-read.mjs';

const remoteMarkets = new Set(['openai-curated-remote', 'created-by-me-remote', 'workspace-directory', 'workspace-shared-with-me',
  'workspace-shared-with-me-private', 'workspace-shared-with-me-unlisted']);
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const within = (root, path) => path === root || path.startsWith(root + sep);
const fail = (field, message) => { throw new NativeCommandInputError(field, message); };
const cacheRoot = home => join(home, 'plugins/cache');
function pluginId(value, field = 'pluginId') {
  if (typeof value !== 'string' || value.length > 512 || /[\\/\u0000-\u0020\u007f]/.test(value)) fail(field, 'Use a native name@marketplace plugin ID without path components.');
  const parts = value.split('@');
  if (parts.length !== 2 || parts.some(s => !s || s === '.' || s === '..')) fail(field, 'Use a native name@marketplace plugin ID.');
  return { id: value, name: parts[0], marketplace: parts[1] };
}
const rootFor = (home, selected) => join(cacheRoot(home), selected.marketplace, selected.name);
const inventory = (home, path = cacheRoot(home)) => captureNativeMigrationPaths([path], { boundary: home, field: 'pluginId' });
function checkSource(source, context) {
  if (source?.type === 'remote') return;
  if (source?.type === 'local') return; // Canonical paths and all resource references are checked by plugin-read.
  if (source?.type === 'git') {
    const url = source.url;
    if (typeof url !== 'string' || !url || url.startsWith('-')) fail('marketplacePath', 'The selected plugin needs a valid Git source.');
    if (isAbsolute(url)) {
      if (!within(context.workspace, resolve(url)) || within(context.home, resolve(url))) fail('marketplacePath', 'Local Git sources must stay inside the paired workspace.');
    } else if (!/^git@[^:]+:.+/.test(url)) {
      let parsed; try { parsed = new URL(url); } catch { fail('marketplacePath', 'The selected Git source must use an explicit URL.'); }
      if (!['https:', 'http:', 'ssh:'].includes(parsed.protocol) || parsed.password || parsed.protocol !== 'ssh:' && parsed.username)
        fail('marketplacePath', 'Git authentication belongs to the companion; remove embedded credentials.');
    }
    if (source.refName?.startsWith('-') || source.sha?.startsWith('-') || source.path != null && (isAbsolute(source.path) || source.path.split(/[\\/]/).includes('..')))
      fail('marketplacePath', 'Git references and plugin directories must not be options or escape the repository.');
    return;
  }
  if (source?.type === 'npm') {
    if (typeof source.package !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(source.package) || source.package.startsWith('-') || source.version?.startsWith('-'))
      fail('marketplacePath', 'Use a valid npm package name and version in the marketplace.');
    if (source.registry != null) {
      let url; try { url = new URL(source.registry); } catch { fail('marketplacePath', 'The npm registry must be an HTTPS URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password) fail('marketplacePath', 'Use an HTTPS npm registry without embedded credentials.');
    }
    return;
  }
  fail('marketplacePath', 'The selected plugin source is not recognized by this native runtime.');
}
async function detail(params, context, sourcePlan) {
  const value = await context.read(params);
  if (!object(value?.plugin) || !object(value.plugin.summary)) throw new Error('Private plugin metadata is unavailable.');
  if (sourcePlan) await reviewNativePluginRead(sourcePlan, value, context);
  await reviewNativeAccountPrivateEcho(value, context.home);
  const selected = pluginId(value.plugin.summary.id), summary = value.plugin.summary;
  if (value.plugin.marketplaceName !== selected.marketplace || summary.name !== selected.name
    || params.marketplacePath != null && summary.source?.type === 'remote'
    || params.remoteMarketplaceName != null && (summary.source?.type !== 'remote' || summary.remotePluginId !== params.pluginName || !remoteMarkets.has(selected.marketplace)))
    throw new Error('Private plugin metadata belongs to another source or identity.');
  checkSource(summary.source, context);
  return { ...selected, remoteId: summary.remotePluginId ?? null, value: value.plugin };
}
export async function prepareNativePluginInstall(method, input, context) {
  const original = nativePluginInstallParams(method, input), params = structuredClone(original);
  await reviewNativeAccountPrivateEcho(params, context.home);
  let selected, sourcePlan;
  if (method === 'plugin/install') {
    const read = { pluginName: params.pluginName, ...(params.marketplacePath != null ? { marketplacePath: params.marketplacePath } : { remoteMarketplaceName: params.remoteMarketplaceName }) };
    if (params.marketplacePath != null) { sourcePlan = await prepareNativePluginRead('plugin/read', read, context); Object.assign(read, sourcePlan.params); params.marketplacePath = read.marketplacePath; }
    else if (!remoteMarkets.has(params.remoteMarketplaceName) || !remoteId(params.pluginName)) fail('remoteMarketplaceName', 'Choose a native remote marketplace and backend plugin ID.');
    selected = await detail(read, context, sourcePlan);
    if (params.marketplacePath != null && selected.name !== params.pluginName) throw new Error('Plugin install resolved another local name.');
  } else if (method === 'plugin/uninstall') {
    selected = remoteId(params.pluginId) ? await detail({ pluginName: params.pluginId, remoteMarketplaceName: 'openai-curated-remote' }, context) : pluginId(params.pluginId);
  }
  const before = await context.capture(), file = await configFile(context.home), snapshot = await context.inspect(), layer = userLayer(snapshot, file);
  const cache = await inventory(context.home), stable = await context.capture();
  if (!sameNativeIdentity(before.identity, stable.identity) || before.basis !== stable.basis) throw new Error('Plugin authority changed before dispatch.');
  return { method, original, params, selected, sourcePlan, before, file, layer, cache,
    nonUserLayers: structuredClone(snapshot.layers.filter(l => l.name?.type !== 'user')) };
}
async function packageState(selected, context, expectedVersion) {
  const root = rootFor(context.home, selected), snapshot = await inventory(context.home, root);
  if (snapshot.entries[0]?.kind !== 'directory') throw new Error('The selected plugin package was not materialized.');
  const versions = snapshot.entries.filter(e => e.kind === 'directory' && e.path.slice(root.length + 1).match(/^[A-Za-z0-9_.+-]+$/));
  if (!versions.length) throw new Error('The selected plugin has no installed version.');
  if (expectedVersion != null && !versions.some(e => e.path === join(root, expectedVersion))) throw new Error('The selected plugin version was not materialized.');
  for (const entry of versions) await inspectNativePluginResources(entry.path, context);
  if (selected.remoteId != null) {
    const metadata = await readNativeMigrationJson(join(root, '.codex-remote-plugin-install.json'), { boundary: context.home, field: 'pluginId' });
    if (metadata?.schema_version !== 1 || metadata.remote_plugin_id !== selected.remoteId) throw new Error('The materialized remote plugin identity was not verified.');
  }
  return snapshot;
}
function enable(expected, id) {
  expected.plugins ??= {}; expected.plugins[id] ??= {}; expected.plugins[id].enabled = true;
}
function remove(expected, id) {
  if (object(expected.plugins)) { delete expected.plugins[id]; if (!Object.keys(expected.plugins).length) delete expected.plugins; }
}
async function workspaceHookKeys(selected, context, keys) {
  if (selected.marketplace !== 'workspace-directory') return;
  const resolved = await detail({ pluginName: selected.remoteId, remoteMarketplaceName: selected.marketplace }, context);
  if (resolved.id !== selected.id || resolved.value.summary.shareContext?.discoverability !== 'LISTED') throw new Error('Hook trust belongs to another workspace plugin.');
  // Remote plugin/read intentionally omits hooks. Match the pinned discovery key
  // (plugin ID, package-relative source, event and original group/handler indices).
  const events = { PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use',
    PreCompact: 'pre_compact', PostCompact: 'post_compact', SessionStart: 'session_start', SessionEnd: 'session_end',
    UserPromptSubmit: 'user_prompt_submit', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop', Stop: 'stop', Interrupt: 'interrupt' };
  const root = rootFor(context.home, selected), cache = await inventory(context.home, root);
  for (const version of cache.entries.filter(e => e.kind === 'directory' && /^[A-Za-z0-9_.+-]+$/.test(e.path.slice(root.length + 1)))) {
    const sources = new Map(), read = path => readNativeMigrationJson(path, { boundary: context.home, field: 'pluginId' });
    sources.set(join(version.path, 'hooks/hooks.json'), undefined);
    for (const name of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', 'plugin.json']) {
      const path = join(version.path, name), manifest = await read(path);
      if (!object(manifest)) continue;
      for (const hooks of [manifest.hooks].flat().filter(v => v != null)) {
        if (object(hooks)) sources.set(path, hooks);
        else if (typeof hooks === 'string') {
          const source = resolve(version.path, hooks);
          if (!within(version.path, source)) throw new Error('Workspace hook source leaves its materialized package.');
          sources.set(source, undefined);
        }
      }
      break;
    }
    for (const [path, inline] of sources) {
      const value = inline ?? await read(path), groupsByEvent = value?.hooks ?? value;
      if (!object(groupsByEvent)) continue;
      for (const [event, groups] of Object.entries(groupsByEvent)) if (Object.hasOwn(events, event) && Array.isArray(groups)) {
        groups.forEach((group, groupIndex) => { if (Array.isArray(group?.hooks)) group.hooks.forEach((handler, handlerIndex) => {
          if (handler?.type === 'command' && typeof handler.command === 'string' && handler.command.trim()
            || handler?.type === 'mcp_tool' && typeof handler.server === 'string' && typeof handler.tool === 'string')
            keys.add(`${selected.id}:${relative(version.path, path).split(sep).join('/')}:${events[event]}:${groupIndex}:${handlerIndex}`);
        }); });
      }
    }
  }
}
/** A reconcile response is this pass's delta, including failures; it is never a readiness promise. */
export async function reviewNativePluginInstall(plan, result, context) {
  await configFile(context.home); checkConfigurationWriteAuthority(plan, await context.capture());
  if (plan.sourcePlan) await reviewNativePluginRead(plan.sourcePlan, { plugin: plan.selected.value }, context);
  const expected = structuredClone(plan.layer.config), changed = [], hookKeys = new Set();
  if (plan.method === 'plugin/install') {
    nativeObject(result, ['authPolicy', 'appsNeedingAuth']);
    if (result.authPolicy !== plan.selected.value.summary.authPolicy || !Array.isArray(result.appsNeedingAuth)) throw new Error('Plugin install authentication policy was not preserved.');
    await packageState(plan.selected, context, plan.selected.remoteId == null ? undefined : plan.selected.value.summary.version);
    changed.push(rootFor(context.home, plan.selected));
    if (plan.selected.remoteId == null) enable(expected, plan.selected.id);
    else await workspaceHookKeys(plan.selected, context, hookKeys);
  } else if (plan.method === 'plugin/uninstall') {
    nativeObject(result, []); const root = rootFor(context.home, plan.selected); changed.push(root);
    if ((await inspectNativeMigrationPath(root, { boundary: context.home, field: 'pluginId' })).kind !== 'missing') throw new Error('Plugin cache removal was not verified.');
    if (plan.selected.remoteId == null) remove(expected, plan.selected.id);
    else {
      const legacy = join(cacheRoot(context.home), plan.selected.marketplace, plan.selected.remoteId); changed.push(legacy);
      if ((await inspectNativeMigrationPath(legacy, { boundary: context.home, field: 'pluginId' })).kind !== 'missing') throw new Error('Legacy remote plugin cache removal was not verified.');
    }
  } else {
    nativeObject(result, ['changedPlugins', 'failedRemotePluginIds', 'failedMaterializationRemotePluginIds']);
    if (![result.changedPlugins, result.failedRemotePluginIds, result.failedMaterializationRemotePluginIds].every(Array.isArray)
      || result.changedPlugins.length > 512 || result.failedRemotePluginIds.length > 512 || result.failedMaterializationRemotePluginIds.length > 512) throw new Error('Plugin reconciliation result exceeds its bounded profile.');
    const ids = new Set();
    for (const entry of result.changedPlugins) {
      nativeObject(entry, ['id', 'hasMcps', 'hasApps', 'hasHooks', 'hasSkills']); const selected = pluginId(entry.id);
      if (!remoteMarkets.has(selected.marketplace) || ids.has(selected.id) || !['hasMcps', 'hasApps', 'hasHooks', 'hasSkills'].every(k => typeof entry[k] === 'boolean')) throw new Error('Plugin reconciliation returned an invalid remote change.');
      ids.add(selected.id); const root = rootFor(context.home, selected); changed.push(root);
      if ((await inspectNativeMigrationPath(root, { boundary: context.home, field: 'pluginId' })).kind !== 'missing') {
        const metadata = await readNativeMigrationJson(join(root, '.codex-remote-plugin-install.json'), { boundary: context.home, field: 'pluginId' });
        if (metadata?.schema_version !== 1 || !remoteId(metadata.remote_plugin_id)) throw new Error('Reconciled plugin identity is unavailable.');
        selected.remoteId = metadata.remote_plugin_id; await packageState(selected, context);
        if (entry.hasHooks) await workspaceHookKeys(selected, context, hookKeys);
      }
    }
    for (const key of ['failedRemotePluginIds', 'failedMaterializationRemotePluginIds']) {
      if (new Set(result[key]).size !== result[key].length || !result[key].every(remoteId)) throw new Error('Plugin reconciliation returned invalid failure identifiers.');
    }
    if (!result.failedMaterializationRemotePluginIds.every(id => result.failedRemotePluginIds.includes(id))) throw new Error('Materialization failures must retain their backend failure identity.');
  }
  const snapshot = await context.inspect(), current = userLayer(snapshot, plan.file), after = await context.capture(); checkConfigurationWriteAuthority(plan, after);
  if (!isDeepStrictEqual(plan.nonUserLayers, snapshot.layers.filter(l => l.name?.type !== 'user'))) throw new Error('Plugin management changed a non-user configuration layer.');
  // Remote policy may retain an explicit local disable or clear it on installation.
  if (plan.method === 'plugin/install' && plan.selected.remoteId != null && expected.plugins?.[plan.selected.id]?.enabled === false
    && current.config.plugins?.[plan.selected.id]?.enabled === true) enable(expected, plan.selected.id);
  for (const key of hookKeys) {
    const old = expected.hooks?.state?.[key], now = current.config.hooks?.state?.[key];
    if (isDeepStrictEqual(old, now)) continue;
    if (!object(now) || !/^sha256:[a-f0-9]{64}$/.test(now.trusted_hash) || !isDeepStrictEqual({ ...old, trusted_hash: now.trusted_hash }, now)) throw new Error('Workspace plugin hook trust changed outside its selected hash.');
    expected.hooks ??= {}; expected.hooks.state ??= {}; expected.hooks.state[key] = structuredClone(now);
  }
  if (!isDeepStrictEqual(expected, current.config)) throw new Error('Configuration changed outside the selected plugin effects.');
  const cache = await inventory(context.home);
  // Parent directory timestamps change when a selected package is added or removed.
  // The SDK can rewrite identical installation metadata on a pass with no bundle delta.
  // Compare package contents/permissions; source TOCTOU witnesses above remain exact.
  const outside = value => value.entries.filter(e => !changed.some(root => within(root, e.path) || within(e.path, root)) && e.path !== cacheRoot(context.home))
    .map(({ path, kind, uid, mode, sha256 }) => ({ path, kind, uid, mode, sha256 }));
  if (!isDeepStrictEqual(outside(cache), outside(plan.cache))) throw new Error('An unrelated plugin cache changed during management.');
  await reviewNativeAccountPrivateEcho(result, context.home);
  return { result, identity: after.identity };
}
