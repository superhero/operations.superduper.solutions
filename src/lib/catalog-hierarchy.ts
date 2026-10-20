// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { CatalogGroup } from "./catalog-registry.ts";

type NameGroup = {
  name: string;
  path: string[];
  schemas: CatalogGroup[];
  children: Map<string, NameGroup>;
};

export function schemaNameParts(name: string): string[] {
  const parts = name.split("/").map(part => part.trim()).filter(Boolean);
  return parts.length ? parts : [name];
}

/** Group schema names without changing source IDs, operation groups or saved order. */
export function catalogHierarchy(schemas: readonly CatalogGroup[]): CatalogGroup[]
{
  const entries = schemas.map(schema => {
    const parts = schemaNameParts(schema.name);
    return { schema, parts };
  });
  const prefixes = new Set(entries.filter(entry => entry.parts.length > 1).map(entry => entry.parts[0]!));
  const roots: NameGroup[] = [];
  const namedRoots = new Map<string, NameGroup>();
  for (const { schema, parts } of entries)
  {
    // Plain labels remain individual rows unless they prefix a slash-separated name.
    if (parts.length === 1 && !prefixes.has(parts[0]!))
    {
      roots.push({ name: parts[0]!, path: parts, schemas: [schema], children: new Map() });
      continue;
    }
    let siblings = namedRoots;
    const path: string[] = [];
    for (const part of parts)
    {
      path.push(part);
      let group = siblings.get(part);
      if (!group)
      {
        group = { name: part, path: [...path], schemas: [], children: new Map() };
        siblings.set(part, group);
        if (path.length === 1) roots.push(group);
      }
      if (path.length === parts.length) group.schemas.push(schema);
      siblings = group.children;
    }
  }

  function branches(siblings: Iterable<NameGroup>): CatalogGroup[]
  {
    return [...siblings].map(group => {
      const children = branches(group.children.values());
      if (group.schemas.length === 1)
      {
        const schema = group.schemas[0]!;
        if (!children.length) return schema.name === group.name ? schema : { ...schema, name: group.name };
        // A schema can also be a prefix, e.g. Confluence / Cloud and Cloud / v1.
        return { ...schema, name: group.name, children: [...(schema.children ?? []), ...children] };
      }
      return { id: `schema-name:${JSON.stringify(group.path)}`, name: group.name, description: "",
        // Identical display names still represent independent, selectable schemas.
        children: [...group.schemas.map(schema => ({ ...schema, name: group.name })), ...children] };
    });
  }
  return branches(roots);
}
