// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { closeWorkflowDetails, expectWorkflowName, renameWorkflow, workflowNameInput } from './workflow-details.fixture.mjs';
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";

const workflow = page => page.getByRole("region", { name: "Workflow canvas", exact: true });
const workspace = page => page.getByRole("region", { name: "Operations workspace", exact: true });
const operationNodes = (page, name) => workflow(page).locator(".svelte-flow__node-operation").filter({
  has: page.locator(`[data-operation-name=${JSON.stringify(name)}]`)
});
const connections = page => workflow(page).locator(".svelte-flow__edge:not(.workflow-schema-edge)");

async function openCatalog(page) {
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole("navigation", { name: "Operation catalog", exact: true })).toBeVisible();
}

async function closeCatalog(page) {
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("navigation", { name: "Operation catalog", exact: true })
  });
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toBeHidden();
  } else {
    const close = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await close.isVisible()) await close.click();
  }
}

export async function revealCatalogOperation(page, name) {
  await openCatalog(page);
  const catalog = page.getByRole("navigation", { name: "Operation catalog", exact: true });
  const entry = catalog.locator("[data-operation-name]").filter({ has: page.getByText(name, { exact: true }) });
  await expect(entry).toHaveCount(1);
  const ancestors = catalog.locator("[data-catalog-group]").filter({
    has: page.locator("[data-operation-name]").filter({ has: page.getByText(name, { exact: true }) })
  });
  for (const group of await ancestors.all()) {
    const heading = group.locator(":scope > .catalog-group > summary");
    if (await heading.getAttribute("aria-expanded") !== "true") await heading.click();
  }
  return entry;
}

async function chooseCatalogOperation(page, name, mode = "operations") {
  const entry = await revealCatalogOperation(page, name);
  const action = entry.getByRole("button", {
    name: `${mode === "workflow" ? "Add to workflow" : "Open form"}: ${name}`,
    exact: true
  });
  await action.click();
  const catalog = page.getByRole("navigation", { name: "Operation catalog", exact: true });
  if (await page.evaluate(() => matchMedia("(max-width: 899px)").matches)) await expect(catalog).toBeHidden();
  else await expect(catalog).toBeVisible();
  await closeCatalog(page);
}

async function setMode(page, mode) {
  await openCatalog(page);
  const name = { operations: "Operations", workflow: "Workflows", settings: "Settings" }[mode];
  const button = page.getByRole("group", { name: "Workspace", exact: true }).getByRole("button", { name, exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") {
    await button.click();
    if (mode === "settings")
      await expect(page.getByRole("region", { name: "Settings workspace", exact: true })).toBeFocused();
  }
  await closeCatalog(page);
  const target = mode === "workflow" ? workflow(page) : mode === "settings" ? page.getByRole("region", { name: "Settings workspace", exact: true }) : workspace(page);
  await expect(target).toBeVisible();
}

async function field(page, label) {
  const options = { name: label, exact: true };
  const input = workspace(page).getByRole("textbox", options)
    .or(workspace(page).getByRole("spinbutton", options))
    .or(workspace(page).getByRole("combobox", options));
  await expect(input).toBeVisible();
  return input;
}

async function fillField(page, label, value) {
  const input = await field(page, label);
  if (await input.getAttribute("role") === "combobox") {
    await input.click();
    await page.getByRole("listbox").getByRole("option", { name: value || "Select…", exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  }
  else await input.fill(value);
}

async function expectFieldValue(page, label, value) {
  const input = await field(page, label);
  if (await input.getAttribute("role") === "combobox") await expect(input).toContainText(value || "Select…");
  else await expect(input).toHaveValue(value);
}

async function workflowAction(page, action) {
  await page.getByRole("button", { name: `${action} workflow`, exact: true }).click();
}

async function readExport(page) {
  const downloadPromise = page.waitForEvent("download");
  await workflowAction(page, "Export");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const stream = await download.createReadStream();
  assert.ok(stream, "The exported workflow should be downloadable.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return { buffer, document: JSON.parse(buffer.toString("utf8")) };
}

async function visibleNodeCount(page, name) {
  const canvas = await workflow(page).boundingBox();
  if (!canvas) return 0;
  return operationNodes(page, name).evaluateAll((elements, area) => elements.filter(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width >= 40 && bounds.height >= 15 && bounds.left >= area.x &&
      bounds.right <= area.x + area.width && bounds.top >= area.y && bounds.bottom <= area.y + area.height;
  }).length, canvas);
}

When("I search for the operation {string}", async function (prompt) {
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).fill(prompt);
  await this.page.getByRole("button", { name: "Find operations", exact: true }).click();
});
Then("the results offer the {string} form", async function (name) {
  await expect(workspace(this.page).getByRole("button", { name: `Go to operation: ${name}`, exact: true })).toBeVisible();
});
When("I review the matching details", async function () {
  await this.page.getByLabel("Review matching details", { exact: true }).click();
});
Then("the matching details show ranked operation comparisons", async function () {
  const report = this.page.getByRole("region", { name: "Evaluation report", exact: true });
  await expect(report).toBeVisible();
  await expect(report.getByRole("list", { name: "Proposed operations", exact: true }).locator(".candidate-name").first()).toHaveText("List projects");
  await expect(report.getByRole("list", { name: "Not proposed operations", exact: true })).toBeVisible();
});
When("I close the matching details", async function () {
  await this.page.getByLabel("Review matching details", { exact: true }).click();
  await expect(this.page.getByRole("region", { name: "Evaluation report", exact: true })).toBeHidden();
});
When("I open the {string} result", async function (name) {
  await workspace(this.page).getByRole("button", { name: `Go to operation: ${name}`, exact: true }).click();
});
Then("the {string} form is displayed", async function (name) {
  await expect(workspace(this.page).getByRole("heading", { name: `Operation: ${name}`, exact: true })).toBeVisible();
  await expect(this.page.getByRole("button", { name: "Execute operation", exact: true })).toBeVisible();
});
Then("the five nearest operations are shown", async function () {
  const results = workspace(this.page).getByRole("button", { name: /^Go to operation:/ });
  await expect(results).toHaveCount(5);
  await expect(results.first()).toHaveAccessibleName("Go to operation: Create task");
});
When("I choose to edit the prompt", async function () {
  await this.page.getByRole("navigation", { name: "Progress", exact: true }).getByRole("button", { name: "1. Prompt", exact: true }).click();
});
Then("the prompt still contains {string}", async function (prompt) {
  await expect(this.page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(prompt);
});
Given("I open the {string} operation from the catalog", async function (name) {
  await chooseCatalogOperation(this.page, name);
});
When("I choose the {string} operation from the catalog", async function (name) {
  await chooseCatalogOperation(this.page, name);
});
When("I try to prepare the request", async function () {
  await this.page.getByRole("button", { name: "Execute operation", exact: true }).click();
});
Then("{string} is an invalid required input", async function (label) {
  await expect.poll(async () => (await field(this.page, label)).evaluate(input => {
    const control = input.getAttribute("role") === "combobox" ? input.closest(".joined-field").querySelector('input[name][aria-hidden="true"]') : input;
    return control.validity.valueMissing;
  })).toBe(true);
});
Then("no prepared request is displayed", async function () {
  await expect(this.page.getByRole("region", { name: "Prepared request", exact: true })).toHaveCount(0);
});
When("I enter these operation inputs:", async function (table) {
  for (const { label, value } of table.hashes()) await fillField(this.page, label, value);
});
When("I prepare the request", async function () {
  await this.page.getByRole("button", { name: "Execute operation", exact: true }).click();
  await expect(this.page.getByRole("region", { name: "Prepared request", exact: true })).toBeVisible();
});
Then("the prepared request is:", async function (json) {
  const preview = this.page.getByRole("region", { name: "Prepared request", exact: true });
  await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(JSON.parse(json));
});
Then("operation metadata identifies server URL {string}", async function (url) {
  await this.page.getByRole("button", { name: "Edit inputs", exact: true }).click();
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const metadata = this.page.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(metadata.locator("dt").filter({ hasText: /^Server URL$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(url);
});
Then("{string} is outside its allowed numeric range", async function (label) {
  await expect.poll(async () => (await field(this.page, label)).evaluate(input => input.validity.rangeOverflow)).toBe(true);
});
When("I edit the inputs and change {string} to {string}", async function (label, value) {
  await this.page.getByRole("button", { name: "Edit inputs", exact: true }).click();
  await fillField(this.page, label, value);
});
Then("the previous request preview cannot be reopened", async function () {
  const progress = this.page.getByRole("navigation", { name: "Progress", exact: true });
  await expect(progress.getByRole("button", { name: /Request$/ })).toHaveCount(0);
  await progress.getByRole("button", { name: "3. Operation", exact: true }).click();
  await expect(this.page.getByRole("region", { name: "Prepared request", exact: true })).toHaveCount(0);
});
When("I expand the operation details", async function () {
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
});
Then("the operation identifier is {string}", async function (id) {
  await expect(workspace(this.page).getByText(id, { exact: true })).toBeVisible();
});
Then("{string} offers the choices {string}", async function (label, choices) {
  const input = await field(this.page, label);
  await input.click();
  const options = this.page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(choices.split(", ").length + 1);
  for (const [index, name] of ["Select…", ...choices.split(", ")].entries())
    await expect(options.nth(index)).toHaveAccessibleName(name);
  await this.page.keyboard.press("Escape");
  await expect(this.page.getByRole("listbox")).toHaveCount(0);
  await expect(input).toBeFocused();
});
When("I enable the dark theme", async function () {
  await openCatalog(this.page);
  const toggle = this.page.getByRole("switch", { name: "Dark theme", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});
When("I reload the workspace", async function () { await this.page.reload(); });
Then("the dark theme remains selected", async function () {
  await openCatalog(this.page);
  await expect(this.page.getByRole("switch", { name: "Dark theme", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(this.page.locator("html")).toHaveAttribute("data-theme", "dark");
});
When("I open and close the desktop catalog", async function () {
  await openCatalog(this.page);
  await expect(this.page.getByRole("complementary", { name: "Navigation", exact: true })).toBeVisible();
  await closeCatalog(this.page);
  await expect(this.page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
});
When("I use a viewport of {int} by {int} pixels", async function (width, height) {
  await this.page.setViewportSize({ width, height });
});
When("I open the mobile catalog", async function () { await openCatalog(this.page); });
Then("the mobile catalog is a visible dialog", async function () {
  await expect(this.page.getByRole("dialog").filter({ has: this.page.getByRole("navigation", { name: "Operation catalog" }) })).toBeVisible();
});
Then("the mobile catalog is closed", async function () {
  await expect(this.page.getByRole("dialog")).toHaveCount(0);
  await expect(this.page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
});
Then("the page fits the viewport horizontally", async function () {
  await expect.poll(() => this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

Given("a workflow with {int} instances of {string}", async function (count, name) {
  this.operationName = name;
  await setMode(this.page, "workflow");
  for (let index = 0; index < count; index += 1) {
    await chooseCatalogOperation(this.page, name, "workflow");
    await expect(operationNodes(this.page, name)).toHaveCount(index + 1);
    await expect.poll(() => visibleNodeCount(this.page, name)).toBeGreaterThan(0);
  }
  await this.page.getByRole("button", { name: "Fit View", exact: true }).click();
  await operationNodes(this.page, name).last().click({ trial: true });
  await expect.poll(() => visibleNodeCount(this.page, name)).toBe(count);
});
When("I connect the first operation to the second", async function () {
  const owners = operationNodes(this.page, this.operationName);
  const sourceId = await owners.nth(0).getAttribute("data-id");
  const targetId = await owners.nth(1).getAttribute("data-id");
  const source = workflow(this.page).locator(`[data-owner-id=${JSON.stringify(sourceId)}][data-direction="outputs"]`)
    .getByLabel("Project name output", { exact: true });
  const target = workflow(this.page).locator(`[data-owner-id=${JSON.stringify(targetId)}][data-direction="inputs"]`)
    .getByLabel("Project name input", { exact: true });
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await source.click({ trial: true });
  await expect(target).toHaveClass(/connectableend/);
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  assert.ok(start && end, "Connection handles must have visible bounds.");
  await this.page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await this.page.mouse.down();
  await this.page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await this.page.mouse.up();
  await expect(connections(this.page)).toHaveCount(1);
});
When("I enable grid snapping and curved dashed connections", async function () {
  for (const name of ["Snap to grid", "Curved connections", "Dashed connections"])
    await this.page.getByRole("button", { name, exact: true }).click();
});
When("I name the workflow {string} and wait for autosave", async function (name) {
  await renameWorkflow(this.page, name);
  await expect(this.page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
});
When("I press Delete while the saved-workflow dialog is open", async function () {
  await this.page.getByRole("button", { name: "Open workflow", exact: true }).click();
  const dialog = this.page.getByRole("dialog", { name: "Saved workflows", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await this.page.keyboard.press("Delete");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
});
Then("the workflow still contains {int} instances of {string}", async function (count, name) {
  await expect(operationNodes(this.page, name)).toHaveCount(count);
});
Then("the workflow still contains {int} instance of {string}", async function (count, name) {
  await expect(operationNodes(this.page, name)).toHaveCount(count);
});
When("I reload and reopen the workflow workspace", async function () {
  await this.page.reload();
  await setMode(this.page, "workflow");
});
Then("the workflow is named {string}", async function (name) {
  await expectWorkflowName(this.page, name);
});
Then("it contains one connection", async function () { await expect(connections(this.page)).toHaveCount(1); });
Then("grid snapping and curved dashed connections remain enabled", async function () {
  for (const name of ["Snap to grid", "Curved connections", "Dashed connections"])
    await expect(this.page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
});
When("I add {string} through the workflow catalog", async function (name) {
  await setMode(this.page, "workflow");
  await chooseCatalogOperation(this.page, name, "workflow");
  await expect(workflow(this.page)).toBeVisible();
  await expect(operationNodes(this.page, name)).toHaveCount(1);
});
When("I switch to operations and press Delete", async function () {
  await setMode(this.page, "operations");
  await this.page.getByRole("button", { name: "Open navigation", exact: true }).focus();
  await this.page.keyboard.press("Delete");
});
Then("the input {string} still contains {string}", async function (label, value) {
  await expectFieldValue(this.page, label, value);
});
When("I switch to the workflow workspace", async function () { await setMode(this.page, "workflow"); });
When("I switch to the operations workspace", async function () { await setMode(this.page, "operations"); });
When("I switch to the settings workspace", async function () { await setMode(this.page, "settings"); });
When("I press Delete in Settings", async function () {
  await this.page.keyboard.press("Delete");
});
Then("Settings is the only selected workspace", async function () {
  const page = this.page;
  await openCatalog(page);
  const controls = page.getByRole("group", { name: "Workspace", exact: true });
  await expect(controls.getByRole("button")).toHaveCount(3);
  for (const name of ["Operations", "Workflows", "Settings"])
    await expect(controls.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", String(name === "Settings"));
  await expect(controls.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await closeCatalog(page);
});
When("I export the workflow", async function () { this.exported = await readExport(this.page); });
When("I start a new workflow", async function () {
  await this.page.getByRole("button", { name: "New workflow", exact: true }).click();
  await expect(workflowNameInput(this.page)).toBeFocused();
  await closeWorkflowDetails(this.page);
});
Then("the new workflow is empty and not saved", async function () {
  await expect(workflow(this.page).getByRole("button", { name: "Add nodes by selecting workflow operations from the left menu", exact: true })).toBeVisible();
  await expect(this.page.locator(".site-header .document-meta").getByText("Not saved", { exact: true })).toBeVisible();
});
When("I import the exported workflow", async function () {
  await this.page.getByLabel("Import workflow file", { exact: true }).setInputFiles({
    name: "portable-review.json", mimeType: "application/json", buffer: this.exported.buffer
  });
});
When("I export the workflow again", async function () { this.imported = await readExport(this.page); });
Then("the imported plan preserves its graph under a new document identity", function () {
  assert.notEqual(this.imported.document.id, this.exported.document.id);
  const { id: originalId, viewport: originalViewport, ...original } = this.exported.document;
  const { id: importedId, viewport: importedViewport, ...imported } = this.imported.document;
  assert.deepEqual(imported, original);
  assert.ok(originalViewport.zoom > 0 && importedViewport.zoom > 0);
});
When("I import an unsupported workflow version", async function () {
  await this.page.getByLabel("Import workflow file", { exact: true }).setInputFiles({
    name: "unsupported-plan.json", mimeType: "application/json", buffer: Buffer.from('{"version":999}')
  });
});
Then("the import error names the file and unsupported version", async function () {
  const error = workflow(this.page).getByRole("alert");
  await expect(error).toContainText("unsupported-plan.json");
  await expect(error).toContainText("Unsupported workflow document version; expected version 1");
});
Then("at least one complete operation node is visible inside the canvas", async function () {
  await expect.poll(() => visibleNodeCount(this.page, this.operationName)).toBeGreaterThan(0);
});

export { openCatalog, closeCatalog, chooseCatalogOperation, setMode, field, fillField, expectFieldValue, workflow, workflowAction, workspace, operationNodes, connections, readExport };
