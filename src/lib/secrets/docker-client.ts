// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { hydrateOperation } from "../schema-library.ts";
import { catalogForOperation } from "../catalog-registry.ts";
import { operationForId, type Operation } from "../catalog.ts";
import { prepareDockerReadRequest } from "../docker-operation-input.ts";
import type { InputValues } from "../operation-input.ts";
import { dockerNativeOperationId } from "../docker-native-contract.ts";
import { approvedDockerOperation } from "./docker-policy.ts";
import { validateDockerBinding, type DockerBinding } from "./docker-config.ts";
import { VaultError } from "./types.ts";

export async function dockerHostSelection() {
  const operation = await hydrateOperation(dockerNativeOperationId), document = catalogForOperation(operation.id)?.document;
  if (!operation.dockerNative || !document) throw new VaultError("PERMISSION"); return { operation, document };
}
export async function executeDockerWorkflow(operation: Operation, values: InputValues, input: DockerBinding, signal?: AbortSignal) {
  const binding = validateDockerBinding(input), canonical = operationForId(operation.id);
  if (!canonical?.dockerNative || canonical.id !== dockerNativeOperationId || canonical.unavailableReason) throw new VaultError("PERMISSION");
  prepareDockerReadRequest(canonical, values);
  const selection = await dockerHostSelection(), descriptor = await approvedDockerOperation(selection.operation, selection.document);
  if (binding.fingerprint !== descriptor.fingerprint || canonical !== operationForId(canonical.id)) throw new VaultError("PERMISSION");
  const { vaultCall } = await import("./client.ts");
  return vaultCall("executeDockerRead", [binding, selection, values], signal);
}
