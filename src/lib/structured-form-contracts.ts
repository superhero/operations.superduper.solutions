// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./structured-form-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { gitlabJsonFormProfile } from "./gitlab-form.ts";
type Value = Record<string, any>;
const schemas: Record<string, Value> = data.schemas;
export const structuredFormSources = Object.fromEntries(Object.entries(data.sources).map(([id, source]) => [id, source.sha256]));
function requireContract(condition: unknown, context: string): asserts condition {
  if (!condition) throw new Error(`Structured forms require their reviewed native contract (${context}).`);
}
function resolve(input: Value, document: Value): Value {
  requireContract(input && typeof input === "object" && !Array.isArray(input), "schema object");
  if (!input.$ref) return input;
  requireContract(typeof input.$ref === "string" && input.$ref.startsWith("#/") && Object.keys(input).length === 1, "local reference");
  return input.$ref.slice(2).split("/").reduce((parent: Value, key: string) => parent?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], document);
}
const except = (value: Value, key: string) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
/** Add only the reviewed encodings/JSON representation. Keep every original
 * field schema and representation, and retain a reversible request preimage. */
export function bindStructuredForms(document: Value): void {
  const matches = Object.entries(data.sources).filter(([, source]) => source.title === document.info?.title
    && source.version === document.info?.version && source.openapi === document.openapi);
  requireContract(matches.length === 1, "source identity"); const [catalog] = matches[0]!;
  const plans = Object.entries(data.operations).filter(([, contract]) => contract.catalog === catalog).map(([id, contract]) => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(operation?.operationId === contract.operationId && operation["x-upstream-structured-form"] === undefined
      && operation["x-operations-gitlab-form"] === undefined, id);
    requireContract((operation.requestBody?.$ref ?? null) === contract.requestReference, id + ": request reference");
    const body = resolve(operation.requestBody, document), media = body?.content?.[contract.mediaType];
    requireContract(sameSchemaValue(except(body, "content"), contract.bodyHeader)
      && sameSchemaValue(Object.keys(body.content), contract.mediaTypes) && media?.encoding === undefined
      && (media.schema?.$ref ?? null) === contract.schemaReference, id + ": body declaration");
    const root = resolve(media.schema, document);
    requireContract(sameSchemaValue(except(root, "properties"), contract.root)
      && sameSchemaValue(Object.keys(root.properties ?? {}).sort(), contract.propertyNames), id + ": root shape");
    for (const [name, schema] of Object.entries(contract.fields))
      requireContract(sameSchemaValue(resolve(root.properties[name], document), schemas[schema]), id + ": " + name);
    return { operation, body, media, contract };
  });
  for (const { operation, body, media, contract } of plans) {
    operation["x-upstream-structured-form"] = structuredClone(operation.requestBody);
    operation.requestBody = structuredClone(body);
    if (contract.mode === "json") operation.requestBody.content["application/json"] = structuredClone(media);
    else operation.requestBody.content[contract.mediaType].encoding = structuredClone(contract.encoding);
    if (contract.gitlabJson) operation["x-operations-gitlab-form"] = gitlabJsonFormProfile;
  }
}
