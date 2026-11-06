// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
/** RFC 6839 structured +json media use JSON syntax with their own Content-Type. */
export function isJsonRequestMediaType(media: string): boolean {
  return media === media.trim() && /^(?:application\/json|[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+\+json)$/i.test(media);
}

/** YAML 1.2 accepts the JSON flow representation of structured input values. */
export function isYamlRequestMediaType(media: string): boolean {
  return media === media.trim() && /^(?:application\/(?:x-)?yaml|text\/(?:x-)?yaml)$/i.test(media);
}

export function isJsonLinesRequestMediaType(media: string): boolean {
  return media.toLowerCase() === "application/jsonl";
}

/** Validate line framing without rewriting whitespace, Unicode or CRLF bytes. */
export function validateJsonLinesBody(value: unknown): void {
  if (typeof value !== "string" || !value.length) throw new Error("JSON Lines requires a nonempty text document.");
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    try { JSON.parse(line); }
    catch { throw new Error(`JSON Lines line ${index + 1} must contain exactly one JSON value.`); }
  }
}
