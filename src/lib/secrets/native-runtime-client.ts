// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { hydrateOperation } from "../schema-library.ts";
import { catalogForOperation } from "../catalog-registry.ts";
import { VaultError } from "./types.ts";
export async function nativeRuntimeSelection() {
  const operation = await hydrateOperation("codex:account/read"), document = catalogForOperation(operation.id)?.document;
  if (operation.protocol !== "json-rpc" || !document) throw new VaultError("PERMISSION");
  return { operation, document };
}
