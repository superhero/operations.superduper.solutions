// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { operationForId, type Operation } from "../catalog.ts";
import type { InputValues } from "../operation-input.ts";
import { prepareNativeRequest } from "../native-operation-input.ts";
import type { NativeProgressCallback } from "../native-agent-contract.ts";
import { validateNativeBinding, type NativeWorkflowBinding } from "./native-runtime-config.ts";
import { nativeOperationSelection, nativeWorkflowSelection } from "./native-runtime-client.ts";
import { approvedNativeOperation } from "./native-rpc-policy.ts";
import { VaultError } from "./types.ts";

export async function executeNativeWorkflow(operation: Operation, values: InputValues, inputBinding: NativeWorkflowBinding,
  signal?: AbortSignal, progress?: NativeProgressCallback) {
  const binding = validateNativeBinding(inputBinding), canonical = operationForId(operation.id);
  if (!canonical || canonical.protocol !== "json-rpc" || canonical.rpc?.method !== operation.rpc?.method || canonical.unavailableReason) throw new VaultError("PERMISSION");
  const request = prepareNativeRequest(canonical, values), selection = await nativeOperationSelection(request.method);
  const descriptor = await approvedNativeOperation(selection.operation, selection.document);
  if (binding.fingerprint !== descriptor.fingerprint || operationForId(canonical.id) !== canonical) throw new VaultError("PERMISSION");
  const selections = await nativeWorkflowSelection(), { vaultCall } = await import("./client.ts");
  return vaultCall("executeNativeRuntime", [binding.runtime, selections, selection, request.params], signal, undefined, progress);
}
