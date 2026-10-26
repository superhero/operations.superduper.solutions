// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Reusable browser helpers; importing this module registers no steps or hooks.
import { closeWorkflowDetails, expectWorkflowName, renameWorkflow, workflowNameInput, workflowDetails } from './workflow-details.fixture.mjs';
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { operations } from "../../src/lib/catalog.ts";
import { catalogs } from "../../src/lib/catalog-registry.ts";
import { operationNavigation, operationResourceGroups } from "../../src/lib/operation-navigation.ts";
import { catalogHierarchy } from "../../src/lib/catalog-hierarchy.ts";
import { defaultToolbarButtons, toolbarButtonLabels } from "../../src/lib/toolbar-settings.ts";
import { seedOperationGraph } from "./workflow-graph.fixture.mjs";
import { expect } from "@playwright/test";

const workflow = page => page.getByRole("region", { name: "Workflow canvas", exact: true });

const workspace = page => page.getByRole("dialog", { name: /^Run workflow:/ });

const operationNodes = (page, name) => workflow(page).locator(".svelte-flow__node-operation").filter({
  has: page.locator(`[data-operation-name=${JSON.stringify(name)}]`)
});

const connections = page => workflow(page).locator(".svelte-flow__edge:not(.workflow-schema-edge)");

async function openCatalog(page) {
  await page.locator('#startup-status').waitFor({ state: 'detached' });
  const activeSettings = page.locator('.site-header button[aria-controls="settings-panel"][aria-pressed="true"]');
  if (await page.evaluate(() => matchMedia('(max-width: 899px)').matches) && await activeSettings.count()) {
    await expect(page.getByRole('button', { name: 'Close settings', exact: true })).toBeVisible();
  }
  const mobileClose = page.getByRole('button', { name: 'Close settings', exact: true });
  if (await mobileClose.isVisible()) {
    await mobileClose.click();
    await expect(page.locator('.settings-drawer')).toBeHidden();
  }
  if (await activeSettings.count()) {
    await activeSettings.click();
    await expect(page.locator('.settings-drawer')).toBeHidden();
  }
  const open = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(open.or(page.getByRole("button", { name: "Close navigation", exact: true })).first()).toBeVisible();
  if (await open.isVisible()) await open.click();
  await expect(page.getByRole("navigation", { name: "Operation catalog", exact: true })).toBeVisible();
}

async function closeCatalog(page) {
  await page.locator("#startup-status").waitFor({ state: "detached" });
  if (await page.evaluate(() => matchMedia('(max-width: 899px)').matches) &&
      await page.locator('.site-header [aria-controls="side-navigation"]').getAttribute('aria-expanded') === 'true')
    await expect(page.locator('#side-navigation')).toHaveAttribute('data-slot', 'sheet-content');
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("navigation", { name: "Operation catalog", exact: true })
  });
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close navigation", exact: true }).click();
    await expect(dialog).toBeHidden();
  } else {
    const close = page.getByRole("button", { name: "Close navigation", exact: true });
    if (await close.isVisible()) await close.click();
  }
}

async function revealCatalogOperation(page, name) {
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
    await expect(workflowDetails(page)).toBeVisible();
    await closeWorkflowDetails(page);
  }
  const entry = await revealCatalogOperation(page, name);
  await entry.getByRole("button", { name: `Add to workflow: ${name}`, exact: true }).click();
  await expect(operationNodes(page, name).last()).toBeVisible();
  await closeCatalog(page);
  if (mode !== "workflow") {
    await workflowAction(page, "Run");
    await expect(workspace(page).getByRole("heading", { name: new RegExp(`^1\\. .+ / ${RegExp.escape(name)}$`) })).toBeVisible();
  }
}

async function quitRun(page) {
  const run = workspace(page);
  if (await run.isVisible()) {
    await run.getByRole("button", { name: "Quit", exact: true }).click();
    await expect(run).toHaveCount(0);
  }
}

async function restartRun(page, restoreInputs = false) {
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

const executeOperation = page => workspace(page).getByRole("button", { name: /^(Start workflow|Run operation|Retry operation)$/ }).click();

const preparedRequest = page => workspace(page).getByRole("region", { name: /^(Prepared request|Step \d+ prepared request)$/ });

async function applyDisplayedTheme(page, theme) {
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
  const header = page.getByRole('banner');
  const button = header.getByRole('button', { name: 'Settings', exact: true });
  const active = header.locator('button[aria-controls="settings-panel"][aria-pressed="true"]');
  if (mode === 'workflow') {
    if (await active.count()) await active.click();
  } else if (await button.getAttribute('aria-pressed') !== 'true') {
    await button.click();
    await expect(page.getByRole('region', { name: 'Settings workspace', exact: true })).toBeFocused();
  }
  const target = mode === "workflow" ? workflow(page) : mode === "settings" ? page.getByRole("region", { name: "Settings workspace", exact: true }) : workflow(page);
  await expect(target).toBeVisible();
}

async function setEvaluationDetails(page, enabled = true) {
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

async function includeField(page, label) {
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

async function searchOperations(page, prompt) {
  await openCatalog(page);
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill(prompt);
  await expect(page.locator(".catalog-prompt")).toHaveAttribute("data-evaluated-prompt", prompt.trim() ? prompt : "");
  await expect(page.locator(".catalog-prompt")).toHaveAttribute("aria-busy", "false");
}

async function openThemeSettings(page) {
  await setMode(page, 'settings');
  const mode = page.getByRole('switch', { name: 'AI assistant', exact: true });
  if (await mode.getAttribute('aria-checked') === 'true') await mode.click();
  const section = page.getByRole('region', { name: 'Settings workspace', exact: true }).locator('summary[aria-label="Theme"]');
  if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
  await expect(page.getByRole('group', { name: 'Color palette', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Settings workspace', exact: true }).getByRole('switch', { name: 'Dark theme', exact: true })).toBeVisible();
  await expect(page.locator('#side-navigation').getByRole('switch', { name: 'Dark theme', exact: true })).toHaveCount(0);
}

async function selectThemeMode(page, theme) {
  const wasSettings = await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).getAttribute('aria-pressed') === 'true';
  await openThemeSettings(page);
  const toggle = page.getByRole('switch', { name: 'Dark theme', exact: true });
  if (await toggle.getAttribute('aria-checked') !== String(theme === 'dark')) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (!wasSettings) await setMode(page, 'workflow');
}

export { workflow, workspace, operationNodes, connections, openCatalog, closeCatalog, revealCatalogOperation, chooseCatalogOperation, quitRun, restartRun, executeOperation, preparedRequest, applyDisplayedTheme, setMode, setEvaluationDetails, field, includeField, fillField, expectFieldValue, workflowAction, readExport, visibleNodeCount, searchOperations, openThemeSettings, selectThemeMode };
