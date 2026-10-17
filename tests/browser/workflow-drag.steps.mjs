// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { repository, storedWorkflows } from "./workflow-storage.fixture.mjs";
import assert from "node:assert/strict";
import { loadGraphFixture } from "./workflow-graph.fixture.mjs";
import { Then } from "@cucumber/cucumber";
import { expect } from "@playwright/test";
import { operations } from "../../src/lib/catalog.ts";
import { catalogForOperation } from "../../src/lib/catalog-registry.ts";
import { createOperationGraph } from "../../src/lib/workflow-graph.ts";
import { chooseCatalogOperation, setMode, workflow } from "./workspace.steps.mjs";
import { setWorkflowGridSize, storedDefaults } from "./workflow-defaults.steps.mjs";

async function measuredNodes(page) {
  return workflow(page).locator('.svelte-flow__node').evaluateAll(elements => elements.map(element => {
    const position = new DOMMatrix(getComputedStyle(element).transform);
    const zoom = new DOMMatrix(getComputedStyle(element.closest('.svelte-flow__viewport')).transform).a;
    const bounds = element.getBoundingClientRect();
    return { id: element.dataset.id, x: position.e, y: position.f, width: bounds.width / zoom, height: bounds.height / zoom };
  }));
}

function expectMeasuredTree(document, rendered, ownerId) {
  const nodes = document.nodes.filter(node => node.id === ownerId || node.type === 'data' && node.data.ownerId === ownerId);
  const ids = new Set(nodes.map(node => node.id));
  const geometry = rendered.filter(node => ids.has(node.id));
  assert.equal(geometry.length, nodes.length, 'Every node in the new tree must be measured.');
  const depth = new Map([[ownerId, 0]]);
  const queue = [ownerId];
  for (const id of queue) for (const edge of document.edges.filter(edge => edge.kind === 'schema')) {
    const neighbor = edge.source === id ? edge.target : edge.target === id ? edge.source : undefined;
    if (ids.has(neighbor) && !depth.has(neighbor)) {
      depth.set(neighbor, depth.get(id) + 1);
      queue.push(neighbor);
    }
  }
  const columns = new Map();
  for (const node of nodes) {
    assert.ok(depth.has(node.id), 'Schema nodes must stay connected to their operation.');
    const column = depth.get(node.id) * (node.type === 'data' && node.data.direction === 'inputs' ? -1 : 1);
    const members = columns.get(column) ?? [];
    members.push(geometry.find(item => item.id === node.id));
    columns.set(column, members);
  }
  assert.ok(columns.size >= 4, 'The fixture must exercise several nested schema columns.');
  for (const members of columns.values()) {
    const center = members[0].x + members[0].width / 2;
    for (const node of members)
      assert.ok(Math.abs(node.x + node.width / 2 - center) < 1,
        'Nodes at the same schema depth must share a measured column center.');
  }
  const ordered = [...columns].sort(([left], [right]) => left - right);
  for (let index = 1; index < ordered.length; index++) {
    const previousRight = Math.max(...ordered[index - 1][1].map(node => node.x + node.width));
    const nextLeft = Math.min(...ordered[index][1].map(node => node.x));
    assert.ok(nextLeft - previousRight >= 24, 'Measured column widths must leave a clear horizontal gap.');
  }
  for (const [index, left] of geometry.entries()) for (const right of geometry.slice(index + 1)) {
    const gapX = Math.max(right.x - left.x - left.width, left.x - right.x - right.width);
    const gapY = Math.max(right.y - left.y - left.height, left.y - right.y - right.height);
    assert.ok(gapX >= 24 || gapY >= 24,
      `Measured nodes ${left.id} and ${right.id} must have clear space between them.`);
  }
  return geometry;
}

Then('added operation trees keep clear aligned columns and smoothly reveal the next graph to the right', async function () {
  const page = this.page;
  await setMode(page, 'workflow');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const operation = operations.find(item => item.id === 'httpbin:echoGet');
  const savedLocally = () => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
  const positions = nodes => nodes.map(({ id, x, y }) => ({ id, x, y })).sort((left, right) => left.id.localeCompare(right.id));
  await chooseCatalogOperation(page, operation.name, 'workflow');
  await savedLocally();
  const first = (await storedWorkflows(page))[0];
  const original = await measuredNodes(page);
  const firstOwner = first.nodes.find(node => node.type === 'operation').id;
  expectMeasuredTree(first, original, firstOwner);

  // Sample the actual viewport animation rather than relying on a configured duration.
  await page.evaluate(() => {
    const sample = { active: true, frames: [] };
    window.__operationInsertionMotion = sample;
    const frame = () => {
      if (!sample.active) return;
      if (document.querySelectorAll('.svelte-flow__node-operation').length === 2) {
        const matrix = new DOMMatrix(getComputedStyle(document.querySelector('.svelte-flow__viewport')).transform);
        sample.frames.push({ x: matrix.e, y: matrix.f, zoom: matrix.a });
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  try {
    await chooseCatalogOperation(page, operation.name, 'workflow');
    await expect(workflow(page).locator('.svelte-flow__node-operation')).toHaveCount(2);
    await savedLocally();
    const saved = (await storedWorkflows(page)).find(document => document.id === first.id);
    const rendered = await measuredNodes(page);
    const secondOwner = saved.nodes.find(node => node.type === 'operation' && node.id !== firstOwner).id;
    const added = expectMeasuredTree(saved, rendered, secondOwner);
    assert.deepEqual(positions(rendered.filter(node => original.some(item => item.id === node.id))), positions(original),
      'Adding another operation must preserve all existing node positions.');
    const oldRight = Math.max(...original.map(node => node.x + node.width));
    assert.ok(Math.min(...added.map(node => node.x)) - oldRight >= 80,
      'The entire new operation tree must start to the right of all existing measured content.');
    const owner = workflow(page).locator(`.svelte-flow__node[data-id=${JSON.stringify(secondOwner)}]`);
    await expect.poll(() => owner.evaluate(element => {
      const node = element.getBoundingClientRect();
      const canvas = element.closest('.svelte-flow').getBoundingClientRect();
      return node.left >= canvas.left && node.right <= canvas.right && node.top >= canvas.top && node.bottom <= canvas.bottom;
    })).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const frames = window.__operationInsertionMotion.frames;
      if (frames.length < 3) return false;
      const first = frames[0];
      const last = frames.at(-1);
      return frames.some(frame => Math.hypot(frame.x - first.x, frame.y - first.y) > 1
        && Math.hypot(frame.x - last.x, frame.y - last.y) > 1);
    })).toBe(true);
    const frames = await page.evaluate(() => window.__operationInsertionMotion.frames);
    assert.ok(frames.every(frame => Math.abs(frame.zoom - frames[0].zoom) < 0.001),
      'Revealing the new owner must pan smoothly without changing the chosen zoom.');
  } finally {
    await page.evaluate(() => { window.__operationInsertionMotion.active = false; });
  }
});

Then("dragging a workflow {string} keeps its rendered position and connections synchronized", async function (kind) {
  const page = this.page;
  const operation = operations.find(item => item.id === "demo:getProject");
  const graph = createOperationGraph(operation, { x: 470, y: 250 }, "drag-owner", catalogForOperation(operation.id).document);
  const document = { version: 2, id: "drag-regression", name: "Drag regression", ...graph,
    viewport: { x: 0, y: 0, zoom: 0.9 }, snap: false, curved: false, dashed: false };
  await setMode(page, "workflow");
  await loadGraphFixture(page, document);
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
  await expect(page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
  const saved = (await storedWorkflows(page))[0];
  const savedPosition = saved.nodes.find(node => node.id === nodeId).position;
  assert.ok(Math.hypot(savedPosition.x - released.x, savedPosition.y - released.y) < 0.001,
    "Saved coordinates must match the released position, allowing CSS numeric serialization rounding.");
  await page.reload();
  await setMode(page, "workflow");
  assert.deepEqual(await node.evaluate(node => {
    const matrix = new DOMMatrix(node.style.transform); return { x: matrix.e, y: matrix.f };
  }), { x: released.x, y: released.y });
});

Then("dragging a workflow {string} snaps its center to the {int}px grid and preserves its saved coordinates", async function (kind, gridSize) {
  const page = this.page;
  const operation = operations.find(item => item.id === "demo:getProject");
  const graph = createOperationGraph(operation, { x: 470, y: 250 }, "snap-owner", catalogForOperation(operation.id).document);
  const document = { version: 2, id: "center-snap-regression", name: "Center snap regression", ...graph,
    viewport: { x: 37, y: -19, zoom: 0.9 }, snap: true, curved: false, dashed: false };
  await setMode(page, "workflow");
  await loadGraphFixture(page, document);
  const fixture = graph.nodes.find(node => node.type === kind);
  const node = page.locator(`.svelte-flow__node[data-id=${JSON.stringify(fixture.id)}]`);
  await expect(node).toBeVisible();
  const capture = () => node.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const position = new DOMMatrix(getComputedStyle(element).transform);
    const zoom = new DOMMatrix(getComputedStyle(element.closest(".svelte-flow__viewport")).transform).a;
    const bounds = element.getBoundingClientRect();
    return { x: position.e, y: position.f, width: bounds.width / zoom, height: bounds.height / zoom, zoom };
  });
  const position = ({ x, y }) => ({ x, y });
  const expectBackgroundSpacing = async () => {
    const zoom = (await capture()).zoom;
    const pattern = workflow(page).locator('.svelte-flow__background pattern');
    for (const axis of ['width', 'height'])
      assert.ok(Math.abs(Number(await pattern.getAttribute(axis)) / zoom - 24) < 0.001,
        'The decorative background spacing must stay at 24px regardless of the configured movement grid.');
  };
  const expectSavedAndReloaded = async geometry => {
    await expect(page.locator(".site-header .document-meta").getByText("Saved locally", { exact: true })).toBeVisible();
    const saved = (await storedWorkflows(page))[0];
    assert.equal(Object.hasOwn(saved, 'gridSize'), false, 'Grid size must remain an application setting, not a workflow option.');
    const savedPosition = saved.nodes.find(item => item.id === fixture.id).position;
    assert.ok(Math.hypot(savedPosition.x - geometry.x, savedPosition.y - geometry.y) < 0.001,
      "Saved coordinates must remain the rendered top-left position.");
    await page.reload();
    await setMode(page, "workflow");
    await expect(node).toBeVisible();
    assert.deepEqual(position(await capture()), position(geometry), "Reloading must retain the released coordinates.");
    assert.equal((await storedDefaults(page)).gridSize, gridSize, 'The configured grid size must survive reload.');
    await expectBackgroundSpacing();
  };
  const assertCentered = geometry => {
    for (const [axis, size] of [["x", "width"], ["y", "height"]]) {
      const center = geometry[axis] + geometry[size] / 2;
      assert.ok(Math.abs(center - Math.round(center / gridSize) * gridSize) < 0.55,
        `${kind} ${axis} center ${center} must align to the ${gridSize}px grid, allowing integer node measurement rounding.`);
    }
  };
  const drag = async (deltas, check) => {
    const bounds = await node.boundingBox();
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + 20 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    try {
      // Cross the drag threshold before checking movement frames.
      start.x += 4;
      start.y += 4;
      await page.mouse.move(start.x, start.y);
      for (const [x, y] of deltas) {
        await page.mouse.move(start.x + x, start.y + y);
        check(await capture(), x, y);
      }
    } finally { await page.mouse.up(); }
    return capture();
  };
  const baseline = await capture();
  assert.deepEqual(position(baseline), fixture.position, "Loading a document with snapping enabled must retain its coordinates.");
  await setWorkflowGridSize(page, gridSize);
  await setMode(page, 'workflow');
  assert.deepEqual(position(await capture()), position(baseline), 'Changing the global grid size must not reposition existing nodes.');
  await expectBackgroundSpacing();
  let snapped = await drag([[83, 53], [137, 79], [-37, 31]], (geometry, x, y) => {
    assertCentered(geometry);
    for (const [axis, size, delta] of [["x", "width", x], ["y", "height", y]]) {
      const expected = Math.round((baseline[axis] + baseline[size] / 2 + delta / baseline.zoom) / gridSize) * gridSize;
      assert.ok(Math.abs(geometry[axis] + geometry[size] / 2 - expected) < 0.55,
        `${kind} ${axis} center must follow the nearest grid point to the pointer movement.`);
    }
  });
  assertCentered(snapped);
  assert.ok(Math.hypot(snapped.x - baseline.x, snapped.y - baseline.y) > 20, "The snapped node must actually move.");
  await node.focus();
  await page.keyboard.press("ArrowRight");
  const moved = await capture();
  assert.deepEqual(position(moved), { x: snapped.x + gridSize, y: snapped.y }, "Arrow keys must move a snapped node by one grid step.");
  await page.keyboard.press("Shift+ArrowDown");
  snapped = await capture();
  assert.deepEqual(position(snapped), { x: moved.x, y: moved.y + gridSize * 4 }, "Shift+arrow must retain the larger keyboard step.");
  assertCentered(snapped);
  await expectSavedAndReloaded(snapped);

  const toggle = workflow(page).getByRole("button", { name: "Snap to grid", exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  assert.deepEqual(position(await capture()), position(snapped), "Changing snapping must not reposition the node.");
  const free = await drag([[20 * snapped.zoom, 10 * snapped.zoom]], (geometry, x, y) => {
    assert.ok(Math.abs(geometry.x - snapped.x - x / snapped.zoom) < 1 &&
      Math.abs(geometry.y - snapped.y - y / snapped.zoom) < 1,
      `With snapping disabled the node must follow the pointer's free movement: ${JSON.stringify({ from: position(snapped), to: position(geometry), x, y })}.`);
  });
  await expectSavedAndReloaded(free);
});

Then("adding workflow nodes aligns their centers with snapping {string} without moving existing nodes", async function (snap) {
  const page = this.page;
  const gridSize = 18;
  await setWorkflowGridSize(page, gridSize);
  const document = { version: 3, id: 'insertion-grid', name: 'Insertion grid', description: '',
    nodes: [{ id: 'existing-cast', type: 'cast', position: { x: 241, y: 133 }, data: { targetType: 'Text' } }], edges: [],
    viewport: { x: 37, y: -19, zoom: 0.9 }, snap: snap === 'on', curved: false, dashed: false };
  await repository(page, 'save', document, null);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(workflow(page).locator('.svelte-flow__node')).toHaveCount(1);
  await expect(workflow(page).getByRole('button', { name: 'Snap to grid', exact: true })).toHaveAttribute('aria-pressed', String(document.snap));
  const capture = () => workflow(page).locator('.svelte-flow__node').evaluateAll(async elements => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return elements.map(element => {
      const position = new DOMMatrix(getComputedStyle(element).transform);
      const zoom = new DOMMatrix(getComputedStyle(element.closest('.svelte-flow__viewport')).transform).a;
      const bounds = element.getBoundingClientRect();
      return { id: element.dataset.id, x: position.e, y: position.f, width: bounds.width / zoom, height: bounds.height / zoom };
    });
  });
  const positions = nodes => nodes.map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id));
  let previous = await capture();
  assert.ok(Math.abs(previous[0].x + previous[0].width / 2 - Math.round((previous[0].x + previous[0].width / 2) / gridSize) * gridSize) > 1,
    'The existing fixture must start off the grid.');
  let historyCount = (await repository(page, 'history', document.id)).length;
  for (const add of [
    () => chooseCatalogOperation(page, operations.find(item => item.id === 'demo:getProject').name, 'workflow'),
    () => workflow(page).getByRole('button', { name: 'Cast', exact: true }).click(),
  ]) {
    await add();
    await expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
    const rendered = await capture();
    assert.deepEqual(positions(rendered.filter(node => previous.some(existing => existing.id === node.id))), positions(previous),
      'Adding nodes must preserve every existing node position.');
    const added = rendered.filter(node => !previous.some(existing => existing.id === node.id));
    assert.ok(added.length > 0, 'The addition must render new nodes.');
    for (const node of added) for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
      const center = node[axis] + node[size] / 2;
      assert.ok(Math.abs(center - Math.round(center / gridSize) * gridSize) < 0.55,
        `${node.id} ${axis} center ${center} must align to the configured grid even with snapping ${snap}.`);
    }
    const saved = (await storedWorkflows(page)).find(item => item.id === document.id);
    for (const node of rendered) {
      const savedPosition = saved.nodes.find(item => item.id === node.id)?.position;
      assert.ok(savedPosition && Math.hypot(savedPosition.x - node.x, savedPosition.y - node.y) < 0.001,
        'The insertion must save its final aligned coordinates.');
    }
    assert.equal((await repository(page, 'history', document.id)).length, ++historyCount,
      'Each complete addition must create exactly one structural autosave version.');
    previous = rendered;
  }
  for (const direction of ['inputs', 'outputs'])
    assert.ok(await workflow(page).locator(`.workflow-data-node[data-direction="${direction}"]`).count() > 0,
      `The inserted operation must include its ${direction} data nodes.`);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(workflow(page).locator('.svelte-flow__node')).toHaveCount(previous.length);
  assert.deepEqual(positions(await capture()), positions(previous), 'Reloading must preserve all inserted and existing coordinates.');
  assert.equal((await repository(page, 'history', document.id)).length, historyCount, 'Reloading must not add a placement-fix version.');
});
