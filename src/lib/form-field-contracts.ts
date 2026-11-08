// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./form-field-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
type Value = Record<string, any>;
export const formFieldSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));
function requireContract(condition: unknown, context: string): asserts condition {
  if (!condition) throw new Error(`Form fields require their reviewed native contract (${context}).`);
}
function resolve(input: Value, document: Value): Value {
  if (!input.$ref) return input;
  requireContract(Object.keys(input).length === 1 && input.$ref.startsWith("#/"), "local reference");
  return input.$ref.slice(2).split("/").reduce((parent: Value, key: string) => parent?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
}
/** Provider serializers determine these field representations. Unknown forms
 * retain their existing capability guards; original bodies remain reviewable. */
export function bindFormFields(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1, "source identity");
  const [catalog] = matches[0]!;
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const item = document.paths?.[contract.path] ?? document.paths?.[contract.canonicalPath];
    const operation = item?.[contract.method.toLowerCase()];
    requireContract(operation?.operationId === contract.operationId && operation["x-upstream-form-field-body"] === undefined
      && sameSchemaValue(operation.requestBody, contract.requestBody), id);
    const body = resolve(operation.requestBody, document), media = body?.content?.[contract.mediaType];
    requireContract(media && sameSchemaValue(resolve(media.schema, document), contract.schema), id + ": fields");
    return { operation, contract };
  });
  for (const { operation, contract } of plans) {
    operation["x-upstream-form-field-body"] = structuredClone(operation.requestBody);
    operation.requestBody = structuredClone(contract.corrected);
  }
}
