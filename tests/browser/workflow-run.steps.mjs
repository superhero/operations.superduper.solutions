// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import demo from "../../src/catalogs/demo.openapi.json" with { type: "json" };
import { operations } from "../../src/lib/catalog.ts";
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";
import { openCatalog, setMode, workflow, workflowAction } from "./workspace.steps.mjs";

const storageKey = "operations-flow-documents-v1";
const graph = (name, id = name) => createOperationGraph(operations.find(item => item.id === `demo:${name}`), { x: 0, y: 0 }, id, demo);
const fixture = (...graphs) => ({ version: 3, id: "runner-browser", name: "Runner browser", nodes: graphs.flatMap(graph => graph.nodes),
  edges: graphs.flatMap(graph => graph.edges), viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const utility = (type, id, data) => ({ nodes: [{ type, id, data, position: { x: 400, y: 400 } }], edges: [] });
const field = (doc, owner, direction, name) => {
  const node = doc.nodes.find(node => node.type === "data" && node.data.ownerId === owner && node.data.direction === direction
    && node.data.fields.some(field => field.label === name));
  return { id: node.id, handle: node.data.fields.find(field => field.label === name).id };
};
const mapping = (doc, source, target) => doc.edges.push({ id: `mapping-${doc.edges.length}`, kind: "mapping",
  source: source.id, sourceHandle: source.handle, target: target.id, targetHandle: target.handle });
const dialog = page => page.getByRole("dialog", { name: "Run workflow: Runner browser", exact: true });
async function mockEndpoint(page) {
  const requests = [];
  await page.route("https://example.com/**", async route => {
    requests.push(route.request().url());
    await route.abort();
  });
  return requests;
}
const seed = async (page, doc) => {
  await page.evaluate(({ key, doc }) => localStorage.setItem(key, JSON.stringify([doc])), { key: storageKey, doc });
  await page.reload();
};
const openRun = async (page, doc) => {
  await seed(page, doc);
  await setMode(page, "workflow");
  await workflowAction(page, "Run");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("Mock example: https://example.com");
};
const select = async (page, name, value) => {
  await dialog(page).getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox").getByRole("option", { name: value, exact: true }).click();
};

Then("a saved workflow opens a request run with starting choices and an end control", async function () {
  const page = this.page;
  const requests = await mockEndpoint(page);
  const doc = fixture(graph("getProject"), graph("listProjects"));
  await seed(page, doc);
  await setMode(page, "operations");
  await openCatalog(page);
  const catalog = page.getByRole("navigation", { name: "Saved workflow catalog", exact: true });
  const group = catalog.locator(":scope > .catalog-group > summary");
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const saved = page.getByRole("button", { name: "Open workflow: Runner browser", exact: true });
  // Saved workflow entries use the same expandable catalog presentation as operations.
  if (!await saved.isVisible()) {
    const entry = page.locator("[data-workflow-id=runner-browser]");
    await entry.locator("summary").click();
  }
  await saved.click();
  const run = dialog(page);
  await expect(run.getByRole("heading", { name: "Choose a starting operation", exact: true })).toBeVisible();
  await run.getByRole("radio", { name: "Get project", exact: true }).check();
  await run.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(run.getByRole("heading", { name: "1. Get project", exact: true })).toBeVisible();
  await run.getByRole("textbox", { name: "Project ID", exact: true }).fill("project-2");
  await run.getByRole("button", { name: "Start workflow", exact: true }).click();
  await expect(run.getByRole("region", { name: "Step 1 response", exact: true })).toContainText("Website");
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("heading", { name: "Workflow complete.", exact: true })).toBeVisible();
  await run.getByRole("button", { name: "Close run", exact: true }).click();
  await expect(run).toBeHidden();
  assert.deepEqual(requests, []);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), [doc]);
});

Then("the workflow run dialog validates inputs and passes task results to the next operation", async function () {
  const page = this.page;
  const requests = await mockEndpoint(page);
  const doc = fixture(graph("getProject"), graph("createTask"), graph("updateTask"));
  mapping(doc, field(doc, "getProject", "outputs", "Project ID"), field(doc, "createTask", "inputs", "Project ID"));
  mapping(doc, field(doc, "createTask", "outputs", "Task ID"), field(doc, "updateTask", "inputs", "Task ID"));
  await openRun(page, doc);
  const run = dialog(page);
  const project = run.getByRole("textbox", { name: "Project ID", exact: true });
  await run.getByRole("button", { name: "Start workflow", exact: true }).click();
  await expect(run.getByRole("alert")).toContainText("Project ID: this field is required");
  await expect(project).toBeFocused();
  await project.fill("missing-project");
  await run.getByRole("button", { name: "Start workflow", exact: true }).click();
  await expect(run.getByRole("alert")).toContainText("was not found in this demo");
  await project.fill("project-1");
  await expect(run.getByRole("alert")).toHaveCount(0);
  await run.getByRole("button", { name: "Retry operation", exact: true }).click();
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("heading", { name: "2. Create task", exact: true })).toBeVisible();
  await expect(project).toHaveValue("project-1");
  await expect(project).toBeDisabled();
  await run.getByRole("textbox", { name: "Title", exact: true }).fill("Browser workflow task");
  await select(page, "Priority", "high");
  await run.getByRole("button", { name: "Run operation", exact: true }).click();
  await expect(run.getByRole("region", { name: "Step 2 response", exact: true })).toContainText("task-2");
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("textbox", { name: "Task ID", exact: true })).toHaveValue("task-2");
  await select(page, "Completed", "true");
  await run.getByRole("button", { name: "Run operation", exact: true }).click();
  await expect(run.getByRole("region", { name: "Step 3 response", exact: true })).toContainText("Browser workflow task");
  await expect(run.getByRole("region", { name: "Step 3 response", exact: true })).toContainText("true");
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("status")).toContainText("3 operations completed");
  assert.deepEqual(requests, []);
});

Then("the workflow run dialog follows a matching switch gate through a cast", async function () {
  const page = this.page;
  const requests = await mockEndpoint(page);
  const doc = fixture(graph("updateTask"), graph("listProjects", "selected"), graph("listProjects", "skipped"),
    utility("switch", "switch", { gates: [{ id: "selected", operator: "==", value: "true" }, { id: "skipped", operator: "is_set", value: "" }] }),
    utility("cast", "cast", { targetType: "Number" }));
  mapping(doc, field(doc, "updateTask", "outputs", "Completed"), { id: "switch", handle: "value" });
  mapping(doc, { id: "switch", handle: "selected" }, { id: "cast", handle: "value" });
  mapping(doc, { id: "cast", handle: "result" }, field(doc, "selected", "inputs", "Result limit"));
  mapping(doc, { id: "switch", handle: "skipped" }, field(doc, "skipped", "inputs", "Result limit"));
  await openRun(page, doc);
  const run = dialog(page);
  await run.getByRole("textbox", { name: "Task ID", exact: true }).fill("task-1");
  await select(page, "Completed", "true");
  await run.getByRole("button", { name: "Start workflow", exact: true }).click();
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("heading", { name: "2. List projects", exact: true })).toBeVisible();
  await expect(run.getByRole("spinbutton", { name: "Result limit", exact: true })).toHaveValue("1");
  await expect(run.getByRole("spinbutton", { name: "Result limit", exact: true })).toBeDisabled();
  await run.getByRole("button", { name: "Run operation", exact: true }).click();
  await run.getByRole("button", { name: "Next operation", exact: true }).click();
  await expect(run.getByRole("status")).toContainText("2 operations completed");
  assert.deepEqual(requests, []);
});

Then("ending a workflow run restores the canvas and leaves its saved graph unchanged", async function () {
  const page = this.page;
  const requests = await mockEndpoint(page);
  const doc = fixture(graph("getProject"));
  await openRun(page, doc);
  const run = dialog(page);
  await run.getByRole("textbox", { name: "Project ID", exact: true }).fill("project-1");
  await page.keyboard.press("Delete");
  await run.getByRole("button", { name: "End run", exact: true }).click();
  await expect(run).toBeHidden();
  await expect(workflow(page).locator(".svelte-flow__node-operation")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest(".workflow-workspace")))).toBe(true);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), [doc]);
  await workflowAction(page, "Run");
  await expect(dialog(page).getByRole("textbox", { name: "Project ID", exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  assert.equal(requests.length, 0);
});
