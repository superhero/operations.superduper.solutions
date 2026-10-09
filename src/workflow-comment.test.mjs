// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { commentBlocks } from "./components/workflows/workflow-comment-markdown.ts";

const text = text => ({ type: "text", text });
const paragraph = value => ({ type: "paragraph", children: [text(value)] });

Then("workflow comment previews support headings paragraphs lists quotes and code", function () {
  assert.deepEqual(commentBlocks("# Plan\n\nReview the fields.\nKeep this line.\n## Checks ##\n- First\n- Second\n1. One\n2) Two\n\n> Remember\n> the inputs\n\n---\n\n```json\n{\"id\":1}\n```\n\n~~~\nraw code\n~~~~"), [
    { type: "heading", level: 1, children: [text("Plan")] },
    paragraph("Review the fields.\nKeep this line."),
    { type: "heading", level: 2, children: [text("Checks")] },
    { type: "list", ordered: false, items: [[text("First")], [text("Second")]] },
    { type: "list", ordered: true, items: [[text("One")], [text("Two")]] },
    { type: "quote", children: [text("Remember\nthe inputs")] },
    { type: "rule" },
    { type: "code", text: '{"id":1}' },
    { type: "code", text: "raw code" },
  ]);
  assert.deepEqual(commentBlocks("Paragraph\n> Quote\nAfter quote\n***\n### Heading\n+ Item\n~~~\nCode"), [
    paragraph("Paragraph"), { type: "quote", children: [text("Quote")] }, paragraph("After quote"),
    { type: "rule" }, { type: "heading", level: 3, children: [text("Heading")] },
    { type: "list", ordered: false, items: [[text("Item")]] }, { type: "code", text: "Code" },
  ]);
  assert.deepEqual(commentBlocks("___\n* * *\n- - -"), [{ type: "rule" }, { type: "rule" }, { type: "rule" }]);
});

Then("workflow comment previews support emphasis code and safe links", function () {
  assert.deepEqual(commentBlocks("Before **bold** __also bold__ *emphasis* _also emphasis_ ~~old~~ `value` after"), [{
    type: "paragraph", children: [text("Before "), { type: "strong", children: [text("bold")] }, text(" "),
      { type: "strong", children: [text("also bold")] }, text(" "), { type: "em", children: [text("emphasis")] }, text(" "),
      { type: "em", children: [text("also emphasis")] }, text(" "), { type: "del", children: [text("old")] }, text(" "),
      { type: "code", text: "value" }, text(" after")],
  }]);
  for (const [url, expected] of [["https://example.com", "https://example.com/"], ["http://example.com/docs", "http://example.com/docs"], ["mailto:review@example.com", "mailto:review@example.com"]]) {
    assert.deepEqual(commentBlocks(`[**Guide**](${url})`), [{ type: "paragraph", children: [{ type: "link", href: expected,
      children: [{ type: "strong", children: [text("Guide")] }] }] }]);
  }
  assert.deepEqual(commentBlocks("__~~*nested*~~__"), [{ type: "paragraph", children: [{ type: "strong", children: [
    { type: "del", children: [{ type: "em", children: [text("nested")] }] },
  ] }] }]);
});

Then("workflow comment previews do not interpret raw HTML images or unsafe links", function () {
  const raw = '<script>globalThis.executed = true</script><img src="https://example.com/track" onerror="alert(1)">';
  assert.deepEqual(commentBlocks(raw), [paragraph(raw)]);
  for (const destination of ["javascript:alert", "data:text/html,unsafe", "file:///etc/passwd", "/relative", "not-a-url", "https://example.com/\u0000bad", "https://example.com/\u007fbad"]) {
    const value = `[Bad](${destination})`;
    assert.deepEqual(commentBlocks(value), [paragraph(value)], destination);
  }
  const image = "![Tracking image](https://example.com/tracker.png)";
  assert.deepEqual(commentBlocks(image), [paragraph(image)]);
  assert.deepEqual(commentBlocks("```html\n" + raw + "\n```"), [{ type: "code", text: raw }]);
});

Then("workflow comment previews retain incomplete formatting and normalize line endings", function () {
  assert.deepEqual(commentBlocks(" \r\n\r\n"), []);
  assert.deepEqual(commentBlocks("First\r\nSecond\rThird"), [paragraph("First\nSecond\nThird")]);
  for (const value of ["**unfinished", "[unfinished](", "`unfinished", "![unfinished", "#No heading"]) {
    assert.deepEqual(commentBlocks(value), [paragraph(value)]);
  }
  assert.deepEqual(commentBlocks("```\nkeep\nall\nlines"), [{ type: "code", text: "keep\nall\nlines" }]);
  assert.deepEqual(commentBlocks("```\n```"), [{ type: "code", text: "" }]);
  assert.deepEqual(commentBlocks("> Last quote"), [{ type: "quote", children: [text("Last quote")] }]);
  assert.deepEqual(commentBlocks("- Last item"), [{ type: "list", ordered: false, items: [[text("Last item")]] }]);
  assert.deepEqual(commentBlocks("Paragraph\n```\ncode\n```"), [paragraph("Paragraph"), { type: "code", text: "code" }]);
});
