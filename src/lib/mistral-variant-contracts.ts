// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import data from "./mistral-variant-contracts.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";
import { mistralVariantProfile } from "./mistral-variant.ts";
type Value = Record<string, any>;
export const mistralVariantSourceSha256 = data.source.sha256;
function requireContract(value: unknown): asserts value {
  if (!value) throw new Error("Mistral variants require their reviewed native source contract.");
}
export function bindMistralVariants(document: Value): void {
  requireContract(document.openapi === data.source.openapi && sameSchemaValue(document.info, data.source.info)
    && sameSchemaValue(document.servers, data.source.servers) && sameSchemaValue(document.security, data.source.security));
  for (const [name, schema] of Object.entries(data.schemas)) requireContract(sameSchemaValue(document.components?.schemas?.[name], schema));
  const resolve = (schema: Value): Value => schema.$ref ? document.components.schemas[schema.$ref.split("/").at(-1)] : schema;
  // Validate every member before applying any operation-local adaptation.
  const plans = Object.values(data.operations).map(contract => {
    const operation = document.paths?.[contract.path]?.[contract.method.toLowerCase()];
    requireContract(document.paths?.[contract.path]?.servers === undefined && sameSchemaValue(operation, contract.source));
    return { contract, operation };
  });
  for (const { contract, operation } of plans) {
    operation["x-upstream-mistral-variant"] = structuredClone(operation);
    operation["x-operations-mistral-variant"] = mistralVariantProfile;
    for (const parameter of operation.parameters ?? []) if (parameter.in === "path" && parameter.schema?.format === "uuid") {
      delete parameter.schema.format;
      parameter.schema.pattern = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
    }
    if (!contract.stream) continue;
    operation["x-operations-response-stream"] = contract.stream;
    const schema = operation.responses["200"].content["text/event-stream"].schema;
    operation.responses["200"].content["application/json"] = { schema: {
      type: "object", additionalProperties: false, required: ["events"],
      properties: { events: { type: "array", minItems: 1, maxItems: 10000, items: structuredClone(schema) } },
    } };
    const mediaType = contract.stream === "mistral-transcription" ? "multipart/form-data" : "application/json";
    const body = operation.requestBody.content[mediaType], root = resolve(body.schema);
    if (contract.stream === "mistral-conversation") {
      requireContract(root.allOf?.length === 2);
      const base = resolve(root.allOf[0]), variant = root.allOf[1];
      body.schema = { ...structuredClone(base), properties: { ...structuredClone(base.properties), stream: structuredClone(variant.properties.stream) } };
      // OpenAPI 3.1 permits these annotation siblings. Inline only the reviewed
      // operation-local references so strict imports retain their full definition.
      for (const [name, property] of Object.entries(body.schema.properties) as [string, Value][]) if (property.$ref) {
        const { $ref: reference, ...annotations } = property;
        requireContract(Object.keys(annotations).every(key => ["title", "description"].includes(key)));
        body.schema.properties[name] = { ...structuredClone(resolve({ $ref: reference })), ...annotations };
      }
    } else {
      // This unused local definition duplicates the component referenced by the field.
      body.schema = structuredClone(root); delete body.schema.$defs;
      body.encoding = { context_bias: { "x-operations-form-style": "repeat" }, timestamp_granularities: { "x-operations-form-style": "repeat" } };
    }
  }
}
