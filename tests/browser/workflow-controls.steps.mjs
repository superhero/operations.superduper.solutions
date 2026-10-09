// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { closeCatalog, connections, openCatalog, readExport, setMode, workflow } from "./workspace.steps.mjs";

const storageKey = "operations-flow-documents-v1";
const node = (page, type) => workflow(page).locator(`.svelte-flow__node-${type}`);
const descriptionDialog = page => page.getByRole("dialog", { name: "Workflow description", exact: true });
const savedDialog = page => page.getByRole("dialog", { name: "Saved workflows", exact: true });
const controlComment = '# Release plan\n\n**Ready** [Docs](https://example.com/guide)\n\n<script>window.commentUnsafe = true</script>\n![Image](https://example.com/tracker.png)';

async function choose(page, control, option) {
  await control.click();
  await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function connect(page, source, target) {
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  assert.ok(start && end, "Routing handles must be visible.");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 });
  await page.mouse.up();
}

async function failStorage(page) {
  await page.evaluate(key => {
    window.workflowControlSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error("Storage unavailable for control review");
      return window.workflowControlSetItem.call(this, name, value);
    };
  }, storageKey);
}

async function recoverStorage(page) {
  await page.evaluate(() => {
    if (window.workflowControlSetItem) Storage.prototype.setItem = window.workflowControlSetItem;
    delete window.workflowControlSetItem;
  });
}

function emptyDocument(id, name) {
  return { version: 3, id, name, description: "", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false };
}

async function loadDocuments(page, documents) {
  await page.evaluate(({ key, documents }) => localStorage.setItem(key, JSON.stringify(documents)), { key: storageKey, documents });
  await page.reload();
  await setMode(page, "workflow");
  await expect(page.getByRole("textbox", { name: "Workflow name", exact: true })).toHaveValue(documents.at(-1).name);
}

Given("a workflow with editable routing controls and a comment", async function () {
  await setMode(this.page, "workflow");
  for (const [label, type] of [["Switch", "switch"], ["Cast", "cast"], ["Comment", "comment"]]) {
    await workflow(this.page).getByRole("button", { name: label, exact: true }).click();
    await expect(node(this.page, type)).toHaveCount(1);
  }
  await this.page.getByRole("button", { name: "Fit View", exact: true }).click();
});

When("I connect a numeric cast to the switch", async function () {
  await choose(this.page, node(this.page, "cast").getByRole("combobox", { name: "Cast output type", exact: true }), "Number");
  await connect(this.page, node(this.page, "cast").getByLabel("Number output", { exact: true }),
    node(this.page, "switch").getByLabel("Switch input (Unknown)", { exact: true }));
  await expect(node(this.page, "switch").getByLabel("Switch input (Number)", { exact: true })).toBeVisible();
  await expect(connections(this.page)).toHaveCount(1);
});

When("I edit the switch and remove a connected extra gate", async function () {
  const control = node(this.page, "switch");
  await choose(this.page, control.getByRole("combobox", { name: "Gate 1 operator", exact: true }), "Greater than or equal to");
  const value = control.getByRole("spinbutton", { name: "Gate 1 value", exact: true });
  await value.fill("42");
  await value.press("Control+A");
  await value.press("Delete");
  await expect(control).toHaveCount(1);
  await value.fill("42");
  await control.getByRole("button", { name: "Add gate", exact: true }).click();
  await expect(control.getByLabel("Gate 2 output", { exact: true })).toBeVisible();
  await connect(this.page, node(this.page, "cast").getByLabel("Number output", { exact: true }), control.getByLabel("Gate 2 value input", { exact: true }));
  await expect(connections(this.page)).toHaveCount(2);
  await expect(control.getByRole("textbox", { name: "Gate 2 value", exact: true })).toBeDisabled();
  await control.getByRole("button", { name: "Remove gate 2", exact: true }).click();
  await expect(control.getByLabel("Gate 2 output", { exact: true })).toHaveCount(0);
  await expect(connections(this.page)).toHaveCount(1);
  await expect(control.getByRole("button", { name: "Remove gate 1", exact: true })).toBeDisabled();
});

When("I write a safely formatted workflow comment", async function () {
  const comment = node(this.page, "comment");
  const input = comment.getByRole("textbox", { name: "Comment text (Markdown)", exact: true });
  await input.fill("A draft");
  await input.press("Control+A");
  await input.press("Delete");
  await expect(comment).toHaveCount(1);
  await input.fill(controlComment);
  await input.press("Control+Enter");
  await expect(comment.locator(".comment-markdown h1")).toHaveText("Release plan");
  await expect(comment.locator(".comment-markdown strong")).toHaveText("Ready");
  await expect(comment.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(comment.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("target", "_blank");
  await expect(comment.locator("script, img")).toHaveCount(0);
  assert.equal(await this.page.evaluate(() => window.commentUnsafe), undefined);
  await comment.getByRole("button", { name: "Edit comment", exact: true }).click();
  await expect(input).toHaveValue(controlComment);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
});

When("I describe this workflow as {string}", async function (description) {
  this.controlDescription = description;
  await this.page.getByRole("button", { name: "Describe workflow", exact: true }).click();
  const dialog = descriptionDialog(this.page);
  await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(description);
  await dialog.getByRole("button", { name: "Save description", exact: true }).click();
  await expect(dialog).toBeHidden();
});

Then("the routing controls comment and description retain their edits", async function () {
  const document = (await readExport(this.page)).document;
  assert.equal(document.version, 3);
  assert.equal(document.description, this.controlDescription);
  const routing = document.nodes.find(item => item.type === "switch");
  assert.equal(routing.data.gates.length, 1);
  assert.equal(routing.data.gates[0].operator, ">=");
  assert.equal(routing.data.gates[0].value, "42");
  assert.equal(document.nodes.find(item => item.type === "cast").data.targetType, "Number");
  assert.equal(document.nodes.find(item => item.type === "comment").data.text, controlComment);
  assert.equal(document.edges.length, 1);
  await expect(node(this.page, "switch").getByRole("spinbutton", { name: "Gate 1 value", exact: true })).toHaveValue("42");
  await expect(node(this.page, "comment").locator(".comment-markdown h1")).toHaveText("Release plan");
  await this.page.getByRole("button", { name: "Describe workflow", exact: true }).click();
  await expect(descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true })).toHaveValue(this.controlDescription);
  await descriptionDialog(this.page).getByRole("button", { name: "Close", exact: true }).click();
});

Given("a reusable saved project workflow and an empty parent plan", async function () {
  const field = { id: "project-id", label: "Project ID", type: "Text", required: true, description: "A reusable project identifier.", connectable: true };
  this.reusableFixture = {
    ...emptyDocument("reusable-project", "Reusable project lookup"), description: "Look up a project by its identifier.",
    nodes: [
      { id: "lookup-owner", type: "operation", position: { x: 324, y: 140 }, data: { operationId: "demo:getProject", name: "Get project", description: "Inspect a project.", method: "GET", path: "/projects/{projectId}" } },
      { id: "lookup-input", type: "data", position: { x: 0, y: 140 }, data: { ownerId: "lookup-owner", direction: "inputs", label: "Path parameters", fields: [field] } },
      { id: "lookup-output", type: "data", position: { x: 548, y: 140 }, data: { ownerId: "lookup-owner", direction: "outputs", label: "Response · 200", fields: [field] } },
    ],
    edges: [
      { id: "schema:lookup-input", kind: "schema", source: "lookup-input", sourceHandle: "value", target: "lookup-owner", targetHandle: "schema:lookup-input" },
      { id: "schema:lookup-output", kind: "schema", source: "lookup-owner", sourceHandle: "schema:lookup-output", target: "lookup-output", targetHandle: "value" },
    ],
  };
  await loadDocuments(this.page, [this.reusableFixture, emptyDocument("parent-review", "Parent review")]);
});

When("I insert the saved project workflow from the catalog", async function () {
  await openCatalog(this.page);
  const catalog = this.page.getByRole("navigation", { name: "Saved workflow catalog", exact: true });
  const heading = catalog.locator(":scope > .catalog-group > summary");
  if (await heading.getAttribute("aria-expanded") !== "true") await heading.click();
  const entry = catalog.locator('[data-workflow-id="reusable-project"]');
  const summary = entry.locator(":scope > .catalog-operation > summary");
  if (await summary.getAttribute("aria-expanded") !== "true") await summary.click();
  await entry.getByRole("button", { name: "Add to workflow: Reusable project lookup", exact: true }).click();
  await closeCatalog(this.page);
  await expect(node(this.page, "workflow")).toHaveCount(1);
});

Then("the reusable workflow keeps its ports and embedded definition", async function () {
  await expect(node(this.page, "workflow").locator("[data-workflow-name]")).toHaveAttribute("data-workflow-name", this.reusableFixture.name);
  const document = (await readExport(this.page)).document;
  const reference = document.nodes.find(item => item.type === "workflow");
  assert.equal(reference.data.workflowId, this.reusableFixture.id);
  assert.equal(reference.data.description, this.reusableFixture.description);
  assert.deepEqual(reference.data.snapshot, this.reusableFixture);
  assert.equal(document.nodes.filter(item => item.type === "data").length, 2);
  await expect(workflow(this.page).getByLabel("Project ID input", { exact: true })).toHaveCount(1);
  await expect(workflow(this.page).getByLabel("Project ID output", { exact: true })).toHaveCount(1);
  const saved = await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.deepEqual(saved.find(item => item.id === this.reusableFixture.id), this.reusableFixture);
});

Given("three saved workflow control examples", async function () {
  this.controlDocuments = [emptyDocument("remove-a", "Remove alpha"), emptyDocument("remove-b", "Remove beta"), emptyDocument("keep", "Keep this plan")];
  await loadDocuments(this.page, this.controlDocuments);
});

When("I select two saved workflows for deletion", async function () {
  await this.page.getByRole("button", { name: "Open workflow", exact: true }).click();
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("button", { name: "Delete selected workflows", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Select Remove alpha", exact: true }).check();
  await dialog.getByRole("checkbox", { name: "Select Remove beta", exact: true }).check();
  await dialog.getByRole("button", { name: "Delete selected workflows", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "Confirm removal", exact: true })).toContainText("Remove 2 saved workflows");
});

When("the bulk deletion encounters a storage failure", async function () {
  await failStorage(this.page);
  await savedDialog(this.page).getByRole("button", { name: "Remove", exact: true }).click();
});

Then("the selected saved workflows are retained for retry", async function () {
  await expect(savedDialog(this.page).getByRole("alert")).toContainText("Storage unavailable for control review");
  await expect(savedDialog(this.page).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  assert.deepEqual(await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), this.controlDocuments);
});

When("I retry the bulk deletion after storage recovers", async function () {
  await recoverStorage(this.page);
  await savedDialog(this.page).getByRole("button", { name: "Try again", exact: true }).click();
});

Then("only the unselected saved workflow remains", async function () {
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(dialog.getByRole("checkbox", { name: "Select Keep this plan", exact: true })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Delete selected workflows", exact: true })).toBeDisabled();
  assert.deepEqual(await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), [this.controlDocuments[2]]);
});

When("a workflow description save encounters a storage failure", async function () {
  await this.page.getByRole("button", { name: "Describe workflow", exact: true }).click();
  await descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true }).fill("Keep this description draft after a failed save.");
  await failStorage(this.page);
  await descriptionDialog(this.page).getByRole("button", { name: "Save description", exact: true }).click();
});

Then("the description draft remains available for retry", async function () {
  await expect(descriptionDialog(this.page).getByRole("alert")).toContainText("Storage unavailable for control review");
  await expect(descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep this description draft after a failed save.");
  await expect(descriptionDialog(this.page).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

When("I retry saving the workflow description", async function () {
  await recoverStorage(this.page);
  await descriptionDialog(this.page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(descriptionDialog(this.page)).toBeHidden();
});

Then("the recovered description is saved locally", async function () {
  const saved = await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  assert.equal(saved.at(-1).description, "Keep this description draft after a failed save.");
  await expect(workflow(this.page).getByText("Saved locally", { exact: true })).toBeVisible();
});

Then("the utility controls remain usable in the narrow canvas", async function () {
  const toolbar = workflow(this.page).locator(".workflow-toolbar");
  const bounds = await toolbar.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390, "The complete toolbar must fit the narrow viewport.");
  await choose(this.page, node(this.page, "cast").getByRole("combobox", { name: "Cast output type", exact: true }), "Boolean");
  await expect(node(this.page, "cast").getByLabel("Boolean output", { exact: true })).toBeVisible();
  await node(this.page, "switch").getByRole("button", { name: "Add gate", exact: true }).click();
  await expect(node(this.page, "switch").getByLabel("Gate 2 output", { exact: true })).toBeVisible();
  await node(this.page, "switch").getByRole("button", { name: "Remove gate 2", exact: true }).click();
  const input = node(this.page, "comment").getByRole("textbox", { name: "Comment text (Markdown)", exact: true });
  await input.fill("**Small-screen note**");
  await input.press("Escape");
  await expect(node(this.page, "comment").locator(".comment-markdown strong")).toHaveText("Small-screen note");
});

When("I edit the current plan and fail to open the saved library", async function () {
  await this.page.getByRole("textbox", { name: "Workflow name", exact: true }).fill("Keep the edited draft");
  await workflow(this.page).getByRole("button", { name: "Cast", exact: true }).click();
  this.libraryDraft = (await readExport(this.page)).document;
  await this.page.evaluate(key => {
    window.workflowControlGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (name === key) throw new Error("Saved library unavailable for control review");
      return window.workflowControlGetItem.call(this, name);
    };
  }, storageKey);
  await this.page.getByRole("button", { name: "Open workflow", exact: true }).click();
});

Then("the saved library offers a retry without replacing the draft", async function () {
  await expect(savedDialog(this.page).getByRole("alert")).toContainText("Saved library unavailable for control review");
  await expect(savedDialog(this.page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(this.page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
});

When("I retry loading the saved library after storage recovers", async function () {
  await this.page.evaluate(() => {
    Storage.prototype.getItem = window.workflowControlGetItem;
    delete window.workflowControlGetItem;
  });
  await savedDialog(this.page).getByRole("button", { name: "Retry", exact: true }).click();
});

Then("the saved choices return and the edited draft remains intact", async function () {
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(3);
  await expect(dialog.getByRole("checkbox", { name: "Select Keep this plan", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(this.page.getByRole("textbox", { name: "Workflow name", exact: true })).toHaveValue("Keep the edited draft");
  await expect(node(this.page, "cast")).toHaveCount(1);
  assert.deepEqual((await readExport(this.page)).document, this.libraryDraft);
  assert.deepEqual(await this.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), this.controlDocuments);
});

Given("an imported workflow with previously saved routing operands", async function () {
  this.savedGate = { id: "persisted-gate", operator: ">", value: "previous text" };
  const document = {
    ...emptyDocument("persisted-routing", "Persisted routing"),
    nodes: [
      { id: "persisted-cast", type: "cast", position: { x: 100, y: 180 }, data: { targetType: "Boolean" } },
      { id: "persisted-switch", type: "switch", position: { x: 440, y: 180 }, data: { gates: [this.savedGate] } },
    ],
    edges: [{ id: "persisted-mapping", kind: "mapping", source: "persisted-cast", sourceHandle: "result", target: "persisted-switch", targetHandle: "value" }],
  };
  await setMode(this.page, "workflow");
  await this.page.getByLabel("Import workflow file", { exact: true }).setInputFiles({
    name: "persisted-routing.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(node(this.page, "switch")).toHaveCount(1);
  await expect(node(this.page, "cast")).toHaveCount(1);
  await this.page.getByRole("button", { name: "Fit View", exact: true }).click();
});

Then("importing and editing metadata retain the saved routing operands", async function () {
  assert.deepEqual((await readExport(this.page)).document.nodes.find(item => item.type === "switch").data.gates, [this.savedGate]);
  await this.page.getByRole("textbox", { name: "Workflow name", exact: true }).fill("Renamed persisted routing");
  assert.deepEqual((await readExport(this.page)).document.nodes.find(item => item.type === "switch").data.gates, [this.savedGate]);
});

When("I change the imported cast output to Number", async function () {
  await choose(this.page, node(this.page, "cast").getByRole("combobox", { name: "Cast output type", exact: true }), "Number");
});

Then("the switch adapts its operand to the changed input type", async function () {
  await expect(node(this.page, "switch").getByLabel("Switch input (Number)", { exact: true })).toBeVisible();
  await expect(node(this.page, "switch").getByRole("spinbutton", { name: "Gate 1 value", exact: true })).toHaveValue("");
  const document = (await readExport(this.page)).document;
  assert.deepEqual(document.nodes.find(item => item.type === "switch").data.gates, [{ ...this.savedGate, value: "" }]);
  assert.equal(document.edges.length, 1);
});
