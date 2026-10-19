// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import { prepareMatchingOperations, type PreparedMatchingOperation } from "./matching.ts";

export type MatchingCatalog = { id: string; revision: string; prepared: PreparedMatchingOperation[] };
export type MatchingSnapshot = { revision: string; catalogs: MatchingCatalog[]; byId: Map<string, Operation> };

/** Descriptor identity follows the source revision. Retain only enabled catalogs. */
export function createMatchingIndexCache() {
  let nextRevision = 0;
  let previous: Operation[] | undefined;
  let snapshot: MatchingSnapshot;
  let catalogs = new Map<string, { operations: Operation[]; index: MatchingCatalog }>();
  return {
    prepare(operations: Operation[]): MatchingSnapshot {
      if (operations === previous) return snapshot;
      const groups = new Map<string, Operation[]>();
      for (const operation of operations) {
        const separator = operation.id.indexOf(":");
        const id = separator < 0 ? "" : operation.id.slice(0, separator);
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)!.push(operation);
      }
      const next = new Map<string, { operations: Operation[]; index: MatchingCatalog }>();
      for (const [id, group] of groups) {
        const cached = catalogs.get(id);
        if (cached && cached.operations.length === group.length && group.every((operation, index) => cached.operations[index] === operation))
          next.set(id, cached);
        else next.set(id, { operations: group, index: { id, revision: String(++nextRevision),
          prepared: prepareMatchingOperations(group.map(({ id, name }) => ({ id, name }))) } });
      }
      catalogs = next;
      previous = operations;
      const indexes = [...next.values()].map(entry => entry.index);
      snapshot = { catalogs: indexes, byId: new Map(operations.map(operation => [operation.id, operation])),
        revision: JSON.stringify(indexes.map(index => [index.id, index.revision]).sort(([a], [b]) => a!.localeCompare(b!))) };
      return snapshot;
    },
  };
}

/** Install deltas atomically. A crashed or cancelled worker starts with no index. */
export function createMatchingLibrary() {
  let catalogs = new Map<string, MatchingCatalog>();
  let revision: string | undefined;
  let prepared: PreparedMatchingOperation[] = [];
  return {
    configure(updates: MatchingCatalog[], active: string[], version: string) {
      const next = new Map(catalogs);
      for (const update of updates) next.set(update.id, update);
      const entries = active.map(id => {
        const entry = next.get(id);
        if (!entry) throw new Error("The search index is incomplete. Retry matching.");
        return entry;
      });
      catalogs = new Map(entries.map(entry => [entry.id, entry]));
      prepared = entries.flatMap(entry => entry.prepared);
      revision = version;
    },
    read(version: string) {
      if (version !== revision) throw new Error("The search index changed. Retry matching.");
      return prepared;
    },
  };
}
