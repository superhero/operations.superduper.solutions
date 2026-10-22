// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { toggleConnectionStyle, chooseSettingsLineStyle, chooseConnectionStyle } from './connection-style.fixture.mjs';
import assert from 'node:assert/strict';
import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readExport, setMode, workflow } from './workspace.fixture.mjs';
import { loadGraphFixture } from './workflow-graph.fixture.mjs';
import { createUtilityNode, addArrayFilterAssertion } from '../../src/lib/workflow-graph.ts';
import { defaultProcessingData } from '../../src/lib/workflow-processing.ts';
import { workflowLineStyles, workflowLineStyleLabels } from '../../src/lib/workflow-line-style.ts';
import { workflowCurve } from '../../src/lib/workflow-curve.ts';

const edge = (page, name) => workflow(page).locator(`.svelte-flow__edge[data-id="${name === 'cast' ? 'curve-cast:result' : `curve-assert:${name}`}"]`);
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
  await expect(locator).toHaveAttribute('d', /^M.* C/);
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

async function expectFlowing(locator) {
  await expect(locator).toHaveAttribute('d', /^M.* C/);
  const values = (await locator.getAttribute('d')).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  assert.equal(values.length, 8, 'The historical mode draws one cubic between the ports.');
  await expect(locator).toHaveAttribute('d', workflowCurve({ sourceX: values[0], sourceY: values[1], sourcePosition: 'right',
    targetX: values[6], targetY: values[7], targetPosition: 'left' }, 100)[0]);
}

async function expectSameCurve(locator, expected) {
  const values = value => value.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const before = values(expected);
  await expect.poll(async () => {
    const after = values(await locator.getAttribute('d'));
    return before.length === after.length ? Math.max(...before.map((value, i) => Math.abs(value - after[i]))) : Infinity;
  }, { message: 'Remeasuring ports must preserve the curve within subpixel rounding.' }).toBeLessThan(0.01);
  await expectFlowing(locator);
}

Given('a curved Filter array assertion loop at width {int}', async function (width) {
  const page = this.page;
  await page.setViewportSize({ width, height: 900 });
  await setMode(page, 'workflow');
  const filter = { ...createUtilityNode('filter', { x: 80, y: 200 }, 'curve-filter'), data: defaultProcessingData('filter', 'array_filter') };
  const cast = createUtilityNode('cast', { x: 480, y: 20 }, 'curve-cast');
  const graph = addArrayFilterAssertion('curve-filter', 'curve-assert', [filter, cast], []);
  graph.nodes.find(node => node.id === 'curve-assert').position = { x: 870, y: 230 };
  graph.edges.find(edge => edge.id === 'curve-assert:assertion').target = 'curve-cast';
  graph.edges.push({ id: 'curve-cast:result', kind: 'mapping', source: 'curve-cast', sourceHandle: 'result', target: 'curve-assert', targetHandle: 'value' });
  this.curvedLoop = { version: 3, id: 'curved-filter-routing', name: 'Curved filter routing', ...graph,
    viewport: { x: 0, y: 0, zoom: 1 }, snap: false, curved: true, dashed: true };
  await loadGraphFixture(page, this.curvedLoop);
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
});

Then('its curved returns avoid node bodies and support reversible anchor adjustments', async function () {
  const page = this.page;
  for (const name of ['assertion', 'cast', 'keep', 'remove']) await expectSafe(page, path(page, name));
  const curved = await path(page, 'cast').getAttribute('d');
  const diagonal = await path(page, 'cast').evaluate(element => {
    let count = 0;
    for (let i = 5; i < element.getTotalLength(); i += 5) {
      const a = element.getPointAtLength(i - 1), b = element.getPointAtLength(i + 1);
      if (Math.abs(b.x - a.x) > 0.25 && Math.abs(b.y - a.y) > 0.25) count++;
    }
    return count;
  });
  assert.ok(diagonal > 10, 'Curved mode must contain real diagonal spans, not only short rounded corners.');
  await mkdir(this.artifactDirectory, { recursive: true });
  await workflow(page).screenshot({ path: `${this.artifactDirectory}/default-diagonal-curves.png` });
  await toggleConnectionStyle(page);
  await expect(path(page, 'cast')).toHaveAttribute('d', /^M .* L/);
  assert.notEqual(await path(page, 'cast').getAttribute('d'), curved);
  await toggleConnectionStyle(page);
  await expect(path(page, 'cast')).toHaveAttribute('d', curved);
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

async function connectReturn(world, style) {
  const page = world.page;
  const verify = locator => style === 'flowing' ? expectFlowing(locator) : expectSafe(page, locator);
  await loadGraphFixture(page, { ...world.curvedLoop, lineStyle: style, edges: world.curvedLoop.edges.filter(edge => edge.id !== 'curve-assert:keep') });
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  // Leave a stable drag corridor outside XYFlow's edge auto-pan region.
  const zoomOut = page.getByRole('button', { name: 'Zoom Out', exact: true });
  for (let i = 0; i < 2 && await zoomOut.isEnabled(); i++) await zoomOut.click();
  await page.evaluate(async () => {
    let previous = '', stable = 0;
    for (let frame = 0; frame < 90; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const current = document.querySelector('.svelte-flow__viewport').getAttribute('style');
      stable = current === previous ? stable + 1 : 0; previous = current;
      if (stable >= 3) return;
    }
    throw new Error('The viewport must settle before measuring connection drag targets.');
  });
  const start = await center(port(page, 'assert', 'success')), end = await center(port(page, 'filter', 'success'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x - 12, start.y, { steps: 3 });
    if (style === 'flowing') await verify(workflow(page).locator('.svelte-flow__connection-path'));
    await page.mouse.move(end.x, end.y, { steps: 10 });
    const preview = workflow(page).locator('.workflow-connection-preview');
    await expect(preview).toHaveAttribute('data-target', 'curve-filter');
    await verify(preview.locator('path'));
    const expected = await preview.locator('path').getAttribute('d');
    await page.mouse.up();
    const added = workflow(page).locator('.svelte-flow__edge:not([data-id="curve-assert:assertion"]):not([data-id="curve-assert:remove"]):not([data-id="curve-cast:result"])');
    await expect(added).toHaveCount(1);
    await expect.poll(async () => {
      const values = d => d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
      const before = values(expected), after = values(await added.locator('.svelte-flow__edge-interaction').getAttribute('d'));
      return before.length === after.length ? Math.max(...before.map((value, i) => Math.abs(value - after[i]))) : Infinity;
    }, { message: 'Dropping must preserve the preview geometry within subpixel coordinate rounding.' }).toBeLessThan(0.01);
    await verify(added.locator('.svelte-flow__edge-interaction'));
  } finally { await page.mouse.up(); }
}

Then('a curved return uses the same safe snapped preview when connected', function () { return connectReturn(this, 'filleted'); });
Then('a flowing return preserves its original preview when connected', function () { return connectReturn(this, 'flowing'); });

Then('the Settings curve switch changes the open workflow immediately', async function () {
  const page = this.page;
  const before = (await readExport(page)).document;
  for (const enabled of [false, true]) {
    await setMode(page, 'settings');
    const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
    const application = settings.locator('summary[aria-label="Application"]');
    if (await application.getAttribute('aria-expanded') !== 'true') await application.click();
    await chooseSettingsLineStyle(page, enabled ? 'filleted' : 'orthogonal');
    await setMode(page, 'workflow');
    await expect(page.getByRole('button', { name: 'Connection style', exact: true })).toHaveAttribute('aria-pressed', String(enabled));
    if (enabled) await expectSafe(page, path(page, 'cast'));
    else await expect(path(page, 'cast')).toHaveAttribute('d', /^M .* L/);
    await saved(page);
    const after = (await readExport(page)).document;
    assert.equal(after.id, before.id, 'The Settings switch must apply to the already-open workflow.');
    assert.equal(after.curved, enabled);
    assert.deepEqual(after.nodes, before.nodes);
  }
  await page.reload();
  await setMode(page, 'workflow');
  await expectSafe(page, path(page, 'cast'));
  assert.equal((await readExport(page)).document.curved, true);
});

Then('the five connection styles retain their geometry and saved preference', async function () {
  const page = this.page, original = (await readExport(page)).document, paths = {}, maximum = workflowLineStyles.length - 1;
  for (const [index, style] of workflowLineStyles.entries()) {
    await setMode(page, 'settings');
    const application = page.locator('summary[aria-label="Application"]');
    if (await application.getAttribute('aria-expanded') !== 'true') await application.click();
    const slider = page.getByRole('slider', { name: 'Connection style', exact: true });
    const control = page.locator('.line-style-setting'), ticks = control.locator('.integer-tick');
    await expect(slider).toHaveAttribute('aria-valuemin', '0');
    await expect(slider).toHaveAttribute('aria-valuemax', String(maximum));
    await expect(slider).toHaveAttribute('step', String(1 / maximum));
    await expect(ticks).toHaveCount(workflowLineStyles.length);
    for (const tick of await ticks.all()) await expect(tick).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Connection style value', exact: true })).toHaveCount(0);
    await chooseSettingsLineStyle(page, style);
    await slider.press('Home');
    const bounds = await slider.boundingBox();
    const fraction = (index + (index === maximum ? -0.3 : 0.3)) / maximum;
    await page.mouse.move(bounds.x + 7, bounds.y + bounds.height / 2);
    await page.mouse.down();
    try {
      await page.mouse.move(bounds.x + 7 + (bounds.width - 14) * fraction, bounds.y + bounds.height / 2, { steps: 4 });
      assert.equal(await slider.evaluate(element => element.valueAsNumber), index / maximum, 'Dragging between ticks must snap the thumb to the nearest stop.');
    } finally { await page.mouse.up(); }
    await expect(slider).toHaveAttribute('aria-valuetext', workflowLineStyleLabels[style]);
    await expect(control).toHaveText(new RegExp(`^\\s*Connection style\\s*${workflowLineStyleLabels[style]}\\s*$`));
    const alignment = await control.evaluate(element => {
      const input = element.querySelector('input[type="range"]'), tick = element.querySelector('.integer-tick.active');
      const inputBox = input.getBoundingClientRect(), tickBox = tick.getBoundingClientRect();
      const thumbX = inputBox.x + (7 + (input.clientWidth - 14) * input.valueAsNumber) * inputBox.width / input.clientWidth;
      const text = document.createRange(); text.selectNodeContents(element.querySelector('.line-style-value'));
      const textBox = text.getBoundingClientRect(), box = element.getBoundingClientRect();
      return { tick: Math.abs(tickBox.x + tickBox.width / 2 - thumbX), text: Math.abs(textBox.x + textBox.width / 2 - box.x - box.width / 2) };
    });
    assert.ok(alignment.tick < 1 && alignment.text < 1, `Ticks must align with the snapped thumb and the sole label must be centered: ${JSON.stringify(alignment)}.`);
    await slider.evaluate(element => element.blur());
    await slider.hover();
    await expect(slider).toHaveCSS('outline-style', 'none');
    const dashLength = page.getByRole('slider', { name: 'Dash length', exact: true });
    await dashLength.hover();
    await expect(dashLength).toHaveCSS('outline-style', 'none');
    await expect(page.locator('.grid-size-control').filter({ has: dashLength })).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    await dashLength.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.grid-size-control').filter({ has: dashLength })).not.toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    await dashLength.evaluate(element => element.blur());
    if (style === 'flowing') {
      await mkdir(this.artifactDirectory, { recursive: true });
      await page.screenshot({ path: `${this.artifactDirectory}/five-style-slider.png` });
    }
    await setMode(page, 'workflow');
    await expect(page.getByRole('button', { name: 'Connection style', exact: true })).toHaveAttribute('data-line-style', style);
    if (style === 'flowing') for (const name of ['cast', 'keep', 'remove']) await expectFlowing(path(page, name));
    else if (style !== 'orthogonal') for (const name of ['cast', 'keep', 'remove']) await expectSafe(page, path(page, name));
    else await expect(path(page, 'cast')).toHaveAttribute('d', /^M .* L/);
    paths[style] = (await Promise.all(['cast', 'keep', 'remove'].map(name => path(page, name).getAttribute('d')))).join(' ');
    await saved(page);
    const document = (await readExport(page)).document;
    assert.equal(document.lineStyle, style);
    assert.deepEqual(document.nodes, original.nodes);
    assert.deepEqual(document.edges, original.edges);
    assert.equal(document.dashed, original.dashed);
    await mkdir(this.artifactDirectory, { recursive: true });
    await workflow(page).screenshot({ path: `${this.artifactDirectory}/${style}.png` });
  }
  assert.equal(new Set(Object.values(paths)).size, workflowLineStyles.length, 'Each mode must render a genuinely different path.');
  await page.reload();
  await setMode(page, 'workflow');
  const button = page.getByRole('button', { name: 'Connection style', exact: true });
  await expect(button).toHaveAttribute('data-line-style', workflowLineStyles.at(-1));
  for (const style of workflowLineStyles) {
    await button.click();
    await expect(button).toHaveAttribute('data-line-style', style);
  }
  await chooseConnectionStyle(page, 'filleted');
  await saved(page);
  await page.reload();
  await setMode(page, 'workflow');
  await expect(button).toHaveAttribute('data-line-style', 'filleted');
  await setMode(page, 'settings');
  const application = page.locator('summary[aria-label="Application"]');
  if (await application.getAttribute('aria-expanded') !== 'true') await application.click();
  await expect(page.getByRole('slider', { name: 'Connection style', exact: true })).toHaveAttribute('aria-valuetext', workflowLineStyleLabels[workflowLineStyles.at(-1)]);
});

Then('flowing curves ignore saved detours while retaining them for routed styles', async function () {
  const page = this.page;
  await chooseConnectionStyle(page, 'flowing');
  for (const name of ['assertion', 'cast', 'keep', 'remove']) await expectFlowing(path(page, name));
  const original = await path(page, 'keep').getAttribute('d');
  const values = original.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
  const start = { x: values[0], y: values[1] }, end = { x: values[6], y: values[7] }, bottom = Math.max(start.y, end.y) + 200;
  const manualRoute = [start, { x: start.x + 48, y: start.y }, { x: start.x + 48, y: bottom },
    { x: end.x - 48, y: bottom }, { x: end.x - 48, y: end.y }, end];
  const document = (await readExport(page)).document;
  await loadGraphFixture(page, { ...document, edges: document.edges.map(item => item.id === 'curve-assert:keep' ? { ...item, manualRoute } : item) });
  await expectSameCurve(path(page, 'keep'), original);
  await edge(page, 'keep').focus();
  await edge(page, 'keep').press('Enter');
  await expect(edge(page, 'keep').locator('.flow-routing-segment-handle')).toHaveCount(0);
  assert.deepEqual((await readExport(page)).document.edges.find(item => item.id === 'curve-assert:keep').manualRoute, manualRoute);
  await chooseConnectionStyle(page, 'filleted');
  await expectSafe(page, path(page, 'keep'));
  await expect(path(page, 'keep')).not.toHaveAttribute('d', original);
  await reveal(page, 'keep');
  assert.deepEqual((await readExport(page)).document.edges.find(item => item.id === 'curve-assert:keep').manualRoute, manualRoute);
  await chooseConnectionStyle(page, 'flowing');
  await saved(page);
  await page.reload();
  await setMode(page, 'workflow');
  await expectSameCurve(path(page, 'keep'), original);
});
