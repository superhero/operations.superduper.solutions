// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { JsonValue } from "./catalog.ts";
import { encodeWorkflowBinary, validateWorkflowBinary, type WorkflowBinary } from "./workflow-binary.ts";

export type ProcessingKind = "transform" | "filter" | "assert";
export type ProcessingType = "Text" | "Number" | "Integer" | "Boolean" | "Object" | "Array" | "Null" | "Binary" | "Unknown" | "Mixed" | "JSON";
export type ProcessingData = { version: 1; operation: string; parameters: Record<string, string> };
type Parameter = { name: string; label: string; initial: string; options?: readonly string[]; multiline?: boolean; connectable?: boolean };
type Definition = { id: string; kind: ProcessingKind; label: string; inputs: readonly ProcessingType[]; inputLabel?: string; output: ProcessingType | "input"; key?: boolean; parameters: readonly Parameter[] };
const textBinary = ["Text", "Binary"] as const;
const textInput = ["Text"] as const;
const jsonTypes = ["Object", "Text", "Number", "Boolean", "Array", "Null"] as const;
const jsonConnectionTypes = [...jsonTypes, "Integer"] as const;
const anyValue = ["Text", "Number", "Integer", "Boolean", "Object", "Array", "Null", "Binary", "Unknown"] as const;
const parameter = (name: string, label: string, initial = "", options?: readonly string[]): Parameter => ({ name, label, initial, ...(options ? { options } : {}) });
const predicates = ["equals", "not_equal", "greater_than", "at_least", "less_than", "at_most", "contains", "starts_with", "ends_with", "is_set", "is_not_set", "is_type"] as const;
const condition = [parameter("path", "Field path (JSON pointer)"), parameter("operator", "Condition", "is_set", predicates), parameter("expected", "Expected value")];
export const processingOperations: readonly Definition[] = [
  { id: "utf8_encode", kind: "transform", label: "Encode UTF-8", inputs: ["Text"], output: "Binary", parameters: [] },
  { id: "utf8_decode", kind: "transform", label: "Decode UTF-8", inputs: ["Binary"], output: "Text", parameters: [] },
  ...(["base64", "base64url", "hex"] as const).flatMap(encoding => [
    { id: `${encoding}_encode`, kind: "transform" as const, label: `Encode ${encoding === "hex" ? "hexadecimal" : encoding === "base64" ? "Base64" : "Base64url"}`, inputs: textBinary, output: "Text" as const, parameters: [] },
    { id: `${encoding}_decode`, kind: "transform" as const, label: `Decode ${encoding === "hex" ? "hexadecimal" : encoding === "base64" ? "Base64" : "Base64url"}`, inputs: ["Text" as const], output: "Binary" as const, parameters: [] },
  ]),
  { id: "json_parse", kind: "transform", label: "Parse JSON", inputs: ["Text"], output: "JSON", parameters: [] },
  { id: "json_stringify", kind: "transform", label: "Serialize JSON", inputs: anyValue.filter(type => type !== "Binary"), inputLabel: "JSON", output: "Text", parameters: [] },
  { id: "map_fields", kind: "transform", label: "Map fields", inputs: ["Object", "Array"], output: "Object", parameters: [{ name: "fields", label: "Output names to source paths (JSON)", initial: '{"value":""}', multiline: true }] },
  { id: "sha256", kind: "transform", label: "Hash SHA-256", inputs: textBinary, output: "Text", parameters: [parameter("format", "Output encoding", "hex", ["hex", "base64", "base64url"])] },
  { id: "hmac_sha256", kind: "transform", label: "Sign HMAC-SHA256", inputs: textBinary, output: "Text", key: true, parameters: [parameter("format", "Output encoding", "hex", ["hex", "base64", "base64url"])] },
  { id: "jwt_sign", kind: "transform", label: "Sign JWT", inputs: ["Object"], output: "Text", key: true, parameters: [{ ...parameter("key_id", "Key ID (optional)"), connectable: true }, parameter("algorithm", "Algorithm", "HS256", ["HS256", "RS256"])] },
  { id: "trim", kind: "filter", label: "Trim text", inputs: ["Text"], output: "Text", parameters: [parameter("side", "Trim", "both", ["both", "start", "end"])] },
  { id: "substring", kind: "filter", label: "Substring", inputs: ["Text"], output: "Text", parameters: [parameter("start", "Start (inclusive)", "0"), parameter("end", "End (exclusive)")] },
  { id: "select_field", kind: "filter", label: "Select field", inputs: ["Object", "Array"], output: "Unknown", parameters: [parameter("path", "Field path (JSON pointer)"), parameter("type", "Result type", "Text", anyValue)] },
  { id: "array_range", kind: "filter", label: "Array range", inputs: ["Array"], output: "Array", parameters: [parameter("start", "Start (inclusive)", "0"), parameter("end", "End (exclusive)")] },
  { id: "array_filter", kind: "filter", label: "Filter array", inputs: ["Array"], output: "Array", parameters: condition },
  { id: "expect", kind: "assert", label: "Assert", inputs: anyValue, output: "input", parameters: condition.map(field => field.name === "expected" ? { ...field, connectable: true } : field) },
];
export const processingValueLimit = 500_000;
const jsonEncoder = new TextEncoder();
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function processingDefinition(kind: ProcessingKind, data: ProcessingData): Definition {
  // Read older nodes and private recipes after Select field moved to Filter.
  if (kind === "transform" && data.operation === "select_field") kind = "filter";
  const definition = processingOperations.find(operation => operation.kind === kind && operation.id === data.operation);
  if (!definition) throw new Error("Unknown processing operation.");
  return definition;
}
export function defaultProcessingData(kind: ProcessingKind, operation = kind === "transform" ? "base64_encode" : kind === "filter" ? "trim" : "expect"): ProcessingData {
  const definition = processingDefinition(kind, { version: 1, operation, parameters: {} });
  return { version: 1, operation, parameters: Object.fromEntries(definition.parameters.map(item => [item.name, item.initial])) };
}
export function validateProcessingData(kind: ProcessingKind, value: unknown): ProcessingData {
  if (!plain(value) || value.version !== 1 || typeof value.operation !== "string" || !plain(value.parameters)
    || Object.keys(value).some(key => !["version", "operation", "parameters"].includes(key))) throw new Error("Invalid processing configuration.");
  const definition = processingDefinition(kind, value as ProcessingData);
  let entries = Object.entries(value.parameters);
  // Earlier documents required a result type. Keep them readable without narrowing JSON.parse.
  if (definition.id === "json_parse" && entries.length === 1 && entries[0]![0] === "type"
    && jsonTypes.some(type => type === entries[0]![1])) entries = [];
  if (entries.length !== definition.parameters.length || entries.some(([name, value]) => {
    const field = definition.parameters.find(field => field.name === name);
    return !field || typeof value !== "string" || value.length > (field.multiline ? 16000 : 4096) || field.options && !field.options.includes(value);
  })) throw new Error("Invalid processing parameters.");
  return { version: 1, operation: value.operation, parameters: Object.fromEntries(entries) as Record<string, string> };
}
export function processingOutputType(kind: ProcessingKind, data: ProcessingData, input: ProcessingType): ProcessingType {
  const output = processingDefinition(kind, data).output;
  return output === "input" ? input : output === "Unknown" ? data.parameters.type as ProcessingType : output;
}
export function processingInputTypes(kind: ProcessingKind, data: ProcessingData, handle: string | null | undefined, inputType: ProcessingType | "Mixed" = "Unknown"): readonly ProcessingType[] | undefined {
  const definition = processingDefinition(kind, data);
  if (handle === "value") return definition.inputs;
  if (handle === "key" && definition.key) return textBinary;
  if (handle === "expected" && kind === "assert") return processingConditionUsesExpected(data.parameters.operator ?? "") ? processingExpectedTypes(data, inputType) : undefined;
  return definition.parameters.some(field => field.connectable && field.name === handle) ? textInput : undefined;
}
/** JSON is a known union, unlike an unresolved Unknown or Mixed output. Number includes Integer. */
export function processingTypeAlternatives(type: ProcessingType): readonly ProcessingType[] {
  return type === "JSON" ? jsonConnectionTypes : [type];
}
export function processingTypeLabel(type: ProcessingType): string {
  return type === "JSON" ? "JsonValue" : type;
}
export function processingValueType(value: unknown): ProcessingType {
  if (value === null) return "Null";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "string") return "Text";
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "Integer" : "Number";
  if (typeof value === "boolean") return "Boolean";
  if (plain(value)) return value.kind === "workflow-file" ? "Binary" : "Object";
  return "Unknown";
}
export function validateProcessingValue(value: unknown, depth = 0, budget = { count: 0 }): asserts value is JsonValue {
  if (++budget.count > 20000 || depth > 40) throw new Error("Processing data exceeds the structure limit.");
  if (typeof value === "string" && value.length > processingValueLimit * 2) throw new Error("Processing data exceeds the size limit.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !plain(value)) throw new Error("Processing requires finite JSON values or binary files.");
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))
    if (!("value" in descriptor)) throw new Error("Processing data must not contain accessors.");
  for (const entry of Object.values(value)) validateProcessingValue(entry, depth + 1, budget);
  if (!depth && jsonEncoder.encode(JSON.stringify(value)).byteLength > processingValueLimit * 2) throw new Error("Processing data exceeds the size limit.");
}
function binary(value: Uint8Array): WorkflowBinary { return encodeWorkflowBinary("data.bin", value); }
function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value === "string") {
    const result = jsonEncoder.encode(value);
    if (result.length > processingValueLimit) throw new Error("Processing data exceeds the size limit.");
    return result;
  }
  const file = validateWorkflowBinary(value);
  return Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
}
function encoded(value: Uint8Array, format: string): string {
  if (format === "hex") return Array.from(value, byte => byte.toString(16).padStart(2, "0")).join("");
  const base64 = encodeWorkflowBinary("data.bin", value).base64;
  return format === "base64url" ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : base64;
}
function decoded(value: string, format: string): Uint8Array<ArrayBuffer> {
  const maximum = format === "hex" ? processingValueLimit * 2 : Math.ceil(processingValueLimit / 3) * 4;
  if (value.length > maximum)
    throw new Error("Encoded data exceeds the size limit.");
  if (format === "hex") {
    if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error("Enter complete hexadecimal byte pairs.");
    return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16));
  }
  const normalized = format === "base64url" ? value.replace(/-/g, "+").replace(/_/g, "/") : value;
  if (format === "base64url" && !/^[A-Za-z0-9_-]*$/.test(value) || format === "base64" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("Enter a canonical encoded value.");
  let result: Uint8Array<ArrayBuffer>;
  try { result = Uint8Array.from(atob(normalized + (format === "base64url" ? "=".repeat((4 - normalized.length % 4) % 4) : "")), character => character.charCodeAt(0)); }
  catch { throw new Error("Enter a canonical encoded value."); }
  if (encoded(result, format) !== value) throw new Error("Enter a canonical encoded value.");
  return result;
}
export function processingPointer(value: unknown, pointer: string): unknown {
  if (!pointer) return value;
  if (!pointer.startsWith("/") || /~(?:[^01]|$)/.test(pointer)) throw new Error("Field paths must be valid JSON pointers.");
  let current = value;
  for (const segment of pointer.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~")))
    current = current !== null && typeof current === "object" && Object.hasOwn(current, segment) ? (current as Record<string, unknown>)[segment] : undefined;
  return current;
}
const expectedValue = (value: string): unknown => { try { return JSON.parse(value); } catch { return value; } };
export function processingExpectedTypes(data: ProcessingData, inputType: ProcessingType | "Mixed"): readonly ProcessingType[] {
  const operator = data.parameters.operator;
  if (["greater_than", "at_least", "less_than", "at_most"].includes(operator ?? "")) return ["Number"];
  if (["starts_with", "ends_with", "is_type"].includes(operator ?? "")) return ["Text"];
  const checkedType = data.parameters.path && processingConditionUsesPath(inputType) ? "Unknown" : inputType;
  if (operator === "contains") return checkedType === "Text" ? textInput : anyValue;
  return checkedType === "Unknown" || checkedType === "Mixed" ? anyValue : processingTypeAlternatives(checkedType);
}
export function processingConditionUsesPath(type: ProcessingType | "Mixed"): boolean {
  return ["Object", "Array", "Unknown", "Mixed", "JSON"].includes(type);
}
export function processingConditionUsesExpected(operator: string): boolean {
  return operator !== "is_set" && operator !== "is_not_set";
}
export function matchesProcessingCondition(value: unknown, parameters: Record<string, string>, expected = expectedValue(parameters.expected!)): boolean {
  const input = processingPointer(value, parameters.path!);
  const operator = parameters.operator;
  if (operator === "is_set") return input !== null && input !== undefined;
  if (operator === "is_not_set") return input === null || input === undefined;
  if (operator === "is_type") return processingValueType(input).toLowerCase() === String(expected).toLowerCase()
    || String(expected).toLowerCase() === "number" && processingValueType(input) === "Integer";
  if (operator === "equals" || operator === "not_equal") {
    const equal = equalJson(input, expected);
    return operator === "equals" ? equal : !equal;
  }
  if (operator === "contains") return typeof input === "string" && typeof expected === "string" ? input.includes(expected)
    : Array.isArray(input) && input.some(item => equalJson(item, expected));
  if (operator === "starts_with" || operator === "ends_with") return typeof input === "string" && typeof expected === "string"
    && (operator === "starts_with" ? input.startsWith(expected) : input.endsWith(expected));
  if (typeof input !== "number" || typeof expected !== "number") return false;
  if (operator === "greater_than") return input > expected;
  if (operator === "at_least") return input >= expected;
  if (operator === "less_than") return input < expected;
  return input <= expected;
}
function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, i) => equalJson(item, right[i]));
  if (!plain(left) || !plain(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}
function index(value: string, fallback?: number): number | undefined {
  if (!value && fallback === undefined) return undefined;
  if (!value) return fallback;
  const result = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(result)) throw new Error("Range bounds must be whole numbers; the end is exclusive.");
  return result;
}

/** Pure bounded operation implementation, shared by public and private workers. */
export async function processWorkflowValue(kind: ProcessingKind, raw: ProcessingData, value: unknown, key?: unknown, parameters?: Record<string, unknown>): Promise<unknown> {
  let data = validateProcessingData(kind, raw);
  let connectedExpected: { value: unknown } | undefined;
  const definition = processingDefinition(kind, data);
  if (parameters !== undefined) {
    if (!plain(parameters)) throw new Error("Invalid connected processing parameters.");
    const supplied: Record<string, string> = {};
    for (const [name, value] of Object.entries(parameters)) {
      const field = definition.parameters.find(field => field.name === name && field.connectable);
      if (!field) throw new Error("Unknown connected processing parameter.");
      if (kind === "assert" && name === "expected") {
        validateProcessingValue(value);
        connectedExpected = { value };
        continue;
      }
      if (typeof value !== "string") throw new Error(`${field.label} needs a Text value.`);
      supplied[name] = value;
    }
    if (Object.keys(supplied).length) data = validateProcessingData(kind, { ...data, parameters: { ...data.parameters, ...supplied } });
  }
  const p = data.parameters;
  validateProcessingValue(value);
  const inputType = processingValueType(value);
  if (!definition.inputs.includes(inputType) && !(inputType === "Integer" && definition.inputs.includes("Number"))) throw new Error(`${definition.label} does not accept ${inputType} input.`);
  const operation = data.operation;
  if (kind === "assert") return matchesProcessingCondition(value, processingConditionUsesPath(inputType) ? p : { ...p, path: "" }, connectedExpected ? connectedExpected.value : expectedValue(p.expected!));
  let result: unknown;
  if (operation === "utf8_encode") result = encodeWorkflowBinary("data.txt", bytes(value), "text/plain");
  else if (operation === "utf8_decode") {
    try { result = new TextDecoder("utf-8", { fatal: true }).decode(bytes(value)); }
    catch { throw new Error("The input is not valid UTF-8 text."); }
  }
  else if (/^(base64|base64url|hex)_encode$/.test(operation)) result = encoded(bytes(value), operation.split("_")[0]!);
  else if (/^(base64|base64url|hex)_decode$/.test(operation)) result = binary(decoded(value as string, operation.split("_")[0]!));
  else if (operation === "json_parse") {
    try { result = JSON.parse(value as string); } catch { throw new Error("Enter valid JSON to parse."); }
  }
  else if (operation === "json_stringify") result = JSON.stringify(value);
  else if (operation === "select_field") {
    result = processingPointer(value, p.path!);
    if (result === undefined) throw new Error("The selected field is missing.");
  }
  else if (operation === "map_fields") {
    let fields: unknown;
    try { fields = JSON.parse(p.fields!); } catch { throw new Error("Field mappings must be a JSON object of names to JSON pointers."); }
    if (!plain(fields) || Object.keys(fields).length > 200 || Object.values(fields).some(path => typeof path !== "string")) throw new Error("Field mappings must be a JSON object of names to JSON pointers.");
    result = Object.fromEntries(Object.entries(fields).map(([name, path]) => {
      const found = processingPointer(value, path as string);
      if (found === undefined) throw new Error("A mapped source field is missing.");
      return [name, found];
    }));
  }
  else if (operation === "sha256") result = encoded(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))), p.format!);
  else if (operation === "hmac_sha256" || operation === "jwt_sign") {
    const algorithm = operation === "jwt_sign" ? p.algorithm! : "HS256";
    let material: Uint8Array<ArrayBuffer>;
    if (algorithm === "RS256") {
      if (typeof key === "string") {
        const pem = /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----\s*$/.exec(key);
        if (!pem) throw new Error("RS256 requires a PKCS8 PEM or binary DER private key.");
        material = decoded(pem[1]!.replace(/\s/g, ""), "base64");
      } else material = bytes(key);
    } else material = bytes(key);
    if (operation === "jwt_sign" && algorithm === "HS256" && material.length < 32) throw new Error("HS256 JWT signing requires a key of at least 32 bytes.");
    const cryptoAlgorithm = algorithm === "HS256" ? { name: "HMAC", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const signingKey = await crypto.subtle.importKey(algorithm === "HS256" ? "raw" : "pkcs8", material, cryptoAlgorithm, false, ["sign"]);
    if (algorithm === "RS256" && (signingKey.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error("RS256 requires an RSA key of at least 2048 bits.");
    const message = operation === "jwt_sign" ? `${encoded(jsonEncoder.encode(JSON.stringify({ alg: algorithm, typ: "JWT", ...(p.key_id ? { kid: p.key_id } : {}) })), "base64url")}.${encoded(jsonEncoder.encode(JSON.stringify(value)), "base64url")}` : undefined;
    const signature = new Uint8Array(await crypto.subtle.sign(cryptoAlgorithm.name, signingKey, message === undefined ? bytes(value) : jsonEncoder.encode(message)));
    result = message === undefined ? encoded(signature, p.format!) : `${message}.${encoded(signature, "base64url")}`;
  }
  else if (operation === "trim") result = p.side === "start" ? (value as string).trimStart() : p.side === "end" ? (value as string).trimEnd() : (value as string).trim();
  else if (operation === "substring") result = Array.from(value as string).slice(index(p.start!, 0), index(p.end!)).join("");
  else if (operation === "array_range") result = (value as unknown[]).slice(index(p.start!, 0), index(p.end!));
  else {
    const expected = expectedValue(p.expected!);
    result = (value as unknown[]).filter(item => matchesProcessingCondition(item, p, expected));
  }
  validateProcessingValue(result);
  const expected = processingOutputType(kind, data, inputType);
  const actual = processingValueType(result);
  if (expected !== "Unknown" && expected !== "JSON" && actual !== expected && !(expected === "Number" && actual === "Integer")) throw new Error(`The result does not match the selected ${expected} output type.`);
  return result;
}

/** Small previews never serialize or render the complete result on the page. */
export function processingPreview(value: unknown): string {
  let remaining = 1800;
  function sample(value: unknown, depth: number): unknown {
    if (remaining <= 0 || depth > 5) return "…";
    if (typeof value === "string") { const result = value.slice(0, remaining); remaining -= result.length; return result.length < value.length ? `${result}…` : result; }
    if (!value || typeof value !== "object") return value;
    remaining -= 20;
    if (Array.isArray(value)) return [...value.slice(0, 12).map(item => sample(item, depth + 1)), ...(value.length > 12 ? ["…"] : [])];
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([name, entry]) => { remaining -= name.length; return [name, sample(entry, depth + 1)]; }));
  }
  return JSON.stringify(sample(value, 0), null, 2).slice(0, 3000);
}
