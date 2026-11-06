// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** One documented EFS GET body, not a general HTTP proxy. Regions match the
 * pinned native EFS source; OP-035 tests compare them with that source. */
export const awsGetBodyProfile = "aws-efs-account-preferences-v1";
export const awsGetBodyOperation = "aws-elasticfilesystem:DescribeAccountPreferences";
export const awsGetBodyPath = "/2015-02-01/account-preferences";
export const awsGetBodyRegions = ["us-east-1", "us-east-2", "us-west-1", "us-west-2", "us-gov-west-1", "us-gov-east-1",
  "ca-central-1", "eu-north-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-south-1", "af-south-1",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-southeast-1", "ap-southeast-2", "ap-east-1", "ap-south-1", "sa-east-1", "me-south-1"] as const;
export const awsGetBodyLimit = 4096, awsGetBodyResponseLimit = 1024 * 1024;
export function awsGetBodyRegion(address: string): string {
  const url = new URL(address);
  const region = awsGetBodyRegions.find(region => address === "https://elasticfilesystem." + region + ".amazonaws.com" + awsGetBodyPath);
  if (!region || url.search || url.hash || url.username || url.password) throw new Error("Unsupported EFS GET destination.");
  return region;
}
export function awsGetBodyInput(body: unknown): string {
  if (typeof body !== "string" || new TextEncoder().encode(body).length > awsGetBodyLimit) throw new Error("Invalid EFS GET body.");
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["MaxResults", "NextToken"].includes(key))) throw new Error("Invalid EFS GET body.");
  const input = value as Record<string, unknown>;
  if (input.MaxResults !== undefined && (!Number.isSafeInteger(input.MaxResults) || (input.MaxResults as number) < 1)
    || input.NextToken !== undefined && (typeof input.NextToken !== "string" || input.NextToken.length < 1 || input.NextToken.length > 128
      || !/.+/u.test(input.NextToken))) throw new Error("Invalid EFS GET body.");
  return body;
}
