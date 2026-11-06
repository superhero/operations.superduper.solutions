// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema, JsonValue, Operation } from "./catalog.ts";
import { awsJsonDataSha256, decodeAwsJsonData } from "./aws-json-data.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";
import privatePolicy from "./aws-json-private-policy.json" with { type: "json" };
import { sameSchemaValue } from "./schema-merge.ts";

export const awsJsonSigningProfile = "aws-json-v1";
export type AwsJsonSigningProfile = typeof awsJsonSigningProfile;
export { awsJsonDataSha256 };
export const awsJsonModelRevision = `${awsJsonDataSha256}:private-${privatePolicy.version}`;
const privateMembers = privatePolicy.members as Record<string, Record<string, string[]>>;
const privateMapKeys = privatePolicy.mapKeys as Record<string, Record<string, string[]>>;
const privateInputNames = new Set(privatePolicy.inputNames);
const privateInputMembers = privatePolicy.inputMembers as Record<string, string[]>;
const privateInput = (catalog: string, name: string) => privateInputNames.has(name) || privateInputMembers[catalog]?.includes(name) === true;
export type AwsJsonShape = {
  shape?: string; type?: string; members?: Record<string, AwsJsonShape>; member?: AwsJsonShape;
  key?: AwsJsonShape; value?: AwsJsonShape; locationName?: string; timestampFormat?: string;
  required?: string[]; min?: number; max?: number; enum?: string[]; pattern?: string; sensitive?: boolean;
};
type Endpoint = { url: string; variables: Record<string, { default: string; enum?: string[] }> };
export type AwsJsonSource = {
  sha256: string; title: string; version: string; openapi: string; endpoints: Endpoint[];
  service: string; endpointPrefix: string; jsonVersion: "1.0" | "1.1"; targetPrefix: string;
  sdk: { url: string; sha256: string }; shapes: Record<string, AwsJsonShape>;
};
export type AwsJsonContract = {
  catalog: string; operation: string; target: string; auth: "sigv4" | "none"; hostPrefix: string;
  input: string | null; output: string | null; bodyRequired: boolean; status: number;
};
export type AwsJsonContracts = { version: 1; sources: Record<string, AwsJsonSource>; operations: Record<string, AwsJsonContract> };
let cached: AwsJsonContracts | undefined;
function freeze(value: unknown): void {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
}
/** Decode only when a reviewed JSON-target operation is used. */
export function awsJsonContracts(): AwsJsonContracts {
  if (!cached) {
    const value = decodeAwsJsonData() as AwsJsonContracts;
    if (value.version !== 1 || Object.keys(value.sources).length !== 28 || Object.keys(value.operations).length !== 1784)
      throw new Error("The AWS JSON target contracts have an unknown revision.");
    freeze(value); cached = value;
  }
  return cached;
}
export function awsJsonContract(operation: Pick<Operation, "id" | "method" | "path">): AwsJsonContract | undefined {
  const data = awsJsonContracts(), contract = Object.hasOwn(data.operations, operation.id) ? data.operations[operation.id] : undefined;
  return contract && operation.method === "POST" && operation.path === "/#X-Amz-Target=" + contract.target ? contract : undefined;
}
export function awsJsonEndpoints(contract: AwsJsonContract): Endpoint[] {
  return awsJsonContracts().sources[contract.catalog]!.endpoints.map(endpoint => ({ ...endpoint,
    url: endpoint.url.replace("https://", "https://" + contract.hostPrefix) }));
}
/** Sign only a pinned HTTPS service authority; source fragment selectors never enter URLs. */
export function awsJsonEndpoint(origin: string, operation: Pick<Operation, "id" | "method" | "path">): { service: string; region: string } | undefined {
  const contract = awsJsonContract(operation); if (!contract) return;
  const source = awsJsonContracts().sources[contract.catalog]!;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return;
    for (const endpoint of awsJsonEndpoints(contract)) {
      const regions = endpoint.variables.region?.enum ?? ["us-east-1"];
      for (const region of regions) {
        const candidate = endpoint.url.replace(/\{([^{}]+)\}/g, (_match, name: string) => name === "region" ? region : endpoint.variables[name]?.default ?? "");
        if (!candidate.includes("{") && url.origin === candidate) return { service: source.service, region };
      }
    }
  } catch { /* Unknown authorities cannot receive AWS signatures or private inputs. */ }
}
export function awsJsonShape(source: Pick<AwsJsonSource, "shapes">, reference: AwsJsonShape): AwsJsonShape {
  if (!reference.shape) return reference;
  const target = Object.hasOwn(source.shapes, reference.shape) ? source.shapes[reference.shape] : undefined;
  if (!target) invalid();
  return { ...target, ...reference };
}
export function awsJsonPrivateMember(catalog: string, shape: string | undefined, member: string): boolean {
  return !!shape && privateMembers[catalog]?.[shape]?.includes(member) === true;
}
export function awsJsonPrivateMapKeys(catalog: string, shape: string | undefined): readonly string[] {
  return shape ? privateMapKeys[catalog]?.[shape] ?? [] : [];
}
function privateDescendant(catalog: string, reference: AwsJsonShape, input: boolean, seen = new Set<string>()): boolean {
  if (reference.shape && seen.has(reference.shape)) return false;
  if (reference.shape) seen.add(reference.shape);
  const source = awsJsonContracts().sources[catalog]!, shape = awsJsonShape(source, reference);
  if (shape.type === "structure") return Object.entries(shape.members ?? {}).some(([name, member]) =>
    (input ? privateInput(catalog, name) : awsJsonPrivateMember(catalog, reference.shape, name)) || privateDescendant(catalog, member, input, seen));
  if (shape.type === "map") return awsJsonPrivateMapKeys(catalog, reference.shape).length > 0
    || !!shape.value && privateDescendant(catalog, shape.value, input, seen);
  return shape.type === "list" && !!shape.member && privateDescendant(catalog, shape.member, input, seen);
}
const privateOutputs = new Map<string, boolean>();
export function awsJsonHasPrivateOutput(operation: Pick<Operation, "id" | "method" | "path">): boolean {
  const contract = awsJsonContract(operation); if (!contract?.output) return false;
  if (!privateOutputs.has(operation.id)) privateOutputs.set(operation.id, privateDescendant(contract.catalog, { shape: contract.output }, false));
  return privateOutputs.get(operation.id)!;
}
export function awsJsonPrivateInputKeys(operation: Pick<Operation, "id" | "method" | "path">): string[] {
  const contract = awsJsonContract(operation); if (!contract?.input) return [];
  const source = awsJsonContracts().sources[contract.catalog]!, root = awsJsonShape(source, { shape: contract.input });
  return Object.entries(root.members ?? {}).filter(([name, member]) => privateInput(contract.catalog, name)
    || privateDescendant(contract.catalog, member, true)).map(([name]) => "body:" + name);
}
function invalid(): never { throw new WorkflowBodyError("CODEC"); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
export const maxAwsJsonBytes = 8 * 1024 * 1024;
function bounded(): (depth: number) => void {
  let nodes = 0;
  return depth => { if (++nodes > 50000 || depth > 48) throw new WorkflowBodyError("LIMIT"); };
}
/** Translate only the AWS pattern annotations already qualified by the REST adapter. */
export function awsJsonPattern(pattern: string): string {
  try { new RegExp(pattern, "u"); return pattern; } catch { /* Translate AWS/Java-only escapes. */ }
  // The pinned SageMaker model double-escapes this character class and puts
  // its length quantifier after $. Its separate min/max traits agree exactly.
  const metadata = "^([\\p{L}\\p{Z}\\p{N}_.:\\/=+\\-@]*)$";
  for (const maximum of [128, 256]) if (pattern === metadata + `{1,${maximum}}`)
    return `^[\\p{L}\\p{Z}\\p{N}_.:/=+\\-@]{1,${maximum}}$`;
  if (pattern === "(?s).*") return "[\\s\\S]*";
  const script = "[sS][cC][rR][iI][pP][tT]";
  const converted = pattern.replace(/^\\A/, "^").replace(/\\z$/, "$(?![\\s\\S])")
    .replaceAll("(?i).*<script>.*</script>.*", `.*<${script}>.*</${script}>.*`)
    .replaceAll("(?i)all", "[aA][lL][lL]")
    .replaceAll("\\p{Z}-_", "\\p{Z}\\-_").replaceAll("\\w- ", "\\w\\- ")
    .replaceAll("(?!\\.)+", "(?!\\.)");
  const classes: Record<string, string> = { Print: "\\x20-\\x7e", Graph: "\\x21-\\x7e", Blank: "\\x09\\x20", Alnum: "A-Za-z0-9", XDigit: "0-9A-Fa-f" };
  let result = "", inClass = false;
  for (let index = 0; index < converted.length; index++) {
    const character = converted[index]!;
    if (character === "\\" && index + 1 < converted.length) {
      const property = /^\\p\{(Print|Graph|Blank|Alnum|XDigit)\}/.exec(converted.slice(index));
      if (property) {
        const characters = classes[property[1]!]!;
        result += inClass ? characters : `[${characters}]`; index += property[0].length - 1; continue;
      }
      const next = converted[++index]!;
      const identity = !/[A-Za-z0-9]/.test(next) && !"^$\\.*+?()[]{}|/".includes(next) && !(next === "-" && inClass);
      result += (identity ? "" : "\\") + next;
    } else {
      if (character === "[") inClass = true; else if (character === "]") inClass = false;
      result += character;
    }
  }
  try { new RegExp(result, "u"); } catch { invalid(); }
  return result;
}
function range(shape: AwsJsonShape, value: number): void {
  if (shape.min !== undefined && value < shape.min || shape.max !== undefined && value > shape.max) invalid();
}
function value(source: AwsJsonSource, reference: AwsJsonShape, input: unknown, reading: boolean,
  visit: (depth: number) => void, depth = 0): JsonValue {
  visit(depth); const shape = awsJsonShape(source, reference);
  if (shape.type === "structure") {
    if (!object(input)) invalid();
    const result: [string, JsonValue][] = [], consumed = new Set<string>();
    for (const [name, member] of Object.entries(shape.members ?? {})) {
      const wire = member.locationName ?? name, key = reading ? wire : Object.hasOwn(input, name) ? name : wire;
      if (!reading && name !== wire && Object.hasOwn(input, name) && Object.hasOwn(input, wire)) invalid();
      if (!Object.hasOwn(input, key)) { if (!reading && shape.required?.includes(name)) invalid(); continue; }
      consumed.add(key);
      result.push([reading ? name : wire, value(source, member, input[key], reading, visit, depth + 1)]);
    }
    if (!reading && Object.keys(input).some(key => !consumed.has(key))) invalid();
    return Object.fromEntries(result);
  }
  if (shape.type === "list") {
    if (!Array.isArray(input) || !shape.member) invalid();
    if (!reading) range(shape, input.length);
    return input.map(item => value(source, shape.member!, item, reading, visit, depth + 1));
  }
  if (shape.type === "map") {
    if (!object(input) || !shape.key || !shape.value) invalid();
    if (!reading) range(shape, Object.keys(input).length);
    return Object.fromEntries(Object.entries(input).map(([key, item]) => {
      value(source, shape.key!, key, reading, visit, depth + 1);
      return [key, value(source, shape.value!, item, reading, visit, depth + 1)];
    }));
  }
  if (shape.type === "timestamp") {
    const date = typeof input === "number" ? new Date(input * 1000) : typeof input === "string" ? new Date(input) : invalid();
    if (!Number.isFinite(date.getTime())) invalid();
    return reading ? date.toISOString() : shape.timestampFormat === "iso8601" ? date.toISOString()
      : shape.timestampFormat === "rfc822" ? date.toUTCString() : date.getTime() / 1000;
  }
  if (shape.type === "boolean") { if (typeof input !== "boolean") invalid(); return input; }
  if (["integer", "long", "float", "double"].includes(shape.type ?? "")) {
    if (typeof input !== "number" || !Number.isFinite(input) || ["integer", "long"].includes(shape.type!) && !Number.isSafeInteger(input)) invalid();
    if (!reading) range(shape, input); return input;
  }
  if (typeof input !== "string" || !input.isWellFormed()) invalid();
  if (shape.type === "blob") {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) invalid();
    let decoded: string; try { decoded = atob(input); if (btoa(decoded) !== input) invalid(); } catch { invalid(); }
    if (!reading) range(shape, decoded.length); return input;
  }
  if (shape.type !== "string") invalid();
  if (!reading) {
    range(shape, input.length);
    if (shape.enum && !shape.enum.includes(input) || shape.pattern && !new RegExp(awsJsonPattern(shape.pattern), "u").test(input)) invalid();
  }
  return input;
}
/** Keep editor schemas finite for recursive SDK structures. The wire codec still
 * validates the complete recursive value and all SDK constraints within its budget. */
export function awsJsonInputSchema(source: Pick<AwsJsonSource, "shapes">, reference: AwsJsonShape, seen = new Set<string>(), depth = 0): InputSchema {
  if (depth > 48 || reference.shape && seen.has(reference.shape)) return { type: "json" };
  const next = new Set(seen); if (reference.shape) next.add(reference.shape);
  const shape = awsJsonShape(source, reference), child = (item: AwsJsonShape) => awsJsonInputSchema(source, item, next, depth + 1);
  if (shape.type === "structure") return { type: "object", properties: Object.fromEntries(Object.entries(shape.members ?? {}).map(([name, member]) => [name, child(member)])),
    additionalProperties: false, ...(shape.required ? { required: [...shape.required] } : {}) };
  if (shape.type === "map") {
    if (!shape.value || !shape.key) invalid();
    return { type: "object", additionalProperties: child(shape.value), propertyNames: child(shape.key),
      ...(shape.min !== undefined ? { minProperties: shape.min } : {}), ...(shape.max !== undefined ? { maxProperties: shape.max } : {}) };
  }
  if (shape.type === "list") {
    if (!shape.member) invalid();
    return { type: "array", items: child(shape.member), ...(shape.min !== undefined ? { minItems: shape.min } : {}), ...(shape.max !== undefined ? { maxItems: shape.max } : {}) };
  }
  if (shape.type === "timestamp" || shape.type === "blob") return { type: "string" };
  if (shape.type === "boolean") return { type: "boolean" };
  if (["integer", "long", "float", "double"].includes(shape.type ?? "")) return { type: ["integer", "long"].includes(shape.type!) ? "integer" : "number",
    ...(shape.min !== undefined ? { minimum: shape.min } : {}), ...(shape.max !== undefined ? { maximum: shape.max } : {}) };
  if (shape.type !== "string") invalid();
  return { type: "string", ...(shape.min !== undefined ? { minLength: shape.min } : {}), ...(shape.max !== undefined ? { maxLength: shape.max } : {}),
    ...(shape.enum ? { enum: [...shape.enum] } : {}), ...(shape.pattern ? { pattern: awsJsonPattern(shape.pattern) } : {}) };
}
/** Native aliases/pagination placeholders are replaced by the pinned SDK input
 * members. Complete upstream declarations remain with the schema patch. */
export function configureAwsJson(operation: Operation): void {
  const contract = awsJsonContract(operation);
  if (!contract || operation.awsJson !== awsJsonSigningProfile || operation.awsWire || operation.awsRest || operation.awsQuery || operation.s3Files
    || operation.privatePath || operation.cloudflareUpload || operation.responseStream || operation.protocol || operation.rpc)
    throw new Error("This operation does not match its reviewed AWS JSON target contract.");
  const source = awsJsonContracts().sources[contract.catalog]!;
  const schema = contract.input ? awsJsonInputSchema(source, { shape: contract.input }) : { type: "object" as const, properties: {}, additionalProperties: false };
  if (schema.type !== "object" || !schema.properties) invalid();
  operation.awsJsonRevision = awsJsonModelRevision;
  operation.bodyRequired = contract.bodyRequired;
  operation.bodyMediaType = "application/json";
  operation.bodySchema = schema;
  operation.responseMediaType = "application/json";
  if (awsJsonHasPrivateOutput(operation)) { operation.credentialResult = true; operation.credentialResultProfile = "private-result-v1"; }
  else if (operation.credentialResult !== undefined || operation.credentialResultProfile !== undefined)
    throw new Error("This AWS JSON target does not have a credential-producing result contract.");
  delete operation.bodyValue; delete operation.binaryMediaTypes;
  operation.fields = Object.entries(schema.properties).map(([name, member]) => {
    const { required: _required, properties: _properties, items: _items, ...scalar } = member;
    return { ...scalar, key: "body:" + name, name, label: name, description: "", location: "body",
      required: schema.required?.includes(name) === true, schema: member };
  });
}
/** Full shape/revision equality is required before a fragment identity can use
 * the reviewed HTTP wire path or carry an AWS signature. */
export function validAwsJsonModel(operation: Operation): boolean {
  const contract = awsJsonContract(operation);
  if (!contract || operation.awsJson !== awsJsonSigningProfile || operation.awsJsonRevision !== awsJsonModelRevision) return false;
  const expected = { ...operation };
  try { configureAwsJson(expected); } catch { return false; }
  for (const key of ["fields", "bodySchema", "bodyRequired", "bodyMediaType", "bodyValue", "binaryMediaTypes", "responseMediaType", "credentialResult", "credentialResultProfile"] as const)
    if (!sameSchemaValue(expected[key], operation[key])) return false;
  if (contract.auth === "none") return operation.security?.length === 0;
  const alternatives = operation.security;
  return alternatives?.length === 1 && alternatives[0]?.length === 1
    && alternatives[0][0]?.name === "hmac" && alternatives[0][0]?.kind === "aws-sigv4"
    && alternatives[0][0].header === "Authorization" && alternatives[0][0].profile === awsJsonSigningProfile;
}
/** These are final wire bytes and protocol-owned headers, before private signing. */
export function awsJsonWireRequest(operation: Pick<Operation, "id" | "method" | "path">, input: unknown) {
  const contract = awsJsonContract(operation); if (!contract) invalid();
  const source = awsJsonContracts().sources[contract.catalog]!;
  const body = contract.input ? value(source, { shape: contract.input }, input ?? {}, false, bounded()) : {};
  if (!contract.input && input !== undefined && (!object(input) || Object.keys(input).length)) invalid();
  const bytes = encoder.encode(JSON.stringify(body)); if (bytes.byteLength > maxAwsJsonBytes) throw new WorkflowBodyError("LIMIT");
  return { method: "POST" as const, path: "/", bytes, requiresSignature: contract.auth === "sigv4",
    headers: { "Content-Type": `application/x-amz-json-${source.jsonVersion}`, "X-Amz-Target": contract.target } };
}
/** Raw results still require the private executor's adoption/redaction before publication. */
export function decodeAwsJsonBody(operation: Pick<Operation, "id" | "method" | "path">, bytes: Uint8Array, headers: Headers, status: number): JsonValue {
  const contract = awsJsonContract(operation); if (!contract) invalid();
  if (bytes.byteLength > maxAwsJsonBytes) throw new WorkflowBodyError("LIMIT");
  const source = awsJsonContracts().sources[contract.catalog]!;
  const media = (headers.get("Content-Type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (media && media !== "application/json" && media !== `application/x-amz-json-${source.jsonVersion}`) throw new WorkflowBodyError("MEDIA");
  let parsed: unknown = {};
  try { if (bytes.length) parsed = JSON.parse(decoder.decode(bytes)); } catch { invalid(); }
  if (!object(parsed)) invalid();
  if (status < 200 || status >= 300) return { Error: Object.fromEntries(["Code", "Message", "Type", "code", "message", "__type"]
    .flatMap(name => typeof parsed[name] === "string" ? [[name, parsed[name] as string]] : [])) };
  if (!contract.output) { if (Object.keys(parsed).length) invalid(); return null; }
  if (!bytes.length) invalid();
  return value(source, { shape: contract.output }, parsed, true, bounded());
}
