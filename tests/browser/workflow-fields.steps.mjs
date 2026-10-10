// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { storedWorkflows } from "./workflow-storage.fixture.mjs";
import { expectWorkflowName } from './workflow-details.fixture.mjs';
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { chooseCatalogOperation, connections, operationNodes, readExport, setMode, workflow } from "./workspace.steps.mjs";
import { operations } from "../../src/lib/catalog.ts";
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";

const panels = (page, ownerId, direction) => workflow(page).locator(
  `.workflow-data-node[data-owner-id=${JSON.stringify(ownerId)}]${direction ? `[data-direction=${JSON.stringify(direction)}]` : ""}`
);
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namedPanel = (page, ownerId, direction, label) => panels(page, ownerId, direction)
  .filter({ has: page.locator(`.data-title strong[title=${JSON.stringify(label)}]`) });
const fieldRow = (panel, label) => panel.locator(".data-field").filter({ has: panel.page().locator(".field-name").filter({ hasText: new RegExp(`^${literal(label)}(?:\\s*\\*)?$`) }) });
const preview = page => workflow(page).locator(".workflow-connection-preview");

async function ownerId(page, name) {
  const node = operationNodes(page, name);
  await expect(node).toHaveCount(1);
  const id = await node.getAttribute("data-id");
  assert.ok(id, "The operation must have a stable workflow identity.");
  return id;
}

async function mappingPorts(world) {
  const sourceOwner = await ownerId(world.page, "Get project");
  const targetOwner = await ownerId(world.page, "Create task");
  const source = panels(world.page, sourceOwner, "outputs").getByLabel("Project ID output", { exact: true });
  const target = namedPanel(world.page, targetOwner, "inputs", "Path parameters").getByLabel("Project ID input", { exact: true });
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceNode = await source.evaluate(element => element.closest(".svelte-flow__node").dataset.id);
  const targetNode = await target.evaluate(element => element.closest(".svelte-flow__node").dataset.id);
  world.fieldEndpoints = {
    source: sourceNode, target: targetNode,
    sourceHandle: await source.getAttribute("data-handleid"), targetHandle: await target.getAttribute("data-handleid"),
  };
  return { source, target };
}

async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, "The connection target must have visible bounds.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function beginDrag(page, source) {
  const start = await center(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y, { steps: 3 });
}

async function expectMapping(world) {
  await expect(connections(world.page)).toHaveCount(1);
  const document = (await readExport(world.page)).document;
  const mappings = document.edges.filter(edge => edge.kind === "mapping");
  assert.equal(mappings.length, 1, "A gesture must create exactly one field mapping.");
  const { source, target, sourceHandle, targetHandle } = mappings[0];
  assert.deepEqual({ source, target, sourceHandle, targetHandle }, world.fieldEndpoints);
  assert.ok(document.edges.some(edge => edge.kind === "schema"), "Field mappings must preserve structural schema connections.");
}

async function expectOwnerLayout(node, inputs, outputs) {
  await expect(node.locator('.operation-ports.inputs .port-label')).toHaveText(inputs);
  await expect(node.locator('.operation-ports.outputs .port-label')).toHaveText(outputs);
  await expect(node.locator('.operation-title-row .material-symbols-rounded')).toHaveText('http');
  const layout = await node.evaluate(element => {
    const bounds = selector => element.querySelector(selector).getBoundingClientRect();
    const title = bounds('.operation-title-row');
    const shape = bounds('.operation-node');
    return { title: { top: title.top, bottom: title.bottom }, shape: { left: shape.left, right: shape.right },
      inputs: [...element.querySelectorAll('.operation-ports.inputs .svelte-flow__handle')].map(handle => {
        const box = handle.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, left: handle.classList.contains('svelte-flow__handle-left') };
      }), outputs: [...element.querySelectorAll('.operation-ports.outputs .svelte-flow__handle')].map(handle => {
        const box = handle.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, right: handle.classList.contains('svelte-flow__handle-right') };
      }) };
  });
  for (const port of layout.inputs) {
    assert.equal(port.left, true);
    assert.ok(port.y < layout.title.top && Math.abs(port.x - layout.shape.left) < 2, 'Input handles sit above the identity at the left edge.');
  }
  for (const port of layout.outputs) {
    assert.equal(port.right, true);
    assert.ok(port.y > layout.title.bottom && Math.abs(port.x - layout.shape.right) < 2, 'Output handles sit below the identity at the right edge.');
  }
}

Given("a workflow ready to map Get project to Create task", async function () {
  await setMode(this.page, "workflow");
  await chooseCatalogOperation(this.page, "Get project", "workflow");
  await chooseCatalogOperation(this.page, "Create task", "workflow");
  await this.page.getByRole("button", { name: "Fit View", exact: true }).click();
  await mappingPorts(this);
  await expect(connections(this.page)).toHaveCount(0);
});

Then("List projects exposes its query parameters and nested project response", async function () {
  const id = await ownerId(this.page, "List projects");
  const query = namedPanel(this.page, id, "inputs", "Query parameters");
  await expect(query).toBeVisible();
  await expect(query.getByLabel("Project name input", { exact: true })).toHaveClass(/connectableend/);
  await expect(query.getByLabel("Result limit input", { exact: true })).not.toHaveClass(/connectablestart/);
  await expect(fieldRow(query, "Result limit").locator(".field-type")).toHaveText("Integer");
  const response = namedPanel(this.page, id, "outputs", "Response · 200");
  const nested = namedPanel(this.page, id, "outputs", "Project");
  await expect(response).toBeVisible();
  await expect(fieldRow(response, "Project").locator(".field-type")).toHaveText("Object");
  await expect(nested).toBeVisible();
  const projectId = fieldRow(nested, "Project ID");
  await expect(projectId.locator(".required")).toHaveText("*");
  await expect(projectId).toHaveAttribute("title", /fictional project identifier/);
  await expect(projectId.getByLabel("Project ID output", { exact: true })).toHaveClass(/connectablestart/);
  await expect(response.locator('[data-handleid="value"]')).toHaveAttribute("aria-disabled", "true");
  await expect(operationNodes(this.page, "List projects").locator(".owner-port")).toHaveCount(2);
  await expectOwnerLayout(operationNodes(this.page, "List projects"), ['Query'], ['200']);
  await expect(connections(this.page)).toHaveCount(0);
});

Then("Create task separates required path and request-body fields", async function () {
  const id = await ownerId(this.page, "Create task");
  const path = namedPanel(this.page, id, "inputs", "Path parameters");
  const body = namedPanel(this.page, id, "inputs", "Request body");
  await expect(fieldRow(path, "Project ID").locator(".required")).toHaveText("*");
  await expect(fieldRow(body, "Title").locator(".required")).toHaveText("*");
  await expect(fieldRow(body, "Priority").locator(".required")).toHaveText("*");
  await expect(fieldRow(body, "Estimated hours").locator(".required")).toHaveCount(0);
  await expect(fieldRow(body, "Estimated hours").locator(".field-type")).toHaveText("Number");
  await expect(panels(this.page, id, "outputs").getByLabel("Completed output", { exact: true })).toBeVisible();
  const ports = operationNodes(this.page, "Create task").locator(".owner-port");
  await expect(ports).toHaveCount(3);
  for (const port of await ports.all()) {
    await expect(port).toHaveAttribute("aria-disabled", "true");
    await expect(port).not.toHaveClass(/connectablestart|connectableend/);
  }
  await expectOwnerLayout(operationNodes(this.page, "Create task"), ['Path', 'Body'], ['201']);
  await this.page.screenshot({ path: 'tmp/test/workflow-operation-ports.png' });
});

Given('repeated operation nodes with documented response variants', async function () {
  const operation = { ...operations.find(operation => operation.id === 'demo:getProject'), name: 'Response variants' };
  const document = { paths: { [operation.path]: { get: {
    parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string', title: 'Project ID' } }],
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: { type: 'string' } }, 'text/plain': { schema: { type: 'string' } } } },
      400: { description: 'Invalid input', content: { 'application/json': { schema: { type: 'string' } } } },
      default: { description: 'Other documented response' },
    },
  } } } };
  const graph = createOperationGraph(operation, { x: 470, y: 250 }, 'response-variants', document);
  graph.nodes.push({ ...graph.nodes[0], id: 'response-variants-2', position: { x: 470, y: 550 } });
  const saved = { version: 2, id: 'response-variants-review', name: 'Response variants review', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false };
  await this.page.evaluate(document => localStorage.setItem('operations-flow-documents-v1', JSON.stringify([document])), saved);
  await this.page.reload();
  await setMode(this.page, 'workflow');
  await this.page.getByRole('button', { name: 'Fit View', exact: true }).click();
});

Then('the identity row separates top input and bottom response ports', async function () {
  const nodes = operationNodes(this.page, 'Response variants');
  await expect(nodes).toHaveCount(2);
  await expectOwnerLayout(nodes.first(), ['Path'], ['200 · JSON', '200 · Text', '400', 'default']);
  for (const media of ['application/json', 'text/plain']) {
    const port = nodes.first().getByLabel(`Response · 200 · ${media} output`, { exact: true });
    await expect(port).toHaveAttribute('title', `Response · 200 · ${media}`);
  }
  for (const [index, node] of (await nodes.all()).entries()) {
    await expect(node.locator('.operation-title-row strong')).toHaveText('Response variants');
    await expect(node.locator('.operation-title-row').getByLabel(`Instance ${index + 1}`, { exact: true })).toBeVisible();
    const aligned = await node.locator('.operation-title-row').evaluate(element => {
      const items = [...element.children].map(child => child.getBoundingClientRect());
      return items.every((item, index) => !index || item.left >= items[index - 1].right - 1)
        && Math.max(...items.map(item => item.top)) < Math.min(...items.map(item => item.bottom));
    });
    assert.equal(aligned, true, 'HTTP icon, name, and instance number share one identity row.');
  }
  for (const label of ['Response · 400', 'Response · default'])
    await expect(namedPanel(this.page, 'response-variants', 'outputs', label)).toBeVisible();
  await this.page.screenshot({ path: 'tmp/test/workflow-response-ports.png' });
});

When("I map the project identifier between those operations", async function () {
  const { source, target } = await mappingPorts(this);
  const end = await center(target);
  await beginDrag(this.page, source);
  await this.page.mouse.move(end.x, end.y, { steps: 16 });
  await this.page.mouse.up();
  await expect(connections(this.page)).toHaveCount(1);
});

When("I map the project identifier by clicking the field handles", async function () {
  const { source, target } = await mappingPorts(this);
  await source.click();
  await target.click();
  await expect(connections(this.page)).toHaveCount(1);
});

Then("the project identifier mapping keeps its saved field endpoints", async function () {
  await expectMapping(this);
  const stored = await storedWorkflows(this.page);
  const document = stored.find(item => item.name === "Field mapping review");
  assert.equal(document.version, 2);
  const { source, target, sourceHandle, targetHandle } = document.edges.find(edge => edge.kind === "mapping");
  assert.deepEqual({ source, target, sourceHandle, targetHandle }, this.fieldEndpoints);
});

async function hideNestedResponse(world) {
  world.branchOwnerId = await ownerId(world.page, "List projects");
  const nested = namedPanel(world.page, world.branchOwnerId, "outputs", "Project");
  world.branchHandles = await nested.locator(".data-field .svelte-flow__handle").evaluateAll(handles => handles.map(handle => handle.dataset.handleid));
  world.branchNodeId = await nested.evaluate(element => element.closest(".svelte-flow__node").dataset.id);
  await nested.locator(".data-title strong").click();
  await expect(nested).toHaveClass(/selected/);
  await expect(world.page.getByRole("button", { name: "Remove selected", exact: true })).toBeEnabled();
  await world.page.getByRole("button", { name: "Remove selected", exact: true }).click();
  await expect(nested).toHaveCount(0);
  await expect(world.page.getByRole("button", { name: "Remove selected", exact: true })).toBeDisabled();
}

async function restoreNestedResponse(world) {
  const response = namedPanel(world.page, world.branchOwnerId, "outputs", "Response · 200");
  await response.getByRole("button", { name: "Restore Project", exact: true }).click();
  const nested = namedPanel(world.page, world.branchOwnerId, "outputs", "Project");
  await expect(nested).toBeVisible();
  await expect(nested).not.toHaveClass(/selected/);
  await expect(world.page.getByRole("button", { name: "Remove selected", exact: true })).toBeDisabled();
}

When("I hide and restore the nested project response", async function () {
  await hideNestedResponse(this);
  await restoreNestedResponse(this);
});
When('I hide and restore the root query input', async function () {
  const page = this.page;
  const id = await ownerId(page, 'List projects');
  const owner = operationNodes(page, 'List projects');
  const query = namedPanel(page, id, 'inputs', 'Query parameters');
  const before = (await readExport(page)).document;
  const handle = owner.getByLabel('Query parameters input', { exact: true });
  const handleId = await handle.getAttribute('data-handleid');
  await query.locator('.data-title strong').click();
  await page.getByRole('button', { name: 'Remove selected', exact: true }).click();
  await expect(query).toHaveCount(0);
  const restore = owner.getByRole('button', { name: 'Restore Query parameters', exact: true });
  await expect(restore).toHaveAttribute('data-side', 'left');
  const position = await restore.evaluate(element => {
    const button = element.getBoundingClientRect();
    const port = element.closest('.operation-port').getBoundingClientRect();
    return { x: button.x + button.width / 2, y: button.y + button.height / 2, portX: port.x, portY: port.y + port.height / 2 };
  });
  assert.ok(Math.abs(position.x - position.portX) < 1 && Math.abs(position.y - position.portY) < 1, 'Restore is centered on the left input port.');
  await restore.click();
  await expect(query).toBeVisible();
  await expect(handle).toHaveAttribute('data-handleid', handleId);
  const after = (await readExport(page)).document;
  assert.deepEqual(after.nodes, before.nodes, 'Restoring retains the input panel and fields.');
  assert.deepEqual(after.edges, before.edges, 'Restoring retains schema connection endpoints.');
});
When("I hide the nested project response", async function () { await hideNestedResponse(this); });
When("I restore the nested project response", async function () { await restoreNestedResponse(this); });

Then("the nested response remains hidden with its saved fields", async function () {
  await expect(namedPanel(this.page, this.branchOwnerId, "outputs", "Project")).toHaveCount(0);
  const response = namedPanel(this.page, this.branchOwnerId, "outputs", "Response · 200");
  await expect(response.getByRole("button", { name: "Restore Project", exact: true })).toBeVisible();
  await expect(workflow(this.page).locator(".workflow-schema-edge")).toHaveCount(2);
  const stored = await storedWorkflows(this.page);
  const document = stored.find(item => item.name === "Hidden branch review");
  assert.ok(document, "The hidden branch must be saved as part of the workflow.");
  const branch = document.nodes.find(node => node.id === this.branchNodeId);
  assert.equal(branch?.hidden, true, "Reloading must retain the hidden branch rather than delete its fields.");
  assert.deepEqual(branch.data.fields.map(field => field.id), this.branchHandles);
  const edge = document.edges.find(edge => edge.id === `schema:${this.branchNodeId}`);
  assert.equal(edge?.hidden, true);
  assert.equal(edge?.detached, true);
});

Then("the nested response retains its field handles and operation", async function () {
  const nested = namedPanel(this.page, this.branchOwnerId, "outputs", "Project");
  assert.deepEqual(await nested.locator(".data-field .svelte-flow__handle").evaluateAll(handles => handles.map(handle => handle.dataset.handleid)), this.branchHandles);
  assert.equal(await nested.evaluate(element => element.closest(".svelte-flow__node").dataset.id), this.branchNodeId);
  await expect(operationNodes(this.page, "List projects")).toHaveCount(1);
  await expect(workflow(this.page).locator(".workflow-schema-edge")).toHaveCount(3);
});

When("I delete the List projects owner", async function () {
  const owner = operationNodes(this.page, "List projects");
  await owner.click();
  await owner.focus();
  await this.page.keyboard.press("Delete");
});

Then("its schema panels and connections are removed", async function () {
  await expect(operationNodes(this.page, "List projects")).toHaveCount(0);
  await expect(panels(this.page, this.branchOwnerId)).toHaveCount(0);
  await expect(workflow(this.page).locator(".svelte-flow__edge")).toHaveCount(0);
  await expect(workflow(this.page).getByRole("button", { name: "Add nodes by selecting workflow operations from the left menu", exact: true })).toBeVisible();
});

When("I drag the project identifier over the target panel body", async function () {
  const { source, target } = await mappingPorts(this);
  const body = target.locator("..").locator(".field-name");
  const end = await center(body);
  const port = await target.boundingBox();
  assert.ok(port && end.x > port.x + port.width + 10, "The drop must be inside the row body, away from the native handle hit area.");
  await beginDrag(this.page, source);
  await this.page.mouse.move(end.x, end.y, { steps: 16 });
});

Then("a preview points to the project identifier input", async function () {
  await expect(preview(this.page)).toBeVisible();
  await expect(preview(this.page)).toHaveAttribute("data-source", this.fieldEndpoints.source);
  await expect(preview(this.page)).toHaveAttribute("data-source-handle", this.fieldEndpoints.sourceHandle);
  await expect(preview(this.page)).toHaveAttribute("data-target", this.fieldEndpoints.target);
  await expect(preview(this.page)).toHaveAttribute("data-target-handle", this.fieldEndpoints.targetHandle);
});

When("I drop the mapping on the panel body", async function () { await this.page.mouse.up(); });
Then("one mapping connects the project identifier fields", async function () { await expectMapping(this); });

When("I cancel a project identifier drag over its valid input port", async function () {
  const { source, target } = await mappingPorts(this);
  const end = await center(target);
  await beginDrag(this.page, source);
  await this.page.mouse.move(end.x, end.y, { steps: 16 });
  await expect(target).toHaveClass(/connectingto/);
  await this.page.keyboard.press("Escape");
  await this.page.mouse.up();
});

Then("no field mapping or connection preview remains", async function () {
  await expect(connections(this.page)).toHaveCount(0);
  await expect(preview(this.page)).toHaveCount(0);
  await expect(workflow(this.page).locator(".svelte-flow__connection")).toHaveCount(0);
});

Given("a legacy workflow with an unnamed operation connection", async function () {
  const document = {
    version: 1, id: "legacy-fields-review", name: "Legacy field review",
    nodes: [100, 460].map((x, index) => ({
      id: `legacy-operation-${index}`, position: { x, y: 140 },
      data: { operationId: "demo:listProjects", name: "List projects", description: "Review the project list.", method: "GET", path: "/projects" },
    })),
    edges: [{ id: "legacy-connection", source: "legacy-operation-0", target: "legacy-operation-1" }],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: false, dashed: false,
  };
  await this.page.evaluate(document => localStorage.setItem("operations-flow-documents-v1", JSON.stringify([document])), document);
  await this.page.reload();
  await setMode(this.page, "workflow");
  await expect(operationNodes(this.page, "List projects")).toHaveCount(2);
  await expect(connections(this.page)).toHaveCount(1);
});

Then("the legacy connection and new schema panels both remain usable", async function () {
  await expect(operationNodes(this.page, "List projects")).toHaveCount(2);
  await expect(operationNodes(this.page, "Create task")).toHaveCount(1);
  await expect(connections(this.page)).toHaveCount(1);
  await expect(connections(this.page).locator(".svelte-flow__edge-path")).toHaveAttribute("d", /^M.+/);
  await expect(workflow(this.page).getByLabel("List projects input", { exact: true })).toHaveCount(2);
  await expect(workflow(this.page).getByLabel("List projects output", { exact: true })).toHaveCount(2);
  const id = await ownerId(this.page, "Create task");
  await expect(namedPanel(this.page, id, "inputs", "Request body").getByLabel("Title input", { exact: true })).toBeVisible();
  await expect(workflow(this.page).locator(".workflow-schema-edge")).toHaveCount(3);
  const document = (await readExport(this.page)).document;
  assert.equal(document.version, 2);
  assert.deepEqual(document.edges.find(edge => edge.id === "legacy-connection"), {
    id: "legacy-connection", source: "legacy-operation-0", target: "legacy-operation-1",
  });
  assert.ok(document.edges.filter(edge => edge.kind === "schema").every(edge => edge.sourceHandle && edge.targetHandle));
});

Given("an imported legacy workflow near the coordinate limit", async function () {
  const document = {
    version: 1, id: "coordinate-limit-review", name: "Coordinate limit review",
    nodes: [100, 460].map((x, index) => ({
      id: `coordinate-operation-${index}`, position: { x, y: 999980 },
      data: { operationId: "demo:listProjects", name: "List projects", description: "Keep this existing operation.", method: "GET", path: "/projects" },
    })),
    edges: [{ id: "coordinate-connection", source: "coordinate-operation-0", target: "coordinate-operation-1" }],
    viewport: { x: 0, y: -999740, zoom: 1 }, snap: false, curved: false, dashed: false,
  };
  await setMode(this.page, "workflow");
  await this.page.getByLabel("Import workflow file", { exact: true }).setInputFiles({
    name: "coordinate-limit.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
  });
  await expectWorkflowName(this.page, document.name);
  await expect(operationNodes(this.page, "List projects")).toHaveCount(2);
  await expect(connections(this.page)).toHaveCount(1);
  this.coordinateBaseline = (await readExport(this.page)).document;
});

When("I try to add Create task beyond the coordinate limit", async function () {
  await chooseCatalogOperation(this.page, "Create task", "workflow");
});

Then("the refused addition explains the limit and preserves the original graph", async function () {
  const error = workflow(this.page).getByRole("alert");
  await expect(error).toContainText("Could not add “Create task”");
  await expect(error).toContainText("Workflow coordinates must be finite numbers between -1000000 and 1000000.");
  await expect(operationNodes(this.page, "Create task")).toHaveCount(0);
  await expect(workflow(this.page).locator(".workflow-data-node")).toHaveCount(0);
  await expect(operationNodes(this.page, "List projects")).toHaveCount(2);
  await expect(connections(this.page)).toHaveCount(1);
  const { viewport: originalViewport, ...original } = this.coordinateBaseline;
  const { viewport: currentViewport, ...current } = (await readExport(this.page)).document;
  assert.equal(current.version, 1, "A refused addition must not upgrade the original document.");
  assert.deepEqual(current, original, "A refused addition must preserve the original nodes, edges, metadata and view options.");
  assert.ok(originalViewport.zoom > 0 && currentViewport.zoom > 0);
});
