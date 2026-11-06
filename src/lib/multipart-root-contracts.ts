// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./multipart-root-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
type Value = Record<string, any>;
export const multipartRootSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));
function requireContract(value: unknown, id: string): asserts value {
  if (!value) throw new Error(`Multipart roots require their reviewed native contract (${id}).`);
}
function resolve(input: Value, document: Value): Value {
  if (!input.$ref) return input;
  requireContract(Object.keys(input).length === 1 && typeof input.$ref === "string" && input.$ref.startsWith("#/"), "local reference");
  return input.$ref.slice(2).split("/").reduce((value: Value, key: string) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
}

/** Correct only reviewed malformed roots, without rewriting shared Java schemas
 * or changing the native operation identity and other media alternatives. */
export function bindMultipartRoots(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1, "source identity");
  const [catalog, source] = matches[0]!;
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(operation?.operationId === contract.operationId && operation["x-upstream-multipart-root"] === undefined
      && sameSchemaValue(operation.requestBody, contract.requestBody), id);
    const body = resolve(operation.requestBody, document), media = body?.content?.["multipart/form-data"];
    requireContract(sameSchemaValue(media, contract.media), id + ": media");
    requireContract(sameSchemaValue(resolve(media.schema ?? {}, document), contract.schema), id + ": schema");
    requireContract(operation.parameters === undefined || Array.isArray(operation.parameters), id + ": parameters");
    requireContract(!(operation.parameters ?? []).some((parameter: Value) => parameter?.in === "header" && String(parameter.name).toLowerCase() === "x-atlassian-token"), id + ": XSRF header");
    requireContract((operation.security ?? null) !== null || sameSchemaValue(document.components?.securitySchemes?.basic, source.basic), id + ": authentication");
    return { operation, contract, body };
  });
  for (const { operation, contract, body } of plans) {
    operation["x-upstream-multipart-root"] = { requestBody: structuredClone(operation.requestBody), parameters: structuredClone(operation.parameters ?? null), security: structuredClone(operation.security ?? null) };
    operation.requestBody = { ...structuredClone(body), required: true,
      content: { ...structuredClone(body.content), "multipart/form-data": structuredClone(contract.corrected) } };
    if (catalog !== "cloudflare") {
      operation.parameters = [...(operation.parameters ?? []), { name: "X-Atlassian-Token", in: "header", required: true,
        schema: { type: "string", enum: ["no-check"], default: "no-check" } }];
      if (operation.security === undefined) operation.security = [{ basic: [] }];
    }
  }
}
