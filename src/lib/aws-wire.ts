// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField, InputSchema, Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { awsSigningRegionSupported } from "./aws-signing.ts";

export const awsWireSources = {
  "aws-dynamodb": "edf78af7371e27e8b8440b0587d04830d881d8681558787f406ffdfe713108e0",
  "aws-sts": "57abe7038ef9b4425e87706ef402117db67fa6822947457f49ec1d1abb78b022",
};
export const awsWireSigningProfiles = ["dynamodb-json-1.0", "sts-query-2011-06-15"] as const;
export type AwsWireSigningProfile = typeof awsWireSigningProfiles[number];
export const awsWireContracts = {
  "dynamodb-batch-get-item": { service: "dynamodb", action: "BatchGetItem", profile: "dynamodb-json-1.0", path: "/#X-Amz-Target=DynamoDB_20120810.BatchGetItem" },
  "dynamodb-list-tables": { service: "dynamodb", action: "ListTables", profile: "dynamodb-json-1.0", path: "/#X-Amz-Target=DynamoDB_20120810.ListTables" },
  "sts-get-caller-identity": { service: "sts", action: "GetCallerIdentity", profile: "sts-query-2011-06-15", path: "/#Action=GetCallerIdentity" },
} as const;
export type AwsWireProfile = keyof typeof awsWireContracts;
export function awsWirePath(path: string, method: string, profile: AwsWireProfile): boolean {
  const contract = awsWireContracts[profile];
  return path === contract.path && (contract.service === "sts" ? ["GET", "POST"] : ["POST"]).includes(method);
}
export function awsWireProfile(value: unknown): AwsWireProfile | undefined {
  if (value === undefined) return;
  if (typeof value !== "string" || !Object.hasOwn(awsWireContracts, value)) throw new Error("This AWS wire profile is not supported.");
  return value as AwsWireProfile;
}
export function awsWireEndpoint(origin: string, profile: AwsWireProfile): { service: "dynamodb" | "sts"; region: string } | undefined {
  const contract = awsWireContracts[profile];
  try {
    const url = new URL(origin), match = /^(dynamodb|sts)\.([a-z0-9-]+)\.amazonaws\.com$/.exec(url.hostname);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === "/" && match?.[1] === contract.service && awsSigningRegionSupported(match[2]!))
      return { service: contract.service, region: match[2]! };
  } catch { /* Only a qualified explicit regional authority can receive a signature. */ }
}
const string: InputSchema = { type: "string", maxLength: 65536 };
const stringMap: InputSchema = { type: "object", properties: {}, additionalProperties: string };
const keys: InputSchema = { type: "object", properties: {}, additionalProperties: { type: "json" } };
const requestItems: InputSchema = { type: "object", properties: {}, additionalProperties: { type: "object", required: ["Keys"], additionalProperties: false,
  properties: { Keys: { type: "array", minItems: 1, maxItems: 100, items: keys }, ConsistentRead: { type: "boolean" },
    AttributesToGet: { type: "array", minItems: 1, items: string }, ProjectionExpression: string, ExpressionAttributeNames: stringMap } } };
const field = (name: string, schema: InputSchema, required = false): InputField => {
  const copy = structuredClone(schema);
  return { ...copy, key: "body:" + name, name, label: name, description: "", location: "body", required, schema: copy };
};

/** Keep the source path as identity; prepareAwsWireRequest alone creates the wire URL. */
export function configureAwsWire(operation: Operation, profile: AwsWireProfile): void {
  const contract = awsWireContracts[profile];
  if (!awsWirePath(operation.path, operation.method, profile))
    throw new Error("This AWS wire profile requires its reviewed native method and action identity.");
  operation.awsWire = profile; operation.fields = [];
  for (const key of ["bodyMediaType", "bodySchema", "bodyValue", "binaryMediaTypes", "responseContent"] as const) delete operation[key];
  operation.bodyRequired = contract.service === "dynamodb";
  operation.responseMediaType = "application/json";
  if (contract.service === "dynamodb") {
    operation.fields = profile === "dynamodb-batch-get-item" ? [field("RequestItems", requestItems, true),
      field("ReturnConsumedCapacity", { type: "string", enum: ["INDEXES", "TOTAL", "NONE"] })]
      : [field("ExclusiveStartTableName", { type: "string", minLength: 3, maxLength: 255, pattern: "^[a-zA-Z0-9_.-]+$" }),
        field("Limit", { type: "integer", minimum: 1, maximum: 100 })];
    operation.bodyMediaType = "application/json";
    operation.bodySchema = { type: "object", additionalProperties: false,
      required: operation.fields.filter(item => item.required).map(item => item.name),
      properties: Object.fromEntries(operation.fields.map(item => [item.name, item.schema!])) };
  }
}
export function validAwsWireModel(operation: Operation): boolean {
  const profile = awsWireProfile(operation.awsWire);
  if (!profile || operation.responseStream || operation.s3Files || operation.privatePath || operation.cloudflareUpload || operation.credentialResult) return false;
  const expected = { ...operation };
  try { configureAwsWire(expected, profile); } catch { return false; }
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)])) : value;
  for (const key of ["fields", "bodyRequired", "bodyMediaType", "bodySchema", "bodyValue", "binaryMediaTypes", "responseContent", "responseMediaType"] as const)
    if (JSON.stringify(sorted(operation[key])) !== JSON.stringify(sorted(expected[key]))) return false;
  const options = operation.security;
  return options?.length === 1 && options[0]?.length === 1 && options[0][0]?.kind === "aws-sigv4"
    && options[0][0].profile === awsWireContracts[profile].profile;
}
export function prepareAwsWireRequest(operation: Operation, request: PreparedRequest): PreparedRequest {
  if (!validAwsWireModel(operation)) throw new Error("This AWS wire operation has an invalid or stale profile.");
  const profile = operation.awsWire!, contract = awsWireContracts[profile];
  if (profile === "dynamodb-batch-get-item") {
    const items = (request.body as Record<string, any>).RequestItems;
    if (!Object.keys(items).length || Object.keys(items).length > 100) throw new Error("RequestItems needs one or more tables and at most 100 keys.");
    let count = 0;
    for (const [name, item] of Object.entries(items) as [string, Record<string, any>][]) {
      if (!name || name.length > 1024) throw new Error("RequestItems needs valid table names or ARNs.");
      count += item.Keys.length;
      for (const key of item.Keys) {
        if (!Object.keys(key).length) throw new Error("Each DynamoDB key needs its primary key attributes.");
        for (const value of Object.values(key) as Record<string, unknown>[]) {
          if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1
            || Object.entries(value).some(([tag, text]) => !["S", "N", "B"].includes(tag) || typeof text !== "string" || !text.length
              || tag === "B" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)))
            throw new Error("DynamoDB primary keys require one S, N or base64 B string per attribute.");
        }
      }
    }
    if (count > 100) throw new Error("BatchGetItem supports at most 100 keys per request.");
  }
  if (contract.service === "dynamodb") return { ...request, path: "/", query: {}, contentType: "application/x-amz-json-1.0",
    body: request.body ?? {}, headers: { "X-Amz-Target": "DynamoDB_20120810." + contract.action } };
  const parameters = { Action: "GetCallerIdentity", Version: "2011-06-15" };
  return operation.method === "GET" ? { method: "GET", path: "/", query: parameters }
    : { method: "POST", path: "/", query: {}, body: parameters, contentType: "application/x-www-form-urlencoded" };
}
