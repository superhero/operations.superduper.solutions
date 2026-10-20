// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import Papa from "papaparse";
import type { JsonValue } from "./catalog.ts";
import { encodeWorkflowBinary, validateWorkflowBinary, maxWorkflowUploadBytes, type WorkflowBinary } from "./workflow-binary.ts";

export { maxWorkflowUploadBytes } from "./workflow-binary.ts";
export type CsvOptions = { delimiter: "auto" | "," | ";" | "\t" | "|"; header: "auto" | "present" | "absent"; quote: '"' | "'" | "none" | "auto" };
export const defaultCsvOptions: CsvOptions = { delimiter: "auto", header: "auto", quote: "auto" };
export type UploadedWorkflowFile = { name: string; format: "json" | "csv" | "binary"; source: string; value: JsonValue;
  original?: WorkflowBinary; options: CsvOptions; delimiter: string; header: boolean; encoding: string };
export type WorkflowFileData = { file?: UploadedWorkflowFile };
export type FileValueType = "Text" | "Integer" | "Number" | "Boolean" | "Object" | "Array" | "Null" | "Unknown" | "Binary";

export function fileValueType(file?: UploadedWorkflowFile): FileValueType {
  if (!file) return "Unknown";
  if (file.format === "binary") return "Binary";
  const value = file.value;
  if (value === null) return "Null";
  if (Array.isArray(value)) return "Array";
  if (typeof value === "object") return "Object";
  if (typeof value === "number") return Number.isInteger(value) ? "Integer" : "Number";
  return typeof value === "boolean" ? "Boolean" : "Text";
}

export function csvOptions(value: unknown): CsvOptions {
  const options = value as CsvOptions | null;
  if (!options || !["auto", ",", ";", "\t", "|"].includes(options.delimiter) ||
    !["auto", "present", "absent"].includes(options.header) || !['"', "'", "none", "auto"].includes(options.quote))
    throw new Error("Unsupported CSV options.");
  return { delimiter: options.delimiter, header: options.header, quote: options.quote };
}

function jsonValue(value: unknown, depth = 0, budget = { remaining: 100_000 }): JsonValue {
  if (depth > 48 || --budget.remaining < 0) throw new Error("File data is too deeply nested or has too many values.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => jsonValue(item, depth + 1, budget));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, depth + 1, budget)]));
  throw new Error("Uploaded data must contain only finite JSON values.");
}

export function validateWorkflowFileData(data: Record<string, unknown>): WorkflowFileData {
  if (data.file === undefined) return {};
  const file = data.file as UploadedWorkflowFile | null;
  if (!file || typeof file.name !== "string" || !file.name || file.name.length > 255 ||
    !["json", "csv", "binary"].includes(file.format) || file.format !== "binary" && !file.name.toLowerCase().endsWith(`.${file.format}`) ||
    typeof file.source !== "string" || new TextEncoder().encode(file.source).length > maxWorkflowUploadBytes ||
    typeof file.delimiter !== "string" || typeof file.header !== "boolean" || typeof file.encoding !== "string")
    throw new Error("Invalid uploaded workflow file.");
  const original = file.original === undefined ? undefined : validateWorkflowBinary(file.original);
  const value = file.format === "binary" ? validateWorkflowBinary(file.value) : jsonValue(file.value);
  if (original && original.name !== file.name || file.format === "binary" && ((value as WorkflowBinary).name !== file.name || file.source !== "" || original))
    throw new Error("Invalid uploaded workflow file.");
  return { file: { name: file.name, format: file.format, source: file.source, value,
    ...(original ? { original } : {}), options: csvOptions(file.options), delimiter: file.delimiter, header: file.header, encoding: file.encoding } };
}

/** Only JSON and CSV are decoded. All other files retain their original bytes. */
export function readWorkflowFile(name: string, bytes: Uint8Array, mediaType = "", options = defaultCsvOptions): UploadedWorkflowFile {
  const original = encodeWorkflowBinary(name, bytes, mediaType);
  if (/\.(?:json|csv)$/i.test(name)) {
    const decoded = decodeWorkflowFile(bytes);
    return { ...parseWorkflowFile(name, decoded.source, options, decoded.encoding), original };
  }
  return { name, format: "binary", source: "", value: original, options: csvOptions(options), delimiter: "", header: false, encoding: "binary" };
}

export function parseWorkflowFile(name: string, source: string, options: CsvOptions = defaultCsvOptions, encoding = "utf-8"): UploadedWorkflowFile {
  const format = /\.json$/i.test(name) ? "json" : /\.csv$/i.test(name) ? "csv" : undefined;
  if (!format) throw new Error("Only JSON and CSV files are supported.");
  if (new TextEncoder().encode(source).length > maxWorkflowUploadBytes) throw new Error("Files must be no larger than 500 kB.");
  source = source.replace(/^\uFEFF/, "");
  if (!source.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source))
    throw new Error("The file is empty or contains unsupported binary data.");
  options = csvOptions(options);
  if (format === "json") return validateWorkflowFileData({ file: { name, format, source,
    value: JSON.parse(source), options, delimiter: "", header: false, encoding } }).file!;
  const directive = /^sep=([,;\t|])(?:\r\n|\n|\r)/i.exec(source);
  const delimiter = options.delimiter === "auto" ? directive?.[1] : options.delimiter;
  const csv = directive ? source.slice(directive[0].length) : source;
  // Only quotes at field boundaries indicate quoting; apostrophes inside words do not.
  const openings = [...csv.matchAll(/(?:^|[,;\t|\r\n])(["'])/g)].map(match => match[1]);
  const detectedQuote = openings.includes('"') ? '"' : openings.includes("'") ? "'" : "none";
  const selectedQuote = options.quote === "auto" ? detectedQuote : options.quote;
  const noQuotes = selectedQuote === "none";
  // Papa's delimiter guesser assumes double quotes. Mask them for literal-quote mode.
  const detectedDelimiter = noQuotes && !delimiter ? Papa.parse(csv.replace(/"/g, "＂"), {
    delimitersToGuess: [",", ";", "\t", "|"], skipEmptyLines: "greedy", preview: 10,
  }).meta.delimiter : delimiter;
  const quote = noQuotes ? "\0" : selectedQuote;
  const result = Papa.parse<string[]>(csv, {
    delimiter: detectedDelimiter ?? "", quoteChar: quote, escapeChar: quote, fastMode: noQuotes ? true : undefined,
    delimitersToGuess: [",", ";", "\t", "|"], skipEmptyLines: "greedy", dynamicTyping: false,
  });
  const failure = result.errors.find(error => error.code !== "UndetectableDelimiter");
  if (failure) throw new Error(`Invalid CSV: ${failure.message}`);
  const rows = result.data;
  const first = rows[0];
  if (!first || rows.length > 10_000 || first.length > 1000) throw new Error("CSV must contain 1–10,000 rows and at most 1000 columns.");
  if (rows.some(row => row.length !== first.length)) throw new Error("CSV rows must have the same number of columns.");
  const header = options.header === "present" || options.header === "auto" && rows.length > 1 &&
    first.every(cell => !!cell.trim() && !/^(?:[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?|true|false|null)$/i.test(cell.trim())) && new Set(first).size === first.length;
  if (header && (first.some(cell => !cell.trim()) || new Set(first).size !== first.length))
    throw new Error("CSV headers must be nonempty and unique. Choose No header to retain these cells as data.");
  const data = header ? rows.slice(1) : rows;
  const numeric = first.map((_, index) => data.length > 0 && data.every(row => {
    const text = row[index]!.trim();
    const value = Number(text);
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value));
  }));
  const boolean = first.map((_, index) => data.length > 0 && data.every(row => /^(?:true|false)$/i.test(row[index]!.trim())));
  const converted = data.map(row => row.map((cell, index) => boolean[index] ? cell.trim().toLowerCase() === "true" : numeric[index] ? Number(cell) : cell));
  const value = header ? converted.map(row => Object.fromEntries(first.map((key, index) => [key, row[index]! ]))) : converted;
  return validateWorkflowFileData({ file: { name, format, source, value, options,
    delimiter: result.meta.delimiter, header, encoding } }).file!;
}

export function decodeWorkflowFile(bytes: Uint8Array): { source: string; encoding: string } {
  if (bytes.byteLength > maxWorkflowUploadBytes) throw new Error("Files must be no larger than 500 kB.");
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" :
    bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  try { return { source: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding }; }
  catch {
    if (encoding !== "utf-8") throw new Error("The file contains invalid UTF-16 data.");
    return { source: new TextDecoder("windows-1252", { fatal: true }).decode(bytes), encoding: "windows-1252" };
  }
}
