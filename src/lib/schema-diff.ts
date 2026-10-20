// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type SchemaDiffLine = { number: number; text: string; kind: "context" | "added" | "removed" };
export type SchemaDiffRow = { before?: SchemaDiffLine; after?: SchemaDiffLine; omitted?: number };
export type SchemaFieldDiff = { before: boolean; after: boolean; rows: SchemaDiffRow[]; truncated: boolean; textTruncated: boolean; coarse: boolean };
type Run = { kind: "context" | "added" | "removed"; before: number; after: number; length: number };

/** Line changes in the actual JSON values, never abbreviated schema previews.
 * Bound matching work; a very large unmatched region remains an exact replacement.
 * Context folding and output bounds do not alter the immutable source values.
 */
export function schemaLineDiff(before: string | undefined, after: string | undefined, limit = 200): SchemaFieldDiff {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error("Choose 1–5000 diff rows.");
  const result: SchemaFieldDiff = { before: before !== undefined, after: after !== undefined, rows: [], truncated: false, textTruncated: false, coarse: false };
  if (before === after) return result;
  const left = before === undefined ? [] : before.split("\n");
  const right = after === undefined ? [] : after.split("\n");
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
  let end = 0;
  while (end < Math.min(left.length, right.length) - start && left[left.length - end - 1] === right[right.length - end - 1]) end++;
  const oldLength = left.length - start - end;
  const newLength = right.length - start - end;
  const runs: Run[] = [];
  function append(kind: Run["kind"], before: number, after: number, length = 1) {
    if (!length) return;
    const previous = runs.at(-1);
    if (previous?.kind === kind) previous.length += length;
    else runs.push({ kind, before, after, length });
  }
  append("context", 0, 0, start);
  if (oldLength && newLength && (oldLength + 1) * (newLength + 1) <= 1_000_000) {
    const width = newLength + 1;
    const lengths = new Uint32Array((oldLength + 1) * width);
    for (let old = oldLength - 1; old >= 0; old--) for (let next = newLength - 1; next >= 0; next--)
      lengths[old * width + next] = left[start + old] === right[start + next]
        ? 1 + lengths[(old + 1) * width + next + 1]!
        : Math.max(lengths[(old + 1) * width + next]!, lengths[old * width + next + 1]!);
    let old = 0; let next = 0;
    while (old < oldLength || next < newLength) {
      if (old < oldLength && next < newLength && left[start + old] === right[start + next]) {
        append("context", start + old, start + next); old++; next++;
      } else if (old < oldLength && (next === newLength || lengths[(old + 1) * width + next]! >= lengths[old * width + next + 1]!)) {
        append("removed", start + old, start + next); old++;
      } else { append("added", start + old, start + next); next++; }
    }
  } else {
    result.coarse = oldLength > 0 && newLength > 0;
    append("removed", start, start, oldLength);
    append("added", start + oldLength, start, newLength);
  }
  append("context", left.length - end, right.length - end, end);

  function* rows(): Generator<SchemaDiffRow> {
    for (let index = 0; index < runs.length; index++) {
      const run = runs[index]!;
      if (run.kind === "context") {
        const first = index === 0 ? Math.max(0, run.length - 3) : 0;
        const last = index === runs.length - 1 ? Math.min(run.length, 3) : run.length;
        for (let offset = first; offset < last; offset++) {
          if (run.length > 6 && offset === 3 && index > 0 && index < runs.length - 1) {
            yield { omitted: run.length - 6 }; offset = run.length - 4; continue;
          }
          yield { before: { number: run.before + offset + 1, text: left[run.before + offset]!, kind: "context" },
            after: { number: run.after + offset + 1, text: right[run.after + offset]!, kind: "context" } };
        }
      } else {
        const removed = run.kind === "removed" ? run : undefined;
        const added = run.kind === "added" ? run : runs[index + 1]?.kind === "added" ? runs[++index] : undefined;
        for (let offset = 0; offset < Math.max(removed?.length ?? 0, added?.length ?? 0); offset++)
          yield { ...(removed && offset < removed.length ? { before: { number: removed.before + offset + 1,
            text: left[removed.before + offset]!, kind: "removed" as const } } : {}),
          ...(added && offset < added.length ? { after: { number: added.after + offset + 1,
            text: right[added.after + offset]!, kind: "added" as const } } : {}) };
      }
    }
  }
  let remaining = 512 * 1024;
  const encoder = new TextEncoder();
  for (const row of rows()) {
    if (result.rows.length === limit || remaining <= 0) { result.truncated = true; break; }
    for (const line of [row.before, row.after]) if (line) {
      const bytes = encoder.encode(line.text).byteLength;
      if (bytes > remaining) {
        // encodeInto ends on a complete code point; never invent a replacement
        // character by slicing a multibyte character or a surrogate pair.
        const { read, written } = encoder.encodeInto(line.text, new Uint8Array(remaining));
        line.text = line.text.slice(0, read); remaining -= written;
        result.truncated = true; result.textTruncated = true;
      } else remaining -= bytes;
    }
    result.rows.push(row);
    if (result.textTruncated) break;
  }
  return result;
}

/** Own-property JSON pointer lookup: missing and null remain distinct. */
export function schemaPointerValue(document: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) throw new Error("Choose a valid schema field path.");
  let value = document;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
