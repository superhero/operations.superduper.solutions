// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from "node:assert/strict";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { operations } from "../../src/lib/catalog.ts";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";
import { setMode, workflowAction } from "./workspace.steps.mjs";

Then("dragging a workflow {string} keeps its rendered position and connections synchronized", async function (kind) {
  const page = this.page;
  const operation = operations.find(item => item.id === "demo:getProject");
  const graph = createOperationGraph(operation, { x: 470, y: 250 }, "drag-owner", catalogForOperation(operation.id).document);
  const document = { version: 2, id: "drag-regression", name: "Drag regression", ...graph,
    viewport: { x: 0, y: 0, zoom: 0.9 }, snap: false, curved: false, dashed: false };
  const key = "operations-flow-documents-v1";
  await page.evaluate(({ key, document }) => localStorage.setItem(key, JSON.stringify([document])), { key, document });
  await page.reload();
  await setMode(page, "workflow");
  const attachment = graph.edges[0];
  const nodeId = kind === "operation" ? attachment.target : attachment.source;
  const handleId = kind === "operation" ? attachment.targetHandle : attachment.sourceHandle;
  const node = page.locator(`.svelte-flow__node[data-id=${JSON.stringify(nodeId)}]`);
  await expect(node).toBeVisible();
  const handle = node.locator(`.svelte-flow__handle[data-handleid=${JSON.stringify(handleId)}]`);
  await expect(handle).toBeVisible();
  // Default browser fixtures disable motion. This regression must exercise the real drag presentation.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const capture = () => page.evaluate(async ({ nodeId, edgeId, handleId, kind }) => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const node = [...document.querySelectorAll(".svelte-flow__node")].find(node => node.dataset.id === nodeId);
    const handle = [...node.querySelectorAll(".svelte-flow__handle")].find(handle => handle.dataset.handleid === handleId);
    const path = [...document.querySelectorAll(".svelte-flow__edge")].find(edge => edge.dataset.id === edgeId).querySelector(".svelte-flow__edge-path");
    const displayed = new DOMMatrix(getComputedStyle(node).transform);
    const target = new DOMMatrix(node.style.transform);
    const bounds = handle.getBoundingClientRect();
    const point = path.getPointAtLength(kind === "operation" ? path.getTotalLength() : 0);
    const endpoint = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: target.e, y: target.f, trackingError: Math.hypot(displayed.e - target.e, displayed.f - target.f),
      attachmentX: endpoint.x - (bounds.left + bounds.width / 2), attachmentY: endpoint.y - (bounds.top + bounds.height / 2) };
  }, { nodeId, edgeId: attachment.id, handleId, kind });
  const baseline = await capture();
  const bounds = await node.boundingBox();
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 20 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  let last;
  try {
    for (const [x, y] of [[110, 65], [170, 90], [55, 30], [-35, 55]]) {
      await page.mouse.move(start.x + x, start.y + y);
      last = await capture();
      assert.ok(last.trackingError < 1, `${kind} trails its drag position by ${last.trackingError.toFixed(1)}px`);
      assert.ok(Math.hypot(last.attachmentX - baseline.attachmentX, last.attachmentY - baseline.attachmentY) < 1,
        "The connection endpoint must move together with its node handle.");
    }
  } finally { await page.mouse.up(); }
  assert.ok(Math.hypot(last.x - baseline.x, last.y - baseline.y) > 20, "The node must actually move.");
  const released = await capture();
  assert.ok(released.trackingError < 1, "Releasing the node must not leave a settling animation.");
  await workflowAction(page, "Save");
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], key);
  const savedPosition = saved.nodes.find(node => node.id === nodeId).position;
  assert.ok(Math.hypot(savedPosition.x - released.x, savedPosition.y - released.y) < 0.001,
    "Saved coordinates must match the released position, allowing CSS numeric serialization rounding.");
  await page.reload();
  await setMode(page, "workflow");
  assert.deepEqual(await node.evaluate(node => {
    const matrix = new DOMMatrix(node.style.transform); return { x: matrix.e, y: matrix.f };
  }), { x: released.x, y: released.y });
});
