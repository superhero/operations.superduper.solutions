// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export const trelloParameterSourceSha256 = "567720e9a207a5fb8cc910ebf5457bf76594d0119a8c4a30af83bf57074e1b26";
export const trelloArrayPaths = ["/cards/{id}/attachments/{idAttachment}",
  "/enterprises/{id}/organizations/bulk/{idOrganizations}",
  "/enterprises/{id}/transferrable/bulk/{idOrganizations}"] as const;

/** The bulk routes explicitly accept organization IDs, rather than serialized
 * Organization resources. Keep the original item declarations for inspection. */
export function bindTrelloParameterArrays(document: Record<string, any>): void {
  const requireContract = (valid: unknown): void => {
    if (!valid) throw new Error("Trello parameter arrays require the reviewed source contract.");
  };
  requireContract(document.openapi === "3.0.0" && document.info?.version === "0.0.1"
    && document.info?.title === "Trello REST API"
    && document.components?.schemas?.TrelloID?.type === "string"
    && document.components.schemas.TrelloID.pattern === "^[0-9a-fA-F]{24}$");
  const plans = trelloArrayPaths.map((path, index) => {
    const operation = document.paths?.[path]?.get;
    const name = index === 0 ? "fields" : "idOrganizations";
    const parameters = operation?.parameters?.filter((parameter: any) => parameter.name === name && parameter.in === (index === 0 ? "query" : "path"));
    requireContract(operation?.operationId === `GET ${path}` && parameters?.length === 1);
    const parameter = parameters[0], ref = `#/components/schemas/${index === 0 ? "AttachmentFields" : "Organization"}`;
    requireContract(parameter.schema?.type === "array" && operation["x-upstream-array-items"] === undefined
      && JSON.stringify(parameter.schema.items) === JSON.stringify({ anyOf: [{ $ref: ref }] }));
    return { operation, parameter, items: { $ref: `#/components/schemas/${index === 0 ? "AttachmentFields" : "TrelloID"}` } };
  });
  for (const { operation, parameter, items } of plans) {
    operation["x-upstream-array-items"] = { name: parameter.name, items: structuredClone(parameter.schema.items) };
    parameter.schema.items = items;
  }
}
