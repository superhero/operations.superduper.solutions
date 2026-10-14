// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { storedWorkflows, restoreWorkflowSaving, repository, workflowStorageWorker } from "./workflow-storage.fixture.mjs";
import { closeWorkflowDetails, expectWorkflowName, openWorkflowDetails, renameWorkflow, workflowNameInput } from "./workflow-details.fixture.mjs";
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { closeCatalog, connections, openCatalog, readExport, setMode, workflow } from "./workspace.steps.mjs";
import { expectHoverHint } from "./workflow-fields.steps.mjs";
import { gesture as connect } from "./workflow-single-input.steps.mjs";

const node = (page, type) => workflow(page).locator(`.svelte-flow__node-${type}`);
const descriptionDialog = page => page.getByRole("dialog", { name: "Workflow details", exact: true });
const savedDialog = page => page.getByRole("dialog", { name: "Saved workflows", exact: true });
const controlComment = '# Release plan\n\n**Ready** [Docs](https://example.com/guide)\n\n<script>window.commentUnsafe = true</script>\n![Image](https://example.com/tracker.png)';
const retainedDescription = "Keep this description draft after a failed save.";
const editedDescription = "Keep this edited description after a failed save.";

async function choose(page, control, option) {
  await control.click();
  await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

const recoverStorage = restoreWorkflowSaving;

async function failControlStorage(page, message, writesOnly) {
  const worker = await workflowStorageWorker(page);
  await worker.evaluate(({ message, writesOnly }) => {
    self.workflowControlTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (this.name === 'v1/workflows/index' && (!writesOnly || mode === 'readwrite')) throw new Error(message);
      return self.workflowControlTransaction.call(this, stores, mode, options);
    };
  }, { message, writesOnly });
}

async function recoverControlStorage(page) {
  const worker = await workflowStorageWorker(page);
  await worker.evaluate(() => {
    IDBDatabase.prototype.transaction = self.workflowControlTransaction;
    delete self.workflowControlTransaction;
  });
}

function emptyDocument(id, name) {
  return { version: 3, id, name, description: "", nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false };
}

async function loadDocuments(page, documents) {
  for (const document of documents) await repository(page, 'save', document, null);
  await page.reload();
  await setMode(page, "workflow");
  await expectWorkflowName(page, documents.at(-1).name);
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
  await expect(comment.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "https://example.com/guide");
  await expect(comment.locator("script, img")).toHaveCount(0);
  assert.equal(await this.page.evaluate(() => window.commentUnsafe), undefined);
  const preview = comment.getByRole("button", { name: "Edit comment text", exact: true });
  await expectHoverHint(preview, 'Click or press Enter to edit');
  await expect(preview).toHaveAttribute('tabindex', '0');
  await preview.click();
  await expect(input).toHaveValue(controlComment);
  await input.press("Escape");
  await expect(input).toHaveCount(0);
});

When("I describe this workflow as {string}", async function (description) {
  this.controlDescription = description;
  await this.page.getByRole("button", { name: "Workflow details", exact: true }).click();
  const dialog = descriptionDialog(this.page);
  await expect(workflowNameInput(this.page)).toBeFocused();
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill(description);
  await dialog.getByRole("button", { name: "Save workflow details", exact: true }).click();
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
  await this.page.getByRole("button", { name: "Workflow details", exact: true }).click();
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
  await entry.getByRole("button", { name: "Add to workflow: Reusable project lookup", exact: true }).click();
  await closeCatalog(this.page);
  await expect(node(this.page, "workflow")).toHaveCount(1);
});

Then("the reusable workflow keeps its ports and embedded definition", async function () {
  const page = this.page;
  const referenceNode = node(page, "workflow");
  await expect(referenceNode.locator("[data-workflow-name]")).toHaveAttribute("data-workflow-name", this.reusableFixture.name);
  await expect(referenceNode.locator('[title]')).toHaveCount(0);
  const title = referenceNode.locator('.operation-title-row');
  await expect(title.locator('strong')).toHaveText(this.reusableFixture.name);
  await expect(title.locator('.material-symbols-rounded')).toHaveText('flowsheet');
  await expectHoverHint(title, this.reusableFixture.description);
  await expect(referenceNode.locator('.operation-ports.inputs .port-label')).toHaveText('Get project · Path parameters');
  await expect(referenceNode.locator('.operation-ports.outputs .port-label')).toHaveText('Get project · Response · 200');
  await expect(referenceNode.locator('.operation-port .port-type')).toHaveText(['Object', 'Object']);
  const inputPort = referenceNode.getByLabel('Get project · Path parameters input', { exact: true });
  const outputPort = referenceNode.getByLabel('Get project · Response · 200 output', { exact: true });
  await expectHoverHint(inputPort, 'Get project · Path parameters');
  for (const port of [inputPort, outputPort]) {
    await expect(port).toHaveAttribute('tabindex', '-1');
    await expect(port).toHaveAttribute('aria-disabled', 'true');
    await expect(port).not.toHaveClass(/\bconnectablestart\b|\bconnectableend\b/);
  }
  const layout = await referenceNode.evaluate(element => {
    const title = element.querySelector('.operation-title-row').getBoundingClientRect();
    const row = direction => {
      const connection = element.querySelector(`.operation-ports.${direction} .operation-port`);
      const row = connection.getBoundingClientRect();
      const port = connection.querySelector('.svelte-flow__handle').getBoundingClientRect();
      return { top: row.top, bottom: row.bottom, side: direction === 'inputs' ? row.left : row.right,
        center: row.y + row.height / 2, portX: port.x + port.width / 2, portY: port.y + port.height / 2 };
    };
    return { title: { top: title.top, bottom: title.bottom }, inputs: row('inputs'), outputs: row('outputs') };
  });
  assert.ok(layout.inputs.bottom <= layout.title.top && layout.title.bottom <= layout.outputs.top,
    'Reusable workflow input rows appear above the title and output rows below it.');
  for (const row of [layout.inputs, layout.outputs])
    assert.ok(Math.abs(row.portY - row.center) < 1 && Math.abs(row.portX - row.side) < 1,
      'Each schema handle remains centered on its own connection row.');
  const document = (await readExport(page)).document;
  const reference = document.nodes.find(item => item.type === "workflow");
  assert.equal(reference.data.workflowId, this.reusableFixture.id);
  assert.equal(reference.data.description, this.reusableFixture.description);
  assert.deepEqual(reference.data.snapshot, this.reusableFixture);
  assert.equal(document.nodes.filter(item => item.type === "data").length, 2);
  for (const [direction, port] of [['inputs', inputPort], ['outputs', outputPort]]) {
    const panel = document.nodes.find(item => item.type === 'data' && item.data.direction === direction);
    const id = `schema:${panel.id}`;
    await expect(port).toHaveAttribute('data-handleid', id);
    assert.equal(document.edges.find(edge => edge.id === id)[direction === 'inputs' ? 'targetHandle' : 'sourceHandle'], id);
  }
  await expect(workflow(page).getByLabel("Project ID input", { exact: true })).toHaveCount(1);
  await expect(workflow(page).getByLabel("Project ID output", { exact: true })).toHaveCount(1);
  const inputPanel = workflow(page).locator('.workflow-data-node[data-direction="inputs"]');
  await inputPanel.locator('.data-title strong').click();
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  await expect(inputPanel).toHaveCount(0);
  await expect(inputPort).toBeHidden();
  const restore = referenceNode.getByRole('button', { name: 'Restore Get project · Path parameters', exact: true });
  await expect(restore).toHaveAttribute('data-side', 'left');
  await expectHoverHint(restore, 'Restore Get project · Path parameters');
  await restore.focus();
  await page.keyboard.press('Enter');
  await expect(inputPanel).toBeVisible();
  await expect(inputPort).toBeVisible();
  await expect(restore).toHaveCount(0);
  const restored = (await readExport(page)).document;
  assert.deepEqual(restored.nodes, document.nodes, 'Restoration preserves the embedded snapshot, interface fields, and node identities.');
  assert.deepEqual(restored.edges, document.edges, 'Restoration preserves the schema connection identities and endpoints.');
  await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  const saved = await storedWorkflows(page);
  assert.deepEqual(saved.find(item => item.id === this.reusableFixture.id), this.reusableFixture);
});

function embeddedWorkflow(id, snapshot, x = 0) {
  return { id, type: "workflow", position: { x, y: 0 }, data: {
    workflowId: snapshot.id, name: snapshot.name, description: snapshot.description, snapshot,
  } };
}

Given("a saved workflow containing a reference to itself", async function () {
  this.referenceSource = emptyDocument("self-reference", "Original self-reference");
  await loadDocuments(this.page, [{ ...this.referenceSource,
    nodes: [embeddedWorkflow("embedded-self", this.referenceSource)],
  }]);
  await expect(node(this.page, "workflow")).toHaveCount(1);
});

Then("the self-reference shows {string} with its original snapshot", async function (name) {
  const reference = node(this.page, "workflow");
  await expect(reference.locator(".operation-title-row strong")).toHaveText(name);
  await expect(reference.locator("[data-workflow-name]")).toHaveAttribute("data-workflow-name", name);
  const { document } = await readExport(this.page);
  assert.equal(document.name, name);
  assert.deepEqual(document.nodes[0].data.snapshot, this.referenceSource);
});

Given("a parent workflow containing two copies of a saved workflow", async function () {
  this.referenceSource = emptyDocument("rename-source", "Original source workflow");
  const parent = { ...emptyDocument("rename-parent", "Parent of renamed references"), nodes: [
    embeddedWorkflow("first-reference", this.referenceSource),
    embeddedWorkflow("second-reference", this.referenceSource, 360),
  ] };
  await loadDocuments(this.page, [this.referenceSource, parent]);
  await expect(node(this.page, "workflow")).toHaveCount(2);
  this.referenceParent = await repository(this.page, "load", parent.id);
});

When("the saved source workflow is renamed to {string}", async function (name) {
  const source = await repository(this.page, "load", this.referenceSource.id);
  await repository(this.page, "save", { ...source.document, name }, source.revision);
});

When("the saved source workflow is removed", async function () {
  await repository(this.page, "remove", [this.referenceSource.id]);
});

Then("both references show {string} without changing their saved definitions", async function (name) {
  await expect(node(this.page, "workflow").locator(".operation-title-row strong")).toHaveText([name, name]);
  const { document } = await readExport(this.page);
  assert.deepEqual(document.nodes, this.referenceParent.document.nodes);
  const parent = await repository(this.page, "load", this.referenceParent.document.id);
  assert.equal(parent.revision, this.referenceParent.revision, "A source-name update must not create a parent revision.");
  assert.deepEqual(parent.document.nodes, this.referenceParent.document.nodes);
});

Given("three saved workflow control examples", async function () {
  this.controlDocuments = [emptyDocument("remove-a", "Remove alpha"), emptyDocument("remove-b", "Remove beta"), emptyDocument("keep", "Keep this plan")];
  await loadDocuments(this.page, this.controlDocuments);
});

When("I cancel removing a saved workflow from its row", async function () {
  await this.page.getByRole("button", { name: "Open workflow", exact: true }).click();
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete selected workflows", exact: true })).toHaveCount(0);
  for (const document of this.controlDocuments)
    await expect(dialog.getByRole("button", { name: `Remove ${document.name}`, exact: true })
      .locator('.material-symbols-rounded')).toHaveText('delete');
  await dialog.getByRole("button", { name: "Remove Remove beta", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "Confirm removal", exact: true })).toContainText('Remove “Remove beta”');
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

Then("all saved workflow control examples remain", async function () {
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("group", { name: "Confirm removal", exact: true })).toHaveCount(0);
  await expect(dialog.locator('.saved-documents li')).toHaveCount(3);
  assert.deepEqual(await storedWorkflows(this.page), this.controlDocuments);
});

When("removing one saved workflow encounters a storage failure", async function () {
  const dialog = savedDialog(this.page);
  await dialog.getByRole("button", { name: "Remove Remove alpha", exact: true }).click();
  await expect(dialog.getByRole("group", { name: "Confirm removal", exact: true })).toContainText('Remove “Remove alpha”');
  await failControlStorage(this.page, 'Storage unavailable for control review', true);
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
});

Then("the saved workflow is retained for retry", async function () {
  await expect(savedDialog(this.page).getByRole("alert")).toContainText("Storage unavailable for control review");
  await expect(savedDialog(this.page).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  assert.deepEqual(await storedWorkflows(this.page), this.controlDocuments);
});

When("I retry removing the workflow after storage recovers", async function () {
  await recoverControlStorage(this.page);
  await savedDialog(this.page).getByRole("button", { name: "Try again", exact: true }).click();
});

Then("only that saved workflow is removed", async function () {
  const dialog = savedDialog(this.page);
  await expect(dialog.locator('.saved-documents li')).toHaveCount(2);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Remove Remove alpha", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Remove Remove beta", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove Keep this plan", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete selected workflows", exact: true })).toHaveCount(0);
  assert.deepEqual(await storedWorkflows(this.page), this.controlDocuments.slice(1));
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expectWorkflowName(this.page, "Keep this plan");
});

When("a workflow description save encounters a storage failure", async function () {
  const savedStatus = this.page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true });
  await expect(savedStatus).toBeVisible();
  await this.page.getByRole("button", { name: "Workflow details", exact: true }).click();
  await workflowNameInput(this.page).fill("Retained workflow details");
  const description = descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true });
  await description.focus();
  await expect(savedStatus).toBeVisible();
  const saved = (await storedWorkflows(this.page)).at(-1);
  this.descriptionHistoryBefore = await repository(this.page, "inspect", saved.id);
  const worker = await workflowStorageWorker(this.page);
  await worker.evaluate(() => {
    self.workflowAutosaveTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      // Fail after the Git commit is durable, so retry must recover that exact
      // submitted snapshot before saving any edits made while storage was down.
      if (mode === "readwrite" && this.name === "v1/workflows/index"
        && Array.isArray(stores) && stores.includes("catalog") && stores.includes("pending"))
        throw new Error("Storage unavailable for control review");
      return self.workflowAutosaveTransaction.call(this, stores, mode, options);
    };
  });
  await description.fill(retainedDescription);
  await descriptionDialog(this.page).getByRole("button", { name: "Save workflow details", exact: true }).click();
});

Then("the description draft remains available for retry", async function () {
  await expect(descriptionDialog(this.page).getByRole("alert")).toContainText("Storage unavailable for control review");
  await expect(workflowNameInput(this.page)).toHaveValue("Retained workflow details");
  await expect(descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true })).toHaveValue(retainedDescription);
  await expect(descriptionDialog(this.page).getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

When("I continue editing the description after the failed save", async function () {
  await descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true }).fill(editedDescription);
});

When("I retry saving the workflow description", async function () {
  await recoverStorage(this.page);
  await descriptionDialog(this.page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(descriptionDialog(this.page)).toBeHidden();
});

Then("the recovered description is saved locally", async function () {
  const saved = await storedWorkflows(this.page);
  assert.equal(saved.at(-1).name, "Retained workflow details");
  assert.equal(saved.at(-1).description, editedDescription);
  const history = await repository(this.page, "inspect", saved.at(-1).id);
  assert.deepEqual(history.versions.slice(2), this.descriptionHistoryBefore.versions, "Retry must preserve the existing history.");
  assert.equal(JSON.parse(history.versions[1].text).description, retainedDescription,
    "The interrupted submitted description must become its own recovered version.");
  assert.equal(JSON.parse(history.versions[0].text).description, editedDescription);
  assert.deepEqual(history.versions[0].parent, [history.versions[1].oid]);
  assert.deepEqual(history.versions[1].parent, [this.descriptionHistoryBefore.versions[0].oid]);
  await expect(this.page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
  await this.page.reload();
  await setMode(this.page, "workflow");
  await openWorkflowDetails(this.page);
  await expect(workflowNameInput(this.page)).toHaveValue("Retained workflow details");
  await expect(descriptionDialog(this.page).getByRole("textbox", { name: "Description", exact: true })).toHaveValue(editedDescription);
  await closeWorkflowDetails(this.page);
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
  await renameWorkflow(this.page, "Keep the edited draft");
  await workflow(this.page).getByRole("button", { name: "Cast", exact: true }).click();
  this.libraryDraft = (await readExport(this.page)).document;
  await expect(this.page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
  await failControlStorage(this.page, 'Saved library unavailable for control review', false);
  await this.page.getByRole("button", { name: "Open workflow", exact: true }).click();
});

Then("the saved library offers a retry without replacing the draft", async function () {
  await expect(savedDialog(this.page).getByRole("alert")).toContainText("Saved library unavailable for control review");
  await expect(savedDialog(this.page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(this.page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
});

When("I retry loading the saved library after storage recovers", async function () {
  await recoverControlStorage(this.page);
  await savedDialog(this.page).getByRole("button", { name: "Retry", exact: true }).click();
});

Then("the saved choices return and the edited draft remains intact", async function () {
  const dialog = savedDialog(this.page);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator('.saved-documents li')).toHaveCount(3);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Remove Keep the edited draft", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expectWorkflowName(this.page, "Keep the edited draft");
  await expect(node(this.page, "cast")).toHaveCount(1);
  assert.deepEqual((await readExport(this.page)).document, this.libraryDraft);
  assert.deepEqual(await storedWorkflows(this.page), [...this.controlDocuments.slice(0, 2), this.libraryDraft]);
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
  await renameWorkflow(this.page, "Renamed persisted routing");
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
