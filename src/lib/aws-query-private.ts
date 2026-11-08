// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { PrivateResultContract } from "./credential-results.ts";
import { awsQueryContract, awsQueryContracts, awsQueryHasPrivateOutput, awsQueryModelRevision, awsQueryPrivateInputKeys,
  awsQueryPrivateMapKeys, awsQueryPrivateMember, awsQueryShape, awsQuerySigningProfile, type AwsQueryShape } from "./aws-query.ts";

const referenceSchema = () => ({ anyOf: [{ type: "object", required: ["credentialId", "label"], additionalProperties: false,
  properties: { credentialId: { type: "string", format: "uuid" }, label: { type: "string" } },
  description: "Reference to a value saved in Secrets. The credential itself stays in the vault." }, { type: "null" }] });
/** SDK structure identities also classify recursive output and named map keys.
 * A finite static path list cannot classify these shapes at arbitrary depth. */
export function awsQueryPrivateProfile(operation: Pick<Operation, "id" | "method" | "path" | "awsQuery">): PrivateResultContract | undefined {
  if (operation.awsQuery !== awsQuerySigningProfile) return;
  const contract = awsQueryContract(operation);
  if (!contract || !awsQueryHasPrivateOutput(operation)) return;
  return { catalog: contract.catalog, method: operation.method, path: operation.path, responses: [],
    privateInputs: awsQueryPrivateInputKeys(operation), masked: true, exampleOnly: false,
    awsQuery: { id: operation.id, revision: awsQueryModelRevision } };
}
/** Separate output components preserve shared input schemas and represent
 * recursive containers without expanding them or replacing public metadata. */
export function projectAwsQueryResponse(document: Record<string, any>, catalog: string, output: string): Record<string, unknown> {
  const source = awsQueryContracts().sources[catalog]!;
  document.components ??= {}; document.components.schemas ??= {};
  const components = document.components.schemas as Record<string, unknown>;
  const prefix = "OperationsAwsQuery_";
  const reference = (name: string) => ({ $ref: "#/components/schemas/" + prefix + name });
  function include(name: string): void {
    const key = prefix + name;
    if (Object.hasOwn(components, key)) return;
    const shape = awsQueryShape(source, { shape: name });
    // Reserve before walking children so recursive SDK references stay finite.
    components[key] = {};
    function child(member: AwsQueryShape): Record<string, unknown> {
      if (!member.shape) throw new Error("A private AWS Query output member has no SDK shape.");
      include(member.shape); return reference(member.shape);
    }
    let schema: Record<string, unknown>;
    if (shape.type === "structure") schema = { type: "object", additionalProperties: false,
      properties: Object.fromEntries(Object.entries(shape.members ?? {}).map(([member, value]) => [member,
        awsQueryPrivateMember(catalog, name, member) ? referenceSchema() : child(value)])),
      ...(shape.required ? { required: [...shape.required] } : {}) };
    else if (shape.type === "list" && shape.member) schema = { type: "array", items: child(shape.member),
      ...(shape.min !== undefined ? { minItems: shape.min } : {}), ...(shape.max !== undefined ? { maxItems: shape.max } : {}) };
    else if (shape.type === "map" && shape.value) schema = { type: "object",
      additionalProperties: awsQueryPrivateMapKeys(catalog, name).includes("*") ? referenceSchema() : child(shape.value),
      properties: Object.fromEntries(awsQueryPrivateMapKeys(catalog, name).filter(key => key !== "*").map(key => [key, referenceSchema()])),
      ...(shape.min !== undefined ? { minProperties: shape.min } : {}), ...(shape.max !== undefined ? { maxProperties: shape.max } : {}) };
    else if (shape.type === "boolean") schema = { type: "boolean" };
    else if (["integer", "long", "float", "double"].includes(shape.type ?? "")) schema = { type: ["integer", "long"].includes(shape.type!) ? "integer" : "number" };
    else if (shape.type === "timestamp") schema = { type: "string", format: "date-time" };
    else if (shape.type === "blob") schema = { type: "string", format: "byte" };
    else if (shape.type === "string") schema = { type: "string", ...(shape.enum ? { enum: [...shape.enum] } : {}) };
    else throw new Error("A private AWS Query output uses an unknown SDK shape.");
    components[key] = schema;
  }
  include(output); return reference(output);
}
