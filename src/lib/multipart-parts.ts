// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema, JsonValue } from "./catalog.ts";
import { containsBinaryInput, validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";

export type MultipartPart = { kind: "text" | "json" | "file" | "files" | "file-or-text"; contentTypes?: string[]; name?: "filename" };
export type MultipartParts = Record<string, MultipartPart>;
type Shape = Record<string, any>;
const object = (value: unknown): value is Shape => value !== null && typeof value === "object" && !Array.isArray(value);
const mime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const annotations = new Set(["title", "description", "example", "examples", "default", "deprecated", "readOnly", "writeOnly"]);
const jsonMedia = (type: string) => type === "application/json" || type.endsWith("+json");
function fail(name: string, detail: string): never { throw new Error(`Form part ${JSON.stringify(name)}: ${detail}.`); }

/** Unwrap a single allOf only when every sibling is an annotation. */
export function multipartShape(raw: unknown, resolve: (input: unknown) => Shape): Shape {
  let value = resolve(raw);
  for (let depth = 0; Array.isArray(value.allOf) && value.allOf.length === 1; depth++) {
    if (depth >= 16 || Object.keys(value).some(key => key !== "allOf" && !annotations.has(key) && !key.startsWith("x-"))) break;
    const { allOf, ...notes } = value; value = { ...resolve(allOf[0]), ...notes };
  }
  return value;
}

/** A plain string/file anyOf describes two wire representations. Never turn a
 * constrained or exclusive union into an unconstrained file/text field. */
export function multipartFileOrText(raw: unknown, resolve: (input: unknown) => Shape): boolean {
  const shape = multipartShape(raw, resolve);
  if (!Array.isArray(shape.anyOf) || shape.anyOf.length !== 2 || Object.keys(shape).some(key => key !== "anyOf" && !annotations.has(key) && !key.startsWith("x-"))) return false;
  const variants = shape.anyOf.map((branch: unknown) => resolve(branch));
  return variants.every((branch: Shape) => branch.type === "string" && Object.keys(branch).every(key => ["type", "format"].includes(key) || annotations.has(key) || key.startsWith("x-")))
    && variants.filter((branch: Shape) => branch.format === "binary").length === 1 && variants.filter((branch: Shape) => branch.format === undefined).length === 1;
}

/** Keep JSON controls for JSON parts while retaining ordinary field validation.
 * Unrepresentable JSON vocabularies keep their existing server-validation role. */
export function multipartBodySchema(raw: unknown, resolve: (input: unknown) => Shape, parse: (input: unknown) => InputSchema) {
  const root = multipartShape(raw, resolve), properties = Object.fromEntries(Object.entries(root.properties ?? {}).map(([name, value]) => [name, multipartShape(value, resolve)]));
  const schema = parse({ ...root, properties }), mixed: MultipartParts = {};
  if (schema.type === "object") for (const [name, value] of Object.entries(properties)) if (multipartFileOrText(value, resolve)) {
    schema.properties ??= {}; schema.properties[name] = { type: "json" };
    Object.defineProperty(mixed, name, { value: { kind: "file-or-text" }, enumerable: true, writable: true, configurable: true });
  }
  return { schema, mixed, properties };
}

export function multipartPartEncodings(schema: InputSchema, encoding: unknown, mixed: MultipartParts = {}): MultipartParts {
  const parts: MultipartParts = structuredClone(mixed);
  if (encoding === undefined) return parts;
  if (!object(encoding)) throw new Error("Form part encoding must be an object keyed by field name.");
  for (const [name, declaration] of Object.entries(encoding)) {
    const field = Object.hasOwn(schema.properties ?? {}, name) ? schema.properties![name] : undefined;
    if (!field) fail(name, "encoding must name a declared field");
    if (!object(declaration)) fail(name, "encoding must be an object");
    const unsupported = Object.keys(declaration).filter(key => !["contentType", "x-operations-part-name", "x-operations-json-text"].includes(key));
    if (unsupported.length) fail(name, `custom encoding (${unsupported.join(", ")}) is not supported`);
    if (typeof declaration.contentType !== "string") fail(name, "contentType must be a media type or comma-separated media types");
    const contentTypes = declaration.contentType.split(",").map((type: string) => type.trim().toLowerCase());
    if (!contentTypes.length || contentTypes.length > 16 || new Set(contentTypes).size !== contentTypes.length || contentTypes.some((type: string) => type.length > 255 || !mime.test(type)))
      fail(name, "contentType contains an invalid or repeated media type");
    if (declaration["x-operations-json-text"] !== undefined && (declaration["x-operations-json-text"] !== true || field.type !== "string"
      || field.format || contentTypes.length !== 1 || !jsonMedia(contentTypes[0]!))) fail(name, "pre-encoded JSON text requires a string and one JSON media type");
    const kind = field.format === "binary" ? "file" : field.type === "array" && field.items?.format === "binary" ? "files"
      : declaration["x-operations-json-text"] ? "text" : contentTypes.length === 1 && jsonMedia(contentTypes[0]!)
        || ["object", "array", "json", "null"].includes(field.type) ? "json" : "text";
    if (kind === "json" && (contentTypes.length !== 1 || !jsonMedia(contentTypes[0]!) || containsBinaryInput(field)))
      fail(name, "structured values require one JSON media type and cannot contain binary fields");
    if (kind === "text" && contentTypes.length !== 1) fail(name, "text values require one declared media type");
    if (declaration["x-operations-part-name"] !== undefined && (declaration["x-operations-part-name"] !== "filename" || kind !== "files"))
      fail(name, "filename part names require a reviewed file collection");
    Object.defineProperty(parts, name, { value: { kind, contentTypes, ...(declaration["x-operations-part-name"] ? { name: "filename" as const } : {}) }, enumerable: true, writable: true, configurable: true });
  }
  return parts;
}

export function validateMultipartParts(parts: MultipartParts, schema: InputSchema): void {
  if (!object(parts) || Object.keys(parts).length > 200) throw new Error("Invalid multipart part contract.");
  for (const [name, part] of Object.entries(parts)) {
    if (!object(part) || !Object.hasOwn(schema.properties ?? {}, name) || Object.keys(part).some(key => !["kind", "contentTypes", "name"].includes(key))
      || !["text", "json", "file", "files", "file-or-text"].includes(part.kind)
      || part.name !== undefined && (part.name !== "filename" || part.kind !== "files")
      || part.contentTypes !== undefined && (!Array.isArray(part.contentTypes) || !part.contentTypes.length || part.contentTypes.length > 16
        || part.contentTypes.some(type => typeof type !== "string" || type.length > 255 || !mime.test(type)))) fail(name, "invalid multipart part contract");
    const field = schema.properties![name]!;
    if (part.kind === "file" && field.format !== "binary"
      || part.kind === "files" && (field.type !== "array" || field.nullable || field.items?.format !== "binary" || field.items.nullable)
      || part.kind === "file-or-text" && (field.type !== "json" || part.contentTypes !== undefined)
      || part.kind === "json" && (part.contentTypes?.length !== 1 || !jsonMedia(part.contentTypes[0]!) || containsBinaryInput(field))
      || part.kind === "text" && (!["string", "number", "integer", "boolean"].includes(field.type) || field.format || part.contentTypes?.length !== 1))
      fail(name, "part representation does not match its input schema and media types");
  }
}

export function validateMultipartValue(name: string, part: MultipartPart, value: JsonValue): void {
  if (part.kind === "file-or-text" && typeof value !== "string") {
    try { validateWorkflowBinary(value); } catch { fail(name, "provide text or a validated binary file"); }
  }
}

function nestedMultipartType(file: ReturnType<typeof validateWorkflowBinary>): string {
  const bytes = atob(file.base64), match = /^--([0-9A-Za-z'()+_,./:=?-]{1,70})\r\n/.exec(bytes);
  if (!match || !bytes.endsWith(`\r\n--${match[1]}--\r\n`) && !bytes.endsWith(`\r\n--${match[1]}--`))
    throw new Error("A multipart bundle requires matching opening and closing boundaries.");
  return `multipart/form-data; boundary="${match[1]}"`;
}

/** Browser FormData owns the outer boundary. Declared inner types never become
 * request headers and uploaded bytes are neither stringified nor re-encoded. */
export function appendMultipartPart(form: FormData, name: string, value: JsonValue, part: MultipartPart): void {
  validateMultipartValue(name, part, value);
  if (part.kind === "json") {
    form.append(name, new Blob([JSON.stringify(value)], { type: part.contentTypes?.[0] ?? "application/json" })); return;
  }
  if (part.kind === "text" || part.kind === "file-or-text" && typeof value === "string") {
    if (value === null || typeof value === "object" || typeof value === "number" && !Number.isFinite(value)) fail(name, "text parts require a primitive value");
    if (part.contentTypes?.length) form.append(name, new Blob([String(value)], { type: part.contentTypes[0]! }));
    else form.append(name, String(value)); return;
  }
  const values = part.kind === "files" ? value : [value];
  if (!Array.isArray(values)) fail(name, "file collections require an array");
  for (const item of values) {
    const file = validateWorkflowBinary(item), types = part.contentTypes;
    const type = types?.length === 1 ? types[0]! : file.mediaType;
    if (types && !types.includes(type)) fail(name, `file media type ${JSON.stringify(file.mediaType)} is not declared`);
    const partName = part.name === "filename" ? file.name : name;
    if (part.name === "filename" && (form.has(partName) || partName === "metadata")) fail(name, "file part names must be unique and cannot replace metadata");
    form.append(partName, workflowBinaryBlob(file, type === "multipart/form-data" ? nestedMultipartType(file) : type), file.name);
  }
}
