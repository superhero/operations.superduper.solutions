// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./multipart-part-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
type Value = Record<string, any>;
export const multipartPartSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));

/** Retain every upstream representation. The canonical API-key form uses
 * multipart; raw SDP uses an ephemeral-token flow and remains in the source. */
export function bindMultipartParts(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  if (matches.length !== 1) throw new Error("Multipart parts require their reviewed source identity.");
  const [catalog] = matches[0]!;
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    if (!operation || operation.operationId !== contract.operationId || operation["x-upstream-multipart-request-body"] !== undefined
      || !sameSchemaValue(operation.requestBody, contract.requestBody)) throw new Error(`Multipart parts require the reviewed native request body (${id}).`);
    return { operation, contract };
  });
  for (const { operation, contract } of plans) {
    operation["x-upstream-multipart-request-body"] = structuredClone(operation.requestBody);
    const body = structuredClone(operation.requestBody), media = body.content["multipart/form-data"];
    for (const name of contract.filenameParts) media.encoding[name]["x-operations-part-name"] = "filename";
    if (contract.operationId === "pages-deployment-create-deployment") media.encoding.manifest["x-operations-json-text"] = true;
    body.content = { "multipart/form-data": media }; operation.requestBody = body;
  }
}
