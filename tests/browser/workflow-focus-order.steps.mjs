// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { readExport, setMode, workflow } from './workspace.fixture.mjs';
import { repository, storedWorkflows } from './workflow-storage.fixture.mjs';

const node = (page, id) => workflow(page).locator(`.svelte-flow__node[data-id="focus-${id}"]`);
const saved = page => expect(page.locator('.site-header .document-meta').getByText('Saved locally', { exact: true })).toBeVisible();
const visibleOrder = ['input-leaf', 'input-zulu', 'input-alpha', 'input-root', 'owner-a',
  'output-root', 'output-zulu', 'output-alpha', 'output-leaf', 'switch', 'comment', 'b-input', 'owner-b', 'b-output'];
const restoredOrder = ['input-leaf', 'hidden-leaf', 'input-zulu', 'input-alpha', 'hidden-input', 'input-root',
  'owner-a', 'output-root', 'output-zulu', 'output-alpha', 'output-leaf', 'switch', 'comment', 'b-input', 'owner-b', 'b-output'];
const field = (id, type = 'Text') => ({ id, label: id, type, required: false, description: '', connectable: true });
const graphContent = ({ viewport, snap, curved, dashed, ...document }) => document;

function fixture() {
  const owner = (id, name, y) => ({ id: `focus-${id}`, type: 'operation', position: { x: 1200, y },
    data: { operationId: 'demo:listProjects', name, description: '', method: 'GET', path: '/projects' } });
  const data = (id, ownerId, direction, label, x, y, fields = [field('code')], hidden = false) => ({
    id: `focus-${id}`, type: 'data', position: { x, y }, ...(hidden ? { hidden: true } : {}),
    data: { ownerId: `focus-${ownerId}`, direction, label, fields },
  });
  const nodes = [
    owner('owner-a', 'First operation', 380),
    data('input-root', 'owner-a', 'inputs', 'Input root', 850, 350,
      [field('zulu', 'Object'), field('alpha', 'Object'), field('hidden', 'Object')]),
    data('input-zulu', 'owner-a', 'inputs', 'Zulu input', 500, 200, [field('leaf', 'Object')]),
    data('input-alpha', 'owner-a', 'inputs', 'Alpha input', 500, 410),
    data('input-leaf', 'owner-a', 'inputs', 'Outer input', 150, 200),
    data('hidden-input', 'owner-a', 'inputs', 'Hidden input branch', 500, 610, [field('leaf', 'Object')], true),
    data('hidden-leaf', 'owner-a', 'inputs', 'Hidden input leaf', 150, 610, [field('code')], true),
    data('output-root', 'owner-a', 'outputs', 'Output root', 1500, 350, [field('zulu', 'Object'), field('alpha', 'Object')]),
    data('output-zulu', 'owner-a', 'outputs', 'Zulu output', 1850, 200, [field('leaf', 'Object')]),
    data('output-alpha', 'owner-a', 'outputs', 'Alpha output', 1850, 410),
    data('output-leaf', 'owner-a', 'outputs', 'Outer output', 2200, 200),
    { id: 'focus-switch', type: 'switch', position: { x: 1200, y: 700 },
      data: { gates: [{ id: 'focus-gate', operator: 'is_set', value: '' }] } },
    { id: 'focus-comment', type: 'comment', position: { x: 1200, y: 960 }, data: { text: 'A keyboard navigation note.' } },
    owner('owner-b', 'Second operation', 1240),
    data('b-input', 'owner-b', 'inputs', 'Second input', 850, 1240),
    data('b-output', 'owner-b', 'outputs', 'Second output', 1500, 1240),
  ];
  const byId = new Map(nodes.map(item => [item.id.replace('focus-', ''), item]));
  const branch = (child, parent, parentHandle, detached = false) => {
    const input = byId.get(child).data.direction === 'inputs';
    const id = `schema:focus-${child}`;
    return { id, kind: 'schema', source: `focus-${input ? child : parent}`, target: `focus-${input ? parent : child}`,
      sourceHandle: input ? 'value' : parentHandle ?? id, targetHandle: input ? parentHandle ?? id : 'value',
      ...(byId.get(child).hidden ? { hidden: true } : {}), ...(detached ? { detached: true } : {}) };
  };
  // Edge and data-node ordering deliberately disagree with field order and
  // column order. Only the non-data owners retain their canonical sequence.
  const shuffled = ['b-output', 'input-alpha', 'output-leaf', 'owner-a', 'hidden-leaf', 'output-root',
    'input-leaf', 'switch', 'output-alpha', 'b-input', 'comment', 'input-root', 'hidden-input', 'owner-b',
    'output-zulu', 'input-zulu'];
  const edges = [branch('input-root', 'owner-a'), branch('input-zulu', 'input-root', 'zulu'),
    branch('input-alpha', 'input-root', 'alpha'), branch('input-leaf', 'input-zulu', 'leaf'),
    branch('hidden-input', 'input-root', 'hidden', true), branch('hidden-leaf', 'hidden-input', 'leaf'),
    branch('output-root', 'owner-a'), branch('output-zulu', 'output-root', 'zulu'),
    branch('output-alpha', 'output-root', 'alpha'), branch('output-leaf', 'output-zulu', 'leaf'),
    branch('b-input', 'owner-b'), branch('b-output', 'owner-b')].reverse();
  edges.unshift({ id: 'focus-map-backwards', kind: 'mapping', source: 'focus-b-output', sourceHandle: 'code',
    target: 'focus-input-leaf', targetHandle: 'code' });
  edges.push({ id: 'focus-map-forwards', kind: 'mapping', source: 'focus-output-leaf', sourceHandle: 'code',
    target: 'focus-b-input', targetHandle: 'code' });
  return { version: 3, id: 'workflow-focus-order', name: 'Native workflow focus order', description: '',
    nodes: shuffled.map(id => byId.get(id)), edges, viewport: { x: 0, y: 0, zoom: 1 },
    snap: false, curved: false, dashed: false };
}

async function currentStop(page) {
  return page.evaluate(() => {
    const active = document.activeElement, wrapper = active?.closest('.svelte-flow__node');
    if (!wrapper) return null;
    return { id: wrapper.dataset.id, kind: active === wrapper ? 'node' : active.tagName.toLowerCase(),
      label: active === wrapper ? '' : active.getAttribute('aria-label') || active.getAttribute('title') || active.textContent.trim(),
      disabled: active.matches(':disabled'), tabIndex: active.tabIndex };
  });
}

async function nativeStops(page, order) {
  const stops = [];
  for (const id of order) {
    await expect(node(page, id)).toBeVisible();
    stops.push(...await node(page, id).evaluate(wrapper => {
      const candidates = [wrapper, ...wrapper.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')];
      return candidates.filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
        element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden').map(element => ({
        id: wrapper.dataset.id, kind: element === wrapper ? 'node' : element.tagName.toLowerCase(),
        label: element === wrapper ? '' : element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim(),
        disabled: false, tabIndex: 0,
      }));
    }));
  }
  return stops;
}

async function traverse(page, order) {
  const positive = await workflow(page).locator('[tabindex]').evaluateAll(elements => elements.filter(element => element.tabIndex > 0).length);
  assert.equal(positive, 0, 'Workflow traversal must use native DOM order without positive tabindex values.');
  const stops = await nativeStops(page, order);
  assert.deepEqual(stops.filter(stop => stop.kind === 'node').map(stop => stop.id), order.map(id => `focus-${id}`));
  assert.ok(stops.some(stop => stop.id === 'focus-input-root' && stop.label === 'Restore Hidden input branch') || order === restoredOrder,
    'The hidden branch restore button must be a native stop within its parent panel.');
  assert.ok(stops.some(stop => stop.id === 'focus-switch' && stop.label === 'Gate 1 operator') &&
    stops.some(stop => stop.id === 'focus-comment' && stop.label === 'Edit comment text'), 'The traversal must exercise native child controls.');
  await node(page, order[0]).focus();
  for (const [index, stop] of stops.entries()) {
    if (index) await page.keyboard.press('Tab');
    assert.deepEqual(await currentStop(page), stop, `Forward native focus stop ${index + 1} must belong to the declared node and its controls.`);
  }
  await page.keyboard.press('Tab');
  assert.equal(await currentStop(page), null, 'Tab must leave the final node without wrapping or trapping focus.');
  for (const [index, stop] of [...stops].reverse().entries()) {
    await page.keyboard.press('Shift+Tab');
    assert.deepEqual(await currentStop(page), stop, `Reverse native focus stop ${index + 1} must reverse the complete forward order.`);
  }
  await page.keyboard.press('Shift+Tab');
  assert.equal(await currentStop(page), null, 'Shift+Tab must leave the first node through the native preceding control.');
}

Given('an imported workflow with shuffled nested columns and two operation owners', async function () {
  const page = this.page, document = fixture();
  await page.setViewportSize({ width: 1800, height: 1200 });
  await setMode(page, 'workflow');
  await page.getByLabel('Import workflow file', { exact: true }).setInputFiles({
    name: 'workflow-focus-order.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(node(page, 'owner-b')).toBeVisible();
  await page.getByRole('button', { name: 'Fit View', exact: true }).click();
  await saved(page);
  this.focusBaseline = (await readExport(page)).document;
  assert.deepEqual(this.focusBaseline.nodes.map(item => item.id), document.nodes.map(item => item.id),
    'Import and initial measurement must preserve the deliberately shuffled document order.');
  this.focusHistory = await repository(page, 'history', this.focusBaseline.id);
});

Then('native Tab and Shift Tab visit the declared columns and grouped controls without trapping focus', async function () {
  await traverse(this.page, visibleOrder);
});

Then('focusing and measuring the graph preserve its saved array order and history', async function () {
  const page = this.page;
  await page.setViewportSize({ width: 1600, height: 1100 });
  await saved(page);
  assert.deepEqual(graphContent((await readExport(page)).document), graphContent(this.focusBaseline),
    'Native focus and viewport measurement must not sort or rewrite persisted graph arrays.');
  assert.deepEqual(await repository(page, 'history', this.focusBaseline.id), this.focusHistory,
    'Focus and measurement must not create structural history revisions.');
});

Then('hidden branches and disabled controls are absent from native traversal', async function () {
  for (const id of ['hidden-input', 'hidden-leaf']) await expect(node(this.page, id)).toHaveCount(0);
  await expect(node(this.page, 'switch').getByRole('button', { name: 'Remove gate 1', exact: true })).toBeDisabled();
  await expect(node(this.page, 'switch').getByRole('textbox', { name: 'Gate 1 value', exact: true })).toBeDisabled();
  await traverse(this.page, visibleOrder);
});

When('I restore the hidden input branch with the keyboard', async function () {
  const restore = node(this.page, 'input-root').getByRole('button', { name: 'Restore Hidden input branch', exact: true });
  await restore.focus();
  await this.page.keyboard.press('Enter');
  for (const id of ['hidden-input', 'hidden-leaf']) await expect(node(this.page, id)).toBeVisible();
  await saved(this.page);
  this.focusRestored = (await readExport(this.page)).document;
  this.focusRestoredHistory = await repository(this.page, 'history', this.focusBaseline.id);
  assert.equal(this.focusRestoredHistory.length, this.focusHistory.length + 1, 'Restoring the branch must be one intentional graph edit.');
});

Then('its restored columns enter native traversal without adding navigation revisions', async function () {
  await traverse(this.page, restoredOrder);
  assert.deepEqual(graphContent((await readExport(this.page)).document), graphContent(this.focusRestored));
  assert.deepEqual(this.focusRestored.nodes.map(item => item.id), this.focusBaseline.nodes.map(item => item.id),
    'Restoring visibility must preserve the canonical saved node array.');
  assert.deepEqual(await repository(this.page, 'history', this.focusBaseline.id), this.focusRestoredHistory,
    'Navigating the newly visible columns must not create another revision.');
});

Then('editing a comment and selecting an owner preserve native focus and canonical document order', async function () {
  const page = this.page, comment = node(page, 'comment');
  await comment.getByRole('button', { name: 'Edit comment text', exact: true }).click();
  const input = comment.getByRole('textbox', { name: 'Comment text (Markdown)', exact: true });
  await expect(input).toBeFocused();
  const element = await input.elementHandle();
  const text = 'First paragraph.\n\nSecond paragraph changes the measured card.\n\nThird paragraph keeps the same focused editor.';
  await input.fill(text);
  await page.setViewportSize({ width: 1700, height: 1150 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await element.evaluate(element => element.isConnected && document.activeElement === element), true,
    'Editing and measurement must retain the same focused DOM control.');
  await page.keyboard.press('Escape');
  const preview = comment.getByRole('button', { name: 'Edit comment text', exact: true });
  await expect(preview).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(node(page, 'b-input')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(preview).toBeFocused();
  await saved(page);
  const owner = node(page, 'owner-a');
  await owner.focus();
  await page.keyboard.press('Enter');
  await expect(owner).toHaveClass(/\bselected\b/);
  await expect(owner).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(node(page, 'output-root')).toBeFocused();
  const edited = (await readExport(page)).document;
  const expected = structuredClone(this.focusBaseline);
  expected.nodes.find(item => item.id === 'focus-comment').data.text = text;
  assert.deepEqual(graphContent(edited), graphContent(expected), 'Only the intentional comment edit may alter persisted graph content.');
  const persisted = (await storedWorkflows(page)).find(item => item.id === edited.id);
  assert.deepEqual(persisted.nodes.map(item => item.id), this.focusBaseline.nodes.map(item => item.id));
  assert.equal((await repository(page, 'history', edited.id)).length, this.focusHistory.length + 1,
    'Typing is one graph edit; selection, focus movement, and measurement must add no extra revisions.');
});
