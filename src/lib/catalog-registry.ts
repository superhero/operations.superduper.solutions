// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import demo from "../catalogs/demo.openapi.json" with { type: "json" };
import demoGroups from "../catalogs/demo.groups.json" with { type: "json" };
import httpbin from "../catalogs/httpbin.openapi.json" with { type: "json" };
import httpbinGroups from "../catalogs/httpbin.groups.json" with { type: "json" };

export type CatalogGroup = {
  id: string;
  name: string;
  description: string;
  operationIds?: string[];
  children?: CatalogGroup[];
};

export type Catalog = {
  id: "demo" | "httpbin";
  file: string;
  name: string;
  document: Record<string, unknown>;
  groups: CatalogGroup[];
  execution: { kind: "mock" | "http"; origin: string };
};

/** Source schemas, navigation and execution routes share the same registration. */
export const catalogs: readonly Catalog[] = [
  {
    id: "demo", file: "demo.openapi.json", name: demo.info.title, document: demo, groups: demoGroups,
    execution: { kind: "mock", origin: "https://example.com" }
  },
  {
    id: "httpbin", file: "httpbin.openapi.json", name: httpbin.info.title, document: httpbin, groups: httpbinGroups,
    execution: { kind: "http", origin: "https://httpbin.org" }
  }
];

export function catalogForOperation(operationId: string): Catalog | undefined {
  return catalogs.find(catalog => operationId.startsWith(`${catalog.id}:`));
}
