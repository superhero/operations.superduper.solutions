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

/** Group schema names without changing source IDs, operation groups or saved order. */
export function catalogHierarchy(schemas: readonly CatalogGroup[]): CatalogGroup[]
{
  const roots = new Map<string, NameGroup>();
  for (const schema of schemas)
  {
    const parts = schema.name.split("/").map(part => part.trim()).filter(Boolean);
    if (!parts.length) parts.push(schema.name);
    let siblings = roots;
    const path: string[] = [];
    for (const part of parts)
    {
      path.push(part);
      let group = siblings.get(part);
      if (!group)
      {
        group = { name: part, path: [...path], schemas: [], children: new Map() };
        siblings.set(part, group);
      }
      if (path.length === parts.length) group.schemas.push(schema);
      siblings = group.children;
    }
  }

  function branches(siblings: Map<string, NameGroup>): CatalogGroup[]
  {
    return [...siblings.values()].map(group => {
      const children = branches(group.children);
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
