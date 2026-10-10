// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { openWorkflowDetails, closeWorkflowDetails, expectWorkflowName, renameWorkflow, workflowNameInput } from './workflow-details.fixture.mjs';
import assert from "node:assert/strict";
import { When, Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { workflow, setMode, openCatalog } from "./workspace.steps.mjs";
import { repository, storedWorkflows, blockWorkflowSaving, restoreWorkflowSaving } from "./workflow-storage.fixture.mjs";

const nameInput = workflowNameInput;
const saved = page => expect(page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
const debounceFinished = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 650)));

// Dispatch the name edit and the next action in one browser task, with Svelte's
// input flush between them. No driver round trip may consume the debounce.
async function editImmediatelyBefore(page, button, name) {
  await closeWorkflowDetails(page);
  const element = await button.elementHandle();
  await openWorkflowDetails(page);
  await nameInput(page).evaluate(async (input, { element, name }) => {
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    input.closest('[role="dialog"]').querySelector('button[aria-label="Close"]').click();
    await Promise.resolve();
    element.click();
  }, { element, name });
  await element.dispose();
}

Then("the untouched workflow stays out of browser storage and has no Save action", async function () {
  await debounceFinished(this.page);
  assert.deepEqual(await storedWorkflows(this.page), []);
  await expect(this.page.locator(".site-header .document-meta").getByText("Not saved", { exact: true })).toBeVisible();
  await expect(this.page.getByRole("button", { name: "Save workflow", exact: true })).toHaveCount(0);
  await expect(this.page.getByRole("textbox", { name: "Workflow name", exact: true })).toHaveCount(0);
  await expect(this.page.getByRole("button", { name: "Export workflow", exact: true })).toBeVisible();
});

When("I rename the workflow and check reload protection before saving finishes", async function () {
  this.beforeAutosaveReload = (await storedWorkflows(this.page))[0];
  await openWorkflowDetails(this.page);
  const protectedPendingEdit = await nameInput(this.page).evaluate(async input => {
    input.value = "Saved just before reload";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(protectedPendingEdit, true, "Pending asynchronous writes must guard navigation.");
  await closeWorkflowDetails(this.page);
  await saved(this.page);
  await this.page.reload();
  await setMode(this.page, "workflow");
});

Then("the last edit and connected graph are restored from browser storage", async function () {
  await expectWorkflowName(this.page, "Saved just before reload");
  await saved(this.page);
  const documents = await storedWorkflows(this.page);
  assert.equal(documents.length, 1);
  assert.deepEqual(documents[0], { ...this.beforeAutosaveReload, name: "Saved just before reload" });
  await expect(workflow(this.page).locator(".svelte-flow__node-operation")).toHaveCount(2);
  await expect(workflow(this.page).locator(".svelte-flow__edge")).toHaveCount(1);
});

Then("starting a new workflow immediately preserves the preceding draft", async function () {
  const page = this.page;
  await editImmediatelyBefore(page, page.getByRole("button", { name: "New workflow", exact: true }), "First autosaved draft");
  await expect(nameInput(page)).toHaveValue("Untitled workflow");
  await expect(nameInput(page)).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
  const first = await storedWorkflows(page);
  assert.equal(first.length, 1);
  assert.equal(first[0].name, "First autosaved draft");
  await editImmediatelyBefore(page, page.getByRole("button", { name: "New workflow", exact: true }), "Second autosaved draft");
  await expect(nameInput(page)).toHaveValue("Untitled workflow");
  await expect(nameInput(page)).toBeFocused();
  await debounceFinished(page);
  const documents = await storedWorkflows(page);
  assert.deepEqual(documents.map(document => document.name), ["First autosaved draft", "Second autosaved draft"]);
  assert.notEqual(documents[0].id, documents[1].id);
});

Then("switching to Settings immediately preserves the latest workflow name", async function () {
  const page = this.page;
  await openCatalog(page);
  const settings = page.getByRole("group", { name: "Workspace", exact: true }).getByRole("button", { name: "Settings", exact: true });
  await editImmediatelyBefore(page, settings, "Saved on workspace leave");
  await expect(page.getByRole("region", { name: "Settings workspace", exact: true })).toBeVisible();
  assert.equal((await storedWorkflows(page))[0].name, "Saved on workspace leave");
  await page.reload();
  await setMode(page, "workflow");
  await expectWorkflowName(page, "Saved on workspace leave");
});

Then("a failed autosave protects the draft until browser storage recovers", async function () {
  const page = this.page;
  await blockWorkflowSaving(page);
  await renameWorkflow(page, "Recover this workflow");
  await workflow(page).getByRole("button", { name: "Cast", exact: true }).click();
  await expect(workflow(page).getByRole("alert")).toContainText("Browser storage unavailable for autosave review");
  await expect(workflow(page).getByRole("button", { name: "Retry saving", exact: true })).toBeVisible();
  assert.deepEqual(await storedWorkflows(page), []);
  assert.equal(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }), true, "An unsuccessful save must keep the unload protection active.");
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectWorkflowName(page, "Recover this workflow");
  await expect(workflow(page).locator(".svelte-flow__node-cast")).toHaveCount(1);
  await restoreWorkflowSaving(page);
  await workflow(page).getByRole("button", { name: "Retry saving", exact: true }).click();
  await saved(page);
  await expect(workflow(page).getByRole("alert")).toHaveCount(0);
  await page.reload();
  await setMode(page, "workflow");
  await expectWorkflowName(page, "Recover this workflow");
  await expect(workflow(page).locator(".svelte-flow__node-cast")).toHaveCount(1);
  await page.screenshot({ path: 'tmp/test/workflow-header-status.png' });
});

Then("the removed active workflow stays deleted until the next edit", async function () {
  const page = this.page;
  await page.getByRole("button", { name: "Open workflow", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Saved workflows", exact: true });
  await dialog.getByRole("button", { name: "Remove Connection QA flow", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toContainText("No saved workflows yet.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await debounceFinished(page);
  assert.deepEqual(await storedWorkflows(page), []);
  await expect(workflow(page).locator(".svelte-flow__node-operation")).toHaveCount(2);
  await expect(page.locator(".site-header .document-meta").getByText("Not saved", { exact: true })).toBeVisible();
  await renameWorkflow(page, "Edited after removal");
  await saved(page);
  const documents = await storedWorkflows(page);
  assert.equal(documents.length, 1);
  assert.equal(documents[0].name, "Edited after removal");
  assert.equal(documents[0].nodes.length, 2);
});

Then("changes from another browser tab are protected from stale autosave", async function () {
  const page = this.page;
  const other = await page.context().newPage();
  try {
    await other.goto(page.url());
    for (const action of ["change", "remove"]) {
      const current = (await storedWorkflows(page))[0];
      const external = action === "change" ? [{ ...current, name: "Changed in the other tab" }] : [];
      const state = await repository(other, "load", current.id);
      if (action === "change") await repository(other, "save", external[0], state.revision);
      else await repository(other, "remove", [current.id]);
      await renameWorkflow(page, `Stale local ${action}`);
      await expect(workflow(page).getByRole("alert")).toContainText("This workflow changed in another tab.");
      assert.deepEqual(await storedWorkflows(page), external);
      await expectWorkflowName(page, `Stale local ${action}`);
      if (action === "change") {
        // A page reload deliberately drops the stale draft for this test's next
        // case; restore its name first so the unload save is already current.
        await renameWorkflow(page, current.name);
        await page.reload();
        await setMode(page, "workflow");
        await expectWorkflowName(page, "Changed in the other tab");
      }
    }
  } finally { await other.close(); }
});

Then("reopening that workflow during an edit allows its next edit to autosave", async function () {
  const page = this.page;
  const initial = (await storedWorkflows(page))[0];
  assert.equal(initial.version, 3);
  assert.ok(initial.edges.some(edge => edge.kind === "mapping" && edge.sourceHandle && edge.targetHandle));
  await editImmediatelyBefore(page, page.getByRole("button", { name: "Open workflow", exact: true }), "Edited before reopening");
  await page.getByRole("dialog", { name: "Saved workflows", exact: true }).locator(".document-entry").click();
  await expect(page.getByRole("dialog", { name: "Saved workflows", exact: true })).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
  await expectWorkflowName(page, "Edited before reopening");
  await renameWorkflow(page, "Edited again after reopening");
  await saved(page);
  await expect(workflow(page).getByRole("alert")).toHaveCount(0);
  const documents = await storedWorkflows(page);
  assert.equal(documents.length, 1);
  assert.deepEqual(documents[0], { ...initial, name: "Edited again after reopening" });
});
