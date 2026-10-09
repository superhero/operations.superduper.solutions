// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { workflow, workflowAction, setMode } from "./workspace.steps.mjs";

const storageKey = "operations-flow-documents-v1";
const maxFileSize = 2_000_000;
const workflowName = page => page.getByRole("textbox", { name: "Workflow name", exact: true });
const toolbarButton = (page, action) => page.getByRole("button", { name: `${action} workflow`, exact: true });
const replacementDialog = page => page.getByRole("dialog", { name: "Unsaved changes", exact: true });

function fixture(id, name) {
  return {
    version: 1, id, name,
    nodes: [100, 460].map((x, index) => ({
      id: `${id}-${index}`, position: { x, y: 140 },
      data: { operationId: "demo:listProjects", name: "List projects", description: "Review the project list.", method: "GET", path: "/projects" },
    })),
    edges: [{ id: `${id}-connection`, source: `${id}-0`, target: `${id}-1` }],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false,
  };
}

async function loadFixtures(page, documents) {
  await page.evaluate(({ key, documents }) => localStorage.setItem(key, JSON.stringify(documents)), { key: storageKey, documents });
  await page.reload();
  await setMode(page, "workflow");
  await expect(workflowName(page)).toHaveValue(documents.at(-1).name);
}

async function readExport(page) {
  const downloading = page.waitForEvent("download");
  await workflowAction(page, "Export");
  const download = await downloading;
  const stream = await download.createReadStream();
  assert.ok(stream, "The exported workflow should be downloadable.");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  return { buffer, document: JSON.parse(buffer.toString("utf8")) };
}

async function chooseSaved(page, name) {
  await toolbarButton(page, "Open").click();
  await page.getByRole("dialog", { name: "Saved workflows", exact: true })
    .getByRole("button").filter({ has: page.getByText(name, { exact: true }) }).click();
}

Given("two saved QA workflows and an edited current draft", async function () {
  this.qaOriginal = fixture("qa-current", "Original QA flow");
  this.qaOther = fixture("qa-other", "Other QA flow");
  await loadFixtures(this.page, [this.qaOther, this.qaOriginal]);
  await workflowName(this.page).fill("Edited QA draft");
  await this.page.getByRole("button", { name: "Snap to grid", exact: true }).click();
  this.qaDraft = (await readExport(this.page)).document;
  await expect(workflow(this.page).getByText("Unsaved changes", { exact: true })).toBeVisible();
});

When("I cancel a pending {word} replacement with {word}", async function (action, dismissal) {
  if (action === "Open") await chooseSaved(this.page, this.qaOriginal.name);
  else if (action === "Import") {
    const choosing = this.page.waitForEvent("filechooser");
    await workflowAction(this.page, "Import");
    await (await choosing).setFiles({ name: "other-workflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(this.qaOther)) });
  } else await toolbarButton(this.page, action).click();
  const dialog = replacementDialog(this.page);
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  if (dismissal === "Escape") await this.page.keyboard.press("Escape");
  else await dialog.getByRole("button", { name: dismissal, exact: true }).click();
  await expect(dialog).toBeHidden();
});

Then("the edited QA draft and useful focus are retained after {word}", async function (action) {
  if (action === "Open") await expect(workflow(this.page)).toBeFocused();
  else if (action === "Import") await expect(this.page.getByRole("button", { name: "Workflow actions", exact: true })).toBeFocused();
  else await expect(toolbarButton(this.page, action)).toBeFocused();
  assert.deepEqual((await readExport(this.page)).document, this.qaDraft);
  await expect(workflow(this.page).getByText("Unsaved changes", { exact: true })).toBeVisible();
  assert.deepEqual(await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), [this.qaOther, this.qaOriginal]);
});

When("I open the {word} saved QA workflow with {string}", async function (target, choice) {
  await chooseSaved(this.page, (target === "current" ? this.qaOriginal : this.qaOther).name);
  await replacementDialog(this.page).getByRole("button", { name: choice, exact: true }).click();
  await expect(replacementDialog(this.page)).toBeHidden();
});

Then("the {word} QA workflow reflects {string} and storage remains consistent", async function (target, choice) {
  const savedCurrent = choice === "Save and continue" ? this.qaDraft : this.qaOriginal;
  const expected = target === "current" ? savedCurrent : this.qaOther;
  await expect(workflowName(this.page)).toHaveValue(expected.name);
  await expect(workflow(this.page)).toBeFocused();
  await expect(workflow(this.page).getByText("Saved locally", { exact: true })).toBeVisible();
  assert.deepEqual((await readExport(this.page)).document, expected);
  assert.deepEqual(await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), [this.qaOther, savedCurrent]);
});

Given("a connected saved QA workflow", async function () {
  await loadFixtures(this.page, [fixture("qa-connection", "Connection QA flow")]);
});

Then("I can select the connection beside its visible line while hovered", async function () {
  const edge = workflow(this.page).getByRole("group", { name: /^Edge from / });
  const visiblePath = edge.locator(".svelte-flow__edge-path");
  const interactionPath = edge.locator(".svelte-flow__edge-interaction");
  await expect(interactionPath).toHaveCSS("stroke-width", "20px");
  const point = await visiblePath.evaluate(path => {
    const middle = path.getTotalLength() / 2;
    const matrix = path.getScreenCTM();
    const screenPoint = length => {
      const point = path.getPointAtLength(length);
      return new DOMPoint(point.x, point.y).matrixTransform(matrix);
    };
    const center = screenPoint(middle);
    const before = screenPoint(middle - 1);
    const after = screenPoint(middle + 1);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    return { x: center.x, y: center.y, besideX: center.x - dy / length * 6, besideY: center.y + dx / length * 6 };
  });
  await this.page.mouse.move(point.x, point.y);
  await expect(visiblePath).toHaveCSS("stroke-width", "3px");
  await expect(interactionPath).toHaveCSS("stroke-width", "20px");
  await this.page.mouse.move(point.besideX, point.besideY);
  await expect(visiblePath).toHaveCSS("stroke-width", "3px");
  await this.page.mouse.click(point.besideX, point.besideY);
  await expect(edge).toHaveClass(/selected/);
});

function largeFixture(descriptionLength) {
  const document = fixture("size-doc", "Boundary QA flow");
  document.nodes = Array.from({ length: 300 }, (_, index) => ({
    id: String(index), position: { x: index, y: index },
    data: { operationId: "op", name: "Operation", description: "界".repeat(descriptionLength), method: "GET", path: "/test" },
  }));
  document.edges = [];
  return document;
}

Given("a compact QA workflow file just below the import size limit", async function () {
  this.qaBoundary = largeFixture(2140);
  this.qaBoundaryBuffer = Buffer.from(JSON.stringify(this.qaBoundary));
  assert.ok(this.qaBoundaryBuffer.length < maxFileSize);
  assert.ok(Buffer.byteLength(JSON.stringify(this.qaBoundary, null, 2)) > maxFileSize);
  await setMode(this.page, "workflow");
});

When("I import, export and reimport the near-limit QA workflow", async function () {
  const upload = this.page.getByLabel("Import workflow file", { exact: true });
  await upload.setInputFiles({ name: "compact-workflow.json", mimeType: "application/json", buffer: this.qaBoundaryBuffer });
  await expect(workflowName(this.page)).toHaveValue(this.qaBoundary.name);
  this.qaFirstImport = await readExport(this.page);
  assert.ok(this.qaFirstImport.buffer.length <= maxFileSize, "The exported file must fit the import byte limit.");
  await upload.setInputFiles({ name: "exported-workflow.json", mimeType: "application/json", buffer: this.qaFirstImport.buffer });
  await replacementDialog(this.page).getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(replacementDialog(this.page)).toBeHidden();
});

Then("the near-limit QA workflow preserves its graph under a new identity", async function () {
  await expect(workflow(this.page).getByRole("alert")).toHaveCount(0);
  const { id: firstId, viewport: firstViewport, ...first } = this.qaFirstImport.document;
  const { id: secondId, viewport: secondViewport, ...second } = (await readExport(this.page)).document;
  assert.notEqual(firstId, secondId);
  assert.deepEqual(second, first);
  assert.ok(firstViewport.zoom > 0 && secondViewport.zoom > 0);
});

Given("a locally saved QA workflow larger than the import size limit", async function () {
  const document = largeFixture(2200);
  assert.ok(Buffer.byteLength(JSON.stringify(document)) > maxFileSize);
  await loadFixtures(this.page, [document]);
});

Then("exporting the oversized QA workflow explains how to reduce it without downloading", async function () {
  const downloads = [];
  this.page.on("download", download => downloads.push(download));
  await workflowAction(this.page, "Export");
  await expect(workflow(this.page).getByRole("alert")).toContainText("Reduce this plan before exporting it.");
  assert.equal(downloads.length, 0);
  await expect(workflowName(this.page)).toHaveValue("Boundary QA flow");
});
