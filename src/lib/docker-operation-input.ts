// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import { prepareRequest, InputValidationError, type InputValues } from "./operation-input.ts";
import { dockerNativeAttachOperationId, dockerNativePath, dockerNativeProfile, dockerReadParams,
  dockerAttachParams, dockerAttachReadPath, isDockerReadOperation } from "./docker-native-contract.ts";

export function prepareDockerReadRequest(operation: Operation, values: InputValues) {
  const attach = operation.id === dockerNativeAttachOperationId;
  if (!isDockerReadOperation(operation.id) || operation.dockerNative?.profile !== dockerNativeProfile || operation.method !== "GET"
    || operation.path !== (attach ? "/containers/{id}/attach/ws" : "/containers/json"))
    throw new Error("This operation has no reviewed Docker socket route.");
  for (const key of Object.keys(values)) if (!operation.fields.some(field => field.key === key)) throw new InputValidationError(key, "Unsupported Docker parameter.");
  const input = { ...values };
  if (attach && typeof input["path:id"] === "string" && input["path:id"].startsWith("/")) input["path:id"] = input["path:id"].slice(1);
  const request = { ...prepareRequest(operation, input), path: dockerNativePath };
  if (request.body !== undefined || Object.keys(request.headers ?? {}).length) throw new InputValidationError("query:filters", "This Docker read does not accept a body or custom headers.");
  if (attach) {
    try {
      const params = dockerAttachParams({ ...request.query, id: input["path:id"] });
      request.path = dockerAttachReadPath(params).split("?", 1)[0]!;
      request.query = params;
      return request;
    } catch { throw new InputValidationError("path:id", "Use a container ID/name, Boolean output flags and optional detach keys. Stdin is not authorized."); }
  }
  try { dockerReadParams(request.query); }
  catch { throw new InputValidationError(request.query.limit !== undefined && (!Number.isSafeInteger(request.query.limit)
    || Number(request.query.limit) < -2147483648 || Number(request.query.limit) > 2147483647) ? "query:limit" : "query:filters",
    "Docker native access accepts Boolean flags, a 32-bit integer limit and JSON filters whose values are arrays of strings."); }
  return request;
}
