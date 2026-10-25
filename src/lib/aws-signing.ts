// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";

export const awsRestProfile = "lambda-list-functions";
export const awsSigningHeaders = new Set(["authorization", "x-amz-date", "x-amz-content-sha256", "x-amz-security-token",
  "x-amz-algorithm", "x-amz-credential", "x-amz-signature", "x-amz-signedheaders"]);
const regions = new Set(["us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "eu-north-1", "eu-west-1",
  "eu-west-2", "eu-west-3", "eu-central-1", "eu-south-1", "af-south-1", "ap-northeast-1", "ap-northeast-2",
  "ap-northeast-3", "ap-southeast-1", "ap-southeast-2", "ap-east-1", "ap-south-1", "sa-east-1", "me-south-1"]);
const queries = new Set(["MasterRegion", "FunctionVersion", "Marker", "MaxItems"]);
export const awsSigningRegionSupported = (region: string): boolean => regions.has(region);
export const awsSigningRegions = [...regions];
export function awsSigningMarker(definition: Record<string, unknown>): boolean {
  return ["awsSigv4", "awsS3"].includes(String(definition["x-amazon-apigateway-authtype"]));
}
export function lambdaSigningRegion(origin: string): string | undefined {
  try {
    const url = new URL(origin), match = /^lambda\.([a-z0-9-]+)\.amazonaws\.com$/.exec(url.hostname);
    if (url.protocol === "https:" && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === "/" && match && regions.has(match[1]!)) return match[1];
  } catch { /* An unqualified authority cannot receive a signature. */ }
}
/** Recognize only the representable REST contract; signer-owned fields leave the public form. */
export function lambdaSigningCandidate(operation: Operation): boolean {
  return operation.method === "GET" && operation.path === "/2015-03-31/functions/"
    && !operation.bodyRequired && operation.bodyMediaType === undefined && operation.bodySchema === undefined
    && !operation.privatePath && !operation.cloudflareUpload && !operation.credentialResult
    && operation.fields.every(field => field.location === "query" && queries.has(field.name)
      || field.location === "header" && awsSigningHeaders.has(field.name.toLowerCase()));
}
export function configureAwsSigning(operation: Operation): void {
  if (!lambdaSigningCandidate(operation)) throw new Error("This AWS signing profile requires Lambda ListFunctions without a request body.");
  operation.fields = operation.fields.filter(field => field.location !== "header");
}
export function validAwsSigningModel(operation: Operation): boolean {
  const alternatives = operation.security;
  return lambdaSigningCandidate(operation) && operation.fields.every(field => field.location === "query")
    && operation.responseMediaType === "application/json" && operation.responseStream === undefined
    && alternatives?.length === 1 && alternatives[0]?.length === 1
    && alternatives[0][0]?.kind === "aws-sigv4" && alternatives[0][0].profile === awsRestProfile;
}
