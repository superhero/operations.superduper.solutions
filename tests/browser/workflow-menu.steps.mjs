// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { openCatalog } from "./workspace.steps.mjs";

Then("the workflow actions menu protects graph shortcuts and restores focus without closing navigation", async function () {
  const page = this.page;
  // A modal menu may hide the graph from accessibility navigation while its
  // selected nodes must remain in the document and unchanged.
  const nodes = page.locator(".svelte-flow__node-operation");
  await nodes.last().click();
  await expect(nodes.last()).toHaveClass(/selected/);
  await openCatalog(page);
  // Navigation moves beneath the pointer; park it away from the workspace
  // switch so an unrelated hover tooltip cannot consume the menu's Escape.
  await page.mouse.move(0, 0);

  const trigger = page.getByRole("button", { name: "Workflow actions", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const save = page.getByRole("menuitem", { name: "Save workflow", exact: true });
  await expect(save).toBeFocused();
  for (const key of ["Delete", "Backspace"]) {
    await page.keyboard.press(key);
    await expect(nodes).toHaveCount(2);
    await expect(nodes.last()).toHaveClass(/selected/);
    await expect(save).toBeFocused();
  }

  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "Import workflow", exact: true })).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(save).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Operation catalog", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation", exact: true })).toBeVisible();
  await expect(nodes).toHaveCount(2);
});
