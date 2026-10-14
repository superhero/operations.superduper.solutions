// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";

Then("the page declares stable raster fallbacks and retains its embedded SVG icon", async function () {
  const links = await this.page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]')
    .evaluateAll(elements => elements.map(element => ({ rel: element.rel, href: element.getAttribute("href"), type: element.type, sizes: element.sizes.value })));
  assert.equal(links.length, 4, "Only ICO, PNG, SVG, and Apple touch icons should be declared");
  for (const [href, rel, type, sizes] of [
    ["./favicon.ico", "icon", "image/x-icon", "16x16 32x32 48x48"],
    ["./favicon.png", "icon", "image/png", "96x96"],
    ["./apple-touch-icon.png", "apple-touch-icon", "image/png", "180x180"],
  ]) {
    const link = links.find(link => link.href === href);
    assert.ok(link, `Missing stable fallback: ${href}`);
    assert.deepEqual(link, { rel, href, type, sizes });
  }
  const svg = links.find(link => link.type === "image/svg+xml");
  assert.ok(svg, "Missing scalable favicon");
  assert.equal(svg.rel, "icon");
  assert.equal(svg.sizes, "any");
  assert.match(svg.href, /^data:image\/svg\+xml[;,]/);
  assert.equal(links.filter(link => link.rel === "icon").at(-1), svg,
    "The scalable candidate must follow equally suitable raster candidates");
});

Then("the hosted favicon {string} is available as {string}", async function (filename, type) {
  // Playwright 1.63 aborts intercepted URLs ending /favicon.ico before route
  // handlers run. Its HTTP client still verifies the exact hosted asset URL.
  if (filename === "favicon.ico") {
    const response = await this.context.request.get(`${this.baseURL}/${filename}`);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["content-type"]?.split(";")[0], type);
    assert.ok((await response.body()).byteLength > 0);
    return;
  }
  const result = await this.page.evaluate(async filename => {
    const response = await fetch(`./${filename}`);
    return { status: response.status, type: response.headers.get("content-type"), size: (await response.arrayBuffer()).byteLength };
  }, filename);
  assert.equal(result.status, 200);
  assert.equal(result.type?.split(";")[0], type);
  assert.ok(result.size > 0, `${filename} must contain an actual image payload`);
});

Then("Chromium decodes favicon {string} as {int} by {int} pixels", async function (filename, width, height) {
  let source = `./${filename}`;
  if (filename === "favicon.ico") {
    // Exercise Chromium's decoder with the exact HTTP bytes despite Playwright's
    // special favicon routing suppression, without inventing a second icon URL.
    const response = await this.context.request.get(`${this.baseURL}/${filename}`);
    assert.equal(response.status(), 200);
    source = `data:image/x-icon;base64,${(await response.body()).toString("base64")}`;
  }
  const dimensions = await this.page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, source);
  assert.deepEqual(dimensions, { width, height });
});
