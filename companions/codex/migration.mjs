// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { readdir } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { NativeCommandInputError, nativeCommandId } from '../../src/lib/native-command.ts';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { NativeMigrationCorrelation, nativeMigrationCompleted } from '../../src/lib/native-migration.ts';
import { prepareNativeMigrationScopes, reviewNativeMigrationSources, captureNativeMigrationPaths,
  readNativeMigrationJson, bindNativeMigrationReference, inspectNativeMigrationPath } from './migration-paths.mjs';

const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const within = (root, path) => path === root || path.startsWith(root + sep);
const fail = message => { throw new NativeCommandInputError('migrationItems', message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileIdentity = entry => entry.kind === 'file' ? ['file', entry.sha256] : [entry.kind];
const successKeys = ['itemType', 'cwd', 'source', 'target', 'title'];
const failureKeys = ['itemType', 'cwd', 'source', 'errorType', 'subErrorType', 'failureStage', 'message'];
const records = (rows, keys) => rows.map(row => Object.fromEntries(keys.map(key => [key, row[key] ?? null])));
function terminal(plan, result) {
  const correlation = new NativeMigrationCorrelation(plan.params);
  const empty = correlation.acknowledge({ importId: result.importId });
  if (empty) {
    if (!isDeepStrictEqual(empty, result)) fail('An empty import cannot report effects.');
    return empty;
  }
  return correlation.notification(nativeMigrationCompleted, result);
}
function scopeKinds(plan, cwd) {
  return new Set(plan.params.migrationItems?.filter(item => item.cwd === cwd || cwd === null && ['PLUGINS', 'MEMORY', 'SESSIONS'].includes(item.itemType)).map(item => item.itemType) ?? []);
}
function targets(plan, { home, migrationHome }) {
  const result = [];
  for (const scope of plan.scopes) {
    const codex = scope.cwd ? join(scope.cwd, '.codex') : home, boundary = scope.boundary;
    const add = (label, path, kinds, preserve = false) => result.push({ label, path, kinds, preserve, cwd: scope.cwd, boundary });
    add('config', join(codex, 'config.toml'), ['CONFIG', 'MCP_SERVER_CONFIG', ...(scope.cwd ? [] : ['PLUGINS'])]);
    add('instructions', scope.cwd ? join(scope.cwd, 'AGENTS.md') : join(home, 'AGENTS.md'), ['AGENTS_MD']);
    add('skills', join(scope.cwd ?? migrationHome, '.agents/skills'), ['SKILLS', 'COMMANDS'], true);
    add('agents', join(codex, 'agents'), ['SUBAGENTS'], true);
    add('hook-config', join(codex, 'hooks.json'), ['HOOKS']);
    add('hook-scripts', join(codex, 'hooks'), ['HOOKS'], true);
    if (!scope.cwd) {
      add('plugins', join(home, 'plugins'), ['PLUGINS']);
      add('marketplace-cache', join(home, '.tmp/marketplaces'), ['PLUGINS']);
      add('curated-marketplace', join(home, '.tmp/plugins'), ['PLUGINS']);
      add('memory', join(home, 'memories'), ['MEMORY']);
      add('sessions', join(home, 'sessions'), ['SESSIONS'], true);
    }
  }
  return result;
}
async function snapshotTargets(specs) {
  return Promise.all(specs.map(async spec => ({ ...spec,
    inventory: await captureNativeMigrationPaths([spec.path], { boundary: spec.boundary, field: 'migrationItems' }) })));
}
function differences(before, after) {
  const prior = new Map(before.entries.map(entry => [entry.path, entry]));
  const next = new Map(after.entries.map(entry => [entry.path, entry]));
  return [...new Set([...prior.keys(), ...next.keys()])].sort().flatMap(path => {
    const left = prior.get(path), right = next.get(path);
    if (isDeepStrictEqual(left && fileIdentity(left), right && fileIdentity(right))) return [];
    return [{ path, before: left ? fileIdentity(left) : null, after: right ? fileIdentity(right) : null }];
  });
}
function mergeSourceSettings(before, incoming, depth = 0) {
  if (depth > 32) fail('Plugin settings exceed the nesting limit.');
  if (!object(before) || !object(incoming)) return incoming;
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(incoming)])].map(key =>
    [key, Object.hasOwn(incoming, key) ? mergeSourceSettings(before[key], incoming[key], depth + 1) : before[key]]));
}
function declaredMarketplaceSource(row, root) {
  if (!object(row)) return;
  const fields = object(row.source) ? row.source : row;
  const kind = typeof fields.source === 'string' ? fields.source.trim() : undefined;
  let declared = kind === 'github' ? fields.repo : kind === 'git' ? fields.url : ['directory', 'local'].includes(kind) ? fields.path
    : ['file', 'url', 'npm', 'settings'].includes(kind) ? undefined : kind ? fields.source : fields.repo ?? fields.url ?? fields.path ?? row.source;
  declared = typeof declared === 'string' ? declared.trim() : '';
  // The SDK prefers a supported declaration over an unused materialized cache.
  if (declared) return ['directory', 'local'].includes(kind) || /^(?:\.\.?\/|\.{1,2}$)/.test(declared) ? resolve(root, declared) : declared;
  return typeof row.installLocation === 'string' && row.installLocation.trim() ? resolve(root, row.installLocation.trim()) : undefined;
}
const marketplaceLayouts = ['.agents/plugins/marketplace.json', '.agents/plugins/api_marketplace.json', '.claude-plugin/marketplace.json', '.cursor-plugin/marketplace.json'];
async function bindPluginReference(plan, input, environment, relativeTo) {
  const path = resolve(relativeTo, input);
  const cache = [join(environment.home, '.tmp/marketplaces'), join(environment.home, '.tmp/plugins'), join(environment.migrationHome, '.agents/plugins')];
  if (!cache.some(root => within(root, path))) return bindNativeMigrationReference(plan, input, { ...environment, relativeTo, field: 'migrationItems.plugins' });
  const inventory = await captureNativeMigrationPaths([path], { boundary: environment.migrationHome, field: 'migrationItems.plugins' });
  if (inventory.entries[0]?.kind === 'missing') fail('The configured plugin source does not exist.');
  plan.sources.push({ paths: [path], field: 'migrationItems.plugins', inventory });
  return path;
}
async function pluginSources(plan, environment, configurations) {
  const items = plan.params.migrationItems.filter(item => item.itemType === 'PLUGINS');
  if (!items.length) return;
  if (items.some(item => item.cwd !== null)) fail('Repository-scoped plugin migration is not allowed by the native SDK.');
  const groups = items.flatMap(item => item.details?.plugins ?? []), selected = new Map();
  for (const group of groups) selected.set(group.marketplaceName, new Set([...(selected.get(group.marketplaceName) ?? []), ...group.pluginNames]));
  const cursor = plan.params.migrationSource?.toLowerCase() === 'cursor', directory = join(environment.migrationHome, cursor ? '.cursor' : '.claude');
  const sources = new Map(), configured = new Set();
  const roots = new Set([environment.migrationHome, join(environment.home, '.tmp/plugins')]);
  for (const { snapshot } of configurations) for (const layer of snapshot.layers ?? []) for (const [name, row] of Object.entries(object(layer.config?.marketplaces) ? layer.config.marketplaces : {})) {
    if (!object(row)) continue;
    if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) fail('A configured marketplace has an invalid name.');
    if (row.source_type === 'local') {
      if (typeof row.source === 'string' && row.source) roots.add(resolve(environment.workspace, row.source));
    } else roots.add(join(environment.home, '.tmp/marketplaces', name));
  }
  for (let root of roots) {
    if (root !== environment.migrationHome) {
      const boundary = within(environment.migrationHome, root) ? environment.migrationHome : within(environment.workspace, root) ? environment.workspace : undefined;
      if (!boundary) fail('A configured marketplace leaves the paired workspace and private migration home.');
      const metadata = await inspectNativeMigrationPath(root, { boundary });
      if (metadata.kind === 'missing') continue;
    }
    for (const layout of marketplaceLayouts) {
      const path = join(root, layout), boundary = root === environment.migrationHome ? environment.migrationHome : root;
      const metadata = await inspectNativeMigrationPath(path, { boundary, field: 'migrationItems.plugins' });
      if (metadata.kind !== 'file') continue;
      // Installed roots must contain a direct manifest before the SDK lists
      // them. It never searches ancestor repositories for a configured root.
      if (root !== environment.migrationHome) root = await bindPluginReference(plan, root, environment, environment.workspace);
      const inventory = await captureNativeMigrationPaths([path], { boundary, field: 'migrationItems.plugins' });
      plan.sources.push({ paths: [path], field: 'migrationItems.plugins', inventory });
      const manifest = await readNativeMigrationJson(path, { boundary, field: 'migrationItems.plugins' });
      if (typeof manifest?.name === 'string') { configured.add(manifest.name); sources.set(root, selected.get(manifest.name) ?? new Set()); }
      // Listing reads configured manifests even for an unselected marketplace.
      // Every local source in those manifests must stay under its actual root.
      for (const plugin of Array.isArray(manifest?.plugins) ? manifest.plugins : []) {
        const source = plugin?.source, local = typeof source === 'string' ? source : object(source) && source.source === 'local' ? source.path : undefined;
        if (typeof local === 'string') await bindPluginReference(plan, local, environment, root);
      }
      break;
    }
  }
  async function bind(candidate, name) {
    if (configured.has(name)) return;
    if (!candidate || !(/^(?:\/|\.\.?[\\/]|~\/|\.{1,2}$|[A-Za-z]:[\\/]|\\\\)/.test(candidate))) return;
    const marker = candidate.lastIndexOf('#');
    if (marker >= 0) {
      if (candidate.slice(marker + 1).trim()) fail('A local plugin marketplace cannot select a Git reference.');
      candidate = candidate.slice(0, marker);
    }
    if (candidate.startsWith('~/')) candidate = join(environment.migrationHome, candidate.slice(2));
    const path = await bindPluginReference(plan, candidate, environment, environment.workspace);
    sources.set(path, new Set([...(sources.get(path) ?? []), ...(selected.get(name) ?? [])]));
  }
  if (cursor) {
    const root = join(directory, 'plugins/marketplaces'), metadata = await inspectNativeMigrationPath(root, { boundary: environment.migrationHome });
    if (metadata.kind === 'directory') for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory()) {
      const path = join(root, entry.name), manifest = await readNativeMigrationJson(join(path, '.cursor-plugin/marketplace.json'), { boundary: path, field: 'migrationItems.plugins' });
      if (selected.has(manifest?.name)) await bind(path, manifest.name);
    }
  } else {
    const options = { boundary: environment.migrationHome, field: 'migrationItems.plugins' };
    const known = await readNativeMigrationJson(join(directory, 'plugins/known_marketplaces.json'), options);
    const base = await readNativeMigrationJson(join(directory, 'settings.json'), options);
    const local = await readNativeMigrationJson(join(directory, 'settings.local.json'), options);
    const settings = local === undefined ? base : mergeSourceSettings(base, local), registry = new Map(Object.entries(object(known) ? known : {}));
    for (const [name, row] of Object.entries(object(settings?.extraKnownMarketplaces) ? settings.extraKnownMarketplaces : {})) {
      const cached = known?.[name];
      registry.set(name, object(row) && isDeepStrictEqual(row.source, cached?.source) && typeof cached?.installLocation === 'string'
        ? { ...row, installLocation: resolve(directory, cached.installLocation) } : row);
    }
    for (const name of selected.keys()) await bind(declaredMarketplaceSource(registry.get(name), directory), name);
  }
  for (const [root, names] of sources) for (const layout of marketplaceLayouts) {
    const manifest = await readNativeMigrationJson(join(root, layout), { boundary: root, field: 'migrationItems.plugins' });
    if (manifest === undefined) continue;
    for (const plugin of Array.isArray(manifest?.plugins) ? manifest.plugins : []) if (names.has(plugin?.name)) {
      const source = plugin.source, path = typeof source === 'string' ? source : object(source) && source.source === 'local' ? source.path : undefined;
      if (typeof path === 'string') await bindPluginReference(plan, path, environment, root);
    }
    break;
  }
}
async function sourceReferences(plan, environment, configurations) {
  if (plan.method !== 'externalAgentConfig/import') return;
  await pluginSources(plan, environment, configurations);
  for (const item of plan.params.migrationItems) if (item.itemType === 'SESSIONS') for (const session of item.details?.sessions ?? []) {
    await bindNativeMigrationReference(plan, session.path, { ...environment, relativeTo: environment.workspace, field: 'migrationItems.sessions.path' });
    if (!within(environment.workspace, resolve(environment.workspace, session.cwd))) fail('The imported session directory leaves the paired workspace.');
  }
  // Source hashes include complete skill/command/hook/subagent scopes. Those
  // APIs intentionally ignore narrowed display-name lists in item details.
}
function mutableLayer(layer, plan, home) {
  if (layer.name?.type === 'user' && layer.name.file === join(home, 'config.toml')) return true;
  return layer.name?.type === 'project' && plan.scopes.some(scope => scope.cwd && layer.name.dotCodexFolder === join(scope.cwd, '.codex'));
}
function preserves(before, after) {
  if (!object(before)) return isDeepStrictEqual(before, after);
  return object(after) && Object.keys(before).every(key => Object.hasOwn(after, key) && preserves(before[key], after[key]));
}
async function sqliteRoots(configurations, plan, environment) {
  if (!plan.params.migrationItems?.some(item => item.itemType === 'PLUGINS')) return [];
  const roots = new Set();
  for (const { snapshot } of configurations) for (const layer of snapshot.layers ?? []) {
    const value = layer.config?.sqlite_home; if (typeof value !== 'string') continue;
    const base = layer.name?.dotCodexFolder ?? (layer.name?.file ? resolve(layer.name.file, '..') : environment.home), path = resolve(base, value);
    if (!within(environment.migrationHome, path)) fail('Plugin configuration uses an unowned SQLite home.');
    roots.add(path);
  }
  for (const path of roots) await reviewSqliteRoot(path, environment);
  return [...roots];
}
export async function reviewSqliteRoot(path, environment) {
  const root = await inspectNativeMigrationPath(path, { boundary: environment.migrationHome });
  if (root.kind === 'missing') return;
  if (root.kind !== 'directory') fail('The plugin SQLite home must be an owned directory.');
  const files = await readdir(path); if (files.length > 4096) fail('The plugin SQLite directory exceeds its entry limit.');
  for (const name of files.filter(name => /(?:\.sqlite\d*|\.db)(?:-(?:wal|shm))?$/.test(name))) {
    const file = await inspectNativeMigrationPath(join(path, name), { boundary: environment.migrationHome });
    if (file.kind === 'missing' && /-(?:wal|shm)$/.test(name)) continue;
    if (file.kind !== 'file' || file.mode & 0o022) fail('SQLite files must be owned regular files without shared write access.');
  }
}
function reviewLayers(before, after, plan, home) {
  if (!Array.isArray(before.layers) || !Array.isArray(after.layers)) fail('Private configuration layers are unavailable.');
  if (!isDeepStrictEqual(before.layers.filter(layer => !mutableLayer(layer, plan, home)), after.layers.filter(layer => !mutableLayer(layer, plan, home))))
    fail('Non-migration configuration authority changed.');
  if (before.layers.some(layer => mutableLayer(layer, plan, home) && !after.layers.some(next => isDeepStrictEqual(next.name, layer.name))))
    fail('An existing migration configuration layer disappeared.');
  for (const layer of after.layers.filter(layer => mutableLayer(layer, plan, home))) {
    const old = before.layers.find(previous => isDeepStrictEqual(previous.name, layer.name));
    const cwd = layer.name.type === 'user' ? null : plan.scopes.find(scope => layer.name.dotCodexFolder === join(scope.cwd ?? '', '.codex'))?.cwd;
    const kinds = scopeKinds(plan, cwd), allowed = new Set();
    if (kinds.has('CONFIG')) { allowed.add('shell_environment_policy'); allowed.add('sandbox_mode'); }
    if (kinds.has('MCP_SERVER_CONFIG')) allowed.add('mcp_servers');
    if (kinds.has('PLUGINS')) { allowed.add('plugins'); allowed.add('marketplaces'); }
    const previous = { ...old?.config }, next = { ...layer.config };
    if (kinds.has('CONFIG') && old?.config?.shell_environment_policy !== undefined && !preserves(old.config.shell_environment_policy, layer.config?.shell_environment_policy))
      fail('Migration overwrote existing shell environment settings.');
    if (kinds.has('CONFIG') && old?.config?.sandbox_mode !== undefined && old.config.sandbox_mode !== layer.config?.sandbox_mode)
      fail('Migration overwrote an existing sandbox preference.');
    if (kinds.has('MCP_SERVER_CONFIG')) for (const [name, server] of Object.entries(old?.config?.mcp_servers ?? {}))
      if (!isDeepStrictEqual(server, layer.config?.mcp_servers?.[name])) fail('Migration overwrote an existing MCP server.');
    for (const key of allowed) { delete previous[key]; delete next[key]; }
    if (!isDeepStrictEqual(previous, next)) fail('Configuration changed outside the selected migration namespaces.');
  }
}
function privateValues(configurations) {
  const result = new Set();
  const take = value => { if (typeof value === 'string' && value) result.add(value); };
  for (const snapshot of configurations) for (const layer of snapshot.layers ?? []) {
    const config = layer.config;
    for (const value of Object.values(config?.shell_environment_policy?.set ?? {})) take(value);
    for (const server of Object.values(config?.mcp_servers ?? {})) if (object(server)) {
      for (const value of Object.values(server.env ?? {})) take(value);
      for (const value of Object.values(server.http_headers ?? {})) {
        take(value);
        if (typeof value === 'string') {
          const bearer = /^Bearer\s+(.+)$/i.exec(value); if (bearer) take(bearer[1]);
          const basic = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(value);
          if (basic) { const decoded = Buffer.from(basic[1], 'base64').toString('utf8'); take(basic[1]); take(decoded); for (const part of decoded.split(':')) take(part); }
        }
      }
      take(server.bearer_token);
      if (typeof server.url === 'string') {
        let url;
        try { url = new URL(server.url); } catch { continue; }
        for (const value of [url.username, url.password]) {
          take(value); try { take(decodeURIComponent(value)); } catch { /* Preserve the exact encoded value. */ }
        }
        for (const value of url.searchParams.values()) take(value);
      }
    }
  }
  const values = [...result];
  if (values.length > 256 || values.some(value => value.length > 8192 || !value.isWellFormed()) || Buffer.byteLength(JSON.stringify(values)) > 32768) fail('Imported private configuration values exceed the credential profile.');
  return values;
}
export function checkNativeMigrationAuthority(context, current) {
  if (context.before.migrationBasis !== current.migrationBasis
    || !sameNativeIdentity(context.before.identity, { ...current.identity, configuration: context.before.identity.configuration }))
    fail('Runtime, account, workspace or permission authority changed during migration.');
}
export async function prepareNativeMigration(method, input, environment) {
  const before = await environment.capture(), plan = await prepareNativeMigrationScopes(method, input, environment);
  if (plan.params.migrationItems?.some(item => ['PLUGINS', 'MEMORY', 'SESSIONS'].includes(item.itemType)) && !plan.scopes.some(scope => scope.cwd === null)) {
    const global = await prepareNativeMigrationScopes('externalAgentConfig/detect', { includeHome: true, migrationSource: plan.params.migrationSource ?? null }, environment);
    plan.scopes.push(...global.scopes); plan.sources.push(...global.sources);
  }
  const configurations = [];
  const plugin = plan.params.migrationItems?.some(item => item.itemType === 'PLUGINS');
  for (const cwd of new Set([null, ...plan.scopes.map(scope => scope.cwd).filter(Boolean), ...(plugin ? [environment.home] : [])])) configurations.push({ cwd, snapshot: await environment.inspect(cwd) });
  const sqlite = await sqliteRoots(configurations, plan, environment);
  await sourceReferences(plan, environment, configurations);
  const targetState = await snapshotTargets(targets(plan, environment));
  const sequence = environment.historyMarker && ['externalAgentConfig/import', 'externalAgentConfig/import/recordHistory'].includes(method) ? await environment.historyMarker() : undefined;
  const history = method === 'externalAgentConfig/import/recordHistory' && sequence === undefined ? await environment.histories() : undefined;
  const context = { ...plan, before, configurations, targetState, history, sequence, environment, sqlite };
  checkNativeMigrationAuthority(context, await environment.capture());
  return context;
}
export async function checkNativeMigrationPreimages(context) {
  await reviewNativeMigrationSources(context); checkNativeMigrationAuthority(context, await context.environment.capture());
  const current = await snapshotTargets(context.targetState);
  if (!isDeepStrictEqual(current, context.targetState)) fail('A migration destination changed before dispatch.');
  for (const path of context.sqlite) await reviewSqliteRoot(path, context.environment);
}
export async function reviewNativeMigration(context, result, completion) {
  const environment = context.environment; checkNativeMigrationAuthority(context, await environment.capture());
  for (const path of context.sqlite) await reviewSqliteRoot(path, environment);
  await reviewNativeMigrationSources(context);
  const after = await snapshotTargets(context.targetState), effects = [];
  for (let index = 0; index < context.targetState.length; index++) {
    const before = context.targetState[index], next = after[index], changes = differences(before.inventory, next.inventory), kinds = scopeKinds(context, before.cwd);
    if (changes.length && !before.kinds.some(kind => kinds.has(kind))) fail('A destination changed outside the selected migration kinds.');
    if (before.preserve) for (const entry of before.inventory.entries.filter(entry => entry.kind === 'file')) {
      const current = next.inventory.entries.find(value => value.path === entry.path);
      if (!current || current.kind !== 'file' || current.sha256 !== entry.sha256) fail('Migration replaced an existing protected destination file.');
    }
    if (before.label === 'memory') {
      const resources = join(environment.home, 'memories/extensions/external_agent_import/resources');
      const projects = new Set(context.params.migrationItems?.filter(item => item.itemType === 'MEMORY').flatMap(item => item.details?.memory ?? []) ?? []);
      for (const change of changes) if (change.path !== resources && within(resources, change.path)) {
        const project = change.path.slice(resources.length + 1).split(sep)[0];
        if (!projects.has(project)) fail('Memory import changed an unselected project resource.');
      }
    }
    effects.push(...changes);
  }
  const configurations = [];
  for (const before of context.configurations) {
    const current = await environment.inspect(before.cwd); reviewLayers(before.snapshot, current, context, environment.home); configurations.push(current);
  }
  let acknowledged = result;
  if (context.method === 'externalAgentConfig/import') {
    nativeObject(result, ['importId']); const verified = terminal(context, completion);
    if (verified.importId !== result.importId) fail('The import acknowledgement and completion do not match.');
    const failed = verified.itemTypeResults.filter(item => item.failures.length);
    const successes = verified.itemTypeResults.flatMap(item => item.successes), failures = verified.itemTypeResults.flatMap(item => item.failures);
    if (context.params.migrationItems.length) {
      const histories = environment.historyRow ? { data: [await environment.historyRow(result.importId)].filter(Boolean) } : await environment.histories();
      const matching = histories.data?.filter(row => row.importId === result.importId && (context.sequence === undefined || row.sequence > context.sequence));
      if (matching?.length !== 1 || context.params.providerId != null && matching[0].providerId !== context.params.providerId
        || !isDeepStrictEqual(records(matching[0].successes, successKeys), records(successes, successKeys))
        || !isDeepStrictEqual(records(matching[0].failures, failureKeys), records(failures, failureKeys))) fail('The completed import was not verified in persistent history.');
    }
    if (failed.length) fail('Native migration failed for: ' + failed.map(item => item.itemType).join(', ') + '.');
    if (effects.length && !successes.length) fail('The import changed files without reporting a successful effect.');
    for (const success of successes) if (success.itemType === 'SESSIONS' && success.cwd != null && !within(environment.workspace, resolve(success.cwd)))
      fail('An imported session has an unowned workspace directory.');
  } else if (context.method === 'externalAgentConfig/import/recordHistory') {
    nativeObject(result, ['importId']); if (!nativeCommandId(result.importId)) fail('The external history acknowledgement has an invalid identifier.');
    const prior = new Set(context.history?.data.map(row => row.importId) ?? []);
    const current = environment.historyRow ? { data: [await environment.historyRow(result.importId)].filter(Boolean) } : await environment.histories();
    const successes = context.params.itemTypeResults.flatMap(item => item.successes), failures = context.params.itemTypeResults.flatMap(item => item.failures);
    const added = current.data.filter(row => row.importId === result.importId && !prior.has(row.importId) && (context.sequence === undefined || row.sequence > context.sequence) && row.providerId === context.params.providerId
      && isDeepStrictEqual(records(row.successes, successKeys), records(successes, successKeys)) && isDeepStrictEqual(records(row.failures, failureKeys), records(failures, failureKeys)));
    if (added.length !== 1) fail('The external history record was not verified after persistence.');
  }
  checkNativeMigrationAuthority(context, await environment.capture());
  return { result: acknowledged, effects, effectHash: hash(effects), privateValues: context.method === 'externalAgentConfig/import' ? privateValues(configurations) : [] };
}
