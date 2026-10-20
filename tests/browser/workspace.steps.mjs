// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { closeWorkflowDetails, expectWorkflowName, renameWorkflow, workflowNameInput } from './workflow-details.fixture.mjs';
import assert from "node:assert/strict";
import { operations } from "../../src/lib/catalog.ts";
import { catalogs } from "../../src/lib/catalog-registry.ts";
import { operationNavigation, operationResourceGroups } from "../../src/lib/operation-navigation.ts";
import { catalogHierarchy } from "../../src/lib/catalog-hierarchy.ts";
import { seedOperationGraph } from "./workflow-graph.fixture.mjs";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";

const workflow = page => page.getByRole("region", { name: "Workflow canvas", exact: true });
const workspace = page => page.getByRole("dialog", { name: /^Run workflow:/ });
const operationNodes = (page, name) => workflow(page).locator(".svelte-flow__node-operation").filter({
  has: page.locator(`[data-operation-name=${JSON.stringify(name)}]`)
});
const connections = page => workflow(page).locator(".svelte-flow__edge:not(.workflow-schema-edge)");

Then('empty workflow guidance stays centered beside menus at {int} pixels with {string} motion', async function (width, motion) {
  const page = this.page;
  await page.setViewportSize({ width, height: 844 });
  await page.emulateMedia({ reducedMotion: motion });
  await closeCatalog(page);
  const canvas = page.locator('.workflow-workspace');
  const browse = canvas.locator('.workflow-empty button');
  const drawer = page.locator('.settings-drawer');
  const navigation = page.locator('#side-navigation');
  const before = await canvas.boundingBox();
  const center = async (left, right) => {
    await expect.poll(async () => {
      const button = await browse.boundingBox();
      return Math.abs(button.x + button.width / 2 - (left + right) / 2);
    }).toBeLessThan(1);
    const button = await browse.boundingBox();
    assert.ok(Math.abs(button.y + button.height / 2 - before.y - before.height / 2) < 1,
      'The empty-workflow button remains vertically centered');
    assert.deepEqual(await canvas.boundingBox(), before, 'Menus do not resize the workflow canvas');
  };
  await expect(canvas.locator('.svelte-flow__node')).toHaveCount(0);
  await center(before.x, before.x + before.width);
  await openCatalog(page);
  if (width >= 900) {
    await expect(navigation).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    const menu = await navigation.boundingBox();
    await center(menu.x + menu.width, before.x + before.width);
    await browse.click();
    await expect(page.getByRole('navigation', { name: 'Operation catalog', exact: true })).toBeVisible();
  } else await expect(canvas).toHaveAttribute('inert', '');
  await closeCatalog(page);
  await setMode(page, 'settings');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  if (width >= 1150) {
    await center(before.x, (await drawer.boundingBox()).x);
    await page.screenshot({ path: `${this.artifactDirectory}/empty-workflow-settings-${width}.png` });
    await browse.click();
    await expect(drawer).toBeHidden();
  } else {
    await expect(page.locator('.page-content')).toHaveAttribute('inert', '');
    await setMode(page, 'workflow');
    await browse.click();
  }
  await expect(page.getByRole('navigation', { name: 'Operation catalog', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeFocused();
  if (width >= 900) await expect(navigation).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const visibleMenu = await navigation.boundingBox();
  if (width >= 900) await center(visibleMenu.x + visibleMenu.width, before.x + before.width);
  await page.screenshot({ path: `${this.artifactDirectory}/empty-workflow-navigation-${width}.png` });
  await expect(page.getByRole('banner', { includeHidden: true }).getByRole('button', { name: 'Settings', exact: true, includeHidden: true }))
    .toHaveAttribute('aria-pressed', 'false');
});

async function openCatalog(page) {
  const mobileClose = page.getByRole('button', { name: 'Close settings', exact: true });
  if (await mobileClose.isVisible()) {
    await mobileClose.click();
    await expect(page.locator('.settings-drawer')).toBeHidden();
  }
  const settings = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  if (await settings.getAttribute('aria-pressed') === 'true') {
    await settings.click();
    await expect(page.locator('.settings-drawer')).toBeHidden();
  }
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(open.or(page.getByRole("button", { name: "Close navigation", exact: true }))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole("navigation", { name: "Operation catalog", exact: true })).toBeVisible();
}

async function closeCatalog(page) {
  await page.locator("#startup-status").waitFor({ state: "detached" });
  if (await page.evaluate(() => matchMedia('(max-width: 899px)').matches) &&
      await page.getByRole('button', { name: 'Close navigation', exact: true }).isVisible())
    await expect(page.locator('#side-navigation')).toHaveAttribute('data-slot', 'sheet-content');
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
  if (!await entry.count() && await page.getByRole("textbox", { name: "Prompt", exact: true }).inputValue()) await searchOperations(page, "");
  const target = operations.find(operation => operation.name === name);
  function findPath(groups, parents = []) {
    for (const group of groups) {
      const path = [...parents, group.id];
      if (group.operationIds?.includes(target?.id)) return path;
      const child = findPath(group.children ?? [], path);
      if (child) return child;
    }
  }
  const path = target && findPath(operationResourceGroups(catalogHierarchy(catalogs.flatMap(catalog => catalog.groups)), operationNavigation(operations)));
  let scope = catalog;
  let found = !!path || await entry.count() > 0;
  for (const id of path ?? []) {
    const group = scope.locator(`[data-catalog-group="${id}"]`);
    if (!await group.count()) { found = false; break; }
    const heading = group.locator(":scope > .catalog-group > summary");
    if (await heading.getAttribute("aria-expanded") !== "true") await heading.click();
    scope = group;
  }
  if (!found) await searchOperations(page, name);
  await expect(entry).toHaveCount(1);
  return entry;
}

async function chooseCatalogOperation(page, name, mode = "run") {
  await quitRun(page);
  if (mode !== "workflow") {
    await setMode(page, "workflow");
    await workflowAction(page, "New");
    await closeWorkflowDetails(page);
  }
  const entry = await revealCatalogOperation(page, name);
  await entry.getByRole("button", { name: `Add to workflow: ${name}`, exact: true }).click();
  await expect(operationNodes(page, name).last()).toBeVisible();
  await closeCatalog(page);
  if (mode !== "workflow") {
    await workflowAction(page, "Run");
    await expect(workspace(page).getByRole("heading", { name: `1. ${name}`, exact: true })).toBeVisible();
  }
}

export async function quitRun(page) {
  const run = workspace(page);
  if (await run.isVisible()) {
    await run.getByRole("button", { name: "Quit", exact: true }).click();
    await expect(run).toHaveCount(0);
  }
}

export async function restartRun(page, restoreInputs = false) {
  const drafts = restoreInputs ? await workspace(page).locator('.operation-fields .joined-field').evaluateAll(rows => rows.map(row => {
    const control = row.querySelector('.field-input, .field-select-trigger');
    const label = row.querySelector('label').textContent;
    const value = control?.getAttribute('role') === 'combobox' ? row.querySelector('input[name][aria-hidden="true"]').value : control?.value;
    return { label, value: value ?? '' };
  })) : [];
  await quitRun(page);
  await workflowAction(page, "Run");
  await expect(workspace(page)).toBeVisible();
  for (const { label, value } of drafts) await fillField(page, label, value);
}

export const executeOperation = page => workspace(page).getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();
export const preparedRequest = page => workspace(page).getByRole("region", { name: /^(Prepared request|Step \d+ prepared request)$/ });
export async function applyDisplayedTheme(page, theme) {
  await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.classList.toggle("dark", value === "dark"); }, theme);
}
async function setMode(page, mode) {
  await quitRun(page);
  await closeCatalog(page);
  if (!['workflow', 'settings'].includes(mode)) throw new Error(`Unsupported workspace: ${mode}`);
  const mobileClose = page.getByRole('button', { name: 'Close settings', exact: true });
  if (await mobileClose.isVisible()) {
    if (mode === 'workflow') {
      await mobileClose.click();
      await expect(mobileClose).toBeHidden();
    }
    return;
  }
  const button = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  if (await button.getAttribute('aria-pressed') !== String(mode === 'settings')) {
    await button.click();
    if (mode === 'settings')
      await expect(page.getByRole('region', { name: 'Settings workspace', exact: true })).toBeFocused();
  }
  const target = mode === "workflow" ? workflow(page) : mode === "settings" ? page.getByRole("region", { name: "Settings workspace", exact: true }) : workflow(page);
  await expect(target).toBeVisible();
}

export async function setEvaluationDetails(page, enabled = true) {
  await setMode(page, "settings");
  const settings = page.getByRole("region", { name: "Settings workspace", exact: true });
  const developer = settings.locator('summary[aria-label="Developer"]');
  if (await developer.getAttribute("aria-expanded") !== "true") await developer.click();
  const toggle = settings.getByRole("switch", { name: "Evaluation details", exact: true });
  if (await toggle.getAttribute("aria-checked") !== String(enabled)) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("v1/settings");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("settings", "readonly");
      const value = transaction.objectStore("settings").get("evaluationDetails");
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onabort = transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }))).toBe(enabled);
  await setMode(page, "workflow");
  await openCatalog(page);
}

async function field(page, label) {
  const options = { name: label, exact: true };
  const input = workspace(page).getByRole("textbox", options)
    .or(workspace(page).getByRole("textbox", { name: `${label} value`, exact: true }))
    .or(workspace(page).getByRole("spinbutton", options))
    .or(workspace(page).getByRole("combobox", options));
  await expect(input).toBeVisible();
  return input;
}

export async function includeField(page, label) {
  const toggle = workspace(page).getByRole('checkbox', { name: `Do not send ${label}`, exact: true });
  if (await toggle.count() && await toggle.isChecked() && await toggle.isEnabled()) await toggle.uncheck();
}

async function fillField(page, label, value) {
  await includeField(page, label);
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

export async function searchOperations(page, prompt) {
  await openCatalog(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(prompt);
  await expect(page.locator(".catalog-prompt")).toHaveAttribute("data-evaluated-prompt", prompt.trim() ? prompt : "");
  await expect(page.locator(".catalog-prompt")).toHaveAttribute("aria-busy", "false");
}
When("I search for the operation {string}", async function (prompt) {
  await searchOperations(this.page, prompt);
});
Then("the results offer the {string} form", async function (name) {
  await expect(this.page.getByRole("navigation", { name: "Operation catalog", exact: true }).getByRole("button", { name: `Add to workflow: ${name}`, exact: true })).toBeVisible();
});
When("I review the matching details", async function () {
  await setEvaluationDetails(this.page);
  await this.page.getByLabel("Review matching details", { exact: true }).click();
});
Then("the matching details show ranked operation comparisons", async function () {
  const report = this.page.getByRole("region", { name: "Evaluation report", exact: true });
  await expect(report).toBeVisible();
  await expect(report.getByRole("list", { name: "Proposed operations", exact: true }).locator(".candidate-name").first()).toHaveText("Example array response");
  await expect(report.getByRole("list", { name: "Not proposed operations", exact: true })).toBeVisible();
});
When("I close the matching details", async function () {
  await this.page.getByLabel("Review matching details", { exact: true }).click();
  await expect(this.page.getByRole("region", { name: "Evaluation report", exact: true })).toBeHidden();
});
When("I open the {string} result", async function (name) {
  await chooseCatalogOperation(this.page, name);
});
Then("the {string} form is displayed", async function (name) {
  await expect(workspace(this.page).getByRole("heading", { name: `1. ${name}`, exact: true })).toBeVisible();
  await expect(this.page.getByRole("button", { name: "Start workflow", exact: true })).toBeVisible();
});
Then("the five nearest operations are shown", async function () {
  const results = this.page.getByRole("navigation", { name: "Operation catalog", exact: true })
    .getByRole("button", { name: /^Add to workflow:/ });
  await expect(results).toHaveCount(5);
  await expect(results.filter({ hasText: "Example POST body" })).toBeVisible();
});
When("I choose to edit the prompt", async function () {
  await openCatalog(this.page);
  await this.page.getByRole("textbox", { name: "Prompt", exact: true }).focus();
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
  await executeOperation(this.page);
});
Then("{string} is an invalid required input", async function (label) {
  await expect.poll(async () => (await field(this.page, label)).evaluate(input => {
    const control = input.getAttribute("role") === "combobox" ? input.closest(".joined-field").querySelector('input[name][aria-hidden="true"]') : input;
    return control.validity.valueMissing;
  })).toBe(true);
});
Then("no prepared request is displayed", async function () {
  await expect(preparedRequest(this.page)).toHaveCount(0);
});
When("I enter these operation inputs:", async function (table) {
  for (const { label, value } of table.hashes()) await fillField(this.page, label, value);
});
When("I prepare the request", async function () {
  await executeOperation(this.page);
  await expect(preparedRequest(this.page)).toBeVisible();
});
Then("the prepared request is:", async function (json) {
  const preview = preparedRequest(this.page);
  await expect.poll(async () => JSON.parse(await preview.innerText())).toEqual(JSON.parse(json));
});
Then("operation metadata identifies server URL {string}", async function (url) {
  await restartRun(this.page, true);
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
  const metadata = this.page.getByRole("region", { name: "Operation metadata", exact: true });
  await expect(metadata.locator("dt").filter({ hasText: /^Server URL$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText(url);
});
Then("{string} is outside its allowed numeric range", async function (label) {
  const input = await field(this.page, label);
  const slider = workspace(this.page).getByRole('slider', { name: label, exact: true });
  if (await slider.count()) {
    await expect(slider).toHaveAttribute('aria-invalid', 'true');
    const value = Number(await input.inputValue());
    assert.ok(value < Number(await slider.getAttribute('aria-valuemin')) || value > Number(await slider.getAttribute('aria-valuemax')));
    assert.equal(await input.evaluate(control => control.validity.valid), false);
  } else await expect.poll(() => input.evaluate(control => control.validity.rangeOverflow)).toBe(true);
});
When("I restart with the same inputs and change {string} to {string}", async function (label, value) {
  await restartRun(this.page, true);
  await fillField(this.page, label, value);
});
Then("the previous request preview cannot be reopened", async function () {
  await expect(preparedRequest(this.page)).toHaveCount(0);
  await expect(this.page.getByRole("button", { name: "Edit inputs", exact: true })).toHaveCount(0);
  await expect(this.page.getByRole("button", { name: "Start workflow", exact: true })).toBeVisible();
});
When("I expand the operation details", async function () {
  await this.page.getByRole("button", { name: "Review operation details", exact: true }).click();
});
Then("the operation identifier is {string}", async function (id) {
  await expect(workspace(this.page).getByText(id, { exact: true })).toBeVisible();
});
Then("{string} offers the choices {string}", async function (label, choices) {
  await includeField(this.page, label);
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
When("I enable the dark theme", async function () { await selectThemeMode(this.page, 'dark'); });
When("I reload the workspace", async function () { await this.page.reload(); });
Then("the dark theme remains selected", async function () {
  await openThemeSettings(this.page);
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
  await expect(this.page.locator('[data-slot="sheet-content"]')).toHaveCount(0);
});
Then("the page fits the viewport horizontally", async function () {
  await expect.poll(() => this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

Given("I add {int} instances of {string} from the catalog", async function (count, name) {
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

Given("a workflow with {int} instances of {string}", async function (count, name) {
  this.operationName = name;
  await setMode(this.page, "workflow");
  await seedOperationGraph(this.page, Array(count).fill(name));
  await expect(operationNodes(this.page, name)).toHaveCount(count);
  await this.page.getByRole("button", { name: "Fit View", exact: true }).click();
  await operationNodes(this.page, name).last().click();
  await expect.poll(() => visibleNodeCount(this.page, name)).toBe(count);
});

When("I connect the first operation to the second", async function () {
  const owners = operationNodes(this.page, this.operationName);
  const sourceId = await owners.nth(0).getAttribute("data-id");
  const targetId = await owners.nth(1).getAttribute("data-id");
  const source = workflow(this.page).locator(`[data-owner-id=${JSON.stringify(sourceId)}][data-direction="outputs"]`)
    .getByLabel("Name output", { exact: true });
  const target = workflow(this.page).locator(`[data-owner-id=${JSON.stringify(targetId)}][data-direction="inputs"]`)
    .getByLabel("Name input", { exact: true });
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
  for (const name of ["Snap to grid", "Curved connections", "Dashed connections"]) {
    const toggle = this.page.getByRole("button", { name, exact: true });
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
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

Then("the input {string} still contains {string}", async function (label, value) {
  await expectFieldValue(this.page, label, value);
});
When("I switch to the workflow workspace", async function () { await setMode(this.page, "workflow"); });
When("I switch to the settings workspace", async function () { await setMode(this.page, "settings"); });
When("I press Delete in Settings", async function () {
  await this.page.keyboard.press("Delete");
});
Then("Settings is the only selected workspace", async function () {
  const page = this.page;
  await expect(page.getByRole('group', { name: 'Workspace', exact: true })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await closeCatalog(page);
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});
When("I export the workflow", async function () { this.exported = await readExport(this.page); });
When("I start a new workflow", async function () {
  await this.page.getByRole("button", { name: "New workflow", exact: true }).click();
  await expect(workflowNameInput(this.page)).toBeFocused();
  await closeWorkflowDetails(this.page);
});
Then("the new workflow is empty and not saved", async function () {
  await expect(workflow(this.page).locator(".workflow-empty").getByRole("button", { name: "Browse operations", exact: true })).toBeVisible();
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

When("I add {string} from the settings catalog", async function (name) {
  await chooseCatalogOperation(this.page, name, "workflow");
  await expect(workflow(this.page)).toBeVisible();
});

Then('header Settings opens directly at viewport width {int}', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 844 });
  await closeCatalog(page);
  const header = page.getByRole('banner');
  const settings = header.getByRole('button', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  const brand = await header.locator('.brand').boundingBox();
  const button = await settings.boundingBox();
  assert.ok(button.x > brand.x + brand.width, 'Settings belongs to the right of the header brand.');
  await settings.focus();
  await page.keyboard.press('Enter');
  await expect(settings).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Settings workspace', exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Operation catalog', exact: true })).toBeHidden();
  await openCatalog(page);
  await expect(page.locator('#side-navigation').getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
  await closeCatalog(page);
  await setMode(page, 'workflow');
  await expect(workflow(page)).toBeVisible();
  await expect(settings).toHaveAttribute('aria-pressed', 'false');
});

Then('the settings drawer preserves the workflow at width {int} with {string} motion', async function (width, motion) {
  const page = this.page;
  await page.setViewportSize({ width, height: 600 });
  await closeCatalog(page);
  await page.emulateMedia({ reducedMotion: motion });
  const canvas = page.locator('.workflow-host');
  const before = await canvas.boundingBox();
  const toolbar = page.locator('.workflow-toolbar');
  const toolbarBefore = await toolbar.boundingBox();
  const viewport = page.locator('.svelte-flow__viewport');
  const transformBefore = await viewport.getAttribute('style');
  const settings = page.getByRole('banner', { includeHidden: true }).getByRole('button', { name: 'Settings', exact: true, includeHidden: true });
  await settings.click();
  const drawer = page.locator('.settings-drawer');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  if (width < 1150) await expect.poll(() => canvas.evaluate(element => Boolean(element.closest('[inert]')))).toBe(true);
  else await expect(canvas).not.toHaveAttribute('inert');
  assert.deepEqual(await canvas.boundingBox(), before, 'Opening Settings must not resize or hide the workflow.');
  if (width < 1150) {
    assert.deepEqual(await toolbar.boundingBox(), toolbarBefore, 'Modal Settings must not compress workflow controls.');
    await expect(viewport).toHaveAttribute('style', transformBefore);
    await expect(page.locator('.settings-backdrop')).toBeVisible();
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bounds = await drawer.boundingBox();
  assert.equal(Math.round(bounds.x + bounds.width), width);
  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 600);
  assert.equal(await drawer.evaluate(element => getComputedStyle(element).transitionDuration), motion === 'reduce' ? '0s' : '0.2s, 0s');
  await settings.evaluate(async button => {
    button.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    button.click();
  });
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  if (width < 1150) await expect.poll(() => canvas.evaluate(element => Boolean(element.closest('[inert]')))).toBe(true);
  else await expect(canvas).not.toHaveAttribute('inert');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(canvas).not.toHaveAttribute('inert');
  await expect(settings).toBeFocused();
  assert.deepEqual(await canvas.boundingBox(), before);
});

export async function openThemeSettings(page) {
  await setMode(page, 'settings');
  const section = page.getByRole('region', { name: 'Settings workspace', exact: true }).locator('summary[aria-label="Theme"]');
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  await expect(page.getByRole('group', { name: 'Color palette', exact: true }).getByRole('switch', { name: 'Dark theme', exact: true })).toBeVisible();
  await expect(page.locator('#side-navigation').getByRole('switch', { name: 'Dark theme', exact: true })).toHaveCount(0);
}

export async function selectThemeMode(page, theme) {
  const wasSettings = await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-pressed') === 'true';
  await openThemeSettings(page);
  const toggle = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await toggle.getAttribute('aria-checked') !== String(theme === 'dark')) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (!wasSettings) await setMode(page, 'workflow');
}

Then('opening Settings closes the left menu and keeps the Operations header left aligned', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1280, height: 844 });
  await closeCatalog(page);
  const header = page.locator('.site-header');
  await openCatalog(page);
  await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.locator('.settings-drawer');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.getByRole('navigation', { name: 'Operation catalog', exact: true })).toBeHidden();
  await expect.poll(async () => (await header.boundingBox()).x).toBe(0);
  const brand = await page.locator('.brand-controls').boundingBox();
  assert.ok(brand.x >= 0 && brand.x < 32, 'The title and navigation stay anchored to the left.');
  const settings = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  const button = await settings.boundingBox();
  assert.ok(button.x >= 0 && button.x + button.width <= (await drawer.boundingBox()).x);
  await settings.click();
  await expect.poll(async () => (await header.boundingBox()).x).toBe(0);
  await expect(settings).toBeFocused();
});

Then('Settings covers the viewport scrollbar without shifting or scrolling the workflow', async function () {
  const page = this.page;
  await closeCatalog(page);
  await page.evaluate(() => { document.body.style.minHeight = '1800px'; window.scrollTo(0, 80); });
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(80);
  const canvas = page.locator('.workflow-host');
  const before = await canvas.boundingBox();
  const button = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  const target = await button.boundingBox();
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  const drawer = page.locator('.settings-drawer');
  await expect(drawer).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  assert.deepEqual(await canvas.boundingBox(), before);
  assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(innerWidth - 1, 1)?.closest('.settings-drawer'))), true);
  assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(innerWidth - 1, innerHeight - 1)?.closest('.settings-drawer'))), true);
  const bounds = await drawer.boundingBox();
  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, await page.evaluate(() => innerHeight));
  await drawer.hover();
  await page.mouse.wheel(0, 100);
  assert.equal(await page.evaluate(() => scrollY), 80);
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
  assert.deepEqual(await canvas.boundingBox(), before);
  assert.equal(await page.evaluate(() => scrollY), 80);
});

Then('Settings pushes the workflow minimap and button groups beside its pane', async function () {
  const page = this.page;
  await closeCatalog(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const controls = [page.locator('.workflow-toolbar'), page.locator('.workflow-minimap')];
  const before = await Promise.all(controls.map(control => control.boundingBox()));
  await setMode(page, 'settings');
  const drawer = await page.locator('.settings-drawer').boundingBox();
  if (page.viewportSize().width < 1150) {
    for (const [index, control] of controls.entries())
      assert.deepEqual(await control.boundingBox(), before[index], 'Modal Settings preserves control layout.');
  } else for (const control of controls) {
    await expect.poll(async () => {
      const bounds = await control.boundingBox();
      return bounds.x >= -1 && bounds.x + bounds.width <= drawer.x;
    }).toBe(true);
  }
  await setMode(page, 'workflow');
  for (const [index, control] of controls.entries()) {
    await expect.poll(async () => Math.round((await control.boundingBox()).x)).toBe(Math.round(before[index].x));
    await expect.poll(async () => Math.round((await control.boundingBox()).width)).toBe(Math.round(before[index].width));
  }
});

Then('wrapped workflow controls fit their occupied rows', async function () {
  const page = this.page;
  const toolbar = page.locator('.workflow-toolbar');
  for (const width of [800, 390, 900, 1280]) {
    await setMode(page, 'workflow');
    await closeCatalog(page);
    await page.setViewportSize({ width, height: 844 });
    for (const mode of ['workflow', 'settings', ...(width >= 900 ? ['navigation'] : [])]) {
      await setMode(page, mode === 'navigation' ? 'workflow' : mode);
      if (mode === 'navigation') await openCatalog(page);
      await expect.poll(() => toolbar.evaluate(element => {
        const style = getComputedStyle(element);
        const groups = [...element.querySelectorAll('.workflow-control-group')].map(group => group.getBoundingClientRect());
        const rows = new Map();
        for (const group of groups) {
          const key = Math.round(group.top);
          const row = rows.get(key) ?? { left: group.left, right: group.right };
          row.left = Math.min(row.left, group.left); row.right = Math.max(row.right, group.right);
          rows.set(key, row);
        }
        const widest = Math.max(...[...rows.values()].map(row => row.right - row.left));
        const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
          parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        return Math.abs(element.getBoundingClientRect().width - widest - chrome);
      })).toBeLessThanOrEqual(1);
    }
  }
});

Then('the workflow remains editable beside Settings', async function () {
  const page = this.page;
  await closeCatalog(page);
  await setMode(page, 'settings');
  const drawer = page.locator('.settings-drawer');
  const snap = page.locator('.workflow-toolbar').getByRole('button', { name: 'Snap to grid', exact: true });
  const wasSnapped = await snap.getAttribute('aria-pressed');
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', String(wasSnapped !== 'true'));
  const minimap = page.getByRole('group', { name: 'Workflow minimap', exact: true });
  const owner = operationNodes(page, 'Example array response').first();
  const viewport = page.locator('.svelte-flow__viewport');
  const edge = (await drawer.boundingBox()).x;
  await minimap.focus();
  for (let index = 0; index < 30; index++) {
    const bounds = await owner.boundingBox();
    if (bounds.x >= 8 && bounds.x + bounds.width < edge - 8) break;
    const before = await viewport.getAttribute('style');
    await minimap.press(bounds.x < 8 ? 'ArrowLeft' : 'ArrowRight');
    await expect(viewport).not.toHaveAttribute('style', before);
  }
  await owner.click();
  const original = await owner.getAttribute('style');
  await owner.press('ArrowRight');
  await expect(owner).not.toHaveAttribute('style', original);
  const moved = await owner.getAttribute('style');
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  await settings.focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await expect(owner).toHaveAttribute('style', moved);
  await expect(operationNodes(page, 'Example array response')).toHaveCount(1);
  await expect(drawer).toHaveClass(/open/);
});

Then('the left menu overlays the workflow without changing its layout', async function () {
  const page = this.page;
  await closeCatalog(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const canvas = page.locator('.workflow-host');
  const viewport = page.locator('.svelte-flow__viewport');
  const before = await canvas.boundingBox();
  const transform = await viewport.getAttribute('style');
  await openCatalog(page);
  const menu = page.locator('#side-navigation');
  await expect(menu).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  assert.deepEqual(await canvas.boundingBox(), before);
  await expect(viewport).toHaveAttribute('style', transform);
  const toolbar = page.locator('.workflow-toolbar');
  await expect.poll(async () => {
    const bounds = await toolbar.boundingBox(), sidebar = await menu.boundingBox();
    return bounds.x >= sidebar.x + sidebar.width && bounds.x + bounds.width <= before.x + before.width;
  }).toBe(true);
  for (const button of await toolbar.getByRole('button').all()) {
    const bounds = await button.boundingBox(), sidebar = await menu.boundingBox();
    assert.ok(bounds.x >= sidebar.x + sidebar.width && bounds.x + bounds.width <= before.x + before.width, 'Every toolbar action must remain outside the open menu.');
  }
  const close = page.getByRole('button', { name: 'Close navigation', exact: true });
  await expect.poll(async () => (await close.boundingBox()).x >= (await menu.boundingBox()).x + (await menu.boundingBox()).width).toBe(true);
  await close.click();
  await expect(menu).toBeHidden();
  assert.deepEqual(await canvas.boundingBox(), before);
  await expect(viewport).toHaveAttribute('style', transform);
});


Then('Settings disables the workspace when insufficient space remains', async function () {
  const page = this.page, canvas = page.locator('.workflow-workspace');
  await closeCatalog(page);
  await setMode(page, 'settings');
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  const node = page.locator('.svelte-flow__node-operation').first();
  const original = await node.getAttribute('style');
  for (const width of [390, 899, 930, 1000, 1149]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(canvas).toHaveAttribute('inert', '');
    await settings.focus();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('style', original);
    assert.equal(await node.evaluate(element => { element.focus(); return element.contains(document.activeElement); }), false);
    await expect(settings).toBeVisible();
    const close = page.getByRole('button', { name: 'Close settings', exact: true });
    await expect(close).toBeVisible();
    await expect.poll(async () => Math.round((await page.locator('.settings-drawer').boundingBox()).width)).toBe(width);
    assert.equal(await page.getByRole('banner', { includeHidden: true }).evaluate(element => Boolean(element.closest('[inert]'))), true);
  }
  for (const width of [1150, 1220]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(canvas).not.toHaveAttribute('inert');
    await expect.poll(async () => Math.round((await page.locator('.settings-drawer').boundingBox()).x)).toBeGreaterThanOrEqual(250);
    const header = page.getByRole('banner');
    const menu = header.getByRole('button', { name: 'Open navigation', exact: true });
    const settingsButton = header.getByRole('button', { name: 'Settings', exact: true });
    await expect(menu).toBeVisible();
    await expect(settingsButton).toBeVisible();
    const left = await menu.boundingBox(), right = await settingsButton.boundingBox();
    assert.ok(left.x + left.width <= right.x, 'Both header buttons fit without overlapping.');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(canvas).toHaveAttribute('inert', '');
  const toggle = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(canvas).not.toHaveAttribute('inert');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
