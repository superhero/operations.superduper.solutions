// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./gmail-message-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { gmailMessageProfile } from "./gmail-message.ts";
type Value = Record<string, any>;
export const gmailMessageSourceSha256 = data.source.sha256;
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error("Gmail message media requires the reviewed source and Google Discovery contract.");
}
/** The community catalog puts upload media on metadata URLs. Preserve its
 * declarations and keep media uploads as a separate qualified wire choice. */
export function bindGmailMessages(document: Value): void {
  requireContract(document.openapi === data.source.openapi && sameSchemaValue(document.info, data.source.info) && sameSchemaValue(document.servers, data.source.servers));
  for (const [name, schema] of Object.entries(data.schemas)) requireContract(sameSchemaValue(document.components?.schemas?.[name], schema));
  const plans = Object.entries(data.operations).map(([id, contract]) => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(id === `google-gmail:${operation?.operationId}` && operation.servers === undefined && document.paths[contract.path].servers === undefined && sameSchemaValue(operation.requestBody, contract.requestBody)
      && operation["x-upstream-gmail-body"] === undefined && operation["x-operations-gmail-message"] === undefined);
    const declarations = Object.values(contract.requestBody.content);
    requireContract(declarations.every(declaration => sameSchemaValue(declaration, declarations[0])));
    requireContract("/" + contract.discovery.path === contract.path && contract.discovery.httpMethod === contract.method
      && contract.discovery.mediaUpload.protocols.simple.path === "/upload" + contract.path && sameSchemaValue(contract.discovery.mediaUpload.accept, ["message/*"]));
    return { operation, declaration: declarations[0] };
  });
  for (const { operation, declaration } of plans) {
    operation["x-upstream-gmail-body"] = structuredClone(operation.requestBody);
    operation["x-operations-gmail-message"] = gmailMessageProfile;
    operation.requestBody = { required: true, content: { "application/json": structuredClone(declaration) } };
  }
}
