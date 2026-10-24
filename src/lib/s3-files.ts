// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputField, InputSchema, Operation } from "./catalog.ts";
import { awsSigningRegionSupported } from "./aws-signing.ts";

export type S3FilesProfile = "get-object" | "put-object";
export const s3SourceSha256 = "2c1283af457c374eea21b36eda33edbebd1d331b8954dff16c332d22881d212d";
export const s3SigningProfile = "s3-object";
export const s3ObjectPathTemplate = "/{Bucket}/{Key}";
const encoder = new TextEncoder();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
export function s3FilesProfile(value: unknown): S3FilesProfile | undefined {
  if (value === undefined) return;
  if (value === "get-object" || value === "put-object") return value;
  throw new Error("This S3 object transfer profile is not supported.");
}
export function validateS3Bucket(bucket: string): string {
  if (bucket.length < 3 || bucket.length > 63 || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || /^\d+\.\d+\.\d+\.\d+$/.test(bucket) || /^(?:xn--|sthree-|amzn-s3-demo-)/.test(bucket)
    || /(?:-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3)$/.test(bucket)) throw new Error("Use a supported general-purpose S3 bucket name.");
  return bucket;
}
export function encodeS3Key(key: string): string {
  if (!key || encoder.encode(key).byteLength > 1024 || /[\u0000-\u001f\u007f]/.test(key)
    || key.split("/").some(segment => segment === "." || segment === ".."))
    throw new Error("S3 keys must be 1–1024 UTF-8 bytes without control characters or standalone dot segments.");
  return key.split("/").map(encode).join("/");
}
export function s3SigningEndpoint(origin: string): { region: string; style: "path" | "virtual"; bucket?: string } | undefined {
  try {
    const url = new URL(origin), match = /^(?:([a-z0-9][a-z0-9-]*[a-z0-9])\.)?s3\.([a-z0-9-]+)\.amazonaws\.com$/.exec(url.hostname);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || !match || !awsSigningRegionSupported(match[2]!)) return;
    if (match[1]) validateS3Bucket(match[1]);
    return { region: match[2]!, style: match[1] ? "virtual" : "path", ...(match[1] ? { bucket: match[1] } : {}) };
  } catch { return; }
}
export function s3ObjectUrl(origin: string, preparedPath: string): URL {
  const endpoint = s3SigningEndpoint(origin);
  const match = /^\/([^/]+)\/([\s\S]*)$/.exec(preparedPath);
  if (!endpoint || !match) throw new Error("Use an explicit HTTPS S3 regional endpoint and object path.");
  const bucket = validateS3Bucket(match[1]!); let key: string;
  try { key = decodeURIComponent(match[2]!); } catch { throw new Error("Invalid S3 key encoding."); }
  if (encodeS3Key(key) !== match[2] || endpoint.bucket && endpoint.bucket !== bucket) throw new Error("The S3 bucket or object key does not match this endpoint.");
  const path = endpoint.style === "virtual" ? "/" + match[2] : "/" + bucket + "/" + match[2];
  const url = new URL(origin + path);
  if (url.origin !== new URL(origin).origin || url.pathname !== path) throw new Error("The browser cannot preserve this S3 object path.");
  return url;
}
export function s3MetadataHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("S3 metadata must be an object of ASCII strings.");
  const result: Record<string, string> = Object.create(null); let size = 0;
  for (const [key, item] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) || typeof item !== "string" || /[^\x20-\x7e]/.test(item)
      || Object.hasOwn(result, "x-amz-meta-" + name)) throw new Error("S3 metadata needs unique header-safe names and printable ASCII values.");
    size += encoder.encode(name + item).byteLength;
    if (size > 2048 || Object.keys(result).length >= 32) throw new Error("S3 metadata must fit within 2 KiB and 32 entries.");
    result["x-amz-meta-" + name] = item;
  }
  return result;
}
const field = (name: string, location: InputField["location"], schema: InputSchema, required = false, label = name): InputField =>
  ({ ...schema, key: `${location}:${name}`, name, label, description: "", location, required, schema });
const text: InputSchema = { type: "string", maxLength: 1024 };
export function configureS3Files(operation: Operation, profile: S3FilesProfile): void {
  if (operation.path !== s3ObjectPathTemplate || operation.method !== (profile === "get-object" ? "GET" : "PUT")) throw new Error("S3 files require the reviewed GetObject or PutObject method and path.");
  operation.s3Files = profile;
  operation.fields = [field("Bucket", "path", { type: "string", minLength: 3, maxLength: 63 }, true),
    field("Key", "path", { type: "string", minLength: 1, maxLength: 1024 }, true)];
  delete operation.bodyMediaType; delete operation.bodySchema; delete operation.bodyValue; delete operation.binaryMediaTypes;
  operation.bodyRequired = profile === "put-object";
  operation.responseMediaType = profile === "get-object" ? "application/octet-stream" : "text/plain";
  delete operation.responseContent;
  if (profile === "get-object") {
    operation.fields.push(field("versionId", "query", text), field("If-Match", "header", text));
    operation.responseContent = { "200": { "application/octet-stream": "binary" } };
  } else {
    const file: InputSchema = { type: "string", format: "binary", maxLength: 500000 };
    operation.bodyMediaType = "application/octet-stream"; operation.bodySchema = file; operation.bodyValue = true;
    operation.binaryMediaTypes = ["application/octet-stream"];
    operation.fields.push(field("$", "body", file, true, "Object data"),
      ...["Cache-Control", "Content-Disposition", "Content-Language"].map(name => field(name, "header", text)),
      field("If-None-Match", "header", { type: "string", enum: ["*"] }),
      field("x-amz-meta-", "header", { type: "object", properties: {}, additionalProperties: { type: "string", maxLength: 2048 } }, false, "Metadata"));
  }
}
/** Reject forged or stale logical models before a signer sees any credentials. */
export function validS3FilesModel(operation: Operation): boolean {
  const profile = s3FilesProfile(operation.s3Files); if (!profile || operation.responseStream || operation.privatePath || operation.cloudflareUpload || operation.credentialResult) return false;
  const expected = { ...operation }; configureS3Files(expected, profile);
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, item]) => [name, sorted(item)])) : value;
  for (const key of ["fields", "bodyRequired", "bodyMediaType", "bodySchema", "bodyValue", "binaryMediaTypes", "responseMediaType", "responseContent"] as const)
    if (JSON.stringify(sorted(operation[key])) !== JSON.stringify(sorted(expected[key]))) return false;
  const options = operation.security;
  return options?.length === 1 && options[0]?.length === 1 && options[0][0]?.kind === "aws-sigv4" && options[0][0].profile === s3SigningProfile;
}
