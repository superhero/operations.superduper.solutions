// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readExport, setMode, workflow } from './workspace.steps.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { createUtilityNode, addArrayFilterAssertion } from '../../src/lib/workflow-graph.ts';
import { defaultProcessingData } from '../../src/lib/workflow-processing.ts';

const edge = (page, name) => workflow(page).locator(`.svelte-flow__edge[data-id="curve-assert:${name}"]`);
const path = (page, name) => edge(page, name).locator('.svelte-flow__edge-interaction');
const port = (page, id, name) => workflow(page).locator(`.svelte-flow__node[data-id="curve-${id}"] .svelte-flow__handle[data-handleid="${name}"]`);
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const center = async locator => { const box = await locator.boundingBox(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
async function reveal(page, name) {
  // Returns may intentionally share stems; native edge selection can expose
  // the chosen route's controls even where another edge overlaps its hit area.
  await edge(page, name).focus();
  await edge(page, name).press('Enter');
  await expect(edge(page, name).locator('.flow-routing-segment-handle').first()).toBeVisible();
}

async function expectSafe(page, locator) {
  await expect(locator).toHaveAttribute('d', /^M .* L/);
  await expect.poll(() => locator.evaluate(element => {
    const matrix = element.getScreenCTM();
    const boxes = [...document.querySelectorAll('.svelte-flow__node')].map(node => node.getBoundingClientRect());
    const length = element.getTotalLength();
    let crossings = 0;
    for (let distance = 0; distance <= length; distance += 0.5) {
      const point = element.getPointAtLength(distance);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      for (const box of boxes) if (screen.x > box.left + 0.75 && screen.x < box.right - 0.75 && screen.y > box.top + 0.75 && screen.y < box.bottom - 0.75) crossings++;
    }
    return crossings;
  }), { message: 'Every settled curved segment must avoid all measured node bodies, including its owners.' }).toBe(0);
}

Given('a curved Filter array assertion loop at width {int}', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 900 });
  await setMode(page, 'workflow');
  const filter = { ...createUtilityNode('filter', { x: 80, y: 200 }, 'curve-filter'), data: defaultProcessingData('filter', 'array_filter') };
  const blocker = createUtilityNode('cast', { x: 440, y: 510 }, 'curve-blocker');
  const graph = addArrayFilterAssertion('curve-filter', 'curve-assert', [filter, blocker], []);
  this.curvedLoop = { version: 3, id: 'curved-filter-routing', name: 'Curved filter routing', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: true, dashed: true };
  await loadGraphFixture(page, this.curvedLoop);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
});

Then('its curved returns avoid node bodies and support reversible anchor adjustments', async function () {
  const page = this.page;
  for (const name of ['assertion', 'keep', 'remove']) await expectSafe(page, path(page, name));
  const before = (await readExport(page)).document;
  assert.ok(before.edges.every(edge => !edge.manualRoute), 'Automatic routing must stay out of the saved document.');
  await reveal(page, 'keep');
  const controls = edge(page, 'keep').getByRole('button', { name: 'Move segment up or down', exact: true });
  // The outer horizontal return is outside both endpoint nodes. Move it farther
  // outward so this checks real editing without relying on a particular detour side.
  const index = await controls.evaluateAll(elements => {
    const boxes = ['curve-filter', 'curve-assert'].map(id => document.querySelector(`.svelte-flow__node[data-id="${id}"]`).getBoundingClientRect());
    return elements.findIndex(element => { const box = element.getBoundingClientRect(), y = box.y + box.height / 2;
      return y < Math.min(...boxes.map(box => box.top)) || y > Math.max(...boxes.map(box => box.bottom)); });
  });
  assert.ok(index >= 0, 'A backwards return needs an editable horizontal run outside its endpoint nodes.');
  const control = controls.nth(index);
  await control.focus();
  const direction = await control.evaluate(element => element.getBoundingClientRect().y < document.querySelector('.svelte-flow__node[data-id="curve-filter"]').getBoundingClientRect().top ? 'ArrowUp' : 'ArrowDown');
  await control.press(`Shift+${direction}`);
  await saved(page);
  const moved = (await readExport(page)).document;
  const authored = moved.edges.find(edge => edge.id === 'curve-assert:keep').manualRoute;
  assert.ok(authored?.length > 2, 'Keyboard adjustment must save real route anchors in curved mode.');
  assert.deepEqual(moved.nodes, before.nodes, 'Moving an anchor must not move nodes.');
  await expectSafe(page, path(page, 'keep'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  assert.deepEqual((await readExport(page)).document.edges, before.edges);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  assert.deepEqual((await readExport(page)).document.edges, moved.edges);
  await page.reload();
  await setMode(page, 'workflow');
  await expectSafe(page, path(page, 'keep'));
  assert.deepEqual((await readExport(page)).document.edges, moved.edges);
  await page.mouse.move(5, 5);
  await mkdir(this.artifactDirectory, { recursive: true });
  await workflow(page).screenshot({ path: `${this.artifactDirectory}/curved-assertion-returns.png` });
});

Then('a curved return uses the same safe snapped preview when connected', async function () {
  const page = this.page;
  await loadGraphFixture(page, { ...this.curvedLoop, edges: this.curvedLoop.edges.filter(edge => edge.id !== 'curve-assert:keep') });
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  const start = await center(port(page, 'assert', 'success')), end = await center(port(page, 'filter', 'success'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 12, start.y, { steps: 3 });
    await page.mouse.move(end.x, end.y, { steps: 10 });
    const preview = workflow(page).locator('.workflow-connection-preview');
    await expect(preview).toHaveAttribute('data-target', 'curve-filter');
    await expectSafe(page, preview.locator('path'));
    const expected = await preview.locator('path').getAttribute('d');
    await page.mouse.up();
    const added = workflow(page).locator('.svelte-flow__edge:not([data-id="curve-assert:assertion"]):not([data-id="curve-assert:remove"])');
    await expect(added).toHaveCount(1);
    await expect(added.locator('.svelte-flow__edge-interaction')).toHaveAttribute('d', expected);
    await expectSafe(page, added.locator('.svelte-flow__edge-interaction'));
  } finally { await page.mouse.up(); }
});
