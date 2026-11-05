// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import corrections from "./operation-display.json" with { type: "json" };
import type { Operation } from "./catalog.ts";

type Identity = Pick<Operation, "id" | "method" | "path">;
type Correction = { method: string; path: string; name?: string; description?: string };
const entries: Readonly<Record<string, Correction>> = corrections;

/** Keep repaired upstream labels; qualify fallbacks by identity and route. */
export function operationDisplayName(operation: Identity & Pick<Operation, "name">): string
{
  const correction = entries[operation.id];
  return correction?.method === operation.method && correction.path === operation.path
    && (!operation.name.trim() || operation.name.length > 200)
    ? correction.name ?? operation.name : operation.name;
}

/** Workflow synopses stay bounded; canonical operation documentation stays full. */
export function operationDisplayDescription(operation: Identity & Pick<Operation, "description">): string
{
  const correction = entries[operation.id];
  return correction?.method === operation.method && correction.path === operation.path && operation.description.length > 4000
    ? correction.description ?? operation.description : operation.description;
}
