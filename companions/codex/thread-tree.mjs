// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { nativeUuid, nativeObject } from '../../src/lib/native-runtime-contract.ts';
import { inspectNativeMigrationPath } from './migration-paths.mjs';
import { nativeMigrationStateDatabase } from './migration-history.mjs';
import { nativeStoredThreadDirectory } from './stored-thread.mjs';

/** Exact persisted spawn edges plus loaded parent links. Raw metadata stays private. */
export async function nativeThreadTree(threadId, context) {
  if (!nativeUuid(threadId)) throw new Error('Invalid owned thread ID.');
  const root = context.sqliteRoot, path = join(root, nativeMigrationStateDatabase);
  let database, rows;
  try {
    const before = await inspectNativeMigrationPath(path, { boundary: root });
    if (before.kind !== 'file' || before.mode & 0o022) throw new Error();
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 1000 });
    rows = database.prepare(`WITH RECURSIVE tree(id, chain, cycle) AS (
      SELECT ?, ',' || ? || ',', 0
      UNION ALL
      SELECT edge.child_thread_id, tree.chain || edge.child_thread_id || ',', instr(tree.chain, ',' || edge.child_thread_id || ',') > 0
      FROM thread_spawn_edges AS edge JOIN tree ON edge.parent_thread_id = tree.id WHERE tree.cycle = 0
    ) SELECT id, cycle FROM tree LIMIT 65`).all(threadId, threadId);
    const after = await inspectNativeMigrationPath(path, { boundary: root });
    if (after.kind !== 'file' || after.dev !== before.dev || after.ino !== before.ino || after.uid !== before.uid || after.mode & 0o022) throw new Error();
  } catch { throw new Error('Owned native thread graph is unavailable.'); }
  finally { database?.close(); }
  if (rows.length > 64 || rows.some(row => row.cycle || !nativeUuid(row.id))) throw new Error('Native thread subtree is cyclic, invalid or exceeds 64 threads.');
  const ids = new Set(rows.map(row => row.id)), metadata = new Map();
  async function inspect(id) {
    if (metadata.has(id)) return metadata.get(id);
    const raw = await context.inspect(id), result = nativeObject(raw, ['thread', ...(Object.hasOwn(raw ?? {}, 'readState') ? ['readState'] : [])]);
    if (!result.thread || typeof result.thread !== 'object' || result.thread.id !== id
      || result.thread.parentThreadId != null && !nativeUuid(result.thread.parentThreadId)) throw new Error('Native thread graph metadata did not match its identity.');
    metadata.set(id, result.thread); return result.thread;
  }
  const loaded = await context.loaded();
  if (!Array.isArray(loaded) || loaded.length > 64 || loaded.some(id => !nativeUuid(id)) || new Set(loaded).size !== loaded.length) throw new Error('Native loaded-thread inventory is invalid or exceeds 64 threads.');
  for (const id of loaded) await inspect(id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, thread] of metadata) if (!ids.has(id) && ids.has(thread.parentThreadId)) { ids.add(id); changed = true; }
    if (ids.size > 64) throw new Error('Native thread subtree exceeds 64 threads.');
  }
  for (const id of ids) await inspect(id);
  for (const id of ids) {
    const seen = new Set(); let next = id;
    while (ids.has(next) && metadata.has(next)) {
      if (seen.has(next)) throw new Error('Native live thread ancestry is cyclic.');
      seen.add(next); next = metadata.get(next).parentThreadId;
    }
  }
  for (const id of ids) await nativeStoredThreadDirectory((await inspect(id)).cwd, context);
  return { ids: [...ids].sort() };
}
