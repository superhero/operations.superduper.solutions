// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const appSettingsDatabaseName = "v1/settings";
// One Git repository per OpenAPI document, with metadata outside the filesystem.
export const catalogsDatabaseName = "v1/catalogs";
export const catalogsIndexDatabaseName = "v1/catalogs/index";
export const workflowRepositoryDatabaseName = "v1/workflows/index";
export const workflowFilesystemName = "v1/workflows";
export const metricsFilesystemName = "v1/metrics";
export const errorHistoryDatabaseName = "v1/errors";

export const legacyStorageNames = {
  settings: "operations-preferences-v1",
  workflowIndex: "operations-workflow-catalog-v1",
  workflows: "operations-workflow-git-v1",
  metrics: "operations-metrics-git-v1"
} as const;
