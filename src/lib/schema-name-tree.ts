// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { schemaNameParts } from "./catalog-hierarchy.ts";

export type SchemaNameNode<T> =
  | { kind: "schema"; id: string; name: string; record: T }
  | { kind: "group"; id: string; name: string; path: string[]; children: SchemaNameNode<T>[] };

/** Settings folders depend only on name prefixes, never on enabled operations. */
export function schemaNameTree<T extends { id: string; summary: { name: string } }>(records: readonly T[]): SchemaNameNode<T>[] {
  const roots: SchemaNameNode<T>[] = [];
  const groups = new Map<string, Extract<SchemaNameNode<T>, { kind: "group" }>>();
  for (const record of records) {
    const parts = schemaNameParts(record.summary.name);
    let children = roots;
    for (let depth = 1; depth < parts.length; depth++) {
      const path = parts.slice(0, depth);
      const id = JSON.stringify(path);
      let group = groups.get(id);
      if (!group) {
        group = { kind: "group", id, name: path.at(-1)!, path, children: [] };
        groups.set(id, group);
        children.push(group);
      }
      children = group.children;
    }
    children.push({ kind: "schema", id: record.id, name: parts.at(-1)!, record });
  }
  function order(nodes: SchemaNameNode<T>[]) {
    nodes.sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" })
      || (left.kind === right.kind ? left.id.localeCompare(right.id) : left.kind === "schema" ? -1 : 1));
    for (const node of nodes) if (node.kind === "group") order(node.children);
  }
  order(roots);
  return roots;
}
