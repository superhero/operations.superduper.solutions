// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { workflow, workflowAction, operationNodes } from "./workspace.steps.mjs";

const minimap = page => page.getByRole("group", { name: "Workflow minimap", exact: true });
const camera = page => workflow(page).locator(".svelte-flow__viewport").evaluate(element => {
  const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return { x: transform.e, y: transform.f, zoom: transform.a };
});
const positions = page => workflow(page).locator(".svelte-flow__node").evaluateAll(nodes => nodes.map(node => ({
  id: node.dataset.id, transform: node.style.transform,
})));

async function allNodesVisible(page) {
  const bounds = await workflow(page).boundingBox();
  assert.ok(bounds, "The graph must have visible bounds.");
  return workflow(page).locator(".svelte-flow__node").evaluateAll((nodes, area) => nodes.every(node => {
    const box = node.getBoundingClientRect();
    return box.left >= area.x && box.top >= area.y &&
      box.right <= area.x + area.width && box.bottom <= area.y + area.height;
  }), bounds);
}

Then("the minimap pans zooms and fits with {string} motion without editing operations", async function (motion) {
  const page = this.page;
  await page.emulateMedia({ reducedMotion: motion });
  await operationNodes(page, "List projects").first().click();
  const beforeNodes = await positions(page);
  await minimap(page).focus();
  await expect(minimap(page)).toBeFocused();
  await expect(minimap(page)).toHaveAccessibleDescription(/Arrow keys pan.*Plus and minus zoom.*Home fits/);
  const beforePan = await camera(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await camera(page)).x).toBeCloseTo(beforePan.x - 40, 3);
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await camera(page)).y).toBeCloseTo(beforePan.y - 40, 3);
  await page.keyboard.press("Equal");
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(beforePan.zoom);
  await page.keyboard.press("Minus");
  await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(beforePan.zoom, 3);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Backspace");
  await expect(operationNodes(page, "List projects")).toHaveCount(2);
  assert.deepEqual(await positions(page), beforeNodes, "Minimap keys must move the camera without editing node positions.");
  const beforeFit = await camera(page);
  await page.keyboard.press("Home");
  await expect.poll(() => allNodesVisible(page)).toBe(true);
  await expect.poll(() => camera(page)).not.toEqual(beforeFit);
  await expect(minimap(page)).toBeFocused();
});

async function pointerNavigate(page) {
  const overview = minimap(page).locator("svg");
  const box = await overview.boundingBox();
  assert.ok(box, "The minimap must expose a pointer target.");
  const beforePan = await camera(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 8, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => camera(page)).not.toEqual(beforePan);
  const beforeZoom = await camera(page);
  await page.mouse.wheel(0, -160);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(beforeZoom.zoom);
}

async function feedbackClearOfMinimap(page, feedback) {
  await expect(feedback).toBeVisible();
  await expect(minimap(page)).toBeVisible();
  const [message, map] = await Promise.all([feedback.boundingBox(), minimap(page).boundingBox()]);
  assert.ok(message && map, "Save feedback and the minimap must remain visible on narrow screens.");
  assert.ok(message.x + message.width <= map.x || map.x + map.width <= message.x ||
    message.y + message.height <= map.y || map.y + map.height <= message.y,
  "Save feedback must not cover the minimap.");
}

Then("the minimap supports pointer navigation and fits narrow and short viewports", async function () {
  const page = this.page;
  const beforeNodes = await positions(page);
  await pointerNavigate(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const [map, canvas, toolbar, meta] = await Promise.all([
        minimap(page).boundingBox(), workflow(page).boundingBox(), page.locator(".workflow-toolbar").boundingBox(),
        page.locator(".document-meta").boundingBox(),
      ]);
      return Boolean(map && canvas && toolbar && meta &&
        map.x >= canvas.x && map.x + map.width <= canvas.x + canvas.width &&
        map.y >= toolbar.y + toolbar.height && map.y >= meta.y + meta.height &&
        map.y + map.height <= canvas.y + canvas.height && map.width <= (viewport.width < 480 ? 122 : 182));
    }).toBe(true);
    await minimap(page).focus();
    await page.keyboard.press("Home");
    await pointerNavigate(page);
    assert.deepEqual(await positions(page), beforeNodes, "Resizing and pointer navigation must preserve the graph's geometry.");
    if (viewport.width < 480) {
      await workflowAction(page, "Save");
      const notice = workflow(page).getByText("Saved in this browser.", { exact: true });
      await feedbackClearOfMinimap(page, notice);
      const longName = "x".repeat(100);
      await page.getByRole("textbox", { name: "Workflow name", exact: true }).fill(longName);
      await page.evaluate(() => {
        window.minimapOriginalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = () => { throw new Error("Test storage unavailable"); };
      });
      try {
        await workflowAction(page, "Save");
        const error = workflow(page).getByRole("alert");
        await expect(error).toContainText(longName);
        await expect(error).toContainText("Test storage unavailable");
        await feedbackClearOfMinimap(page, error);
        assert.ok(await page.locator(".workflow-message").evaluate(element => element.scrollWidth <= element.clientWidth),
          "An unbroken workflow name must wrap inside the narrow error message.");
      } finally {
        await page.evaluate(() => {
          Storage.prototype.setItem = window.minimapOriginalSetItem;
          delete window.minimapOriginalSetItem;
        });
      }
    }
  }
});
