// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { nativePluginReadParams } from '../../src/lib/native-plugin-read.ts';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { captureNativeMigrationPaths, inspectNativeMigrationPath, readNativeMigrationJson, nativeMigrationRepositoryScope } from './migration-paths.mjs';
import { reviewNativeAccountPrivateEcho } from './account-read.mjs';

const within = (root, path) => path === root || path.startsWith(root + sep);
const layouts = ['.agents/plugins/marketplace.json', '.agents/plugins/api_marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (field, message) => { throw new NativeCommandInputError(field, message); };
function boundary(path, context, field) {
  if (within(context.workspace, path) && !within(context.home, path)) return context.workspace;
  if ([join(context.home, '.tmp/plugins'), join(context.home, '.tmp/marketplaces'), join(context.home, 'plugins/cache')].some(root => within(root, path))) return context.home;
  const personal = join(context.home, 'plugins');
  if (within(join(context.home, '.agents/plugins'), path) || path !== personal && within(personal, path)
    && !['cache', 'data', 'agent-plugins'].includes(path.slice(personal.length + 1).split(sep)[0])) return context.home;
  return fail(field, 'Plugin files must stay inside the paired workspace or its private plugin caches.');
}
async function checkPath(input, context, field) {
  const path = resolve(context.workspace, input), root = boundary(path, context, field);
  const info = await inspectNativeMigrationPath(path, { boundary: root, field });
  return { ...info, boundary: root };
}
async function inventory(plan, paths, context, field, stable = true) {
  for (const path of paths) {
    const checked = await checkPath(path, context, field), snapshot = await captureNativeMigrationPaths([path], { boundary: checked.boundary, field });
    plan.sources.push({ path, field, stable, snapshot });
  }
}
async function pluginResources(plan, path, context, stable) {
  await inventory(plan, [path], context, 'marketplacePath', stable);
  for (const manifestName of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', 'plugin.json']) {
    const manifest = await readNativeMigrationJson(join(path, manifestName), { boundary: boundary(path, context, 'marketplacePath'), field: 'marketplacePath' });
    if (!object(manifest)) continue;
    const refs = [manifest.skills, manifest.mcpServers, manifest.apps, manifest.hooks, manifest.interface?.composerIcon,
      manifest.interface?.logo, manifest.interface?.logoDark, manifest.interface?.screenshots].flat(2).filter(value => typeof value === 'string');
    for (const ref of refs) await inventory(plan, [resolve(path, ref)], context, 'marketplacePath', stable);
    break;
  }
}
async function marketplace(plan, path, context, stable) {
  const checked = await checkPath(path, context, 'marketplacePath');
  if (checked.kind === 'missing') return;
  await inventory(plan, [path], context, 'marketplacePath', stable);
  const manifest = await readNativeMigrationJson(path, { boundary: checked.boundary, field: 'marketplacePath' });
  const layout = layouts.find(layout => path.endsWith(sep + layout)), root = layout ? path.slice(0, -layout.length - 1) : dirname(path);
  for (const plugin of Array.isArray(manifest?.plugins) ? manifest.plugins : []) {
    const source = plugin?.source, local = typeof source === 'string' ? source : source?.source === 'local' ? source.path : undefined;
    if (typeof local === 'string') await pluginResources(plan, resolve(root, local), context, stable);
  }
}
/** Shared host-only source review; this does not grant a public plugin read. */
export async function inspectNativePluginMarketplace(path, context) {
  const plan = { sources: [] }; await marketplace(plan, path, context, true); return plan.sources;
}
/** Review a materialized package without granting public plugin reads. */
export async function inspectNativePluginResources(path, context) {
  const plan = { sources: [] }; await pluginResources(plan, path, context, false); return plan.sources;
}
/** Bind every local manifest the native request can discover, before dispatch. */
export async function prepareNativePluginRead(method, input, context) {
  const params = nativePluginReadParams(method, input), plan = { method, params, sources: [] };
  await reviewNativeAccountPrivateEcho(params, context.home);
  const scopes = [];
  if (Array.isArray(params.cwds)) for (const cwd of params.cwds) {
    const selected = await checkPath(cwd, context, 'cwds');
    if (selected.boundary !== context.workspace || selected.kind !== 'directory') fail('cwds', 'Use an existing directory inside the paired workspace.');
    scopes.push(await nativeMigrationRepositoryScope(selected.path, context.workspace, 'cwds'));
  }
  if (Array.isArray(params.cwds)) params.cwds = await Promise.all(params.cwds.map(async cwd => (await checkPath(cwd, context, 'cwds')).path));
  if (typeof params.marketplacePath === 'string') {
    const selected = await checkPath(params.marketplacePath, context, 'marketplacePath');
    if (selected.kind !== 'file') fail('marketplacePath', 'Use an existing marketplace JSON file.');
    params.marketplacePath = selected.path;
    if (selected.boundary === context.workspace) scopes.push(await nativeMigrationRepositoryScope(dirname(selected.path), context.workspace, 'marketplacePath'));
    await marketplace(plan, selected.path, context, true);
  }
  const local = method === 'plugin/installed' || method === 'plugin/read' && params.marketplacePath != null
    || method === 'plugin/list' && (params.marketplaceKinds == null || params.marketplaceKinds.includes('local'));
  if (local) {
    const roots = new Set([join(context.home, '.tmp/plugins')]);
    for (const layout of ['.agents/plugins/marketplace.json', '.agents/plugins/api_marketplace.json'])
      await marketplace(plan, join(context.home, layout), context, true);
    for (const cwd of [null, ...new Set([context.workspace, ...scopes, ...params.cwds ?? [], ...(typeof params.marketplacePath === 'string' && within(context.workspace, params.marketplacePath) ? [dirname(params.marketplacePath)] : [])])]) {
      const config = await context.inspect(cwd);
      for (const layer of config.layers ?? []) for (const [name, row] of Object.entries(object(layer.config?.marketplaces) ? layer.config.marketplaces : {})) {
        if (!object(row)) continue;
        if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) fail('marketplacePath', 'The configured marketplace name is invalid.');
        const path = row.source_type === 'local' && typeof row.source === 'string' ? resolve(context.workspace, row.source) : join(context.home, '.tmp/marketplaces', name);
        await checkPath(path, context, 'marketplacePath'); roots.add(path);
      }
    }
    for (const cwd of scopes) roots.add(cwd);
    for (const root of roots) for (const layout of layouts) await marketplace(plan, join(root, layout), context, within(context.workspace, root));
    // Already installed packages may contain resource paths or redirected files.
    const cache = join(context.home, 'plugins/cache');
    if ((await checkPath(cache, context, 'marketplacePath')).kind !== 'missing') {
      const snapshot = await captureNativeMigrationPaths([cache], { boundary: context.home, field: 'marketplacePath' });
      for (const file of snapshot.entries.filter(entry => entry.kind === 'file' && /(?:^|\/)\.codex-plugin\/plugin\.json$/.test(entry.path)))
        await pluginResources(plan, dirname(dirname(file.path)), context, false);
    }
  }
  return plan;
}
/** Results retain their native shape; no unreviewed paths or credential echoes. */
export async function reviewNativePluginRead(plan, result, context) {
  for (const source of plan.sources) {
    const checked = await checkPath(source.path, context, source.field), current = await captureNativeMigrationPaths([source.path], { boundary: checked.boundary, field: source.field });
    if (source.stable && !isDeepStrictEqual(current, source.snapshot)) fail(source.field, 'The plugin source changed during the read.');
  }
  const check = async path => {
    if (typeof path !== 'string') return;
    const value = path.startsWith('file:') ? fileURLToPath(path) : path;
    if (!isAbsolute(value)) throw new Error('Native plugin result contains an invalid local path.');
    await checkPath(value, context, 'marketplacePath');
  };
  const summary = async plugin => {
    if (plugin?.source?.type === 'local') await check(plugin.source.path);
    const i = plugin?.interface;
    if (i) for (const path of [i.composerIcon, i.logo, i.logoDark, ...(i.screenshots ?? [])]) await check(path);
  };
  if (Array.isArray(result?.marketplaces)) for (const entry of result.marketplaces) { await check(entry.path); for (const plugin of entry.plugins ?? []) await summary(plugin); }
  if (result?.plugin) {
    await check(result.plugin.marketplacePath); await summary(result.plugin.summary);
    for (const skill of [...result.plugin.skills ?? [], ...(result.plugin.onboardingSkill ? [result.plugin.onboardingSkill] : [])]) await check(skill.path);
  }
  if (Array.isArray(result?.data)) for (const entry of result.data) { await check(entry.localPluginPath); await summary(entry.plugin); }
  for (const error of result?.marketplaceLoadErrors ?? []) await check(error.path);
  await reviewNativeAccountPrivateEcho(result, context.home);
  return result;
}
