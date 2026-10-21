// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

const absent = Symbol("absent");
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const segment = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
export type SchemaConflict = { path: string; base?: unknown; current?: unknown; incoming?: unknown };
export type SchemaChange = { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown };
export type SchemaResolution = "current" | "incoming";

export function sameSchemaValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => sameSchemaValue(item, right[index]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameSchemaValue(left[key], right[key]));
}

/** Structured three-way merge: arrays are atomic, overlapping edits need a decision. */
export function mergeSchemaDocuments(base: Record<string, unknown>, current: Record<string, unknown>, incoming: Record<string, unknown>,
  resolutions: Record<string, SchemaResolution> = {}): { document: Record<string, unknown>; conflicts: SchemaConflict[] } {
  const conflicts: SchemaConflict[] = [];
  function merge(before: unknown, ours: unknown, theirs: unknown, path: string): unknown {
    if (sameSchemaValue(ours, theirs) || sameSchemaValue(before, theirs)) return ours;
    if (sameSchemaValue(before, ours)) return theirs;
    if (object(before) && object(ours) && object(theirs)) {
      const entries: [string, unknown][] = [];
      for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(before)])) {
        const value = merge(Object.hasOwn(before, key) ? before[key] : absent,
          Object.hasOwn(ours, key) ? ours[key] : absent, Object.hasOwn(theirs, key) ? theirs[key] : absent, `${path}/${segment(key)}`);
        if (value !== absent) entries.push([key, value]);
      }
      return Object.fromEntries(entries);
    }
    if (Object.hasOwn(resolutions, path)) {
      if (resolutions[path] === "current") return ours;
      if (resolutions[path] === "incoming") return theirs;
      throw new Error("Choose the current or incoming value for each schema conflict.");
    }
    conflicts.push({ path, ...(before !== absent ? { base: before } : {}),
      ...(ours !== absent ? { current: ours } : {}), ...(theirs !== absent ? { incoming: theirs } : {}) });
    return ours;
  }
  return { document: merge(base, current, incoming, "") as Record<string, unknown>, conflicts };
}

/** Bound the history response; full historical documents stay in immutable Git blobs. */
export function schemaChanges(before: unknown, after: unknown, limit = 200): { changes: SchemaChange[]; truncated: boolean } {
  const changes: SchemaChange[] = [];
  let truncated = false;
  function diff(left: unknown, right: unknown, path: string): void {
    if (sameSchemaValue(left, right)) return;
    if (changes.length >= limit) { truncated = true; return; }
    if (object(left) && object(right)) {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
        diff(Object.hasOwn(left, key) ? left[key] : absent, Object.hasOwn(right, key) ? right[key] : absent, `${path}/${segment(key)}`);
      return;
    }
    changes.push({ path: path || "/", kind: left === absent ? "added" : right === absent ? "removed" : "changed",
      ...(left !== absent ? { before: left } : {}), ...(right !== absent ? { after: right } : {}) });
  }
  diff(before, after, "");
  return { changes, truncated };
}
