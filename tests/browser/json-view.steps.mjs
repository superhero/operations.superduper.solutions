// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, expectFieldValue, fillField, setMode } from "./workspace.steps.mjs";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";
import { metricsCacheKey } from "../../src/lib/metrics-cache.ts";
import { finishHeightAnimations, holdHeightAnimations, seekHeightAnimation } from "./height-animation.fixture.mjs";

const jsonLabel = "Operation OpenAPI JSON";
const sourceCatalog = catalogForOperation("demo:createTask");
const selectedPath = "/projects/{projectId}/tasks";
const schemaHeader = page => page.getByRole("region", { name: "Operation JSON schema", exact: true })
  .locator('summary[aria-label="OpenAPI schema"]');
const copyButton = page => schemaHeader(page).getByRole("button", { name: "Copy JSON", exact: true });
const wrapButton = page => schemaHeader(page).getByRole("button", { name: "Wrap lines", exact: true });
const viewer = page => page.getByRole("region", { name: jsonLabel, exact: true });
const branch = (page, path) => viewer(page).getByRole("group", { name: `${jsonLabel}: ${path}`, exact: true });
const heading = (page, path) => branch(page, path).locator(":scope > summary");
// The background metrics recorder refreshes its cache independently of JSON review.
const storage = page => page.evaluate(cacheKey => Object.entries(localStorage)
  .filter(([key]) => key !== cacheKey).sort(([a], [b]) => a.localeCompare(b)), metricsCacheKey);

async function expectOpen(element, open) {
  await expect.poll(() => element.evaluate(details => details.open)).toBe(open);
}

async function copyCapturedJson(page, activation = "click") {
  const count = await page.evaluate(() => window.jsonClipboardProbe.texts.length);
  const open = await schemaHeader(page).getAttribute("aria-expanded");
  if (activation === "click") await copyButton(page).click();
  else {
    await copyButton(page).focus();
    await page.keyboard.press(activation);
  }
  await expect(schemaHeader(page).getByRole("status")).toHaveText("JSON copied.");
  await expect(schemaHeader(page)).toHaveAttribute("aria-expanded", open);
  await expect.poll(() => page.evaluate(() => window.jsonClipboardProbe.texts.length)).toBe(count + 1);
  return page.evaluate(() => window.jsonClipboardProbe.texts.at(-1));
}

Given("the Example POST body JSON report is open at {int} pixels", async function (width) {
  await this.page.setViewportSize({ width, height: 900 });
  await chooseCatalogOperation(this.page, "Example POST body");
  this.jsonDraft = { "Path value": "json-review-project", Title: 'Keep "quoted" <task> & \\ draft', Priority: "normal" };
  for (const [label, value] of Object.entries(this.jsonDraft)) await fillField(this.page, label, value);
  this.jsonStorage = await storage(this.page);
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  await schemaHeader(this.page).click();
  await expect(viewer(this.page)).toBeVisible();
  await expectOpen(branch(this.page, "$"), true);
  await expect(wrapButton(this.page)).toHaveAttribute("aria-pressed", "true");
});

When("I fold the JSON root and nested operation branches with the keyboard", async function () {
  const root = heading(this.page, "$");
  const paths = '$["paths"]';
  const operation = `${paths}[${JSON.stringify(selectedPath)}]`;
  const parameters = `${operation}["parameters"]`;
  const taskSchema = '$["components"]["schemas"]["NewTask"]';
  const priorityChoices = `${taskSchema}["properties"]["priority"]["enum"]`;
  await expect.poll(() => viewer(this.page).getByRole("group").evaluateAll(elements =>
    elements.length > 0 && elements.every(element => element.open))).toBe(true);
  for (const path of [operation, parameters, `${parameters}[0]`, `${taskSchema}["required"]`, priorityChoices,
    `${operation}["post"]["requestBody"]["content"]["application/json"]["schema"]`])
    await expectOpen(branch(this.page, path), true);
  await expect(branch(this.page, priorityChoices)).toContainText('"high"');

  await heading(this.page, `${parameters}[0]`).focus();
  await this.page.keyboard.press("Enter");
  await expectOpen(branch(this.page, `${parameters}[0]`), false);

  const operationHeading = heading(this.page, operation);
  await operationHeading.focus();
  await this.page.keyboard.press("Space");
  await expectOpen(branch(this.page, operation), false);
  await expect(branch(this.page, parameters)).toHaveCount(0);
  await expect(operationHeading).toBeFocused();
  await this.page.keyboard.press("Enter");
  await expectOpen(branch(this.page, parameters), true);
  await expectOpen(branch(this.page, `${parameters}[0]`), false);
  await heading(this.page, `${parameters}[0]`).focus();
  await this.page.keyboard.press("Space");
  await expectOpen(branch(this.page, `${parameters}[0]`), true);
  await expect(branch(this.page, `${parameters}[0]`)).toContainText('"#/components/parameters/ProjectId"');

  await heading(this.page, parameters).focus();
  await this.page.keyboard.press("Space");
  await expectOpen(branch(this.page, parameters), false);
  await root.focus();
  await this.page.keyboard.press("Enter");
  await expectOpen(branch(this.page, "$"), false);
  await expect(branch(this.page, paths)).toHaveCount(0);
  await expect(root).toBeFocused();
  await this.page.keyboard.press("Space");
  await expectOpen(branch(this.page, "$"), true);
  await expectOpen(branch(this.page, operation), true);
  await expectOpen(branch(this.page, parameters), false);
  await expectOpen(branch(this.page, priorityChoices), true);
  await heading(this.page, parameters).focus();
  await this.page.keyboard.press("Enter");
  await expectOpen(branch(this.page, parameters), true);
  await expectOpen(branch(this.page, `${parameters}[0]`), true);
  await expect(branch(this.page, `${parameters}[0]`)).toContainText('"#/components/parameters/ProjectId"');
});

When("I reverse a sliding JSON branch and enable reduced motion", async function () {
  const page = this.page;
  const operation = `$["paths"][${JSON.stringify(selectedPath)}]`;
  const nested = `${operation}["parameters"][0]`;
  await heading(page, nested).press("Enter");
  await expectOpen(branch(page, nested), false);
  const parent = branch(page, operation);
  const summary = heading(page, operation);
  const panel = parent.locator(":scope > .disclosure-panel");
  const expectSliding = async opening => {
    await expect.poll(() => panel.evaluate((element, expanding) => {
      const sliding = element.getAnimations().filter(animation => {
        const frames = animation.effect.getKeyframes();
        const first = Number.parseFloat(frames[0]?.height);
        const last = Number.parseFloat(frames.at(-1)?.height);
        return expanding ? last > first : first > last;
      });
      return sliding.length;
    }, opening)).toBeGreaterThan(0);
    const frame = await seekHeightAnimation(panel, 0.5);
    assert.ok(frame.running, "The captured JSON animation must still be running.");
    assert.ok(frame.height > Math.min(frame.from, frame.to) + 1 && frame.height < Math.max(frame.from, frame.to) - 1,
      "The JSON branch must reach an intermediate height before reversal or reduced motion.");
    await expect(summary).toBeFocused();
  };
  const finishSlide = () => finishHeightAnimations(panel);
  const restoreCapture = await holdHeightAnimations(panel);
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await summary.press("Space");
    await expect(summary).toHaveAttribute("aria-expanded", "false");
    await expectSliding(false);
    await expectOpen(parent, true);
    await summary.press("Enter");
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await expectSliding(true);
    await finishSlide();
    await expectOpen(parent, true);
    await expectOpen(branch(page, nested), false);

    await summary.press("Space");
    await expectSliding(false);
    await finishSlide();
    await expectOpen(parent, false);
    await expect(summary).toBeFocused();
    await summary.press("Enter");
    await expectSliding(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expectOpen(parent, true);
    await expect.poll(() => panel.evaluate(element => element.getAnimations().length)).toBe(0);
    for (const open of [false, true]) {
      await summary.press("Space");
      await expectOpen(parent, open);
      await expect(summary).toBeFocused();
      assert.equal(await panel.evaluate(element => element.getAnimations().length), 0, "Reduced-motion folding must not slide.");
    }
    await expectOpen(branch(page, nested), false);
  } finally { await restoreCapture(); }
});

When("I copy the complete JSON across folding wrapping and clipboard failures", async function () {
  await this.page.evaluate(() => {
    window.jsonClipboardProbe = { texts: [], reject: false };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      async writeText(text) {
        if (window.jsonClipboardProbe.reject) throw new Error("Clipboard denied for this test");
        window.jsonClipboardProbe.texts.push(text);
      }
    } });
  });
  const originalText = await copyCapturedJson(this.page);
  const original = JSON.parse(originalText);
  assert.equal(original.info.title, sourceCatalog.name);
  assert.deepEqual(original.servers.map(server => server.url), [sourceCatalog.execution.origin]);
  assert.deepEqual(Object.keys(original.paths), [selectedPath]);
  const operation = original.paths[selectedPath];
  assert.equal(operation.post.operationId, "createTask");
  assert.equal(operation.parameters[0].$ref, "#/components/parameters/ProjectId");
  assert.equal(operation.post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/NewTask");
  assert.equal(original.components.parameters.ProjectId.name, "projectId");
  assert.equal(original.components.schemas.NewTask.properties.title.maxLength, 120);
  assert.deepEqual(original.components.schemas.NewTask.required, ["title", "priority"]);
  assert.equal(original.components.schemas.NewTask.additionalProperties, false);
  assert.doesNotMatch(originalText, /"(?:listProjects|getProject|updateTask)"/);
  assert.ok(!originalText.includes(this.jsonDraft.Title), "Schema copying must not include form input values.");

  await heading(this.page, "$").focus();
  await this.page.keyboard.press("Enter");
  await expectOpen(branch(this.page, "$"), false);
  await wrapButton(this.page).focus();
  await this.page.keyboard.press("Space");
  await expect(wrapButton(this.page)).toHaveAttribute("aria-pressed", "false");
  await expect(wrapButton(this.page)).toBeFocused();
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "true");
  assert.equal(await copyCapturedJson(this.page, "Enter"), originalText, "Folding and wrapping must not change the copied document.");
  await expectOpen(branch(this.page, "$"), false);

  await schemaHeader(this.page).focus();
  await this.page.keyboard.press("Enter");
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "false");
  await expect(viewer(this.page)).toHaveCount(0);
  await expect(wrapButton(this.page)).toBeHidden();
  await expect(copyButton(this.page)).toBeVisible();
  assert.equal(await copyCapturedJson(this.page), originalText, "Copy remains available with the outer schema disclosure closed.");
  assert.equal(await copyCapturedJson(this.page, "Space"), originalText, "Keyboard copying must leave the outer schema disclosure closed.");

  const copiedBeforeFailure = await this.page.evaluate(() => window.jsonClipboardProbe.texts.length);
  await this.page.evaluate(() => { window.jsonClipboardProbe.reject = true; });
  await copyButton(this.page).focus();
  await this.page.keyboard.press("Enter");
  await expect(schemaHeader(this.page).getByRole("status")).toHaveText("Could not copy JSON. Check clipboard access and try again.");
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "false");
  assert.equal(await this.page.evaluate(() => window.jsonClipboardProbe.texts.length), copiedBeforeFailure);
  await this.page.evaluate(() => { window.jsonClipboardProbe.reject = false; });
  assert.equal(await copyCapturedJson(this.page, "Enter"), originalText);
  await schemaHeader(this.page).focus();
  await this.page.keyboard.press("Space");
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "true");
  await expect(viewer(this.page)).toBeVisible();
  await expect(wrapButton(this.page)).toHaveAttribute("aria-pressed", "false");
});

When("I read wrapped and unwrapped JSON on the narrow screen", async function () {
  await schemaHeader(this.page).scrollIntoViewIfNeeded();
  const headerBounds = await schemaHeader(this.page).boundingBox();
  assert.ok(headerBounds);
  for (const button of [copyButton(this.page), wrapButton(this.page)]) {
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    assert.ok(bounds);
    assert.ok(bounds.x >= headerBounds.x && bounds.x + bounds.width <= headerBounds.x + headerBounds.width &&
      bounds.y >= headerBounds.y && bounds.y + bounds.height <= headerBounds.y + headerBounds.height,
    "JSON actions must remain inside their disclosure header on the narrow screen.");
  }
  const document = viewer(this.page).getByRole("document", { name: `Read-only ${jsonLabel}`, exact: true });
  const dimensions = () => document.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
  await document.scrollIntoViewIfNeeded();
  await expect.poll(async () => { const size = await dimensions(); return size.content <= size.width + 1; }).toBe(true);
  await expect(viewer(this.page)).toContainText(JSON.stringify(sourceCatalog.name));
  const wrapping = wrapButton(this.page);
  await wrapping.click();
  await expect(wrapping).toHaveAttribute("aria-pressed", "false");
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => { const size = await dimensions(); return size.content > size.width; }).toBe(true);
  assert.equal(await this.page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth), true,
    "Unwrapped JSON must scroll inside its reader instead of widening the page.");
  await heading(this.page, "$").focus();
  await this.page.keyboard.press("ArrowRight");
  await expect.poll(() => document.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await wrapping.click();
  await expect(wrapping).toHaveAttribute("aria-pressed", "true");
  await expect(schemaHeader(this.page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => { const size = await dimensions(); return size.content <= size.width + 1; }).toBe(true);
  assert.equal(await this.page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth), true);
});

When("delayed clipboard success and failure leave the JSON controls in place", async function () {
  const page = this.page;
  const copy = copyButton(page);
  const header = schemaHeader(page);
  await page.evaluate(() => {
    window.jsonClipboardProbe = { calls: 0 };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText() {
        window.jsonClipboardProbe.calls += 1;
        return new Promise((resolve, reject) => {
          window.jsonClipboardProbe.resolve = resolve;
          window.jsonClipboardProbe.reject = reject;
        });
      }
    } });
  });
  await page.mouse.move(0, 0);
  await copy.scrollIntoViewIfNeeded();
  await copy.focus();
  const original = await copy.elementHandle();
  const layout = async () => Promise.all([
    header.boundingBox(), viewer(page).boundingBox(), copy.boundingBox(),
    page.evaluate(() => ({ x: scrollX, y: scrollY }))
  ]);
  const baseline = await layout();
  const expectStable = async () => {
    assert.equal(await copy.evaluate((button, previous) => button === previous, original), true,
      "Copying must preserve the original focused button.");
    await expect(copy).toBeFocused();
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(viewer(page)).toBeVisible();
    await expect.poll(layout).toEqual(baseline);
  };
  try {
    for (const [index, outcome] of ["success", "failure"].entries()) {
      await page.keyboard.press("Enter");
      await expect(copy).toHaveAttribute("aria-busy", "true");
      await expect(copy).toHaveAttribute("aria-disabled", "true");
      assert.equal(await copy.evaluate(button => button.disabled), false, "A pending copy must retain native focusability.");
      await expectStable();
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => window.jsonClipboardProbe.calls), index + 1, "Repeated activation must not start another pending copy.");
      await page.evaluate(result => {
        if (result === "success") window.jsonClipboardProbe.resolve();
        else window.jsonClipboardProbe.reject(new Error("Clipboard denied for this test"));
      }, outcome);
      await expect(header.getByRole("status")).toHaveText(outcome === "success"
        ? "JSON copied." : "Could not copy JSON. Check clipboard access and try again.");
      await expect(copy).not.toHaveAttribute("aria-busy", "true");
      await expect(copy).not.toHaveAttribute("aria-disabled", "true");
      await expectStable();
    }
  } finally { await original.dispose(); }
});

When("the cached metrics report refreshes while I review JSON", async function () {
  await expect.poll(() => this.page.evaluate(key => JSON.parse(localStorage.getItem(key))?.report?.collectedAt ?? null,
    metricsCacheKey)).not.toBeNull();
  const timestamps = await this.page.evaluate(key => {
    // Clone the real recorder payload so this refresh remains a valid cache entry.
    const payload = JSON.parse(localStorage.getItem(key));
    const before = payload.report.collectedAt;
    payload.report.collectedAt = Math.max(Date.now(), before + 1);
    localStorage.setItem(key, JSON.stringify(payload));
    return { before, after: JSON.parse(localStorage.getItem(key)).report.collectedAt };
  }, metricsCacheKey);
  assert.ok(timestamps.after > timestamps.before, "The regression must refresh the cached metrics report during JSON review.");
});

Then("reviewing JSON has left the operation draft and non-metric local storage unchanged", async function () {
  for (const [label, value] of Object.entries(this.jsonDraft)) await expectFieldValue(this.page, label, value);
  assert.deepEqual(await storage(this.page), this.jsonStorage);
  await expect(this.page.getByRole("region", { name: "Prepared request", exact: true })).toHaveCount(0);
  await expect(viewer(this.page).locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  assert.deepEqual(this.diagnostics.filter(item => item.type === "unexpected-network-request"), []);
});


Then('the Settings schema viewer expands HTTP methods but keeps their details folded', async function () {
  const page = this.page;
  await setMode(page, 'settings');
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  await settings.locator('summary[aria-label="Schemas"]').click();
  const card = settings.locator('.schema-card[data-schema-id="demo"]');
  await card.getByRole('button', { name: /^Schema details:/ }).click();
  const header = card.locator('summary[aria-label="OpenAPI schema"]');
  await header.click();
  const label = `Full OpenAPI JSON: ${sourceCatalog.document.info.title}`;
  const json = page.getByRole('region', { name: label, exact: true });
  const heading = path => json.getByRole('group', { name: `${label}: ${path}`, exact: true }).locator(':scope > summary');
  for (const [path, item] of Object.entries(sourceCatalog.document.paths)) {
    const root = `$["paths"][${JSON.stringify(path)}]`;
    await expect(heading(root)).toHaveAttribute('aria-expanded', 'true');
    for (const method of Object.keys(item).filter(key => ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(key))) {
      const operation = `${root}[${JSON.stringify(method)}]`;
      await expect(heading(operation)).toHaveAttribute('aria-expanded', 'true');
      await expect(heading(`${operation}["responses"]`)).toHaveAttribute('aria-expanded', 'false');
    }
  }
  const method = '$["paths"]["/projects"]["get"]';
  await heading(method).click();
  await expect(heading(method)).toHaveAttribute('aria-expanded', 'false');
  await header.click(); await header.click();
  await expect(heading(method)).toHaveAttribute('aria-expanded', 'true');
  await expect(heading(`${method}["responses"]`)).toHaveAttribute('aria-expanded', 'false');
});

Then('schema edit icons fade in and out and respect reduced motion', async function () {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setMode(page, 'settings');
  await page.locator('summary[aria-label="Schemas"]').click();
  const card = page.locator('.schema-card[data-schema-id="demo"]');
  const toggle = card.getByRole('button', { name: /^Schema details:/ });
  const icon = card.locator('.schema-name-icon');
  const input = card.getByRole('textbox', { name: 'Schema name', exact: true });
  await expect(icon).toHaveCSS('opacity', '0');
  await expect(icon).toBeHidden();
  await icon.evaluate(element => {
    // Hold the actual CSS transitions at their start, including delayed visibility.
    element.__fadeObserver = new MutationObserver(() => {
      getComputedStyle(element).opacity;
      for (const animation of element.getAnimations()) animation.pause();
    });
    element.__fadeObserver.observe(element, { attributes: true, attributeFilter: ['class'] });
  });
  const halfway = () => icon.evaluate(async element => {
    const animation = element.getAnimations().find(item => item.transitionProperty === 'opacity');
    if (!animation) throw new Error('The edit icon must have an active opacity transition.');
    await animation.ready;
    animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    return Number(getComputedStyle(element).opacity);
  });
  const finish = () => icon.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  try {
    await toggle.click();
    await expect(input).toBeEditable();
    const opening = await halfway();
    assert.ok(opening > 0 && opening < 1, 'Opening fades through a partially visible edit icon');
    await toggle.click();
    await expect(input).toHaveCount(0);
    await expect(icon).toHaveAttribute('inert', '');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
    await expect(icon).toHaveCSS('pointer-events', 'none');
    const closing = await halfway();
    assert.ok(closing > 0 && closing < opening, 'Closing reverses the unfinished fade');
    await toggle.click();
    const reopening = await halfway();
    assert.ok(reopening > closing && reopening < 1, 'Reopening reverses the fade without jumping to fully visible');
    await finish();
    await expect(icon).toHaveCSS('opacity', '1');
    await toggle.click();
    const fadingOut = await halfway();
    assert.ok(fadingOut > 0 && fadingOut < 1, 'Closing a fully open card fades the icon out');
    await finish();
    await expect(icon).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const open of [true, false]) {
      await toggle.click();
      await expect(icon).toHaveCSS('opacity', open ? '1' : '0');
      assert.equal(await icon.evaluate(element => element.getAnimations().length), 0,
        'Reduced motion changes icon visibility without a fade');
    }
  } finally { await icon.evaluate(element => element.__fadeObserver?.disconnect()); }
});

Then('schema cards keep their controls usable and their viewer full width at {int} pixels', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 1000 });
  await setMode(page, 'settings');
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  await settings.locator('summary[aria-label="Schemas"]').click();
  const documents = settings.getByRole('region', { name: 'OpenAPI documents', exact: true });
  const card = documents.locator('[data-schema-id="demo"]');
  const otherCard = documents.locator('[data-schema-id="httpbin"]');
  const toggle = card.getByRole('button', { name: /^Schema details:/ });
  const enabled = card.getByRole('switch');
  const heading = card.locator('.schema-heading');
  const name = heading.getByRole('textbox', { name: 'Schema name', exact: true });
  const closedName = heading.locator('.schema-name-label');
  const move = heading.getByRole('button', { name: /^Move / });
  const title = await closedName.innerText();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(otherCard.getByRole('button', { name: /^Schema details:/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.schema-metadata, .schema-disclosure')).toHaveCount(0);
  await expect(name).toHaveCount(0);
  await expect(heading.locator('.schema-name-icon')).toBeHidden();
  await expect(enabled).toHaveText('');
  for (const control of [closedName, enabled, toggle, move]) await expect(control).toBeVisible();
  const topRow = await heading.evaluate(element => {
    const field = element.querySelector('.schema-name').getBoundingClientRect();
    const toggleElement = element.querySelector('.schema-card-toggle');
    const toggle = toggleElement.getBoundingClientRect();
    const name = element.querySelector('.schema-name-label').getBoundingClientRect();
    const enabled = element.querySelector('.schema-enabled');
    const switchBounds = enabled.getBoundingClientRect();
    const style = getComputedStyle(enabled);
    const toggleStyle = getComputedStyle(toggleElement);
    return { fieldWidth: field.width, gap: name.left - toggle.right,
      sameLine: Math.abs(field.top - toggle.top) < 1, fits: element.scrollWidth <= element.clientWidth,
      connected: Math.abs(name.right - switchBounds.left) < 1 && Math.abs(switchBounds.right - field.right) < 1,
      radii: [style.borderTopLeftRadius, style.borderTopRightRadius],
      arrowRadii: [toggleStyle.borderTopLeftRadius, toggleStyle.borderTopRightRadius],
      arrowConnected: Math.abs(toggle.left - field.left) < 1 };
  });
  assert.ok(topRow.sameLine && topRow.fits, 'The name and card controls share a single row at every width');
  assert.ok(topRow.fieldWidth > 0 && Math.abs(topRow.gap) < 1 && topRow.arrowConnected, 'The arrow joins the name without a gap');
  assert.deepEqual(topRow.arrowRadii, ['4px', '0px'], 'The arrow extension has a rounded outer end and square join');
  assert.ok(topRow.connected, 'The enable switch joins the name without a gap');
  assert.deepEqual(topRow.radii, ['0px', '4px'], 'The enable extension has a square join and rounded outer end');
  await enabled.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Disable schema');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await closedName.hover();
  await enabled.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Enable schema');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await enabled.click();
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await closedName.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toBeFocused();
  await expect(name).toBeEditable();
  await expect(heading.locator('.schema-name-icon .material-symbols-rounded')).toHaveText('edit_line');
  const editPlacement = await name.evaluate(input => {
    const icon = input.nextElementSibling.getBoundingClientRect();
    return Math.abs(input.getBoundingClientRect().right - icon.left) < 1;
  });
  assert.ok(editPlacement, 'The edit icon follows the input when the card is open');
  await toggle.press('Enter');
  await expect(name).toHaveCount(0);
  await expect(closedName).toBeVisible();
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.schema-metadata')).toBeVisible();
  const schema = card.locator('summary[aria-label="OpenAPI schema"]');
  await expect(schema).toHaveAttribute('aria-expanded', 'false');
  const actions = schema.getByRole('group', { name: `Actions for ${title}`, exact: true });
  for (const action of ['Replace', 'Download', 'Delete'])
    await expect(actions.getByRole('button', { name: `${action} ${title}`, exact: true })).toBeVisible();
  await expect(heading.getByRole('button', { name: /^(Replace|Download|Delete) / })).toHaveCount(0);
  if (width === 1280) {
    const alignment = await schema.evaluate(element => {
      const title = element.querySelector('.schema-title').getBoundingClientRect();
      const actions = element.querySelector('.schema-actions').getBoundingClientRect();
      return Math.abs(title.top + title.height / 2 - actions.top - actions.height / 2);
    });
    assert.ok(alignment < 1, 'Document actions share the OpenAPI schema line');
  }
  const download = page.waitForEvent('download');
  await actions.getByRole('button', { name: `Download ${title}`, exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith('.json'));
  await expect(schema).toHaveAttribute('aria-expanded', 'false');
  const chooser = page.waitForEvent('filechooser');
  await actions.getByRole('button', { name: `Replace ${title}`, exact: true }).click();
  await chooser;
  await expect(schema).toHaveAttribute('aria-expanded', 'false');
  await actions.getByRole('button', { name: `Delete ${title}`, exact: true }).click();
  const confirmation = card.getByRole('group', { name: `Confirm deletion of ${title}`, exact: true });
  await expect(confirmation).toBeVisible();
  await expect(schema).toHaveAttribute('aria-expanded', 'false');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await schema.locator('.schema-title').click();
  const json = card.getByRole('region', { name: `Full OpenAPI JSON: ${title}`, exact: true });
  await expect(json).toBeVisible();
  const headerButtons = await schema.locator('.schema-header-actions button').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    const bounds = button.getBoundingClientRect();
    return { name: button.getAttribute('aria-label'), x: bounds.x, y: bounds.y,
      format: [style.width, style.height, style.padding, style.borderWidth, style.borderRadius, style.backgroundColor, style.color, style.boxShadow] };
  }));
  assert.deepEqual(headerButtons.map(button => button.name), ['Wrap lines', 'Copy JSON', `Replace ${title}`, `Download ${title}`, `Delete ${title}`]);
  for (const [index, button] of headerButtons.entries()) {
    assert.deepEqual(button.format, headerButtons[0].format, 'All five schema action buttons share the existing format');
    assert.ok(Math.abs(button.y - headerButtons[0].y) < 1, 'Schema actions stay on one row even on a narrow screen');
    if (index) assert.ok(button.x > headerButtons[index - 1].x, 'Visual action order matches keyboard order');
  }
  const viewerWidth = await json.evaluate(element => {
    const viewer = element.getBoundingClientRect();
    const card = element.closest('.schema-card');
    const style = getComputedStyle(card);
    return { actual: viewer.width, expected: card.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      fits: card.scrollWidth <= card.clientWidth };
  });
  assert.ok(Math.abs(viewerWidth.actual - viewerWidth.expected) < 2, 'The expanded JSON viewer uses the full card width');
  assert.ok(viewerWidth.fits, 'Schema controls and content fit without horizontal overflow');
  await page.screenshot({ path: `${this.artifactDirectory}/schema-card-expanded-${width}.png` });
  await toggle.click();
  await expect(card.locator('.json-view, .schema-metadata')).toHaveCount(0);
  await expect(name).toHaveCount(0);
  await expect(heading.locator('.schema-name-icon')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await closedName.focus();
  await closedName.press('Enter');
  await expect(name).toBeEditable();
  await expect(toggle).toBeFocused();
  await expect(schema).toHaveAttribute('aria-expanded', 'false');
  await expect(card.locator('.json-view')).toHaveCount(0);
  await expect(otherCard.getByRole('button', { name: /^Schema details:/ })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await setMode(page, 'settings');
  const section = settings.locator('summary[aria-label="Schemas"]');
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
