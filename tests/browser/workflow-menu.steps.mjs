// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { openCatalog } from "./workspace.steps.mjs";

Then("direct workflow actions protect graph shortcuts and restore focus without closing navigation", async function () {
  const page = this.page;
  // A history dialog may hide the graph from accessibility navigation while its
  // selected nodes must remain in the document and unchanged.
  const nodes = page.locator(".svelte-flow__node-operation");
  await nodes.last().click();
  await expect(nodes.last()).toHaveClass(/selected/);
  await openCatalog(page);
  // Navigation moves beneath the pointer; park it away from the workspace
  // switch so an unrelated hover tooltip cannot consume the dialog's Escape.
  await page.mouse.move(0, 0);

  const trigger = page.getByRole("button", { name: "Workflow history", exact: true });
  for (const name of ["Workflow history", "Import workflow", "Export workflow", "Run workflow"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save workflow", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Workflow actions", exact: true })).toHaveCount(0);
  await trigger.focus();
  await trigger.press("Enter");
  const history = page.getByRole("dialog", { name: "Workflow history", exact: true });
  await expect(history).toBeVisible();
  const close = history.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeFocused();
  for (const key of ["Delete", "Backspace"]) {
    await page.keyboard.press(key);
    await expect(nodes).toHaveCount(2);
    await expect(nodes.last()).toHaveClass(/selected/);
    await expect(close).toBeFocused();
  }

  await page.keyboard.press("Escape");
  if (await history.isVisible()) {
    // Keyboard help may consume the first Escape before the dialog receives it.
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await expect(history).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Operation catalog", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close navigation", exact: true })).toBeVisible();
  await expect(nodes).toHaveCount(2);
});
