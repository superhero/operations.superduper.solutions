// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { renderMarkdown } from "./lib/markdown.ts";
const render = text => renderMarkdown(text, "comment-test");

Then("workflow comment previews support headings paragraphs lists quotes and code", () => {
  const html = render('# Plan\n\nReview the fields.\nKeep this line.\n\n- First\n  - Nested\n\n3. Third\n\n> Remember\n> the inputs\n\n---\n\n```json\n{"id":1}\n```');
  for (const pattern of [/<h1>Plan<\/h1>/, /Review the fields.<br>\nKeep this line./, /<ul>/, /Nested/, /<ol start="3">/, /<blockquote>/, /<hr>/, /<pre><code class="language-json">/]) assert.match(html, pattern);
  assert.match(render('| Name | Value |\n| --- | --- |\n| item | 1 |'), /<table>/);
});
Then("workflow comment previews support emphasis code and safe links", () => {
  const html = render('Before **bold** __also bold__ *emphasis* _also emphasis_ ~~old~~ `value`');
  for (const pattern of [/<strong>bold<\/strong>/, /<em>emphasis<\/em>/, /<s>old<\/s>/, /<code>value<\/code>/]) assert.match(html, pattern);
  for (const url of ['https://example.com', 'http://example.com/docs', 'mailto:review@example.com']) {
    const link = render(`[**Guide**](${url})`);
    assert.match(link, /<a href="/); assert.match(link, /target="_blank"/); assert.match(link, /rel="noopener noreferrer"/); assert.match(link, /<strong>Guide<\/strong>/);
  }
});
Then("workflow comment previews render Markdown images while rejecting raw HTML and unsafe links", () => {
  const raw = '<script>globalThis.executed = true</script><img src="https://example.com/track" onerror="alert(1)">';
  const html = render(raw);
  assert.ok(!/<(?:script|img)\b/.test(html)); assert.match(html, /&lt;script&gt;/);
  for (const url of ['javascript:alert', 'data:text/html,unsafe', 'file:///etc/passwd', '/relative', 'not-a-url', 'https://example.com/%00bad', 'https://example.com/%7fbad', 'jav&#x61;script:alert(1)']) assert.ok(!render(`[Bad](${url})`).includes('<a '), url);
  const image = render('![Diagram =300x200](https://example.com/diagram.png "Diagram title")');
  for (const pattern of [/<img /, /src="https:\/\/example.com\/diagram.png"/, /alt="Diagram"/, /title="Diagram title"/, /width="300"/, /height="200"/, /loading="lazy"/]) assert.match(image, pattern);
  for (const url of ['javascript:alert', 'data:text/html,unsafe', 'file:///etc/passwd']) assert.ok(!render(`![Bad](${url})`).includes('<img'), url);
  assert.match(render('```html\n'+raw+'\n```'), /&lt;script&gt;/);
});
Then("workflow comment previews retain incomplete formatting and normalize line endings", () => {
  assert.equal(render(' \r\n\r\n'), '');
  assert.equal(render('First\r\nSecond\rThird'), render('First\nSecond\nThird'));
  for (const value of ['**unfinished', '[unfinished](', '`unfinished', '![unfinished', '#No heading']) assert.ok(render(value).includes(value));
  assert.match(render('```\nkeep\nall\nlines'), /<pre><code>keep\nall\nlines\n?<\/code><\/pre>/);
});
Then("workflow comments render mdit extensions with independent safe identifiers", () => {
  const text = '- [x] Done\n- [ ] Next\n\n==highlight== ++inserted++ H~2~O x^2^ note[^ref]\n\n[^ref]: Detail';
  const first = renderMarkdown(text, 'first'), second = renderMarkdown(text, 'second');
  for (const pattern of [/<input[^>]*checked="checked"/, /disabled="disabled"/, /<mark>highlight<\/mark>/, /<ins>inserted<\/ins>/, /<sub>2<\/sub>/, /<sup>2<\/sup>/, /class="footnotes"/]) assert.match(first, pattern);
  const ids = html => [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids(first)).size, ids(first).length, 'Task and footnote identifiers must also be unique within one comment.');
  assert.ok(ids(first).length >= 4); assert.ok(ids(first).every(id => !ids(second).includes(id)));
  for (const match of first.matchAll(/(?:for|href)="(?:#)?(markdown-[^"]+|footnote[^"]+)"/g)) assert.ok(ids(first).includes(match[1]), match[1]);
  assert.equal(renderMarkdown(text, 'first'), first);
  assert.ok(!/<script/.test(renderMarkdown(text, '\"><script>alert(1)</script>')));
});

Then("comment dimensions persist and reject invalid sizes", async function () {
  const { validateWorkflowDocument, parseWorkflowDocument } = await import('./lib/workflow-document.ts');
  const document = { version: 3, id: 'sized-comment', name: 'Comment',
    nodes: [{ id: 'comment', type: 'comment', position: { x: 0, y: 0 }, data: { text: 'Notes', width: 420, height: 260 } }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false };
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(document)).nodes[0].data, document.nodes[0].data);
  const { describeWorkflowChange } = await import('./lib/workflow-change-message.ts');
  const before = structuredClone(document); before.nodes[0].data.width = 300;
  assert.match(describeWorkflowChange(before, document), /Resize/);
  for (const key of ['width', 'height']) for (const value of [0, -1, 2001, NaN, Infinity, '300', null]) {
    const invalid = structuredClone(document); invalid.nodes[0].data[key] = value;
    assert.throws(() => validateWorkflowDocument(invalid), /dimensions/);
  }
  delete document.nodes[0].data.width; delete document.nodes[0].data.height;
  assert.deepEqual(validateWorkflowDocument(document).nodes[0].data, {text:'Notes'});
});
