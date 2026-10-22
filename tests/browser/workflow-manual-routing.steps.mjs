// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { toggleConnectionStyle } from './connection-style.fixture.mjs';
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const edgeId = 'manual-edge';
const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id="manual-${id}"]`);
const edge = page => workflow(page).locator(`.svelte-flow__edge[data-id="${edgeId}"]`);
const path = page => edge(page).locator('.svelte-flow__edge-interaction');
const controls = page => edge(page).locator('.flow-routing-segment-handle');
const control = (page, index) => edge(page).locator(`.flow-routing-segment-handle[data-segment-index="${index}"]`);
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const cast = (id, x, y) => ({ id: `manual-${id}`, type: 'cast', position: { x, y }, data: { targetType: 'Text' } });
const routeOf = document => document.edges.find(item => item.id === edgeId)?.manualRoute;
const history = (page, document) => repository(page, 'history', document.id);

async function frame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function center(locator) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds, 'The segment control must have screen bounds.');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

async function geometry(page) {
  return path(page).evaluate(element => {
    const matrix = element.getScreenCTM();
    const start = element.getPointAtLength(0), end = element.getPointAtLength(element.getTotalLength());
    return { d: element.getAttribute('d'), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
      matrix: { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f },
      zoom: Math.hypot(matrix.a, matrix.b) };
  });
}

async function importDocument(page, document) {
  const previousIds = new Set((await storedWorkflows(page)).map(item => item.id));
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'manual-routing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect.poll(async () => (await storedWorkflows(page)).some(item =>
    item.name === document.name && !previousIds.has(item.id)),
  { message: 'The imported document must finish its first save before reading the new canvas.' }).toBe(true);
  await expect(path(page)).toHaveAttribute('d', /^M.+/);
  await saved(page);
  return (await readExport(page)).document;
}

async function importManual(world, { zoom = 1, shape = 'authored', blocker = false } = {}) {
  const page = world.page;
  // Keep the whole fixture visible even at the maximum supported zoom.
  await page.setViewportSize({ width: 2600, height: 1800 });
  await setMode(page, 'workflow');
  let document = {
    version: 3, id: 'manual-routing-regression', name: 'Manual routing regression', description: '',
    nodes: [cast('source', 80, 400), cast('target', 1000, 600), ...(blocker ? [cast('blocker', 540, 100)] : [])],
    edges: [{ id: edgeId, kind: 'mapping', source: 'manual-source', sourceHandle: 'result',
      target: 'manual-target', targetHandle: 'value' }],
    viewport: { x: 40, y: 40, zoom }, snap: false, curved: false, dashed: false,
  };
  document = await importDocument(page, document);
  await expect.poll(async () => (await geometry(page)).zoom).toBeCloseTo(zoom, 5);
  let measured = await geometry(page);
  if (shape === 'straight' || shape === 'automatic') {
    document.nodes.find(item => item.id === 'manual-target').position.y += measured.start.y - measured.end.y;
    document = await importDocument(page, document);
    measured = await geometry(page);
    assert.ok(Math.abs(measured.start.y - measured.end.y) < 0.01, 'The single-segment fixture must have aligned ports.');
  } else if (shape === 'authored') {
    const { start, end } = measured;
    document.edges[0].manualRoute = [start, { x: start.x + 140, y: start.y },
      { x: start.x + 140, y: start.y - 180 }, { x: end.x - 160, y: start.y - 180 },
      { x: end.x - 160, y: end.y }, end];
    document = await importDocument(page, document);
  }
  world.manualBaseline = document;
  world.manualZoom = zoom;
  await reveal(page);
  await expect(controls(page).first()).toBeVisible();
  await expect(controls(page)).toHaveCount(shape === 'authored' ? 5 : 1);
  await page.mouse.move(5, 5);
}

async function reveal(page) {
  // Hover a point on the actual SVG path; its bounding-box center may be empty.
  const point = await path(page).evaluate(element => {
    const point = element.getPointAtLength(element.getTotalLength() / 2);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.move(point.x, point.y);
  await expect(controls(page).first()).toBeVisible();
  return point;
}

async function hoverReset(page) {
  const from = await reveal(page);
  const reset = edge(page).getByRole('button', { name: 'Reset connection route', exact: true });
  const destination = await center(reset);
  for (let step = 1; step <= 24; step++) {
    await page.mouse.move(from.x + (destination.x - from.x) * step / 24,
      from.y + (destination.y - from.y) * step / 24);
    await expect(reset).toBeVisible();
  }
  await expect(reset).toBeEnabled();
  await expect(reset).not.toBeFocused();
  await expect(edge(page)).not.toHaveClass(/\bselected\b/);
}

async function beginDrag(page, index) {
  await reveal(page);
  const target = control(page, index);
  const start = await center(target);
  const axis = await target.getAttribute('data-axis');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  return { start, axis, target };
}

async function drag(page, index, delta, cross = 0) {
  const { start, axis } = await beginDrag(page, index);
  const zoom = (await geometry(page)).zoom;
  await page.mouse.move(start.x + (axis === 'x' ? delta : cross) * zoom,
    start.y + (axis === 'y' ? delta : cross) * zoom, { steps: 6 });
  await frame(page);
  const during = await geometry(page);
  await page.mouse.up();
  await saved(page);
  return during;
}

async function assertAttached(page) {
  const errors = await path(page).evaluate(element => {
    const matrix = element.getScreenCTM();
    const source = document.querySelector('.svelte-flow__node[data-id="manual-source"] .svelte-flow__handle[data-handleid="result"]').getBoundingClientRect();
    const target = document.querySelector('.svelte-flow__node[data-id="manual-target"] .svelte-flow__handle[data-handleid="value"]').getBoundingClientRect();
    const first = element.getPointAtLength(0), last = element.getPointAtLength(element.getTotalLength());
    const start = new DOMPoint(first.x, first.y).matrixTransform(matrix), end = new DOMPoint(last.x, last.y).matrixTransform(matrix);
    return [Math.hypot(start.x - source.right, start.y - source.top - source.height / 2),
      Math.hypot(end.x - target.left, end.y - target.top - target.height / 2)];
  });
  assert.ok(errors.every(error => error < 1), `Both ports must remain attached: ${JSON.stringify(errors)}.`);
}

async function minimumBlockerClearance(page) {
  return path(page).evaluate(element => {
    const matrix = element.getScreenCTM(), zoom = Math.hypot(matrix.a, matrix.b);
    const bounds = document.querySelector('.svelte-flow__node[data-id="manual-blocker"]').getBoundingClientRect();
    let minimum = Infinity;
    for (let distance = 0; distance <= element.getTotalLength(); distance += 0.5) {
      const point = element.getPointAtLength(distance), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      minimum = Math.min(minimum, Math.hypot(Math.max(bounds.left - screen.x, 0, screen.x - bounds.right),
        Math.max(bounds.top - screen.y, 0, screen.y - bounds.bottom)) / zoom);
    }
    return minimum;
  });
}

Given('an imported manual routing workflow at zoom {float}', async function (zoom) { await importManual(this, { zoom }); });
Given('an imported {word} connection for manual routing', async function (shape) { await importManual(this, { shape }); });
Given('an imported manual routing workflow with a nearby blocker', async function () { await importManual(this, { blocker: true }); });

Then('its segment controls follow hover and selection and describe their allowed motion', async function () {
  const page = this.page;
  await expect(controls(page)).toHaveCount(0);
  await reveal(page);
  const points = routeOf(this.manualBaseline);
  await expect(controls(page)).toHaveCount(points.length - 1);
  const { matrix } = await geometry(page);
  for (let index = 0; index < points.length - 1; index++) {
    const target = control(page, index), first = points[index], last = points[index + 1];
    const axis = first.x === last.x ? 'x' : 'y';
    await expect(target).toHaveAttribute('data-axis', axis);
    await expect(target).toHaveAccessibleName(axis === 'x' ? 'Move segment left or right' : 'Move segment up or down');
    await expect(target).toHaveClass(/\bnokey\b/);
    await expect(target).toHaveClass(/\bnodrag\b/);
    await expect(target).toHaveClass(/\bnopan\b/);
    const midpoint = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
    const actual = await center(target);
    assert.ok(Math.hypot(actual.x - midpoint.x * matrix.a - matrix.e,
      actual.y - midpoint.y * matrix.d - matrix.f) < 0.6, 'Every control must sit at its logical segment midpoint.');
  }
  await hoverReset(page);
  // Select through the native edge keyboard interaction, then move off the edge.
  await edge(page).focus();
  await page.keyboard.press('Enter');
  await page.mouse.move(5, 5);
  await expect(edge(page)).toHaveClass(/\bselected\b/);
  await expect(controls(page)).toHaveCount(points.length - 1);
});

Then('both segment axes follow diagram coordinates without panning or selecting nodes', async function () {
  const page = this.page;
  await hoverReset(page);
  const original = await geometry(page);
  const selection = await workflow(page).locator('.svelte-flow__node.selected, .svelte-flow__edge.selected').count();
  for (const [index, axis, delta] of [[1, 'x', 32], [2, 'y', -36]]) {
    await reveal(page);
    const target = control(page, index);
    const bounds = await target.boundingBox();
    assert.ok(Math.abs(bounds.width - 24) < 0.6 && Math.abs(bounds.height - 24) < 0.6,
      `The drag target must remain 24 screen pixels at zoom ${this.manualZoom}: ${JSON.stringify(bounds)}.`);
    const dot = await target.locator('.segment-dot').boundingBox();
    assert.ok(Math.abs(dot.width - 10) < 0.6 && Math.abs(dot.height - 10) < 0.6,
      `The visible segment dot must remain 10 screen pixels at zoom ${this.manualZoom}.`);
    await expect(target).toHaveCSS('cursor', axis === 'x' ? 'ew-resize' : 'ns-resize');
    const before = routeOf((await readExport(page)).document);
    const rendered = await drag(page, index, delta, 55);
    const after = routeOf((await readExport(page)).document);
    const other = axis === 'x' ? 'y' : 'x';
    assert.equal(after.length, before.length, 'An interior edit must preserve this route topology.');
    for (let point = 0; point < before.length; point++) {
      assert.ok(Math.abs(after[point][other] - before[point][other]) < 0.01, 'Cross-axis pointer motion must be ignored.');
      const expected = before[point][axis] + ([index, index + 1].includes(point) ? delta : 0);
      assert.ok(Math.abs(after[point][axis] - expected) < 0.6,
        `The ${axis} drag must preserve subpixel diagram coordinates at zoom ${this.manualZoom}.`);
    }
    assert.deepEqual(rendered.matrix, original.matrix, 'Dragging a segment must not pan or zoom the canvas.');
    assert.equal(await workflow(page).locator('.svelte-flow__node.selected, .svelte-flow__edge.selected').count(), selection,
      'Segment pointer events must not leak into graph selection.');
    await assertAttached(page);
  }
});

Then('dragging its {word} segment inserts attached endpoint bends', async function (segment) {
  const page = this.page;
  await reveal(page);
  const count = await controls(page).count();
  if (segment === 'only') assert.equal(count, 1, 'The straight fixture must expose its one segment.');
  const index = segment === 'last' ? count - 1 : 0;
  const before = await geometry(page);
  const during = await drag(page, index, segment === 'last' ? 48 : -48);
  assert.notEqual(during.d, before.d, 'An endpoint segment must actually move.');
  await assertAttached(page);
  const authored = routeOf((await readExport(page)).document);
  assert.ok(authored.length > (routeOf(this.manualBaseline)?.length ?? 2), 'The endpoint edit must insert port stubs and bends.');
  assert.deepEqual(authored[0], before.start);
  assert.deepEqual(authored.at(-1), before.end);
});

Then('a single pointer jump stops its segment at node clearance', async function () {
  const page = this.page;
  const { start } = await beginDrag(page, 2);
  const blocker = await node(page, 'blocker').boundingBox();
  await page.mouse.move(start.x, blocker.y - 40);
  await frame(page);
  const during = await geometry(page);
  await page.mouse.up();
  await saved(page);
  const authored = routeOf((await readExport(page)).document);
  const screenY = authored[2].y * during.matrix.d + during.matrix.f;
  assert.ok(screenY < start.y - 10, 'The segment must move toward the blocker before reaching clearance.');
  assert.ok(Math.abs(screenY - blocker.y - blocker.height - 16 * during.zoom) < 1,
    'A fast pointer jump must clamp to the first clearance boundary, even if its destination is beyond the blocker.');
  const clearance = await minimumBlockerClearance(page);
  assert.ok(clearance >= 15.5, 'The whole painted route, including its connecting legs, must clear the node.');
  await assertAttached(page);
});

Then('unchanged Escape pointer cancellation and window blur preserve its route and history', async function () {
  const page = this.page;
  const baseline = (await readExport(page)).document, versions = await history(page, baseline), original = await geometry(page);
  for (const cancellation of ['unchanged', 'Escape', 'pointercancel', 'blur']) {
    const { start, target } = await beginDrag(page, 2);
    if (cancellation !== 'unchanged') {
      await page.mouse.move(start.x, start.y - 40, { steps: 5 });
      await expect.poll(async () => (await geometry(page)).d).not.toBe(original.d);
      if (cancellation === 'Escape') await page.keyboard.press('Escape');
      else if (cancellation === 'pointercancel') await target.evaluate(element => {
        element.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
      });
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    }
    await page.mouse.up();
    await expect(path(page)).toHaveAttribute('d', original.d);
    await saved(page);
    assert.deepEqual((await readExport(page)).document, baseline, `${cancellation} must preserve the saved document.`);
    assert.deepEqual(await history(page, baseline), versions, `${cancellation} must not add an autosave revision.`);
  }
});

Then('focused segment keys move on their axis and save once on release or cancel with Escape', async function () {
  const page = this.page;
  let before = this.manualBaseline, versions = await history(page, before);
  const originalMatrix = (await geometry(page)).matrix;
  for (const { index, key, shift, delta, axis } of [
    { index: 2, key: 'ArrowUp', shift: false, delta: -3, axis: 'y' },
    { index: 1, key: 'ArrowRight', shift: true, delta: 30, axis: 'x' },
  ]) {
    await reveal(page);
    const target = control(page, index), start = await center(target);
    await target.focus();
    await expect(target).toBeFocused();
    if (shift) await page.keyboard.down('Shift');
    for (let repeat = 1; repeat <= 3; repeat++) {
      await page.keyboard.down(key);
      await frame(page);
      const actual = await center(target), other = axis === 'x' ? 'y' : 'x';
      assert.ok(Math.abs(actual[axis] - start[axis] - delta * repeat / 3) < 0.5,
        'Each repeated keydown must advance the segment by one unit, or ten with Shift.');
      assert.ok(Math.abs(actual[other] - start[other]) < 0.5, 'Keyboard editing must preserve the other axis.');
      const persisted = (await storedWorkflows(page)).find(item => item.id === before.id);
      assert.deepEqual(routeOf(persisted), routeOf(before), 'Held keys must only change the transient draft.');
      assert.deepEqual(await history(page, before), versions, 'Repeated keydown must not add durable revisions.');
      await assertAttached(page);
    }
    await page.keyboard.up(key);
    if (shift) await page.keyboard.up('Shift');
    await saved(page);
    const after = (await readExport(page)).document;
    const expected = routeOf(before).map((point, position) => ({ ...point,
      [axis]: point[axis] + ([index, index + 1].includes(position) ? delta : 0) }));
    assert.deepEqual(routeOf(after), expected, 'Releasing the key must save the accumulated axis movement.');
    const updated = await history(page, after);
    assert.equal(updated.length, versions.length + 1, 'Each key release must produce exactly one history revision.');
    assert.deepEqual((await geometry(page)).matrix, originalMatrix, 'Segment arrow keys must not pan the canvas.');
    before = after;
    versions = updated;
  }
  const original = await geometry(page);
  for (const cancellation of ['Escape', 'Tab']) {
    await reveal(page);
    const target = control(page, 2);
    await target.focus();
    await page.keyboard.down('ArrowDown');
    await page.keyboard.down('ArrowDown');
    await expect(path(page)).not.toHaveAttribute('d', original.d);
    await page.keyboard.press(cancellation);
    if (cancellation === 'Tab') await expect(target).not.toBeFocused();
    await page.keyboard.up('ArrowDown');
    await expect(path(page)).toHaveAttribute('d', original.d);
    assert.deepEqual((await readExport(page)).document, before, `${cancellation} must discard a keyboard draft.`);
    assert.deepEqual(await history(page, before), versions, `The keyup after ${cancellation} must not commit the cancelled draft.`);
  }
  // A selected edge retains its controls when focus leaves, so this exercises
  // focus cancellation independently of the controls being unmounted.
  await edge(page).focus();
  await page.keyboard.press('Enter');
  await expect(edge(page)).toHaveClass(/\bselected\b/);
  await reveal(page);
  await control(page, 2).focus();
  await page.keyboard.down('ArrowDown');
  await expect(path(page)).not.toHaveAttribute('d', original.d);
  const snap = workflow(page).getByRole('button', { name: 'Snap to grid', exact: true });
  await snap.click();
  await page.keyboard.up('ArrowDown');
  await expect(path(page)).toHaveAttribute('d', original.d);
  assert.deepEqual((await readExport(page)).document, { ...before, snap: !before.snap },
    'Clicking another control must discard the keyboard draft while applying its own preference.');
  assert.deepEqual(await history(page, before), versions, 'Focus departure must not create a route revision.');
  await snap.click();
  const { start } = await beginDrag(page, 2);
  await page.mouse.move(start.x, start.y - 20);
  await expect(path(page)).not.toHaveAttribute('d', original.d);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(path(page)).toHaveAttribute('d', original.d);
  assert.deepEqual((await readExport(page)).document, before, 'The next pointer drag must remain usable after focus cancellation.');
  assert.deepEqual(await history(page, before), versions);
  await assertAttached(page);
});

Then('moving the blocker across its authored route preserves intent and restores the route when cleared', async function () {
  const page = this.page;
  const before = this.manualBaseline, authored = routeOf(before), original = await geometry(page);
  const blocker = await node(page, 'blocker').boundingBox();
  const crossingY = authored[2].y * original.matrix.d + original.matrix.f;
  const delta = crossingY - blocker.y - blocker.height / 2;
  const moveBlocker = async dy => {
    const start = await center(node(page, 'blocker').locator('.utility-title strong'));
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + dy, { steps: 8 });
    await page.mouse.up();
    await saved(page);
  };
  await moveBlocker(delta);
  const blockedBounds = await node(page, 'blocker').boundingBox();
  assert.ok(crossingY > blockedBounds.y && crossingY < blockedBounds.y + blockedBounds.height,
    'The moved node must intersect the authored segment, so the fallback assertion cannot be vacuous.');
  await expect(path(page)).not.toHaveAttribute('d', original.d);
  await expect.poll(() => minimumBlockerClearance(page),
    { message: 'The suspended route must automatically clear the newly moved blocker.' }).toBeGreaterThanOrEqual(15.5);
  await assertAttached(page);
  const suspended = (await storedWorkflows(page)).find(item => item.id === before.id);
  assert.deepEqual(routeOf(suspended), authored, 'A temporarily blocked route must retain its authored intent in storage.');
  assert.equal(Object.hasOwn(suspended.edges[0], 'manualState'), false, 'Suspension must remain derived state.');
  await reveal(page);
  const reset = edge(page).getByRole('button', { name: 'Reset connection route', exact: true });
  await expect(reset).toBeVisible();
  await expect(reset).toBeEnabled();
  await reset.focus();
  await expect(reset).toBeFocused();
  const firstPosition = before.nodes.find(item => item.id === 'manual-blocker').position;
  const movedPosition = suspended.nodes.find(item => item.id === 'manual-blocker').position;
  assert.ok(Math.abs(movedPosition.y - firstPosition.y) > 10, 'The node drag must be saved.');
  await moveBlocker((firstPosition.y - movedPosition.y) * original.zoom);
  await expect(path(page)).toHaveAttribute('d', original.d);
  const restored = (await storedWorkflows(page)).find(item => item.id === before.id);
  assert.deepEqual(routeOf(restored), authored, 'Clearing the blocker must restore the same authored intent.');
  await assertAttached(page);
});

Then('one manual drag survives history navigation reload and import and can be reset', async function () {
  const page = this.page;
  const baseline = this.manualBaseline, versions = await history(page, baseline), automatic = await geometry(page);
  assert.equal(routeOf(baseline), undefined, 'Automatic geometry must not already be saved.');
  await reveal(page);
  const index = Number(await controls(page).first().getAttribute('data-segment-index'));
  const { start, axis } = await beginDrag(page, index);
  for (const delta of [-18, -36, -60]) {
    await page.mouse.move(start.x + (axis === 'x' ? delta : 0), start.y + (axis === 'y' ? delta : 0));
    await frame(page);
    const persisted = (await storedWorkflows(page)).find(item => item.id === baseline.id);
    assert.equal(routeOf(persisted), undefined, 'Pointer movement must remain a transient route draft.');
    assert.deepEqual(await history(page, baseline), versions, 'Pointer movement must not create history revisions.');
  }
  const draft = await geometry(page);
  assert.notEqual(draft.d, automatic.d);
  await page.mouse.up();
  await saved(page);
  const edited = (await readExport(page)).document, authored = routeOf(edited);
  assert.ok(authored?.length >= 4, 'Releasing the drag must author a checked polyline.');
  assert.equal((await history(page, baseline)).length, versions.length + 1, 'One completed drag must create exactly one revision.');
  const adjustedPath = (await geometry(page)).d;
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  assert.equal(routeOf((await readExport(page)).document), undefined);
  await expect(path(page)).toHaveAttribute('d', automatic.d);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  assert.deepEqual(routeOf((await readExport(page)).document), authored);
  await expect(path(page)).toHaveAttribute('d', adjustedPath);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(path(page)).toHaveAttribute('d', adjustedPath);
  const exported = await readExport(page);
  assert.deepEqual(routeOf(exported.document), authored);
  const imported = await importDocument(page, exported.document);
  assert.notEqual(imported.id, edited.id, 'The exported route must survive a real import into a new workflow.');
  assert.deepEqual(routeOf(imported), authored);
  await expect(path(page)).toHaveAttribute('d', adjustedPath);
  await reveal(page);
  await edge(page).getByRole('button', { name: 'Reset connection route', exact: true }).click();
  await saved(page);
  assert.equal(routeOf((await readExport(page)).document), undefined, 'Reset must remove authored route intent.');
  await expect(path(page)).toHaveAttribute('d', automatic.d);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  assert.deepEqual(routeOf((await readExport(page)).document), authored, 'Reset must itself be undoable.');
});

Then('curved connections retain editable anchors and preserve adjustments across styles', async function () {
  const page = this.page;
  const before = (await readExport(page)).document, original = await geometry(page), versions = await history(page, before);
  await toggleConnectionStyle(page);
  await expect(path(page)).not.toHaveAttribute('d', original.d);
  await reveal(page);
  await expect(controls(page)).toHaveCount(routeOf(before).length - 1);
  assert.deepEqual(routeOf((await readExport(page)).document), routeOf(before));
  await toggleConnectionStyle(page);
  await expect(path(page)).toHaveAttribute('d', original.d);
  await reveal(page);
  await expect(controls(page)).toHaveCount(routeOf(before).length - 1);
  assert.deepEqual(await history(page, before), versions, 'A display preference must not rewrite authored route history.');
  await toggleConnectionStyle(page);
  await drag(page, 2, -24);
  await assertAttached(page);
  const moved = (await readExport(page)).document;
  assert.notDeepEqual(routeOf(moved), routeOf(before), 'Curved mode must support actual pointer editing.');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  assert.deepEqual(routeOf((await readExport(page)).document), routeOf(before));
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  assert.deepEqual(routeOf((await readExport(page)).document), routeOf(moved));
  await page.reload();
  await setMode(page, 'workflow');
  assert.deepEqual(routeOf((await readExport(page)).document), routeOf(moved));
  await assertAttached(page);
  await hoverReset(page);
  await edge(page).getByRole('button', { name: 'Reset connection route', exact: true }).click();
  await saved(page);
  assert.equal(routeOf((await readExport(page)).document), undefined);
});

Given('an imported manual routing workflow with delayed worker replies', async function () {
  // Hold genuine worker messages at the browser boundary, without replacing the
  // routing algorithm or adding application test hooks.
  await this.page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__manualRoutingWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (options?.name === 'workflow-edge-routing') {
          this.observed = { hold: false, pending: [], inFlight: 0, terminated: false };
          window.__manualRoutingWorkers.push(this.observed);
        }
      }
      postMessage(message, ...options) {
        if (this.observed && message?.kind === 'request') this.observed.inFlight++;
        return super.postMessage(message, ...options);
      }
      addEventListener(type, listener, options) {
        if (this.observed && type === 'message') return super.addEventListener(type, event => {
          const deliver = () => {
            this.observed.inFlight--;
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
          };
          if (this.observed.hold) this.observed.pending.push(deliver);
          else deliver();
        }, options);
        return super.addEventListener(type, listener, options);
      }
      terminate() { if (this.observed) this.observed.terminated = true; return super.terminate(); }
    };
  });
  await this.page.reload();
  await importManual(this);
});

async function observePathChanges(page) {
  await path(page).evaluate(element => {
    window.__manualObservedPaths = [];
    window.__manualPathObserver = new MutationObserver(records => {
      for (const record of records) {
        window.__manualObservedPaths.push(record.oldValue, record.target.getAttribute('d'));
      }
    });
    window.__manualPathObserver.observe(element, { attributes: true, attributeFilter: ['d'], attributeOldValue: true });
  });
}

async function observedPathChanges(page) {
  return page.evaluate(() => {
    window.__manualPathObserver.disconnect();
    return window.__manualObservedPaths;
  });
}

Then('a stale calculation cannot flash an older route over two completed manual drags', async function () {
  const page = this.page;
  await expect.poll(() => page.evaluate(() => window.__manualRoutingWorkers.findLast(worker => !worker.terminated)?.inFlight)).toBe(0);
  const original = await geometry(page);
  await page.evaluate(() => { window.__manualRoutingWorkers.findLast(worker => !worker.terminated).hold = true; });
  await drag(page, 2, -30);
  await expect.poll(() => page.evaluate(() => window.__manualRoutingWorkers.findLast(worker => !worker.terminated).pending.length)).toBe(1);
  const first = await geometry(page), committed = (await readExport(page)).document;
  const versions = await history(page, committed);
  await observePathChanges(page);
  const { start } = await beginDrag(page, 2);
  await page.mouse.move(start.x, start.y - 20);
  await expect(path(page)).not.toHaveAttribute('d', first.d);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(path(page)).toHaveAttribute('d', first.d);
  await beginDrag(page, 2);
  await page.mouse.up();
  await expect(path(page)).toHaveAttribute('d', first.d);
  assert.deepEqual(routeOf((await storedWorkflows(page)).find(item => item.id === committed.id)), routeOf(committed),
    'Cancelling or releasing an unchanged later drag must retain the earlier committed route.');
  assert.deepEqual(await history(page, committed), versions, 'Cancelled and unchanged follow-up drags must not create revisions.');
  assert.ok((await observedPathChanges(page)).every(value => value !== original.d),
    'Cancelling a later draft must never flash the stale route while its previous commit awaits a worker reply.');
  await drag(page, 2, -30);
  const second = await geometry(page);
  assert.notEqual(second.d, first.d, 'The second completed edit must establish a different draft.');
  await observePathChanges(page);
  await page.getByRole('button', { name: 'Workflow history', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Workflow history', exact: true });
  await expect(dialog).toBeVisible();
  // Modal accessibility hides the canvas region; inspect its existing path in
  // the DOM while the dialog temporarily disables graph editing.
  await expect(page.locator(`.svelte-flow__edge[data-id="${edgeId}"] .svelte-flow__edge-interaction`)).toHaveAttribute('d', second.d);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(path(page)).toHaveAttribute('d', second.d);
  await page.evaluate(() => { window.__manualRoutingWorkers.findLast(worker => !worker.terminated).pending.shift()(); });
  await expect.poll(() => page.evaluate(() => window.__manualRoutingWorkers.findLast(worker => !worker.terminated).pending.length)).toBe(1);
  await expect(path(page)).toHaveAttribute('d', second.d);
  await page.evaluate(() => {
    const worker = window.__manualRoutingWorkers.findLast(worker => !worker.terminated);
    worker.hold = false;
    worker.pending.shift()();
  });
  await frame(page);
  await expect(path(page)).toHaveAttribute('d', second.d);
  const observed = await observedPathChanges(page);
  assert.ok(observed.every(value => value === second.d), `A stale worker reply must not paint any earlier geometry: ${JSON.stringify(observed)}.`);
  await assertAttached(page);
});
