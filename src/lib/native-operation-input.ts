// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { JsonValue, Operation } from "./catalog.ts";
import { InputValidationError, validateInputValue, type InputValues } from "./operation-input.ts";
import { isNativeWorkflowMethod, nativeWorkflowParams, type NativeRequest } from "./native-agent-contract.ts";
import { nativeRuntimeVersion } from "./native-runtime-contract.ts";

export function prepareNativeRequest(operation: Operation, values: InputValues): NativeRequest {
  const method = operation.rpc?.method;
  if (operation.protocol !== "json-rpc" || operation.rpc?.version !== nativeRuntimeVersion || !isNativeWorkflowMethod(method)) throw new Error("Unsupported native workflow method.");
  const params: Record<string, unknown> = {};
  for (const name of Object.keys(values)) if (!operation.fields.some(field => field.key === name)) throw new InputValidationError(name, "Unsupported native parameter.");
  for (const field of operation.fields) {
    const raw = values[field.key];
    if (raw === undefined) { if (field.required) throw new InputValidationError(field.key, `${field.label} is required.`); continue; }
    let value: JsonValue = raw;
    if (field.type === "array" || field.type === "object" || field.type === "json") {
      try { value = raw === null ? null : JSON.parse(raw); } catch { throw new InputValidationError(field.key, `${field.label}: enter valid JSON.`); }
    }
    validateInputValue(field, value); params[field.name] = value;
  }
  try { return { protocol: "json-rpc", method, params: nativeWorkflowParams(method, params) }; }
  catch { throw new InputValidationError(method === "turn/start" ? "params:input" : "params:model", "The native parameters exceed the supported text workflow contract."); }
}
