// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { CatalogGroup } from "./catalog-registry.ts";

const versionSegment = /^(?:v|ver|version)[._-]?\d+(?:[._-]\d+)*(?:[._-]?(?:alpha|beta|rc)\d*)?$/i;
const parameter = /^\{[^{}]+\}$/;

export function operationResourcePath(path: string): { resources: string[]; endpoint: string; version: string }
{
  const query = path.indexOf("?");
  const parts = (query < 0 ? path : path.slice(0, query)).split("/");
  const versions = parts.filter(part => versionSegment.test(part));
  const resourceParts = parts.filter(part => !versionSegment.test(part));
  return { resources: resourceParts.filter(part => part && !parameter.test(part)),
    endpoint: `${resourceParts.join("/") || "/"}${query < 0 ? "" : path.slice(query)}`,
    version: versions.join(" / ") || "Default" };
}

type Navigation = {
  byId: Map<string, Operation>;
  paths: Map<string, ReturnType<typeof operationResourcePath>>;
  variants: Map<string, Operation[]>;
};
const snapshots = new WeakMap<readonly Operation[], Navigation>();

/** Share descriptor-only navigation across the menu and workflow; queries do not rebuild it. */
export function operationNavigation(operations: readonly Operation[]): Navigation
{
  const cached = snapshots.get(operations);
  if (cached) return cached;
  const paths = new Map<string, ReturnType<typeof operationResourcePath>>();
  const families = new Map<string, Operation[]>();
  for (const operation of operations)
  {
    const path = operationResourcePath(operation.path);
    paths.set(operation.id, path);
    const separator = operation.id.indexOf(":");
    const schema = separator < 0 ? operation.id : operation.id.slice(0, separator);
    const key = JSON.stringify([schema, operation.method, path.endpoint]);
    const family = families.get(key) ?? [];
    family.push(operation);
    families.set(key, family);
  }
  const variants = new Map<string, Operation[]>();
  for (const family of families.values())
  {
    const versioned = new Set(family.map(operation => paths.get(operation.id)!.version)).size > 1;
    for (const operation of family) variants.set(operation.id, versioned ? family : [operation]);
  }
  const result = { byId: new Map(operations.map(operation => [operation.id, operation])), paths, variants };
  snapshots.set(operations, result);
  return result;
}

/** Retain existing headings, then organize their entries by literal URL resources. */
export function operationResourceGroups(groups: readonly CatalogGroup[], navigation: Navigation): CatalogGroup[]
{
  return groups.map(group => {
    const children = operationResourceGroups(group.children ?? [], navigation);
    const root: CatalogGroup = { ...group, operationIds: [], children };
    const branches = new Map<string, CatalogGroup>();
    for (const id of group.operationIds ?? [])
    {
      const resources = navigation.paths.get(id)?.resources;
      if (!resources) continue;
      let parent = root;
      const path: string[] = [];
      for (const name of resources)
      {
        path.push(name);
        const key = JSON.stringify(path);
        let branch = branches.get(key);
        if (!branch)
        {
          branch = { id: `${group.id}:resource:${encodeURIComponent(key)}`, name, description: "", operationIds: [], children: [] };
          branches.set(key, branch);
          parent.children!.push(branch);
        }
        parent = branch;
      }
      parent.operationIds!.push(id);
    }
    return root;
  });
}

/** A version family is one menu action; search can still target a particular version. */
export function navigationOperations(ids: readonly string[], navigation: Navigation, matching: ReadonlyMap<string, number> | null): Operation[]
{
  const result: Operation[] = [];
  const seen = new Set<Operation[]>();
  const available = new Set(ids);
  for (const id of ids)
  {
    const family = navigation.variants.get(id);
    if (!family || seen.has(family)) continue;
    const candidates = family.filter(operation => available.has(operation.id) && (!matching || matching.has(operation.id)));
    if (matching) candidates.sort((left, right) => matching.get(left.id)! - matching.get(right.id)!);
    const selected = candidates.find(operation => !operation.unavailableReason) ?? candidates[0];
    if (selected) { result.push(selected); seen.add(family); }
  }
  return result;
}
