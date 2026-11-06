// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { awsRestContract, awsRestContracts, awsRestEndpoint, awsRestRoot } from "./aws-rest.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";

function invalid(): never { throw new WorkflowBodyError("CODEC"); }
const header = (headers: Record<string, string> | undefined, name: string) =>
  Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
const label = (value: string | undefined): string => {
  if (!value || value.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value)) invalid();
  return value;
};
/** Only the pinned Outposts ARN grammar may change the service and URI labels. */
export function prepareAwsRestOutpost(operation: Operation, request: PreparedRequest): PreparedRequest {
  const contract = awsRestContract(operation);
  if (contract?.catalog !== "aws-s3control") return request;
  if (operation.id === "aws-s3control:CreateBucket") {
    const id = header(request.headers, "x-amz-outpost-id");
    if (!id || id.length > 64 || !/^op-[a-z0-9]+$/.test(id)
      || header(request.headers, "x-amz-account-id") || request.awsRestOutpost) invalid();
    return request;
  }
  const source = awsRestContracts().sources[contract.catalog]!, root = awsRestRoot(source, contract.input, contract.inputTraits);
  let routing: PreparedRequest["awsRestOutpost"], path = request.path, body = request.body;
  const account = header(request.headers, "x-amz-account-id");
  function arn(value: string, resource: "bucket" | "accesspoint"): string {
    const match = /^arn:aws:s3-outposts:([a-z]{2}(?:-[a-z]+)+-\d+):(\d{12}):outpost[/:](op-[a-z0-9]+)[/:](bucket|accesspoint)[/:]([a-z0-9][a-z0-9-]*[a-z0-9])$/.exec(value);
    if (!match || match[4] !== resource || match[2] !== account) invalid();
    const next = { region: match[1]!, account: match[2]!, id: match[3]! };
    if (routing && JSON.stringify(routing) !== JSON.stringify(next)) invalid();
    routing = next; return label(match[5]);
  }
  const template = contract.wirePath ?? contract.path;
  const names = [...template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!);
  const expression = template.split(/\{[^{}]+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([^/]+)");
  const matched = new RegExp("^" + expression + "$").exec(path); if (!matched) invalid();
  for (let index = 0; index < names.length; index++) {
    const field = Object.entries(root.members ?? {}).find(([name, member]) => member.location === "uri" && (member.locationName ?? name) === names[index]);
    if (!field || !["Bucket", "Name"].includes(field[0])) continue;
    let value: string; try { value = decodeURIComponent(matched[index+1]!); } catch { invalid(); }
    if (value.startsWith("arn:")) path = path.replace(matched[index+1]!, encodeURIComponent(arn(value, field[0] === "Bucket" ? "bucket" : "accesspoint")));
  }
  if (operation.id === "aws-s3control:CreateAccessPoint" && body && typeof body === "object" && !Array.isArray(body)
    && typeof body.Bucket === "string" && body.Bucket.startsWith("arn:")) body = { ...body, Bucket: arn(body.Bucket, "bucket") };
  if (operation.id === "aws-s3control:ListRegionalBuckets") {
    const id = header(request.headers, "x-amz-outpost-id");
    if (id) { if (!/^op-[a-z0-9]+$/.test(id) || !account) invalid(); routing = { region: "", account, id }; }
  }
  const headers = { ...request.headers };
  if (routing) {
    const present = header(headers, "x-amz-outpost-id"); if (present && present !== routing.id) invalid();
    headers["x-amz-outpost-id"] = routing.id;
  }
  return { ...request, path, ...(body !== undefined ? { body } : {}), headers, ...(routing ? { awsRestOutpost: routing } : {}) };
}
/** Match official SDK host-prefix/custom endpoint rules inside the approved AWS region. */
export function awsRestTarget(operation: Operation, origin: string, request: PreparedRequest): { url: URL; signing: {service: string; region: string} } {
  const signing = awsRestEndpoint(origin, operation); if (!signing) invalid();
  const contract = awsRestContract(operation)!, url = new URL(origin);
  if (contract.catalog === "aws-s3control") {
    const account = header(request.headers, "x-amz-account-id");
    if (operation.id === "aws-s3control:CreateBucket") {
      prepareAwsRestOutpost(operation, request);
      url.hostname = `s3-outposts.${signing.region}.amazonaws.com`; signing.service = "s3-outposts";
    } else if (!account || !/^\d{12}$/.test(account)) invalid();
    else if (request.awsRestOutpost) {
      const route = request.awsRestOutpost;
      if (route.account !== account || route.region && route.region !== signing.region || !/^op-[a-z0-9]+$/.test(route.id)) invalid();
      url.hostname = `s3-outposts.${signing.region}.amazonaws.com`; signing.service = "s3-outposts";
    } else url.hostname = label(account) + "." + url.hostname;
  } else if (operation.id === "aws-s3:WriteGetObjectResponse") {
    url.hostname = `${label(header(request.headers, "x-amz-request-route"))}.s3-object-lambda.${signing.region}.amazonaws.com`;
    signing.service = "s3-object-lambda";
  }
  // The caller validates concrete paths before signing, including S3 greedy keys.
  const target = new URL(url.origin + request.path);
  if (target.origin !== url.origin || target.hash || target.search) invalid();
  return { url: target, signing };
}
