// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { nativeConfigurationWriteParams } from '../../src/lib/native-configuration-write.ts';

const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const trim = v => v.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
export async function configFile(home) {
  const file = join(home, 'config.toml');
  try {
    const info = await lstat(file), owner = await lstat(home);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== owner.uid || info.mode & 0o022 || info.size > 1024 * 1024 || await realpath(file) !== file) throw new Error();
  } catch (error) { if (error.code !== 'ENOENT') throw new NativeCommandInputError('filePath', 'The user config must be an owned regular file without links or shared write access.'); }
  return file;
}
export function userLayer(snapshot, file) {
  if (!object(snapshot) || !Array.isArray(snapshot.layers)) throw new Error('Private configuration layers are unavailable.');
  const layers = snapshot.layers.filter(layer => layer.name?.type === 'user');
  if (layers.length > 1 || layers[0] && (layers[0].name.file !== file || layers[0].disabledReason != null || !object(layers[0].config)
    || typeof layers[0].version !== 'string' || !layers[0].version || layers[0].version.length > 512)) throw new Error('The active user configuration layer is unavailable.');
  return { config: structuredClone(layers[0]?.config ?? {}), version: layers[0]?.version };
}
function safeSnapshot(value, depth = 0) {
  if (depth > 32 || typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Configuration snapshot exceeds the exact JSON profile.');
  if (value && typeof value === 'object') for (const item of Object.values(value)) safeSnapshot(item, depth + 1);
}
async function skillPath(path, workspace, home) {
  try {
    const requested = resolve(workspace, path);
    if (!within(workspace, requested) || within(home, requested)) throw new Error();
    const actual = await realpath(requested), info = await lstat(actual);
    if (!within(workspace, actual) || within(home, actual) || !(info.isDirectory() || info.isFile()) || info.isFile() && info.nlink !== 1) throw new Error();
    return actual;
  } catch { throw new NativeCommandInputError('path', 'Use an existing owned workspace skill path outside the private runtime home, without hard links.'); }
}
async function normalizeExistingPath(path, workspace) { try { return await realpath(resolve(workspace, path)); } catch { return path; } }
async function expectedSkill(config, params, workspace) {
  const expected = structuredClone(config), selected = params.path != null ? { path: params.path } : { name: params.name };
  if (!object(expected.skills)) { if (params.enabled) return expected; expected.skills = {}; }
  if (!Array.isArray(expected.skills.config)) { if (params.enabled) return expected; expected.skills.config = []; }
  const entries = expected.skills.config; let index = -1;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]; if (!object(entry)) continue;
    const path = typeof entry.path === 'string' ? await normalizeExistingPath(entry.path, workspace) : undefined;
    const name = typeof entry.name === 'string' && trim(entry.name) ? trim(entry.name) : undefined;
    if ((path !== undefined) === (name !== undefined)) continue;
    if (selected.path != null ? path === selected.path : name === selected.name) { index = i; break; }
  }
  if (params.enabled) {
    if (index >= 0) { entries.splice(index, 1); if (!entries.length) { delete expected.skills.config; if (!Object.keys(expected.skills).length) delete expected.skills; } }
  } else if (index >= 0) {
    delete entries[index].name; delete entries[index].path; Object.assign(entries[index], selected, { enabled: false });
  } else entries.push({ ...selected, enabled: false });
  return expected;
}
function expectedPreferences(config, edits) {
  const expected = structuredClone(config);
  for (const { keyPath, value } of edits) {
    const segments = keyPath.split('.'), key = segments.pop(); let parent = expected;
    for (const segment of segments) {
      if (!object(parent[segment])) { if (value === null) { parent = undefined; break; } parent[segment] = {}; }
      parent = parent[segment];
    }
    if (parent) { if (value === null) delete parent[key]; else parent[key] = structuredClone(value); }
  }
  return expected;
}
export function checkConfigurationWriteAuthority(context, current) {
  if (context.before.basis !== current.basis || !sameNativeIdentity(context.before.identity, { ...current.identity, configuration: context.before.identity.configuration })) throw new Error('Non-user configuration authority changed.');
}
export async function prepareNativeConfigurationWrite(method, input, { workspace, home, capture, inspect }) {
  const original = nativeConfigurationWriteParams(method, input), params = structuredClone(original), file = await configFile(home);
  if (params.filePath != null && (!isAbsolute(params.filePath) || resolve(params.filePath) !== file)) throw new NativeCommandInputError('filePath', 'Only this paired runtime’s user config.toml can be written.');
  if (params.path != null) params.path = await skillPath(params.path, workspace, home);
  const before = await capture(), snapshot = await inspect(), layer = userLayer(snapshot, file), stable = await capture();
  if (!sameNativeIdentity(before.identity, stable.identity) || before.basis !== stable.basis) throw new Error('Configuration changed before write dispatch.');
  safeSnapshot(layer.config);
  const expected = method === 'skills/config/write' ? await expectedSkill(layer.config, params, workspace)
    : expectedPreferences(layer.config, method === 'config/value/write' ? [params] : params.edits);
  if (method !== 'skills/config/write') { params.filePath = file; params.expectedVersion ??= layer.version ?? null; }
  return { method, original, params, file, before, expected, nonUserLayers: structuredClone(snapshot.layers.filter(layer => layer.name?.type !== 'user')) };
}
export async function reviewNativeConfigurationWrite(context, result, { workspace, home, capture, inspect }) {
  await configFile(home); checkConfigurationWriteAuthority(context, await capture());
  const snapshot = await inspect(), layer = userLayer(snapshot, context.file), after = await capture(); checkConfigurationWriteAuthority(context, after); safeSnapshot(layer.config);
  if (!isDeepStrictEqual(context.nonUserLayers, snapshot.layers.filter(layer => layer.name?.type !== 'user'))) throw new Error('Non-user SDK configuration layers changed.');
  if (!isDeepStrictEqual(context.expected, layer.config)) throw new Error('Configuration changed outside the requested settings.');
  if (context.params.path != null && await skillPath(context.params.path, workspace, home) !== context.params.path) throw new Error('Skill path authority changed.');
  if (context.method === 'skills/config/write') {
    nativeObject(result, ['effectiveEnabled']); if (result.effectiveEnabled !== context.params.enabled) throw new Error('Skill acknowledgement does not match the requested setting.');
  } else {
    nativeObject(result, ['filePath', 'status', 'version', ...(Object.hasOwn(result, 'overriddenMetadata') ? ['overriddenMetadata'] : [])]);
    if (result.filePath !== context.file || !['ok', 'okOverridden'].includes(result.status) || typeof result.version !== 'string' || !result.version || result.version.length > 512
      || layer.version !== undefined && result.version !== layer.version) throw new Error('Configuration write version or destination was not verified.');
    if (result.overriddenMetadata != null) {
      const metadata = nativeObject(result.overriddenMetadata, ['effectiveValue', 'message', 'overridingLayer']);
      if (metadata.effectiveValue !== null && !['string', 'number', 'boolean'].includes(typeof metadata.effectiveValue)) throw new Error('Unreviewed overridden configuration value.');
    }
  }
  return { result, identity: after.identity };
}
