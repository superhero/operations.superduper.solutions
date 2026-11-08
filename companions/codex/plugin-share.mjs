// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativePluginShareParams } from '../../src/lib/native-plugin-share.ts';
import { isNativePluginRemoteId } from '../../src/lib/native-plugin-id.ts';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { captureNativeMigrationPaths, inspectNativeMigrationPath, readNativeMigrationJson } from './migration-paths.mjs';
import { configFile, userLayer, checkConfigurationWriteAuthority } from './configuration-write.mjs';
import { inspectNativePluginResources } from './plugin-read.mjs';
import { reviewNativeAccountMetadata, reviewNativeAccountPrivateEcho } from './account-read.mjs';

const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const within = (root, path) => path === root || path.startsWith(root + sep);
const personal = home => join(home, 'plugins'), marketplace = home => join(home, '.agents/plugins/marketplace.json');
const mapping = home => join(home, '.tmp/plugin-share-local-paths-v1.json');
const reserved = new Set(['cache', 'data', 'agent-plugins']);
const fail = (field, message) => { throw new NativeCommandInputError(field, message); };
const capture = (path, boundary, field) => captureNativeMigrationPaths([path], { boundary, field });
function sourceBoundary(path, context, field) {
  if (within(context.workspace, path) && !within(context.home, path)) return context.workspace;
  if (path !== personal(context.home) && within(personal(context.home), path) && !reserved.has(relative(personal(context.home), path).split(sep)[0])) return context.home;
  fail(field, 'Use a plugin directory inside the paired workspace or its private personal checkouts, excluding managed runtime caches/data.');
}
async function source(path, context, field, missing = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) fail(field, 'Use a canonical absolute plugin directory.');
  const boundary = sourceBoundary(path, context, field), snapshot = await capture(path, boundary, field);
  if (missing && snapshot.entries[0]?.kind === 'missing') return { path, snapshot, resources: [], exists: false };
  if (snapshot.entries[0]?.kind !== 'directory') fail(field, 'Use an existing owned plugin directory without redirected components.');
  let resources;
  try { resources = await inspectNativePluginResources(path, context); }
  catch (error) { if (error instanceof NativeCommandInputError) fail(field, error.message.replace(/^marketplacePath: /, '')); throw error; }
  let manifest = false;
  for (const layout of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', 'plugin.json'])
    if (object(await readNativeMigrationJson(join(path, layout), { boundary, field }))) { manifest = true; break; }
  if (!manifest) fail(field, 'The source needs a native plugin manifest.');
  // Publishing must not copy this runtime's credentials out through source files.
  for (const entry of snapshot.entries.filter(e => e.kind === 'file')) {
    const bytes = await readFile(entry.path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) fail(field, 'Plugin files changed during private review.');
    await reviewNativeAccountPrivateEcho(bytes.toString('utf8'), context.home);
  }
  return { path, snapshot, resources, exists: true };
}
async function unchangedSource(selected, context, field) {
  for (const old of [selected.snapshot, ...selected.resources.map(s => s.snapshot)]) {
    const now = await capture(old.entries[0].path, old.boundary, field);
    if (!isDeepStrictEqual(now, old)) fail(field, 'The plugin source changed during the operation.');
  }
}
async function associations(context, field) {
  const value = await readNativeMigrationJson(mapping(context.home), { boundary: context.home, field });
  if (value === undefined) return Object.create(null);
  nativeObject(value, ['localPluginPathsByRemotePluginId']);
  const entries = value.localPluginPathsByRemotePluginId;
  if (!object(entries) || Object.keys(entries).length > 512 || Object.entries(entries).some(([id, path]) => !isNativePluginRemoteId(id)
    || typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || /[\u0000-\u001f\u007f]/.test(path)))
    fail(field, 'The stored plugin-share associations are invalid or exceed the bounded profile.');
  return Object.assign(Object.create(null), entries);
}
async function remote(id, context) {
  const value = await context.read({ remoteMarketplaceName: 'workspace-shared-with-me-private', pluginName: id });
  await reviewNativeAccountPrivateEcho(value, context.home);
  const plugin = value?.plugin, summary = plugin?.summary;
  if (!object(plugin) || !object(summary) || summary.remotePluginId !== id || summary.source?.type !== 'remote' || !object(summary.shareContext)
    || summary.shareContext.remotePluginId !== id || typeof summary.name !== 'string' || !summary.name || ['.', '..'].includes(summary.name)
    || /[\\/\u0000-\u001f\u007f]/.test(summary.name)) throw new Error('Private remote-share metadata belongs to another plugin.');
  return plugin;
}
async function personalInventory(context) {
  const root = personal(context.home), info = await inspectNativeMigrationPath(root, { boundary: context.home, field: 'remotePluginId' });
  const paths = info.kind === 'missing' ? [] : (await readdir(root)).filter(name => !reserved.has(name)).sort().map(name => join(root, name));
  return captureNativeMigrationPaths(paths, { boundary: context.home, field: 'remotePluginId' });
}
async function personalMarket(context) {
  const value = await readNativeMigrationJson(marketplace(context.home), { boundary: context.home, field: 'remotePluginId' });
  if (value !== undefined && (!object(value) || value.plugins != null && !Array.isArray(value.plugins))) fail('remotePluginId', 'The personal marketplace must be a JSON object with a plugin array.');
  return value;
}
export async function prepareNativePluginShare(method, input, context) {
  const original = nativePluginShareParams(method, input), params = structuredClone(original);
  await reviewNativeAccountPrivateEcho(params, context.home);
  const account = await reviewNativeAccountMetadata(await context.account(), context.home);
  if (account.account?.type !== 'chatgpt') throw new Error('Plugin sharing requires companion ChatGPT sign-in.');
  const field = method === 'plugin/share/save' ? 'pluginPath' : 'remotePluginId';
  const selected = method === 'plugin/share/save' ? await source(params.pluginPath, context, field) : undefined;
  const beforeMap = await associations(context, field), beforeRemote = params.remotePluginId != null && method !== 'plugin/share/delete' ? await remote(params.remotePluginId, context) : undefined;
  const plan = { method, original, params, selected, beforeMap, beforeRemote, accountId: account.workspaceRouting?.chatgptAccountId };
  if (method === 'plugin/share/checkout') {
    if (!['workspace-shared-with-me', 'workspace-shared-with-me-private', 'workspace-shared-with-me-unlisted'].includes(beforeRemote.marketplaceName))
      fail(field, 'Checkout accepts private or unlisted shared plugins; listed catalog plugins use installation.');
    const path = beforeMap[params.remotePluginId] ?? join(personal(context.home), beforeRemote.summary.name);
    if (!within(personal(context.home), path)) fail(field, 'This share already has a source outside the personal checkout area. Reuse that source for editing and publishing.');
    plan.checkout = await source(path, context, field, true);
    if (!beforeMap[params.remotePluginId] && plan.checkout.exists) fail(field, 'A personal plugin directory with this name already exists; checkout cannot overwrite it.');
    plan.market = await personalMarket(context); plan.personal = await personalInventory(context);
  }
  const before = await context.capture(), file = await configFile(context.home), snapshot = await context.inspect(), layer = userLayer(snapshot, file), stable = await context.capture();
  if (!sameNativeIdentity(before.identity, stable.identity) || before.basis !== stable.basis) throw new Error('Plugin-sharing authority changed before dispatch.');
  return Object.assign(plan, { before, file, layer, nonUserLayers: structuredClone(snapshot.layers.filter(l => l.name?.type !== 'user')) });
}
function checkTargets(principals, params, accountId) {
  if (!Array.isArray(principals) || principals.length > 512) throw new Error('Share principals exceed the bounded native result profile.');
  const expected = params.shareTargets;
  for (const principal of principals) {
    nativeObject(principal, ['principalType', 'principalId', 'role', 'name']);
    if (!['user', 'group', 'workspace'].includes(principal.principalType) || !['owner', 'editor', 'reader'].includes(principal.role)
      || typeof principal.principalId !== 'string' || !principal.principalId || typeof principal.name !== 'string') throw new Error('Invalid native share principal.');
    if (expected != null && principal.role !== 'owner' && !expected.some(t => t.principalType === principal.principalType && t.principalId === principal.principalId && t.role === principal.role)
      && !(params.discoverability === 'UNLISTED' && principal.principalType === 'workspace' && principal.role === 'reader' && accountId != null && principal.principalId === accountId))
      throw new Error('Share permissions include an unrequested target or role.');
  }
  if (expected != null && expected.some(t => !principals.some(p => p.principalType === t.principalType && p.principalId === t.principalId && p.role === t.role)))
    throw new Error('A requested share permission was not verified.');
}
export async function reviewNativePluginShare(plan, result, context) {
  await configFile(context.home); checkConfigurationWriteAuthority(plan, await context.capture());
  const expectedMap = Object.assign(Object.create(null), plan.beforeMap), params = plan.params;
  if (plan.selected) await unchangedSource(plan.selected, context, 'pluginPath');
  if (plan.method === 'plugin/share/save') {
    nativeObject(result, ['remotePluginId', 'shareUrl', 'canPublishToWorkspace']);
    if (!isNativePluginRemoteId(result.remotePluginId) || params.remotePluginId != null && result.remotePluginId !== params.remotePluginId
      || typeof result.shareUrl !== 'string' || result.shareUrl.length > 4096 || result.canPublishToWorkspace != null && typeof result.canPublishToWorkspace !== 'boolean') throw new Error('Plugin-share publication acknowledgement is invalid.');
    const current = await remote(result.remotePluginId, context), share = current.summary.shareContext;
    if (params.discoverability != null && share.discoverability !== params.discoverability
      || plan.beforeRemote && share.discoverability !== plan.beforeRemote.summary.shareContext.discoverability) throw new Error('Publication changed unrequested sharing visibility.');
    checkTargets(share.sharePrincipals, params, plan.accountId);
    if (result.shareUrl && share.shareUrl != null && result.shareUrl !== share.shareUrl) throw new Error('Published share URL belongs to another plugin.');
    expectedMap[result.remotePluginId] = params.pluginPath;
  } else if (plan.method === 'plugin/share/updateTargets') {
    nativeObject(result, ['principals', 'discoverability']); const current = await remote(params.remotePluginId, context), share = current.summary.shareContext;
    if (result.discoverability !== params.discoverability || share.discoverability !== params.discoverability
      || !isDeepStrictEqual(result.principals, share.sharePrincipals)) throw new Error('Updated share permissions were not verified.');
    checkTargets(result.principals, params, plan.accountId);
  } else if (plan.method === 'plugin/share/delete') {
    nativeObject(result, []); delete expectedMap[params.remotePluginId];
    const list = await context.list(); await reviewNativeAccountPrivateEcho(list, context.home);
    if (!Array.isArray(list?.data) || list.data.length > 512 || list.data.some(p => p.plugin?.remotePluginId === params.remotePluginId)) throw new Error('Plugin-share removal was not confirmed.');
  } else {
    nativeObject(result, ['remotePluginId', 'pluginId', 'pluginName', 'pluginPath', 'marketplaceName', 'marketplacePath', 'remoteVersion']);
    const summary = plan.beforeRemote.summary, expectedMarket = structuredClone(plan.market ?? { name: 'codex-curated', interface: { displayName: 'Personal' }, plugins: [] });
    expectedMarket.name ??= 'codex-curated'; expectedMarket.plugins ??= [];
    if (result.remotePluginId !== params.remotePluginId || result.pluginName !== summary.name || result.pluginPath !== plan.checkout.path
      || result.marketplaceName !== expectedMarket.name || result.pluginId !== summary.name + '@' + expectedMarket.name
      || result.marketplacePath !== marketplace(context.home) || result.remoteVersion !== summary.version) throw new Error('Checkout returned an unrelated identity, version or destination.');
    const selected = await source(result.pluginPath, context, 'remotePluginId');
    if (plan.checkout.exists) await unchangedSource(plan.checkout, context, 'remotePluginId');
    const entry = { name: summary.name, source: { source: 'local', path: './' + relative(context.home, selected.path).split(sep).join('/') },
      policy: { installation: summary.installPolicy, authentication: summary.authPolicy } };
    if (summary.interface?.category?.trim()) entry.category = summary.interface.category;
    const index = expectedMarket.plugins.findIndex(p => p?.name === summary.name);
    if (index >= 0) expectedMarket.plugins[index] = entry; else expectedMarket.plugins.push(entry);
    if (!isDeepStrictEqual(expectedMarket, await personalMarket(context))) throw new Error('Checkout changed another personal marketplace entry.');
    const now = await personalInventory(context), outside = value => value.entries.filter(e => !within(selected.path, e.path) && !within(e.path, selected.path))
      .map(({ path, kind, uid, mode, sha256 }) => ({ path, kind, uid, mode, sha256 }));
    if (!isDeepStrictEqual(outside(now), outside(plan.personal))) throw new Error('Checkout changed an unrelated personal package.');
    expectedMap[params.remotePluginId] = selected.path;
  }
  if (!isDeepStrictEqual(expectedMap, await associations(context, plan.method === 'plugin/share/save' ? 'pluginPath' : 'remotePluginId'))) throw new Error('Plugin-share associations changed outside the selected operation.');
  const snapshot = await context.inspect(), current = userLayer(snapshot, plan.file), after = await context.capture(); checkConfigurationWriteAuthority(plan, after);
  if (!isDeepStrictEqual(current.config, plan.layer.config) || !isDeepStrictEqual(plan.nonUserLayers, snapshot.layers.filter(l => l.name?.type !== 'user'))) throw new Error('Plugin sharing changed unrelated configuration.');
  await reviewNativeAccountPrivateEcho(result, context.home);
  return { result, identity: after.identity };
}
