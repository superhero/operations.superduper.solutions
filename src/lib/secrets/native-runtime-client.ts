// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { hydrateOperation } from "../schema-library.ts";
import { catalogForOperation } from "../catalog-registry.ts";
import { VaultError } from "./types.ts";
import { nativeAgentMethods } from "../native-agent-contract.ts";
export async function nativeOperationSelection(method: string) {
  const operation = await hydrateOperation("codex:" + method), document = catalogForOperation(operation.id)?.document;
  if (operation.protocol !== "json-rpc" || !document) throw new VaultError("PERMISSION");
  return { operation, document };
}
export async function nativeRuntimeSelection() {
  return nativeOperationSelection("account/read");
}
export const nativeWorkflowSelection = () => Promise.all(nativeAgentMethods.map(method => nativeOperationSelection(method)));
