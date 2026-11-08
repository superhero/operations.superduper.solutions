// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeTurnControlMethod } from '../native-turn-control.ts';
import { operationForId, type Operation } from "../catalog.ts";
import type { InputValues } from "../operation-input.ts";
import { prepareNativeRequest } from "../native-operation-input.ts";
import type { NativeProgressCallback, NativeWorkflowValueCallback } from "../native-agent-contract.ts";
import { validateNativeBinding, type NativeWorkflowBinding } from "./native-runtime-config.ts";
import { nativeOperationSelection, nativeRuntimeSelection, nativeWorkflowSelection, nativeWatchSelection, nativeCommandSelection } from "./native-runtime-client.ts";
import { approvedNativeOperation } from "./native-rpc-policy.ts";
import { VaultError } from "./types.ts";
import { nativeAccountReadMethod } from "../native-account.ts";
import { nativeInitializeMethod } from "../native-initialize.ts";
import { isNativeStandaloneMethod } from "../native-runtime-contract.ts";
import { nativeMcpOAuthMethod } from '../native-mcp-oauth.ts';
import { nativeFeedbackMethod } from "../native-feedback-contract.ts";
import { isNativeCommandMethod } from '../native-command.ts';

export async function executeNativeWorkflow(operation: Operation, values: InputValues, inputBinding: NativeWorkflowBinding,
  signal?: AbortSignal, progress?: NativeProgressCallback, onValue?: NativeWorkflowValueCallback) {
  const binding = validateNativeBinding(inputBinding), canonical = operationForId(operation.id);
  if (!canonical || canonical.protocol !== "json-rpc" || canonical.rpc?.method !== operation.rpc?.method || canonical.unavailableReason) throw new VaultError("PERMISSION");
  const request = prepareNativeRequest(canonical, values), selection = await nativeOperationSelection(request.method);
  const descriptor = await approvedNativeOperation(selection.operation, selection.document);
  if (binding.fingerprint !== descriptor.fingerprint || operationForId(canonical.id) !== canonical) throw new VaultError("PERMISSION");
  const { vaultCall } = await import("./client.ts");
  if (request.method === nativeAccountReadMethod) return vaultCall("executeNativeAccount", [binding.runtime, selection, request.params], signal);
  if (request.method === nativeInitializeMethod) return vaultCall("executeNativeInitialize", [binding.runtime, await nativeRuntimeSelection(), selection, request.params], signal);
  if (request.method === nativeMcpOAuthMethod) return vaultCall('executeNativeMcpOAuth', [binding.runtime, await nativeRuntimeSelection(), selection, request.params,
    request.params.threadId != null ? await nativeWorkflowSelection() : []], signal, undefined, progress);
  if (isNativeStandaloneMethod(request.method)) return vaultCall("executeNativeQuery", [binding.runtime, await nativeRuntimeSelection(), selection, request.params], signal);
  if (request.method === nativeFeedbackMethod) return vaultCall("executeNativeFeedback", [binding.runtime, await nativeRuntimeSelection(), selection, request.params], signal);
  if (isNativeCommandMethod(request.method)) {
    const commands = await nativeCommandSelection(), pairing = await nativeRuntimeSelection();
    return request.method === 'command/exec'
      ? vaultCall('executeNativeCommand', [binding.runtime, pairing, commands, request.params], signal, undefined, progress, undefined, undefined, onValue)
      : vaultCall('controlNativeCommand', [binding.runtime, pairing, commands, request.method, request.params], signal);
  }
  if (request.method === 'fs/watch') return vaultCall('executeNativeWatch', [binding.runtime, await nativeRuntimeSelection(), await nativeWatchSelection(), request.params], signal, undefined, undefined, undefined, onValue);
  if (request.method === 'fs/unwatch') return vaultCall('executeNativeUnwatch', [binding.runtime, await nativeRuntimeSelection(), await nativeWatchSelection(), request.params], signal);
  const selections = await nativeWorkflowSelection();
  if (isNativeTurnControlMethod(request.method)) return vaultCall('controlNativeTurn', [binding.runtime, selections, selection, request.params], signal);
  if (request.method === 'account/gatewayOAuth/cancel') return vaultCall('cancelNativeGatewayLogin', [binding.runtime, selections, selection, request.params], signal);
  if (request.method === 'account/login/cancel') return vaultCall('cancelNativeAccountLogin', [binding.runtime, selections, selection, request.params], signal);
  return vaultCall("executeNativeRuntime", [binding.runtime, selections, selection, request.params], signal, undefined, progress);
}
