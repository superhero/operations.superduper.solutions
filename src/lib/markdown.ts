// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import MarkdownIt from "markdown-it";
import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import { mark } from "@mdit/plugin-mark";
import { ins } from "@mdit/plugin-ins";
import { sub } from "@mdit/plugin-sub";
import { imgLazyload } from "@mdit/plugin-img-lazyload";
import { imgSize } from "@mdit/plugin-img-size";
import { sup } from "@mdit/plugin-sup";

// One configuration for every rendered Markdown surface. Raw HTML remains text;
// Plugins generate their supported markup; arbitrary source HTML stays disabled.
const markdown = new MarkdownIt({ html: false, breaks: true, maxNesting: 20 })
  .use(footnote).use(tasklist, { disabled: true }).use(mark).use(ins).use(sub).use(sup).use(imgSize).use(imgLazyload);
markdown.validateLink = href => {
  if (/[\u0000-\u0020\u007f]|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(href)) return false;
  try { return ["http:", "https:", "mailto:"].includes(new URL(href).protocol); }
  catch { return false; }
};
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index]!;
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  token.attrJoin("class", "nodrag nopan nokey");
  return renderer.renderToken(tokens, index, options);
};
// The tasklist plugin uses per-render IDs; namespace both sides of its labels.
for (const name of ["checkbox_input", "label_open"]) {
  markdown.renderer.rules[name] = (tokens, index, options, env, renderer) => {
    const token = tokens[index]!;
    const attribute = name === "checkbox_input" ? "id" : "for";
    const value = token.attrGet(attribute);
    if (value) token.attrSet(attribute, `${env?.docId ?? "markdown"}-${value}`);
    return renderer.renderToken(tokens, index, options);
  };
}
export function renderMarkdown(text: string, scope: string): string {
  // Footnote IDs are unique to a rendered surface and cannot inject attributes.
  const docId = Array.from(scope, char => char.codePointAt(0)!.toString(16)).join("-");
  return markdown.render(text, { docId: `markdown-${docId}` });
}
