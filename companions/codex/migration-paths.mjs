// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { NativeCommandInputError } from '../../src/lib/native-command.ts';
import { nativeMigrationParams } from '../../src/lib/native-migration.ts';

export const nativeMigrationPathLimits = Object.freeze({ entries: 4096, bytes: 64 * 1024 * 1024, fileBytes: 8 * 1024 * 1024 });
const within = (root, path) => path === root || path.startsWith(root + sep);
const fail = (field, message) => { throw new NativeCommandInputError(field.split(/[.\[]/)[0], field + ': ' + message); };
const identity = info => ({ dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode });
const witness = info => ({ ...identity(info), size: info.size, nlink: info.nlink, mtime: info.mtimeMs, ctime: info.ctimeMs });
async function rootDirectory(input, field) {
  const root = resolve(input);
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid?.() || await realpath(root) !== root) throw new Error();
    return { root, info };
  } catch { return fail(field, 'Use an existing canonical directory owned by the runtime user.'); }
}
async function checkedPath(root, path, field) {
  const target = resolve(root.root, path);
  if (!within(root.root, target)) return fail(field, 'This path leaves its authorized migration directory.');
  let current = root.root, info = root.info;
  const parts = relative(root.root, target).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    try { info = await lstat(current); }
    catch (error) { if (error.code === 'ENOENT') return { path: target, info: undefined }; return fail(field, 'The migration path cannot be inspected.'); }
    if (info.isSymbolicLink() || info.uid !== root.info.uid || info.dev !== root.info.dev
      || !(info.isDirectory() || info.isFile()) || info.isFile() && info.nlink !== 1 || index + 1 < parts.length && !info.isDirectory())
      return fail(field, 'Migration paths must use owned files and directories without links or redirected components.');
  }
  return { path: target, info };
}

/** Match the pinned SDK's file-to-parent and nearest-.git scope resolution. */
export async function nativeMigrationRepositoryScope(cwd, workspace, field = 'cwd') {
  const root = await rootDirectory(workspace, field), selected = await checkedPath(root, cwd, field);
  if (!selected.info) return fail(field, 'Use an existing workspace directory or file.');
  const initial = selected.info.isDirectory() ? selected.path : dirname(selected.path);
  for (let candidate = initial; ; candidate = dirname(candidate)) {
    let marker;
    try { marker = await lstat(join(candidate, '.git')); }
    catch (error) { if (error.code !== 'ENOENT') return fail(field, 'The repository marker cannot be inspected.'); }
    if (marker) {
      if (!within(root.root, candidate)) return fail(field, 'The SDK resolves this directory to a repository outside the paired workspace.');
      await checkedPath(root, join(candidate, '.git'), field);
      return candidate;
    }
    if (dirname(candidate) === candidate) return initial;
  }
}

/** Private file witnesses; no source contents or credential values are returned. */
export async function captureNativeMigrationPaths(paths, { boundary, field = 'migrationItems', maximumEntries = nativeMigrationPathLimits.entries,
  maximumBytes = nativeMigrationPathLimits.bytes, maximumFileBytes = nativeMigrationPathLimits.fileBytes }) {
  if (![maximumEntries, maximumBytes, maximumFileBytes].every(Number.isSafeInteger) || maximumEntries < 1 || maximumBytes < 1 || maximumFileBytes < 1
    || maximumEntries > nativeMigrationPathLimits.entries || maximumBytes > nativeMigrationPathLimits.bytes || maximumFileBytes > nativeMigrationPathLimits.fileBytes)
    return fail(field, 'Invalid migration inventory limits.');
  const root = await rootDirectory(boundary, field), entries = [], seen = new Set(); let bytes = 0;
  async function visit(path) {
    if (seen.has(path)) return; seen.add(path);
    if (entries.length >= maximumEntries) return fail(field, 'The migration inventory exceeds its file-count limit.');
    const selected = await checkedPath(root, path, field), info = selected.info;
    if (!info) { entries.push({ path, kind: 'missing' }); return; }
    if (info.isDirectory()) {
      entries.push({ path, kind: 'directory', ...witness(info) });
      let names;
      try { names = await readdir(path); } catch { return fail(field, 'The migration directory cannot be read.'); }
      for (const name of names.sort()) await visit(join(path, name));
      const after = (await checkedPath(root, path, field)).info;
      if (!after || !isDeepStrictEqual(witness(info), witness(after))) return fail(field, 'The migration directory changed during inspection.');
      return;
    }
    if (info.size > maximumFileBytes || bytes + info.size > maximumBytes) return fail(field, 'The migration inventory exceeds its byte limit.');
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!isDeepStrictEqual(witness(info), witness(await file.stat()))) throw new Error();
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536); let length = 0;
      for (;;) {
        const chunk = await file.read(buffer, 0, buffer.length, null);
        if (!chunk.bytesRead) break;
        length += chunk.bytesRead; bytes += chunk.bytesRead;
        if (length > maximumFileBytes || bytes > maximumBytes) return fail(field, 'The migration inventory exceeds its byte limit.');
        hash.update(buffer.subarray(0, chunk.bytesRead));
      }
      if (length !== info.size || !isDeepStrictEqual(witness(info), witness(await file.stat()))
        || !isDeepStrictEqual(witness(info), witness((await checkedPath(root, path, field)).info))) throw new Error();
      entries.push({ path, kind: 'file', ...witness(info), sha256: hash.digest('hex') });
    } catch (error) { if (error instanceof NativeCommandInputError) throw error; return fail(field, 'The migration file changed or cannot be read safely.'); }
    finally { await file?.close(); }
  }
  for (const path of paths) await visit(resolve(root.root, path));
  return { boundary: root.root, owner: identity(root.info), entries };
}

/** Scope/source component only: effect and history verification remain separate. */
export async function prepareNativeMigrationScopes(method, input, { workspace, home, migrationHome }) {
  const params = nativeMigrationParams(method, input), scopes = [], sources = [];
  const homeRoot = await rootDirectory(migrationHome, 'migrationHome');
  const source = params.migrationSource?.toLowerCase() === 'cursor' ? '.cursor' : '.claude';
  async function scope(cwd, field) {
    const canonical = cwd == null || cwd === '' ? null : await nativeMigrationRepositoryScope(cwd, workspace, field);
    if (scopes.some(scope => scope.cwd === canonical)) return canonical;
    const boundary = canonical ?? migrationHome, root = canonical ? await rootDirectory(canonical, field) : homeRoot;
    const targets = canonical ? ['.codex', '.codex/config.toml', '.codex/agents', '.codex/hooks', '.codex/hooks.json', '.agents', '.agents/skills', 'AGENTS.md']
      : [home, join(home, 'config.toml'), join(home, 'AGENTS.md'), join(home, 'agents'), join(home, 'hooks'), join(home, 'hooks.json'), '.agents', '.agents/skills'];
    for (const path of targets) await checkedPath(root, path, field);
    const paths = source === '.cursor' ? [source, '.cursorrules'] : [source, 'CLAUDE.md', 'CLAUDE.local.md', '.mcp.json', '.claude.json'];
    const inventory = await captureNativeMigrationPaths(paths, { boundary, field });
    scopes.push({ cwd: canonical, boundary }); sources.push({ paths, field, inventory });
    if (canonical && source === '.claude') {
      const paths = ['.claude/settings.json', '.claude/settings.local.json', '.claude.json'];
      sources.push({ paths, field, inventory: await captureNativeMigrationPaths(paths, { boundary: migrationHome, field }) });
    }
    return canonical;
  }
  if (method === 'externalAgentConfig/detect') {
    if (params.includeHome) await scope(null, 'includeHome');
    if (params.cwds) for (let index = 0; index < params.cwds.length; index++) params.cwds[index] = await scope(params.cwds[index], 'cwds[' + index + ']');
  } else if (method === 'externalAgentConfig/import') {
    for (let index = 0; index < params.migrationItems.length; index++) {
      const item = params.migrationItems[index]; item.cwd = await scope(item.cwd, 'migrationItems[' + index + '].cwd');
    }
  }
  return { method, params, scopes, sources };
}
export async function reviewNativeMigrationSources(plan) {
  for (const { paths, field, inventory } of plan.sources) {
    const current = await captureNativeMigrationPaths(paths, { boundary: inventory.boundary, field });
    if (!isDeepStrictEqual(current, inventory)) return fail(field, 'The selected migration source changed after inspection.');
  }
}

/** Read a witnessed private source without reopening a redirected pathname. */
export async function readNativeMigrationJson(path, { boundary, field = 'migrationItems' }) {
  const inventory = await captureNativeMigrationPaths([path], { boundary, field });
  const selected = inventory.entries.find(entry => entry.path === resolve(boundary, path));
  if (selected?.kind === 'missing') return undefined;
  if (selected?.kind !== 'file') return fail(field, 'Use a regular JSON migration source.');
  let file;
  try {
    file = await open(selected.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!isDeepStrictEqual(witness(await file.stat()), Object.fromEntries(Object.entries(selected).filter(([key]) => !['path', 'kind', 'sha256'].includes(key))))) throw new Error();
    const chunks = [], buffer = Buffer.alloc(65536); let length = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > selected.size || length > nativeMigrationPathLimits.fileBytes) throw new Error();
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const bytes = Buffer.concat(chunks, length);
    if (bytes.length !== selected.size || createHash('sha256').update(bytes).digest('hex') !== selected.sha256) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), value = text.trim() ? JSON.parse(text) : undefined;
    const current = await captureNativeMigrationPaths([path], { boundary, field });
    if (!isDeepStrictEqual(current, inventory)) throw new Error();
    return value;
  } catch (error) { if (error instanceof NativeCommandInputError) throw error; return fail(field, 'The JSON migration source changed or is invalid.'); }
  finally { await file?.close(); }
}

/** Extra references stay inside the paired workspace or protected source home. */
export async function bindNativeMigrationReference(plan, input, { workspace, home, migrationHome, relativeTo, field }) {
  if (typeof input !== 'string' || !input || input.length > 4096 || !input.isWellFormed() || /[\u0000-\u001f\u007f]/.test(input)) return fail(field, 'Use a bounded local migration source path.');
  const path = resolve(relativeTo, input);
  if (within(home, path) || within(join(migrationHome, '.agents'), path)) return fail(field, 'A migration destination cannot also be an indirect source.');
  const boundary = within(migrationHome, path) ? migrationHome : within(workspace, path) ? workspace : undefined;
  if (!boundary) return fail(field, 'This indirect source leaves the paired workspace and private migration home.');
  const inventory = await captureNativeMigrationPaths([path], { boundary, field });
  const selected = inventory.entries.find(entry => entry.path === path);
  if (selected?.kind !== 'directory' && selected?.kind !== 'file') return fail(field, 'The selected indirect migration source does not exist.');
  plan.sources.push({ paths: [path], field, inventory }); return path;
}
export async function inspectNativeMigrationPath(path, { boundary, field = 'migrationItems' }) {
  const root = await rootDirectory(boundary, field), selected = await checkedPath(root, path, field);
  return { path: selected.path, kind: !selected.info ? 'missing' : selected.info.isDirectory() ? 'directory' : 'file',
    ...(selected.info ? identity(selected.info) : {}) };
}
