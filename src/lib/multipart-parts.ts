// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { InputSchema, JsonValue } from "./catalog.ts";
import { containsBinaryInput, validateWorkflowBinary, workflowBinaryBlob } from "./workflow-binary.ts";

export type MultipartPart = { kind: "text" | "json" | "file" | "files" | "file-or-text" | "file-or-url" | "scalar" | "repeat" | "brackets" | "json-text"; contentTypes?: string[]; name?: "filename" };
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
  // Definitions are not assertions. Their references still resolve against the
  // document; unsupported or unresolved references retain the existing guards.
  const { $defs: _definitions, ...assertions } = root;
  const alternatives = root.type === "object" && Array.isArray(root.oneOf) && root.oneOf.length >= 2 && root.oneOf.length <= 16
    && root.oneOf.every((branch: unknown) => object(branch) && Object.keys(branch).length === 1
      && Array.isArray(branch.required) && branch.required.length > 0 && branch.required.length <= 200
      && new Set(branch.required).size === branch.required.length
      && branch.required.every((name: unknown) => typeof name === "string" && Object.hasOwn(properties, name)))
    ? root.oneOf.map((branch: Shape) => [...branch.required] as string[]) : undefined;
  if (alternatives) delete assertions.oneOf;
  const schema = parse({ ...assertions, properties }), mixed: MultipartParts = {};
  if (alternatives && schema.type === "object") schema.requiredOneOf = alternatives;
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
    const unsupported = Object.keys(declaration).filter(key => !["contentType", "x-operations-part-name", "x-operations-json-text", "x-operations-form-style"].includes(key));
    if (unsupported.length) fail(name, `custom encoding (${unsupported.join(", ")}) is not supported`);
    if (declaration["x-operations-form-style"] !== undefined) {
      const kind = declaration["x-operations-form-style"];
      if (!["scalar", "repeat", "brackets", "json-text", "file-or-url"].includes(kind)
        || declaration["x-operations-part-name"] !== undefined || declaration["x-operations-json-text"] !== undefined
        || declaration.contentType !== undefined && (kind !== "json-text" || declaration.contentType !== "application/json"))
        fail(name, "invalid qualified form style");
      Object.defineProperty(parts, name, { value: { kind, ...(declaration.contentType ? { contentTypes: [declaration.contentType] } : {}) }, enumerable: true, writable: true, configurable: true });
      continue;
    }
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
      || !["text", "json", "file", "files", "file-or-text", "file-or-url", "scalar", "repeat", "brackets", "json-text"].includes(part.kind)
      || part.name !== undefined && (part.name !== "filename" || part.kind !== "files")
      || part.contentTypes !== undefined && (!Array.isArray(part.contentTypes) || !part.contentTypes.length || part.contentTypes.length > 16
        || part.contentTypes.some(type => typeof type !== "string" || type.length > 255 || !mime.test(type)))) fail(name, "invalid multipart part contract");
    const field = schema.properties![name]!;
    if (part.kind === "file" && field.format !== "binary"
      || part.kind === "files" && (field.type !== "array" || field.nullable || field.items?.format !== "binary" || field.items.nullable)
      || ["file-or-text", "file-or-url"].includes(part.kind) && (field.type !== "json" || part.contentTypes !== undefined)
      || ["scalar", "repeat"].includes(part.kind) && (!scalarSchema(field, part.kind === "repeat") || part.contentTypes !== undefined)
      || part.kind === "brackets" && (containsBinaryInput(field) || !representable(field) || part.contentTypes !== undefined)
      || part.kind === "json-text" && (containsBinaryInput(field) || !representable(field)
        || part.contentTypes !== undefined && (part.contentTypes.length !== 1 || part.contentTypes[0] !== "application/json"))
      || part.kind === "json" && (part.contentTypes?.length !== 1 || !jsonMedia(part.contentTypes[0]!) || containsBinaryInput(field))
      || part.kind === "text" && (!["string", "number", "integer", "boolean"].includes(field.type) || field.format || part.contentTypes?.length !== 1))
      fail(name, "part representation does not match its input schema and media types");
  }
}

function scalarSchema(schema: InputSchema, arrays: boolean): boolean {
  return !schema.format && (["string", "number", "integer", "boolean"].includes(schema.type)
    || arrays && schema.type === "array" && !!schema.items && scalarSchema(schema.items, false)
    || schema.type === "json" && !!(schema.anyOf ?? schema.oneOf)?.length && (schema.anyOf ?? schema.oneOf)!.every(branch => scalarSchema(branch, arrays)));
}
function representable(schema: InputSchema): boolean {
  if (schema.type === "json") return !!(schema.anyOf ?? schema.oneOf)?.length && (schema.anyOf ?? schema.oneOf)!.every(representable);
  return Object.values(schema.properties ?? {}).every(representable) && (!schema.items || representable(schema.items))
    && (typeof schema.additionalProperties !== "object" || representable(schema.additionalProperties));
}

export function validateMultipartValue(name: string, part: MultipartPart, value: JsonValue): void {
  if ((part.kind === "file-or-text" || part.kind === "file-or-url") && typeof value !== "string") {
    try { validateWorkflowBinary(value); } catch { fail(name, "provide text or a validated binary file"); }
  }
  if (part.kind === "file-or-url" && typeof value === "string") {
    let url; try { url = new URL(value); } catch { fail(name, "provide an absolute HTTP or HTTPS file URL"); }
    if (!/^https?:$/.test(url!.protocol) || value.trim() !== value || /[\u0000-\u0020\u007f]/.test(value)) fail(name, "provide an absolute HTTP or HTTPS file URL");
  }
}

function appendBracketValues(form: FormData, name: string, value: JsonValue, depth = 0, budget = { count: 0 }): void {
  if (depth > 8 || ++budget.count > 200) fail(name, "bracket fields exceed their depth or field budget");
  if (value === null) return; // Official serializer omits null leaves.
  if (Array.isArray(value)) { for (const item of value) appendBracketValues(form, name + "[]", item, depth + 1, budget); return; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key || /[\[\]\u0000-\u001f\u007f]/.test(key)) fail(name, "object keys cannot contain brackets or control characters");
      appendBracketValues(form, `${name}[${key}]`, item, depth + 1, budget);
    }return;
  }
  form.append(name, String(value));
}

function nestedMultipartType(file: ReturnType<typeof validateWorkflowBinary>): string {
  const bytes = atob(file.base64), match = /^--([0-9A-Za-z'()+_,./:=?-]{1,70})\r\n/.exec(bytes);
  if (!match || !bytes.endsWith(`\r\n--${match[1]}--\r\n`) && !bytes.endsWith(`\r\n--${match[1]}--`))
    throw new Error("A multipart bundle requires matching opening and closing boundaries.");
  return `multipart/form-data; boundary="${match[1]}"`;
}

/** Browser FormData owns the outer boundary. Declared inner types never become
 * request headers and uploaded bytes are neither stringified nor re-encoded. */
function appendQualifiedPart(form: FormData, name: string, value: JsonValue, part: MultipartPart): void {
  validateMultipartValue(name, part, value);
  if (part.kind === "json-text") { form.append(name, JSON.stringify(value)); return; }
  if (part.kind === "brackets") { appendBracketValues(form, name, value); return; }
  if (part.kind === "scalar" || part.kind === "repeat") {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === null || typeof item === "object") fail(name, "scalar parts require non-null primitive values");
      form.append(name, String(item));
    }return;
  }
  if (part.kind === "json") {
    form.append(name, new Blob([JSON.stringify(value)], { type: part.contentTypes?.[0] ?? "application/json" })); return;
  }
  if (part.kind === "text" || (part.kind === "file-or-text" || part.kind === "file-or-url") && typeof value === "string") {
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

export function appendMultipartPart(form: FormData, name: string, value: JsonValue, part: MultipartPart): void {
  const addition = new FormData(); appendQualifiedPart(addition, name, value, part);
  for (const key of new Set(addition.keys())) if (form.has(key)) fail(name, `encoded field ${JSON.stringify(key)} collides with another field`);
  for (const [key, item] of addition) {
    if (typeof item === "string") form.append(key, item);
    else form.append(key, item, item.name);
  }
}

/** A typed JSON form field must remain a field, without a filename. FormData
 * cannot express that combination. This bounded encoder preserves other files
 * as Blob bytes and supplies its own random boundary through the Blob type. */
export function multipartBody(form: FormData, parts: MultipartParts | undefined): FormData | Blob {
  if (!Object.values(parts ?? {}).some(part => part.kind === "json-text" && part.contentTypes)) return form;
  const boundary = "operations-" + crypto.randomUUID(), chunks: BlobPart[] = [];
  const quoted = (value: string) => value.replace(/["\r\n]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
  for (const [name, value] of form) {
    const part = Object.hasOwn(parts ?? {}, name) ? parts![name] : undefined;
    let headers = `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(name)}"`;
    if (typeof value !== "string") headers += `; filename="${quoted(value.name)}"\r\nContent-Type: ${value.type || "application/octet-stream"}`;
    else if (part?.kind === "json-text" && part.contentTypes) headers += `\r\nContent-Type: ${part.contentTypes[0]}`;
    chunks.push(headers + "\r\n\r\n", value, "\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return new Blob(chunks, { type: "multipart/form-data; boundary=" + boundary });
}
