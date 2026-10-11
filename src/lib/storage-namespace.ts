// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { migrateDatabase, migrateFilesystem, removeMigratedDatabase } from "./storage-namespace-migration.ts";
import { appSettingsDatabaseName, workflowRepositoryDatabaseName, workflowFilesystemName, metricsFilesystemName,
  legacyStorageNames } from "./storage-names.ts";
import { createPail } from "@visulima/pail/browser";
import { PrettyReporter } from "@visulima/pail/browser/reporter/pretty";

let pending: Promise<void> | undefined;
// This module also runs in workers; the page logger installs DOM error-overlay hooks.
const migrationLogger = createPail({ scope: ["operations", "storage-migration"], reporters: [new PrettyReporter()] });

function guard(source: string, target: string, cleanup = false)
{
  return async (copy: () => Promise<void>): Promise<void> => {
    await navigator.locks.request("operations-metrics-recorder-v1", { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("Close other tabs for this app, then reload to finish updating the saved database names safely.");
      migrationLogger.info(cleanup ? `Removing retired database ${source}` : `Migrating ${source} to ${target}`);
      await copy();
    });
  };
}

/** Finish the namespace change before settings, editors or the recorder use new databases. */
export function prepareStorageNamespaces(): Promise<void>
{
  pending ??= (async () => {
    // Leave unsupported storage handling to the existing settings/repository error paths.
    if (!globalThis.indexedDB || !globalThis.navigator?.locks) return;
    await navigator.locks.request("operations-storage-namespace-v1", async () => {
      await migrateDatabase(legacyStorageNames.settings, appSettingsDatabaseName,
        guard(legacyStorageNames.settings, appSettingsDatabaseName));
      await migrateFilesystem(legacyStorageNames.workflows, workflowFilesystemName,
        guard(legacyStorageNames.workflows, workflowFilesystemName));
      await migrateDatabase(legacyStorageNames.workflowIndex, workflowRepositoryDatabaseName,
        guard(legacyStorageNames.workflowIndex, workflowRepositoryDatabaseName));
      await migrateFilesystem(legacyStorageNames.metrics, metricsFilesystemName,
        guard(legacyStorageNames.metrics, metricsFilesystemName));
      // All copies must finish before any source is retired. Completion markers
      // also allow cleanup of backups left by the earlier namespace migration.
      await removeMigratedDatabase(legacyStorageNames.settings, appSettingsDatabaseName, false,
        guard(legacyStorageNames.settings, appSettingsDatabaseName, true));
      await removeMigratedDatabase(legacyStorageNames.workflows, workflowFilesystemName, true,
        guard(legacyStorageNames.workflows, workflowFilesystemName, true));
      await removeMigratedDatabase(legacyStorageNames.workflowIndex, workflowRepositoryDatabaseName, false,
        guard(legacyStorageNames.workflowIndex, workflowRepositoryDatabaseName, true));
      await removeMigratedDatabase(legacyStorageNames.metrics, metricsFilesystemName, true,
        guard(legacyStorageNames.metrics, metricsFilesystemName, true));
    });
  })().catch(cause => {
    pending = undefined;
    throw new Error("Could not finish updating browser database names. Close other tabs for this app and reload to retry. Only databases with a completed migration can be removed.", { cause });
  });
  return pending;
}
