// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { JsonValue, Operation } from "./catalog.ts";
import type { PreparedRequest } from "./operation-input.ts";
import { awsRestContract, awsRestContracts, awsRestRoot, awsRestShape, validAwsRestModel,
  type AwsRestShape, type AwsRestSource } from "./aws-rest.ts";
import { encodeWorkflowBinary, validateWorkflowBinary, maxWorkflowUploadBytes } from "./workflow-binary.ts";
import { encodeS3Key, validateS3Bucket } from "./s3-files.ts";
import { awsRestEndpoint, awsRestUsesS3Keys } from "./aws-rest.ts";
import { WorkflowBodyError } from "./workflow-body-error.ts";

const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new WorkflowBodyError("CODEC"); }
function text(bytes: Uint8Array): string { try { return decoder.decode(bytes); } catch { invalid(); } }
const own = (value: object, key: string): unknown => Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
function bounded() {
  let nodes = 0;
  return (depth: number): void => { if (++nodes > 50000 || depth > 48) invalid(); };
}
function timestamp(value: unknown, format: string, reading: boolean): string | number {
  const date = typeof value === "number" ? new Date(value * 1000)
    : typeof value === "string" ? new Date(value) : invalid();
  if (!Number.isFinite(date.getTime())) invalid();
  return reading ? date.toISOString() : format === "unixTimestamp" ? date.getTime() / 1000 : format === "rfc822" ? date.toUTCString() : date.toISOString();
}
/** Retain logical SDK names in graphs; apply each model's wire aliases recursively. */
function jsonValue(source: AwsRestSource, reference: AwsRestShape, value: unknown, reading: boolean,
  visit: (depth: number) => void, depth = 0): JsonValue {
  visit(depth); const shape = awsRestShape(source, reference);
  if (value === null) return null;
  if (shape.type === "structure") {
    if (!object(value)) invalid();
    const entries: [string, JsonValue][] = [], consumed = new Set<string>();
    for (const [name, member] of Object.entries(shape.members ?? {})) {
      if (member.location) continue;
      const wire = member.locationName ?? name, key = reading ? wire : Object.hasOwn(value, name) ? name : wire;
      if (!reading && name !== wire && Object.hasOwn(value, name) && Object.hasOwn(value, wire)) invalid();
      if (!Object.hasOwn(value, key)) continue;
      consumed.add(key); entries.push([reading ? name : wire, jsonValue(source, member, value[key], reading, visit, depth + 1)]);
    }
    if (!reading && Object.keys(value).some(key => !consumed.has(key))) invalid();
    return Object.fromEntries(entries);
  }
  if (shape.type === "list") {
    if (!Array.isArray(value) || !shape.member) invalid();
    return value.map(item => jsonValue(source, shape.member!, item, reading, visit, depth + 1));
  }
  if (shape.type === "map") {
    if (!object(value) || !shape.value) invalid();
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, jsonValue(source, shape.value!, item, reading, visit, depth + 1)]));
  }
  if (shape.type === "timestamp") return timestamp(value, shape.timestampFormat ?? "unixTimestamp", reading);
  if (shape.type === "boolean") { if (typeof value !== "boolean") invalid(); return value; }
  if (["integer", "long", "float", "double"].includes(shape.type ?? "")) {
    if (typeof value !== "number" || !Number.isFinite(value) || ["integer", "long"].includes(shape.type!) && !Number.isSafeInteger(value)) invalid();
    return value;
  }
  if (shape.type === "blob" && (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))) invalid();
  if (typeof value !== "string") invalid();
  return value;
}
const escape = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
function xmlName(name: string): string { if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) invalid(); return name; }
function scalar(source: AwsRestSource, reference: AwsRestShape, value: unknown, reading: boolean): JsonValue {
  const shape = awsRestShape(source, reference);
  if (shape.type === "timestamp") return timestamp(value, shape.timestampFormat ?? "iso8601", reading);
  if (reading && shape.type === "boolean") { if (value !== "true" && value !== "false") invalid(); return value === "true"; }
  if (reading && ["integer", "long", "float", "double"].includes(shape.type ?? "")) {
    if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(value)) invalid();
    return jsonValue(source, reference, Number(value), false, bounded());
  }
  return jsonValue(source, reference, value, reading, bounded());
}
function xmlWrite(source: AwsRestSource, reference: AwsRestShape, value: unknown, name: string,
  visit: (depth: number) => void, depth = 0, namespace?: string): string {
  visit(depth); xmlName(name); const shape = awsRestShape(source, reference);
  if (shape.type === "list") {
    if (!Array.isArray(value) || !shape.member) invalid();
    const body = value.map(item => xmlWrite(source, shape.member!, item, shape.flattened ? name : shape.member?.locationName ?? "member", visit, depth + 1)).join("");
    return shape.flattened ? body : `<${name}>${body}</${name}>`;
  }
  if (shape.type === "map") {
    if (!object(value) || !shape.key || !shape.value) invalid();
    const body = Object.entries(value).map(([key, item]) => `<entry>${xmlWrite(source, shape.key!, key, shape.key?.locationName ?? "key", visit, depth + 1)}${xmlWrite(source, shape.value!, item, shape.value?.locationName ?? "value", visit, depth + 1)}</entry>`).join("");
    return `<${name}>${body}</${name}>`;
  }
  let attributes = "", body = "";
  const uri = shape.xmlNamespace?.uri ?? namespace;
  if (uri) attributes += ` xmlns${shape.xmlNamespace?.prefix ? ":" + xmlName(shape.xmlNamespace.prefix) : ""}="${escape(uri)}"`;
  if (shape.type === "structure") {
    if (!object(value)) invalid(); const consumed = new Set<string>();
    for (const [key, member] of Object.entries(shape.members ?? {})) {
      if (member.location || !Object.hasOwn(value, key)) continue;
      consumed.add(key); const wire = member.locationName ?? key;
      if (member.xmlAttribute) attributes += ` ${xmlName(wire)}="${escape(String(scalar(source, member, value[key], false)))}"`;
      else body += xmlWrite(source, member, value[key], wire, visit, depth + 1);
    }
    if (Object.keys(value).some(key => !consumed.has(key))) invalid();
  } else {
    const valueText = String(scalar(source, reference, value, false));
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(valueText) || !valueText.isWellFormed()) invalid();
    body = escape(valueText);
  }
  return `<${name}${attributes}>${body}</${name}>`;
}
function xmlRead(source: AwsRestSource, reference: AwsRestShape, value: unknown, visit: (depth: number) => void, depth = 0): JsonValue {
  visit(depth); const shape = awsRestShape(source, reference);
  if (shape.type === "structure") {
    if (value === "") return {};
    if (!object(value)) invalid();
    return Object.fromEntries(Object.entries(shape.members ?? {}).flatMap(([name, member]) => {
      if (member.location) return [];
      const wire = (member.xmlAttribute ? "@" : "") + (member.locationName ?? name);
      const item = own(value, wire);
      return item === undefined ? [] : [[name, xmlRead(source, member, item, visit, depth + 1)]];
    }));
  }
  if (shape.type === "list") {
    if (!shape.member) invalid();
    const items = shape.flattened ? value : value === "" ? [] : object(value) ? own(value, shape.member.locationName ?? "member") : invalid();
    return items === undefined ? [] : (Array.isArray(items) ? items : [items]).map(item => xmlRead(source, shape.member!, item, visit, depth + 1));
  }
  if (shape.type === "map") {
    if (!shape.value) invalid();
    const entries = value === "" ? [] : object(value) ? own(value, "entry") : invalid();
    return Object.fromEntries((entries === undefined ? [] : Array.isArray(entries) ? entries : [entries]).map(entry => {
      if (!object(entry)) invalid(); const key = entry[shape.key?.locationName ?? "key"];
      if (typeof key !== "string") invalid();
      return [key, xmlRead(source, shape.value!, entry[shape.value?.locationName ?? "value"], visit, depth + 1)];
    }));
  }
  return scalar(source, reference, value, true);
}
const namespaces: Record<string, string> = {
  "aws-cloudfront": "http://cloudfront.amazonaws.com/doc/2020-05-31/",
  "aws-route53": "https://route53.amazonaws.com/doc/2013-04-01/",
  "aws-s3": "http://s3.amazonaws.com/doc/2006-03-01/",
};
function xmlDocument(bytes: Uint8Array, namespace: string, ok: boolean): [string, unknown] {
  const input = text(bytes);
  if (/<!|<\?(?!xml(?:\s|\?>))/i.test(input) || /&(?!(?:amp|lt|gt|apos|quot|#(?:\d+|x[0-9a-fA-F]+));)/.test(input)
    || (input.match(/</g)?.length ?? 0) > 40000 || XMLValidator.validate(input, { allowBooleanAttributes: false }) !== true) invalid();
  let parsed: unknown;
  try { parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", ignoreDeclaration: true,
    parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true, maxNestedTags: 48 }).parse(input); }
  catch { invalid(); }
  if (!object(parsed) || Object.keys(parsed).length !== 1) invalid();
  const [name, root] = Object.entries(parsed)[0]!;
  if (ok && (!object(root) || root[name.includes(":") ? "@xmlns:" + name.split(":")[0] : "@xmlns"] !== namespace)) invalid();
  const visit = bounded();
  function normalize(value: unknown, depth: number): unknown {
    visit(depth); if (Array.isArray(value)) return value.map(item => normalize(item, depth + 1));
    if (!object(value)) return value;
    const entries: [string, unknown][] = [], names = new Set<string>();
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("@xmlns")) { if (item !== namespace) invalid(); continue; }
      const local = key.includes(":") ? (key.startsWith("@") ? "@" : "") + key.split(":").at(-1)! : key;
      if (names.has(local)) invalid(); names.add(local); entries.push([local, normalize(item, depth + 1)]);
    }
    return Object.fromEntries(entries);
  }
  return [name.split(":").at(-1)!, normalize(root, 0)];
}
function headerValue(source: AwsRestSource, member: AwsRestShape, value: string): JsonValue {
  const shape = awsRestShape(source, member);
  if (shape.type === "timestamp") return timestamp(value, shape.timestampFormat ?? "rfc822", true);
  return scalar(source, member, value, true);
}
function responseHeaders(source: AwsRestSource, root: AwsRestShape, headers: Headers, status: number): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [name, member] of Object.entries(root.members ?? {})) {
    const wire = member.locationName ?? name;
    if (member.location === "statusCode") result[name] = status;
    else if (member.location === "header") {
      const value = headers.get(wire); if (value !== null) result[name] = headerValue(source, member, value);
    } else if (member.location === "headers") {
      const map = Object.fromEntries([...headers].filter(([key]) => key.startsWith(wire.toLowerCase())).map(([key, value]) => [key.slice(wire.length), value]));
      result[name] = map;
    }
  }
  return result;
}
/** These bytes are produced after ordinary input validation, before signing. */
export function prepareAwsRestRequest(operation: Operation, request: PreparedRequest): PreparedRequest {
  if (!validAwsRestModel(operation)) invalid();
  const contract = awsRestContract(operation)!, source = awsRestContracts().sources[contract.catalog]!;
  const root = awsRestRoot(source, contract.input, contract.inputTraits), payload = root.payload ? root.members?.[root.payload] : undefined;
  const query = { ...request.query }, headers = { ...request.headers }, styles = { ...request.querySerialization };
  for (const [name, member] of Object.entries(root.members ?? {})) {
    const shape = awsRestShape(source, member), wire = member.locationName ?? name;
    if (member.location === "querystring" && Object.hasOwn(query, wire)) {
      if (shape.type === "list") delete styles[wire]; // AWS REST lists repeat the query key.
      if (shape.type === "timestamp") query[wire] = timestamp(query[wire], shape.timestampFormat ?? "iso8601", false);
      if (shape.type === "map") {
        const encoded = query[wire]; if (typeof encoded !== "string") invalid();
        let decoded: unknown; try { decoded = JSON.parse(encoded); } catch { invalid(); }
        const mapped = jsonValue(source, member, decoded, false, bounded()); if (!object(mapped)) invalid();
        delete query[wire]; delete styles[wire];
        for (const [key, value] of Object.entries(mapped)) {
          if (Object.hasOwn(query, key) || typeof value !== "string") invalid();
          Object.defineProperty(query, key, { value, enumerable: true, writable: true, configurable: true });
        }
      }
    }
    if (member.location === "header" && shape.type === "timestamp") {
      const key = Object.keys(headers).find(key => key.toLowerCase() === wire.toLowerCase());
      if (key) headers[key] = String(timestamp(headers[key], shape.timestampFormat ?? "rfc822", false));
    }
  }
  request = { ...request, query, headers, querySerialization: styles };
  if (request.body === undefined) return source.protocol === "rest-json" && !payload && !["GET", "HEAD", "DELETE"].includes(request.method)
    ? { ...request, body: {}, contentType: "application/json" } : request;
  if (payload && awsRestShape(source, payload).type === "blob") {
    const file = validateWorkflowBinary(request.body);
    const headers = { ...request.headers }; let media = file.mediaType || "application/octet-stream";
    for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() === "content-type") { media = value; delete headers[name]; }
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?$/.test(media) || media.length > 255) invalid();
    return { ...request, headers, bodyFormat: "binary", contentType: media as `${string}/${string}` };
  }
  const body = payload ? object(request.body) ? own(request.body, root.payload!) : invalid() : request.body;
  const shape = payload ?? root;
  if (source.protocol === "rest-json") return { ...request, body: jsonValue(source, shape, body, false, bounded()), contentType: "application/json" };
  const name = payload?.locationName ?? root.payload ?? root.locationName ?? contract.input;
  if (!name) invalid();
  return { ...request, body: xmlWrite(source, shape, body, name, bounded(), 0, namespaces[contract.catalog]),
    contentType: "application/xml", bodyFormat: "text" };
}
/** Preserve S3 greedy object keys without relying on URL path normalization. */
export function awsRestRequestUrl(operation: Operation, origin: string, path: string): URL {
  if (!awsRestEndpoint(origin, operation)) invalid();
  if (awsRestUsesS3Keys(operation)) {
    const contract = awsRestContract(operation)!;
    if (contract.greedy.includes("Key")) {
      const match = /^\/([^/]+)\/([\s\S]*)$/.exec(path); if (!match) invalid();
      try {
        if (validateS3Bucket(match[1]!) !== match[1] || encodeS3Key(decodeURIComponent(match[2]!)) !== match[2]) invalid();
      } catch { invalid(); }
    } else if (path !== "/") {
      try { if ("/" + validateS3Bucket(path.slice(1)) !== path) invalid(); } catch { invalid(); }
    }
  }
  return new URL(new URL(origin).origin + path);
}
/** Decode modelled bodies and header members into the logical SDK output shape. */
export function decodeAwsRestResponse(operation: Operation, bytes: Uint8Array, headers: Headers, status: number): unknown {
  if (!validAwsRestModel(operation)) invalid();
  if (bytes.byteLength > 8 * 1024 * 1024) throw new WorkflowBodyError("LIMIT");
  const contract = awsRestContract(operation)!, source = awsRestContracts().sources[contract.catalog]!;
  const root = awsRestRoot(source, contract.output, contract.outputTraits), ok = status >= 200 && status < 300;
  const result = responseHeaders(source, root, headers, status), media = (headers.get("Content-Type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!ok) {
    if (!bytes.length) return null;
    let error: unknown;
    if (source.protocol === "rest-xml") { const [name, value] = xmlDocument(bytes, namespaces[contract.catalog]!, false); if (!["Error", "ErrorResponse"].includes(name)) invalid(); error = value; }
    else { try { error = JSON.parse(text(bytes)); } catch { invalid(); } }
    if (!object(error)) invalid();
    const value = object(error.Error) ? error.Error : error;
    return { Error: Object.fromEntries(["Code", "Message", "Type", "code", "message", "__type"].flatMap(name => typeof value[name] === "string" ? [[name, value[name]]] : [])) };
  }
  if (!contract.output) { if (bytes.length) invalid(); return null; }
  if (!bytes.length && (operation.method === "HEAD" || status === 204 || status === 205)) return result;
  const payload = root.payload ? root.members?.[root.payload] : undefined, resolved = payload ? awsRestShape(source, payload) : undefined;
  if (!bytes.length && resolved?.type !== "blob" && resolved?.type !== "string") {
    if (root.payload || Object.values(root.members ?? {}).some(member => !member.location)) invalid();
    return result;
  }
  if (resolved?.eventstream) {
    if (media !== "application/vnd.amazon.eventstream") throw new WorkflowBodyError("MEDIA");
    return { ...result, [root.payload!]: decodeAwsRestEvents(source, resolved, bytes) };
  }
  if (resolved?.type === "blob") {
    if (bytes.byteLength > maxWorkflowUploadBytes) throw new WorkflowBodyError("LIMIT");
    return { ...result, [root.payload!]: encodeWorkflowBinary(contract.operation + ".bin", bytes, media || "application/octet-stream") };
  }
  if (resolved?.type === "string") return { ...result, [root.payload!]: text(bytes) };
  if (source.protocol === "rest-json") {
    if (media && media !== "application/json" && !media.endsWith("+json") && !/^application\/x-amz-json-1\.[01]$/.test(media)) throw new WorkflowBodyError("MEDIA");
    let value: unknown; try { value = JSON.parse(text(bytes)); } catch { invalid(); }
    const decoded = jsonValue(source, payload ?? root, value, true, bounded());
    return payload ? { ...result, [root.payload!]: decoded } : object(decoded) ? { ...decoded, ...result } : invalid();
  }
  if (!["application/xml", "text/xml"].includes(media)) throw new WorkflowBodyError("MEDIA");
  const [name, value] = xmlDocument(bytes, namespaces[contract.catalog]!, true);
  const expected = payload?.locationName ?? root.payload ?? (contract.operation === "ListBuckets" ? "ListAllMyBucketsResult" : root.locationName ?? contract.output);
  if (name !== expected) invalid();
  const decoded = xmlRead(source, payload ?? root, value, bounded());
  return payload ? { ...result, [root.payload!]: decoded } : object(decoded) ? { ...decoded, ...result } : invalid();
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0;
});
export function awsEventCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0;
}
/** AWS binary event framing is distinct from HTTP text/SSE streaming. */
function decodeAwsRestEvents(source: AwsRestSource, shape: AwsRestShape, bytes: Uint8Array): JsonValue[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), events: JsonValue[] = [];
  let offset = 0, complete = false;
  while (offset < bytes.length) {
    if (complete || events.length >= 4096 || offset + 16 > bytes.length) invalid();
    const length = view.getUint32(offset), headersLength = view.getUint32(offset + 4), end = offset + length;
    if (length < 16 || end > bytes.length || headersLength > length - 16
      || awsEventCrc32(bytes.subarray(offset, offset + 8)) !== view.getUint32(offset + 8)
      || awsEventCrc32(bytes.subarray(offset, end - 4)) !== view.getUint32(end - 4)) invalid();
    const headers = new Map<string, string>(), headersEnd = offset + 12 + headersLength; let cursor = offset + 12;
    while (cursor < headersEnd) {
      const size = bytes[cursor++]!; if (!size || cursor + size + 1 > headersEnd) invalid();
      const name = text(bytes.subarray(cursor, cursor + size)); cursor += size; const type = bytes[cursor++]!;
      let value = "";
      if (type === 6 || type === 7) {
        if (cursor + 2 > headersEnd) invalid(); const size = view.getUint16(cursor); cursor += 2;
        if (cursor + size > headersEnd) invalid(); if (type === 7) value = text(bytes.subarray(cursor, cursor + size)); cursor += size;
      } else {
        const size = [0, 0, 1, 2, 4, 8, -1, -1, 8, 16][type]; if (size === undefined || size < 0 || cursor + size > headersEnd) invalid(); cursor += size;
      }
      if (headers.has(name) || name.startsWith(":") && type !== 7) invalid(); headers.set(name, value);
    }
    if (cursor !== headersEnd || headers.get(":message-type") !== "event") invalid();
    const name = headers.get(":event-type")!, reference = shape.members?.[name]; if (!reference) invalid();
    const event = awsRestShape(source, reference), payloadMember = Object.entries(event.members ?? {}).find(([, member]) => member.eventpayload);
    const payload = bytes.subarray(headersEnd, end - 4); let value: JsonValue;
    if (payloadMember) {
      if (payload.length > maxWorkflowUploadBytes) throw new WorkflowBodyError("LIMIT");
      value = { [payloadMember[0]]: encodeWorkflowBinary(name + ".bin", payload, headers.get(":content-type") || "application/octet-stream") };
    } else {
      let parsed: unknown; try { parsed = JSON.parse(text(payload)); } catch { invalid(); }
      value = jsonValue(source, reference, parsed, true, bounded());
    }
    events.push({ [name]: value }); complete = name === "InvokeComplete"; offset = end;
  }
  if (!complete) invalid(); return events;
}
