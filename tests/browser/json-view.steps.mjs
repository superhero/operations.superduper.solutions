// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, expectFieldValue, fillField } from "./workspace.steps.mjs";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";

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
const storage = page => page.evaluate(() => Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b)));

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

Given("the Create task JSON report is open at {int} pixels", async function (width) {
  await this.page.setViewportSize({ width, height: 900 });
  await chooseCatalogOperation(this.page, "Create task");
  this.jsonDraft = { "Project ID": "json-review-project", Title: 'Keep "quoted" <task> & \\ draft', Priority: "normal" };
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
      for (const animation of sliding) animation.playbackRate = 0.1;
      return sliding.length;
    }, opening)).toBeGreaterThan(0);
    await expect(summary).toBeFocused();
  };
  const finishSlide = () => panel.evaluate(element => {
    for (const animation of element.getAnimations()) animation.finish();
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
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

Then("reviewing JSON has left the operation draft and local storage unchanged", async function () {
  for (const [label, value] of Object.entries(this.jsonDraft)) await expectFieldValue(this.page, label, value);
  assert.deepEqual(await storage(this.page), this.jsonStorage);
  await expect(this.page.getByRole("region", { name: "Prepared request", exact: true })).toHaveCount(0);
  await expect(viewer(this.page).locator('input, textarea, [contenteditable="true"]')).toHaveCount(0);
  assert.deepEqual(this.diagnostics.filter(item => item.type === "unexpected-network-request"), []);
});
