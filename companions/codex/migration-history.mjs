// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { nativeCommandId } from '../../src/lib/native-command.ts';
import { inspectNativeMigrationPath } from './migration-paths.mjs';

// Pinned Codex 0.163.0 state schema. No arbitrary SQL/database interface is exposed.
export const nativeMigrationStateDatabase = 'state_5.sqlite';
async function read(root, action) {
  const path = join(root, nativeMigrationStateDatabase);
  let database;
  try {
    const before = await inspectNativeMigrationPath(path, { boundary: root });
    if (before.kind !== 'file' || before.mode & 0o022) throw new Error();
    database = new DatabaseSync(path, { readOnly: true, allowExtension: false, defensive: true, timeout: 1000 });
    const schema = database.prepare("SELECT type FROM sqlite_schema WHERE name = 'external_agent_config_imports'").get();
    if (schema?.type !== 'table') throw new Error();
    const result = action(database), after = await inspectNativeMigrationPath(path, { boundary: root });
    if (after.kind !== 'file' || after.dev !== before.dev || after.ino !== before.ino || after.uid !== before.uid || after.mode & 0o022) throw new Error();
    return result;
  } catch { throw new Error('Owned native migration history is unavailable.'); }
  finally { database?.close(); }
}
export function nativeMigrationHistoryMarker(root) {
  return read(root, database => {
    const value = database.prepare('SELECT coalesce(max(rowid), 0) AS sequence FROM external_agent_config_imports').get().sequence;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error();
    return value;
  });
}
export async function nativeMigrationHistoryRow(root, importId) {
  if (!nativeCommandId(importId)) throw new Error('Invalid owned migration history identifier.');
  return read(root, database => {
    const row = database.prepare('SELECT rowid AS sequence, import_id, provider_id, completed_at_ms, successes, failures FROM external_agent_config_imports WHERE import_id = ?').get(importId);
    if (!row) return undefined;
    if (!Number.isSafeInteger(row.sequence) || typeof row.successes !== 'string' || typeof row.failures !== 'string'
      || Buffer.byteLength(row.successes) + Buffer.byteLength(row.failures) > 4 * 1024 * 1024) throw new Error();
    const successes = JSON.parse(row.successes), failures = JSON.parse(row.failures);
    if (!Array.isArray(successes) || !Array.isArray(failures)) throw new Error();
    return { importId: row.import_id, providerId: row.provider_id, sequence: row.sequence,
      successes: successes.map(item => ({ itemType: item.item_type, cwd: item.cwd ?? null, source: item.source ?? null, target: item.target ?? null, title: item.title ?? null })),
      failures: failures.map(item => ({ itemType: item.item_type, cwd: item.cwd ?? null, source: item.source ?? null, errorType: item.error_type ?? null,
        subErrorType: item.sub_error_type ?? null, failureStage: item.failure_stage, message: item.message })) };
  });
}
