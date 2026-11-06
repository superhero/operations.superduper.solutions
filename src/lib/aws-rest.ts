// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import { decodeAwsRestData, awsRestDataSha256 } from "./aws-rest-data.ts";
import { awsSigningHeaders } from "./aws-signing.ts";

export const awsRestSigningProfile = "aws-rest-v1";
export type AwsRestSigningProfile = typeof awsRestSigningProfile;
/** Source-backed credentials/capability URLs require private result adoption. */
export const awsRestPrivateResultPaths: Record<string, string[]> = {
  "aws-apigateway:CreateApiKey": ["value"],
  "aws-apigateway:GetApiKey": ["value"],
  "aws-apigateway:GetApiKeys": ["items", "*", "value"],
  "aws-apigateway:UpdateApiKey": ["value"],
  "aws-lambda:GetFunction": ["Code", "Location"],
  "aws-lambda:GetLayerVersion": ["Content", "Location"],
};
export function awsRestPrivateInputKeys(operation: Operation): string[] {
  if (operation.awsRest !== awsRestSigningProfile) return [];
  return operation.id === "aws-apigateway:CreateApiKey" ? ["body:value"]
    : operation.id === "aws-s3:HeadObject" ? ["header:x-amz-server-side-encryption-customer-key"] : [];
}
export type AwsRestShape = {
  shape?: string; type?: string; members?: Record<string, AwsRestShape>; member?: AwsRestShape;
  key?: AwsRestShape; value?: AwsRestShape; location?: string; locationName?: string;
  flattened?: boolean; xmlAttribute?: boolean; xmlNamespace?: { uri?: string; prefix?: string };
  timestampFormat?: string; payload?: string; resultWrapper?: string; required?: string[];
  eventstream?: boolean; event?: boolean; eventpayload?: boolean; eventheader?: boolean;
  exception?: boolean; jsonvalue?: boolean;
};
export type AwsRestSource = {
  sha256: string; title: string; version: string; openapi: string;
  endpoint: { url: string; variables: Record<string, { enum?: string[]; default: string }> };
  service: string; protocol: "rest-json" | "rest-xml"; namespace: string | null;
  sdk: { url: string; sha256: string }; shapes: Record<string, AwsRestShape>;
};
export type AwsRestContract = {
  catalog: string; operation: string; nativeMethod: string; method: string;
  nativePath: string; path: string; greedy: string[]; status: number;
  input: string | null; output: string | null;
  inputTraits?: AwsRestShape; outputTraits?: AwsRestShape;
  wireSources?: string[];
};
export type AwsRestContracts = { version: 1; sources: Record<string, AwsRestSource>; operations: Record<string, AwsRestContract> };
let cached: AwsRestContracts | undefined;
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
}
/** Decode once on first qualified AWS use, rather than while loading navigation. */
export function awsRestContracts(): AwsRestContracts {
  if (!cached) {
    const data = decodeAwsRestData() as AwsRestContracts;
    if (data.version !== 1 || Object.keys(data.sources).length !== 14 || Object.keys(data.operations).length !== 658)
      throw new Error("The AWS REST contracts have an unknown revision.");
    freeze(data); cached = data;
  }
  return cached;
}
export function awsRestContract(operation: Pick<Operation, "id" | "method" | "path">): AwsRestContract | undefined {
  const contracts = awsRestContracts(), contract = Object.hasOwn(contracts.operations, operation.id) ? contracts.operations[operation.id] : undefined;
  return contract?.method === operation.method && contract.path === operation.path ? contract : undefined;
}
export function awsRestShape(source: AwsRestSource, reference: AwsRestShape): AwsRestShape {
  if (!reference.shape) return reference;
  const shape = Object.hasOwn(source.shapes, reference.shape) ? source.shapes[reference.shape] : undefined;
  if (!shape) throw new Error("The AWS REST serialization shape is missing.");
  return { ...shape, ...reference };
}
export function awsRestRoot(source: AwsRestSource, shape: string | null, traits?: AwsRestShape): AwsRestShape {
  return shape ? awsRestShape(source, { shape, ...traits }) : { type: "structure", members: {} };
}
export function awsRestPayload(source: AwsRestSource, shape: string | null): AwsRestShape | undefined {
  const root = awsRestRoot(source, shape);
  const member = root.payload ? root.members?.[root.payload] : undefined;
  return member ? awsRestShape(source, member) : undefined;
}
/** Only the pinned HTTPS service authorities can receive these signatures. */
export function awsRestEndpoint(origin: string, operation: Pick<Operation, "id" | "method" | "path">): { service: string; region: string } | undefined {
  const contract = awsRestContract(operation); if (!contract) return;
  const source = awsRestContracts().sources[contract.catalog]!;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    const template = source.endpoint.url;
    if (!template.includes("{")) return origin.replace(/\/$/, "") === template ? { service: source.service, region: "us-east-1" } : undefined;
    for (const region of source.endpoint.variables.region?.enum ?? []) {
      for (const separator of source.endpoint.variables["dash-or-dot"]?.enum ?? ["."]) {
        const candidate = template.replace("{region}", region).replace("{dash-or-dot}", separator);
        if (url.origin === candidate) return { service: source.service, region };
      }
    }
  } catch { /* Unqualified destinations cannot receive credentials. */ }
}
export function configureAwsRest(operation: Operation): void {
  const contract = awsRestContract(operation);
  if (!contract || operation.awsRest !== awsRestSigningProfile || operation.awsWire || operation.s3Files
    || operation.privatePath || operation.cloudflareUpload || operation.responseStream
    || Object.hasOwn(awsRestPrivateResultPaths, operation.id) && (operation.credentialResult !== true || operation.credentialResultProfile !== "private-result-v1"))
    throw new Error("This operation does not match its reviewed AWS REST signing contract.");
  operation.fields = operation.fields.filter(field => field.location !== "header" || !awsSigningHeaders.has(field.name.toLowerCase()));
  operation.awsRestRevision = awsRestDataSha256;
}
export function awsRestUsesS3Keys(operation: Operation): boolean {
  return operation.awsRest === awsRestSigningProfile && awsRestContract(operation)?.catalog === "aws-s3";
}
export function awsRestTransportAccept(operation: Operation): string | undefined {
  if (operation.awsRest !== awsRestSigningProfile) return;
  const contract = awsRestContract(operation); if (!contract) return;
  const source = awsRestContracts().sources[contract.catalog]!, payload = awsRestPayload(source, contract.output);
  return payload?.eventstream ? "application/vnd.amazon.eventstream" : payload?.type === "blob" ? "*/*" : undefined;
}
/** Shape and source approval remain part of the canonical policy fingerprint. */
export function validAwsRestModel(operation: Operation): boolean {
  if (operation.awsRest !== awsRestSigningProfile) return false;
  const contract = awsRestContract(operation); if (!contract) return false;
  const source = awsRestContracts().sources[contract.catalog]!, root = awsRestRoot(source, contract.input, contract.inputTraits);
  if (operation.awsRestRevision !== awsRestDataSha256) return false;
  const expected = { ...operation, fields: [...operation.fields] };
  try { configureAwsRest(expected); } catch { return false; }
  if (expected.fields.length !== operation.fields.length) return false;
  const pathNames = [...operation.path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!);
  if (pathNames.some(name => !operation.fields.some(field => field.location === "path" && field.name === name && field.required))) return false;
  for (const field of operation.fields) {
    if (field.location === "body") continue;
    const location = { path: "uri", query: "querystring", header: "header" }[field.location as "path" | "query" | "header"];
    if (!location || !Object.entries(root.members ?? {}).some(([name, member]) => {
      const resolved = awsRestShape(source, member), wire = member.locationName ?? name;
      return resolved.location === location && (location === "header" ? wire.toLowerCase() === field.name.toLowerCase() : wire === field.name);
    })) return false;
  }
  const alternatives = operation.security;
  return alternatives?.length === 1 && alternatives[0]?.length === 1
    && alternatives[0][0]?.kind === "aws-sigv4" && alternatives[0][0].profile === awsRestSigningProfile;
}
