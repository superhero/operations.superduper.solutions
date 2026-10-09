// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

export type CommentInline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em" | "del"; children: CommentInline[] }
  | { type: "link"; children: CommentInline[]; href: string };
export type CommentBlock =
  | { type: "paragraph" | "quote"; children: CommentInline[] }
  | { type: "heading"; level: number; children: CommentInline[] }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: CommentInline[][] }
  | { type: "rule" };

function safeLink(value: string): string | undefined {
  if (/[\u0000-\u0020\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

// Produce an escaped text tree, never HTML. Image syntax remains literal and no
// external resource is loaded merely by opening or editing an annotation.
// Each inline pattern excludes its own delimiter from its content, so recursive
// formatting can only consume the remaining delimiter kinds; nesting is bounded.
function inline(text: string): CommentInline[] {
  const result: CommentInline[] = [];
  const pattern = /!?\[[^\]\n]+\]\([^\)\s]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) result.push({ type: "text", text: text.slice(cursor, match.index) });
    const token = match[0];
    const link = /^(!?)\[([^\]\n]+)\]\(([^\)\s]+)\)$/.exec(token);
    if (link) {
      const href = link[1] ? undefined : safeLink(link[3]!);
      result.push(href ? { type: "link", href, children: inline(link[2]!) } : { type: "text", text: token });
    } else if (token.startsWith("`")) result.push({ type: "code", text: token.slice(1, -1) });
    else {
      const doubled = token.startsWith("**") || token.startsWith("__") || token.startsWith("~~");
      const type = token.startsWith("~~") ? "del" : doubled ? "strong" : "em";
      result.push({ type, children: inline(token.slice(doubled ? 2 : 1, doubled ? -2 : -1)) });
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) result.push({ type: "text", text: text.slice(cursor) });
  return result;
}

const fence = (line: string) => /^ {0,3}(`{3,}|~{3,})/.exec(line);
const heading = (line: string) => /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
const item = (line: string) => /^ {0,3}([-+*]|\d+[.)])\s+(.+)$/.exec(line);
const quote = (line: string) => /^ {0,3}>\s?(.*)$/.exec(line);
const rule = (line: string) => /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);

export function commentBlocks(text: string): CommentBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: CommentBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index++]!;
    if (!line.trim()) continue;
    const code = fence(line);
    if (code) {
      const content: string[] = [];
      const marker = code[1]!;
      while (index < lines.length) {
        const next = lines[index++]!;
        if (new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(next)) break;
        content.push(next);
      }
      blocks.push({ type: "code", text: content.join("\n") });
      continue;
    }
    const title = heading(line);
    if (title) { blocks.push({ type: "heading", level: title[1]!.length, children: inline(title[2]!) }); continue; }
    if (rule(line)) { blocks.push({ type: "rule" }); continue; }
    const firstItem = item(line);
    if (firstItem) {
      const ordered = /^\d/.test(firstItem[1]!);
      const items = [inline(firstItem[2]!)];
      while (index < lines.length) {
        const next = item(lines[index]!);
        if (!next || /^\d/.test(next[1]!) !== ordered) break;
        items.push(inline(next[2]!)); index++;
      }
      blocks.push({ type: "list", ordered, items }); continue;
    }
    const firstQuote = quote(line);
    if (firstQuote) {
      const content = [firstQuote[1]!];
      while (index < lines.length) {
        const next = quote(lines[index]!);
        if (!next) break;
        content.push(next[1]!); index++;
      }
      blocks.push({ type: "quote", children: inline(content.join("\n")) }); continue;
    }
    const content = [line];
    while (index < lines.length) {
      const next = lines[index]!;
      if (!next.trim() || fence(next) || heading(next) || item(next) || quote(next) || rule(next)) break;
      content.push(next); index++;
    }
    blocks.push({ type: "paragraph", children: inline(content.join("\n")) });
  }
  return blocks;
}
