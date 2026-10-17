// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { CredentialWorkflowExecutor } from "../workflow-execution.ts";

/** The worker correlates requests by call ID and authorizes this call's descriptor and binding. */
export const executeVaultOperation: CredentialWorkflowExecutor = async (descriptor, values, context, signal) => {
  const { vaultCall } = await import("./client.ts");
  return vaultCall("execute", [descriptor, values, context.binding, undefined, context.variables], signal);
};
