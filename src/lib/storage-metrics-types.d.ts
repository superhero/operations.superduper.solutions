// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type StorageCommit = {
  oid: string;
  message: string;
  timestamp: number;
  author: string;
  committer: string;
  parents: string[];
};

export type WorkflowStorageMetrics = {
  repositoryBytes: number;
  gitBytes: number;
  workingTreeBytes: number;
  branch: string | null;
  head: string | null;
  branches: string[];
  tags: string[];
  remotes: { name: string; url: string }[];
  trackedFiles: string[];
  status: { clean: boolean; modified: number; staged: number; untracked: number; deleted: number };
  commitCount: number;
  latest: StorageCommit | null;
  recent: StorageCommit[];
  activity: { date: string; count: number }[];
  workflowFile: { bytes: number; mtimeMs: number; ctimeMs: number } | null;
};

export type WorkflowStorageEntry = {
  id: string;
  name: string;
  repositoryPath: string;
  metrics: WorkflowStorageMetrics | null;
  error: string | null;
};

export type DatabaseIndexMetrics = { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean };
export type DatabaseStoreMetrics = {
  name: string;
  records: number;
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  indexes: DatabaseIndexMetrics[];
};
export type DatabaseMetrics = {
  name: string;
  version: number | null;
  stores: DatabaseStoreMetrics[];
  error: string | null;
};

export type StorageReport = {
  collectedAt: number;
  browser: {
    usage: number | null;
    quota: number | null;
    remaining: number | null;
    utilization: number | null;
    persisted: boolean | null;
    breakdown: { name: string; bytes: number }[] | null;
    estimateError: string | null;
    persistenceError: string | null;
  };
  indexedDB: {
    available: boolean;
    enumeration: "complete" | "known" | "unavailable";
    databases: DatabaseMetrics[];
    error: string | null;
  };
  repositories: { items: WorkflowStorageEntry[]; error: string | null };
};
