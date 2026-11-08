// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeMarketplaceParams } from '../../src/lib/native-marketplace.ts';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { captureNativeMigrationPaths, inspectNativeMigrationPath, readNativeMigrationJson } from './migration-paths.mjs';
import { inspectNativePluginMarketplace } from './plugin-read.mjs';
import { configFile, userLayer, checkConfigurationWriteAuthority } from './configuration-write.mjs';
import { reviewNativeAccountPrivateEcho } from './account-read.mjs';

const execute = promisify(execFile), layouts = ['.agents/plugins/marketplace.json', '.agents/plugins/api_marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
const within = (root, path) => path === root || path.startsWith(root + sep);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (field, message) => { throw new NativeCommandInputError(field, message); };
const name = value => { if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\u0000-\u001f\u007f]/.test(value)) fail('marketplaceName', 'Use one marketplace name without path components.'); return value; };
const safeName = value => [...name(value)].map(c => /[A-Za-z0-9_.-]/.test(c) ? c : '-').join('').replace(/^\.+|\.+$/g, '');
const cacheRoot = home => join(home, '.tmp/marketplaces');
function source(input, context) {
  let value = input.source.trim(), ref = input.refName ?? undefined;
  const hash = value.lastIndexOf('#');
  if (hash >= 0) { ref ??= value.slice(hash + 1).trim() || undefined; value = value.slice(0, hash); }
  const local = isAbsolute(value) || /^(?:\.{1,2}(?:[\\/]|$)|~\/|[A-Za-z]:[\\/]|\\\\)/.test(value);
  if (local) {
    if (ref || input.sparsePaths?.length) fail('source', 'References and sparse directories require a Git source.');
    const path = resolve(context.workspace, value.startsWith('~/') ? join(context.home, value.slice(2)) : value);
    if (!within(context.workspace, path) || within(context.home, path)) fail('source', 'Use a local marketplace directory inside the paired workspace.');
    return { source_type: 'local', source: path };
  }
  if (!value.includes('://') && !value.startsWith('git@')) {
    const at = value.lastIndexOf('@'); if (at >= 0) { ref ??= value.slice(at + 1).trim() || undefined; value = value.slice(0, at); }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) fail('source', 'Use a workspace directory, Git URL or owner/repository.');
    value = 'https://github.com/' + value + '.git';
  } else if (value.includes('://')) {
    const url = new URL(value);
    if (!['http:', 'https:', 'ssh:'].includes(url.protocol) || url.password || url.protocol !== 'ssh:' && url.username)
      fail('source', 'Use a Git URL without embedded credentials; authentication belongs to the companion.');
  } else if (!/^git@[^:]+:.+/.test(value)) fail('source', 'Use an SSH Git source or a workspace directory.');
  if (ref?.startsWith('-')) fail('refName', 'Use a Git reference rather than a checkout option.');
  value = value.replace(/\/+$/, '');
  if (value.startsWith('https://github.com/') && !value.endsWith('.git')) value += '.git';
  for (const path of input.sparsePaths ?? []) if (isAbsolute(path) || path.startsWith('-') || path.split(/[\\/]/).some(p => p === '..'))
    fail('sparsePaths', 'Sparse directories must stay inside the repository and cannot be Git options.');
  return { source_type: 'git', source: value, ...(ref ? { ref } : {}), ...(input.sparsePaths?.length ? { sparse_paths: [...input.sparsePaths] } : {}) };
}
async function manifest(root, context, boundary) {
  for (const layout of layouts) {
    const path = join(root, layout), value = await readNativeMigrationJson(path, { boundary, field: 'source' });
    if (object(value)) return { value, path };
  }
  fail('source', 'The marketplace needs a supported manifest.');
}
async function localSource(row, context) {
  if (!isAbsolute(row.source) || !within(context.workspace, row.source) || within(context.home, row.source)) fail('source', 'The configured local source leaves the paired workspace.');
  const info = await inspectNativeMigrationPath(row.source, { boundary: context.workspace, field: 'source' });
  if (info.kind !== 'directory') fail('source', 'Use an existing owned marketplace directory.');
  const m = await manifest(row.source, context, context.workspace), resources = await inspectNativePluginMarketplace(m.path, context);
  const inventory = await captureNativeMigrationPaths([row.source], { boundary: context.workspace, field: 'source' });
  return { ...m, resources, inventory };
}
async function cachedSource(root, row, expectedName, context, upgraded = false) {
  if (!within(cacheRoot(context.home), root) || root === cacheRoot(context.home)) throw new Error('Marketplace cache destination is invalid.');
  const inventory = await captureNativeMigrationPaths([root], { boundary: context.home, field: 'source' });
  if (inventory.entries[0]?.kind !== 'directory') throw new Error('Marketplace cache is missing.');
  const m = await manifest(root, context, context.home); if (m.value.name !== expectedName) throw new Error('Marketplace identity does not match its cache.');
  await inspectNativePluginMarketplace(m.path, context);
  const git = async args => (await execute('git', args, { timeout: 10000, maxBuffer: 16384,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: context.home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
  const remote = await git(['config', '--no-includes', '--file', join(root, '.git/config'), '--get', 'remote.origin.url']);
  if (remote !== row.source) throw new Error('Marketplace Git source does not match its registered provenance.');
  if (upgraded) {
    const metadata = await readNativeMigrationJson(join(root, '.codex-marketplace-install.json'), { boundary: context.home, field: 'source' });
    const head = await git(['--git-dir=' + join(root, '.git'), 'rev-parse', '--verify', 'HEAD']);
    if (!object(metadata) || metadata.source_type !== 'git' || metadata.source !== row.source || metadata.ref_name !== (row.ref ?? null)
      || !isDeepStrictEqual(metadata.sparse_paths, row.sparse_paths ?? []) || metadata.revision !== head || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))
      throw new Error('Marketplace activation revision or source was not verified.');
  }
}
export async function prepareNativeMarketplace(method, input, context) {
  const params = nativeMarketplaceParams(method, input), before = await context.capture(), file = await configFile(context.home), snapshot = await context.inspect();
  const layer = userLayer(snapshot, file), stable = await context.capture();
  if (!sameNativeIdentity(before.identity, stable.identity) || before.basis !== stable.basis) throw new Error('Marketplace authority changed before dispatch.');
  const effective = snapshot.config?.marketplaces ?? {}, plan = { method, original: structuredClone(params), params, before, file, layer,
    nonUserLayers: structuredClone(snapshot.layers.filter(l => l.name?.type !== 'user')), sources: [], selected: [],
    cache: await captureNativeMigrationPaths([cacheRoot(context.home)], { boundary: context.home, field: 'source' }) };
  await reviewNativeAccountPrivateEcho(params, context.home);
  if (method === 'marketplace/add') {
    plan.source = source(params, context);
    if (plan.source.source_type === 'local') {
      const local = await localSource(plan.source, context); plan.marketplaceName = name(local.value.name); plan.sources.push(local.inventory);
      plan.params.source = plan.source.source;
    }
  } else {
    if (params.marketplaceName != null) name(params.marketplaceName);
    if (method === 'marketplace/remove' && plan.nonUserLayers.some(layer => Object.keys(layer.config?.marketplaces ?? {}).some(key => key.toLowerCase() === params.marketplaceName.toLowerCase())))
      fail('marketplaceName', 'Remove this marketplace from its non-user configuration source before deleting its private cache.');
    const entries = Object.entries(effective).filter(([key, row]) => object(row) && (params.marketplaceName == null || key === params.marketplaceName)
      && (method !== 'marketplace/upgrade' || row.source_type === 'git'));
    for (const [key, row] of entries) {
      name(key); if (typeof row.source !== 'string') throw new Error('Configured marketplace source is invalid.');
      plan.selected.push({ name: key, row: structuredClone(row) });
      if (row.source_type === 'local') plan.sources.push((await localSource(row, context)).inventory);
      else if (isAbsolute(row.source)) plan.sources.push(await captureNativeMigrationPaths([row.source], { boundary: context.workspace, field: 'source' }));
    }
  }
  return plan;
}
export async function reviewNativeMarketplace(plan, result, context) {
  await configFile(context.home); checkConfigurationWriteAuthority(plan, await context.capture());
  const snapshot = await context.inspect(), after = await context.capture(); checkConfigurationWriteAuthority(plan, after);
  const current = userLayer(snapshot, plan.file), expected = structuredClone(plan.layer.config), changed = [];
  if (!isDeepStrictEqual(plan.nonUserLayers, snapshot.layers.filter(l => l.name?.type !== 'user'))) throw new Error('Marketplace changed a non-user configuration layer.');
  for (const inventory of plan.sources) {
    const now = await captureNativeMigrationPaths([inventory.entries[0].path], { boundary: inventory.boundary, field: 'source' });
    if (!isDeepStrictEqual(now, inventory)) throw new Error('Marketplace source changed during the operation.');
  }
  if (plan.method === 'marketplace/add') {
    nativeObject(result, ['marketplaceName', 'installedRoot', 'alreadyAdded']); const selected = name(result.marketplaceName);
    if (typeof result.alreadyAdded !== 'boolean' || plan.marketplaceName && selected !== plan.marketplaceName) throw new Error('Marketplace add acknowledgement is invalid.');
    const existed = Object.entries(plan.layer.config.marketplaces ?? {}).some(([key, row]) => object(row)
      && row.source_type === plan.source.source_type && row.source === plan.source.source && (row.ref ?? null) === (plan.source.ref ?? null)
      && isDeepStrictEqual(row.sparse_paths ?? [], plan.source.sparse_paths ?? [])
      && (row.source_type === 'local' || plan.cache.entries.some(entry => entry.path === join(cacheRoot(context.home), key) && entry.kind === 'directory')));
    if (result.alreadyAdded !== existed) throw new Error('Marketplace repeated-add status was not verified.');
    const root = plan.source.source_type === 'local' ? plan.source.source : join(cacheRoot(context.home), safeName(selected));
    if (result.installedRoot !== root) throw new Error('Marketplace add destination does not match its source.');
    if (plan.source.source_type === 'git') await cachedSource(root, plan.source, selected, context);
    expected.marketplaces = object(expected.marketplaces) ? expected.marketplaces : {}; expected.marketplaces[selected] = plan.source; changed.push(root);
  } else if (plan.method === 'marketplace/remove') {
    nativeObject(result, ['marketplaceName', 'installedRoot']);
    if (result.marketplaceName !== plan.params.marketplaceName) throw new Error('Marketplace removal returned another identity.');
    const root = join(cacheRoot(context.home), name(result.marketplaceName)), info = await inspectNativeMigrationPath(root, { boundary: context.home, field: 'marketplaceName' });
    if (info.kind !== 'missing' || result.installedRoot != null && result.installedRoot !== root) throw new Error('Marketplace cache removal was not verified.');
    const existed = plan.cache.entries.some(entry => entry.path === root && entry.kind !== 'missing');
    if ((result.installedRoot != null) !== existed) throw new Error('Marketplace removal status does not match its previous cache.');
    if (object(expected.marketplaces)) { delete expected.marketplaces[result.marketplaceName]; if (!Object.keys(expected.marketplaces).length) delete expected.marketplaces; } changed.push(root);
  } else {
    nativeObject(result, ['selectedMarketplaces', 'upgradedRoots', 'errors']);
    if (!Array.isArray(result.selectedMarketplaces) || !Array.isArray(result.upgradedRoots) || !Array.isArray(result.errors)
      || !isDeepStrictEqual([...result.selectedMarketplaces].sort(), plan.selected.map(s => s.name).sort())) throw new Error('Marketplace upgrade selection was not verified.');
    const errors = new Set();
    for (const error of result.errors) { nativeObject(error, ['marketplaceName', 'message']); if (!plan.selected.some(s => s.name === error.marketplaceName) || errors.has(error.marketplaceName) || typeof error.message !== 'string') throw new Error('Marketplace upgrade error belongs to another source.'); errors.add(error.marketplaceName); }
    if (new Set(result.upgradedRoots).size !== result.upgradedRoots.length) throw new Error('Duplicate marketplace upgrade acknowledgement.');
    for (const root of result.upgradedRoots) {
      const selected = plan.selected.find(s => root === join(cacheRoot(context.home), s.name) && !errors.has(s.name));
      if (!selected) throw new Error('Marketplace upgrade returned an unselected destination.');
      await cachedSource(root, selected.row, selected.name, context, true); changed.push(root);
    }
  }
  if (!isDeepStrictEqual(expected, current.config)) throw new Error('Configuration changed outside the selected marketplace entries.');
  const cache = await captureNativeMigrationPaths([cacheRoot(context.home)], { boundary: context.home, field: 'source' });
  const outside = inventory => inventory.entries.filter(e => e.path !== cacheRoot(context.home) && !changed.some(root => within(root, e.path))
    && e.path !== join(cacheRoot(context.home), '.staging'));
  if (!isDeepStrictEqual(outside(cache), outside(plan.cache))) throw new Error('Another marketplace cache changed unexpectedly.');
  await reviewNativeAccountPrivateEcho(result, context.home);
  return { result, identity: after.identity };
}
